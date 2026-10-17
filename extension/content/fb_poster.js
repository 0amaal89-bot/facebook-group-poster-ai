/**
 * AutoGroupPilot - Content Script (Facebook Automation & In-Feed Injector)
 * Runs safely within the user's authentic browser context.
 */

(() => {
  if (window.__AGP_LOADED__) return;
  window.__AGP_LOADED__ = true;

  console.log('[AutoGroupPilot] Content script & In-Feed Share Injector active.');

  let allUserGroups = [];
  let userBundles = {};
  let currentModalPostUrl = '';
  let activeModalPreset = 'balanced';
  let modalSelectedIds = new Set();

  // Load saved groups on load
  chrome.storage.local.get(['agp_groups', 'agp_bundles'], res => {
    allUserGroups = res.agp_groups || [];
    userBundles = res.agp_bundles || {};
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.agp_groups) allUserGroups = changes.agp_groups.newValue || [];
      if (changes.agp_bundles) userBundles = changes.agp_bundles.newValue || {};
    }
  });

  // -------------------------------------------------------------------------
  // 1. IN-FEED "SHARE TO GROUPS" BUTTON INJECTOR
  // -------------------------------------------------------------------------
  const SHARE_ICON_SVG = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zm-9 9h7v7H4v-7zm9 0h7v7h-7v-7z"/>
    </svg>
  `;

  let injectionDebounce = null;

  // Multi-lingual keywords for detecting Facebook action bar elements
  const ACTION_KEYWORDS = [
    'share', 'partager', 'مشاركة', 'compartir', 'condividi', 'teilen', 'delen',
    'comment', 'commenter', 'تعليق', 'comentar', 'commenta', 'kommentieren',
    'like', 'react', 'j’aime', 'أعجبني', 'تفاعل', 'me gusta', 'mi piace', 'gefällt mir'
  ];

  function scanAndInjectShareButtons() {
    try {
      // Strategy 1: Find all interactive action buttons in posts/videos
      const clickableCandidates = document.querySelectorAll(
        'div[role="button"], span[role="button"], a[role="button"], div[aria-label], span[aria-label]'
      );

      clickableCandidates.forEach(el => {
        const label = (el.getAttribute('aria-label') || el.innerText || '').toLowerCase().trim();
        if (!label) return;

        // Check if this is a Share or Comment button
        const isShareOrComment = ACTION_KEYWORDS.some(k => label.includes(k));
        if (!isShareOrComment) return;

        // Find the parent action bar container (the flex row containing these buttons)
        const row = findActionBarRow(el);
        if (!row) return;

        // If button is already injected in this row, skip
        if (row.querySelector('.agp-share-btn-wrapper')) return;

        // Create and inject button
        const btnWrapper = createShareButtonWrapper(row);
        
        // Prefer placing right after the Share button, or append to row
        const shareBtn = findShareButtonInRow(row);
        if (shareBtn && shareBtn.parentNode === row) {
          row.insertBefore(btnWrapper, shareBtn.nextSibling);
        } else {
          row.appendChild(btnWrapper);
        }
      });
    } catch (err) {
      console.warn('[AutoGroupPilot] Error during button injection scan:', err);
    }
  }

  function findActionBarRow(btnElement) {
    let curr = btnElement;
    for (let i = 0; i < 5; i++) {
      if (!curr || !curr.parentElement) break;
      curr = curr.parentElement;

      // Check if this container has multiple buttons (typical of FB action bar)
      const buttons = curr.querySelectorAll('div[role="button"], span[role="button"], div[tabindex="0"]');
      if (buttons.length >= 2) {
        // Confirm it's a horizontal flex/grid row
        const style = window.getComputedStyle(curr);
        if (style.display === 'flex' || style.display === 'inline-flex' || style.display === 'grid' || style.flexDirection === 'row') {
          return curr;
        }
      }
    }
    return null;
  }

  function findShareButtonInRow(row) {
    const candidates = row.querySelectorAll('div[role="button"], span, a');
    for (const c of candidates) {
      const text = (c.getAttribute('aria-label') || c.innerText || '').toLowerCase();
      if (text.includes('share') || text.includes('partager') || text.includes('مشاركة') || text.includes('compartir')) {
        return c.closest('div[role="button"]') || c;
      }
    }
    return null;
  }

  function createShareButtonWrapper(parentRow) {
    const btnWrapper = document.createElement('div');
    btnWrapper.className = 'agp-share-btn-wrapper';
    btnWrapper.innerHTML = `
      <button type="button" class="agp-share-to-groups-btn" title="Share this post to multiple Facebook groups">
        ${SHARE_ICON_SVG}
        <span>Share to groups</span>
      </button>
    `;

    const btn = btnWrapper.querySelector('.agp-share-to-groups-btn');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openShareModal(parentRow);
    });

    return btnWrapper;
  }

  // Setup DOM Mutation Observer
  const observer = new MutationObserver(() => {
    if (injectionDebounce) clearTimeout(injectionDebounce);
    injectionDebounce = setTimeout(scanAndInjectShareButtons, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(scanAndInjectShareButtons, 1000);
  setInterval(scanAndInjectShareButtons, 3000); // Periodic fallback for dynamic feeds

  // -------------------------------------------------------------------------
  // 2. IN-FEED SHARING MODAL DIALOG
  // -------------------------------------------------------------------------
  function extractPostDetails(actionRow) {
    let postUrl = window.location.href;
    let postText = '';

    // Climb up to the full post container
    let postContainer = actionRow.closest('div[role="article"]') ||
                        actionRow.closest('div[data-pagelet*="FeedUnit"]') ||
                        actionRow.closest('div[data-virtualized="false"]') ||
                        actionRow.closest('div[role="main"]') ||
                        actionRow.parentElement?.parentElement;

    if (postContainer) {
      // 1. Look for post permalink / video link
      const links = postContainer.querySelectorAll('a[href]');
      for (const a of links) {
        const href = a.href;
        if (
          href.includes('/posts/') ||
          href.includes('/permalink/') ||
          href.includes('/videos/') ||
          href.includes('/watch/') ||
          href.includes('/reel/') ||
          href.includes('story_fbid=') ||
          href.includes('fbid=')
        ) {
          try {
            const u = new URL(href);
            postUrl = `${u.origin}${u.pathname}`;
            if (u.searchParams.has('v')) postUrl += `?v=${u.searchParams.get('v')}`;
            if (u.searchParams.has('story_fbid')) {
              postUrl += `?story_fbid=${u.searchParams.get('story_fbid')}&id=${u.searchParams.get('id')}`;
            }
          } catch (e) {
            postUrl = href.split('?')[0];
          }
          break;
        }
      }

      // 2. Extract caption text
      const textContainers = postContainer.querySelectorAll('div[data-ad-preview="message"], div[dir="auto"]');
      for (const tc of textContainers) {
        const content = tc.innerText.trim();
        if (content.length > 20 && !content.includes('Share') && !content.includes('Like')) {
          postText = content;
          break;
        }
      }
    }

    return { postUrl, postText };
  }

  function ensureModalInDom() {
    let overlay = document.getElementById('agp-share-modal-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'agp-share-modal-overlay';
    overlay.innerHTML = `
      <div class="agp-modal-card">
        <!-- Header -->
        <div class="agp-modal-header">
          <div class="agp-header-brand">
            <div class="agp-header-icon">
              ${SHARE_ICON_SVG}
            </div>
            <div class="agp-header-titles">
              <h2>Share to Facebook Groups</h2>
              <span>AutoGroupPilot • Anti-Ban & Cloudflare AI</span>
            </div>
          </div>
          <button class="agp-modal-close" id="agpModalClose" title="Close">✕</button>
        </div>

        <!-- Normal View -->
        <div class="agp-modal-body" id="agpModalNormalBody">
          <!-- Post URL Target -->
          <div class="agp-target-box">
            <span class="agp-target-badge">Target Post</span>
            <input type="text" id="agpTargetUrlDisplay" style="flex: 1; background: transparent; border: none; color: #38bdf8; font-size: 12px; outline: none;" value="https://facebook.com/...">
          </div>

          <!-- Caption & Spintax -->
          <div>
            <div class="agp-field-label">
              <span>Intro Caption / Thoughts (Optional)</span>
              <span id="agpModalSpintaxBadge" style="color: #60a5fa; font-size: 11px;">Supports {A|B}</span>
            </div>
            <textarea class="agp-caption-input" id="agpModalCaption" placeholder="Write an intro message (or leave blank to share post directly)..."></textarea>
          </div>

          <!-- Cloudflare AI Spin Bar -->
          <div class="agp-ai-bar">
            <div class="agp-ai-bar-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              <span>Cloudflare Workers AI (Llama 3.2)</span>
            </div>
            <button class="agp-btn-ai-spin" id="agpModalBtnAiSpin">✨ Spin Caption</button>
          </div>

          <!-- Groups Selector -->
          <div class="agp-groups-picker">
            <div class="agp-picker-toolbar">
              <input type="text" class="agp-filter-input" id="agpModalGroupFilter" placeholder="Filter groups...">
              <select class="agp-bundle-select" id="agpModalBundleSelect">
                <option value="all">All Groups</option>
              </select>
              <div class="agp-picker-actions">
                <a id="agpModalSelectAll">All</a>
                <span>·</span>
                <a id="agpModalClearAll">Clear</a>
              </div>
            </div>
            <div class="agp-modal-groups-list" id="agpModalGroupsList">
              <!-- Dynamically populated rows -->
            </div>
          </div>

          <!-- Safety Preset Selector -->
          <div>
            <div class="agp-field-label">
              <span>Anti-Ban Safety Preset</span>
            </div>
            <div class="agp-safety-presets">
              <div class="agp-preset-pill" data-preset="maximum">
                <strong>Maximum Safety</strong>
                <span>90s - 210s</span>
              </div>
              <div class="agp-preset-pill active" data-preset="balanced">
                <strong>Balanced (Rec.)</strong>
                <span>45s - 90s</span>
              </div>
              <div class="agp-preset-pill" data-preset="fast">
                <strong>Turbo</strong>
                <span>25s - 50s</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sharing Active Progress View -->
        <div class="agp-modal-body agp-sharing-active-view" id="agpModalProgressBody">
          <div class="agp-header-titles" style="text-align: center; margin-bottom: 12px;">
            <h2 id="agpModalLiveStatusText">Sharing Campaign Active</h2>
            <span id="agpModalLiveGroupName" style="color: #94a3b8; font-size: 13px;">Preparing first group...</span>
          </div>

          <div class="agp-progress-track">
            <div class="agp-progress-fill" id="agpModalProgressBar"></div>
          </div>

          <p style="font-size: 13px; color: #94a3b8; text-align: center;" id="agpModalCounterText">0 / 0 Groups Shared</p>
          <p style="font-size: 12px; color: #38bdf8; font-weight: 600; margin-top: 6px; text-align: center;" id="agpModalCountdownText">Next post in: --</p>
        </div>

        <!-- Footer -->
        <div class="agp-modal-footer">
          <div class="agp-footer-status">
            <span id="agpModalSelectedCount">0</span> groups selected
          </div>
          <div class="agp-footer-buttons">
            <button class="agp-btn-cancel" id="agpModalBtnCancel">Cancel</button>
            <button class="agp-btn-share-now" id="agpModalBtnStartShare">
              ${SHARE_ICON_SVG}
              <span>Share to Selected Groups</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close button & overlay click
    document.getElementById('agpModalClose').addEventListener('click', closeShareModal);
    document.getElementById('agpModalBtnCancel').addEventListener('click', closeShareModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeShareModal();
    });

    // Preset selector
    const presetPills = overlay.querySelectorAll('.agp-preset-pill');
    presetPills.forEach(pill => {
      pill.addEventListener('click', () => {
        presetPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeModalPreset = pill.dataset.preset;
      });
    });

    // AI Spin Button inside Modal
    const btnAiSpin = document.getElementById('agpModalBtnAiSpin');
    const captionInput = document.getElementById('agpModalCaption');
    btnAiSpin.addEventListener('click', () => {
      const text = captionInput.value.trim();
      if (!text) {
        alert('Please write an intro or caption to spin.');
        return;
      }
      btnAiSpin.textContent = 'Spinning...';
      btnAiSpin.disabled = true;

      chrome.runtime.sendMessage(
        { action: 'SPIN_POST_PREVIEW', text, tone: 'engaging', style: 'moderate' },
        res => {
          btnAiSpin.textContent = '✨ Spin Caption';
          btnAiSpin.disabled = false;
          if (res && res.success && res.variation) {
            captionInput.value = res.variation;
          } else {
            alert(`AI Spin failed: ${res?.error || 'Worker offline'}`);
          }
        }
      );
    });

    // Start Share Action
    document.getElementById('agpModalBtnStartShare').addEventListener('click', executeModalShare);

    return overlay;
  }

  function openShareModal(actionRow) {
    const details = extractPostDetails(actionRow);
    currentModalPostUrl = details.postUrl;

    const overlay = ensureModalInDom();
    const urlInput = document.getElementById('agpTargetUrlDisplay');
    urlInput.value = details.postUrl;

    // Reset view to normal
    document.getElementById('agpModalNormalBody').style.display = 'flex';
    const progressBody = document.getElementById('agpModalProgressBody');
    progressBody.classList.remove('active');
    progressBody.style.display = 'none';
    document.getElementById('agpModalBtnStartShare').style.display = 'inline-flex';

    // Populate Groups List
    renderModalGroupsList();
    renderModalBundles();

    // Show overlay
    overlay.classList.add('agp-visible');
  }

  function closeShareModal() {
    const overlay = document.getElementById('agp-share-modal-overlay');
    if (overlay) overlay.classList.remove('agp-visible');
  }

  function renderModalGroupsList(filterQuery = '') {
    const list = document.getElementById('agpModalGroupsList');
    if (!list) return;

    list.innerHTML = '';

    if (allUserGroups.length === 0) {
      list.innerHTML = `
        <div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 12px;">
          <p style="margin-bottom: 8px;">No groups synced yet.</p>
          <button type="button" id="agpModalBtnDirectSync" style="background: #1877f2; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
            🔄 Sync My Facebook Groups Now
          </button>
        </div>`;
      
      const syncBtn = document.getElementById('agpModalBtnDirectSync');
      if (syncBtn) {
        syncBtn.onclick = async () => {
          syncBtn.textContent = 'Scanning Facebook...';
          syncBtn.disabled = true;
          const groups = await scanUserGroups();
          allUserGroups = groups;
          modalSelectedIds = new Set(groups.map(g => g.id));
          chrome.storage.local.set({ agp_groups: groups, agp_selected_ids: Array.from(modalSelectedIds) });
          renderModalGroupsList();
          renderModalBundles();
        };
      }
      updateModalSelectedBadge();
      return;
    }

    const q = filterQuery.toLowerCase().trim();
    const filtered = allUserGroups.filter(g => !q || g.name.toLowerCase().includes(q));

    if (filtered.length === 0) {
      list.innerHTML = `<div style="padding: 14px; text-align: center; color: #94a3b8; font-size: 12px;">No groups match filter.</div>`;
      updateModalSelectedBadge();
      return;
    }

    filtered.forEach(group => {
      const row = document.createElement('label');
      row.className = 'agp-modal-group-row';

      const isChecked = modalSelectedIds.has(group.id);
      row.innerHTML = `
        <input type="checkbox" id="modal-grp-${group.id}" ${isChecked ? 'checked' : ''}>
        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${group.name}</span>
      `;

      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          modalSelectedIds.add(group.id);
        } else {
          modalSelectedIds.delete(group.id);
        }
        updateModalSelectedBadge();
      });

      list.appendChild(row);
    });

    updateModalSelectedBadge();

    // Filter input
    const filterInput = document.getElementById('agpModalGroupFilter');
    filterInput.oninput = () => renderModalGroupsList(filterInput.value);

    // Select All / Clear
    document.getElementById('agpModalSelectAll').onclick = () => {
      allUserGroups.forEach(g => modalSelectedIds.add(g.id));
      renderModalGroupsList(filterInput.value);
    };
    document.getElementById('agpModalClearAll').onclick = () => {
      modalSelectedIds.clear();
      renderModalGroupsList(filterInput.value);
    };
  }

  function updateModalSelectedBadge() {
    const countEl = document.getElementById('agpModalSelectedCount');
    if (countEl) countEl.textContent = modalSelectedIds.size;
    const btn = document.getElementById('agpModalBtnStartShare');
    if (btn) btn.disabled = modalSelectedIds.size === 0;
  }

  function renderModalBundles() {
    const select = document.getElementById('agpModalBundleSelect');
    if (!select) return;

    select.innerHTML = '<option value="all">All Groups</option>';
    Object.keys(userBundles).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${name} (${userBundles[name].length})`;
      select.appendChild(opt);
    });

    select.onchange = () => {
      const val = select.value;
      if (val === 'all') {
        modalSelectedIds = new Set(allUserGroups.map(g => g.id));
      } else if (userBundles[val]) {
        modalSelectedIds = new Set(userBundles[val]);
      }
      renderModalGroupsList(document.getElementById('agpModalGroupFilter').value);
    };
  }

  function executeModalShare() {
    if (modalSelectedIds.size === 0) {
      alert('Please select at least 1 group.');
      return;
    }

    const selectedGroups = allUserGroups.filter(g => modalSelectedIds.has(g.id));
    const rawCaption = document.getElementById('agpModalCaption').value.trim();
    const finalUrl = document.getElementById('agpTargetUrlDisplay').value.trim() || currentModalPostUrl;

    const postText = rawCaption
      ? `${rawCaption}\n\n${finalUrl}`
      : finalUrl;

    const presetSettings = {
      maximum: { minDelaySec: 90, maxDelaySec: 210, breakEvery: 6, breakDurationMinutes: 12 },
      balanced: { minDelaySec: 45, maxDelaySec: 90, breakEvery: 8, breakDurationMinutes: 10 },
      fast: { minDelaySec: 25, maxDelaySec: 50, breakEvery: 12, breakDurationMinutes: 5 },
    }[activeModalPreset] || { minDelaySec: 45, maxDelaySec: 90, breakEvery: 8, breakDurationMinutes: 10 };

    const config = {
      postText,
      useAiSpin: true,
      aiTone: 'engaging',
      aiStyle: 'moderate',
      safetyMode: activeModalPreset,
      ...presetSettings,
      dailyLimit: 35,
    };

    // Switch Modal View to Live Progress
    document.getElementById('agpModalNormalBody').style.display = 'none';
    const progressBody = document.getElementById('agpModalProgressBody');
    progressBody.style.display = 'block';
    progressBody.classList.add('active');
    document.getElementById('agpModalBtnStartShare').style.display = 'none';

    // Start campaign in background service worker
    chrome.runtime.sendMessage({
      action: 'START_CAMPAIGN',
      groups: selectedGroups,
      config,
    });
  }

  // -------------------------------------------------------------------------
  // 3. BACKGROUND EVENT LISTENERS & DOM AUTOMATION
  // -------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCAN_GROUPS') {
      scanUserGroups().then(groups => sendResponse({ success: true, groups }));
      return true;
    }

    if (message.action === 'POST_TO_GROUP') {
      executeGroupPost(message.payload)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.action === 'CHECK_FACEBOOK_SESSION') {
      const isLoggedIn = checkFacebookLoggedIn();
      sendResponse({ isLoggedIn });
      return false;
    }

    // Modal Live Progress Updates
    if (message.action === 'STATE_UPDATED') {
      const state = message.state;
      const progressBody = document.getElementById('agpModalProgressBody');
      if (progressBody && progressBody.classList.contains('active')) {
        const total = state.queue.length;
        const current = state.currentIndex;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;

        document.getElementById('agpModalProgressBar').style.width = `${pct}%`;
        document.getElementById('agpModalCounterText').textContent = `${current} / ${total} Groups Shared (${pct}%)`;
        if (state.currentGroup) {
          document.getElementById('agpModalLiveGroupName').textContent = `Target: "${state.currentGroup.name}"`;
        }
        if (state.status === 'completed') {
          document.getElementById('agpModalLiveStatusText').textContent = '✅ Campaign Completed!';
          document.getElementById('agpModalLiveGroupName').textContent = `All ${total} groups published successfully.`;
        }
      }
    }

    if (message.action === 'COUNTDOWN_TICK') {
      const cdEl = document.getElementById('agpModalCountdownText');
      if (cdEl) {
        cdEl.textContent = message.seconds > 0 ? `Next post in: ${message.seconds}s (anti-ban pacing)` : 'Posting now...';
      }
    }
  });

  function checkFacebookLoggedIn() {
    return !!(
      document.querySelector('[aria-label="Your profile"]') ||
      document.querySelector('[aria-label="Account"]') ||
      document.querySelector('[aria-label*="الملف الشخصي"]') ||
      document.cookie.includes('c_user')
    );
  }

  async function scanUserGroups() {
    console.log('[AutoGroupPilot] Scanning Facebook for joined groups...');
    const groups = new Map();
    const ignoreSlugs = new Set([
      'feed', 'discover', 'joins', 'create', 'notifications', 'categories',
      'chats', 'saved', 'manage', 'membership_questions', 'your_posts', 'search'
    ]);

    // Find scrollable sidebar containers if any
    const scrollContainers = [
      window,
      document.querySelector('div[role="navigation"] div[style*="overflow"]'),
      document.querySelector('div[role="navigation"]'),
      document.querySelector('div[data-pagelet*="LeftRail"]'),
    ].filter(Boolean);

    for (let i = 0; i < 7; i++) {
      // Scroll page & sidebar
      scrollContainers.forEach(container => {
        try {
          if (container === window) {
            window.scrollBy({ top: 900, behavior: 'smooth' });
          } else if (container.scrollBy) {
            container.scrollBy({ top: 700, behavior: 'smooth' });
          }
        } catch (e) {}
      });

      await new Promise(r => setTimeout(r, 1000));

      const links = document.querySelectorAll('a[href*="/groups/"]');
      links.forEach(a => {
        const href = a.href || a.getAttribute('href') || '';
        const match = href.match(/(?:https?:\/\/[^/]+)?\/groups\/([a-zA-Z0-9._-]+)/i);
        if (!match) return;

        const groupId = match[1].toLowerCase();
        if (ignoreSlugs.has(groupId)) return;

        // Extract clean group title
        let name = '';
        const titleEl = a.querySelector('span[dir="auto"], strong, h3, h4, span.x193iq5w');
        if (titleEl && titleEl.innerText.trim()) {
          name = titleEl.innerText.trim();
        } else {
          const raw = (a.innerText || a.getAttribute('aria-label') || '').trim();
          name = raw.split('\n')[0].trim();
        }

        // Clean up common prefixes
        name = name.replace(/^(Group|مجموعة|Groupe):\s*/i, '').trim();

        if (name && name.length >= 2 && !groups.has(match[1])) {
          const lower = name.toLowerCase();
          if (
            lower === 'groups' ||
            lower === 'المجموعات' ||
            lower.includes('see all') ||
            lower.includes('عرض الكل') ||
            lower.includes('discover') ||
            lower.includes('your feed') ||
            lower.includes('create new group') ||
            lower.includes('إنشاء مجموعة')
          ) {
            return;
          }

          groups.set(match[1], {
            id: match[1],
            name: name,
            url: `https://www.facebook.com/groups/${match[1]}/`,
          });
        }
      });
    }

    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    console.log(`[AutoGroupPilot] Scan complete. Found ${groups.size} groups.`);
    return Array.from(groups.values());
  }

  async function executeGroupPost({ postText, firstComment, safetyConfig }) {
    console.log('[AutoGroupPilot] Starting automated posting flow...');

    const checkpoint = checkForSecurityWarnings();
    if (checkpoint) {
      return { success: false, checkpoint: true, error: checkpoint };
    }

    if (safetyConfig?.scrollPresence && typeof Humanizer !== 'undefined') {
      await Humanizer.simulateFeedPresence(3);
    }

    const composerTrigger = await findComposerTrigger(12000);
    if (!composerTrigger) {
      return {
        success: false,
        error: "Could not locate 'Create post' composer in this group. Ensure you are a member with posting permissions.",
      };
    }

    if (typeof Humanizer !== 'undefined') {
      await Humanizer.simulateHumanClick(composerTrigger);
    } else {
      composerTrigger.click();
    }
    await new Promise(r => setTimeout(r, 2000));

    const editor = await findRichEditor(8000);
    if (!editor) {
      return { success: false, error: 'Could not activate the post text editor.' };
    }

    if (safetyConfig?.humanTyping && typeof Humanizer !== 'undefined') {
      await Humanizer.simulateHumanTyping(editor, postText, 35);
    } else {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, postText);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await new Promise(r => setTimeout(r, 3000));

    const postButton = await findSubmitPostButton(6000);
    if (!postButton) {
      return { success: false, error: 'Could not find the submit Post button.' };
    }

    if (postButton.getAttribute('aria-disabled') === 'true') {
      return { success: false, error: 'Post button is disabled. Group may require admin approval or missing fields.' };
    }

    if (typeof Humanizer !== 'undefined') {
      await Humanizer.simulateHumanClick(postButton);
    } else {
      postButton.click();
    }
    console.log('[AutoGroupPilot] Post button clicked. Awaiting confirmation...');

    await new Promise(r => setTimeout(r, 5000));

    const postBlock = checkForSecurityWarnings();
    if (postBlock) {
      return { success: false, checkpoint: true, error: postBlock };
    }

    let commentPosted = false;
    if (firstComment && firstComment.trim()) {
      try {
        await new Promise(r => setTimeout(r, 4000));
        commentPosted = await executeFirstComment(firstComment);
      } catch (commentErr) {
        console.warn('[AutoGroupPilot] First comment execution failed:', commentErr);
      }
    }

    return {
      success: true,
      commentPosted,
      postedAt: new Date().toISOString(),
    };
  }

  async function findComposerTrigger(timeoutMs = 10000) {
    const startTime = Date.now();
    const selectors = [
      'div[role="button"][tabindex="0"] span',
      'div[role="region"] div[role="button"]',
      'div[aria-label*="Create a public post"]',
      'div[aria-label*="Write something"]',
      'div[aria-label*="Create a post"]',
      'div[aria-label*="انشئ منشوراً"]',
      'div[aria-label*="اكتب شيئاً"]',
      'div[aria-label*="Créer une publication"]',
      'div[aria-label*="Crear publicación"]'
    ];

    while (Date.now() - startTime < timeoutMs) {
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (
            text.includes('write something') ||
            text.includes('create a public post') ||
            text.includes('what\'s on your mind') ||
            text.includes('create a post') ||
            text.includes('write a post') ||
            text.includes('اكتب شيئاً') ||
            text.includes('إنشاء منشور') ||
            text.includes('بما تفكر')
          ) {
            return el.closest('div[role="button"]') || el;
          }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  async function findRichEditor(timeoutMs = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        const textbox = dialog.querySelector('div[role="textbox"][contenteditable="true"]');
        if (textbox) return textbox;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return null;
  }

  async function findSubmitPostButton(timeoutMs = 6000) {
    const startTime = Date.now();
    const postLabels = ['post', 'publish', 'share', 'نشر', 'publier', 'publicar'];

    while (Date.now() - startTime < timeoutMs) {
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        const buttons = dialog.querySelectorAll('div[role="button"], button');
        for (const btn of buttons) {
          const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim().toLowerCase();
          if (postLabels.some(l => label === l || label.includes(l))) {
            return btn;
          }
        }
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return null;
  }

  async function executeFirstComment(commentText) {
    const commentInputs = document.querySelectorAll('div[aria-label*="Write a comment"][role="textbox"], form textarea, div[aria-label*="اكتب تعليقاً"]');
    if (!commentInputs || commentInputs.length === 0) return false;

    const commentBox = commentInputs[0];
    if (typeof Humanizer !== 'undefined') {
      await Humanizer.simulateHumanClick(commentBox);
    } else {
      commentBox.click();
    }
    await new Promise(r => setTimeout(r, 1000));

    commentBox.focus();
    document.execCommand('insertText', false, commentText);
    commentBox.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise(r => setTimeout(r, 1500));

    const enterDown = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true });
    commentBox.dispatchEvent(enterDown);

    await new Promise(r => setTimeout(r, 2000));
    return true;
  }

  function checkForSecurityWarnings() {
    const text = document.body.innerText.toLowerCase();
    const warnings = [
      "you're temporarily blocked",
      'we limit how often you can post',
      'this post goes against our community standards',
      'account restricted',
      'security check',
      'confirm your identity',
      'تم حظرك مؤقتًا',
      'نحن نضع قيوداً'
    ];

    for (const w of warnings) {
      if (text.includes(w)) {
        return `Facebook Warning Detected: "${w}". Posting halted immediately to safeguard your account.`;
      }
    }
    return null;
  }
})();
