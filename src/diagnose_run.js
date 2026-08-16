const { runScan } = require('./screener');
const { getConfig } = require('./config');
const { sendMessage } = require('./telegram');

async function runDiagnosticScan() {
  const config = getConfig();
  const skippedStocks = {};
  const matchedList = [];

  console.log('Starting diagnostic scan on GitHub Action...');

  try {
    const results = await runScan((progress) => {
      // Collect errors or filtering reasons
      if (progress.status === 'error') {
        skippedStocks[progress.symbol] = progress.message;
      }
      if (progress.status === 'success' && progress.matched) {
        matchedList.push(progress.symbol);
      }
      // Log progress every 100 stocks
      if (progress.current % 100 === 0 || progress.current === progress.total) {
        console.log(`Scan Progress: ${progress.current}/${progress.total} (${Math.round((progress.current/progress.total)*100)}%)`);
      }
    });

    console.log(`Diagnostic scan complete. Found ${results.length} matched stocks:`, matchedList);

    // Prepare a Telegram debug report focusing on the missing stocks
    let msg = `🧪 **GitHub Actions Scan Diagnostic**\n\n`;
    msg += `✅ **Matches found on GitHub (${results.length})**:\n`;
    if (results.length > 0) {
      results.forEach((r, idx) => {
        msg += `${idx + 1}. \`${r.symbol}\` (Price: ₹${r.close}, Vol: ${r.volume ? r.volume.toLocaleString() : 'N/A'})\n`;
      });
    } else {
      msg += `None\n`;
    }

    msg += `\n🔍 **Status of expected stocks on GitHub**:\n`;
    const targetSymbols = ['APOLLOHOSP', 'ONELIFECAP', 'ADANIENSOL', 'CEMPRO'];
    targetSymbols.forEach(sym => {
      if (matchedList.includes(sym)) {
        msg += `• \`${sym}\`: MATCHED ✅\n`;
      } else if (skippedStocks[sym]) {
        msg += `• \`${sym}\`: SKIPPED ❌\nReason: _${skippedStocks[sym]}_\n`;
      } else {
        msg += `• \`${sym}\`: Unknown (Not processed or missing from database)\n`;
      }
    });

    msg += `\nRunner Time: ${new Date().toISOString()}\n`;

    if (config.telegramToken && config.telegramChatId) {
      await sendMessage(msg, config.telegramToken, config.telegramChatId);
      console.log('Diagnostic report sent to Telegram.');
    }

  } catch (err) {
    console.error('Diagnostic scan execution failed:', err);
    if (config.telegramToken && config.telegramChatId) {
      await sendMessage(`❌ Diagnostic scan failed: ${err.message}`, config.telegramToken, config.telegramChatId);
    }
  }
}

runDiagnosticScan();
