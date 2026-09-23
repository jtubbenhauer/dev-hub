const sessionMessageLocks = new Map<string, Promise<void>>();

export async function withSessionMessageLock<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = sessionMessageLocks.get(key) ?? Promise.resolve();
  let release = (): void => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  sessionMessageLocks.set(key, tail);

  await previous;
  try {
    return await action();
  } finally {
    release();
    if (sessionMessageLocks.get(key) === tail) {
      sessionMessageLocks.delete(key);
    }
  }
}
