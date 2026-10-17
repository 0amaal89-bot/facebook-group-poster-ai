/**
 * AutoGroupPilot - Content Script (Facebook Automation Engine)
 * Runs safely within the user's authentic browser context.
 */

(() => {
  if (window.__AGP_LOADED__) return;
  window.__AGP_LOADED__ = true;

  console.log('[AutoGroupPilot] Content script injected successfully.');

  // Listen for messages from background script or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCAN_GROUPS') {
      scanUserGroups().then(groups => sendResponse({ success: true, groups }));
      return true; // Keep channel open for async response
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
  });

  /**
   * Checks if user is currently logged into Facebook.
   */
  function checkFacebookLoggedIn() {
    return !!(
      document.querySelector('[aria-label="Your profile"]') ||
      document.querySelector('[aria-label="Account"]') ||
      document.cookie.includes('c_user')
    );
  }

  /**
   * Scans the Facebook Groups directory or feed page to extract user's joined groups.
   */
  async function scanUserGroups() {
    const groups = new Map();

    // Scroll down multiple times to load lazy-rendered groups
    for (let i = 0; i < 5; i++) {
      window.scrollBy({ top: 800, behavior: 'smooth' });
      await Humanizer.sleep(1200);

      // Collect group links
      const links = document.querySelectorAll('a[href*="/groups/"]');
      links.forEach(a => {
        const href = a.href;
        // Clean URL: /groups/<id_or_name>/
        const match = href.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)/);
        if (!match) return;

        const groupId = match[1];
        // Filter out systemic group navigation paths
        if (['feed', 'discover', 'joins', 'create', 'notifications', 'categories'].includes(groupId)) {
          return;
        }

        const name = (a.innerText || a.getAttribute('aria-label') || '').trim();
        // Ignore single-character or generic anchor labels
        if (name && name.length > 2 && !name.includes('\n') && !groups.has(groupId)) {
          groups.set(groupId, {
            id: groupId,
            name: name,
            url: `https://www.facebook.com/groups/${groupId}/`,
          });
        }
      });
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    return Array.from(groups.values());
  }

  /**
   * Executes a full, safe human-like post to the current group.
   */
  async function executeGroupPost({ postText, firstComment, safetyConfig }) {
    console.log('[AutoGroupPilot] Starting automated posting flow...');

    // 1. Check for active checkpoints or warnings first
    const checkpoint = checkForSecurityWarnings();
    if (checkpoint) {
      return { success: false, checkpoint: true, error: checkpoint };
    }

    // 2. Natural presence: glance at feed if configured
    if (safetyConfig?.scrollPresence) {
      await Humanizer.simulateFeedPresence(3);
    }

    // 3. Locate the Composer trigger
    const composerTrigger = await findComposerTrigger(12000);
    if (!composerTrigger) {
      return {
        success: false,
        error: "Could not locate 'Create post' composer in this group. Ensure you are a member with posting permissions.",
      };
    }

    // 4. Click composer to open modal
    await Humanizer.simulateHumanClick(composerTrigger);
    await Humanizer.sleep(2000);

    // 5. Find the active rich-text editor inside the dialog
    const editor = await findRichEditor(8000);
    if (!editor) {
      return { success: false, error: 'Could not activate the post text editor.' };
    }

    // 6. Enter post text
    if (safetyConfig?.humanTyping) {
      await Humanizer.simulateHumanTyping(editor, postText, 35);
    } else {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, postText);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await Humanizer.sleep(2500);

    // 7. Check if post button is ready
    const postButton = await findSubmitPostButton(6000);
    if (!postButton) {
      return { success: false, error: 'Could not find the submit Post button.' };
    }

    if (postButton.getAttribute('aria-disabled') === 'true') {
      return { success: false, error: 'Post button is disabled. Group may require admin approval or missing fields.' };
    }

    // 8. Click Post button
    await Humanizer.simulateHumanClick(postButton);
    console.log('[AutoGroupPilot] Post button clicked. Awaiting confirmation...');

    // 9. Wait for modal to dismiss
    await Humanizer.sleep(5000);

    // Check again for spam block popup right after submission
    const postBlock = checkForSecurityWarnings();
    if (postBlock) {
      return { success: false, checkpoint: true, error: postBlock };
    }

    // 10. Auto First Comment (if specified)
    let commentPosted = false;
    if (firstComment && firstComment.trim()) {
      console.log('[AutoGroupPilot] Initiating Auto First Comment...');
      try {
        await Humanizer.sleep(4000);
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

  /**
   * Finds the "Write something..." composer trigger on Facebook.
   */
  async function findComposerTrigger(timeoutMs = 10000) {
    const startTime = Date.now();

    const selectors = [
      'div[role="button"][tabindex="0"] span',
      'div[role="region"] div[role="button"]',
      'div[aria-label*="Create a public post"]',
      'div[aria-label*="Write something"]',
      'div[aria-label*="Create a post"]',
    ];

    while (Date.now() - startTime < timeoutMs) {
      // Check for elements matching text
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (
            text.includes('write something') ||
            text.includes('create a public post') ||
            text.includes('what\'s on your mind') ||
            text.includes('create a post') ||
            text.includes('write a post')
          ) {
            return el.closest('div[role="button"]') || el;
          }
        }
      }
      await Humanizer.sleep(500);
    }
    return null;
  }

  /**
   * Finds the Lexical/Draft.js contenteditable textbox inside the modal.
   */
  async function findRichEditor(timeoutMs = 8000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        const textbox = dialog.querySelector('div[role="textbox"][contenteditable="true"]');
        if (textbox) return textbox;
      }
      await Humanizer.sleep(400);
    }
    return null;
  }

  /**
   * Finds the blue "Post" button in the dialog.
   */
  async function findSubmitPostButton(timeoutMs = 6000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        const buttons = dialog.querySelectorAll('div[role="button"], button');
        for (const btn of buttons) {
          const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim().toLowerCase();
          if (label === 'post' || label === 'publish' || label === 'share') {
            return btn;
          }
        }
      }
      await Humanizer.sleep(400);
    }
    return null;
  }

  /**
   * Publishes the first comment on the user's latest post in the group.
   */
  async function executeFirstComment(commentText) {
    // Locate the first comment input in the feed
    const commentInputs = document.querySelectorAll('div[aria-label*="Write a comment"][role="textbox"], form textarea');
    if (!commentInputs || commentInputs.length === 0) {
      console.log('[AutoGroupPilot] Comment input not found in DOM.');
      return false;
    }

    const commentBox = commentInputs[0];
    await Humanizer.simulateHumanClick(commentBox);
    await Humanizer.sleep(1000);

    commentBox.focus();
    document.execCommand('insertText', false, commentText);
    commentBox.dispatchEvent(new Event('input', { bubbles: true }));

    await Humanizer.sleep(1500);

    // Press Enter to submit comment
    const enterDown = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true });
    commentBox.dispatchEvent(enterDown);

    await Humanizer.sleep(2000);
    return true;
  }

  /**
   * Detects Facebook spam flags, rate limits, or account checkpoints.
   */
  function checkForSecurityWarnings() {
    const text = document.body.innerText.toLowerCase();
    const warnings = [
      "you're temporarily blocked",
      'we limit how often you can post',
      'this post goes against our community standards',
      'account restricted',
      'security check',
      'confirm your identity',
    ];

    for (const w of warnings) {
      if (text.includes(w)) {
        return `Facebook Warning Detected: "${w}". Posting halted immediately to safeguard your account.`;
      }
    }
    return null;
  }
})();
