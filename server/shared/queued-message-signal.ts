import { EventEmitter } from 'node:events';

/**
 * In-process signal that a session's queued message row was written or
 * removed by a client (ui11 phase 2). The Claude runtime listens while a run
 * is live so a message queued during a long tool call is pushed into the turn
 * at once, and one edited or deleted after the push is retracted. Lives in
 * shared/ because the routes and the provider runtime cannot import each
 * other's modules without a load-order cycle.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function emitQueuedMessageChanged(sessionId: string): void {
  emitter.emit(sessionId);
}

export function onQueuedMessageChanged(sessionId: string, listener: () => void): () => void {
  emitter.on(sessionId, listener);
  return () => {
    emitter.off(sessionId, listener);
  };
}
