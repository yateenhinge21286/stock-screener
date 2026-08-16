const { calculateRSI, aggregateWeeklyCloses, aggregateMonthlyCloses } = require('./src/screener');
const yahooFinance = require('yahoo-finance2').default;

async function diagnoseLocal(symbol) {
  const yahooSymbol = `${symbol}.NS`;
  const now = new Date();
  const startYear = now.getUTCFullYear() - 10;
  const startDate = new Date(Date.UTC(startYear, 0, 1, 0, 0, 0, 0));

  try {
    const dailyData = await yahooFinance.historical(yahooSymbol, {
      period1: startDate,
      interval: '1d'
    }, {
      fetchOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    });

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

    console.log(`\n=== LOCAL DIAGNOSTIC FOR ${symbol} ===`);
    console.log(`Total Candles: ${cleanDaily.length}`);
    console.log(`Latest Close Price: ₹${dailyCloses[dailyCloses.length - 1].toFixed(2)}`);
    console.log(`Daily RSI Today: ${currentDailyRsi.toFixed(2)}`);
    console.log(`Daily RSI Yesterday: ${prevDailyRsi.toFixed(2)}`);
    console.log(`Weekly RSI: ${currentWeeklyRsi.toFixed(2)}`);
    console.log(`Monthly RSI: ${currentMonthlyRsi.toFixed(2)}`);

  } catch (err) {
    console.error(`Local diagnosis failed for ${symbol}:`, err);
  }
}

async function run() {
  await diagnoseLocal('ADANIENSOL');
  await diagnoseLocal('ONELIFECAP');
}

run();
