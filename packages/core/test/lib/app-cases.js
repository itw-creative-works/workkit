/**
 * The host session for cases that run inside another program: each expected
 * case is one Node case, settled by the event line the program prints for it,
 * and one last case, `app session`, fails naming each line the session could
 * not place and the error a rejected `drive` gave.
 */

// The door's own `test`, so a session with no `options.timeout` gets its default.
import { test } from './cases.js';
import { parseEventLine } from './events.js';

// The case the session adds after the listed ones.
const SESSION_CASE = 'app session';

// A host's own mistake, thrown where it calls appCases: a case list whose ids
// repeat would settle two cases by one line.
const checkCases = (cases) => {
  const shaped = Array.isArray(cases) && cases.every((item) => typeof item?.id === 'string' && item.id !== '' && typeof item.name === 'string');
  if (!shaped) throw new TypeError('appCases() takes a list of { id, name }, each a string');
  const twice = cases.find((item, at) => cases.findIndex((other) => other.id === item.id) !== at);
  if (twice) throw new TypeError(`appCases() lists the id ${twice.id} twice`);
};

// The failure a `failed` event carries, as an Error with its message and stack.
const appError = ({ message, stack }) => {
  const error = new Error(message);
  if (typeof stack === 'string') error.stack = stack;
  return error;
};

/**
 * One Node case per entry of <cases>, in order, then `app session`.
 * `drive(onLine)` runs once, when the first case a run selects starts (never
 * when it selects none): it starts the program, hands `onLine` each line it
 * prints, and resolves when the program is done. A case with no event fails
 * when `drive` settles: `no event reported for <id>`, or the error it rejected
 * with. `app session` fails naming each fault, a rejected `drive`'s among them.
 * @param {Array<{id: string, name: string}>} cases
 * @param {(onLine: (line: string) => void) => Promise<void>} drive
 * @param {{timeout?: number}} [options] - each case's limit in ms, CASE_DEADLINE when unset
 * @returns {void}
 */
export const appCases = (cases, drive, options = {}) => {
  checkCases(cases);
  const { timeout } = options;
  const waiters = new Map(cases.map(({ id }) => [id, Promise.withResolvers()]));
  const reported = new Set();
  const faults = [];

  const onLine = (line) => {
    let event;
    try {
      event = parseEventLine(line);
    } catch (error) {
      faults.push(error.message);
      return;
    }
    if (event === null) return;
    if (!waiters.has(event.id)) {
      faults.push(`event for an unknown id ${event.id}`);
    } else if (reported.has(event.id)) {
      faults.push(`${event.id} reported twice`);
    } else {
      reported.add(event.id);
      waiters.get(event.id).resolve({ event });
    }
  };

  // Each case still waiting when drive settles fails with <errorFor(id)>.
  const endWaiting = (errorFor) => {
    for (const [id, waiter] of waiters) {
      if (!reported.has(id)) waiter.resolve({ error: errorFor(id) });
    }
  };

  // Started by the first selected case, so a filter that selects none starts nothing.
  let session;
  const start = () => {
    // The executor catches a drive that throws before it returns its promise.
    session ??= new Promise((resolve) => { resolve(drive(onLine)); }).then(
      () => endWaiting((id) => new Error(`no event reported for ${id}`)),
      (error) => {
        faults.push(error instanceof Error ? error.message : String(error));
        endWaiting(() => error);
      },
    );
    return session;
  };

  for (const { id, name } of cases) {
    test(name, { timeout }, async (t) => {
      // A case awaits its own waiter, never the session, so it settles by its line.
      start();
      const outcome = await waiters.get(id).promise;
      if (!('event' in outcome)) throw outcome.error;
      const { event } = outcome;
      if (event.status === 'skipped') t.skip(event.reason);
      if (event.status === 'failed') throw appError(event.error);
    });
  }

  test(SESSION_CASE, { timeout }, async () => {
    await start();
    if (faults.length > 0) throw new Error(faults.join('\n'));
  });
};
