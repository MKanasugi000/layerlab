interface QueueState {
  generation: number;
  tail: Promise<void>;
}

const queues = new WeakMap<object, QueueState>();

/**
 * Serialize saves for one document.  The callback can only mark the document
 * clean when it is still the newest request; older writes always run first.
 */
export function enqueueDocumentSave<T>(
  document: object,
  task: (isLatest: () => boolean) => Promise<T>,
): Promise<T> {
  let state = queues.get(document);
  if (!state) {
    state = { generation: 0, tail: Promise.resolve() };
    queues.set(document, state);
  }
  const generation = ++state.generation;
  const run = state.tail.catch(() => undefined).then(() => task(
    () => state?.generation === generation,
  ));
  state.tail = run.then(() => undefined, () => undefined);
  return run;
}

/** Pure helper used by deterministic regression tests. */
export async function runTasksInOrder<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = [];
  let tail = Promise.resolve();
  for (const task of tasks) {
    tail = tail.then(async () => {
      results.push(await task());
    });
  }
  await tail;
  return results;
}
