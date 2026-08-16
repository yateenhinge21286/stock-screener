const { runScan, calculateRSI, aggregateWeeklyCloses, aggregateMonthlyCloses } = require('./screener');
const { getConfig } = require('./config');
const { sendMessage } = require('./telegram');
const yahooFinance = require('yahoo-finance2').default;

async function fetchWithRetry(symbol, queryOptions, retries = 3, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await yahooFinance.historical(symbol, queryOptions, {
        fetchOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }
      });
    } catch (err) {
      const isRateLimit = err.message && (err.message.includes('429') || err.message.includes('Too Many Requests') || err.message.includes('502') || err.message.includes('503'));
      if (isRateLimit && i < retries - 1) {
        const backoffDelay = delay * Math.pow(2, i) + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }
      throw err;
    }
  }
}

async function getStockMathBreakdown(symbol) {
  const yahooSymbol = `${symbol}.NS`;
  const now = new Date();
  const startYear = now.getUTCFullYear() - 10;
  const startDate = new Date(Date.UTC(startYear, 0, 1, 0, 0, 0, 0));

  try {
    const dailyData = await fetchWithRetry(yahooSymbol, {
      period1: startDate,
      interval: '1d'
    });

    if (!dailyData || dailyData.length === 0) {
      return `• **${symbol}**: Fetch returned empty daily data.`;
    }

    const cleanDaily = dailyData
      .filter(bar => bar.date && typeof bar.close === 'number' && !isNaN(bar.close))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const dailyCloses = cleanDaily.map(b => b.close);
    const rsiDaily = calculateRSI(dailyCloses, 14);
    const currentDailyRsi = rsiDaily[rsiDaily.length - 1];
    const prevDailyRsi = rsiDaily[rsiDaily.length - 2];

    const weeklyCloses = aggregateWeeklyCloses(cleanDaily);
    const rsiWeekly = calculateRSI(weeklyCloses, 14);
    const currentWeeklyRsi = rsiWeekly[rsiWeekly.length - 1];

    const monthlyCloses = aggregateMonthlyCloses(cleanDaily);
    const rsiMonthly = calculateRSI(monthlyCloses, 14);
    const currentMonthlyRsi = rsiMonthly[rsiMonthly.length - 1];

    const latestBar = cleanDaily[cleanDaily.length - 1];
    const latestVol = latestBar.volume || 0;

    let res = `• **${symbol}**:\n`;
    res += `  - Price: ₹${latestBar.close.toFixed(2)}, Vol: ${latestVol.toLocaleString()}\n`;
    res += `  - Total Daily Bars: ${cleanDaily.length}\n`;
    res += `  - Daily RSI (Yesterday ➔ Today): ${prevDailyRsi !== null ? prevDailyRsi.toFixed(2) : 'N/A'} ➔ ${currentDailyRsi !== null ? currentDailyRsi.toFixed(2) : 'N/A'}\n`;
    res += `  - Weekly RSI: ${currentWeeklyRsi !== null ? currentWeeklyRsi.toFixed(2) : 'N/A'}\n`;
    res += `  - Monthly RSI: ${currentMonthlyRsi !== null ? currentMonthlyRsi.toFixed(2) : 'N/A'}\n`;
    return res;
  } catch (err) {
    return `• **${symbol}**: Math check failed with error: _${err.message}_`;
  }
}

async function runDiagnosticScan() {
  const config = getConfig();
  const skippedStocks = {};
  const matchedList = [];

  console.log('Starting detailed diagnostic scan on GitHub Action...');

  try {
    const results = await runScan((progress) => {
      if (progress.status === 'error') {
        skippedStocks[progress.symbol] = progress.message;
      }
      if (progress.status === 'success' && progress.matched) {
        matchedList.push(progress.symbol);
      }
      if (progress.current % 200 === 0 || progress.current === progress.total) {
        console.log(`Scan Progress: ${progress.current}/${progress.total}`);
      }
    });

    let msg = `🧪 **GitHub Actions Math Breakdown**\n\n`;
    msg += `✅ **Matches found on GitHub (${results.length})**:\n`;
    if (results.length > 0) {
      results.forEach((r, idx) => {
        msg += `${idx + 1}. \`${r.symbol}\` (Price: ₹${r.close})\n`;
      });
    } else {
      msg += `None\n`;
    }

    msg += `\n🔍 **Expected Stocks Calculations on GitHub**:\n\n`;
    const targetSymbols = ['APOLLOHOSP', 'ONELIFECAP', 'ADANIENSOL', 'CEMPRO'];
    for (const sym of targetSymbols) {
      const breakdown = await getStockMathBreakdown(sym);
      msg += breakdown + '\n';
    }

    msg += `Runner Time: ${new Date().toISOString()}\n`;

    console.log(msg);

    if (config.telegramToken && config.telegramChatId) {
      await sendMessage(msg, config.telegramToken, config.telegramChatId);
      console.log('Diagnostic breakdown sent to Telegram.');
    }

  } catch (err) {
    console.error('Diagnostic scan execution failed:', err);
    if (config.telegramToken && config.telegramChatId) {
      await sendMessage(`❌ Diagnostic scan failed: ${err.message}`, config.telegramToken, config.telegramChatId);
    }
  }
}

runDiagnosticScan();
