const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { getConfig, saveConfig } = require('./config');
const { runScan } = require('./screener');
const { sendStockScanResults } = require('./telegram');

const logsPath = path.join(__dirname, '../logs.txt');
const resultsPath = path.join(__dirname, '../results.json');

let cronJob = null;

// Logging helper
function logMessage(msg) {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const formattedMsg = `[${timestamp} IST] ${msg}\n`;
  try {
    fs.appendFileSync(logsPath, formattedMsg, 'utf8');
  } catch (err) {
    console.error('Failed to write log to file:', err);
  }
  console.log(formattedMsg.trim());
}

// Perform scan and handle notifications/results persistence
async function executeScan(isManual = false, progressCallback = null) {
  const triggerType = isManual ? 'Manual' : 'Scheduled';
  logMessage(`Starting ${triggerType} scan...`);

  const config = getConfig();

  try {
    const matchedStocks = await runScan((progress) => {
      // Periodic logging of progress (every 50 stocks)
      if (progress.current % 50 === 0 || progress.current === progress.total) {
        logMessage(`Scan progress: ${progress.current}/${progress.total} (${Math.round((progress.current/progress.total)*100)}%)`);
      }
      if (progressCallback) {
        progressCallback(progress);
      }
    });

    logMessage(`Scan complete. Found ${matchedStocks.length} matching stocks.`);

    // Save scan results to results.json
    const scanData = {
      lastScanTime: new Date().toISOString(),
      matchedStocks
    };
    fs.writeFileSync(resultsPath, JSON.stringify(scanData, null, 2), 'utf8');

    // Update config metrics
    config.lastScanTime = new Date().toISOString();
    config.lastScanStatus = 'success';
    config.lastScanHits = matchedStocks.length;
    saveConfig(config);

    // Send Telegram Notification
    if (config.telegramToken && config.telegramChatId) {
      logMessage('Sending stock alerts to Telegram...');
      await sendStockScanResults(matchedStocks, config.telegramToken, config.telegramChatId);
      logMessage('Telegram alerts sent successfully.');
    } else {
      logMessage('Telegram notification skipped: Telegram Bot Token or Chat ID not configured.');
    }

    return matchedStocks;

  } catch (error) {
    logMessage(`ERROR during scan execution: ${error.message}`);
    
    // Update config status
    config.lastScanTime = new Date().toISOString();
    config.lastScanStatus = 'error';
    config.lastScanHits = 0;
    saveConfig(config);
    
    throw error;
  }
}

// Start the scheduler
function startScheduler() {
  const config = getConfig();

  if (!config.schedulerEnabled) {
    logMessage('Scheduler is disabled in configuration. Skipping cron startup.');
    return false;
  }

  // Stop existing job if running
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }

  // Parse scan time (format: HH:MM)
  const timeParts = (config.scanTime || '18:00').split(':');
  const hour = parseInt(timeParts[0], 10) || 18;
  const minute = parseInt(timeParts[1], 10) || 0;

  // Cron schedule: minute hour * * *
  const cronExpression = `${minute} ${hour} * * *`;

  logMessage(`Starting scheduler. Cron schedule: "${cronExpression}" (Asia/Kolkata timezone) - Runs daily at ${config.scanTime} IST`);

  cronJob = cron.schedule(
    cronExpression,
    async () => {
      logMessage('Background scheduler triggered...');
      try {
        await executeScan(false);
      } catch (err) {
        logMessage(`Background scheduler job failed: ${err.message}`);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    }
  );

  return true;
}

// Stop the scheduler
function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logMessage('Scheduler stopped.');
  }
  return true;
}

// Check status
function getSchedulerStatus() {
  const config = getConfig();
  return {
    running: !!cronJob,
    enabled: config.schedulerEnabled,
    scanTime: config.scanTime,
    lastScanTime: config.lastScanTime,
    lastScanStatus: config.lastScanStatus,
    lastScanHits: config.lastScanHits
  };
}

module.exports = {
  executeScan,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  logMessage
};
