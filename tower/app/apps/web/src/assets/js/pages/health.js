//
// Health — the repo tiles as a real page.
//
// The release lag leads: unreleased CHANGELOG entries and unpushed commits are
// work that is DONE and not delivered, which is the only thing on this page
// that asks for a decision. It is ranked worst-first and drawn as a chart, so
// the answer to "what should ship next" is the top bar. The per-repo cards
// follow, each carrying its own numbers and its own open-issue split by status.
//

import { startPage } from '../libs/tower/page.js';
import { issuesFor, reposFor, health, feed } from '../libs/tower/state.js';
import {
  esc, num, empty, problem, statCell, statgrid, card, STATUSES, statusColor,
} from '../libs/tower/format.js';
import { chartSlot, barChart } from '../libs/tower/charts.js';
import { loading, swap } from '../libs/tower/loading.js';
import { issueTrigger, externalLink } from '../libs/tower/modal.js';

/** One repo's open issues, from the board sweep, matched on its slug. */
const issuesOf = (state, repo) => issuesFor(state).filter((issue) => issue.repo === repo.slug);

/** A safe canvas id from a repo slug — ids cannot carry slashes or dots. */
const canvasId = (repo) => `health-${String(repo.slug || repo.path).replace(/[^a-zA-Z0-9]+/g, '-')}`;

// ── The release lag ────────────────────────────────────────────────────────
// "Work sitting on the table" is unreleased entries plus unpushed commits. A
// repo with neither is not listed: this section is a queue, not a census.
const lagRows = (state) => reposFor(state)
  .map((repo) => {
    const reading = health(state)[repo.path];
    if (!reading || reading.error) return null;
    const unreleased = typeof reading.unreleasedEntries === 'number' ? reading.unreleasedEntries : 0;
    const unpushed = typeof reading.unpushed === 'number' ? reading.unpushed : 0;
    return { repo, unreleased, unpushed, total: unreleased + unpushed, lastTag: reading.lastTag };
  })
  .filter((row) => row && row.total > 0)
  .sort((a, b) => b.total - a.total);

const releaseLag = (rows) => {
  const body = rows.length
    ? `${chartSlot('health-lag', 40 + rows.length * 32, rows.map((row) => row.total))}
      <div class="table-responsive mt-3"><table class="table table-sm align-middle mb-0">
        <thead><tr><th>repo</th><th class="text-end">unreleased</th><th class="text-end">unpushed</th><th class="text-end">last tag</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td>${esc(row.repo.name)}</td>
          <td class="text-end">${esc(row.unreleased)}</td>
          <td class="text-end">${esc(row.unpushed)}</td>
          <td class="text-end classy-micro">${esc(row.lastTag || 'never tagged')}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : empty('nothing is waiting to ship — every entry is released and every commit is pushed');
  return card('Work sitting on the table', body, { chip: rows.length, alarm: rows.length > 0, class: 'mb-4' });
};

// ── One repo ───────────────────────────────────────────────────────────────
const repoCard = (state, repo, alone) => {
  const reading = health(state)[repo.path];
  const issues = issuesOf(state, repo);

  let body;
  if (!reading) {
    body = empty('no reading yet');
  } else if (reading.error) {
    // A repo that could not be read says so. Zeros would read as "clean".
    body = `<div class="alert alert-danger mb-0">${esc(reading.error)}</div>`;
  } else {
    body = `${statgrid([
      statCell('Open issues', issues.length),
      statCell('Blocked', issues.filter((issue) => issue.status === 'blocked').length),
      statCell('Unpushed', num(reading.unpushed)),
      statCell('Uncommitted', num(reading.uncommitted)),
      statCell('Unreleased', num(reading.unreleasedEntries)),
      statCell('Last tag', reading.lastTag || '—'),
    ], 'mb-3')}
      ${chartSlot(canvasId(repo), 180, STATUSES.map((status) => issues.filter((issue) => (issue.status || '') === status.key).length))}
      ${alone ? issueList(issues) : ''}`;
  }

  return `<div class="col-12 ${alone ? '' : 'col-xl-6'}">
    ${card(repo.name, body, { class: 'h-100' })}
  </div>`;
};

// The single-repo view has the room to name the issues, not only count them.
const issueList = (issues) => (issues.length
  ? `<ul class="list-unstyled mt-3 mb-0">${issues.map((issue) => `<li class="py-1 omega-tower-issue d-flex gap-2 align-items-center" ${issueTrigger(issue)}>
      <span class="classy-chip">${esc(issue.status || 'no status')}</span>
      <span class="text-truncate flex-grow-1">#${esc(issue.number)} ${esc(issue.title)}</span>
      ${externalLink(issue.url)}
    </li>`).join('')}</ul>`
  : '');

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const roster = feed(state, 'repos');
  const readings = feed(state, 'health');
  const list = reposFor(state);
  const alone = list.length === 1;

  if (roster && !roster.ok) {
    swap(root, problem(roster.reason));
    return;
  }
  if (!list.length) {
    swap(root, roster ? empty('no repos in the roster — nothing has opted in under the roster root') : loading('reading the roster…'));
    return;
  }

  // The charts are redrawn only when the markup carrying their canvases was
  // actually written — an unchanged tick leaves the drawn ones standing.
  const rows = lagRows(state);
  if (!swap(root, `
    ${readings && !readings.ok ? `<div class="mb-4">${problem(readings.reason)}</div>` : ''}
    ${releaseLag(rows)}
    <div class="row g-4">
      ${list.map((repo) => repoCard(state, repo, alone)).join('')}
    </div>
  `)) return;

  if (rows.length) {
    barChart('health-lag', {
      labels: rows.map((row) => row.repo.name),
      values: rows.map((row) => row.total),
      horizontal: true,
      label: 'unreleased + unpushed',
    });
  }
  for (const repo of list) {
    const reading = health(state)[repo.path];
    if (!reading || reading.error) continue;
    const issues = issuesOf(state, repo);
    barChart(canvasId(repo), {
      labels: STATUSES.map((status) => status.label),
      values: STATUSES.map((status) => issues.filter((issue) => (issue.status || '') === status.key).length),
      colors: STATUSES.map((status) => statusColor(status.key)),
      label: 'open issues',
    });
  }
};

export default () => startPage({
  mount: 'tower-health',
  feeds: ['repos', 'board', 'health'],
  charts: true,
  render,
});
