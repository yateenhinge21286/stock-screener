const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;
const { calculateRSI, aggregateWeeklyCloses, aggregateMonthlyCloses } = require('./screener');

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
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }
      throw err;
    }
  }
}

async function runBacktest(lookbackMonths = 12) {
  const stocksPath = path.join(__dirname, 'stocks.json');
  const backtestResultsPath = path.join(__dirname, '../backtest_results.json');

  if (!fs.existsSync(stocksPath)) {
    throw new Error('stocks.json not found.');
  }

  const { getConfig } = require('./config');
  const config = getConfig();
  const minClosePrice = config.minClosePrice !== undefined ? config.minClosePrice : 20;
  const minVolume = config.minVolume !== undefined ? config.minVolume : 50000;
  const minHistoryYears = config.minHistoryYears !== undefined ? config.minHistoryYears : 3;
  const minRequiredBars = Math.round(minHistoryYears * 250);

  const stocks = JSON.parse(fs.readFileSync(stocksPath, 'utf8'));
  const total = stocks.length;
  let current = 0;
  const backtestMatches = [];

  console.log(`Starting historical backtest for ${total} stocks over the last ${lookbackMonths} months with filters: minPrice=₹${minClosePrice}, minVolume=${minVolume.toLocaleString()}, minHistory=${minHistoryYears} years (${minRequiredBars} bars)...`);

  // Start date for downloads: 10 years ago, strictly constructed in UTC (January 1st) to align daily candles across all timezones
  const now = new Date();
  const startYear = now.getUTCFullYear() - 10;
  const downloadStartDate = new Date(Date.UTC(startYear, 0, 1, 0, 0, 0, 0));

  // Backtest boundary: check crossovers that occurred in the last N months
  const backtestStartDate = new Date();
  backtestStartDate.setMonth(backtestStartDate.getMonth() - lookbackMonths);

  const backtestTask = async (stock) => {
    const symbol = stock.symbol;
    const name = stock.name;
    const yahooSymbol = `${symbol}.NS`;

    try {
      const dailyData = await fetchWithRetry(yahooSymbol, {
        period1: downloadStartDate,
        interval: '1d'
      });

      if (!dailyData || dailyData.length === 0) return;

      const cleanDaily = dailyData
        .filter(bar => bar.date && typeof bar.close === 'number' && !isNaN(bar.close))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // 1. History Length Filter
      if (cleanDaily.length < minRequiredBars) return;

      const dailyCloses = cleanDaily.map(b => b.close);
      const rsiDaily = calculateRSI(dailyCloses, 14);

      // Find crossovers in the target backtest range
      for (let t = 1; t < cleanDaily.length; t++) {
        const barDate = new Date(cleanDaily[t].date);
        
        // Skip dates before our backtest start window
        if (barDate < backtestStartDate) continue;

        const prevD = rsiDaily[t - 1];
        const currD = rsiDaily[t];

        // Crossover check: Daily RSI crossed above 40 (yesterday < 40, today > 40)
        if (prevD !== null && currD !== null && prevD < 40 && currD > 40) {
          
          const closePrice = cleanDaily[t].close;
          const volume = typeof cleanDaily[t].volume === 'number' && !isNaN(cleanDaily[t].volume) ? cleanDaily[t].volume : 0;

          // 2. Minimum Close Price Filter
          if (closePrice < minClosePrice) continue;

          // 3. Minimum Daily Volume Filter
          if (volume < minVolume) continue;
          
          // Slice daily data up to day t to prevent look-ahead bias (future leakage)
          const simulatedDaily = cleanDaily.slice(0, t + 1);
          
          // Calculate Weekly RSI up to day t using the last 150 weeks
          const simWeeklyCloses = aggregateWeeklyCloses(simulatedDaily);
          const simRsiWeekly = calculateRSI(simWeeklyCloses.slice(-150), 14);
          const wRsi = simRsiWeekly[simRsiWeekly.length - 1];

          // Calculate Monthly RSI up to day t
          const simMonthlyCloses = aggregateMonthlyCloses(simulatedDaily);
          const simRsiMonthly = calculateRSI(simMonthlyCloses, 14);
          const mRsi = simRsiMonthly[simRsiMonthly.length - 1];

          // Filter rules: Weekly RSI > 60 and Monthly RSI > 60 on that date (no look-ahead)
          if (wRsi !== undefined && wRsi !== null && wRsi > 60 &&
              mRsi !== undefined && mRsi !== null && mRsi > 60) {
            
            backtestMatches.push({
              symbol,
              name,
              date: cleanDaily[t].date.toISOString().split('T')[0],
              close: parseFloat(cleanDaily[t].close.toFixed(2)),
              dailyRsi: parseFloat(currD.toFixed(2)),
              prevDailyRsi: parseFloat(prevD.toFixed(2)),
              weeklyRsi: parseFloat(wRsi.toFixed(2)),
              monthlyRsi: parseFloat(mRsi.toFixed(2))
            });
          }
        }
      }
      
      current++;
      if (current % 100 === 0 || current === total) {
        console.log(`Backtest Progress: ${current}/${total} (${Math.round((current/total)*100)}%) - Found ${backtestMatches.length} historical hits`);
      }
    } catch (err) {
      current++;
    }
  };

  // Run with 5 parallel requests
  await runWithConcurrency(5, stocks, backtestTask);

  // Sort matched events by date descending (latest first)
  backtestMatches.sort((a, b) => new Date(b.date) - new Date(a.date));

  fs.writeFileSync(
    backtestResultsPath, 
    JSON.stringify({
      backtestRunTime: new Date().toISOString(),
      lookbackMonths,
      totalScanned: total,
      matchCount: backtestMatches.length,
      matches: backtestMatches
    }, null, 2), 
    'utf8'
  );

  console.log(`Backtest complete! Found ${backtestMatches.length} matches. Saved to backtest_results.json.`);
  return backtestMatches;
}

// If run directly
if (require.main === module) {
  runBacktest(12) // Default 1 year backtest
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Backtest script failed:', err);
      process.exit(1);
    });
}

module.exports = { runBacktest };
