//
// Tests for the tower dashboard's modal.js: the issue dialog, what an issue
// depends on, an issue as a list item, and a published brief or summary.
// The header this suite's notes point at (why a page module is out of reach
// under Node) is the one atop ./helpers.js, which holds the shared prologue.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs } = require('./helpers');

const run = async () => {
  const { format, modal } = await loadLibs();

  group('tower/app: modal - the issue dialog');

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

  // The renderer is the framework's and is handed to the dialog by the mount,
  // so the questions left here are the tower's own: is the RAW body what gets
  // handed over, and does what comes back land in the body's own container.
  // Whether markdown becomes safe markup is asked upstream, of the real one.
  const rendered = [];
  const render = (text) => {
    rendered.push(text);
    return text ? `<p data-rendered>${text}</p>` : '';
  };

  await test('a trigger carries the key and the keyboard affordance a div needs', () => {
    const attrs = modal.issueTrigger(ISSUE);
    assert(attrs.includes('data-issue="ITW/workkit#31"'), 'the repo and number are the key');
    assert(attrs.includes('role="button"') && attrs.includes('tabindex="0"'), 'and it is reachable without a mouse');
    // The Board reads that same attribute back off a dragged card to find which
    // issue was moved, so the key has exactly one spelling - format.js's.
    assert(attrs.includes(`data-issue="${format.issueKey(ISSUE)}"`), 'and the shared key is what the attribute carries');
  });

  await test('the external link is the only thing that leaves for GitHub', () => {
    const link = modal.externalLink(ISSUE.url, 'ms-2');
    assert(link.includes(`href="${ISSUE.url}"`), 'it points at the issue');
    assert(link.includes('target="_blank"') && link.includes('rel="noopener"'), 'in a new tab, safely');
    assert(link.includes('aria-label="Open on GitHub"'), 'and says what it does');
    assert(link.includes('class="omega-tower-external ms-2"'), 'the caller can place it');
    assert(link.includes('<i class="fa-solid fa-arrow-up-right-from-square"'), 'the glyph is the framework\'s one icon mechanism');
    assert(!link.includes('<svg'), 'and not a hand-drawn one the renderer never sees');
  });

  await test('on a Board card that button is the corner, not a neighbour of it (#142)', () => {
    // The defect this proves against: the button hides at `opacity: 0` and
    // KEEPS its box, so a building card's spinning gear sat one
    // invisible-button-width in from the top-right corner and read adrift. The
    // corner is ONE slot: the button leaves the flow into it, the gear becomes
    // the row's last item, and the gear fades out from under the button while
    // the card is hovered or focused so the two never stack.
    const fs = require('fs');
    const src = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src');
    const boardPage = fs.readFileSync(path.join(src, 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(boardPage.includes('omega-tower-issue__top'), 'the card names the row the corner is measured from');
    // That row is the BOARD card's alone: the Brief, the Overview and Health
    // draw list rows under the same `omega-tower-issue` class with the button in
    // flow, and the rules below would fling it to the nearest positioned box.
    for (const name of ['brief.js', 'health.js', 'index.js']) {
      const page = fs.readFileSync(path.join(src, 'assets', 'js', 'pages', name), 'utf8');
      assert(!page.includes('omega-tower-issue__top'), `${name} draws its rows without it`);
    }

    const sheet = fs.readFileSync(path.join(src, 'assets', 'css', 'main.scss'), 'utf8');
    const block = /@media \(hover: hover\) \{\n([\s\S]*?)\n\}/.exec(sheet);
    assert(block, 'and the mechanism is the sheet\'s, behind the pointer it needs');
    assert(/\.omega-tower-issue__top \{ position: relative; \}/.test(block[1]), 'the row is the containing block');
    const corner = /\.omega-tower-issue__top \.omega-tower-external \{([^}]*)\}/.exec(block[1]);
    assert(corner, 'the button is placed against it');
    for (const declaration of ['position: absolute', 'right: 0', 'top: 0']) {
      assert(corner[1].includes(declaration), `out of the flow and into the corner (${declaration})`);
    }
    assert(/\.omega-tower-issue:hover \.omega-tower-issue__top \.omega-tower-activity,\s*\.omega-tower-issue:focus-within \.omega-tower-issue__top \.omega-tower-activity \{ opacity: 0; \}/.test(block[1]),
      'and the gear under it fades on hover AND on focus, so a keyboard sees what a pointer does');
    assert(block[1].includes('transition: opacity .12s ease-in-out'), 'at the same speed the reveal it is paired with runs');
    assert(/\.omega-tower-issue__top \.omega-micro \{ padding-right: /.test(block[1]), 'and the slug span stops short of the corner, so a gear-less card\'s ellipsis never sits under the revealed button');
    // Nothing here may take the button out of the accessibility tree - it is
    // the card's one tab stop, and `:focus-visible` has to be able to show it.
    assert(!/display: none|visibility: hidden/.test(block[1]), 'the button is faded, never hidden');
    // A touch screen has no pointer to reveal anything with, so it keeps the
    // in-flow layout: every word the sheet says about that row is in this block.
    const elsewhere = sheet.slice(0, block.index) + sheet.slice(block.index + block[0].length);
    assert(!elsewhere.includes('.omega-tower-issue__top'), 'and `(hover: none)` - the whole of the other side of that feature - is left as it was');
    // The dialog header's copy of the button is a control in flow, not a
    // card's reveal, and none of the above reaches it.
    assert(sheet.includes('.modal-header .omega-tower-external { opacity: 1; }'), 'the dialog\'s button still simply shows');
  });

  await test('the dialog says everything the issue knows', () => {
    const parts = modal.issueDialog(ISSUE, render);
    assert(parts.title.includes('ITW/workkit #31'), 'repo and number');
    assert(parts.title.includes('Issues open in a modal'), 'and the title');
    assert(parts.actions.includes('target="_blank"'), 'the external button is the header action');
    assert(parts.body.includes('>specced<'), 'the status');
    assert(parts.body.includes('>enhancement<') && parts.body.includes('agent:ok'), 'and the chips');
    assert(parts.body.includes('held by @alice'), 'who holds it');
    assert(/filed .* · updated /.test(parts.body), 'both dates');
    assertEq(rendered[rendered.length - 1], ISSUE.body, 'the renderer is handed the raw body, markdown and all');
    assert(parts.body.includes(`<div class="omega-tower-issue__body"><p data-rendered>${ISSUE.body}</p></div>`), 'and what it answers is the body of the dialog');
    assert(parts.body.includes('2 comments on GitHub'), 'and where the conversation is');
  });

  await test('the dialog’s date rows say a dash where the issue carried no date', () => {
    // The shared formatter leaves an unreadable date as nothing by default,
    // because a document's meta line drops it - a row LABELLED "filed" has to
    // say something, so the dialog asks for the dash it has always drawn.
    const parts = modal.issueDialog({ ...ISSUE, createdAt: '', updatedAt: '' }, render);
    assert(parts.body.includes('filed -') && parts.body.includes('updated -'),
      'a labelled row says a dash rather than trailing off into nothing');
  });

  await test('the dialog’s status chip is the colour of the column the card came from', () => {
    const parts = modal.issueDialog(ISSUE, render);
    assert(parts.body.includes(format.statusChip('specced')), 'the dialog draws format.js’s status chip');
    assert(parts.body.includes(`--omega-tone: ${format.statusColor('specced')}`),
      'so the dialog and the Board column header say specced in one colour');
    const bare = modal.issueDialog({ ...ISSUE, status: '', priority: '', type: '' }, render);
    assert(!bare.body.includes('omega-badge-tone'), 'and an issue with no status carries no status chip');
  });

  await test('the dialog’s type and priority chips wear the card’s glyphs (#136)', () => {
    const parts = modal.issueDialog({ ...ISSUE, type: 'idea', priority: 'low' }, render);
    assert(parts.body.includes('<i class="fa-solid fa-lightbulb me-1" aria-hidden="true"></i>idea'), 'the type, glyph then word');
    assert(parts.body.includes('<i class="fa-solid fa-angles-down me-1" aria-hidden="true"></i>low'), 'and the priority the same way');
    assert(parts.body.includes(format.typeChip('idea')) && parts.body.includes(format.priorityChip('low')),
      'both are format.js’s own chips, so the dialog and the card cannot draw one thing two ways');
    const glyphs = Object.values(format.CHIP_GLYPHS).filter((glyph) => parts.body.includes(glyph));
    assertEq(glyphs.length, 3, 'and exactly those three - the status chip sitting with them wears its own glyph (#149)');
  });

  await test('an issue with nothing on it still opens', () => {
    const bare = modal.issueDialog({ repo: 'r', number: 1, url: 'https://example.com/1', title: 'bare' }, render);
    assert(bare.body.includes('No description.'), 'an empty body says so');
    assert(bare.body.includes('unclaimed'), 'and nobody holding it says that');
    assert(bare.body.includes('0 comments'), 'a missing count is zero, not undefined');
    assert(bare.body.includes('-'), 'and a missing date is a dash');
  });

  await test('a truncated body admits it', () => {
    const cut = modal.issueDialog({ ...ISSUE, bodyTruncated: true }, render);
    assert(cut.body.includes('the rest is on GitHub'), 'the dialog says what it is not showing');
  });

  await test('a blocked issue’s dialog says the question it is waiting on, and no other one does (#205)', () => {
    // The spec's convention is that a blocked issue's question is a COMMENT on
    // it, so the last comment is the signal the sweep carries. It is read in the
    // DIALOG now, not on the card: only `blocked` draws it, because the newest
    // comment on an issue that is moving is not a question anybody waits on.
    const blocked = modal.issueDialog({ ...ISSUE, status: 'blocked', lastComment: 'Which of the two?' }, render);
    assert(blocked.body.includes('Which of the two?'), 'the question is in the dialog');
    assert(blocked.body.includes('<strong>Open question</strong>'), 'labelled as what it is');
    const alertBlock = (blocked.body.match(/<div class="alert alert-danger[^>]*>[\s\S]*?<\/div>/) || [''])[0];
    assert(alertBlock.includes('omega-tower-issue__question') && !alertBlock.includes('omega-micro'),
      'in a danger alert with plain-case text, never the muted small-caps line');
    const moving = modal.issueDialog({ ...ISSUE, status: 'qa', lastComment: 'shipped it' }, render);
    assert(!moving.body.includes('shipped it') && !moving.body.includes('omega-tower-issue__question'),
      'an issue that is moving draws none - its last comment is not a question');
    const silent = modal.issueDialog({ ...ISSUE, status: 'blocked', lastComment: '' }, render);
    assert(!silent.body.includes('omega-tower-issue__question'),
      'and a blocked issue nobody has commented on draws none either');
    const hostile = modal.issueDialog({ ...ISSUE, status: 'blocked', lastComment: '<img src=x onerror=alert(1)>' }, render);
    assert(!hostile.body.includes('<img'), 'a comment is remote text like every other value here');
    assert(hostile.body.includes('&lt;img src=x'), 'and shows as what it says');
  });

  await test('a mount without a renderer fails there, not at the first click', () => {
    let thrown = null;
    try {
      // The scope stub keeps Node's missing `document` (the destructuring
      // default) out of the way - the guard is what is under test.
      modal.mountIssueModal({ scope: {} });
    } catch (error) {
      thrown = error;
    }
    assert(thrown, 'the missing renderer is refused at the mount');
    assert(thrown.message.includes('render'), 'and the error names what is missing');
  });

  await test('every field the dialog writes itself reaches it as text', () => {
    const nasty = modal.issueDialog({
      ...ISSUE,
      title: '<img src=x onerror=alert(1)>',
      assignees: ['<b>me</b>'],
      status: '<i>x</i>',
    }, render);
    assert(!nasty.title.includes('<img'), 'the title is escaped');
    assert(!nasty.body.includes('<b>me</b>'), 'the handle is escaped');
    assert(!nasty.body.includes('<i>x</i>'), 'and so is the status chip');
    // The body is the ONE field this file does not escape itself - it is the
    // renderer's, which escapes first (@omega.js/client's utilities suite).
  });

  group('tower/app: modal - what an issue depends on');

  // One board with one dependency in it, drawn twice over: #10 is what #11 and
  // the cross-repo #12 are both waiting on. The second reference is written in
  // another case on purpose - repo names are case-insensitive on GitHub and the
  // inline `Depends on:` fallback is hand-typed, so the two spellings are one
  // edge or the feature is a coin toss.
  const BLOCKER = { ...ISSUE, number: 10, title: 'the one holding things up' };
  const WAITER = {
    ...ISSUE, number: 11, title: 'waiting on it', blockedBy: [{ repo: 'ITW/workkit', number: 10 }],
  };
  const ELSEWHERE = {
    ...ISSUE, repo: 'ITW/other', number: 12, title: 'waiting from another repo', blockedBy: [{ repo: 'itw/WORKKIT', number: 10 }],
  };
  const BOARD = [BLOCKER, WAITER, ELSEWHERE];

  await test('the board’s edges read both ways - what an issue waits on, and what waits on it', () => {
    const waiting = modal.dependencies(WAITER, BOARD);
    assertEq(waiting.waitsOn.length, 1, 'the waiter waits on one issue');
    assertEq(waiting.waitsOn[0].number, 10, 'the blocker, as the board’s own object');
    assertEq(waiting.blocks.length, 0, 'and nothing waits on it');

    const blocker = modal.dependencies(BLOCKER, BOARD);
    assertEq(blocker.waitsOn.length, 0, 'the blocker waits on nothing');
    assertEq(blocker.blocks.map((one) => one.number).join(','), '11,12',
      'and the inverse is read off the same payload - both of them, the cross-repo one included');
  });

  await test('a blocker the board is no longer carrying is satisfied, exactly as on a card', () => {
    // The card's chip drops a blocker the sweep does not hold (format.waitsOnChips)
    // because a closed one is nothing to wait for. The dialog may not answer that
    // question a second way.
    const gone = modal.dependencies({ ...ISSUE, number: 13, blockedBy: [{ repo: 'ITW/workkit', number: 999 }] }, BOARD);
    assertEq(gone.waitsOn.length, 0, 'nothing to wait for');
    assertEq(modal.dependencies(WAITER, []).waitsOn.length, 0, 'and a board that answered with nothing says nothing either');
  });

  await test('the dialog names both directions, each one opening the issue it names', () => {
    const waiting = modal.issueDialog(WAITER, render, BOARD);
    assert(waiting.body.includes('waits on'), 'the waiter says what it waits on');
    assert(!waiting.body.includes('blocks'), 'and says nothing about blocking, since it blocks nothing');
    assert(/data-issue="ITW\/workkit#10" role="button" tabindex="0">#10</.test(waiting.body),
      'the blocker is named the short way in its own repo, and is the trigger that opens ITS dialog');

    const blocker = modal.issueDialog(BLOCKER, render, BOARD);
    assert(blocker.body.includes('blocks'), 'the blocker says what it is holding up');
    assert(/data-issue="ITW\/workkit#11"[^>]*>#11</.test(blocker.body), 'the issue in the same repo, the short way');
    assert(/data-issue="ITW\/other#12"[^>]*>ITW\/other#12</.test(blocker.body), 'and the one in another repo with its slug - `#12` there is a different issue');
  });

  await test('a dependency opens in the tower, never in a new tab', () => {
    // The delegated listener ignores a click inside an `a[href]` - that is the
    // card's escape hatch - so a reference drawn as an anchor would open the
    // GitHub page instead of the dialog it is there to open.
    const blocker = modal.issueDialog(BLOCKER, render, BOARD);
    const start = blocker.body.indexOf('blocks');
    assert(start > 0, 'the line is drawn');
    const line = blocker.body.slice(start, blocker.body.indexOf('omega-tower-issue__body'));
    assert(line.includes('#11'), 'and it is the one carrying the references');
    assert(!line.includes('<a '), 'no anchor in it - an anchor would leave for GitHub instead');
  });

  await test('an issue that neither waits nor blocks draws no line at all', () => {
    const alone = modal.issueDialog(ISSUE, render, BOARD);
    assert(!alone.body.includes('waits on'), 'no label with nothing under it');
    assert(!alone.body.includes('blocks'), 'in either direction');
    assert(!alone.body.includes('gap-1 mb-3'),
      'and no empty row where the line would have been - omission is the container, not just the words');
    assert(!modal.issueDialog(WAITER, render).body.includes('waits on'),
      'and a dialog handed no board at all says nothing rather than guessing');
  });

  await test('a hostile repo name reaches the dependency line as text', () => {
    const nasty = modal.issueDialog(BLOCKER, render, [
      BLOCKER, { ...WAITER, repo: '<img src=x onerror=alert(1)>' },
    ]);
    assert(!nasty.body.includes('<img'), 'the slug is escaped like every other remote value');
  });

  await test('the runtime hands the dialog the board the paint is drawing', () => {
    // The dialog lives in the layout, outside the mount a paint writes into, and
    // page.js is out of reach of these suites (see the header) - so what is
    // pinned is the handover: every page's paint passes here, so no page keeps a
    // second copy of the payload for the dialog to read.
    const fs = require('fs');
    const runtime = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/import \{[^}]*holdBoard[^}]*\} from '\.\/modal\.js'/.test(runtime), 'the runtime takes the handover from the dialog module');
    assert(/^\s*holdBoard\(board\(state\)\);$/m.test(runtime), 'and hands it the board payload state.js reads back');
    assert(runtime.search(/^\s*holdBoard\(board\(state\)\);$/m) < runtime.indexOf('options.render(body, state);'),
      'before the render, so the page and its dialog are drawn from one payload');
  });

  group('tower/app: modal - an issue as a list item');

  await test('a list item keeps its list semantics and puts the button inside it', () => {
    const item = modal.issueItem(ISSUE, '<span>body</span>', { item: 'py-1', inner: 'd-flex gap-2' });
    assert(/^<li class="omega-tower-issue py-1">/.test(item), 'the li carries the card class and the row\'s spacing');
    // The whole point: an <li> given a role stops being a list item, so the
    // role, the tab stop and the key the dialog opens on all sit one level in.
    assert(!/<li[^>]*role=/.test(item), 'and no role at all - the list stays a list');
    assert(/<div class="omega-interactive d-flex gap-2" data-issue="ITW\/workkit#31" role="button" tabindex="0">/.test(item), 'the inner element is the click target, with the layout classes on it');
    assert(item.includes('<span>body</span>'), 'and the content is inside that');
  });

  await test('an item given no classes draws neither a dangling space nor an empty attribute', () => {
    const bare = modal.issueItem(ISSUE, 'x');
    assert(bare.includes('class="omega-tower-issue"'), 'the li is just the card class');
    assert(bare.includes('class="omega-interactive"'), 'and the trigger just the affordance');
  });

  // The Overview's "In flight" and the brief's inFlight section are the same
  // claim about the same board, and a page cannot import the API's module, so
  // the two copies are held together here instead. The rule is the label and
  // nothing else (#62): a claim says who holds an issue, never which queue it
  // is in, so a page that counted claims too would put one issue in two places.
  await test('the Overview counts in flight by the brief’s rule - the label alone', () => {
    const fs = require('fs');
    const overview = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'index.js'), 'utf8');
    const briefSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'brief.js'), 'utf8');
    assert(/inFlight = issues\.filter\(\(i\) => i\.status === 'building'\)/.test(briefSrc),
      'the brief counts in flight by the building label');
    assert(/'In flight', issues\.filter\(\(issue\) => issue\.status === 'building'\)/.test(overview),
      'and the Overview cell asks exactly that');
    assert(!/claimed\(/.test(overview), `no claim predicate is called on the page, got: ${(overview.match(/.*claimed\(.*/g) || []).join(' | ')}`);
  });

  await test('every page that lists issues routes through it - no role on an li anywhere', () => {
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(!/<li[^>]*\$\{issueTrigger\(/.test(source), `${name} puts no trigger on an <li>`);
      if (source.includes('<li')) assert(source.includes('issueItem('), `${name} builds its interactive items through the helper`);
    }
  });

  group('tower/app: modal - a published brief or summary');

  // Issue #181: the mornings the 9am job publishes could be read on github.com
  // and nowhere else. The archive on the Brief page is a list of these cards,
  // and each one opens the whole text in the dialog the issue cards open theirs
  // in - so the same three questions are asked of it: is it a list item, is the
  // remote text text, and does anything leave the dashboard by accident.
  const DOCUMENT = {
    kind: 'brief',
    title: 'brief: 2026-08-19',
    url: 'https://github.com/owner/home/discussions/7',
    createdAt: '2026-08-19T09:00:00Z',
    body: 'HEADLINE: two issues are waiting on you.\n\nIN FLIGHT: one.',
  };

  await test('a document card opens the dialog, names the post and links it', () => {
    const item = modal.documentItem(DOCUMENT);
    assert(/^<li class="omega-tower-issue">/.test(item), 'the card wears the class the stylesheet reveals the external link from');
    assert(!/<li[^>]*role=/.test(item), 'and carries no role of its own - the archive stays a list');
    assert(item.includes(`data-document="${DOCUMENT.url}" role="button" tabindex="0"`), 'the whole card is the trigger, keyed by the post it opens');
    assert(item.includes(`href="${DOCUMENT.url}"`) && item.includes('omega-tower-external'),
      'and github.com is reached only through the one button every card leaves by');
  });

  await test('a card is never a bare title row - it says what it is, when, and how it opens', () => {
    const item = modal.documentItem({ ...DOCUMENT, kind: 'summary', title: 'daily: 2026-08-18' });
    assert(item.includes('daily: 2026-08-18'), 'the title is on it');
    assert(/summary · /.test(item), 'beside what kind of document it is and the day it was published');
    assert(item.includes('HEADLINE: two issues are waiting on you.'), 'and its own first line, which is the only honest summary of it');
  });

  await test('the dialog is the whole text, through the renderer that escapes first', () => {
    const seen = [];
    const parts = modal.documentDialog(DOCUMENT, (text) => { seen.push(text); return '<p>rendered</p>'; });
    assertEq(seen[0], DOCUMENT.body, 'the body is handed to the renderer whole - the card excerpt is not what opens');
    assert(parts.body.includes('<p>rendered</p>'), 'and what comes back is what the dialog shows');
    assert(parts.body.includes('omega-tower-issue__body'), 'in the surface the stylesheet gives a rendered body');
    assert(parts.actions.includes(DOCUMENT.url), 'the header carries the one link that leaves for GitHub');
    assert(parts.title.includes('brief: 2026-08-19'), 'and the title is the post’s own');
  });

  await test('a hostile title is text on the card and text in the dialog', () => {
    const nasty = { ...DOCUMENT, title: '<img src=x onerror=alert(1)>', body: '' };
    assert(!modal.documentItem(nasty).includes('<img'), 'a title off a Discussion is escaped on the card');
    const parts = modal.documentDialog(nasty, () => '');
    assert(!parts.title.includes('<img'), 'and in the dialog');
    assert(parts.body.includes('published with nothing in it'), 'while a post with no text says so rather than opening blank');
  });

  await test('the card’s line is the document’s first line, plain and short', () => {
    assertEq(modal.excerpt('# The heading\n\nthe rest of it'), 'The heading', 'the markdown that made it a heading is not drawn as text');
    assertEq(modal.excerpt('> what somebody said'), 'what somebody said', 'nor the quote mark');
    assertEq(modal.excerpt('\n\n   spaced    out   \nsecond line'), 'spaced out', 'the first line with something on it, whitespace collapsed');
    assertEq(modal.excerpt(''), '', 'and nothing at all where there is nothing to say');
    const long = modal.excerpt(`${'x'.repeat(400)}\nsecond`);
    assert(long.length <= 180, `a card stays a card: ${long.length} characters`);
    assert(long.endsWith('…'), 'and says that it trailed off');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
