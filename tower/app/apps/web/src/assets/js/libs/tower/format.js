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

/**
 * One "nothing here" state — a muted icon above one line.
 *
 * Quiet on purpose: an empty column and an empty panel are the normal condition
 * of a board that is up to date, so it is drawn in the theme's secondary ink at
 * half opacity and never as an alarm. The icon is the caller's, because "no
 * live sessions" and "nothing is waiting to ship" are different kinds of
 * nothing; the default is the neutral one, and every icon is the framework's
 * Font Awesome, decorative, with the line itself carrying the meaning.
 */
export const empty = (message, icon = 'fa-regular fa-folder-open') => `<div class="text-center text-body-secondary py-3">
  <i class="${esc(icon)} fa-lg d-block mb-2 opacity-50" aria-hidden="true"></i>
  <p class="omega-micro mb-0">${esc(message)}</p>
</div>`;

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
 * What a locked copy says where a write would be ON THIS MACHINE (issue #89).
 * A local page has no use for a token — the tower API holds the `gh` login — so
 * the answer is the same one its body gives: the tower is not there to read.
 */
export const LOCAL_LOCKED_NOTICE = 'This copy has no data until the tower API is running — start it with npm run tower and connect this page to it. Then it files and moves issues exactly as it does with a tower.';

/** That sentence as markup. */
export const localLockedNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCAL_LOCKED_NOTICE)}</p>`;

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
// The status pipeline, in the order the board reads left to right. It mirrors
// the `status` group in the workflow label SSOT the API reads, and is restated
// here only because a column has to exist while it is EMPTY, which no amount of
// looking at the data can tell you.
//
// Every entry is a place an issue LIVES. A missing `status:` label is not one
// of those — it is a fault the pipeline forbids and the daily heal repairs — so
// it is drawn as the alarm below rather than a sixth lane (#118).
//
export const STATUSES = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'specced', label: 'Specced' },
  { key: 'building', label: 'Building' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'parked', label: 'Parked' },
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

/**
 * The alarm the Board draws above its columns when open issues carry no
 * `status:` label at all (#118).
 *
 * They used to be a sixth column, which said "here is where these live". They
 * do not live anywhere: exactly one `status:` per open issue is the rule, the
 * daily heal repairs a breach of it, and a lane makes the breach look like a
 * resting place — while on a normal day taking board width to show nothing. So
 * they are named, linked and counted here instead, in the theme's danger tone
 * that no ordinary board state uses, and drawn NOWHERE else on the page.
 *
 * Here rather than in the page for the reason every other shape is: it is
 * markup from values, and the suite can ask what a hostile title renders as.
 * The issues handed in are the SCOPED ones (state.issuesFor) — an unlabelled
 * issue in a repo the board is not showing is not this board's alarm.
 *
 * @param {object[]} issues - the open issues in scope
 * @param {boolean} [showRepo] - whether the board is showing more than one repo
 * @returns {string} markup, or nothing at all when every issue is labelled
 */
/**
 * The status chart series — labels, values and colors in step, one entry per
 * pipeline status, plus a "No status" slice ONLY while an unlabeled issue
 * exists. The Board surfaces that state as its danger alert; a chart that
 * silently dropped those issues would sum short of the open count beside it,
 * so the slice keeps the ring and the number telling one story. Its color is
 * the non-status fallback ink, which no pipeline status is drawn in.
 *
 * @param {object[]} issues - open issues, each carrying `status` ('' for none)
 * @returns {{labels: string[], values: number[], colors: string[]}}
 */
export const statusBreakdown = (issues) => {
  const all = issues || [];
  const labels = STATUSES.map((status) => status.label);
  const values = STATUSES.map((status) => all.filter((issue) => issue.status === status.key).length);
  const colors = STATUSES.map((status) => statusColor(status.key));
  const missing = all.filter((issue) => !issue.status).length;
  if (missing) {
    labels.push('No status');
    values.push(missing);
    colors.push(statusColor(''));
  }
  return { labels, values, colors };
};

export const noStatusAlert = (issues, showRepo = true) => {
  const missing = (issues || []).filter((issue) => !issue.status);
  if (!missing.length) return '';
  return `<div class="alert alert-danger mb-3" role="alert">
  <p class="mb-2">${missing.length} issue${missing.length === 1 ? ' carries' : 's carry'} no status label</p>
  <ul class="list-unstyled mb-0">
    ${missing.map((issue) => `<li><a href="${esc(issue.url)}" target="_blank" rel="noopener">${showRepo ? `${esc(issue.repo)} ` : ''}#${esc(issue.number)} — ${esc(issue.title)}</a></li>`).join('')}
  </ul>
</div>`;
};

//
// ── Priority ───────────────────────────────────────────────────────────────
//
// `priority:high|low` is a group of its own, and the middle of it is the label
// that is ABSENT — normal priority is never written on an issue, so there are
// three bands and only two of them have a name to draw.
//
// A priority chip and a status chip sit side by side in the issue dialog, so
// the ATTENTION end may not be borrowed from the pipeline: high takes the
// theme's signal accent, which no status is drawn in, and a `high` chip
// therefore can never be misread as a status. The quiet end shares `parked`'s
// faint ink deliberately — the two say the same thing about urgency, and the
// alternative, the muted ink every plain chip already carries, would leave a
// `low` chip indistinguishable from an undyed one.
//

/** The theme token a priority is drawn in; the unlabelled middle is neutral. */
export const priorityToken = (key) => ({
  high: '--omega-accent',
  low: '--omega-ink-faint',
}[key] || '--omega-ink-muted');

/** Where a priority sorts: high first, the unlabelled middle next, low last. */
export const priorityRank = (key) => (key === 'high' ? 0 : key === 'low' ? 2 : 1);

/**
 * The order issues are read in inside one Board column — the three priority
 * bands, most recently updated first within each.
 *
 * Pure, and here rather than in the page, because the band definition is the
 * same one `priorityToken` colours and the brief's own sort ranks.
 */
export const byPriority = (a, b) => {
  const spread = priorityRank(a.priority) - priorityRank(b.priority);
  if (spread !== 0) return spread;
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
};

//
// ── The glyphs ─────────────────────────────────────────────────────────────
//
// What a `type:` and a `priority:` chip wear before their label (issue #136),
// so a column of cards is read at a glance rather than word by word. One table
// for both vocabularies, the way TONES below holds models and classes at once —
// the keys are disjoint, so one table cannot be ambiguous, and the two chips
// that sit side by side on every card cannot drift into two homes.
//
// The picks say the thing rather than encode it: the bug is a bug, an
// enhancement is the wand that improves what is already there, an idea is the
// lamp, and the priority ends are arrows pointing where the band sits. The lamp
// is the advisor's role glyph too (agent.js), which is fine — a role glyph is
// drawn on the Crew page and in the agent dialog, and no surface that draws an
// issue chip shows one, so the two never say different things in one place.
//
// Free Font Awesome, every one of them, drawn by the framework's shared
// renderer the same way every other glyph the tower writes is.
//
export const CHIP_GLYPHS = {
  bug: 'fa-bug',
  enhancement: 'fa-wand-magic-sparkles',
  idea: 'fa-lightbulb',
  high: 'fa-angles-up',
  low: 'fa-angles-down',
};

/**
 * The glyph markup for a chip, or nothing at all for a name that has none.
 *
 * Decorative beside the word it repeats, so it is out of the accessibility tree
 * and is no new focus target; it takes no colour of its own, which leaves it in
 * whatever tone the chip around it is painted.
 *
 * It carries its OWN spacing, the framework's `me-1`, because the chip it sits
 * in is no flex row to gap (see below) — without it the glyph is flush against
 * the word. The other half of sitting right is vertical, and that one is the
 * sheet's: `main.scss` nudges the svg the renderer fills this `<i>` with.
 */
const chipGlyph = (key) => (CHIP_GLYPHS[key] ? `<i class="fa-solid ${CHIP_GLYPHS[key]} me-1" aria-hidden="true"></i>` : '');

/**
 * One chip painted in a theme token, optionally wearing a glyph.
 *
 * The framework's tone chip is the mechanism — `.omega-badge-tone` paints
 * whatever `--omega-tone` holds — and the token is set inline instead of by an
 * `.omega-tone-N` class, because status and priority are drawn from the theme's
 * semantic slots rather than from the categorical ramp. `text-uppercase` puts
 * back the case the tone chip turns off for model ids: these labels are words,
 * and they sit in a row with plain chips that are uppercase.
 *
 * The chip is an inline-BLOCK, whatever `.omega-chip` says: the theme's
 * `.omega-badge-tone` sets `display: inline-block` and comes after it at equal
 * specificity, so the chip's flex `gap` never applies and a glyph inside one is
 * laid out on the text's own line. That is why the glyph brings its own margin
 * (chipGlyph) instead of leaning on a gap that is not there — and the display
 * is the theme's to own, so nothing here tries to change it back.
 *
 * The glyph is the caller's, not looked up here: WHICH chips wear one is a
 * decision, and a status chip wearing none is that decision made rather than a
 * name that happens to be missing from the table.
 */
const toneChip = (label, token, glyph = '') => `<span class="omega-chip omega-badge-tone text-uppercase" style="--omega-tone: var(${token});">${glyph}${esc(label)}</span>`;

/**
 * The chip for an issue's status — the same colour the Board's column header
 * draws that status in, so the dialog and the column agree.
 */
export const statusChip = (status) => (status ? toneChip(status, statusToken(status)) : '');

/** The chip for an issue's priority. The unlabelled middle draws nothing. */
export const priorityChip = (priority) => (priority === 'high' || priority === 'low' ? toneChip(priority, priorityToken(priority), chipGlyph(priority)) : '');

/**
 * The theme token a type is drawn in. A type is an identity, not a signal, so
 * it draws from the categorical ramp — and only from slots no status or
 * priority speaks in (`inbox` holds chart-2, `high` holds the accent, which is
 * chart-1), for the same reason `high` may not borrow a status colour: two
 * vocabularies in one row must never share a hue.
 */
export const typeToken = (key) => ({
  bug: '--omega-chart-4',
  enhancement: '--omega-chart-3',
  idea: '--omega-chart-5',
}[key]);

/**
 * The chip for an issue's type. A type outside the vocabulary stays plain — no
 * colour and no glyph, since both are named per type and an unknown one has
 * neither.
 */
export const typeChip = (type) => {
  if (!type) return '';
  const token = typeToken(type);
  return token ? toneChip(type, token, chipGlyph(type)) : `<span class="omega-chip">${esc(type)}</span>`;
};

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
export const badge = (key, label) => `<span class="omega-chip omega-badge-tone${TONES[key] ? ` omega-tone-${TONES[key]}` : ''}">${esc(label)}</span>`;

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
 * One omega-statgrid tile. `href` makes it a link to the page that owns it.
 *
 * A tile says one number: the label holds one line and the value is never
 * broken across lines, so a long one ends in an ellipsis rather than stacking
 * "v3.5.0" one character per row.
 *
 * `note` is the tile's tooltip — what a value that is NOT a number means. A
 * dash is honest and mute, and the sentence behind it is the difference between
 * "nothing is happening" and "this cannot be read from here".
 *
 * `sub` is one short line UNDER the number — how it compares with a week ago
 * (issue #55). It is drawn only when there is something to say: a tile with no
 * comparison keeps exactly the shape it had.
 */
export const statCell = (label, value, href, note, sub) => {
  const title = note ? ` title="${esc(note)}"` : '';
  const inner = `<div class="omega-statgrid__label"><span class="omega-micro text-nowrap">${esc(label)}</span></div>
    <h3 class="omega-statgrid__value text-truncate">${esc(value)}</h3>${sub ? `
    <p class="omega-micro text-body-secondary mb-0 text-truncate">${esc(sub)}</p>` : ''}`;
  return href
    ? `<a class="omega-statgrid__cell text-reset text-decoration-none" href="${esc(href)}"${title}>${inner}</a>`
    : `<div class="omega-statgrid__cell"${title}>${inner}</div>`;
};

/**
 * A row of tiles — as many per row as fit, so a narrow card wraps them.
 *
 * The reflow is the theme's own now: `.omega-statgrid` sizes off the
 * CONTAINER, with `--omega-statgrid-cols` as the ceiling, so a grid inside a
 * half-width repo card drops columns instead of overflowing.
 */
export const statgrid = (cells, extraClass = 'mb-4') => `<div class="omega-statgrid ${extraClass}">
  ${cells.join('')}
</div>`;

/** A Bootstrap card with the theme's panel head. `chip` is an optional count. */
export const card = (heading, body, options = {}) => `<div class="card ${options.class || ''}">
  <div class="card-body">
    <div class="omega-panel-head mb-3">
      <span class="text-truncate">${esc(heading)}</span>
      ${options.chip === undefined ? '' : `<span class="omega-chip${options.alarm ? ' omega-chip--accent' : ''}">${esc(options.chip)}</span>`}
      ${options.link ? `<a class="omega-chip text-decoration-none" href="${esc(options.link.href)}">${esc(options.link.label)}</a>` : ''}
    </div>
    ${body}
  </div>
</div>`;

/**
 * The chips saying what an issue is WAITING on (issue #103) — one per blocker,
 * and only while that blocker is still on the board.
 *
 * A dependency is advisory: nothing about the pipeline changes because of one,
 * so it is drawn in the plain muted chip every undyed value uses rather than
 * borrowing a status or priority hue. A blocker in the same repo is said the
 * short way, the way the issue's own author would write it; one in another repo
 * carries its slug, since `#12` there is a different issue.
 *
 * The blocker's repo is remote text like every other value here, so it is
 * escaped along with the rest. Repo names are case-insensitive on GitHub and
 * the inline fallback is hand-typed, so every comparison folds case.
 *
 * @param {object} issue one issue from /api/board or /api/brief
 * @param {Set<string>} [open] the sweep's `repo#number` keys, lowercased
 * @returns {string} markup, or nothing when it waits on nothing the board holds
 */
export const waitsOnChips = (issue, open) => (issue.blockedBy || [])
  .filter((blocker) => open && open.has(issueKey(blocker).toLowerCase()))
  .map((blocker) => `<span class="omega-chip">${esc(`waits on ${String(blocker.repo).toLowerCase() === String(issue.repo).toLowerCase() ? `#${blocker.number}` : issueKey(blocker)}`)}</span>`)
  .join('');

/**
 * The chips that label one issue — its type, its priority, what it waits on,
 * whether an agent may take it, and who holds it.
 *
 * One row of markup for the Board's cards and the Brief's list, which say the
 * same things about the same issue and had drifted into two copies of it.
 *
 * @param {object} issue one issue from /api/board or /api/brief
 * @param {string} [extraClass] spacing the caller's layout needs
 * @param {Set<string>} [open] the sweep's `repo#number` keys — what a "waits on"
 *   chip is judged against; without it the row says nothing about dependencies
 * @returns {string} markup
 */
export const issueChips = (issue, extraClass = '', open = null) => `<span class="d-flex flex-wrap align-items-center gap-1${extraClass ? ` ${extraClass}` : ''}">
  ${typeChip(issue.type)}
  ${priorityChip(issue.priority)}
  ${waitsOnChips(issue, open)}
  ${issue.agentOk ? '<span class="omega-chip">agent:ok</span>' : ''}
  ${(issue.assignees || []).length ? `<span class="omega-micro">@${esc(issue.assignees.join(', @'))}</span>` : ''}
</span>`;

/** A status pill in the theme's three tones. */
export const pill = (tone, label) => `<span class="omega-status omega-status--${esc(tone)}"><span class="omega-dot omega-dot--${esc(tone)}"></span>${esc(label)}</span>`;
