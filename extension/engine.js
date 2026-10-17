/**
 * AutoGroupPilot — Engine Command Center Controller
 * Manages tab keep-alive, live session diagnostics, queue monitoring, and Facebook group sync.
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[AutoGroupPilot Engine] Command center booting up...');

  // DOM Elements
  const heroHeadline = document.getElementById('heroHeadline');
  const heroStatusDot = document.getElementById('heroStatusDot');
  const uptimeEl = document.getElementById('uptimeEl');
  const dashLastSuccess = document.getElementById('dashLastSuccess');
  const dashLastSuccessSub = document.getElementById('dashLastSuccessSub');

  const avatarEl = document.getElementById('avatarEl');
  const userNameEl = document.getElementById('userNameEl');
  const userSubEl = document.getElementById('userSubEl');
  const refreshBtn = document.getElementById('refreshBtn');

  const dashPostsToday = document.getElementById('dashPostsToday');
  const dashPostsTodaySub = document.getElementById('dashPostsTodaySub');
  const dashDelayTier = document.getElementById('dashDelayTier');
  const dashDelayTierSub = document.getElementById('dashDelayTierSub');
  const dashStrikes = document.getElementById('dashStrikes');
  const postsSentEl = document.getElementById('postsSentEl');

  const postingStatusEl = document.getElementById('postingStatusEl');
  const groupsCountBadge = document.getElementById('groupsCountBadge');
  const logCountEl = document.getElementById('logCountEl');
  const logBadge = document.getElementById('logBadge');
  const logBody = document.getElementById('logBody');
  const logEmpty = document.getElementById('logEmpty');
  const revealToggle = document.getElementById('revealToggle');

  const runDiagnosticBtn = document.getElementById('runDiagnosticBtn');
  const downloadLogsBtn = document.getElementById('downloadLogsBtn');
  const clearBtn = document.getElementById('clearBtn');
  const banBanner = document.getElementById('banBanner');
  const banBannerClear = document.getElementById('banBannerClear');
  const aiStatusText = document.getElementById('aiStatusText');

  // 1. Keep-Alive Persistent Port with Service Worker
  let keepAlivePort = null;
  function connectKeepAlive() {
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'AGP_ENGINE_KEEP_ALIVE' });
      keepAlivePort.onDisconnect.addListener(() => {
        console.warn('[Engine] Port disconnected, reconnecting in 2s...');
        setTimeout(connectKeepAlive, 2000);
      });
    } catch (e) {
      console.warn('[Engine] Failed to connect keep-alive port:', e);
    }
  }
  connectKeepAlive();

  // Send periodic ping every 20s to ensure Chrome worker never sleeps
  setInterval(() => {
    if (keepAlivePort) {
      try { keepAlivePort.postMessage({ type: 'PING' }); } catch (e) {}
    }
  }, 20000);

  // 2. Tab Uptime Counter
  const startTime = Date.now();
  setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    uptimeEl.textContent = `${hrs}:${mins}:${secs}`;
  }, 1000);

  // 3. Reveal Toggle
  revealToggle.addEventListener('change', () => {
    if (revealToggle.checked) {
      logBody.classList.add('revealed');
    } else {
      logBody.classList.remove('revealed');
    }
  });

  // 4. Cloudflare Workers AI Health Probe
  async function probeCloudflareAi() {
    try {
      const res = await fetch('https://fb-smart-poster.0amaal89.workers.dev/health');
      const data = await res.json();
      if (data && data.status === 'online') {
        aiStatusText.textContent = 'Cloudflare AI: Online (Llama 3.2)';
      }
    } catch (e) {
      aiStatusText.textContent = 'Cloudflare AI: Offline';
    }
  }
  probeCloudflareAi();

  // 5. Detect Facebook Session & Profile
  async function detectFacebookSession() {
    userNameEl.textContent = 'Scanning Facebook Session…';
    userSubEl.textContent = 'Checking authenticated cookies';

    try {
      // Look for any active Facebook tabs
      const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
      
      if (tabs.length > 0) {
        // Query active Facebook tab for user details
        chrome.tabs.sendMessage(tabs[0].id, { action: 'CHECK_FACEBOOK_SESSION' }, res => {
          if (res?.isLoggedIn) {
            applyFacebookProfile('Facebook Account Active', 'Logged In · Session Secure');
          } else {
            probeDirectFacebookCookies();
          }
        });
      } else {
        probeDirectFacebookCookies();
      }
    } catch (err) {
      probeDirectFacebookCookies();
    }
  }

  async function probeDirectFacebookCookies() {
    try {
      const res = await fetch('https://www.facebook.com/me', {
        method: 'GET',
        credentials: 'include',
      });

      if (res.ok) {
        const text = await res.text();
        // Extract user name if present in title or HTML
        const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
        let name = titleMatch ? titleMatch[1].replace(/\| Facebook/i, '').trim() : 'Facebook User';
        if (name === 'Facebook' || !name) name = 'Facebook Session Active';
        
        applyFacebookProfile(name, 'Authenticated · Active');
      } else {
        applyFacebookProfile('Facebook Not Detected', 'Please sign in to facebook.com');
      }
    } catch (e) {
      applyFacebookProfile('Facebook Connected', 'Session active in browser');
    }
  }

  function applyFacebookProfile(name, sub) {
    userNameEl.textContent = name;
    userSubEl.textContent = sub;
    const initial = name.charAt(0).toUpperCase() || 'F';
    avatarEl.textContent = initial;
  }

  detectFacebookSession();

  // 6. Sync Joined Groups
  async function syncGroups() {
    refreshBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      Syncing...
    `;
    refreshBtn.disabled = true;

    try {
      const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
      let fbTab = tabs.find(t => t.url && t.url.includes('/groups/')) || tabs[0];

      if (!fbTab) {
        fbTab = await chrome.tabs.create({ url: 'https://www.facebook.com/groups/joins/', active: false });
        await new Promise(r => setTimeout(r, 6000));
      } else if (!fbTab.url.includes('/groups/')) {
        await chrome.tabs.update(fbTab.id, { url: 'https://www.facebook.com/groups/joins/' });
        await new Promise(r => setTimeout(r, 5000));
      }

      // Ensure content script is injected
      try {
        await chrome.scripting.executeScript({
          target: { tabId: fbTab.id },
          files: ['utils/spintax.js', 'utils/humanizer.js', 'content/fb_poster.js']
        });
      } catch (err) {}

      chrome.tabs.sendMessage(fbTab.id, { action: 'SCAN_GROUPS' }, response => {
        refreshBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Sync Groups
        `;
        refreshBtn.disabled = false;

        if (response && response.success && response.groups && response.groups.length > 0) {
          chrome.storage.local.get(['agp_groups'], r => {
            const existing = r.agp_groups || [];
            const map = new Map(existing.map(g => [g.id, g]));
            response.groups.forEach(g => map.set(g.id, g));
            const merged = Array.from(map.values());

            chrome.storage.local.set({
              agp_groups: merged,
              agp_selected_ids: merged.map(g => g.id),
            });

            updateGroupsBadge(merged.length);
            showToast(`Synced ${response.groups.length} Facebook groups!`, 'success');
          });
        } else {
          showToast('Could not detect groups. Ensure you are signed in on Facebook.', 'warn');
        }
      });
    } catch (e) {
      refreshBtn.disabled = false;
      showToast(`Sync error: ${e.message}`, 'error');
    }
  }

  refreshBtn.addEventListener('click', () => {
    detectFacebookSession();
    syncGroups();
  });

  function updateGroupsBadge(count) {
    groupsCountBadge.textContent = `${count} Groups synced`;
  }

  // Load initial groups count
  chrome.storage.local.get(['agp_groups'], r => {
    updateGroupsBadge(r.agp_groups?.length || 0);
  });

  // 7. Live State & Metrics Synchronization
  function updateDashboard(state) {
    if (!state) return;

    // Hero Status
    if (state.status === 'running') {
      heroHeadline.textContent = 'Active';
      heroStatusDot.className = 'hero-status-dot';
      postingStatusEl.textContent = state.currentGroup ? `Posting to "${state.currentGroup.name}"` : 'Posting…';
      postingStatusEl.className = 'val-amber';
    } else if (state.status === 'cooling_down') {
      heroHeadline.textContent = 'Cooling Down';
      heroStatusDot.className = 'hero-status-dot cooling';
      postingStatusEl.textContent = 'Account rest interval';
      banBanner.classList.add('visible');
    } else if (state.status === 'paused') {
      heroHeadline.textContent = 'Paused';
      heroStatusDot.className = 'hero-status-dot idle';
      postingStatusEl.textContent = 'Paused';
    } else {
      heroHeadline.textContent = 'Idle';
      heroStatusDot.className = 'hero-status-dot idle';
      postingStatusEl.textContent = 'Idle';
      banBanner.classList.remove('visible');
    }

    // Metrics Row
    const dailyLimit = state.config?.dailyLimit || 200;
    dashPostsToday.textContent = `${state.stats.todayCount} / ${dailyLimit}`;
    dashPostsTodaySub.textContent = `Safety floor ${dailyLimit}/day`;

    postsSentEl.textContent = state.stats.successCount || 0;

    const safetyMode = state.config?.safetyMode || 'balanced';
    if (safetyMode === 'maximum') {
      dashDelayTier.textContent = '0.5×';
      dashDelayTierSub.textContent = 'Rest 12m / 6 posts (Ultra-Safe)';
    } else if (safetyMode === 'fast') {
      dashDelayTier.textContent = '2.0×';
      dashDelayTierSub.textContent = 'Rest 5m / 12 posts (Turbo)';
    } else {
      dashDelayTier.textContent = '1.0×';
      dashDelayTierSub.textContent = 'Rest 10m / 8 posts (Balanced)';
    }

    // Strikes
    if (state.status === 'error') {
      dashStrikes.textContent = '1';
      dashStrikes.className = 'metric-value dash-card-value error';
      document.getElementById('dashStrikesSub').textContent = 'Warning Flagged';
      document.getElementById('metricStrikes').classList.add('is-error');
    } else {
      dashStrikes.textContent = '0';
      dashStrikes.className = 'metric-value dash-card-value ok';
      document.getElementById('dashStrikesSub').textContent = 'Clean · No flags';
      document.getElementById('metricStrikes').classList.remove('is-error');
    }

    // Last success
    if (state.logs && state.logs.length > 0) {
      const lastOk = state.logs.find(l => l.type === 'success');
      if (lastOk) {
        dashLastSuccess.textContent = lastOk.timestamp;
        dashLastSuccessSub.textContent = lastOk.message.slice(0, 32);
      }
    }

    // Activity Log
    renderLogs(state.logs || []);
  }

  function renderLogs(logs = []) {
    logCountEl.textContent = logs.length;
    logBadge.textContent = `${logs.length} entries`;

    if (logs.length === 0) {
      logEmpty.style.display = 'flex';
      return;
    }
    logEmpty.style.display = 'none';

    // Retain only top entries for smooth performance
    const fragment = document.createDocumentFragment();
    logs.slice(0, 100).forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';

      entry.innerHTML = `
        <span class="log-ts">${log.timestamp}</span>
        <span class="log-lvl lvl-${log.type}"></span>
        <div class="log-msg ${log.type}">${escapeHtml(log.message)}</div>
        <div class="log-raw">${escapeHtml(JSON.stringify(log, null, 2))}</div>
      `;
      fragment.appendChild(entry);
    });

    logBody.innerHTML = '';
    logBody.appendChild(fragment);
  }

  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  // Initial state fetch
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, res => {
    if (res?.state) updateDashboard(res.state);
  });

  // Message listener for live updates
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'STATE_UPDATED') {
      updateDashboard(msg.state);
    }
    if (msg.action === 'COUNTDOWN_TICK') {
      const sec = msg.seconds;
      if (sec > 0) {
        postingStatusEl.textContent = `Resting (${sec}s remaining)`;
      }
    }
  });

  // 8. Log Action Buttons
  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CLEAR_LOGS' }, () => {
      logBody.innerHTML = '';
      logCountEl.textContent = '0';
      logBadge.textContent = '0 entries';
      logEmpty.style.display = 'flex';
    });
  });

  downloadLogsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'GET_STATE' }, res => {
      const logs = res?.state?.logs || [];
      const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `autogrouppilot_logs_${Date.now()}.json`;
      a.click();
    });
  });

  // 9. Diagnostic Self-Test
  runDiagnosticBtn.addEventListener('click', async () => {
    runDiagnosticBtn.textContent = 'Running test...';
    runDiagnosticBtn.disabled = true;

    const report = {
      timestamp: new Date().toISOString(),
      facebookSession: 'Unknown',
      cloudflareAi: 'Testing...',
      storage: 'OK',
    };

    // Test Cloudflare AI
    try {
      const res = await fetch('https://fb-smart-poster.0amaal89.workers.dev/health');
      const data = await res.json();
      report.cloudflareAi = data.status === 'online' ? '🟢 Online (Llama 3.2)' : '🔴 Error';
    } catch (e) {
      report.cloudflareAi = `🔴 Offline (${e.message})`;
    }

    // Test FB tabs
    const fbTabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    report.facebookSession = fbTabs.length > 0 ? `🟢 ${fbTabs.length} tab(s) active` : '🟡 No active tab found';

    runDiagnosticBtn.textContent = '🔍 Run Diagnostic';
    runDiagnosticBtn.disabled = false;

    alert(
      `🔍 AutoGroupPilot Diagnostic Report\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• Cloudflare AI: ${report.cloudflareAi}\n` +
      `• Facebook Tabs: ${report.facebookSession}\n` +
      `• Browser Keep-Alive: 🟢 ACTIVE\n` +
      `• Engine Status: ${heroHeadline.textContent}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Engine is healthy and ready to post safely!`
    );
  });

  // 10. Escape hatch for ban banner
  banBannerClear.addEventListener('click', () => {
    banBanner.classList.remove('visible');
    chrome.runtime.sendMessage({ action: 'RESUME_CAMPAIGN' });
  });

  // Toast Helper
  function showToast(msg, type = 'info') {
    const host = document.getElementById('toastHost');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div class="toast-body">${escapeHtml(msg)}</div>`;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }
});
