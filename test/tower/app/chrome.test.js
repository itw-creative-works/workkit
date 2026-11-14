//
// Tests for the tower dashboard's chrome.js: the strip above the body.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, mkState, ROSTER } = require('./helpers');

describe('tower/app: chrome - the strip above the body', () => {
  let chrome;
  before(async () => { ({ chrome } = await loadLibs()); });

  const CHROME = { ...mkState({ repos: ROSTER }), pending: false, stamp: 'read 10:00:00' };

  test('the frame draws Refresh and the region the status goes in, and no other control at all', () => {
    const frame = chrome.chromeMarkup();
    expect(frame.includes('id="tower-refresh"'), 'Refresh is in the frame').toBeTruthy();
    expect(frame.includes('data-tower-status'), 'with an empty region the status is written into').toBeTruthy();
    expect(!frame.includes('spinner-border') && !frame.includes('read 10:00:00'), 'and nothing that changes on a read').toBeTruthy();
    // The repo selection lives in the sidebar, whose nav carries it from page
    // to page.
    expect(!frame.includes('tower-repo') && !frame.includes('<select'), 'the repo dropdown is gone').toBeTruthy();
    // The token is typed on Settings, so nothing left in this strip varies.
    expect(!frame.includes('tower-token') && !/token/i.test(frame), 'and so is the Token button').toBeTruthy();
  });

  test('the frame takes no state, which is why the runtime writes it once', () => {
    // A frame rewritten on every poll closes a control left open across a read;
    // nothing on it varies, so page.js writes it once, before the loop.
    expect(chrome.chromeMarkup.length, 'it is called with nothing').toBe(0);
    expect(chrome.chromeMarkup(), 'and a state handed to it anyway changes nothing').toBe(chrome.chromeMarkup(CHROME));
    expect(chrome.chromeKey, 'the key is gone with the button it keyed on').toBe(undefined);
  });

  test('the status says whether a read is in flight and when the last one landed', () => {
    expect(chrome.statusMarkup({ pending: true, stamp: 'read 10:00:00' }, []).includes('spinner-border'), 'the spinner while it reads').toBeTruthy();
    const idle = chrome.statusMarkup({ pending: false, stamp: 'read 10:00:00' }, []);
    expect(!idle.includes('spinner-border'), 'and none when it is done').toBeTruthy();
    expect(idle.includes('read 10:00:00'), 'with the stamp itself').toBeTruthy();
    expect(chrome.statusMarkup({ pending: false, stamp: '' }, []).includes('reading…'), 'before the first answer it says so rather than drawing blank').toBeTruthy();
  });

  test('an unavailable feed is named in the chip and its reason is text', () => {
    const one = chrome.statusMarkup(CHROME, [{ name: 'board', reason: 'gh is not logged in' }]);
    expect(one.includes('>1 feed unavailable<'), 'one feed, singular').toBeTruthy();
    expect(one.includes('title="board: gh is not logged in"'), 'and the reason in the tooltip').toBeTruthy();
    const two = chrome.statusMarkup(CHROME, [{ name: 'board', reason: 'a' }, { name: 'health', reason: 'b' }]);
    expect(two.includes('>2 feeds unavailable<'), 'two, plural').toBeTruthy();
    expect(!chrome.statusMarkup(CHROME, []).includes('omega-chip'), 'and a healthy read draws no chip').toBeTruthy();
    expect(!chrome.statusMarkup(CHROME, [{ name: 'x', reason: '<img src=x>' }]).includes('<img'), 'a hostile reason is escaped').toBeTruthy();
  });
});
