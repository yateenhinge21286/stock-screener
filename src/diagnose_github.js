const { getConfig } = require('./config');
const { sendMessage } = require('./telegram');
const yahooFinance = require('yahoo-finance2').default;

async function diagnose() {
  const config = getConfig();
  const yahooSymbol = 'APOLLOHOSP.NS';

  try {
    const dailyData = await yahooFinance.historical(yahooSymbol, {
      period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      interval: '1d'
    }, {
      fetchOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    });

    const cleanDaily = dailyData
      .filter(bar => bar.date && typeof bar.close === 'number')
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const last5 = cleanDaily.slice(-5);
    
    let msg = `🧪 **GitHub Actions Diagnostic Log**\n`;
    msg += `Symbol: \`${yahooSymbol}\`\n\n`;
    msg += `Latest 5 Daily Bars from GitHub Runner:\n`;
    last5.forEach(b => {
      msg += `• **${b.date.toISOString().split('T')[0]}**: Close: ₹${b.close.toFixed(2)}, Vol: ${b.volume.toLocaleString()}\n`;
    });
    
    msg += `\nRunner Time: ${new Date().toISOString()}\n`;
    
    console.log(msg);

    if (config.telegramToken && config.telegramChatId) {
      await sendMessage(msg, config.telegramToken, config.telegramChatId);
      console.log('Diagnostic message sent to Telegram.');
    } else {
      console.log('Telegram credentials not configured.');
    }
  } catch (err) {
    console.error('Diagnosis script failed:', err);
    if (config.telegramToken && config.telegramChatId) {
      await sendMessage(`❌ Diagnostic failed: ${err.message}`, config.telegramToken, config.telegramChatId);
    }
  }
}

diagnose();
