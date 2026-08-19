// App state
let state = {
  matchedStocks: [],
  filteredStocks: [],
  sortColumn: 'symbol',
  sortAscending: true,
  scanPollingInterval: null,
  logsPollingInterval: null
};

// DOM Elements
const el = {
  istTime: document.getElementById('ist-time'),
  lastScanSummary: document.getElementById('last-scan-summary'),
  lastScanTime: document.getElementById('last-scan-time'),
  schedTimeDisplay: document.getElementById('sched-time-display'),
  schedStatusLabel: document.getElementById('sched-status-label'),
  totalStocksCount: document.getElementById('total-stocks-count'),
  
  telegramForm: document.getElementById('telegram-settings-form'),
  telegramToken: document.getElementById('telegram-token'),
  telegramChatId: document.getElementById('telegram-chatid'),
  toggleTokenVisibility: document.getElementById('toggle-token-visibility'),
  schedulerToggle: document.getElementById('scheduler-enabled-toggle'),
  schedulerTimeInput: document.getElementById('scheduler-time-input'),
  minClosePrice: document.getElementById('min-close-price'),
  minVolume: document.getElementById('min-volume'),
  minHistoryYears: document.getElementById('min-history-years'),
  testTelegramBtn: document.getElementById('test-telegram-btn'),
  updateNiftyBtn: document.getElementById('update-nifty-btn'),
  
  upstoxApiKey: document.getElementById('upstox-api-key'),
  upstoxApiSecret: document.getElementById('upstox-api-secret'),
  upstoxStatusLabel: document.getElementById('upstox-status-label'),
  upstoxSaveKeysBtn: document.getElementById('upstox-save-keys-btn'),
  upstoxConnectBtn: document.getElementById('upstox-connect-btn'),
  upstoxDisconnectBtn: document.getElementById('upstox-disconnect-btn'),
  
  triggerScanBtn: document.getElementById('trigger-scan-btn'),
  progressContainer: document.getElementById('progress-container'),
  progressCurrentSymbol: document.getElementById('progress-current-symbol'),
  progressPercentage: document.getElementById('progress-percentage'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  progressCounts: document.getElementById('progress-counts'),
  progressStatusMsg: document.getElementById('progress-status-msg'),
  
  searchResultsInput: document.getElementById('search-results-input'),
  resultsCountBadge: document.getElementById('results-count-badge'),
  resultsTableBody: document.getElementById('results-table-body'),
  sortableHeaders: document.querySelectorAll('th.sortable'),
  
  logsConsoleBody: document.getElementById('logs-console-body'),
  clearLogsBtn: document.getElementById('clear-logs-btn'),
  
  runBacktestBtn: document.getElementById('run-backtest-btn'),
  backtestStatusContainer: document.getElementById('backtest-status-container'),
  backtestStatusMsg: document.getElementById('backtest-status-msg'),
  backtestTableBody: document.getElementById('backtest-table-body')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  // Replace Lucide icons
  lucide.createIcons();
  
  // Set up live clock
  startLiveClock();
  
  // Fetch initial data
  refreshStatus();
  refreshResults();
  refreshLogs();
  refreshBacktestResults();
  
  // Set up event listeners
  setupEventListeners();
  
  // Poll logs every 5 seconds
  state.logsPollingInterval = setInterval(refreshLogs, 5000);
});

// Live clock (IST timezone)
function startLiveClock() {
  const updateClock = () => {
    const options = {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    el.istTime.textContent = new Date().toLocaleTimeString('en-US', options);
  };
  updateClock();
  setInterval(updateClock, 1000);
}

// Event Listeners setup
function setupEventListeners() {
  // Telegram Bot Token Visibility Toggle
  el.toggleTokenVisibility.addEventListener('click', () => {
    const isPassword = el.telegramToken.type === 'password';
    el.telegramToken.type = isPassword ? 'text' : 'password';
    const icon = el.toggleTokenVisibility.querySelector('i');
    icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    lucide.createIcons();
  });

  // Save Upstox API keys
  el.upstoxSaveKeysBtn.addEventListener('click', async () => {
    const payload = {
      telegramToken: el.telegramToken.value,
      telegramChatId: el.telegramChatId.value,
      schedulerEnabled: el.schedulerToggle.checked,
      scanTime: el.schedulerTimeInput.value,
      minClosePrice: parseFloat(el.minClosePrice.value),
      minVolume: parseInt(el.minVolume.value, 10),
      minHistoryYears: parseFloat(el.minHistoryYears.value),
      upstoxApiKey: el.upstoxApiKey.value,
      upstoxApiSecret: el.upstoxApiSecret.value
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showConsoleNotification('Upstox API keys saved successfully.', 'success');
        refreshStatus();
      } else {
        showConsoleNotification(`Save failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showConsoleNotification(`Failed to save Upstox keys: ${err.message}`, 'error');
    }
  });

  // Connect to Upstox (OAuth Redirect)
  el.upstoxConnectBtn.addEventListener('click', () => {
    window.location.href = '/api/upstox/login';
  });

  // Disconnect from Upstox
  el.upstoxDisconnectBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to disconnect Upstox Integration?')) return;
    try {
      const res = await fetch('/api/upstox/disconnect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showConsoleNotification('Upstox disconnected successfully.', 'success');
        refreshStatus();
      } else {
        showConsoleNotification(`Disconnect failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showConsoleNotification(`Failed to disconnect: ${err.message}`, 'error');
    }
  });

  // Settings form submission
  el.telegramForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      telegramToken: el.telegramToken.value,
      telegramChatId: el.telegramChatId.value,
      schedulerEnabled: el.schedulerToggle.checked,
      scanTime: el.schedulerTimeInput.value,
      minClosePrice: parseFloat(el.minClosePrice.value),
      minVolume: parseInt(el.minVolume.value, 10),
      minHistoryYears: parseFloat(el.minHistoryYears.value)
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showConsoleNotification('Settings saved successfully.', 'success');
        refreshStatus();
      } else {
        showConsoleNotification(`Save failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showConsoleNotification(`Failed to save settings: ${err.message}`, 'error');
    }
  });

  // Test Telegram button click
  el.testTelegramBtn.addEventListener('click', async () => {
    const originalText = el.testTelegramBtn.innerHTML;
    el.testTelegramBtn.disabled = true;
    el.testTelegramBtn.innerHTML = '<i data-lucide="loader-2" class="btn-icon animate-spin"></i> Sending...';
    lucide.createIcons();

    const payload = {
      telegramToken: el.telegramToken.value,
      telegramChatId: el.telegramChatId.value
    };

    try {
      const res = await fetch('/api/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showConsoleNotification('Telegram connection test passed. Check your chat!', 'success');
      } else {
        showConsoleNotification(`Telegram test failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showConsoleNotification(`Connection failed: ${err.message}`, 'error');
    } finally {
      el.testTelegramBtn.disabled = false;
      el.testTelegramBtn.innerHTML = originalText;
      lucide.createIcons();
    }
  });

  // Update Nifty stock list button
  el.updateNiftyBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to download the latest Nifty 500 stock symbols? This will fetch CSV archives from the official NSE India website.')) return;
    
    const originalText = el.updateNiftyBtn.innerHTML;
    el.updateNiftyBtn.disabled = true;
    el.updateNiftyBtn.innerHTML = '<i data-lucide="loader-2" class="btn-icon animate-spin"></i> Loading...';
    lucide.createIcons();

    try {
      const res = await fetch('/api/fetch-nifty500', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showConsoleNotification(`Updated stock database successfully: Loaded ${data.count} tickers.`, 'success');
        refreshStatus();
      } else {
        showConsoleNotification(`Database update failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showConsoleNotification(`Error contacting server: ${err.message}`, 'error');
    } finally {
      el.updateNiftyBtn.disabled = false;
      el.updateNiftyBtn.innerHTML = originalText;
      lucide.createIcons();
    }
  });

  // Trigger manual scan button
  el.triggerScanBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showConsoleNotification('Screener scan started. Live updates in progress panel...', 'success');
        startScanPolling();
      } else {
        showConsoleNotification(`Scan rejected: ${data.error}`, 'error');
      }
    } catch (err) {
      showConsoleNotification(`Error initiating scan: ${err.message}`, 'error');
    }
  });

  // Results search input
  el.searchResultsInput.addEventListener('input', () => {
    filterAndRenderTable();
  });

  // Table header sorting
  el.sortableHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const column = header.getAttribute('data-sort');
      if (state.sortColumn === column) {
        state.sortAscending = !state.sortAscending;
      } else {
        state.sortColumn = column;
        state.sortAscending = true;
      }
      
      // Update header sort icons
      el.sortableHeaders.forEach(h => {
        const icon = h.querySelector('.sort-icon');
        icon.className = 'sort-icon';
      });
      const currentIcon = header.querySelector('.sort-icon');
      currentIcon.className = state.sortAscending ? 'sort-icon text-cyan' : 'sort-icon text-cyan';
      
      sortAndRenderTable();
    });
  });

  // Clear logs button
  el.clearLogsBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logs/clear', { method: 'POST' });
      refreshLogs();
    } catch (err) {
      console.error(err);
    }
  });

  // Run backtest audit button
  el.runBacktestBtn.addEventListener('click', async () => {
    if (!confirm('Run historical backtest audit for all 2126 stocks? This runs a 12-month backtest in the background and may take about 60 seconds.')) return;
    
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: 12 })
      });
      const data = await res.json();
      if (data.success) {
        showConsoleNotification('Historical backtest audit initiated...', 'success');
        startBacktestPolling();
      } else {
        showConsoleNotification(`Backtest rejected: ${data.error}`, 'error');
      }
    } catch (err) {
      showConsoleNotification(`Failed to initiate backtest: ${err.message}`, 'error');
    }
  });
}

// Fetch and load configuration & scheduler status
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    // Populate inputs
    el.telegramToken.value = data.config.telegramToken;
    el.telegramChatId.value = data.config.telegramChatId;
    el.schedulerToggle.checked = data.config.schedulerEnabled;
    el.schedulerTimeInput.value = data.config.scanTime;
    el.minClosePrice.value = data.config.minClosePrice !== undefined ? data.config.minClosePrice : 20;
    el.minVolume.value = data.config.minVolume !== undefined ? data.config.minVolume : 50000;
    el.minHistoryYears.value = data.config.minHistoryYears !== undefined ? data.config.minHistoryYears : 3;
    
    // Upstox settings binding
    el.upstoxApiKey.value = data.config.upstoxApiKey || '';
    el.upstoxApiSecret.value = data.config.upstoxApiSecret || '';
    
    const hasKeys = !!data.config.upstoxApiKey && !!data.config.upstoxApiSecret;
    const hasToken = !!data.config.upstoxAccessToken;
    
    if (hasToken) {
      el.upstoxStatusLabel.innerHTML = `<span style="color: var(--accent-green)">● Connected</span>`;
      el.upstoxConnectBtn.style.display = 'none';
      el.upstoxDisconnectBtn.style.display = 'inline-flex';
    } else {
      el.upstoxStatusLabel.innerHTML = `<span style="color: var(--text-dark)">● Disconnected</span>`;
      el.upstoxConnectBtn.style.display = 'inline-flex';
      el.upstoxDisconnectBtn.style.display = 'none';
      el.upstoxConnectBtn.disabled = !hasKeys;
    }

    // Overview cards metrics
    el.schedTimeDisplay.textContent = `${data.config.scanTime || '18:00'} IST`;
    if (data.stockCount !== undefined) {
      el.totalStocksCount.textContent = `${data.stockCount} Stocks`;
    }
    
    // Scheduler status badge/message
    const isSchedRunning = data.scheduler.running;
    if (data.config.schedulerEnabled) {
      el.schedStatusLabel.innerHTML = `<span style="color: var(--accent-green)">● Running (${isSchedRunning ? 'Active' : 'Standby'})</span>`;
    } else {
      el.schedStatusLabel.innerHTML = `<span style="color: var(--text-dark)">● Disabled</span>`;
    }

    // Last scan indicators
    const lastScanTime = data.scheduler.lastScanTime;
    const lastScanHits = data.scheduler.lastScanHits;
    const lastScanStatus = data.scheduler.lastScanStatus;

    if (lastScanTime) {
      el.lastScanSummary.textContent = `${lastScanHits} Stock${lastScanHits !== 1 ? 's' : ''}`;
      
      const lastScanDate = new Date(lastScanTime);
      const timeStr = lastScanDate.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
      const dateStr = lastScanDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
      
      let statusHtml = `Scanned at ${dateStr} ${timeStr}`;
      if (lastScanStatus === 'error') {
        statusHtml += ` <span style="color: var(--accent-red)">(Failed)</span>`;
      }
      el.lastScanTime.innerHTML = statusHtml;
    } else {
      el.lastScanSummary.textContent = '0 Stocks';
      el.lastScanTime.textContent = 'Never Scanned';
    }

    // Active checking if scan is running in background (e.g. if page reloads during run)
    if (data.scanState.active && !state.scanPollingInterval) {
      showConsoleNotification('Detected active scan in progress. Linking monitor...', 'warn');
      startScanPolling();
    }
  } catch (err) {
    console.error('Error fetching system status:', err);
  }
}

// Fetch and load last scan results
async function refreshResults() {
  try {
    const res = await fetch('/api/results');
    const data = await res.json();
    state.matchedStocks = data.matchedStocks || [];
    filterAndRenderTable();
  } catch (err) {
    console.error('Error fetching results:', err);
  }
}

// Fetch and load server logs
async function refreshLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    
    // Clear and build console lines
    el.logsConsoleBody.innerHTML = '';
    
    if (data.logs && data.logs.length > 0) {
      data.logs.forEach(line => {
        if (!line.trim()) return;
        const lineEl = document.createElement('div');
        lineEl.className = 'log-line';
        
        // Highlight formatting classes
        if (line.includes('ERROR') || line.includes('Failed')) {
          lineEl.classList.add('error');
        } else if (line.includes('complete') || line.includes('Success') || line.includes('successfully') || line.includes('passed')) {
          lineEl.classList.add('success');
        } else if (line.includes('Starting') || line.includes('Updating') || line.includes('Scheduler is disabled')) {
          lineEl.classList.add('warn');
        }
        
        lineEl.textContent = line;
        el.logsConsoleBody.appendChild(lineEl);
      });
    } else {
      el.logsConsoleBody.innerHTML = '<div class="log-line text-dark">[System] Empty logs. Ready.</div>';
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

// Add system helper output to logs panel
function showConsoleNotification(text, type = 'info') {
  const lineEl = document.createElement('div');
  lineEl.className = `log-line ${type}`;
  const timestamp = new Date().toLocaleTimeString('en-IN', { hour12: false });
  lineEl.textContent = `[UI Client ${timestamp}] ${text}`;
  
  if (el.logsConsoleBody.firstChild) {
    el.logsConsoleBody.insertBefore(lineEl, el.logsConsoleBody.firstChild);
  } else {
    el.logsConsoleBody.appendChild(lineEl);
  }
}

// Start polling for scan progress
function startScanPolling() {
  el.progressContainer.classList.remove('hidden');
  el.triggerScanBtn.disabled = true;
  el.triggerScanBtn.innerHTML = '<i data-lucide="loader-2" class="btn-icon animate-spin"></i> Scan Running...';
  lucide.createIcons();

  if (state.scanPollingInterval) clearInterval(state.scanPollingInterval);

  state.scanPollingInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/scan-status');
      const progress = await res.json();

      if (!progress.active) {
        // Scan finished
        clearInterval(state.scanPollingInterval);
        state.scanPollingInterval = null;

        el.progressContainer.classList.add('hidden');
        el.triggerScanBtn.disabled = false;
        el.triggerScanBtn.innerHTML = '<i data-lucide="play" class="btn-icon"></i> Start Technical Scan';
        lucide.createIcons();

        showConsoleNotification('Stock scanning sequence finished.', 'success');
        
        // Refresh everything
        refreshStatus();
        refreshResults();
        refreshLogs();
      } else {
        // Update progress UI
        const current = progress.current || 0;
        const total = progress.total || 500;
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        
        el.progressCurrentSymbol.textContent = progress.symbol || 'PREPARING';
        el.progressPercentage.textContent = `${percent}%`;
        el.progressBarFill.style.width = `${percent}%`;
        el.progressCounts.textContent = `${current} / ${total} stocks processed`;
        
        if (progress.error) {
          el.progressStatusMsg.textContent = `Error: ${progress.error}`;
          el.progressStatusMsg.style.color = 'var(--accent-red)';
        } else {
          el.progressStatusMsg.textContent = progress.message || 'Processing historical data...';
          el.progressStatusMsg.style.color = 'var(--text-muted)';
        }
      }
    } catch (err) {
      console.error('Error polling scan progress:', err);
    }
  }, 500);
}

// Table logic: filter stocks on search queries
function filterAndRenderTable() {
  const query = el.searchResultsInput.value.toLowerCase().trim();
  
  if (!query) {
    state.filteredStocks = [...state.matchedStocks];
  } else {
    state.filteredStocks = state.matchedStocks.filter(stock => 
      stock.symbol.toLowerCase().includes(query) || 
      stock.name.toLowerCase().includes(query)
    );
  }
  
  el.resultsCountBadge.textContent = `${state.filteredStocks.length} Match${state.filteredStocks.length !== 1 ? 'es' : ''}`;
  sortAndRenderTable();
}

// Table logic: Sort results on column headers
function sortAndRenderTable() {
  const col = state.sortColumn;
  const asc = state.sortAscending;

  state.filteredStocks.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];

    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    if (typeof valA === 'string') {
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      return asc ? valA - valB : valB - valA;
    }
  });

  renderTableBody();
}

// Render dynamic stock data inside table body
function renderTableBody() {
  el.resultsTableBody.innerHTML = '';

  if (state.filteredStocks.length === 0) {
    el.resultsTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-table-msg">
          <i data-lucide="line-chart" class="empty-icon"></i>
          <p>${state.matchedStocks.length === 0 ? 'No stocks matched the criteria today.' : 'No stocks matched your search search query.'}</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  state.filteredStocks.forEach(stock => {
    const tr = document.createElement('tr');
    
    // Style RSI values dynamically
    const getRsiClass = (val) => {
      if (val === null || val === undefined) return 'rsi-mid';
      if (val > 60) return 'rsi-high';
      if (val < 40) return 'rsi-low';
      return 'rsi-mid';
    };

    tr.innerHTML = `
      <td class="td-symbol">${stock.symbol}</td>
      <td class="td-name">${stock.name}</td>
      <td class="td-price">₹${stock.close}</td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(stock.dailyRsi)}">${stock.dailyRsi !== null ? stock.dailyRsi : '--'}</span></td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(stock.prevDailyRsi)}">${stock.prevDailyRsi !== null ? stock.prevDailyRsi : '--'}</span></td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(stock.weeklyRsi)}">${stock.weeklyRsi !== null ? stock.weeklyRsi : '--'}</span></td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(stock.monthlyRsi)}">${stock.monthlyRsi !== null ? stock.monthlyRsi : '--'}</span></td>
      <td>
        <div class="td-actions">
          <a href="https://in.tradingview.com/chart/?symbol=NSE:${stock.symbol}" target="_blank" class="link-btn">
            <i data-lucide="external-link" style="width:11px;height:11px"></i> TradingView
          </a>
          <a href="https://finance.yahoo.com/quote/${stock.symbol}.NS" target="_blank" class="link-btn">
            <i data-lucide="external-link" style="width:11px;height:11px"></i> Yahoo
          </a>
        </div>
      </td>
    `;
    el.resultsTableBody.appendChild(tr);
  });
  
  lucide.createIcons();
}

// Fetch and render historical backtest results
async function refreshBacktestResults() {
  try {
    const res = await fetch('/api/backtest');
    const data = await res.json();
    renderBacktestTable(data.matches || []);
  } catch (err) {
    console.error('Error fetching backtest results:', err);
  }
}

// Render backtest records in UI table
function renderBacktestTable(matches) {
  el.backtestTableBody.innerHTML = '';

  if (!matches || matches.length === 0) {
    el.backtestTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-table-msg">
          <i data-lucide="clock" class="empty-icon"></i>
          <p>No historical backtest data loaded. Click 'Run Backtest Audit' to scan the past 12 months for crossover occurrences.</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  matches.forEach(match => {
    const tr = document.createElement('tr');
    
    const getRsiClass = (val) => {
      if (val === null || val === undefined) return 'rsi-mid';
      if (val > 60) return 'rsi-high';
      if (val < 40) return 'rsi-low';
      return 'rsi-mid';
    };

    tr.innerHTML = `
      <td class="td-symbol">${match.symbol}</td>
      <td class="td-name">${match.name}</td>
      <td style="font-weight: 500; color: #a855f7">${match.date}</td>
      <td class="td-price">₹${match.close}</td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(match.dailyRsi)}">${match.dailyRsi}</span></td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(match.prevDailyRsi)}">${match.prevDailyRsi}</span></td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(match.weeklyRsi)}">${match.weeklyRsi}</span></td>
      <td class="td-rsi"><span class="rsi-tag ${getRsiClass(match.monthlyRsi)}">${match.monthlyRsi}</span></td>
    `;
    el.backtestTableBody.appendChild(tr);
  });

  lucide.createIcons();
}

// Poll backtest execution progress
function startBacktestPolling() {
  el.backtestStatusContainer.classList.remove('hidden');
  el.runBacktestBtn.disabled = true;
  el.runBacktestBtn.innerHTML = '<i data-lucide="loader-2" class="btn-icon animate-spin"></i> Audit Running...';
  lucide.createIcons();

  let backtestInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/backtest/status');
      const status = await res.json();

      if (!status.active) {
        clearInterval(backtestInterval);
        el.backtestStatusContainer.classList.add('hidden');
        el.runBacktestBtn.disabled = false;
        el.runBacktestBtn.innerHTML = '<i data-lucide="play" class="btn-icon"></i> Run Backtest Audit';
        lucide.createIcons();
        
        showConsoleNotification('Historical backtest audit completed.', 'success');
        refreshBacktestResults();
        refreshLogs();
      } else {
        el.backtestStatusMsg.textContent = status.message || 'Scanning historical database...';
      }
    } catch (err) {
      console.error('Error polling backtest status:', err);
    }
  }, 1000);
}
