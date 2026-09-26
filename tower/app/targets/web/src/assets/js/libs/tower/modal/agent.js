// libs/tower/modal/agent.js: the crew card's dialog: the registry, the trigger,
// the header and rows, the live refresh and the mount.
// modal.js re-exports it whole; no piece imports modal.js.

//
// ── The crew card's dialog ─────────────────────────────────────────────────
//
// The same machinery for the other thing the tower draws as a card: an agent.
// A crew card shows what it IS; this says what it is doing - the tool it last
// reached for, what it has spent, how long it has been up, and where its
// transcript is. Everything on it comes from the telemetry payload; a field the
// payload does not carry is left OUT rather than drawn as a dash, because a row
// of dashes reads as a broken dialog rather than as a session too young to have
// spent anything.
//
// And it is a LIVE surface, not a snapshot (#108). Filled once at open it froze
// at that instant's stamps - the dialogs live in the layout, outside the mount a
// paint writes into - so the second hand, which only ever DECAYS what it walks,
// took a dialog left open on a working agent gray at twenty seconds and empty at
// sixty while the card behind it kept spinning. So every feed paint refreshes
// whichever agent dialog is open (page.js's paint calls `refreshAgentDialog`),
// from the registry the same paint just rewrote: the dialog and the card are two
// drawings of one entry and can no longer tell different stories.
//
// Refreshing PATCHES rather than redraws, for the reason clock.js patches: an
// `innerHTML` over the header would replace the glyph every ten seconds and
// restart the animation it is meant to keep running. The body is written in two
// halves for exactly that - a header carrying the stamped indicator, whose
// `data-live-*` attributes the refresh rewrites and the shared tick then
// re-decides, and a rows block, which holds no motion and is rewritten whole.
//

import { esc, compact, money, modelBadge, classBadge, shortPath } from '../format.js';
import { crewActivity, liveStamps, sinceLabel, roleIcon } from '../agent.js';
import { applyLive } from '../clock.js';
import { openFrom } from './issue.js';

/** The agents the current markup can open, keyed by agent id. */
const agents = new Map();

/**
 * The attributes that make an element open the agent dialog.
 *
 * @param {object} entry - a normalized crew node, plus the `label` the card is
 *   titled with and the `role` it is playing
 * @returns {string} attributes to interpolate into the element's tag
 */
export const agentTrigger = (entry) => {
  agents.set(entry.id, entry);
  return `data-agent="${esc(entry.id)}" role="button" tabindex="0"`;
};

/** One label/value row of the dialog, or '' when there is no value to show. */
const detail = (label, value) => (value
  ? `<div class="d-flex justify-content-between gap-3 py-1 border-bottom">
      <span class="omega-micro text-body-secondary">${esc(label)}</span>
      <span class="text-end">${value}</span>
    </div>`
  : '');

/** A moment as the clock said it, or '' when there is no moment. */
const clock = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleTimeString() : '');

/**
 * The dialog's header strip: what the agent is, and the one thing on it that
 * moves.
 *
 * The indicator is `agent.crewActivity`, the same stamped builder the Crew page
 * and the Overview draw (#65) - so the dialog carries the card's glyph, the
 * card's age beside it, and the stamps both the second hand and the refresh
 * below read back. That age is also the ONLY place the dialog says how fresh
 * the agent is: there was a "Last activity" row saying the same span in words,
 * frozen at open while the header ticked, and two numbers for one fact will
 * always end up disagreeing.
 *
 * @param {object} entry - a normalized crew node with `label` and `role`
 * @param {number} now - ms epoch
 * @returns {string} markup - the header's CONTENTS, so a refresh can rewrite
 *   them without replacing the element they sit in
 */
const agentHead = (entry, now) => `${roleIcon(entry.role || entry.agentClass)}
  ${classBadge(entry.role || entry.agentClass)}
  ${modelBadge(entry.model)}
  ${entry.effort ? `<span class="omega-chip">${esc(entry.effort)}</span>` : ''}
  ${crewActivity(entry, now)}`;

/**
 * The dialog's rows: everything the card had no room for.
 *
 * @param {object} entry - a normalized crew node
 * @param {number} now - ms epoch
 * @returns {string} markup
 */
const agentRows = (entry, now) => {
  const usage = entry.usage || null;
  const alive = Number(entry.aliveSince);
  const tool = Number(entry.lastToolAt);

  return `${detail('Last tool', entry.lastTool ? `${esc(entry.lastTool)}${Number.isFinite(tool) ? ` <span class="omega-micro text-body-secondary">${esc(sinceLabel(now - tool))} ago</span>` : ''}` : '')}
    ${detail('Running for', Number.isFinite(alive) ? esc(sinceLabel(now - alive)) : '')}
    ${detail('Spawned', clock(alive) ? esc(clock(alive)) : '')}
    ${detail('Tokens in', usage ? esc(compact(usage.input)) : '')}
    ${detail('Tokens out', usage ? esc(compact(usage.output)) : '')}
    ${detail('Tokens total', entry.tokens === null || entry.tokens === undefined ? '' : esc(compact(entry.tokens)))}
    ${detail('Cost', entry.cost === null || entry.cost === undefined ? '' : esc(money(entry.cost)))}
    ${detail('Id', esc(entry.id || ''))}
    ${detail('Transcript', entry.transcript ? `<code class="omega-micro">${esc(entry.transcript)}</code>` : '')}`;
};

/**
 * The two pieces of the dialog for one agent.
 *
 * Pure - a node and a `now` in, two markup strings out - so the suite can ask
 * what it says about a session that has spent nothing without a browser.
 *
 * The body's two halves are named in the markup (`data-agent-head`,
 * `data-agent-rows`) because the refresh below has to reach each of them
 * differently: the header is patched so its glyph keeps turning, the rows are
 * rewritten whole.
 *
 * @param {object} entry - a normalized crew node with `label` and `role`
 * @param {number} [now] - ms epoch
 * @returns {{title: string, body: string}}
 */
export const agentDialog = (entry, now = Date.now()) => ({
  title: `<span class="omega-micro d-block">${esc(entry.role || 'agent')}${entry.cwd ? ` · ${esc(shortPath(entry.cwd))}` : ''}</span>
      <span class="d-block">${esc(entry.label || entry.id || 'agent')}</span>`,
  body: `<div class="d-flex flex-wrap align-items-center gap-2 mb-3" data-agent-head>${agentHead(entry, now)}</div>
      <div data-agent-rows>${agentRows(entry, now)}</div>`,
});

// The dialog the mount bound, so a page's paint can refresh it without knowing
// anything about the layout it lives in - the same reason the registry is here
// and not on a page.
let agentHost = null;

/**
 * Bring the open agent dialog up to `now`, from the registry as it stands.
 *
 * Called by the paint (page.js), never by the clock: the stamps change when a
 * FEED lands, and the second in between is the second hand's job.
 *
 * Quiet in every case where there is nothing true to say. No dialog open, or a
 * key with nothing behind it, and it writes nothing at all - an agent that
 * ENDED between polls stops being registered, and the honest thing to show is
 * the last stamps it had, which the second hand then decays to gray and to
 * nothing exactly as it would on the card that is no longer drawn either.
 *
 * @param {number} [now] - ms epoch
 * @param {HTMLElement} [host] - the dialog; the mounted one by default
 * @returns {boolean} whether an open dialog was refreshed
 */
export const refreshAgentDialog = (now = Date.now(), host = agentHost) => {
  const key = host && host.dataset.agentOpen;
  if (!key) return false;
  const entry = agents.get(key);
  if (!entry) return false;

  const rows = host.querySelector('[data-agent-rows]');
  const markup = agentRows(entry, now);
  // A poll paints twice - once as the read starts and once as it lands - so the
  // write is behind the comparison, like every write the second hand makes.
  if (rows && rows.innerHTML !== markup) rows.innerHTML = markup;

  const head = host.querySelector('[data-agent-head]');
  if (!head) return true;
  const live = head.querySelector('[data-live-ts]');
  const stamps = liveStamps(entry);
  // Patching keeps the glyph that is already turning; redrawing is for the case
  // where there is no glyph to keep - the indicator aged out of the walk, or
  // the fresh entry carries no timestamp for the tick to read.
  if (live && stamps.liveTs) {
    for (const [name, value] of Object.entries(stamps)) {
      if (live.dataset[name] !== value) live.dataset[name] = value;
    }
    // A stamp the fresh entry no longer carries comes OFF - the tick would
    // otherwise keep reading a fact the agent stopped reporting.
    for (const name of ['liveTs', 'liveAlive']) {
      if (!(name in stamps) && name in live.dataset) delete live.dataset[name];
    }
    applyLive(head, now);
  } else {
    // The badges and the title are session-constant in the crew payload, so
    // only this aged-out/returning branch redraws them - behind the same
    // comparison every other write makes.
    const fresh = agentHead(entry, now);
    if (head.innerHTML !== fresh) head.innerHTML = fresh;
  }
  return true;
};

/**
 * Wire the agent dialog on this page.
 *
 * Idempotent the same way the issue dialog is, and just as quiet on a page that
 * does not ship the shell.
 *
 * @param {object} [options]
 * @param {Document|HTMLElement} [options.scope] - where to look for the dialog
 * @returns {void}
 */
export function mountAgentModal({ scope = document } = {}) {
  const dialog = scope.querySelector('#tower-agent');
  if (!dialog || dialog.dataset.towerMounted) return;
  dialog.dataset.towerMounted = '1';

  const title = dialog.querySelector('[data-agent-title]');
  const body = dialog.querySelector('[data-agent-body]');
  agentHost = body;

  // Which agent is on screen, written where the refresh can read it back - the
  // dialog itself is the one thing that outlives every paint, so it is where
  // that fact belongs. A closed dialog carries no key and is refreshed by
  // nothing.
  dialog.addEventListener('hidden.bs.modal', () => { delete body.dataset.agentOpen; });

  openFrom('agent', (key) => {
    const entry = agents.get(key);
    if (!entry) {
      console.warn(`[tower] no agent registered for ${key}`);
      return;
    }
    const parts = agentDialog(entry, Date.now());
    title.innerHTML = parts.title;
    body.innerHTML = parts.body;
    body.dataset.agentOpen = key;
    window.bootstrap.Modal.getOrCreateInstance(dialog).show();
  });
}
