/**
 * Client twin of server/shared/command-message.ts (no shared module crosses
 * the client/server boundary in this repo): the tagged wrapper a slash
 * command travels in so the transcript can render a compact command bubble
 * identically live and on reload.
 */

export type CommandMessage = {
  name: string;
  description: string;
  args: string;
  /** Expanded command text after the tags; '' for CLI-written rows. */
  body: string;
};

function extractTaggedContent(content: string, tagName: string): string | null {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
}

/** Serializes a command into the wrapper the composer sends. */
export function buildCommandMessage(command: CommandMessage): string {
  return [
    `<command-message>${command.description}</command-message>`,
    `<command-name>${command.name}</command-name>`,
    `<command-args>${command.args}</command-args>`,
    '',
    command.body,
  ].join('\n');
}

/** Parses the wrapper; null for ordinary messages (no command tags). */
export function parseCommandMessage(content: string): CommandMessage | null {
  const name = extractTaggedContent(content, 'command-name');
  const description = extractTaggedContent(content, 'command-message');
  const args = extractTaggedContent(content, 'command-args');

  if (name === null && description === null && args === null) {
    return null;
  }

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

/** The short user-visible command string: slash name plus args. */
export function commandDisplayText(command: CommandMessage): string {
  const base = command.name || command.description;
  if (!base) {
    return '';
  }
  return command.args ? `${base} ${command.args}` : base;
}
