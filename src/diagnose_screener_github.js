const { getConfig } = require('./config');
const { sendMessage } = require('./telegram');
const { calculateRSI, aggregateWeeklyCloses, aggregateMonthlyCloses } = require('./screener');
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

async function diagnoseScreener() {
  const config = getConfig();
  const symbol = 'APOLLOHOSP';
  const yahooSymbol = `${symbol}.NS`;
  
  const minClosePrice = config.minClosePrice !== undefined ? config.minClosePrice : 20;
  const minVolume = config.minVolume !== undefined ? config.minVolume : 50000;
  const minHistoryYears = config.minHistoryYears !== undefined ? config.minHistoryYears : 3;
  const minRequiredBars = Math.round(minHistoryYears * 250);

  let msg = `🧪 **GitHub Actions Math Diagnostic Log**\n`;
  msg += `Symbol: \`${yahooSymbol}\`\n\n`;

  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 10);
    startDate.setMonth(0, 1);
    startDate.setHours(0, 0, 0, 0);

    const dailyData = await fetchWithRetry(yahooSymbol, {
      period1: startDate,
      interval: '1d'
    });

    if (!dailyData || dailyData.length === 0) {
      throw new Error('No price history returned');
    }

    const cleanDaily = dailyData
      .filter(bar => bar.date && typeof bar.close === 'number' && !isNaN(bar.close))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    msg += `• **Historical Candles Downloaded**: ${cleanDaily.length}\n`;
    msg += `• **Min History Required**: ${minRequiredBars} bars (${minHistoryYears} years)\n`;
    
    const isHistoryOk = cleanDaily.length >= minRequiredBars;
    msg += `  👉 History OK: \`${isHistoryOk}\`\n\n`;

    const dailyCloses = cleanDaily.map(b => b.close);
    const latestClose = dailyCloses[dailyCloses.length - 1];
    const latestBar = cleanDaily[cleanDaily.length - 1];
    const latestVolume = typeof latestBar.volume === 'number' && !isNaN(latestBar.volume) ? latestBar.volume : 0;

    msg += `• **Latest Close Price**: ₹${latestClose.toFixed(2)} (Min: ₹${minClosePrice})\n`;
    const isPriceOk = latestClose >= minClosePrice;
    msg += `  👉 Price Filter OK: \`${isPriceOk}\`\n\n`;

    msg += `• **Latest Volume**: ${latestVolume.toLocaleString()} (Min: ${minVolume.toLocaleString()})\n`;
    const isVolumeOk = latestVolume >= minVolume;
    msg += `  👉 Volume Filter OK: \`${isVolumeOk}\`\n\n`;

    // RSI Calculations
    const rsiDaily = calculateRSI(dailyCloses, 14);
    const currentDailyRsi = rsiDaily[rsiDaily.length - 1];
    const prevDailyRsi = rsiDaily[rsiDaily.length - 2];

    const weeklyCloses = aggregateWeeklyCloses(cleanDaily);
    const rsiWeekly = calculateRSI(weeklyCloses, 14);
    const currentWeeklyRsi = rsiWeekly[rsiWeekly.length - 1];

    const monthlyCloses = aggregateMonthlyCloses(cleanDaily);
    const rsiMonthly = calculateRSI(monthlyCloses, 14);
    const currentMonthlyRsi = rsiMonthly[rsiMonthly.length - 1];

    msg += `• **Daily RSI Today**: ${currentDailyRsi !== null ? currentDailyRsi.toFixed(2) : 'N/A'} (Should be > 40)\n`;
    msg += `• **Daily RSI Yesterday**: ${prevDailyRsi !== null ? prevDailyRsi.toFixed(2) : 'N/A'} (Should be < 40)\n`;
    msg += `• **Weekly RSI**: ${currentWeeklyRsi !== null ? currentWeeklyRsi.toFixed(2) : 'N/A'} (Should be > 60)\n`;
    msg += `• **Monthly RSI**: ${currentMonthlyRsi !== null ? currentMonthlyRsi.toFixed(2) : 'N/A'} (Should be > 60)\n\n`;

    const isTodayDailyRsiOk = currentDailyRsi !== null && currentDailyRsi > 40;
    const isPrevDailyRsiOk = prevDailyRsi !== null && prevDailyRsi < 40;
    const isWeeklyRsiOk = currentWeeklyRsi !== null && currentWeeklyRsi > 60;
    const isMonthlyRsiOk = currentMonthlyRsi !== null && currentMonthlyRsi > 60;

    const isMatch = isHistoryOk && isPriceOk && isVolumeOk && isTodayDailyRsiOk && isPrevDailyRsiOk && isWeeklyRsiOk && isMonthlyRsiOk;
    msg += `👉 **Overall Match**: \`${isMatch}\`\n`;

  } catch (err) {
    msg += `❌ **Error during math check**: ${err.message}\n`;
  }

  console.log(msg);

  if (config.telegramToken && config.telegramChatId) {
    await sendMessage(msg, config.telegramToken, config.telegramChatId);
    console.log('Math diagnostic sent to Telegram.');
  }
}

diagnoreScreener = diagnoseScreener; // fix spelling just in case
diagnoseScreener();
