const fs = require('fs');
const path = require('path');

const instrumentsPath = path.join(__dirname, 'upstox_instruments.json');

// Download and parse Upstox's NSE Instrument list
async function downloadUpstoxInstruments() {
  console.log('Downloading Upstox NSE instruments mapping (NSE.csv)...');
  try {
    const response = await fetch('https://headers.upstox.com/instruments/NSE.csv');
    if (!response.ok) {
      throw new Error(`Failed to fetch Upstox instruments: ${response.statusText}`);
    }
    const text = await response.text();
    const lines = text.split('\n');
    if (lines.length === 0) {
      throw new Error('Instruments CSV is empty');
    }

    const headers = lines[0].split(',');
    const keyIdx = headers.indexOf('instrument_key');
    const symbolIdx = headers.indexOf('trading_symbol');
    const segmentIdx = headers.indexOf('segment');

    if (keyIdx === -1 || symbolIdx === -1 || segmentIdx === -1) {
      throw new Error('Failed to parse columns from Upstox NSE.csv');
    }

    const mapping = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = line.split(',');
      if (cols.length <= Math.max(keyIdx, symbolIdx, segmentIdx)) continue;

      const key = cols[keyIdx];
      const symbol = cols[symbolIdx];
      const segment = cols[segmentIdx];

      // We only scan cash equity segment stocks
      if (segment === 'NSE_EQ') {
        mapping[symbol] = key;
      }
    }

    fs.writeFileSync(instrumentsPath, JSON.stringify(mapping, null, 2), 'utf8');
    console.log(`Successfully mapped ${Object.keys(mapping).length} symbols. Saved to upstox_instruments.json.`);
    return mapping;
  } catch (err) {
    console.error('Error downloading Upstox instruments:', err);
    throw err;
  }
}

// Retrieve instrument key for a symbol
function getInstrumentKey(symbol) {
  // If file doesn't exist, return null (it will be downloaded on callback authentication)
  if (!fs.existsSync(instrumentsPath)) {
    return null;
  }

  try {
    const mapping = JSON.parse(fs.readFileSync(instrumentsPath, 'utf8'));
    return mapping[symbol] || null;
  } catch (err) {
    console.error('Error reading upstox_instruments.json:', err);
    return null;
  }
}

// Fetch daily candles from Upstox API
async function fetchUpstoxCandles(symbol, startDate, toDate = new Date(), accessToken) {
  const key = getInstrumentKey(symbol);
  if (!key) {
    throw new Error(`Upstox instrument key not found for symbol: ${symbol}`);
  }

  // Format dates as YYYY-MM-DD
  const formatISO = (date) => date.toISOString().split('T')[0];
  const toDateStr = formatISO(toDate);
  const fromDateStr = formatISO(startDate);

  // Upstox endpoint: /historical-candle/{instrumentKey}/day/{toDate}/{fromDate}
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(key)}/day/${toDateStr}/${fromDateStr}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upstox candle fetch failed (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  if (json.status !== 'success' || !json.data || !Array.isArray(json.data.candles)) {
    throw new Error(`Upstox returned invalid format: ${JSON.stringify(json)}`);
  }

  // Upstox candle array: [timestamp, open, high, low, close, volume, open_interest]
  // Note: Upstox candles are returned descending (latest date first)
  const candles = json.data.candles.map(c => ({
    date: new Date(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseInt(c[5], 10)
  }));

  // Filter out any invalid items and sort ascending
  return candles
    .filter(bar => bar.date && typeof bar.close === 'number' && !isNaN(bar.close))
    .sort((a, b) => a.date - b.date);
}

module.exports = {
  downloadUpstoxInstruments,
  getInstrumentKey,
  fetchUpstoxCandles
};
