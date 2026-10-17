/**
 * Spintax & Template Engine for AutoGroupPilot
 * Handles nested spintax syntax: {Hello|Hi|{Hey|Greetings}}
 * Replaces variables like {group_name}, {date}, etc.
 * Works universally across ServiceWorker, Content Scripts, and Window.
 */

class SpintaxEngine {
  /**
   * Parses and resolves nested spintax string into a randomized variant.
   * @param {string} text 
   * @returns {string}
   */
  static parse(text) {
    if (!text || typeof text !== 'string') return '';

    const spintaxRegex = /\{([^{}]+)\}/;
    let match;

    // Recursively resolve inner brackets first
    let iterations = 0;
    while ((match = spintaxRegex.exec(text)) && iterations < 100) {
      iterations++;
      const options = match[1].split('|');
      const chosen = options[Math.floor(Math.random() * options.length)];
      text = text.slice(0, match.index) + chosen + text.slice(match.index + match[0].length);
    }

    return text;
  }

  /**
   * Replaces dynamic variables in text.
   * @param {string} text 
   * @param {object} variables 
   * @returns {string}
   */
  static injectVariables(text, variables = {}) {
    if (!text) return '';
    let result = text;

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}|\\{${key}\\}`, 'gi');
      result = result.replace(regex, value || '');
    }

    const now = new Date();
    result = result.replace(/\{today\}|\{\{today\}\}/gi, now.toLocaleDateString());
    return result;
  }

  /**
   * Counts how many unique variations a spintax string can approximately produce.
   * @param {string} text 
   * @returns {number}
   */
  static estimateVariations(text) {
    if (!text) return 1;
    const matches = text.match(/\{([^{}]+)\}/g);
    if (!matches) return 1;

    let count = 1;
    for (const match of matches) {
      const inner = match.slice(1, -1);
      const parts = inner.split('|').length;
      count *= parts;
    }
    return Math.min(count, 1000000);
  }
}

// Universal export: works in ServiceWorker (importScripts), Content Scripts, Window, Node
const _globalScope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
_globalScope.SpintaxEngine = SpintaxEngine;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpintaxEngine;
}
