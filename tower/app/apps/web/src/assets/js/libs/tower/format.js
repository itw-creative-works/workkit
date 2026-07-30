//
// The vocabulary every tower page shares: escaping, the status pipeline, and
// the handful of markup shapes that repeat. Not a page — nothing here fetches
// or draws on its own, so escaping and filtering are written once and mean the
// same thing on every surface.
//

/**
 * HTML-escape a value for interpolation into a template string.
 *
 * EVERY GitHub-sourced value goes through this: issue titles, labels, repo
 * slugs and assignee handles are all attacker-controlled text as far as the
 * tower is concerned, and a hostile title must render as text.
 */
export const esc = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A count that may legitimately be unknown — null renders as a dash, not 0. */
export const num = (value) => (value === null || value === undefined ? '—' : String(value));

/** One "nothing here" line, in the theme's muted voice. */
export const empty = (message) => `<p class="text-body-secondary mb-0">${esc(message)}</p>`;

/** The line a page shows where a section would be when its feed did not answer. */
export const problem = (message) => `<div class="alert alert-warning mb-0">${esc(message)}</div>`;

/**
 * What a published copy says where a MACHINE-BOUND surface would be — the crew,
 * the token spend and the per-repo git health are read off transcripts,
 * processes and working copies, and a browser away from that machine has none
 * of them. One sentence, one home, said by the whole page on those three pages
 * and by the single panel on the Overview that shows the same data.
 */
export const LOCAL_ONLY_NOTICE = 'This reads the machine the tower runs on — its sessions, its transcripts, its working copies — so it is local only. Open the dashboard on that machine to see it.';

/** That sentence as markup, in the same muted voice as an empty state. */
export const localOnlyNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCAL_ONLY_NOTICE)}</p>`;

/**
 * What a LOCKED copy says where a write would be. It has no data at all yet, so
 * the answer is "hand this one a token" — and once it has one there is nothing
 * left to say: an unlocked copy files and moves issues with that token exactly
 * as the dashboard on the machine does.
 */
export const LOCKED_NOTICE = 'This copy has no data until a GitHub token is added — open any page to hand one over. With one it files and moves issues just like the dashboard on your machine.';

/** That sentence as markup. */
export const lockedNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCKED_NOTICE)}</p>`;

/**
 * The one name for one issue: `repo#number`.
 *
 * Three things spell it — the `data-issue` attribute a card carries, the dialog
 * registry it is looked up in, and the Board's drop, which reads that attribute
 * off a dragged card and finds the issue in the live board payload. One home for
 * it, so the three cannot mean different things.
 */
export const issueKey = (issue) => `${issue.repo}#${issue.number}`;

/** The last path segment of a repo path — what a session's cwd is shown as. */
export const shortPath = (value) => String(value || '').split('/').filter(Boolean).pop() || String(value || '');

/** 1234567 → "1.23M". Token counts are large and the exact digit never matters. */
export const compact = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

/** A dollar amount, at the precision a per-session cost is actually known to. */
export const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(n >= 10 ? 2 : 3)}`;
};

//
// The status pipeline, in the order the board reads left to right, plus the
// column for issues carrying no status label at all. It mirrors the `status`
// group in the workflow label SSOT the API reads, and is restated here only
// because a column has to exist while it is EMPTY, which no amount of looking
// at the data can tell you.
//
export const STATUSES = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'specced', label: 'Specced' },
  { key: 'building', label: 'Building' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'parked', label: 'Parked' },
  { key: '', label: 'No status' },
];

/** The theme token a status is drawn in, on cards and in charts. */
export const statusToken = (key) => ({
  inbox: '--omega-chart-2',
  specced: '--omega-ok',
  building: '--omega-warn',
  blocked: '--omega-danger',
  parked: '--omega-ink-faint',
}[key] || '--omega-ink-muted');

/** The resolved colour for a status — CSS custom properties, so dark mode follows. */
export const statusColor = (key) => `var(${statusToken(key)})`;

//
// ── Models and agent classes ───────────────────────────────────────────────
//
// A model and a crew class are said on three surfaces — the Crew cards, the
// Usage table, the Usage charts — and each is drawn in one colour on all of
// them, so a glance at the chart and a glance at a card agree.
//
// The split of homes is deliberate. What lives HERE is which name falls in
// which slot, because only code can read `claude-opus-5[1m]` as opus. The
// COLOURS are the framework's categorical ramp — `.omega-tone-1..6` sets
// `--omega-tone` from `--omega-chart-1..6` and `.omega-badge-tone` paints a
// chip with it — which is what makes dark mode follow, and makes a bar on the
// Usage chart and the badge beside it the same colour for the same thing.
//

// Ordered longest-lived first only for readability; the ids they match are
// disjoint, so no name can fall in two slots. `<synthetic>` — Claude Code's
// locally generated messages — matches none of them and draws as `other`.
const MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];

/**
 * The badge slot a model id is drawn in.
 *
 * Ids arrive decorated the same way the API's pricing table sees them — a
 * dated build (`claude-opus-4-1-20250805`), a context variant
 * (`claude-opus-5[1m]`) — and every decoration of one family is that family.
 *
 * @param {string} model a model id, or anything at all
 * @returns {string} one of MODEL_FAMILIES, or 'other'
 */
export const modelKey = (model) => {
  const id = String(model || '').toLowerCase();
  return MODEL_FAMILIES.find((family) => id.includes(family)) || 'other';
};

// The crew, plus `manager` for the root tier — the name telemetry's byClass
// gives a main chat. Anything else Claude Code spawns (general-purpose and the
// built-ins) is drawn neutral rather than borrowing a crew colour.
const AGENT_CLASSES = ['manager', 'advisor', 'worker', 'verifier', 'scout', 'reviewer'];

/**
 * The badge slot an agent class is drawn in. `workkit:worker` and `worker` are
 * the same class — the API already strips the prefix, and this survives it
 * either way.
 *
 * @param {string} name an agent class
 * @returns {string} one of AGENT_CLASSES, or 'other'
 */
export const classKey = (name) => {
  const bare = String(name || '').split(':').pop().trim().toLowerCase();
  return AGENT_CLASSES.includes(bare) ? bare : 'other';
};

//
// The one mapping from a name to a tone slot, for both vocabularies at once —
// the keys are disjoint, so one table cannot be ambiguous. The ramp has six
// slots and the two vocabularies name ten things, so sharing is forced — the
// rule is WHO shares: each model takes the slot of a class that never runs it
// (workers and verifiers run opus, scouts sonnet, managers and advisors fable
// per the manager ladder, and a reviewer inherits the session's model — so
// opus avoids reviewer's slot too), so the class chip and the model chip that
// actually sit together on a crew card never match. Within a vocabulary a tone
// never repeats. `other` is absent on purpose: with no tone set,
// `.omega-badge-tone` paints itself in the muted ink it falls back to.
//
const TONES = {
  fable: 5, sonnet: 6, opus: 2, haiku: 4,
  manager: 1, scout: 2, reviewer: 3, advisor: 4, worker: 5, verifier: 6,
};

/** The colour of a slot, as a token a chart can resolve against :root. */
export const badgeColor = (key) => (TONES[key] ? `var(--omega-chart-${TONES[key]})` : 'var(--omega-ink-muted)');

/** One coloured chip. The label is the raw name — a model id is not a word. */
export const badge = (key, label) => `<span class="classy-chip omega-badge-tone${TONES[key] ? ` omega-tone-${TONES[key]}` : ''}">${esc(label)}</span>`;

/** The badge for a model id — an unknown model still gets one, saying so. */
export const modelBadge = (model) => badge(modelKey(model), model || 'model unknown');

/** The badge for an agent class. */
export const classBadge = (name) => badge(classKey(name), name || 'unknown');

/**
 * The first `limit` of a list, and how many that left behind.
 *
 * A panel on the Overview is a glance, not an inventory: past a handful of
 * rows it stops being read and starts pushing the panels under it off the
 * fold. The remainder is never dropped silently — every caller says how many
 * it is holding back and where the rest are.
 *
 * @param {Array} items
 * @param {number} [limit]
 * @returns {{shown: Array, hidden: number}}
 */
export const cap = (items, limit = 5) => {
  const list = items || [];
  return { shown: list.slice(0, limit), hidden: Math.max(0, list.length - limit) };
};

// ── The shapes that repeat ─────────────────────────────────────────────────

/**
 * One classy-statgrid tile. `href` makes it a link to the page that owns it.
 *
 * A tile says one number: the label holds one line and the value is never
 * broken across lines, so a long one ends in an ellipsis rather than stacking
 * "v3.5.0" one character per row.
 *
 * `note` is the tile's tooltip — what a value that is NOT a number means. A
 * dash is honest and mute, and the sentence behind it is the difference between
 * "nothing is happening" and "this cannot be read from here".
 */
export const statCell = (label, value, href, note) => {
  const title = note ? ` title="${esc(note)}"` : '';
  const inner = `<div class="classy-statgrid__label"><span class="classy-micro text-nowrap">${esc(label)}</span></div>
    <h3 class="classy-statgrid__value text-truncate">${esc(value)}</h3>`;
  return href
    ? `<a class="classy-statgrid__cell text-reset text-decoration-none" href="${esc(href)}"${title}>${inner}</a>`
    : `<div class="classy-statgrid__cell"${title}>${inner}</div>`;
};

/**
 * A row of tiles — as many per row as fit, so a narrow card wraps them.
 *
 * The reflow is the theme's own now: `.classy-statgrid` sizes off the
 * CONTAINER, with `--classy-statgrid-cols` as the ceiling, so a grid inside a
 * half-width repo card drops columns instead of overflowing.
 */
export const statgrid = (cells, extraClass = 'mb-4') => `<div class="classy-statgrid ${extraClass}">
  ${cells.join('')}
</div>`;

/** A Bootstrap card with the theme's panel head. `chip` is an optional count. */
export const card = (heading, body, options = {}) => `<div class="card ${options.class || ''}">
  <div class="card-body">
    <div class="classy-panel-head mb-3">
      <span class="text-truncate">${esc(heading)}</span>
      ${options.chip === undefined ? '' : `<span class="classy-chip${options.alarm ? ' classy-chip--accent' : ''}">${esc(options.chip)}</span>`}
      ${options.link ? `<a class="classy-chip text-decoration-none" href="${esc(options.link.href)}">${esc(options.link.label)}</a>` : ''}
    </div>
    ${body}
  </div>
</div>`;

/**
 * The chips that label one issue — its type, whether it is high priority,
 * whether an agent may take it, and who holds it.
 *
 * One row of markup for the Board's cards and the Brief's list, which say the
 * same four things about the same issue and had drifted into two copies of it.
 *
 * @param {object} issue one issue from /api/board or /api/brief
 * @param {string} [extraClass] spacing the caller's layout needs
 * @returns {string} markup
 */
export const issueChips = (issue, extraClass = '') => `<span class="d-flex flex-wrap align-items-center gap-1${extraClass ? ` ${extraClass}` : ''}">
  ${issue.type ? `<span class="classy-chip">${esc(issue.type)}</span>` : ''}
  ${issue.priority === 'high' ? '<span class="classy-chip classy-chip--accent">high</span>' : ''}
  ${issue.agentOk ? '<span class="classy-chip">agent:ok</span>' : ''}
  ${(issue.assignees || []).length ? `<span class="classy-micro">@${esc(issue.assignees.join(', @'))}</span>` : ''}
</span>`;

/** A status pill in the theme's three tones. */
export const pill = (tone, label) => `<span class="classy-status classy-status--${esc(tone)}"><span class="classy-dot classy-dot--${esc(tone)}"></span>${esc(label)}</span>`;
