const { fetchUpstoxCandles } = require('./src/upstox');
const { getConfig } = require('./src/config');
const { calculateRSI } = require('./src/screener');

const config = getConfig();

function getISTDate(dateObj) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  const parts = formatter.formatToParts(new Date(dateObj));
  const map = {};
  parts.forEach(p => map[p.type] = p.value);
  return new Date(Date.UTC(map.year, map.month - 1, map.day, 0, 0, 0, 0));
}

function aggregateWeeklyClosesIST(dailyBars) {
  const weeklyGroups = {};
  dailyBars.forEach((bar) => {
    const istDate = getISTDate(bar.date);
    const day = istDate.getDay();
    const diff = istDate.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(istDate.setDate(diff));
    const mondayStr = monday.toISOString().split('T')[0];

    if (!weeklyGroups[mondayStr]) {
      weeklyGroups[mondayStr] = [];
    }
    weeklyGroups[mondayStr].push(bar);
  });

  const sortedWeeks = Object.keys(weeklyGroups).sort();
  return sortedWeeks.map((weekKey) => {
    const group = weeklyGroups[weekKey];
    group.sort((a, b) => new Date(a.date) - new Date(b.date));
    return group[group.length - 1].close;
  });
}

function aggregateMonthlyClosesIST(dailyBars) {
  const monthlyGroups = {};
  dailyBars.forEach((bar) => {
    const istDate = getISTDate(bar.date);
    const year = istDate.getFullYear();
    const month = (istDate.getMonth() + 1).toString().padStart(2, '0');
    const monthStr = `${year}-${month}`;

    if (!monthlyGroups[monthStr]) {
      monthlyGroups[monthStr] = [];
    }
    monthlyGroups[monthStr].push(bar);
  });

  const sortedMonths = Object.keys(monthlyGroups).sort();
  return sortedMonths.map((monthKey) => {
    const group = monthlyGroups[monthKey];
    group.sort((a, b) => new Date(a.date) - new Date(b.date));
    return group[group.length - 1].close;
  });
}

async function diagnoseIcil() {
  const token = config.upstoxAccessToken;
  if (!token) return;

  const symbol = 'ICIL';
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear() - 6, 0, 1));

  try {
    const dailyCandles = await fetchUpstoxCandles(symbol, startDate, now, token);
    const dailyCloses = dailyCandles.map(b => b.close);
    const dailyRsi = calculateRSI(dailyCloses, 14);

    console.log('\n--- Comparing Sliced vs. Full RSI on Monday, Aug 17, 2026 ---');
    // Find index of August 17, 2026
    const t = dailyCandles.findIndex(bar => {
      const d = getISTDate(bar.date);
      return d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 17;
    });

    if (t === -1) {
      console.log('Could not find Monday, August 17 in the candle list.');
      return;
    }

    const bar = dailyCandles[t];
    const simulatedDaily = dailyCandles.slice(0, t + 1);

    // 1. Weekly Closes
    const simWeeklyCloses = aggregateWeeklyClosesIST(simulatedDaily);
    
    // Sliced (150 weeks) Weekly RSI
    const simRsiWeeklySliced = calculateRSI(simWeeklyCloses.slice(-150), 14);
    const wRsiSliced = simRsiWeeklySliced[simRsiWeeklySliced.length - 1];

    // Full (Un-sliced, ~312 weeks) Weekly RSI
    const simRsiWeeklyFull = calculateRSI(simWeeklyCloses, 14);
    const wRsiFull = simRsiWeeklyFull[simRsiWeeklyFull.length - 1];

    // 2. Monthly Closes
    const simMonthlyCloses = aggregateMonthlyClosesIST(simulatedDaily);

    // Sliced (July 2026) Monthly RSI vs Full Monthly RSI
    const simRsiMonthlyFull = calculateRSI(simMonthlyCloses, 14);
    const mRsiFull = simRsiMonthlyFull[simRsiMonthlyFull.length - 1];

    console.log(`Close Price: ${bar.close}`);
    console.log(`Daily RSI: ${dailyRsi[t].toFixed(2)} (Prev: ${dailyRsi[t-1].toFixed(2)})`);
    console.log(`Weekly RSI (Sliced to 150 weeks): ${wRsiSliced.toFixed(2)}`);
    console.log(`Weekly RSI (Full 6 years history): ${wRsiFull.toFixed(2)}`);
    console.log(`Monthly RSI (Full 6 years history): ${mRsiFull.toFixed(2)}`);

  } catch (err) {
    console.error('Error:', err);
  }
}

diagnoseIcil();
