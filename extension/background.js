/**
 * AutoGroupPilot - Background Service Worker
 * Orchestrates multi-group campaign queue, Cloudflare AI spinning, delays, and safety monitoring.
 */

// Load universal utilities via importScripts (Manifest V3 standard)
try {
  importScripts('utils/spintax.js', 'utils/humanizer.js');
} catch (e) {
  console.error('[AutoGroupPilot] Error importing scripts in service worker:', e);
}

const DEFAULT_WORKER_URL = 'https://fb-smart-poster.0amaal89.workers.dev';

// In-memory runtime state (backed by chrome.storage.local)
let state = {
  status: 'idle', // 'idle' | 'running' | 'paused' | 'cooling_down' | 'completed' | 'error'
  queue: [],
  currentIndex: 0,
  currentGroup: null,
  nextPostTime: null,
  countdownSeconds: 0,
  config: {
    postText: '',
    useAiSpin: true,
    aiWorkerUrl: DEFAULT_WORKER_URL,
    aiTone: 'engaging',
    aiStyle: 'moderate',
    autoFirstComment: false,
    firstCommentText: '',
    safetyMode: 'balanced',
    minDelaySec: 45,
    maxDelaySec: 90,
    breakEvery: 8,
    breakDurationMinutes: 10,
    dailyLimit: 30,
  },
  stats: {
    todayCount: 0,
    todayDate: new Date().toISOString().slice(0, 10),
    successCount: 0,
    failCount: 0,
  },
  logs: [],
};

// Load saved state on worker startup
chrome.storage.local.get(['agp_state'], (result) => {
  if (result.agp_state) {
    state = { ...state, ...result.agp_state };
    if (state.status === 'running') state.status = 'paused';
    checkDailyReset();
    saveState();
  }
});

function saveState() {
  chrome.storage.local.set({ agp_state: state });
}

function checkDailyReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.stats.todayDate !== today) {
    state.stats.todayDate = today;
    state.stats.todayCount = 0;
  }
}

function addLog(type, message, details = {}) {
  const logEntry = {
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toLocaleTimeString(),
    type,
    message,
    ...details,
  };
  state.logs.unshift(logEntry);
  if (state.logs.length > 200) state.logs.pop();
  saveState();
  broadcastState();
}

function broadcastState() {
  chrome.runtime.sendMessage({ action: 'STATE_UPDATED', state }).catch(() => {});
  updateBadge();
}

function updateBadge() {
  if (state.status === 'running') {
    const text = `${state.currentIndex + 1}/${state.queue.length}`;
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#1877F2' });
  } else if (state.status === 'paused') {
    chrome.action.setBadgeText({ text: 'PAUSE' });
    chrome.action.setBadgeBackgroundColor({ color: '#EAB308' });
  } else if (state.status === 'cooling_down') {
    chrome.action.setBadgeText({ text: 'COOL' });
    chrome.action.setBadgeBackgroundColor({ color: '#8B5CF6' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Countdown timer loop
setInterval(() => {
  if ((state.status === 'running' || state.status === 'cooling_down') && state.nextPostTime) {
    const rem = Math.max(0, Math.round((state.nextPostTime - Date.now()) / 1000));
    state.countdownSeconds = rem;
    chrome.runtime.sendMessage({ action: 'COUNTDOWN_TICK', seconds: rem }).catch(() => {});
  }
}, 1000);

/**
 * Main Campaign Engine
 */
async function runCampaignLoop() {
  while (state.status === 'running' && state.currentIndex < state.queue.length) {
    checkDailyReset();

    // Check Daily Safety Limit
    if (state.stats.todayCount >= state.config.dailyLimit) {
      state.status = 'paused';
      addLog('warn', `Daily safety limit of ${state.config.dailyLimit} posts reached. Campaign safely paused.`);
      break;
    }

    // Check Cool-Down Break
    const postsDone = state.stats.successCount;
    if (postsDone > 0 && postsDone % state.config.breakEvery === 0) {
      state.status = 'cooling_down';
      const breakMs = state.config.breakDurationMinutes * 60 * 1000;
      state.nextPostTime = Date.now() + breakMs;
      addLog('info', `Cool-down interval: Pausing for ${state.config.breakDurationMinutes} mins to safeguard account reputation.`);
      broadcastState();

      await Humanizer.sleep(breakMs);
      if (state.status !== 'cooling_down') break;
      state.status = 'running';
      addLog('info', 'Cool-down completed. Resuming campaign...');
      broadcastState();
    }

    const group = state.queue[state.currentIndex];
    state.currentGroup = group;
    addLog('info', `Preparing post for group: "${group.name}" (${state.currentIndex + 1}/${state.queue.length})`);
    broadcastState();

    // 1. Prepare unique post text
    let finalPostText = state.config.postText;

    if (state.config.useAiSpin) {
      try {
        addLog('info', `Generating unique variation using Cloudflare Workers AI...`);
        const spinRes = await fetch(`${state.config.aiWorkerUrl || DEFAULT_WORKER_URL}/api/ai/spin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: state.config.postText,
            tone: state.config.aiTone || 'engaging',
            style: state.config.aiStyle || 'moderate',
          }),
        });
        const spinData = await spinRes.json();
        if (spinData.success && spinData.variation) {
          finalPostText = spinData.variation;
          addLog('info', `Cloudflare AI variation generated successfully.`);
        }
      } catch (err) {
        addLog('warn', `AI rewrite failed (${err.message}). Using local Spintax fallback.`);
        finalPostText = SpintaxEngine.parse(state.config.postText);
      }
    } else {
      finalPostText = SpintaxEngine.parse(state.config.postText);
    }

    // Inject group variables
    finalPostText = SpintaxEngine.injectVariables(finalPostText, { group_name: group.name });

    // Prepare first comment
    let finalFirstComment = state.config.autoFirstComment ? state.config.firstCommentText : '';
    if (finalFirstComment) {
      finalFirstComment = SpintaxEngine.parse(finalFirstComment);
    }

    // 2. Open or navigate tab to group URL
    let tab;
    try {
      tab = await createOrFocusGroupTab(group.url);
      await Humanizer.sleep(4500);
    } catch (tabErr) {
      addLog('error', `Could not open group tab: ${tabErr.message}`);
      state.currentIndex++;
      continue;
    }

    // 3. Dispatch post command to content script
    try {
      const safetyConfig = Humanizer.PRESETS[state.config.safetyMode] || Humanizer.PRESETS.balanced;
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'POST_TO_GROUP',
        payload: {
          postText: finalPostText,
          firstComment: finalFirstComment,
          safetyConfig,
        },
      });

      if (response && response.success) {
        state.stats.successCount++;
        state.stats.todayCount++;
        addLog('success', `Successfully posted to "${group.name}"!`, {
          commentPosted: response.commentPosted,
        });
      } else if (response && response.checkpoint) {
        state.status = 'error';
        addLog('error', `CRITICAL: ${response.error}`);
        broadcastState();
        break;
      } else {
        state.stats.failCount++;
        addLog('warn', `Failed to post to "${group.name}": ${response?.error || 'Unknown issue'}`);
      }
    } catch (msgErr) {
      state.stats.failCount++;
      addLog('error', `Communication error with Facebook tab: ${msgErr.message}`);
    }

    state.currentIndex++;
    saveState();
    broadcastState();

    // 4. Calculate delay for next group
    if (state.currentIndex < state.queue.length && state.status === 'running') {
      const minD = parseInt(state.config.minDelaySec, 10) || 45;
      const maxD = parseInt(state.config.maxDelaySec, 10) || 90;
      const delayMs = Humanizer.getJitterDelay(minD, maxD);
      state.nextPostTime = Date.now() + delayMs;
      addLog('info', `Waiting ${Math.round(delayMs / 1000)}s before next group (anti-ban pacing)...`);
      broadcastState();

      await Humanizer.sleep(delayMs);
    }
  }

  if (state.currentIndex >= state.queue.length) {
    state.status = 'completed';
    state.nextPostTime = null;
    addLog('success', `Campaign finished! Total published: ${state.stats.successCount}`);
    broadcastState();
  }
}

async function createOrFocusGroupTab(url) {
  const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { url, active: true });
    return tab;
  }
  return await chrome.tabs.create({ url, active: true });
}

// Runtime Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_STATE') {
    checkDailyReset();
    sendResponse({ state });
    return false;
  }

  if (message.action === 'START_CAMPAIGN') {
    state.queue = message.groups || [];
    state.currentIndex = 0;
    state.config = { ...state.config, ...message.config };
    state.status = 'running';
    saveState();
    broadcastState();
    runCampaignLoop();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'PAUSE_CAMPAIGN') {
    state.status = 'paused';
    state.nextPostTime = null;
    addLog('info', 'Campaign paused by user.');
    saveState();
    broadcastState();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'RESUME_CAMPAIGN') {
    state.status = 'running';
    addLog('info', 'Campaign resumed.');
    saveState();
    broadcastState();
    runCampaignLoop();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'STOP_CAMPAIGN') {
    state.status = 'idle';
    state.currentIndex = 0;
    state.nextPostTime = null;
    addLog('info', 'Campaign stopped.');
    saveState();
    broadcastState();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'CLEAR_LOGS') {
    state.logs = [];
    saveState();
    broadcastState();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'TEST_CLOUDFLARE_AI') {
    fetch(`${message.workerUrl || DEFAULT_WORKER_URL}/health`)
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'SPIN_POST_PREVIEW') {
    fetch(`${state.config.aiWorkerUrl || DEFAULT_WORKER_URL}/api/ai/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message.text,
        tone: message.tone || 'engaging',
        style: message.style || 'moderate',
      }),
    })
      .then(r => r.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
