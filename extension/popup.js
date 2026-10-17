/**
 * AutoGroupPilot - Popup UI Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const statusPill = document.getElementById('statusPill');
  const postTextInput = document.getElementById('postTextInput');
  const spintaxBadge = document.getElementById('spintaxBadge');
  const btnAiSpinPreview = document.getElementById('btnAiSpinPreview');
  const aiSpinPreview = document.getElementById('aiSpinPreview');
  const aiSpinPreviewText = document.getElementById('aiSpinPreviewText');
  const btnApplyAiSpin = document.getElementById('btnApplyAiSpin');
  const autoFirstCommentToggle = document.getElementById('autoFirstCommentToggle');
  const firstCommentGroup = document.getElementById('firstCommentGroup');
  const firstCommentInput = document.getElementById('firstCommentInput');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const btnStartCampaign = document.getElementById('btnStartCampaign');

  // Groups Elements
  const btnSyncFbGroups = document.getElementById('btnSyncFbGroups');
  const groupSearchInput = document.getElementById('groupSearchInput');
  const linkSelectAll = document.getElementById('linkSelectAll');
  const linkDeselectAll = document.getElementById('linkDeselectAll');
  const groupsList = document.getElementById('groupsList');
  const selectedCountBadge = document.getElementById('selectedCountBadge');
  const bundleSelect = document.getElementById('bundleSelect');
  const btnSaveBundle = document.getElementById('btnSaveBundle');

  // Monitor Elements
  const monitorProgressText = document.getElementById('monitorProgressText');
  const progressBar = document.getElementById('progressBar');
  const countdownVal = document.getElementById('countdownVal');
  const statSuccess = document.getElementById('statSuccess');
  const statFailed = document.getElementById('statFailed');
  const statToday = document.getElementById('statToday');
  const btnPauseResume = document.getElementById('btnPauseResume');
  const btnStopCampaign = document.getElementById('btnStopCampaign');
  const logsContainer = document.getElementById('logsContainer');
  const btnClearLogs = document.getElementById('btnClearLogs');

  // Settings Elements
  const workerUrlInput = document.getElementById('workerUrlInput');
  const btnTestWorker = document.getElementById('btnTestWorker');
  const workerTestStatus = document.getElementById('workerTestStatus');
  const aiToneSelect = document.getElementById('aiToneSelect');
  const aiStyleSelect = document.getElementById('aiStyleSelect');
  const dailyLimitInput = document.getElementById('dailyLimitInput');
  const coolDownEveryInput = document.getElementById('coolDownEveryInput');
  const coolDownMinsInput = document.getElementById('coolDownMinsInput');
  const minDelayInput = document.getElementById('minDelayInput');
  const maxDelayInput = document.getElementById('maxDelayInput');
  const btnExportSettings = document.getElementById('btnExportSettings');

  // Local State
  let currentPreset = 'balanced';
  let allGroups = [];
  let selectedGroupIds = new Set();
  let bundles = {};

  // 1. Tab Switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // 2. Preset Selection
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPreset = btn.dataset.preset;
      applyPresetValues(currentPreset);
    });
  });

  function applyPresetValues(preset) {
    if (preset === 'maximum') {
      minDelayInput.value = 90;
      maxDelayInput.value = 210;
      coolDownEveryInput.value = 6;
      coolDownMinsInput.value = 12;
    } else if (preset === 'balanced') {
      minDelayInput.value = 45;
      maxDelayInput.value = 90;
      coolDownEveryInput.value = 8;
      coolDownMinsInput.value = 10;
    } else if (preset === 'fast') {
      minDelayInput.value = 25;
      maxDelayInput.value = 50;
      coolDownEveryInput.value = 12;
      coolDownMinsInput.value = 5;
    }
  }

  // 3. Spintax Variations Calculator
  postTextInput.addEventListener('input', () => {
    const text = postTextInput.value;
    const matches = text.match(/\{([^{}]+)\}/g);
    if (!matches) {
      spintaxBadge.textContent = '0 variations';
      return;
    }
    let variations = 1;
    for (const m of matches) {
      const count = m.slice(1, -1).split('|').length;
      variations *= count;
    }
    spintaxBadge.textContent = `~${variations.toLocaleString()} variations`;
  });

  // 4. Auto First Comment Toggle
  autoFirstCommentToggle.addEventListener('change', () => {
    firstCommentGroup.style.display = autoFirstCommentToggle.checked ? 'block' : 'none';
  });

  // 5. Cloudflare Workers AI Spin Preview
  btnAiSpinPreview.addEventListener('click', async () => {
    const text = postTextInput.value.trim();
    if (!text) {
      alert('Please enter a post message template first.');
      return;
    }

    btnAiSpinPreview.textContent = 'Spinning...';
    btnAiSpinPreview.disabled = true;

    chrome.runtime.sendMessage(
      {
        action: 'SPIN_POST_PREVIEW',
        text,
        tone: aiToneSelect.value,
        style: aiStyleSelect.value,
      },
      response => {
        btnAiSpinPreview.textContent = 'Spin Preview';
        btnAiSpinPreview.disabled = false;

        if (chrome.runtime.lastError) {
          alert('Background service worker reconnecting. Please try again.');
          return;
        }

        if (response && response.success && response.variation) {
          aiSpinPreviewText.textContent = response.variation;
          aiSpinPreview.style.display = 'block';
        } else {
          alert(`AI Spin failed: ${response?.error || 'Could not connect to Worker'}`);
        }
      }
    );
  });

  btnApplyAiSpin.addEventListener('click', () => {
    postTextInput.value = aiSpinPreviewText.textContent;
    aiSpinPreview.style.display = 'none';
    postTextInput.dispatchEvent(new Event('input'));
  });

  // 6. Test Cloudflare Worker Connection
  btnTestWorker.addEventListener('click', () => {
    const workerUrl = workerUrlInput.value.trim();
    workerTestStatus.textContent = 'Pinging Cloudflare Worker...';
    workerTestStatus.style.color = '#94A3B8';

    chrome.runtime.sendMessage(
      { action: 'TEST_CLOUDFLARE_AI', workerUrl },
      response => {
        if (chrome.runtime.lastError) {
          workerTestStatus.textContent = '🔴 Service worker waking up, try again.';
          workerTestStatus.style.color = '#EF4444';
          return;
        }

        if (response && response.success) {
          workerTestStatus.textContent = `🟢 Connected! Model: ${response.data.primaryModel} (${response.data.status})`;
          workerTestStatus.style.color = '#22C55E';
        } else {
          workerTestStatus.textContent = `🔴 Error: ${response?.error || 'Failed to reach Worker'}`;
          workerTestStatus.style.color = '#EF4444';
        }
      }
    );
  });

  // 7. Load Initial Groups & Bundles
  chrome.storage.local.get(['agp_groups', 'agp_bundles', 'agp_selected_ids'], res => {
    allGroups = res.agp_groups || [];
    bundles = res.agp_bundles || {};
    selectedGroupIds = new Set(res.agp_selected_ids || []);
    renderGroupsList();
    renderBundleDropdown();
  });

  // 8. Sync Groups from Facebook
  btnSyncFbGroups.addEventListener('click', async () => {
    btnSyncFbGroups.textContent = 'Scanning Facebook...';
    btnSyncFbGroups.disabled = true;

    try {
      const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
      let fbTab = tabs[0];
      if (!fbTab) {
        fbTab = await chrome.tabs.create({ url: 'https://www.facebook.com/groups/joins/' });
        await new Promise(r => setTimeout(r, 4500));
      }

      chrome.tabs.sendMessage(fbTab.id, { action: 'SCAN_GROUPS' }, response => {
        btnSyncFbGroups.textContent = 'Sync from Facebook';
        btnSyncFbGroups.disabled = false;

        if (chrome.runtime.lastError) {
          alert('Could not connect to Facebook tab. Please refresh your Facebook page and make sure you are logged in.');
          return;
        }

        if (response && response.success && response.groups && response.groups.length > 0) {
          allGroups = response.groups;
          selectedGroupIds = new Set(allGroups.map(g => g.id));
          chrome.storage.local.set({
            agp_groups: allGroups,
            agp_selected_ids: Array.from(selectedGroupIds),
          });
          renderGroupsList();
          alert(`Successfully synced ${allGroups.length} Facebook groups!`);
        } else {
          alert('Could not auto-detect groups. Please open https://www.facebook.com/groups/joins/ in your browser and ensure you are logged in.');
        }
      });
    } catch (e) {
      btnSyncFbGroups.textContent = 'Sync from Facebook';
      btnSyncFbGroups.disabled = false;
      alert(`Error scanning groups: ${e.message}`);
    }
  });

  function renderGroupsList(filterQuery = '') {
    groupsList.innerHTML = '';
    const q = filterQuery.toLowerCase().trim();
    const filtered = allGroups.filter(g => !q || g.name.toLowerCase().includes(q));

    if (filtered.length === 0) {
      groupsList.innerHTML = `
        <div class="empty-state">
          <p>${allGroups.length === 0 ? 'No groups imported yet.' : 'No groups match your filter.'}</p>
          <small>Click "Sync from Facebook" to import your groups!</small>
        </div>`;
      selectedCountBadge.textContent = '0';
      return;
    }

    filtered.forEach(group => {
      const item = document.createElement('div');
      item.className = 'group-item';

      const isChecked = selectedGroupIds.has(group.id);
      item.innerHTML = `
        <input type="checkbox" id="grp-${group.id}" ${isChecked ? 'checked' : ''}>
        <label for="grp-${group.id}" class="group-name" title="${group.name}">${group.name}</label>
      `;

      const checkbox = item.querySelector('input');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedGroupIds.add(group.id);
        } else {
          selectedGroupIds.delete(group.id);
        }
        updateSelectedCount();
        chrome.storage.local.set({ agp_selected_ids: Array.from(selectedGroupIds) });
      });

      groupsList.appendChild(item);
    });

    updateSelectedCount();
  }

  function updateSelectedCount() {
    selectedCountBadge.textContent = selectedGroupIds.size;
  }

  groupSearchInput.addEventListener('input', () => {
    renderGroupsList(groupSearchInput.value);
  });

  linkSelectAll.addEventListener('click', (e) => {
    e.preventDefault();
    allGroups.forEach(g => selectedGroupIds.add(g.id));
    chrome.storage.local.set({ agp_selected_ids: Array.from(selectedGroupIds) });
    renderGroupsList(groupSearchInput.value);
  });

  linkDeselectAll.addEventListener('click', (e) => {
    e.preventDefault();
    selectedGroupIds.clear();
    chrome.storage.local.set({ agp_selected_ids: [] });
    renderGroupsList(groupSearchInput.value);
  });

  // Bundles Management
  btnSaveBundle.addEventListener('click', () => {
    if (selectedGroupIds.size === 0) {
      alert('Select at least one group to save as a bundle.');
      return;
    }
    const name = prompt('Enter a name for this Bundle (e.g., Real Estate, Marketing, Tech):');
    if (name && name.trim()) {
      bundles[name.trim()] = Array.from(selectedGroupIds);
      chrome.storage.local.set({ agp_bundles: bundles });
      renderBundleDropdown();
      bundleSelect.value = name.trim();
    }
  });

  function renderBundleDropdown() {
    bundleSelect.innerHTML = '<option value="all">All Groups</option>';
    Object.keys(bundles).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${name} (${bundles[name].length})`;
      bundleSelect.appendChild(opt);
    });
  }

  bundleSelect.addEventListener('change', () => {
    const val = bundleSelect.value;
    if (val === 'all') {
      selectedGroupIds = new Set(allGroups.map(g => g.id));
    } else if (bundles[val]) {
      selectedGroupIds = new Set(bundles[val]);
    }
    chrome.storage.local.set({ agp_selected_ids: Array.from(selectedGroupIds) });
    renderGroupsList(groupSearchInput.value);
  });

  // 9. Start Campaign
  btnStartCampaign.addEventListener('click', () => {
    const postText = postTextInput.value.trim();
    if (!postText) {
      alert('Please write a post message before starting.');
      return;
    }

    if (selectedGroupIds.size === 0) {
      alert('Please select at least 1 group in the Groups tab.');
      return;
    }

    const selectedGroups = allGroups.filter(g => selectedGroupIds.has(g.id));

    const config = {
      postText,
      useAiSpin: true,
      aiWorkerUrl: workerUrlInput.value.trim(),
      aiTone: aiToneSelect.value,
      aiStyle: aiStyleSelect.value,
      autoFirstComment: autoFirstCommentToggle.checked,
      firstCommentText: firstCommentInput.value.trim(),
      safetyMode: currentPreset,
      minDelaySec: parseInt(minDelayInput.value, 10) || 45,
      maxDelaySec: parseInt(maxDelayInput.value, 10) || 90,
      breakEvery: parseInt(coolDownEveryInput.value, 10) || 8,
      breakDurationMinutes: parseInt(coolDownMinsInput.value, 10) || 10,
      dailyLimit: parseInt(dailyLimitInput.value, 10) || 30,
    };

    chrome.runtime.sendMessage({
      action: 'START_CAMPAIGN',
      groups: selectedGroups,
      config,
    });

    // Switch to Monitor Tab
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="tab-monitor"]').classList.add('active');
    document.getElementById('tab-monitor').classList.add('active');
  });

  // 10. Queue Controls
  btnPauseResume.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'GET_STATE' }, res => {
      if (res?.state?.status === 'running') {
        chrome.runtime.sendMessage({ action: 'PAUSE_CAMPAIGN' });
      } else {
        chrome.runtime.sendMessage({ action: 'RESUME_CAMPAIGN' });
      }
    });
  });

  btnStopCampaign.addEventListener('click', () => {
    if (confirm('Are you sure you want to stop the campaign?')) {
      chrome.runtime.sendMessage({ action: 'STOP_CAMPAIGN' });
    }
  });

  btnClearLogs.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CLEAR_LOGS' });
  });

  // 11. Settings Export
  btnExportSettings.addEventListener('click', () => {
    const exportData = {
      groups: allGroups,
      bundles,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autogrouppilot_groups_${Date.now()}.json`;
    a.click();
  });

  // 12. State Sync & Listener
  function updateUIWithState(state) {
    if (!state) return;

    statusPill.textContent = state.status.toUpperCase();
    statusPill.className = `status-indicator ${state.status}`;

    btnPauseResume.textContent = state.status === 'running' ? 'Pause' : 'Resume';
    btnPauseResume.disabled = state.status === 'idle' || state.status === 'completed';
    btnStopCampaign.disabled = state.status === 'idle';

    const total = state.queue.length;
    const current = state.currentIndex;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    monitorProgressText.textContent = `${current} / ${total} Groups (${pct}%)`;

    statSuccess.textContent = state.stats.successCount;
    statFailed.textContent = state.stats.failCount;
    statToday.textContent = `${state.stats.todayCount} / ${state.config.dailyLimit}`;

    renderLogs(state.logs);
  }

  function renderLogs(logs = []) {
    logsContainer.innerHTML = '';
    logs.slice(0, 50).forEach(log => {
      const entry = document.createElement('div');
      entry.className = `log-entry ${log.type}`;
      entry.innerHTML = `<span class="log-time">[${log.timestamp}]</span> ${escapeHtml(log.message)}`;
      logsContainer.appendChild(entry);
    });
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  // Get initial state
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, res => {
    if (chrome.runtime.lastError) return;
    if (res?.state) {
      updateUIWithState(res.state);
      if (res.state.config?.postText) {
        postTextInput.value = res.state.config.postText;
        postTextInput.dispatchEvent(new Event('input'));
      }
      if (res.state.config?.autoFirstComment) {
        autoFirstCommentToggle.checked = true;
        firstCommentGroup.style.display = 'block';
        firstCommentInput.value = res.state.config.firstCommentText || '';
      }
    }
  });

  // Listen for broadcast updates
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'STATE_UPDATED') {
      updateUIWithState(msg.state);
    }
    if (msg.action === 'COUNTDOWN_TICK') {
      countdownVal.textContent = msg.seconds > 0 ? `${msg.seconds}s` : '--';
    }
  });
});
