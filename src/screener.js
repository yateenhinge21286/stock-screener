const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;
const { fetchUpstoxCandles } = require('./upstox');

// Suppress some yahoo-finance2 schema validation warnings that can spam console
yahooFinance.setGlobalConfig({
  validation: {
    logErrors: false
  }
});

// Wilder's Smoothed RSI Calculation
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) {
    return new Array(closes ? closes.length : 0).fill(null);
  }

  const rsi = new Array(closes.length).fill(null);
  let gains = 0;
  let losses = 0;

  // Calculate initial average gain and loss over the first 'period' changes
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // The first RSI value is at index 'period'
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi[period] = avgLoss === 0 ? 100 : (100 - (100 / (1 + rs)));

  // Calculate smoothed RSI for the remaining periods
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = avgLoss === 0 ? 100 : (100 - (100 / (1 + rs)));
  }

  return rsi;
}

// Group daily bars by Monday of the calendar week to get weekly closes
function aggregateWeeklyCloses(dailyBars) {
  const weeklyGroups = {};

  dailyBars.forEach((bar) => {
    const date = new Date(bar.date);
    const day = date.getDay();
    // Calculate Monday of the week
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().split('T')[0];

    if (!weeklyGroups[mondayStr]) {
      weeklyGroups[mondayStr] = [];
    }
    weeklyGroups[mondayStr].push(bar);
  });

  // Sort groups chronologically and select the last trading day's close for each week
  const sortedWeeks = Object.keys(weeklyGroups).sort();
  const weeklyCloses = sortedWeeks.map((weekKey) => {
    const group = weeklyGroups[weekKey];
    // Sort daily bars in the week ascending by date
    group.sort((a, b) => new Date(a.date) - new Date(b.date));
    return group[group.length - 1].close;
  });

  return weeklyCloses;
}

// Group daily bars by YYYY-MM to get monthly closes
function aggregateMonthlyCloses(dailyBars) {
  const monthlyGroups = {};

  dailyBars.forEach((bar) => {
    const date = new Date(bar.date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const monthStr = `${year}-${month}`;

    if (!monthlyGroups[monthStr]) {
      monthlyGroups[monthStr] = [];
    }
    monthlyGroups[monthStr].push(bar);
  });

  // Sort groups chronologically and select the last trading day's close for each month
  const sortedMonths = Object.keys(monthlyGroups).sort();
  const monthlyCloses = sortedMonths.map((monthKey) => {
    const group = monthlyGroups[monthKey];
    // Sort daily bars in the month ascending by date
    group.sort((a, b) => new Date(a.date) - new Date(b.date));
    return group[group.length - 1].close;
  });

  return monthlyCloses;
}

// Custom async pool function for concurrency control
async function runWithConcurrency(limit, items, taskFn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => taskFn(item));
    results.push(p);
    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

// Helper to fetch historical price data with exponential backoff retries for rate-limiting protection using modern chart() API
async function fetchWithRetry(symbol, queryOptions, retries = 3, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      const chartResult = await yahooFinance.chart(symbol, queryOptions, {
        fetchOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }
      });
      return chartResult.quotes || [];
    } catch (err) {
      const isRateLimit = err.message && (err.message.includes('429') || err.message.includes('Too Many Requests') || err.message.includes('502') || err.message.includes('503'));
      if (isRateLimit && i < retries - 1) {
        // Wait with exponential backoff + jitter
        const backoffDelay = delay * Math.pow(2, i) + Math.random() * 500;
        console.warn(`[RateLimit/Network Error] Retrying ${symbol} in ${Math.round(backoffDelay)}ms (Attempt ${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }
      throw err;
    }
  }
}

// Main scan function
async function runScan(progressCallback = () => {}) {
  const stocksPath = path.join(__dirname, 'stocks.json');
  if (!fs.existsSync(stocksPath)) {
    throw new Error('stocks.json file not found. Please fetch stock symbols first.');
  }

  const { getConfig } = require('./config');
  const config = getConfig();
  const minClosePrice = config.minClosePrice !== undefined ? config.minClosePrice : 20;
  const minVolume = config.minVolume !== undefined ? config.minVolume : 50000;
  const minHistoryYears = config.minHistoryYears !== undefined ? config.minHistoryYears : 3;
  const minRequiredBars = Math.round(minHistoryYears * 250); // ~250 trading days per year

  const stocks = JSON.parse(fs.readFileSync(stocksPath, 'utf8'));
  const total = stocks.length;
  let current = 0;
  const matchedStocks = [];

  console.log(`Starting scan of ${total} stocks with filters: minPrice=₹${minClosePrice}, minVolume=${minVolume.toLocaleString()}, minHistory=${minHistoryYears} years (${minRequiredBars} bars)...`);

  // Start date: 10 years ago, strictly constructed in UTC (January 1st) to align daily candles across all timezones
  const now = new Date();
  const startYear = now.getUTCFullYear() - 6;
  const startDate = new Date(Date.UTC(startYear, 0, 1, 0, 0, 0, 0));

  const scanTask = async (stock) => {
    const symbol = stock.symbol;
    const name = stock.name;
    const yahooSymbol = `${symbol}.NS`;

    try {
      let cleanDaily = [];
      let dataSource = 'Yahoo Finance';

      // If Upstox token is available, attempt fetching from Upstox first
      if (config.upstoxAccessToken) {
        try {
          cleanDaily = await fetchUpstoxCandles(symbol, startDate, now, config.upstoxAccessToken);
          dataSource = 'Upstox';
        } catch (upstoxErr) {
          // Log warning and fallback to Yahoo Finance
          console.warn(`[Upstox API] Failed to fetch ${symbol}: ${upstoxErr.message}. Falling back to Yahoo Finance...`);
          cleanDaily = [];
        }
      }

      // Fallback to Yahoo Finance if Upstox was not configured or failed
      if (cleanDaily.length === 0) {
        const queryOptions = {
          period1: startDate,
          interval: '1d'
        };
        const dailyData = await fetchWithRetry(yahooSymbol, queryOptions);
        if (!dailyData || dailyData.length === 0) {
          throw new Error('No price history returned');
        }
        cleanDaily = dailyData
          .filter(bar => bar.date && typeof bar.close === 'number' && !isNaN(bar.close))
          .sort((a, b) => new Date(a.date) - new Date(b.date));
      }

      // 1. History Length Filter
      if (cleanDaily.length < minRequiredBars) {
        throw new Error(`Filtered: Listing history of ${cleanDaily.length} bars is below minimum required ${minRequiredBars} bars (${minHistoryYears} years)`);
      }

      const dailyCloses = cleanDaily.map(b => b.close);
      const latestClose = dailyCloses[dailyCloses.length - 1];
      const latestBar = cleanDaily[cleanDaily.length - 1];
      const latestVolume = typeof latestBar.volume === 'number' && !isNaN(latestBar.volume) ? latestBar.volume : 0;

      // 2. Minimum Close Price Filter
      if (latestClose < minClosePrice) {
        throw new Error(`Filtered: Stock price ₹${latestClose.toFixed(2)} is below minimum threshold ₹${minClosePrice}`);
      }

      // 3. Minimum Daily Volume Filter
      if (latestVolume < minVolume) {
        throw new Error(`Filtered: Trading volume ${latestVolume.toLocaleString()} is below minimum threshold ${minVolume.toLocaleString()}`);
      }

      // Calculate Daily RSI using the last 100 bars to stabilize the calculation and avoid regional database discrepancies
      const rsiDaily = calculateRSI(dailyCloses.slice(-100), 14);
      const currentDailyRsi = rsiDaily[rsiDaily.length - 1];
      const prevDailyRsi = rsiDaily[rsiDaily.length - 2];
 
      // Aggregate Weekly and Calculate Weekly RSI using the last 150 weeks
      const weeklyCloses = aggregateWeeklyCloses(cleanDaily);
      const rsiWeekly = calculateRSI(weeklyCloses.slice(-150), 14);
      const currentWeeklyRsi = rsiWeekly[rsiWeekly.length - 1];

      // Aggregate Monthly and Calculate Monthly RSI
      const monthlyCloses = aggregateMonthlyCloses(cleanDaily);
      const rsiMonthly = calculateRSI(monthlyCloses, 14);
      const currentMonthlyRsi = rsiMonthly[rsiMonthly.length - 1];

      // Evaluate Screening Rules
      // 1. Monthly RSI(14) > 60
      const isMonthlyRsiOk = currentMonthlyRsi !== null && currentMonthlyRsi > 60;

      // 2. Weekly RSI(14) > 60
      const isWeeklyRsiOk = currentWeeklyRsi !== null && currentWeeklyRsi > 60;

      // 3. 1 day ago Daily RSI(14) < 40
      const isPrevDailyRsiOk = prevDailyRsi !== null && prevDailyRsi < 40;

      // 4. Today Daily RSI(14) > 40
      const isTodayDailyRsiOk = currentDailyRsi !== null && currentDailyRsi > 40;

      const isMatch = isMonthlyRsiOk && isWeeklyRsiOk && isPrevDailyRsiOk && isTodayDailyRsiOk;

      const stockResult = {
        symbol,
        name,
        close: parseFloat(latestClose.toFixed(2)),
        dailyRsi: currentDailyRsi !== null ? parseFloat(currentDailyRsi.toFixed(2)) : null,
        prevDailyRsi: prevDailyRsi !== null ? parseFloat(prevDailyRsi.toFixed(2)) : null,
        weeklyRsi: currentWeeklyRsi !== null ? parseFloat(currentWeeklyRsi.toFixed(2)) : null,
        monthlyRsi: currentMonthlyRsi !== null ? parseFloat(currentMonthlyRsi.toFixed(2)) : null,
        isMatch
      };

      if (isMatch) {
        matchedStocks.push(stockResult);
      }

      current++;
      progressCallback({
        current,
        total,
        symbol,
        status: 'success',
        matched: isMatch,
        message: `Success: D=${stockResult.dailyRsi}, W=${stockResult.weeklyRsi}, M=${stockResult.monthlyRsi}`
      });

      return stockResult;

    } catch (err) {
      current++;
      progressCallback({
        current,
        total,
        symbol,
        status: 'error',
        matched: false,
        message: `Error: ${err.message}`
      });
      return {
        symbol,
        name,
        error: err.message,
        isMatch: false
      };
    }
  };

  // Run with concurrency limit of 5 to scan fast without triggering Yahoo Finance rate limits
  await runWithConcurrency(5, stocks, scanTask);

  console.log(`Scan completed. Found ${matchedStocks.length} matched stocks out of ${total}.`);
  return matchedStocks;
}

module.exports = {
  calculateRSI,
  aggregateWeeklyCloses,
  aggregateMonthlyCloses,
  runScan
};
