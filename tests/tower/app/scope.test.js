//
// Tests for the tower dashboard's scope.js: the repo selection in the URL.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

const run = async () => {
  const { scope } = await loadLibs();

  group('tower/app: scope - the selection in the URL');

  await test('a `?repo=` value parses to the set of slugs it names', () => {
    assertEq(scope.parseRepos('').length, 0, 'nothing selected is every repo');
    assertEq(scope.parseRepos(null).length, 0, 'and so is an absent parameter');
    assertEq(scope.parseRepos('workkit').join(','), 'workkit', 'one slug is one slug');
    assertEq(scope.parseRepos('workkit,omega').join('|'), 'workkit|omega', 'a comma list is the subset, in the order it names it');
    assertEq(scope.parseRepos(' workkit , omega ').join('|'), 'workkit|omega', 'whitespace around a slug is not part of it');
    assertEq(scope.parseRepos('workkit,,omega,workkit').join('|'), 'workkit|omega', 'blanks drop and a repeat counts once');
    assertEq(scope.parseRepos('ITW/workkit,Omega/omega').join('|'), 'ITW/workkit|Omega/omega', 'an owner/name slug survives whole');
  });

  await test('a set of slugs formats back to the value it was parsed from', () => {
    assertEq(scope.formatRepos([]), '', 'every repo is written as no parameter at all');
    assertEq(scope.formatRepos(['workkit']), 'workkit', 'one slug');
    assertEq(scope.formatRepos(['workkit', 'omega']), 'workkit,omega', 'and a subset is comma-separated');
    assertEq(scope.formatRepos(scope.parseRepos('workkit,omega')), 'workkit,omega', 'the round trip is the identity');
    assertEq(scope.formatRepos([' workkit ', 'workkit']), 'workkit', 'and the same cleaning applies on the way out');
  });

  await test('the predicate takes a SET - one slug, several, or none at all', () => {
    assert(scope.inScope([], 'workkit') && scope.inScope([], 'anything'), 'no selection leaves every repo in play');
    assert(scope.inScope(['workkit'], 'workkit'), 'one slug is that repo');
    assert(!scope.inScope(['workkit'], 'omega'), 'and only that repo');
    const two = scope.parseRepos('workkit,omega');
    assert(scope.inScope(two, 'workkit') && scope.inScope(two, 'omega'), 'a subset keeps every member');
    assert(!scope.inScope(two, 'dotfiles'), 'and nothing else');
  });

  await test('the runtime reads its selection through the same parse', () => {
    assertEq(scope.selectedSlugs({ selectedRepo: 'workkit,omega' }).length, 2, 'the raw query value is what state carries');
    assertEq(scope.selectedSlugs({ selectedRepo: '' }).length, 0, 'empty is every repo');
    assertEq(scope.selectedSlugs({}).length, 0, 'and so is a state with no selection on it yet');
    assertEq(scope.selectedSlugs(null).length, 0, 'null never throws');
  });

  await test('a nav link carries the selection, and only the tower’s own pages are rewritten', () => {
    assertEq(scope.scopedHref('/board', 'workkit'), '/board?repo=workkit', 'the value is set');
    assertEq(scope.scopedHref('/board?repo=omega', 'workkit'), '/board?repo=workkit', 'a link already carrying one is rewritten, not appended to');
    assertEq(scope.scopedHref('/board?repo=omega', ''), '/board', 'and an empty selection takes the parameter off');
    assertEq(scope.scopedHref('/', 'workkit,omega'), '/?repo=workkit,omega', 'a subset stays readable - the comma is not escaped');
    assertEq(scope.scopedHref('/board?api=http://127.0.0.1:8693', 'workkit'), '/board?api=http%3A%2F%2F127.0.0.1%3A8693&repo=workkit', 'another parameter is kept');
    assertEq(scope.scopedHref(scope.scopedHref('/board', 'workkit'), 'workkit'), '/board?repo=workkit', 'rewriting twice writes the same link');
    for (const href of ['/', '/board', '/crew', '/usage', '/health', '/brief', '/board/', '/board.html', '/board?repo=omega']) {
      assert(scope.isScopedPath(href), `${href} is a tower page`);
    }
    for (const href of ['/dashboard/account', '/pricing', 'https://github.com/ITW-Creative-Works/workkit', '#']) {
      assert(!scope.isScopedPath(href), `${href} is left alone`);
    }
    // The selector menu's placeholder: a hash-only href goes nowhere by design,
    // and rewriting it would turn "stay here" into a navigation to Overview.
    assert(!scope.isScopedPath('#anything'), 'a fragment is never a page');
  });

  /** A page built for a prefixed site: the stamp the build writes on `<html>`. */
  const stamped = (prefix) => ({ documentElement: { dataset: prefix === null ? {} : { omegaPathPrefix: prefix } } });

  /** Run under a simulated document (and page path), whatever the body does. */
  const served = (document, pathname, body) => {
    const realDocument = globalThis.document;
    const realLocation = globalThis.location;
    globalThis.document = document;
    globalThis.location = { pathname };
    try {
      body();
    } finally {
      if (realDocument === undefined) delete globalThis.document;
      else globalThis.document = realDocument;
      if (realLocation === undefined) delete globalThis.location;
      else globalThis.location = realLocation;
    }
  };

  await test('a copy served under a path prefix keeps every URL the runtime builds inside it', () => {
    // The published copy answers at `<owner>.github.io/<name>/`, and the build
    // rewrites only the HTML it emits - a URL this app ASSEMBLES is its own to
    // get right, and root-absolute ones walked off the site (issue #169). Where
    // it is mounted is the BUILD's own answer, stamped on `<html>`, so the
    // simulation is that stamp and nothing else.
    served(stamped('/workkit'), '/workkit/board', () => {
      assertEq(scope.basePath(), '/workkit', 'the prefix is the build’s stamp, read back off the document');
      assertEq(scope.sitePath('/settings'), '/workkit/settings', 'and applying it is what every runtime URL goes through');
      assertEq(scope.settingsHref('omega'), '/workkit/settings?repo=omega', 'the page the runtime navigates to by itself stays on the site, scope and all');
      assertEq(scope.settingsHref(''), '/workkit/settings', 'with or without a selection on it');
      assertEq(scope.scopedHref('/workkit/board', 'omega'), '/workkit/board?repo=omega', 'a nav link the build already prefixed is left where it is');
      assertEq(scope.scopedHref('/board', 'omega'), '/workkit/board?repo=omega', 'and one it did not is put under the prefix rather than off the site');
      assertEq(scope.scopedHref('/workkit/', 'omega'), '/workkit/?repo=omega', 'the brand lockup points at the prefixed Overview, never at the domain root');
      assertEq(scope.pathOf('/workkit/board'), '/board', 'page identity is the path with the prefix taken off');
      assertEq(scope.pathOf('/workkit/'), '/', 'and the prefix on its own is the Overview');
      assert(scope.isScopedPath('/workkit/board') && scope.isScopedPath('/workkit/settings'), 'so a prefixed nav link is still one of the tower’s own pages');
      assert(!scope.isScopedPath('/workkit/pricing'), 'and a prefixed link that is not is still left alone');
    });
    // The stamp is written only when there IS a prefix, so every absence says
    // the same thing - and says it whatever the page path looks like. A copy
    // opened at `/index.html` is the case a path-shaped guess got wrong.
    served(stamped(null), '/index.html', () => {
      assertEq(scope.basePath(), '', 'no stamp is no prefix, whatever the address bar says');
      assertEq(scope.sitePath('/settings'), '/settings', 'so nothing a root-served copy builds is moved');
      assertEq(scope.scopedHref('/board', 'omega'), '/board?repo=omega', 'and its nav links are the links they always were');
      assert(scope.isScopedPath('/board'), 'page identity is untouched too');
    });
    served(stamped('/'), '/board', () => {
      assertEq(scope.basePath(), '', 'a stamp naming the domain root is no prefix either');
    });
    assertEq(scope.basePath(), '', 'and a runtime with no document at all is at the root - never a crash');
  });

  await test('no page writes a link to another page as a bare root-absolute path', () => {
    // The tiles, the see-all lines and the card links are drawn at runtime, so
    // the build never sees them - every one of them names its page through
    // `sitePath` or it points at the domain root from a copy that is not served
    // there (issue #169).
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    const bare = /(?<!sitePath\()'\/(board|crew|usage|health|brief|settings)'/;
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(!bare.test(source), `${name} names no tower page as a bare path`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
