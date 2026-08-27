/**
 * Session-title truth for prompt-derived names (codex job 5), shared by the
 * server (synchronizers, app-session naming, the retitle migration) and the
 * client (display guards).
 *
 * A dispatched prompt file opens with header comments —
 * `<!-- verify: no -->`, `<!-- browser -->`, `<!-- name: X -->`,
 * `<!-- tasks: a | b -->` — and a session spawned from it is titled by its
 * `name` header, never by the raw prompt text. Every other prompt-derived
 * title has its comments removed before the usual word cut.
 */

const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const NAME_HEADER_PATTERN = /<!--\s*name:\s*([\s\S]*?)\s*-->/i;

/**
 * The `<!-- name: ... -->` header of a prompt, or null when it has none.
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function promptHeaderName(text) {
  const match = NAME_HEADER_PATTERN.exec(text ?? '');
  const name = match ? match[1].replace(/\s+/g, ' ').trim() : '';
  return name || null;
}

/**
 * The text with every HTML comment removed and whitespace collapsed.
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function stripHeaderComments(text) {
  return (text ?? '').replace(COMMENT_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * True when a stored title still carries a header comment (a row written
 * before this rule existed).
 * @param {string | null | undefined} title
 * @returns {boolean}
 */
export function isCommentShapedTitle(title) {
  return /<!--/.test(title ?? '');
}

/**
 * The title a prompt-derived text should carry: its name header when it has
 * one, else the comment-free text. Empty when nothing but comments remain.
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function titleFromPrompt(text) {
  return promptHeaderName(text) ?? stripHeaderComments(text);
}
