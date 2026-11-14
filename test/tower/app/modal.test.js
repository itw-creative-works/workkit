//
// Tests for the tower dashboard's modal.js: the issue dialog, its dependencies,
// an issue as a list item, and a published document. Prologue: ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

const ISSUE = {
  repo: 'ITW/workkit',
  number: 31,
  title: 'Issues open in a modal',
  url: 'https://github.com/ITW-Creative-Works/workkit/issues/31',
  body: '## Description\n\nThe body.',
  bodyTruncated: false,
  comments: 2,
  createdAt: '2026-07-20T10:00:00Z',
  updatedAt: '2026-07-27T10:00:00Z',
  status: 'specced',
  type: 'enhancement',
  priority: 'high',
  agentOk: true,
  assignees: ['alice'],
};

// The renderer is the framework's, handed over by the mount, so the questions
// left are the tower's own: is the raw body what gets handed over, and does
// what comes back land in the body's container. Markdown safety is upstream's.
const rendered = [];
const render = (text) => {
  rendered.push(text);
  return text ? `<p data-rendered>${text}</p>` : '';
};

let format, modal;
before(async () => { ({ format, modal } = await loadLibs()); });

describe('tower/app: modal - the issue dialog', () => {
  test('a trigger carries the key and the keyboard affordance a div needs', () => {
    const attrs = modal.issueTrigger(ISSUE);
    expect(attrs.includes('data-issue="ITW/workkit#31"'), 'the repo and number are the key').toBeTruthy();
    expect(attrs.includes('role="button"') && attrs.includes('tabindex="0"'), 'and it is reachable without a mouse').toBeTruthy();
    // The Board reads that same attribute back off a dragged card to find which
    // issue was moved, so the key has exactly one spelling - format.js's.
    expect(attrs.includes(`data-issue="${format.issueKey(ISSUE)}"`), 'and the shared key is what the attribute carries').toBeTruthy();
  });

  test('the external link is the only thing that leaves for GitHub', () => {
    const link = modal.externalLink(ISSUE.url, 'ms-2');
    expect(link.includes(`href="${ISSUE.url}"`), 'it points at the issue').toBeTruthy();
    expect(link.includes('target="_blank"') && link.includes('rel="noopener"'), 'in a new tab, safely').toBeTruthy();
    expect(link.includes('aria-label="Open on GitHub"'), 'and says what it does').toBeTruthy();
    expect(link.includes('class="omega-tower-external ms-2"'), 'the caller can place it').toBeTruthy();
    expect(link.includes('<i class="fa-solid fa-arrow-up-right-from-square"'), 'the glyph is the framework\'s one icon mechanism').toBeTruthy();
    expect(!link.includes('<svg'), 'and not a hand-drawn one the renderer never sees').toBeTruthy();
  });

  test('the dialog says everything the issue knows', () => {
    const parts = modal.issueDialog(ISSUE, render);
    expect(parts.title.includes('ITW/workkit #31'), 'repo and number').toBeTruthy();
    expect(parts.title.includes('Issues open in a modal'), 'and the title').toBeTruthy();
    expect(parts.actions.includes('target="_blank"'), 'the external button is the header action').toBeTruthy();
    expect(parts.body.includes('>specced<'), 'the status').toBeTruthy();
    expect(parts.body.includes('>enhancement<') && parts.body.includes('agent:ok'), 'and the chips').toBeTruthy();
    expect(parts.body.includes('unclaimed') && !parts.body.includes('held by'),
      'an assignee without agent:claimed holds nothing: an assignee is a person, not the claim').toBeTruthy();
    expect(/filed .* · updated /.test(parts.body), 'both dates').toBeTruthy();
    expect(rendered[rendered.length - 1], 'the renderer is handed the raw body, markdown and all').toBe(ISSUE.body);
    expect(parts.body.includes(`<div class="omega-tower-issue__body"><p data-rendered>${ISSUE.body}</p></div>`), 'and what it answers is the body of the dialog').toBeTruthy();
    expect(parts.body.includes('2 comments on GitHub'), 'and where the conversation is').toBeTruthy();
  });

  test('the held line is the agent:claimed label, never an assignee', () => {
    for (const status of ['specced', 'building']) {
      const claimed = modal.issueDialog({ ...ISSUE, status, agentClaimed: true, assignees: [] }, render);
      expect(claimed.body.includes('held by workkit-agent[bot]'), `a ${status} issue carrying the label is held by the agent`).toBeTruthy();
      expect(!claimed.body.includes('unclaimed'), `and a ${status} claim never also reads as unclaimed`).toBeTruthy();
      const assigned = modal.issueDialog({ ...ISSUE, status, agentClaimed: false, assignees: ['alice'] }, render);
      expect(assigned.body.includes('unclaimed'), `a ${status} issue with an assignee alone is unclaimed`).toBeTruthy();
      expect(!assigned.body.includes('held by'), `and its assignee is never named as the holder on a ${status} issue`).toBeTruthy();
    }
  });

  test('the dialog’s date rows say a dash where the issue carried no date', () => {
    // The shared formatter leaves an unreadable date as nothing by default, but
    // a row labelled "filed" has to say something, so the dialog asks for a dash.
    const parts = modal.issueDialog({ ...ISSUE, createdAt: '', updatedAt: '' }, render);
    expect(parts.body.includes('filed -') && parts.body.includes('updated -'),
      'a labelled row says a dash rather than trailing off into nothing').toBeTruthy();
  });

  test('the dialog’s status chip is the colour of the column the card came from', () => {
    const parts = modal.issueDialog(ISSUE, render);
    expect(parts.body.includes(format.statusChip('specced')), 'the dialog draws format.js’s status chip').toBeTruthy();
    expect(parts.body.includes(`--omega-tone: ${format.statusColor('specced')}`),
      'so the dialog and the Board column header say specced in one colour').toBeTruthy();
    const bare = modal.issueDialog({ ...ISSUE, status: '', priority: '', type: '' }, render);
    expect(!bare.body.includes('omega-badge-tone'), 'and an issue with no status carries no status chip').toBeTruthy();
  });

  test('the dialog’s type and priority chips wear the card’s glyphs (#136)', () => {
    const parts = modal.issueDialog({ ...ISSUE, type: 'idea', priority: 'low' }, render);
    expect(parts.body.includes('<i class="fa-solid fa-lightbulb me-1" aria-hidden="true"></i>idea'), 'the type, glyph then word').toBeTruthy();
    expect(parts.body.includes('<i class="fa-solid fa-angles-down me-1" aria-hidden="true"></i>low'), 'and the priority the same way').toBeTruthy();
    expect(parts.body.includes(format.typeChip('idea')) && parts.body.includes(format.priorityChip('low')),
      'both are format.js’s own chips, so the dialog and the card cannot draw one thing two ways').toBeTruthy();
    const glyphs = Object.values(format.CHIP_GLYPHS).filter((glyph) => parts.body.includes(glyph));
    expect(glyphs.length, 'and exactly those three - the status chip sitting with them wears its own glyph (#149)').toBe(3);
  });

  test('an issue with nothing on it still opens', () => {
    const bare = modal.issueDialog({ repo: 'r', number: 1, url: 'https://example.com/1', title: 'bare' }, render);
    expect(bare.body.includes('No description.'), 'an empty body says so').toBeTruthy();
    expect(bare.body.includes('unclaimed'), 'and nobody holding it says that').toBeTruthy();
    expect(bare.body.includes('0 comments'), 'a missing count is zero, not undefined').toBeTruthy();
    expect(bare.body.includes('-'), 'and a missing date is a dash').toBeTruthy();
  });

  test('a truncated body admits it', () => {
    const cut = modal.issueDialog({ ...ISSUE, bodyTruncated: true }, render);
    expect(cut.body.includes('the rest is on GitHub'), 'the dialog says what it is not showing').toBeTruthy();
  });

  test('a blocked issue’s dialog says the question it is waiting on, and no other one does (#205)', () => {
    // A blocked issue's question is a comment on it, so the last comment is the
    // signal the sweep carries. Only `blocked` draws it: the newest comment on a
    // moving issue is not a question anybody waits on.
    const blocked = modal.issueDialog({ ...ISSUE, status: 'blocked', lastComment: 'Which of the two?' }, render);
    expect(blocked.body.includes('Which of the two?'), 'the question is in the dialog').toBeTruthy();
    expect(blocked.body.includes('<strong>Open question</strong>'), 'labelled as what it is').toBeTruthy();
    const alertBlock = (blocked.body.match(/<div class="alert alert-danger[^>]*>[\s\S]*?<\/div>/) || [''])[0];
    expect(alertBlock.includes('omega-tower-issue__question') && !alertBlock.includes('omega-micro'),
      'in a danger alert with plain-case text, never the muted small-caps line').toBeTruthy();
    const moving = modal.issueDialog({ ...ISSUE, status: 'qa', lastComment: 'shipped it' }, render);
    expect(!moving.body.includes('shipped it') && !moving.body.includes('omega-tower-issue__question'),
      'an issue that is moving draws none - its last comment is not a question').toBeTruthy();
    const silent = modal.issueDialog({ ...ISSUE, status: 'blocked', lastComment: '' }, render);
    expect(!silent.body.includes('omega-tower-issue__question'),
      'and a blocked issue nobody has commented on draws none either').toBeTruthy();
    const hostile = modal.issueDialog({ ...ISSUE, status: 'blocked', lastComment: '<img src=x onerror=alert(1)>' }, render);
    expect(!hostile.body.includes('<img'), 'a comment is remote text like every other value here').toBeTruthy();
    expect(hostile.body.includes('&lt;img src=x'), 'and shows as what it says').toBeTruthy();
  });

  test('a mount without a renderer fails there, not at the first click', () => {
    let thrown = null;
    try {
      // The scope stub keeps Node's missing `document` (the destructuring
      // default) out of the way - the guard is what is under test.
      modal.mountIssueModal({ scope: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'the missing renderer is refused at the mount').toBeTruthy();
    expect(thrown.message.includes('render'), 'and the error names what is missing').toBeTruthy();
  });

  test('every field the dialog writes itself reaches it as text', () => {
    const nasty = modal.issueDialog({
      ...ISSUE,
      title: '<img src=x onerror=alert(1)>',
      assignees: ['<b>me</b>'],
      status: '<i>x</i>',
    }, render);
    expect(!nasty.title.includes('<img'), 'the title is escaped').toBeTruthy();
    expect(!nasty.body.includes('<b>me</b>'), 'the handle is escaped').toBeTruthy();
    expect(!nasty.body.includes('<i>x</i>'), 'and so is the status chip').toBeTruthy();
    // The body is the one field this file does not escape itself: it is the
    // renderer's, which escapes first (@omega.js/client's utilities suite).
  });
});

describe('tower/app: modal - what an issue depends on', () => {
  // One board with one dependency, drawn twice over: two issues, one cross-repo,
  // both wait on a third. The second reference is spelled in another case on
  // purpose: GitHub repo names are case-insensitive and the inline `Depends on:`
  // fallback is hand-typed, so the two spellings are one edge.
  const BLOCKER = { ...ISSUE, number: 10, title: 'the one holding things up' };
  const WAITER = {
    ...ISSUE, number: 11, title: 'waiting on it', blockedBy: [{ repo: 'ITW/workkit', number: 10 }],
  };
  const ELSEWHERE = {
    ...ISSUE, repo: 'ITW/other', number: 12, title: 'waiting from another repo', blockedBy: [{ repo: 'itw/WORKKIT', number: 10 }],
  };
  const BOARD = [BLOCKER, WAITER, ELSEWHERE];

  test('the board’s edges read both ways - what an issue waits on, and what waits on it', () => {
    const waiting = modal.dependencies(WAITER, BOARD);
    expect(waiting.waitsOn.length, 'the waiter waits on one issue').toBe(1);
    expect(waiting.waitsOn[0].number, 'the blocker, as the board’s own object').toBe(10);
    expect(waiting.blocks.length, 'and nothing waits on it').toBe(0);

    const blocker = modal.dependencies(BLOCKER, BOARD);
    expect(blocker.waitsOn.length, 'the blocker waits on nothing').toBe(0);
    expect(blocker.blocks.map((one) => one.number).join(','), 'and the inverse is read off the same payload - both of them, the cross-repo one included').toBe('11,12');
  });

  test('a blocker the board is no longer carrying is satisfied, exactly as on a card', () => {
    // The card's chip drops a blocker the sweep does not hold (format.waitsOnChips)
    // because a closed one is nothing to wait for. The dialog may not answer that
    // question a second way.
    const gone = modal.dependencies({ ...ISSUE, number: 13, blockedBy: [{ repo: 'ITW/workkit', number: 999 }] }, BOARD);
    expect(gone.waitsOn.length, 'nothing to wait for').toBe(0);
    expect(modal.dependencies(WAITER, []).waitsOn.length, 'and a board that answered with nothing says nothing either').toBe(0);
  });

  test('the dialog names both directions, each one opening the issue it names', () => {
    const waiting = modal.issueDialog(WAITER, render, BOARD);
    expect(waiting.body.includes('waits on'), 'the waiter says what it waits on').toBeTruthy();
    expect(!waiting.body.includes('blocks'), 'and says nothing about blocking, since it blocks nothing').toBeTruthy();
    expect(/data-issue="ITW\/workkit#10" role="button" tabindex="0">#10</.test(waiting.body),
      'the blocker is named the short way in its own repo, and is the trigger that opens ITS dialog').toBeTruthy();

    const blocker = modal.issueDialog(BLOCKER, render, BOARD);
    expect(blocker.body.includes('blocks'), 'the blocker says what it is holding up').toBeTruthy();
    expect(/data-issue="ITW\/workkit#11"[^>]*>#11</.test(blocker.body), 'the issue in the same repo, the short way').toBeTruthy();
    expect(/data-issue="ITW\/other#12"[^>]*>ITW\/other#12</.test(blocker.body), 'and the one in another repo with its slug - `#12` there is a different issue').toBeTruthy();
  });

  test('a dependency opens in the tower, never in a new tab', () => {
    // The delegated listener ignores a click inside an `a[href]` - that is the
    // card's escape hatch - so a reference drawn as an anchor would open the
    // GitHub page instead of the dialog it is there to open.
    const blocker = modal.issueDialog(BLOCKER, render, BOARD);
    const start = blocker.body.indexOf('blocks');
    expect(start > 0, 'the line is drawn').toBeTruthy();
    const line = blocker.body.slice(start, blocker.body.indexOf('omega-tower-issue__body'));
    expect(line.includes('#11'), 'and it is the one carrying the references').toBeTruthy();
    expect(!line.includes('<a '), 'no anchor in it - an anchor would leave for GitHub instead').toBeTruthy();
  });

  test('an issue that neither waits nor blocks draws no line at all', () => {
    const alone = modal.issueDialog(ISSUE, render, BOARD);
    expect(!alone.body.includes('waits on'), 'no label with nothing under it').toBeTruthy();
    expect(!alone.body.includes('blocks'), 'in either direction').toBeTruthy();
    expect(!alone.body.includes('gap-1 mb-3'),
      'and no empty row where the line would have been - omission is the container, not just the words').toBeTruthy();
    expect(!modal.issueDialog(WAITER, render).body.includes('waits on'),
      'and a dialog handed no board at all says nothing rather than guessing').toBeTruthy();
  });

  test('a hostile repo name reaches the dependency line as text', () => {
    const nasty = modal.issueDialog(BLOCKER, render, [
      BLOCKER, { ...WAITER, repo: '<img src=x onerror=alert(1)>' },
    ]);
    expect(!nasty.body.includes('<img'), 'the slug is escaped like every other remote value').toBeTruthy();
  });
});

describe('tower/app: modal - an issue as a list item', () => {
  test('a list item keeps its list semantics and puts the button inside it', () => {
    const item = modal.issueItem(ISSUE, '<span>body</span>', { item: 'py-1', inner: 'd-flex gap-2' });
    expect(/^<li class="omega-tower-issue py-1">/.test(item), 'the li carries the card class and the row\'s spacing').toBeTruthy();
    // The whole point: an <li> given a role stops being a list item, so the
    // role, the tab stop and the key the dialog opens on all sit one level in.
    expect(!/<li[^>]*role=/.test(item), 'and no role at all - the list stays a list').toBeTruthy();
    expect(/<div class="omega-interactive d-flex gap-2" data-issue="ITW\/workkit#31" role="button" tabindex="0">/.test(item), 'the inner element is the click target, with the layout classes on it').toBeTruthy();
    expect(item.includes('<span>body</span>'), 'and the content is inside that').toBeTruthy();
  });

  test('an item given no classes draws neither a dangling space nor an empty attribute', () => {
    const bare = modal.issueItem(ISSUE, 'x');
    expect(bare.includes('class="omega-tower-issue"'), 'the li is just the card class').toBeTruthy();
    expect(bare.includes('class="omega-interactive"'), 'and the trigger just the affordance').toBeTruthy();
  });
});

describe('tower/app: modal - a published brief or summary', () => {
  // The Brief page's archive is a list of these cards, each opening its whole
  // text in the issue dialog, so the same three questions apply: is it a list
  // item, is the remote text text, and does anything leave the dashboard.
  const DOCUMENT = {
    kind: 'brief',
    title: 'brief: 2026-08-19',
    url: 'https://github.com/owner/home/discussions/7',
    createdAt: '2026-08-19T09:00:00Z',
    body: 'HEADLINE: two issues are waiting on you.\n\nIN FLIGHT: one.',
  };

  test('a document card opens the dialog, names the post and links it', () => {
    const item = modal.documentItem(DOCUMENT);
    expect(/^<li class="omega-tower-issue">/.test(item), 'the card wears the class the stylesheet reveals the external link from').toBeTruthy();
    expect(!/<li[^>]*role=/.test(item), 'and carries no role of its own - the archive stays a list').toBeTruthy();
    expect(item.includes(`data-document="${DOCUMENT.url}" role="button" tabindex="0"`), 'the whole card is the trigger, keyed by the post it opens').toBeTruthy();
    expect(item.includes(`href="${DOCUMENT.url}"`) && item.includes('omega-tower-external'),
      'and github.com is reached only through the one button every card leaves by').toBeTruthy();
  });

  test('a card is never a bare title row - it says what it is, when, and how it opens', () => {
    const item = modal.documentItem({ ...DOCUMENT, kind: 'summary', title: 'daily: 2026-08-18' });
    expect(item.includes('daily: 2026-08-18'), 'the title is on it').toBeTruthy();
    expect(/summary · /.test(item), 'beside what kind of document it is and the day it was published').toBeTruthy();
    expect(item.includes('HEADLINE: two issues are waiting on you.'), 'and its own first line, which is the only honest summary of it').toBeTruthy();
  });

  test('the dialog is the whole text, through the renderer that escapes first', () => {
    const seen = [];
    const parts = modal.documentDialog(DOCUMENT, (text) => { seen.push(text); return '<p>rendered</p>'; });
    expect(seen[0], 'the body is handed to the renderer whole - the card excerpt is not what opens').toBe(DOCUMENT.body);
    expect(parts.body.includes('<p>rendered</p>'), 'and what comes back is what the dialog shows').toBeTruthy();
    expect(parts.body.includes('omega-tower-issue__body'), 'in the surface the stylesheet gives a rendered body').toBeTruthy();
    expect(parts.actions.includes(DOCUMENT.url), 'the header carries the one link that leaves for GitHub').toBeTruthy();
    expect(parts.title.includes('brief: 2026-08-19'), 'and the title is the post’s own').toBeTruthy();
  });

  test('a hostile title is text on the card and text in the dialog', () => {
    const nasty = { ...DOCUMENT, title: '<img src=x onerror=alert(1)>', body: '' };
    expect(!modal.documentItem(nasty).includes('<img'), 'a title off a Discussion is escaped on the card').toBeTruthy();
    const parts = modal.documentDialog(nasty, () => '');
    expect(!parts.title.includes('<img'), 'and in the dialog').toBeTruthy();
    expect(parts.body.includes('published with nothing in it'), 'while a post with no text says so rather than opening blank').toBeTruthy();
  });

  test('the card’s line is the document’s first line, plain and short', () => {
    expect(modal.excerpt('# The heading\n\nthe rest of it'), 'the markdown that made it a heading is not drawn as text').toBe('The heading');
    expect(modal.excerpt('> what somebody said'), 'nor the quote mark').toBe('what somebody said');
    expect(modal.excerpt('\n\n   spaced    out   \nsecond line'), 'the first line with something on it, whitespace collapsed').toBe('spaced out');
    expect(modal.excerpt(''), 'and nothing at all where there is nothing to say').toBe('');
    const long = modal.excerpt(`${'x'.repeat(400)}\nsecond`);
    expect(long.length <= 180, `a card stays a card: ${long.length} characters`).toBeTruthy();
    expect(long.endsWith('…'), 'and says that it trailed off').toBeTruthy();
  });
});
