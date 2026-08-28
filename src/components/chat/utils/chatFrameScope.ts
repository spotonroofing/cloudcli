/** A pane consumes provider frames only for the session it currently renders. */
export function frameTargetsSession(
  frameSessionId: string | null,
  renderedSessionId: string | null,
): boolean {
  return Boolean(frameSessionId && renderedSessionId && frameSessionId === renderedSessionId);
}
