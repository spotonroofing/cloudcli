import type { ProviderModelOption } from '../types/app';

/**
 * Prettifies a raw model id into a friendly name (claude-opus-5 renders as
 * "Opus 5", claude-haiku-4-5-20251001 as "Haiku 4.5") so an id never reaches
 * the screen verbatim, even for models absent from the catalog.
 */
export function prettifyModelId(model: string): string {
  const tokens = model.trim().split('-').filter(Boolean);
  const words: string[] = [];
  let versionParts: string[] = [];

  tokens.forEach((token, index) => {
    if (/^\d{8}$/.test(token)) {
      return; // date snapshot suffix
    }
    if (/^\d+$/.test(token)) {
      versionParts.push(token);
      return;
    }
    if (versionParts.length > 0) {
      words.push(versionParts.join('.'));
      versionParts = [];
    }
    if (index === 0 && token.toLowerCase() === 'claude') {
      return; // provider prefix, not part of the friendly name
    }
    words.push(token.charAt(0).toUpperCase() + token.slice(1));
  });
  if (versionParts.length > 0) {
    words.push(versionParts.join('.'));
  }

  return words.join(' ') || model;
}

/**
 * Friendly label for a model id: exact catalog match first, then a catalog
 * entry the id extends with a date suffix, then the prettifier fallback.
 */
export function modelDisplayLabel(model: string, options: ProviderModelOption[] = []): string {
  const normalized = model.trim();
  if (!normalized) {
    return model;
  }

  const exact = options.find((option) => option.value === normalized);
  if (exact?.label) {
    return exact.label;
  }

  const dateSuffixed = options.find((option) => normalized.startsWith(`${option.value}-`));
  if (dateSuffixed?.label) {
    return dateSuffixed.label;
  }

  return prettifyModelId(normalized);
}
