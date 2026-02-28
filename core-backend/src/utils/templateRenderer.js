'use strict';

// Matches {{variableName}} — only word characters (letters, digits, underscore).
// Rejects anything that looks like JS expressions, prototype access, or injection.
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

/**
 * Renders a message template by replacing {{variable}} placeholders
 * with values from the provided variables object.
 *
 * Rules:
 *  - Only \w+ keys are matched — no JS expressions, dots, brackets, or whitespace.
 *  - Unknown placeholders are left unchanged.
 *  - Values are coerced to string via String(); no eval, no Function().
 *  - Prototype pollution is blocked via Object.prototype.hasOwnProperty guard.
 *
 * @param {string} template   - The message template string.
 * @param {object} variables  - Key/value pairs to interpolate.
 * @returns {string}          - The rendered message.
 */
function renderTemplate(template, variables) {
  if (typeof template !== 'string') {
    throw new TypeError('renderTemplate: template must be a string');
  }

  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return template;
  }

  return template.replace(PLACEHOLDER_RE, (_match, key) => {
    // Block prototype chain access (e.g. __proto__, constructor)
    if (!Object.prototype.hasOwnProperty.call(variables, key)) {
      return _match; // leave unknown placeholder unchanged
    }

    const value = variables[key];

    // Reject null / undefined — leave placeholder unchanged
    if (value === null || value === undefined) {
      return _match;
    }

    return String(value);
  });
}

module.exports = { renderTemplate };
