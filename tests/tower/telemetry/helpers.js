//
// The shared prologue of the tower/api/lib/telemetry suites, the `*.test.js`
// files beside this one, which test tower/api/lib/telemetry.js (the token
// ledger read from transcripts) one concern each. A plain module, never a
// suite: the runner only loads files ending in `.test.js`.
//
// Everything is a fixture: a scratch ~/.claude projects tree written in the
// exact shapes Claude Code uses (an assistant line carrying message.usage, a
// subagents/ folder holding agent-<id>.jsonl beside agent-<id>.meta.json), a
// scratch marker directory, and a fake `ps`. Nothing here reads the real
// transcripts on this machine, and nothing here goes near the network.
//

const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib');
const {
  collectTelemetry, sessionTelemetry, readUsage, resetCache, cachedPaths,
  costOf, className, dayKey, PRICING, OVERTIME_DAYS,
} = require(path.join(lib, 'telemetry.js'));
const { listSessions, transcriptPath } = require(path.join(lib, 'sessions.js'));
const { createServer } = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'server.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-telemetry-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const PRICED = 'claude-opus-4-1';

/**
 * An assistant line in the shape Claude Code writes, usage block and all.
 * `ttl5`/`ttl1h` add the `cache_creation` split the real blocks carry; without
 * them the line is the legacy shape that names only the total.
 */
const assistantLine = ({
  id, model = PRICED, input = 0, output = 0, cacheRead = 0, cacheCreation = 0,
  ttl5 = null, ttl1h = null, timestamp = '2026-07-27T12:00:00.000Z', content = null,
} = {}) => {
  const usage = {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
  };
  if (ttl5 !== null || ttl1h !== null) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: ttl5 || 0,
      ephemeral_1h_input_tokens: ttl1h || 0,
    };
  }
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${id}`,
    timestamp,
    message: {
      id, model, role: 'assistant', content: content || [{ type: 'text', text: 'hi' }], usage,
    },
  });
};

/** The `Agent` tool_use line that spawns a subagent, carrying its class. */
const spawnLine = ({ id, toolUseId, subagentType, timestamp = '2026-07-27T12:00:00.000Z' }) => assistantLine({
  id,
  timestamp,
  output: 0,
  content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: subagentType, description: 'go' } }],
});

/** A scratch world: fake home, marker dir, statusline cache, and a fake `ps`. */
const mkWorld = () => {
  const root = mkTmp();
  const world = {
    root,
    home: path.join(root, 'home'),
    markerDir: path.join(root, 'claude-keep-awake'),
    stateDir: path.join(root, 'claude-session-state'),
  };
  fs.mkdirSync(world.markerDir, { recursive: true });
  fs.mkdirSync(world.stateDir, { recursive: true });
  world.exec = (cmd, args) => {
    if (cmd === 'ps') return `caffeinate -d -i -w ${args[args.length - 1] - 1000}\n`;
    throw new Error(`unexpected exec: ${cmd}`);
  };
  resetCache();
  return world;
};

/** A live marker plus its transcript. Returns the transcript path. */
const mkSession = (world, { pid = 7001, cwd = '/x/fixture', session = 'sess-1', lines = [] } = {}) => {
  fs.writeFileSync(path.join(world.markerDir, String(pid)), `caffeinate=${pid + 1000}\ncwd=${cwd}\nsession=${session}\n`);
  const file = transcriptPath(world.home, cwd, session);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '');
  return file;
};

/** A subagent transcript and its sidecar meta, under a parent transcript. */
const mkSubagent = (transcript, id, { lines = [], meta = {} } = {}) => {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agent-${id}.jsonl`);
  fs.writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '');
  if (meta) fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
  return file;
};

const collect = (world, opts = {}) => collectTelemetry({
  home: world.home,
  markerDir: world.markerDir,
  stateDir: world.stateDir,
  exec: world.exec,
  ...opts,
});

/** Listen on port 0 and hand back a client bound to whatever port that was. */
const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({
      port,
      url: (p) => `http://127.0.0.1:${port}${p}`,
      stop: () => new Promise((done) => server.close(done)),
    });
  });
});

const getJson = async (client, p) => {
  const res = await fetch(client.url(p));
  return { status: res.status, body: await res.json() };
};

module.exports = {
  sessionTelemetry, readUsage, resetCache, cachedPaths, costOf, className, dayKey, PRICING, OVERTIME_DAYS,
  listSessions, createServer,
  mkTmp, cleanup, PRICED, assistantLine, spawnLine, mkWorld, mkSession, mkSubagent, collect, listen, getJson,
};
