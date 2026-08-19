const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const instrumentsPath = path.join(__dirname, 'upstox_instruments.json');

// Helper to make native HTTPS requests returning a Buffer (for gzipped content)
function httpsRequestBuffer(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...options.headers
      }
    };

    const req = https.request(requestOptions, (res) => {
      // Handle redirects if any
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsRequestBuffer(res.headers.location, options).then(resolve).catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        let errData = '';
        res.on('data', chunk => errData += chunk);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errData}`)));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Helper to make native HTTPS requests returning string text
async function httpsRequest(url, options = {}) {
  const buffer = await httpsRequestBuffer(url, options);
  return buffer.toString('utf8');
}

// Download, unzip, and parse Upstox's NSE JSON Instrument list
async function downloadUpstoxInstruments() {
  console.log('Downloading Upstox NSE instruments mapping (NSE.json.gz)...');
  try {
    const url = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
    const buffer = await httpsRequestBuffer(url);
    
    // Decompress the gzipped JSON content
    const jsonText = zlib.gunzipSync(buffer).toString('utf8');
    const instruments = JSON.parse(jsonText);
    
    if (!Array.isArray(instruments)) {
      throw new Error('Instruments JSON is not an array');
    }

    const mapping = {};
    for (const inst of instruments) {
      // Filter for cash equity segment (NSE Cash is segment 'NSE_EQ')
      if (inst.segment === 'NSE_EQ' && inst.instrument_type === 'EQ') {
        // e.g. mapping["RELIANCE"] = "NSE_EQ|INE002A01018"
        mapping[inst.trading_symbol] = inst.instrument_key;
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

  const responseText = await httpsRequest(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const json = JSON.parse(responseText);
  if (json.status !== 'success' || !json.data || !Array.isArray(json.data.candles)) {
    throw new Error(`Upstox returned invalid format: ${responseText}`);
  }

  // Upstox candle array: [timestamp, open, high, low, close, volume, open_interest]
  // Upstox candles are returned descending (latest date first)
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
