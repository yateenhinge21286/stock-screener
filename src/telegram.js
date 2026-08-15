const https = require('https');

// Send raw text message to Telegram Bot API
function sendMessage(text, token, chatId) {
  return new Promise((resolve, reject) => {
    if (!token || !chatId) {
      reject(new Error('Telegram Bot Token or Chat ID is missing. Please configure them.'));
      return;
    }

    const payload = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(responseBody));
        } else {
          reject(new Error(`Telegram API responded with status ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// Formats scanned stock results and sends them to Telegram in chunks if necessary
async function sendStockScanResults(matchedStocks, token, chatId) {
  if (!token || !chatId) {
    console.log('Skipping Telegram notification (Token or Chat ID not configured).');
    return false;
  }

  const dateStr = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const header = `🚀 *Stock Screener Alert (IST)* 🚀\nDate: *${dateStr}*\nMarket: *NSE Cash Segment*\n\n` +
    `*Screening Criteria applied:*\n` +
    `✅ Monthly RSI(14) > 60\n` +
    `✅ Weekly RSI(14) > 60\n` +
    `✅ Daily RSI Crossover (> 40 today, < 40 yesterday)\n\n`;

  let body = '';
  if (matchedStocks.length === 0) {
    body = `ℹ️ *Scan Results:* No stocks matched the screening criteria today.`;
  } else {
    body = `🔥 *Scan Results: Found ${matchedStocks.length} stock(s)*\n\n`;
    matchedStocks.forEach((stock, index) => {
      body += `${index + 1}. *${stock.symbol}* - ₹${stock.close}\n` +
        `   • Daily RSI: *${stock.dailyRsi}* (Yesterday: ${stock.prevDailyRsi})\n` +
        `   • Weekly RSI: *${stock.weeklyRsi}* | Monthly RSI: *${stock.monthlyRsi}*\n` +
        `   • Charts: [TradingView](https://in.tradingview.com/chart/?symbol=NSE:${stock.symbol}) | [Yahoo](https://finance.yahoo.com/quote/${stock.symbol}.NS)\n\n`;
    });
  }

  const fullMessage = header + body;

  // Telegram character limit is 4096. Let's chunk the body if it exceeds the limit.
  if (fullMessage.length <= 4000) {
    await sendMessage(fullMessage, token, chatId);
  } else {
    // Send header first
    await sendMessage(header, token, chatId);

    // Split body by stocks and send in chunks
    let currentChunk = '';
    const stockItems = body.split('\n\n');

    for (const item of stockItems) {
      if (!item.trim()) continue;
      
      if (currentChunk.length + item.length > 3900) {
        await sendMessage(currentChunk, token, chatId);
        currentChunk = '';
      }
      currentChunk += item + '\n\n';
    }

    if (currentChunk.trim().length > 0) {
      await sendMessage(currentChunk, token, chatId);
    }
  }

  return true;
}

module.exports = {
  sendMessage,
  sendStockScanResults
};
