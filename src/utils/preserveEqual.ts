/**
 * Keep the previous reference when a poll returns the same JSON snapshot.
 * Poll payloads in this app are plain server data, so a stable reference lets
 * React skip every consumer when nothing visible changed.
 */
export function preserveJsonEqual<T>(previous: T, incoming: T): T {
  return JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming;
}
