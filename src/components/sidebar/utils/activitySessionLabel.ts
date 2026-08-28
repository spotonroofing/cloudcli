/**
 * A chain manifest phase name is optional. Older fixtures and partial chain
 * records can carry a dash as a missing-value sentinel; that is not content
 * and must not become the second half of a visible worker label.
 */
export function meaningfulActivityDetail(value: string | null): string | null {
  const detail = value?.trim();
  if (!detail || /^[-\u2013\u2014]+$/.test(detail)) return null;
  return detail;
}
