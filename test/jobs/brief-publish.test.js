// Tests for jobs/morning/brief-publish.js, the cloud brief's post: publishBrief()
// in this process against a recording Node `gh` first on PATH, in a scratch HOME
// and WORKFLOW_HOME. What the dashboard makes of a post is tower/api/lib/history.js's
// own reading, handed what the stand-in received.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { recordArgvJs, readArgv, fmtCalls } = require('../lib/argv-log');
const {
  homeEnv, stubToolJs, systemPathWith, joinPath, basePathWithout,
} = require('../lib/platform');
const { underEnv } = require('../lib/under-env');

const { publishBrief } = require(path.join(__dirname, '..', '..', 'jobs', 'morning', 'brief-publish.js'));
const { briefHistory } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

const URL = 'https://github.com/owner/private-home/discussions/9';

// The publisher dates its title by the local day, never the UTC one.
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * A machine the brief can be published from. `home` is the settings' home repo
 * (null: none), `posted` the titles the Brief category already carries today,
 * and `gh: false` a machine without the tool. The stand-in keeps the body it
 * was handed, since the body file is the publisher's to rewrite.
 */
const mkWorld = ({ home = 'owner/private-home', posted = [], gh = true } = {}) => {
  const root = mkTmp('brief-publish-');
  const bin = path.join(root, 'bin');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });
  fs.writeFileSync(
    path.join(workflowHome, 'settings.json'),
    JSON.stringify({ version: 1, site: { repo: home, publish: false, url: null } }, null, 2),
  );
  const ghLog = path.join(root, 'gh-argv.log');
  const bodyLog = path.join(root, 'posted-body.md');
  const categories = ['Daily', 'Weekly', 'Monthly', 'Brief'].map((name, i) => ({ id: `DIC_${i}`, name }));
  const prior = posted.map((title) => ({ title, createdAt: `${today()}T09:00:00Z`, body: 'already published' }));
  if (gh) {
    stubToolJs(bin, 'gh', [
      "const fs = require('fs');",
      recordArgvJs(JSON.stringify(ghLog), 'process.argv.slice(2)'),
      'const args = process.argv.slice(2);',
      "const all = args.join(' ');",
      'const answer = (data) => process.stdout.write(JSON.stringify({ data }));',
      "if (all.includes('createDiscussion')) {",
      "  const body = args.find((a) => a.startsWith('body=@'));",
      `  if (body) fs.writeFileSync(${JSON.stringify(bodyLog)}, fs.readFileSync(body.slice('body=@'.length), 'utf8'));`,
      `  answer({ createDiscussion: { discussion: { url: ${JSON.stringify(URL)} } } });`,
      "} else if (all.includes('discussionCategories')) {",
      `  answer({ repository: { id: 'R_kdt', hasDiscussionsEnabled: true, discussionCategories: { nodes: ${JSON.stringify(categories)} } } });`,
      "} else if (all.includes('discussions(first')) {",
      `  answer({ repository: { discussions: { nodes: ${JSON.stringify(prior)} } } });`,
      '} else {',
      "  process.stdout.write('{}');",
      '}',
    ].join('\n'));
  }
  return {
    root,
    workflowHome,
    created: () => readArgv(ghLog).filter((c) => c.join(' ').includes('createDiscussion')),
    ghCalls: () => readArgv(ghLog),
    postedBody: () => (fs.existsSync(bodyLog) ? fs.readFileSync(bodyLog, 'utf8') : ''),
    over: homeEnv(path.join(root, 'home'), {
      WORKFLOW_HOME: workflowHome,
      PATH: gh ? systemPathWith(bin) : joinPath(bin, basePathWithout(root, 'gh')),
    }),
  };
};

/** publishBrief() in this process, under the world's env, with its files in the world. */
const publish = (world, response, mark = '') => {
  const markFile = path.join(world.root, 'cc-version');
  fs.writeFileSync(markFile, mark);
  const bodyFile = path.join(world.root, 'brief.md');
  return underEnv(world.over, () => publishBrief({ response, markFile, bodyFile }));
};

describe('jobs/morning/brief-publish: the brief the dashboard reads', () => {
  test('a brief the publisher posts is one the history reads back as a brief', async () => {
    const world = mkWorld();
    const stats = '<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":12,"waiting":1,"ready":2,"inFlight":0,"inbox":3,"backlog":0},"closedDay":4,"repos":{"owner/repo":{"open":12}}} -->';
    const { code, line } = await publish(world, `HEADLINE: one thing today.\n\n${stats}`, '<!-- cc-news: 2.1.220 -->');
    expect(code, `posted: ${line}`).toBe(0);
    const created = world.created();
    expect(created.length, `one createDiscussion mutation: ${fmtCalls(world.ghCalls())}`).toBe(1);
    const title = created[0].find((a) => a.startsWith('title=')).slice('title='.length);
    const nodes = [{ title, body: world.postedBody() }];
    const out = briefHistory({
      workflowHome: world.workflowHome,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    });
    expect(out.length, `the post is read as a brief: ${JSON.stringify(nodes)}`).toBe(1);
    expect(out[0].totals.open, 'with the board it carried').toBe(12);
  });
});

describe('jobs/morning/brief-publish: nothing to post is 2', () => {
  test('today’s brief already on the board, no home repo, or no gh: 2, a line, and nothing posted', async () => {
    const twice = mkWorld({ posted: [`brief: ${today()}`] });
    const again = await publish(twice, 'HEADLINE: one thing today.');
    expect(again.code, `already posted: ${again.line}`).toBe(2);
    expect(again.line.includes(`already carries brief: ${today()}`), `and it says so: ${again.line}`).toBeTruthy();
    expect(twice.created().length, `nothing was posted: ${fmtCalls(twice.ghCalls())}`).toBe(0);

    const homeless = mkWorld({ home: null });
    const nowhere = await publish(homeless, 'HEADLINE: one thing today.');
    expect(nowhere.code, `no home repo: ${nowhere.line}`).toBe(2);
    expect(/no home repo configured/.test(nowhere.line), `and it says so: ${nowhere.line}`).toBeTruthy();
    expect(homeless.ghCalls().length, `GitHub was never asked: ${fmtCalls(homeless.ghCalls())}`).toBe(0);

    const ghless = mkWorld({ gh: false });
    const untold = await publish(ghless, 'HEADLINE: one thing today.');
    expect(untold.code, `no gh: ${untold.line}`).toBe(2);
    expect(untold.line.includes('nothing published'), `and it says so: ${untold.line}`).toBeTruthy();
  });
});
