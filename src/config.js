const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../config.json');

function getConfig() {
  let config = {
    telegramToken: '',
    telegramChatId: '',
    schedulerEnabled: true,
    scanTime: '18:00',
    minClosePrice: 20,
    minVolume: 50000,
    minHistoryYears: 3,
    lastScanTime: null,
    lastScanStatus: 'never',
    lastScanHits: 0
  };

  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(data);
      config = { ...config, ...parsed };
    }
  } catch (err) {
    console.error('Error reading config file:', err);
  }

  // Support environment variables override (primarily for GitHub Actions execution)
  if (process.env.TELEGRAM_TOKEN) {
    config.telegramToken = process.env.TELEGRAM_TOKEN;
  }
  if (process.env.TELEGRAM_CHAT_ID) {
    config.telegramChatId = process.env.TELEGRAM_CHAT_ID;
  }
  if (process.env.MIN_CLOSE_PRICE) {
    config.minClosePrice = parseFloat(process.env.MIN_CLOSE_PRICE);
  }
  if (process.env.MIN_VOLUME) {
    config.minVolume = parseInt(process.env.MIN_VOLUME, 10);
  }
  if (process.env.MIN_HISTORY_YEARS) {
    config.minHistoryYears = parseFloat(process.env.MIN_HISTORY_YEARS);
  }

  return config;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing config file:', err);
    return false;
  }
}

module.exports = {
  getConfig,
  saveConfig
};
