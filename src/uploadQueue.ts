const DEBOUNCE_MS = 350;

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const chainsByPoolKey = new Map<string, Promise<void>>();

function runQueued(poolKey: string, task: () => Promise<void>): Promise<void> {
  const previous = chainsByPoolKey.get(poolKey) ?? Promise.resolve();
  const next = previous
    .catch(() => {
      /* manter fila após falha */
    })
    .then(task);
  chainsByPoolKey.set(poolKey, next);
  return next;
}

/**
 * Debounce por ficheiro + fila serial por conexão (upload on save).
 */
export function scheduleDebouncedUpload(
  filePathKey: string,
  poolKey: string,
  task: () => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const existingTimer = debounceTimers.get(filePathKey);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      debounceTimers.delete(filePathKey);
      void runQueued(poolKey, task).then(resolve, reject);
    }, DEBOUNCE_MS);
    debounceTimers.set(filePathKey, timer);
  });
}

export function flushUploadQueues(): Promise<void> {
  const chains = [...chainsByPoolKey.values()];
  chainsByPoolKey.clear();
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  return Promise.all(
    chains.map((chain) =>
      chain.catch(() => {
        /* ignorar */
      })
    )
  ).then(() => undefined);
}
