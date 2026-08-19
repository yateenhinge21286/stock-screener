const { calculateRSI, aggregateWeeklyCloses, aggregateMonthlyCloses } = require('./src/screener');
const yahooFinance = require('yahoo-finance2').default;

async function check6Years() {
  const yahooSymbol = 'APOLLOHOSP.NS';
  const now = new Date();
  const startYear = now.getUTCFullYear() - 6;
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
    const rsiDaily = calculateRSI(dailyCloses.slice(-100), 14);

    const weeklyCloses = aggregateWeeklyCloses(cleanDaily);
    const rsiWeekly = calculateRSI(weeklyCloses.slice(-150), 14);

    const monthlyCloses = aggregateMonthlyCloses(cleanDaily);
    const rsiMonthly = calculateRSI(monthlyCloses, 14);

    console.log(`=== 6-YEAR HISTORICAL DATA CHECK ===`);
    console.log(`Total daily bars: ${cleanDaily.length}`);
    console.log(`Daily RSI: ${rsiDaily[rsiDaily.length - 1].toFixed(2)}`);
    console.log(`Weekly RSI: ${rsiWeekly[rsiWeekly.length - 1].toFixed(2)}`);
    console.log(`Monthly RSI: ${rsiMonthly[rsiMonthly.length - 1].toFixed(2)}`);

  } catch (err) {
    console.error(err);
  }
}

check6Years();
