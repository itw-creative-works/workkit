//
// Tests for the tower dashboard's chrome.js: the strip above the body.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, mkState, ROSTER } = require('./helpers');

const run = async () => {
  const { chrome } = await loadLibs();

  group('tower/app: chrome - the strip above the body');

  const CHROME = { ...mkState({ repos: ROSTER }), pending: false, stamp: 'read 10:00:00' };

  await test('the frame draws Refresh and the region the status goes in, and no other control at all', () => {
    const frame = chrome.chromeMarkup();
    assert(frame.includes('id="tower-refresh"'), 'Refresh is in the frame');
    assert(frame.includes('data-tower-status'), 'with an empty region the status is written into');
    assert(!frame.includes('spinner-border') && !frame.includes('read 10:00:00'), 'and nothing that changes on a read');
    // The selection moved to the sidebar (#104), where the nav that carries it
    // from page to page is - the dropdown above the body is gone with it.
    assert(!frame.includes('tower-repo') && !frame.includes('<select'), 'the repo dropdown is gone');
    // And the token moved to Settings (#167), which is where one is typed - the
    // button that forgot it was the last thing in this strip that varied.
    assert(!frame.includes('tower-token') && !/token/i.test(frame), 'and so is the Token button');
  });

  await test('the frame takes no state, which is why the runtime writes it once', () => {
    // The defect it was split in two for: the frame was rewritten on both halves
    // of every poll, so a control open when a read started was closed by the
    // read landing. Nothing on it varies now, so there is no key to compare -
    // page.js writes it before the loop and never again.
    assertEq(chrome.chromeMarkup.length, 0, 'it is called with nothing');
    assertEq(chrome.chromeMarkup(), chrome.chromeMarkup(CHROME), 'and a state handed to it anyway changes nothing');
    assertEq(chrome.chromeKey, undefined, 'the key is gone with the button it keyed on');
  });

  await test('the status says whether a read is in flight and when the last one landed', () => {
    assert(chrome.statusMarkup({ pending: true, stamp: 'read 10:00:00' }, []).includes('spinner-border'), 'the spinner while it reads');
    const idle = chrome.statusMarkup({ pending: false, stamp: 'read 10:00:00' }, []);
    assert(!idle.includes('spinner-border'), 'and none when it is done');
    assert(idle.includes('read 10:00:00'), 'with the stamp itself');
    assert(chrome.statusMarkup({ pending: false, stamp: '' }, []).includes('reading…'), 'before the first answer it says so rather than drawing blank');
  });

  await test('an unavailable feed is named in the chip and its reason is text', () => {
    const one = chrome.statusMarkup(CHROME, [{ name: 'board', reason: 'gh is not logged in' }]);
    assert(one.includes('>1 feed unavailable<'), 'one feed, singular');
    assert(one.includes('title="board: gh is not logged in"'), 'and the reason in the tooltip');
    const two = chrome.statusMarkup(CHROME, [{ name: 'board', reason: 'a' }, { name: 'health', reason: 'b' }]);
    assert(two.includes('>2 feeds unavailable<'), 'two, plural');
    assert(!chrome.statusMarkup(CHROME, []).includes('omega-chip'), 'and a healthy read draws no chip');
    assert(!chrome.statusMarkup(CHROME, [{ name: 'x', reason: '<img src=x>' }]).includes('<img'), 'a hostile reason is escaped');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
