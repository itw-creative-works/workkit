//
// Tests for the tower dashboard's scope.js: the repo selection in the URL.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

describe('tower/app: scope - the selection in the URL', () => {
  let scope;
  before(async () => { ({ scope } = await loadLibs()); });

  test('a `?repo=` value parses to the set of slugs it names', () => {
    expect(scope.parseRepos('').length, 'nothing selected is every repo').toBe(0);
    expect(scope.parseRepos(null).length, 'and so is an absent parameter').toBe(0);
    expect(scope.parseRepos('workkit').join(','), 'one slug is one slug').toBe('workkit');
    expect(scope.parseRepos('workkit,omega').join('|'), 'a comma list is the subset, in the order it names it').toBe('workkit|omega');
    expect(scope.parseRepos(' workkit , omega ').join('|'), 'whitespace around a slug is not part of it').toBe('workkit|omega');
    expect(scope.parseRepos('workkit,,omega,workkit').join('|'), 'blanks drop and a repeat counts once').toBe('workkit|omega');
    expect(scope.parseRepos('ITW/workkit,Omega/omega').join('|'), 'an owner/name slug survives whole').toBe('ITW/workkit|Omega/omega');
  });

  test('a set of slugs formats back to the value it was parsed from', () => {
    expect(scope.formatRepos([]), 'every repo is written as no parameter at all').toBe('');
    expect(scope.formatRepos(['workkit']), 'one slug').toBe('workkit');
    expect(scope.formatRepos(['workkit', 'omega']), 'and a subset is comma-separated').toBe('workkit,omega');
    expect(scope.formatRepos(scope.parseRepos('workkit,omega')), 'the round trip is the identity').toBe('workkit,omega');
    expect(scope.formatRepos([' workkit ', 'workkit']), 'and the same cleaning applies on the way out').toBe('workkit');
  });

  test('the predicate takes a SET - one slug, several, or none at all', () => {
    expect(scope.inScope([], 'workkit') && scope.inScope([], 'anything'), 'no selection leaves every repo in play').toBeTruthy();
    expect(scope.inScope(['workkit'], 'workkit'), 'one slug is that repo').toBeTruthy();
    expect(!scope.inScope(['workkit'], 'omega'), 'and only that repo').toBeTruthy();
    const two = scope.parseRepos('workkit,omega');
    expect(scope.inScope(two, 'workkit') && scope.inScope(two, 'omega'), 'a subset keeps every member').toBeTruthy();
    expect(!scope.inScope(two, 'dotfiles'), 'and nothing else').toBeTruthy();
  });

  test('the runtime reads its selection through the same parse', () => {
    expect(scope.selectedSlugs({ selectedRepo: 'workkit,omega' }).length, 'the raw query value is what state carries').toBe(2);
    expect(scope.selectedSlugs({ selectedRepo: '' }).length, 'empty is every repo').toBe(0);
    expect(scope.selectedSlugs({}).length, 'and so is a state with no selection on it yet').toBe(0);
    expect(scope.selectedSlugs(null).length, 'null never throws').toBe(0);
  });

  test('a nav link carries the selection, and only the tower’s own pages are rewritten', () => {
    expect(scope.scopedHref('/board', 'workkit'), 'the value is set').toBe('/board?repo=workkit');
    expect(scope.scopedHref('/board?repo=omega', 'workkit'), 'a link already carrying one is rewritten, not appended to').toBe('/board?repo=workkit');
    expect(scope.scopedHref('/board?repo=omega', ''), 'and an empty selection takes the parameter off').toBe('/board');
    expect(scope.scopedHref('/', 'workkit,omega'), 'a subset stays readable - the comma is not escaped').toBe('/?repo=workkit,omega');
    expect(scope.scopedHref('/board?api=http://127.0.0.1:8693', 'workkit'), 'another parameter is kept').toBe('/board?api=http%3A%2F%2F127.0.0.1%3A8693&repo=workkit');
    expect(scope.scopedHref(scope.scopedHref('/board', 'workkit'), 'workkit'), 'rewriting twice writes the same link').toBe('/board?repo=workkit');
    for (const href of ['/', '/board', '/crew', '/usage', '/health', '/brief', '/board/', '/board.html', '/board?repo=omega']) {
      expect(scope.isScopedPath(href), `${href} is a tower page`).toBeTruthy();
    }
    for (const href of ['/dashboard/account', '/pricing', 'https://github.com/ITW-Creative-Works/workkit', '#']) {
      expect(!scope.isScopedPath(href), `${href} is left alone`).toBeTruthy();
    }
    // The selector menu's placeholder: a hash-only href goes nowhere by design,
    // and rewriting it would turn "stay here" into a navigation to Overview.
    expect(!scope.isScopedPath('#anything'), 'a fragment is never a page').toBeTruthy();
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

  test('a copy served under a path prefix keeps every URL the runtime builds inside it', () => {
    // The published copy answers at `<owner>.github.io/<name>/`, and the build
    // rewrites only the HTML it emits, so a URL this app assembles is its own to
    // get right. The mount is the build's stamp on `<html>`, so the simulation
    // is that stamp and nothing else.
    served(stamped('/workkit'), '/workkit/board', () => {
      expect(scope.basePath(), 'the prefix is the build’s stamp, read back off the document').toBe('/workkit');
      expect(scope.sitePath('/settings'), 'and applying it is what every runtime URL goes through').toBe('/workkit/settings');
      expect(scope.settingsHref('omega'), 'the page the runtime navigates to by itself stays on the site, scope and all').toBe('/workkit/settings?repo=omega');
      expect(scope.settingsHref(''), 'with or without a selection on it').toBe('/workkit/settings');
      expect(scope.scopedHref('/workkit/board', 'omega'), 'a nav link the build already prefixed is left where it is').toBe('/workkit/board?repo=omega');
      expect(scope.scopedHref('/board', 'omega'), 'and one it did not is put under the prefix rather than off the site').toBe('/workkit/board?repo=omega');
      expect(scope.scopedHref('/workkit/', 'omega'), 'the brand lockup points at the prefixed Overview, never at the domain root').toBe('/workkit/?repo=omega');
      expect(scope.pathOf('/workkit/board'), 'page identity is the path with the prefix taken off').toBe('/board');
      expect(scope.pathOf('/workkit/'), 'and the prefix on its own is the Overview').toBe('/');
      expect(scope.isScopedPath('/workkit/board') && scope.isScopedPath('/workkit/settings'), 'so a prefixed nav link is still one of the tower’s own pages').toBeTruthy();
      expect(!scope.isScopedPath('/workkit/pricing'), 'and a prefixed link that is not is still left alone').toBeTruthy();
    });
    // The stamp is written only when there is a prefix, so every absence says
    // the same thing whatever the page path looks like. A copy opened at
    // `/index.html` is where a path-shaped guess goes wrong.
    served(stamped(null), '/index.html', () => {
      expect(scope.basePath(), 'no stamp is no prefix, whatever the address bar says').toBe('');
      expect(scope.sitePath('/settings'), 'so nothing a root-served copy builds is moved').toBe('/settings');
      expect(scope.scopedHref('/board', 'omega'), 'and its nav links are the links they always were').toBe('/board?repo=omega');
      expect(scope.isScopedPath('/board'), 'page identity is untouched too').toBeTruthy();
    });
    served(stamped('/'), '/board', () => {
      expect(scope.basePath(), 'a stamp naming the domain root is no prefix either').toBe('');
    });
    expect(scope.basePath(), 'and a runtime with no document at all is at the root - never a crash').toBe('');
  });
});
