/**
 * Humanizer & Anti-Ban Safety Engine for AutoGroupPilot
 * Mimics organic user interaction to prevent Facebook spam detection.
 */

class Humanizer {
  /**
   * Safe delay presets (in seconds)
   */
  static PRESETS = {
    maximum: {
      name: 'Maximum Safety',
      description: 'Slow, ultra-safe human pacing. Best for accounts posting to 30+ groups.',
      minDelay: 90,
      maxDelay: 210,
      scrollPresence: true,
      humanTyping: true,
      breakEvery: 6,
      breakDurationMinutes: 12,
    },
    balanced: {
      name: 'Balanced',
      description: 'Recommended blend of speed and account safety.',
      minDelay: 45,
      maxDelay: 100,
      scrollPresence: true,
      humanTyping: true,
      breakEvery: 10,
      breakDurationMinutes: 8,
    },
    fast: {
      name: 'Turbo',
      description: 'Faster posting cadence. Use only with established trusted accounts.',
      minDelay: 25,
      maxDelay: 50,
      scrollPresence: false,
      humanTyping: false,
      breakEvery: 15,
      breakDurationMinutes: 5,
    },
  };

  /**
   * Returns a promise that resolves after ms milliseconds.
   * @param {number} ms 
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generates a randomized delay in milliseconds with natural Gaussian-like jitter.
   * @param {number} minSec 
   * @param {number} maxSec 
   * @returns {number} Delay in ms
   */
  static getJitterDelay(minSec, maxSec) {
    const min = minSec * 1000;
    const max = maxSec * 1000;
    // Box-Muller transform for gaussian-like distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const randStdNormal = Math.sqrt(-2.0 * Math.log(u1 || 0.0001)) * Math.cos(2.0 * Math.PI * u2);
    const mean = (min + max) / 2;
    const stdDev = (max - min) / 6;
    let delay = mean + randStdNormal * stdDev;
    return Math.max(min, Math.min(max, Math.round(delay)));
  }

  /**
   * Simulates gentle human scrolling on the page to establish natural presence.
   * @param {number} durationSeconds 
   */
  static async simulateFeedPresence(durationSeconds = 4) {
    const startTime = Date.now();
    const endTime = startTime + durationSeconds * 1000;

    while (Date.now() < endTime) {
      const scrollStep = Math.floor(Math.random() * 250) + 100;
      window.scrollBy({
        top: scrollStep,
        behavior: 'smooth',
      });
      await this.sleep(Math.floor(Math.random() * 900) + 600);

      // Occasional small reverse scroll (like reading back)
      if (Math.random() > 0.6) {
        window.scrollBy({
          top: -Math.floor(scrollStep * 0.4),
          behavior: 'smooth',
        });
        await this.sleep(Math.floor(Math.random() * 700) + 400);
      }
    }

    // Scroll back to top where composer lives
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await this.sleep(800);
  }

  /**
   * Types text into a DOM element (or contentEditable) character by character.
   * @param {HTMLElement} element 
   * @param {string} text 
   * @param {number} baseSpeedMs 
   */
  static async simulateHumanTyping(element, text, baseSpeedMs = 45) {
    if (!element || !text) return;

    element.focus();

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Dispatch realistic keyboard events
      const keydown = new KeyboardEvent('keydown', { key: char, bubbles: true });
      const keypress = new KeyboardEvent('keypress', { key: char, bubbles: true });
      element.dispatchEvent(keydown);
      element.dispatchEvent(keypress);

      // Insert character into editable
      document.execCommand('insertText', false, char);

      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: char,
        inputType: 'insertText',
      });
      element.dispatchEvent(inputEvent);

      // Natural pause for spaces and punctuation
      let delay = baseSpeedMs + Math.random() * 35;
      if (char === '.' || char === '!' || char === '?') {
        delay += Math.random() * 300 + 150;
      } else if (char === ' ' || char === ',') {
        delay += Math.random() * 120 + 50;
      }

      await this.sleep(delay);
    }
  }

  /**
   * Dispatches realistic human mouse click with mousedown, mouseup, click.
   * @param {HTMLElement} element 
   */
  static async simulateHumanClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 8 - 4);
    const y = rect.top + rect.height / 2 + (Math.random() * 8 - 4);

    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    };

    element.dispatchEvent(new MouseEvent('mousedown', common));
    await this.sleep(Math.floor(Math.random() * 80) + 50);
    element.dispatchEvent(new MouseEvent('mouseup', common));
    element.dispatchEvent(new MouseEvent('click', common));
  }
}

// Support both ES module and plain script injection
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Humanizer;
} else if (typeof window !== 'undefined') {
  window.Humanizer = Humanizer;
}
