const fs = require('fs');
const path = require('path');
const https = require('https');

const STOCKS_JSON_PATH = path.join(__dirname, 'stocks.json');
const NSE_CSV_URL = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv';

// Robust CSV line parser to handle quotes and commas in fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function fetchNSEEquities() {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
      }
    };

    https.get(NSE_CSV_URL, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download NSE equities CSV: Status ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const lines = data.split('\n');
          const stocks = [];
          
          // Header: SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, ...
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = parseCSVLine(line);
            if (parts.length < 3) continue;
            
            const symbol = parts[0];
            const name = parts[1];
            const series = parts[2];

            // Filter out column names, empty rows, and restrict to Series EQ, BE, or BZ (Standard and Trade-to-Trade Equities)
            if (symbol && symbol !== 'SYMBOL' && (series === 'EQ' || series === 'BE' || series === 'BZ') && /^[A-Z0-9&-]+$/.test(symbol)) {
              stocks.push({ symbol, name });
            }
          }

          if (stocks.length > 0) {
            // Sort stocks alphabetically by symbol
            stocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
            fs.writeFileSync(STOCKS_JSON_PATH, JSON.stringify(stocks, null, 2), 'utf8');
            console.log(`Successfully fetched and saved ${stocks.length} cash segment stocks (EQ/BE/BZ) to stocks.json`);
            resolve(stocks);
          } else {
            reject(new Error('Parsed 0 stocks from CSV'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// If run directly
if (require.main === module) {
  fetchNSEEquities()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error fetching NSE Equities:', err);
      process.exit(1);
    });
}

module.exports = { fetchNSEEquities };
