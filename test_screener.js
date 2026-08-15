const { runScan, calculateRSI } = require('./src/screener');
const yahooFinance = require('yahoo-finance2').default;

async function testSingleStock(symbol) {
  console.log(`=== TESTING Technical Indicators for ${symbol} ===`);
  const yahooSymbol = `${symbol}.NS`;
  
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 10);

  try {
    console.log(`Fetching 3.5 years of data for ${yahooSymbol}...`);
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

    console.log(`Data downloaded: ${dailyData.length} daily bars.`);

    const cleanDaily = dailyData
      .filter(bar => bar.date && typeof bar.close === 'number' && !isNaN(bar.close))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const dailyCloses = cleanDaily.map(b => b.close);
    const rsiDaily = calculateRSI(dailyCloses, 14);

    const latestClose = dailyCloses[dailyCloses.length - 1];
    const currentDailyRsi = rsiDaily[rsiDaily.length - 1];
    const prevDailyRsi = rsiDaily[rsiDaily.length - 2];

    console.log(`\nDaily Close: ₹${latestClose.toFixed(2)}`);
    console.log(`Daily RSI(14): ${currentDailyRsi !== null ? currentDailyRsi.toFixed(2) : 'N/A'}`);
    console.log(`Daily RSI(14) Yesterday: ${prevDailyRsi !== null ? prevDailyRsi.toFixed(2) : 'N/A'}`);

    const { aggregateWeeklyCloses, aggregateMonthlyCloses } = require('./src/screener');
    
    const weeklyCloses = aggregateWeeklyCloses(cleanDaily);
    const rsiWeekly = calculateRSI(weeklyCloses, 14);
    const currentWeeklyRsi = rsiWeekly[rsiWeekly.length - 1];
    console.log(`Weekly Closes Aggregated: ${weeklyCloses.length} weeks.`);
    console.log(`Weekly RSI(14): ${currentWeeklyRsi !== null ? currentWeeklyRsi.toFixed(2) : 'N/A'}`);

    const monthlyCloses = aggregateMonthlyCloses(cleanDaily);
    const rsiMonthly = calculateRSI(monthlyCloses, 14);
    const currentMonthlyRsi = rsiMonthly[rsiMonthly.length - 1];
    console.log(`Monthly Closes Aggregated: ${monthlyCloses.length} months.`);
    console.log(`Monthly RSI(14): ${currentMonthlyRsi !== null ? currentMonthlyRsi.toFixed(2) : 'N/A'}`);

    console.log('\nScanning check:');
    console.log(`- Monthly RSI > 60: ${currentMonthlyRsi > 60}`);
    console.log(`- Weekly RSI > 60: ${currentWeeklyRsi > 60}`);
    console.log(`- Prev Daily RSI < 40: ${prevDailyRsi < 40}`);
    console.log(`- Today Daily RSI > 40: ${currentDailyRsi > 40}`);

    console.log(`Is Scanner Match: ${currentMonthlyRsi > 60 && currentWeeklyRsi > 60 && prevDailyRsi < 40 && currentDailyRsi > 40}`);

  } catch (err) {
    console.error(`Test failed for ${symbol}:`, err);
  }
}

testSingleStock('ADANIENSOL');
