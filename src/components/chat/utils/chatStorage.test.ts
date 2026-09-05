import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  entries(): Array<[string, string]> {
    return [...this.#values.entries()];
  }
}

test('queued chat write stays in the device outbox until the server acknowledges it', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const storage = new MemoryStorage();
  let acknowledge: ((response: Response) => void) | undefined;

  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: () => new Promise<Response>((resolve) => {
      acknowledge = resolve;
    }),
  });

  try {
    const {
      readQueuedMessages,
      subscribeQueuedMessages,
      writeQueuedMessage,
    } = await import('./chatStorage');
    const acknowledged = new Promise<void>((resolve) => {
      const unsubscribe = subscribeQueuedMessages((sessionId) => {
        if (sessionId === 'session-1' && readQueuedMessages(sessionId)[0]?.pendingReceipt === false) {
          unsubscribe();
          resolve();
        }
      });
    });

    writeQueuedMessage('session-1', { id: 'retry-key-1', content: 'survive restart' });

    const outbox = storage.entries().find(([, value]) => value.includes('retry-key-1'));
    assert.ok(outbox, 'the payload is persisted synchronously before the request settles');
    assert.equal(readQueuedMessages('session-1')[0]?.pendingReceipt, true);

    await Promise.resolve();
    assert.ok(acknowledge, 'the server receipt request started');
    acknowledge(new Response('{}', { status: 200 }));
    await acknowledged;

    assert.equal(storage.getItem(outbox[0]), null);
    assert.equal(readQueuedMessages('session-1')[0]?.pendingReceipt, false);
  } finally {
    if (storageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
    if (fetchDescriptor) {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});
