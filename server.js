const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const { getConfig, saveConfig } = require('./src/config');
const { executeScan, startScheduler, stopScheduler, getSchedulerStatus, logMessage } = require('./src/scheduler');
const { sendMessage } = require('./src/telegram');
const { fetchNSEEquities } = require('./src/fetch_stocks');
const { runBacktest } = require('./src/backtest');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global scan state to track live progress
let scanState = {
  active: false,
  current: 0,
  total: 0,
  symbol: '',
  message: 'Idle',
  error: null
};

// API: Get current settings & scheduler status
app.get('/api/status', (req, res) => {
  const config = getConfig();
  const schedStatus = getSchedulerStatus();
  
  let stockCount = 0;
  try {
    const stocksPath = path.join(__dirname, 'src/stocks.json');
    if (fs.existsSync(stocksPath)) {
      const stocks = JSON.parse(fs.readFileSync(stocksPath, 'utf8'));
      stockCount = stocks.length;
    }
  } catch (err) {
    console.error('Failed to read stock database count:', err);
  }
  
  res.json({
    config: {
      telegramToken: config.telegramToken || '',
      telegramChatId: config.telegramChatId || '',
      schedulerEnabled: config.schedulerEnabled,
      scanTime: config.scanTime || '18:00',
      minClosePrice: config.minClosePrice !== undefined ? config.minClosePrice : 20,
      minVolume: config.minVolume !== undefined ? config.minVolume : 50000,
      minHistoryYears: config.minHistoryYears !== undefined ? config.minHistoryYears : 3
    },
    scheduler: schedStatus,
    scanState: scanState,
    stockCount: stockCount,
    serverTime: new Date().toISOString(),
    serverTimeIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
});

// API: Get last scan results
app.get('/api/results', (req, res) => {
  const resultsPath = path.join(__dirname, 'results.json');
  try {
    if (fs.existsSync(resultsPath)) {
      const data = fs.readFileSync(resultsPath, 'utf8');
      return res.json(JSON.parse(data));
    }
  } catch (err) {
    console.error('Error reading results.json:', err);
  }
  res.json({ lastScanTime: null, matchedStocks: [] });
});

// API: Get execution logs (last 150 lines)
app.get('/api/logs', (req, res) => {
  const logsPath = path.join(__dirname, 'logs.txt');
  try {
    if (fs.existsSync(logsPath)) {
      const logs = fs.readFileSync(logsPath, 'utf8');
      const lines = logs.trim().split('\n');
      const lastLines = lines.slice(-150).reverse(); // Newest logs first
      return res.json({ logs: lastLines });
    }
  } catch (err) {
    console.error('Error reading logs.txt:', err);
  }
  res.json({ logs: ['[System] No logs found.'] });
});

// API: Clear logs
app.post('/api/logs/clear', (req, res) => {
  const logsPath = path.join(__dirname, 'logs.txt');
  try {
    fs.writeFileSync(logsPath, '', 'utf8');
    logMessage('System log cleared.');
    res.json({ success: true, message: 'Logs cleared.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear logs.' });
  }
});

// API: Get current active scan status
app.get('/api/scan-status', (req, res) => {
  res.json(scanState);
});

// API: Save settings
app.post('/api/settings', (req, res) => {
  const { telegramToken, telegramChatId, schedulerEnabled, scanTime, minClosePrice, minVolume, minHistoryYears } = req.body;
  
  if (scanTime && !/^\d{2}:\d{2}$/.test(scanTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM.' });
  }

  const config = getConfig();
  config.telegramToken = telegramToken !== undefined ? telegramToken.trim() : config.telegramToken;
  config.telegramChatId = telegramChatId !== undefined ? telegramChatId.trim() : config.telegramChatId;
  config.schedulerEnabled = schedulerEnabled !== undefined ? !!schedulerEnabled : config.schedulerEnabled;
  config.scanTime = scanTime !== undefined ? scanTime : config.scanTime;
  config.minClosePrice = minClosePrice !== undefined ? parseFloat(minClosePrice) : config.minClosePrice;
  config.minVolume = minVolume !== undefined ? parseInt(minVolume, 10) : config.minVolume;
  config.minHistoryYears = minHistoryYears !== undefined ? parseFloat(minHistoryYears) : config.minHistoryYears;
  
  if (saveConfig(config)) {
    logMessage(`Settings updated. Scheduler Enabled: ${config.schedulerEnabled}, Time: ${config.scanTime}, Filters: Price>=₹${config.minClosePrice}, Volume>=${config.minVolume.toLocaleString()}, History>=${config.minHistoryYears}y`);
    
    // Reboot scheduler with new configurations
    if (config.schedulerEnabled) {
      startScheduler();
    } else {
      stopScheduler();
    }
    
    res.json({ success: true, config });
  } else {
    res.status(500).json({ error: 'Failed to save configuration.' });
  }
});

// API: Trigger manual scan
app.post('/api/scan', (req, res) => {
  if (scanState.active) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  scanState.active = true;
  scanState.current = 0;
  scanState.total = 0;
  scanState.symbol = '';
  scanState.message = 'Initializing scan...';
  scanState.error = null;

  // Run in background asynchronously so request does not timeout
  executeScan(true, (progress) => {
    scanState.current = progress.current;
    scanState.total = progress.total;
    scanState.symbol = progress.symbol;
    scanState.message = progress.message;
  })
  .then((results) => {
    scanState.active = false;
    scanState.message = `Scan finished successfully! Found ${results.length} stocks.`;
  })
  .catch((err) => {
    scanState.active = false;
    scanState.error = err.message;
    scanState.message = `Scan failed: ${err.message}`;
  });

  res.json({ success: true, message: 'Scan started in background.' });
});

// API: Test Telegram configuration
app.post('/api/test-telegram', async (req, res) => {
  const { telegramToken, telegramChatId } = req.body;
  const config = getConfig();
  
  const token = telegramToken ? telegramToken.trim() : config.telegramToken;
  const chatId = telegramChatId ? telegramChatId.trim() : config.telegramChatId;

  if (!token || !chatId) {
    return res.status(400).json({ error: 'Telegram Bot Token and Chat ID must be configured.' });
  }

  try {
    logMessage(`Sending test telegram message to Chat: ${chatId}...`);
    const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    await sendMessage(
      `🔔 *Stock Screener Connection Test* 🔔\n\n` +
      `Your Telegram bot integration is working perfectly!\n` +
      `Tested at: *${dateStr} IST*`,
      token,
      chatId
    );
    logMessage('Test telegram message delivered successfully.');
    res.json({ success: true, message: 'Test message sent successfully!' });
  } catch (err) {
    logMessage(`Telegram test failed: ${err.message}`);
    res.status(500).json({ error: `Telegram test failed: ${err.message}` });
  }
});

// API: Force refresh NSE equities stock symbols list from NSE archives
app.post('/api/fetch-nifty500', async (req, res) => {
  try {
    logMessage('Manual refresh of NSE equities stock list triggered...');
    const stocks = await fetchNSEEquities();
    res.json({ success: true, count: stocks.length, message: `Successfully loaded ${stocks.length} stocks from NSE.` });
  } catch (err) {
    logMessage(`Failed to refresh NSE equities: ${err.message}`);
    res.status(500).json({ error: `Failed to refresh stock list: ${err.message}` });
  }
});
// Global backtest state
let backtestState = {
  active: false,
  message: 'Idle',
  error: null
};

// API: Get backtest results
app.get('/api/backtest', (req, res) => {
  const backtestResultsPath = path.join(__dirname, 'backtest_results.json');
  try {
    if (fs.existsSync(backtestResultsPath)) {
      const data = fs.readFileSync(backtestResultsPath, 'utf8');
      return res.json(JSON.parse(data));
    }
  } catch (err) {
    console.error('Error reading backtest_results.json:', err);
  }
  res.json({ backtestRunTime: null, lookbackMonths: 12, matchCount: 0, matches: [] });
});

// API: Get active backtest progress
app.get('/api/backtest/status', (req, res) => {
  res.json(backtestState);
});

// API: Run historical backtest
app.post('/api/backtest/run', (req, res) => {
  if (backtestState.active) {
    return res.status(409).json({ error: 'Backtest already in progress' });
  }

  const months = parseInt(req.body.months, 10) || 12;

  backtestState.active = true;
  backtestState.message = `Running ${months}-month backtest across all stocks...`;
  backtestState.error = null;

  logMessage(`Manual backtest trigger: Scanning past ${months} months...`);

  runBacktest(months)
    .then((results) => {
      backtestState.active = false;
      backtestState.message = `Backtest finished successfully! Found ${results.length} historical crossover signals.`;
      logMessage(`Historical backtest complete: Found ${results.length} matches.`);
    })
    .catch((err) => {
      backtestState.active = false;
      backtestState.error = err.message;
      backtestState.message = `Backtest failed: ${err.message}`;
      logMessage(`ERROR during historical backtest: ${err.message}`);
    });

  res.json({ success: true, message: 'Backtest started in background.' });
});

// Start scheduler on startup
const config = getConfig();
logMessage('Initializing system...');
if (config.schedulerEnabled) {
  startScheduler();
} else {
  logMessage('Scheduler is disabled on startup.');
}

app.listen(PORT, () => {
  logMessage(`Server running on http://localhost:${PORT}`);
});
