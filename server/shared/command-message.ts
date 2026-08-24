/**
 * The tagged wrapper CloudCLI (and Claude Code itself) uses to serialize a
 * slash command into a plain-text user message:
 *
 *   <command-message>{one-line description}</command-message>
 *   <command-name>/name</command-name>
 *   <command-args>{args}</command-args>
 *
 *   {expanded command body}
 *
 * The composer sends commands in this shape so the transcript can render a
 * compact command bubble (name + description, body behind an expand control)
 * identically live and on reload. Claude Code's own local-command transcript
 * rows use the same tags (without a body), so one parser covers both.
 */

export type CommandMessage = {
  name: string;
  description: string;
  args: string;
  /** Expanded command text after the tags; '' for CLI-written rows. */
  body: string;
};

/**
 * Extracts one lightweight XML-like tag from a plain string payload. We
 * intentionally parse only this small tag surface instead of introducing a
 * generic XML parser for untrusted history.
 */
export function extractTaggedContent(content: string, tagName: string): string | null {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
}

/**
 * Parses the command wrapper. Returns null for ordinary messages (no command
 * tags at all), matching the transcript normalizer's historical behavior of
 * treating any present tag as a command payload.
 */
export function parseCommandMessage(content: string): CommandMessage | null {
  const name = extractTaggedContent(content, 'command-name');
  const description = extractTaggedContent(content, 'command-message');
  const args = extractTaggedContent(content, 'command-args');

  if (name === null && description === null && args === null) {
    return null;
  }

  // The body is whatever follows the last closing tag.
  const tagEnd = (closingTag: string): number => {
    const index = content.lastIndexOf(closingTag);
    return index === -1 ? 0 : index + closingTag.length;
  };
  const lastTagEnd = Math.max(
    tagEnd('</command-name>'),
    tagEnd('</command-message>'),
    tagEnd('</command-args>'),
  );
  const body = lastTagEnd > 0 ? content.slice(lastTagEnd).replace(/^\s*\n/, '') : '';

  return {
    name: (name ?? '').trim(),
    description: (description ?? '').trim(),
    args: (args ?? '').trim(),
    body,
  };
}

/**
 * The short user-visible command string for a parsed wrapper: the slash name
 * (plus args), falling back to the description for older transcript variants.
 */
export function commandDisplayText(command: CommandMessage): string {
  const base = command.name || command.description;
  if (!base) {
    return '';
  }
  return command.args ? `${base} ${command.args}` : base;
}
