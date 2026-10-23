// The world beneath the kit's hooks module for the tests/mods/*.test.ts wiring
// suites: a file tree, git, gh, the engine scripts, the store and the session,
// each answered from memory through the test kit's `on`. World paths live
// under /w/; any other path is the kit's own folder, answered from KIT.

import { mock } from 'claude-code/testing'
import { MODELS } from './mod-fixtures.mjs'

export { MODELS, row, SESSION_NOW, daysBefore, briefMarker } from './mod-fixtures.mjs'

// hooks/manager/resources/ladder.json, the fields the module reads; the test
// environment has no fs, so the fixture carries its own copy.
export const LADDER = {
  note: 'fixture copy of hooks/manager/resources/ladder.json',
  mode: 'rewrite',
  ladder: { fable: 'fable', opus: 'opus', sonnet: 'sonnet', haiku: 'haiku' },
  classes: { scout: 'fast', worker: 'workhorse', verifier: 'workhorse', advisor: 'frontier' },
  tiers: { frontier: 'fable', workhorse: 'opus', fast: 'sonnet' },
}

export const HOME = '/w/home'
export const REPO = '/w/repo'
export const PLAIN = '/w/plain'
export const SID = 'sess-1'
export const OPTED_IN = '{ "version": 1, "enabled": true }\n'
export const OPTED_OUT = '{ "version": 1, "enabled": false }\n'

// The kit's load-time surfaces and the files the module reads from its own folder.
const KIT_DEFAULT: Record<string, string> = {
  'hooks/hooks.json': '{ "hooks": {} }\n',
  'hooks/manager/resources/ladder.json': JSON.stringify(LADDER),
  'agents/worker.md': '# worker\n',
  'skills/ship/SKILL.md': '# ship\n',
  'workflow/standards.sh': '#!/usr/bin/env bash\n',
  'workflow/labels.json': '{ "version": 1, "groups": {} }\n',
  'workflow/workkit.sh': '#!/usr/bin/env bash\n',
  'workflow/changelog/changelog.js': '// linter\n',
  'docs/project-state.md': '# project state\n',
}

const ok = (stdout = '', stderr = '', exitCode = 0) => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// A Windows path (`C:\repo\x`) is kept under its drive with forward slashes,
// the spelling git for Windows answers in, so both spellings name one file.
// On a Mac the engine resolves one under the session folder first, so the
// drive is found wherever it sits in the path.
const DRIVE = /^[A-Za-z]:[\\/]/
const DRIVE_TAIL = /(?:^|[\\/])([A-Za-z]:[\\/].*)$/
const norm = (raw: string, cwd: string): string => {
  const p = raw.match(DRIVE_TAIL)?.[1] ?? raw
  if (!DRIVE.test(p) && !p.startsWith('/')) return norm(`${cwd}/${p}`, cwd)
  const drive = DRIVE.test(p) ? p.slice(0, 2) : ''
  const parts: string[] = []
  for (const seg of p.slice(drive.length).replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return `${drive}/${parts.join('/')}`
}

// The git reads behind a touched-file list: `diff HEAD --name-only` from the
// status's tracked lines, and from `branch` (a root's `opts.branch` entry) the
// committed leg: `originHead`, `upstream`, `base` and `committed` (the paths
// `diff <base> HEAD --name-only` lists). Null for any other read.
const touchedGit = (args: string[], branch: any, status: string | undefined) => {
  let sub = args
  while (sub[0] === '-c') sub = sub.slice(2)
  const list = (paths: string[]) => ok(paths.map((p) => `${p}${sub.includes('-z') ? '\0' : '\n'}`).join(''))
  if (branch && sub[0] === 'symbolic-ref') return branch.originHead ? ok(`${branch.originHead}\n`) : ok('', '', 1)
  if (branch && sub[0] === 'rev-parse' && sub.includes('@{u}')) return branch.upstream ? ok(`${branch.upstream}\n`) : ok('', 'fatal: no upstream configured\n', 128)
  if (branch && sub[0] === 'merge-base') return branch.base ? ok(`${branch.base}\n`) : ok('', '', 1)
  if (sub[0] !== 'diff' || !sub.includes('--name-only') || sub.includes('--cached') || sub.includes('--staged')) return null
  const revs = sub.slice(1).filter((a) => !a.startsWith('-'))
  if (revs.length === 2 && branch) return list(branch.committed || [])
  if (revs.length !== 1 || revs[0] !== 'HEAD' || status === undefined) return null
  return list(status.split('\n').filter((l) => l.length > 3 && !l.startsWith('?? ')).map((l) => l.slice(3)))
}

// The git reads behind a commit the gate judges, from `opts.git`: `staged` and
// `changed` (`diff [--cached] --name-only`, `added` and `deleted` their A and D
// statuses), `headTime`, `blobs` by `HEAD:<path>` and `:<path>`, `indexTree`;
// `broken` makes the staged read resolve to nothing. Null for any other read.
const commitGit = (args: string[], git: any) => {
  let sub = args
  while (sub[0] === '-c') sub = sub.slice(2)
  const lines = (paths: string[]) => ok(paths.map((p) => `${p}\n`).join(''))
  const spec = sub.slice(1).filter((a) => !a.startsWith('-')).pop() ?? ''
  if (sub[0] === 'diff' && sub.includes('--name-only') && spec === '') {
    const cached = sub.includes('--cached') || sub.includes('--staged')
    if (cached && git.broken) return { value: undefined }
    const list: string[] = cached ? git.staged : git.changed
    const filter = (sub.find((a) => a.startsWith('--diff-filter=')) || '').slice('--diff-filter='.length)
    if (filter === 'A') return lines(list.filter((p) => git.added.includes(p)))
    if (filter === 'D') return lines(list.filter((p) => git.deleted.includes(p)))
    if (filter === 'd') return lines(list.filter((p) => !git.deleted.includes(p)))
    return lines(list)
  }
  if (sub[0] === 'log' && sub.includes('--format=%ct')) return ok(`${git.headTime}\n`)
  if (sub[0] === 'show' && spec.includes(':')) return spec in git.blobs ? ok(git.blobs[spec]) : ok('', `fatal: path '${spec}' does not exist\n`, 128)
  if (sub[0] === 'rev-parse' && sub.includes('--verify') && spec.includes(':')) return spec in git.blobs ? ok(`${'b'.repeat(40)}\n`) : ok('', '', 1)
  if (sub[0] === 'write-tree') return ok(`${git.indexTree}\n`)
  return null
}

/**
 * Registers the world on `on` and hands back its state: `files` (path to text), `mtimes`,
 * `store`, `calls` (each process.run argv and init), `fsOps` (each fs read and write, in order),
 * `logs` ($.ui.log lines), `spawned`
 * (what reached the spawn), `reached` (each classic event past the module), `messages`
 * ($.session.messages(), `opts.messages`: `row` rows). `opts.links`: link to target, every
 * read goes through it, a resolving stat answers `realPath`. `opts.origins`: a root's
 * origin url, null for none; `opts.npm`: `{ taken, known }` or `offline`;
 * `opts.releases`: `{ tags }` or `offline`; `opts.treeId`. `opts.status`, `opts.diff`: a
 * root's `git status --porcelain` and `git diff HEAD` text; `opts.ignored`: the paths
 * `git check-ignore` answers for, one ending in `/` a whole folder. `opts.git`,
 * `opts.scriptShell`, `opts.rewrite`: the commit reads (`commitGit`, the npm branch).
 * `opts.dirs`: folders that exist with nothing in them; a run whose `cwd` is no folder
 * the world holds (PLAIN and the session folder always are) does not start.
 * A link to a folder carries every path beneath it.
 */
export const mkWorld = (on: any, opts: any = {}) => {
  const now = opts.now ?? Date.now()
  const env = { HOME, ...(opts.env || {}) }
  const files = new Map<string, string>(Object.entries(opts.files || {}).map(([p, t]) => [norm(p, '/'), t as string]))
  const mtimes = new Map<string, number>()
  const kit = new Map<string, string>(Object.entries({ ...KIT_DEFAULT, ...(opts.kit || {}) }).filter(([, v]) => v !== null) as [string, string][])
  const kitMtimes = new Map<string, number>()
  const unreadable = new Set<string>(opts.unreadable || [])
  const links = new Map<string, string>(Object.entries(opts.links || {}).map(([a, b]) => [norm(a, '/'), norm(b as string, '/')]))
  const through = (p: string) => {
    if (links.has(p)) return links.get(p) as string
    for (const [link, target] of links) if (p.startsWith(`${link}/`)) return `${target}${p.slice(link.length)}`
    return p
  }
  const dirs = new Set<string>([PLAIN, ...(opts.dirs || [])].map((d: string) => norm(d, '/')))
  const repos: Record<string, string | null> = Object.fromEntries(Object.entries(opts.repos === undefined ? { [REPO]: OPTED_IN } : opts.repos)
    .map(([root, settings]) => [norm(root, '/'), settings as string | null]))
  for (const [root, settings] of Object.entries(repos)) {
    files.set(`${root}/.git/HEAD`, 'ref: refs/heads/main\n')
    if (settings !== null) files.set(`${root}/.workkit/settings.json`, settings)
  }
  if (opts.setup !== false) files.set(`${HOME}/.local/bin/workkit`, '#!/usr/bin/env bash\n')
  const world: any = {
    env, files, mtimes, kit, kitMtimes, unreadable, repos, now,
    store: new Map<string, unknown>(Object.entries(opts.store || {})),
    calls: [] as any[], logs: [] as string[], spawned: [] as any[], reached: [] as string[], fsOps: [] as any[],
    messages: opts.messages ?? [],
    cwd: opts.cwd ? norm(opts.cwd, '/') : REPO,
    model: opts.model ?? MODELS.opus,
    gh: opts.gh ?? { issues: [] },
    releases: opts.releases ?? { tags: [] },
    npm: opts.npm ?? { taken: [], known: [] },
    treeId: opts.treeId ?? 'a'.repeat(40),
    status: Object.fromEntries(Object.entries(opts.status || {}).map(([r, t]) => [norm(r, '/'), t])),
    diffs: Object.fromEntries(Object.entries(opts.diff || {}).map(([r, t]) => [norm(r, '/'), t])),
    ignored: (opts.ignored || []).map((p: string) => ({ path: norm(p, '/'), folder: p.endsWith('/') })),
    origins: Object.fromEntries(Object.keys(repos).map((root) => [root, `https://github.com/acme/${root.split('/').pop()}.git`])),
    lint: opts.lint ?? { exitCode: 0, stdout: '', stderr: '' },
    git: { staged: [], changed: [], added: [], deleted: [], headTime: Math.floor(now / 1000) - 60, blobs: {}, indexTree: opts.treeId ?? 'a'.repeat(40), ...(opts.git || {}) },
    standards: { state: 'enabled', heal: { exitCode: 0, stdout: '', stderr: '' }, update: { exitCode: 0, stdout: '', stderr: '' }, ...(opts.standards || {}) },
  }

  for (const [root, url] of Object.entries(opts.origins || {})) world.origins[norm(root, '/')] = url

  const inWorld = (p: string) => p.startsWith('/w/') || DRIVE.test(p)
  const kitRel = (p: string) => {
    if (inWorld(p)) return undefined
    for (const rel of kit.keys()) if (p.endsWith(`/${rel}`)) return rel
    return undefined
  }
  const kitDir = (p: string) => {
    if (inWorld(p)) return undefined
    for (const rel of kit.keys()) {
      const segs = rel.split('/')
      for (let i = 1; i < segs.length; i++) {
        const dir = segs.slice(0, i).join('/')
        if (p.endsWith(`/${dir}`)) return { dir, base: p.slice(0, p.length - dir.length - 1) }
      }
    }
    return undefined
  }
  const fileText = (q: string) => {
    const p = through(q)
    return files.has(p) ? files.get(p) : (kitRel(p) ? kit.get(kitRel(p) as string) : undefined)
  }
  const mtimeOf = (p: string) => (files.has(p) ? (mtimes.get(p) ?? now - 3600e3) : (kitMtimes.get(kitRel(p) as string) ?? 1700000000000))
  const isDir = (p: string) => {
    if (dirs.has(p) || p === world.cwd) return true
    for (const f of files.keys()) if (f.startsWith(`${p}/`)) return true
    return Boolean(kitDir(p))
  }
  const children = (p: string) => {
    const out = new Map<string, any>()
    const add = (rest: string, full: string) => {
      const [name, ...more] = rest.split('/')
      if (more.length) out.set(name, { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
      else out.set(name, { name, kind: 'file', size: (fileText(full) || '').length, mtimeMs: mtimeOf(full), isLink: false })
    }
    for (const f of files.keys()) if (f.startsWith(`${p}/`)) add(f.slice(p.length + 1), f)
    const kd = kitDir(p)
    if (kd) for (const rel of kit.keys()) if (rel.startsWith(`${kd.dir}/`)) add(rel.slice(kd.dir.length + 1), `${p}/${rel.slice(kd.dir.length + 1)}`)
    return [...out.values()]
  }
  const missing = (p: string) => ({ deny: `ENOENT: no such file or directory, '${p}'` })

  on('fs.read', ($: any, e: any) => {
    const p = norm(e.path, world.cwd)
    world.fsOps.push({ op: 'read', path: p })
    if (unreadable.has(p)) return { deny: `EACCES: permission denied, open '${p}'` }
    const text = fileText(p)
    return text === undefined ? missing(p) : { value: text }
  })
  on('fs.write', ($: any, e: any) => {
    const p = norm(e.path, world.cwd)
    world.fsOps.push({ op: 'write', path: p })
    files.set(p, e.text)
    mtimes.set(p, Date.now())
    return { value: undefined }
  })
  on('fs.exists', ($: any, e: any) => {
    const p = norm(e.path, world.cwd)
    return { value: fileText(p) !== undefined || isDir(p) }
  })
  on('fs.list', ($: any, e: any) => {
    const p = norm(e.path, world.cwd)
    return isDir(p) ? { value: children(p) } : missing(p)
  })
  on('fs.stat', ($: any, e: any) => {
    const p = norm(e.path, world.cwd)
    const real = through(p)
    if (fileText(p) !== undefined) {
      return { value: { kind: 'file', size: (fileText(p) as string).length, mtimeMs: mtimeOf(real), isLink: real !== p, ...(e.resolve ? { realPath: real } : {}) } }
    }
    if (isDir(p)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: p } : {}) } }
    return missing(p)
  })

  const rootOf = (dir: string) => Object.keys(repos)
    .filter((r) => dir === r || dir.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length)[0]

  on('process.run', ($: any, e: any) => {
    const argv: string[] = [...e.argv]
    const init = e.init || {}
    world.calls.push({ argv, init })
    const runDir = init.cwd ? norm(init.cwd, world.cwd) : null
    if (runDir && inWorld(runDir) && !isDir(through(runDir))) {
      return { value: { exitCode: null, stdout: '', stderr: `spawn ${argv[0]} ENOENT`, isStdoutTruncated: false, isStderrTruncated: false, isStarted: false } }
    }
    const base = (s: string) => s.split('/').pop() as string
    const cmd = base(argv[0])
    if (cmd === 'git') {
      let dir = init.cwd ? norm(init.cwd, world.cwd) : world.cwd
      const rest = argv.slice(1)
      while (rest[0] === '-C') { dir = norm(rest[1], dir); rest.splice(0, 2) }
      const root = rootOf(dir)
      if (!root) return ok('', 'fatal: not a git repository (or any of the parent directories): .git\n', 128)
      const touched = touchedGit(rest, opts.branch?.[root], world.status[root])
      if (touched) return touched
      const gated = commitGit(rest, world.git)
      if (gated) return gated
      if (rest[0] === 'rev-parse') {
        const answers: Record<string, string> = {
          '--show-toplevel': root,
          '--is-inside-work-tree': 'true',
          '--show-prefix': dir === root ? '' : `${dir.slice(root.length + 1)}/`,
          '--git-dir': `${root}/.git`,
        }
        const asked = rest.slice(1).filter((a) => a in answers)
        if (asked.length) return ok(asked.map((a) => `${answers[a]}\n`).join(''))
        return ok('', '', 1)
      }
      if (rest[0] === 'remote' && rest[1] === 'get-url' && rest[2] === 'origin') {
        const url = world.origins[root]
        return url ? ok(`${url}\n`) : ok('', "error: No such remote 'origin'\n", 2)
      }
      if (rest[0] === 'status' && rest.some((a) => a.startsWith('--porcelain'))) return ok(world.status[root] ?? '')
      if (rest[0] === 'diff' && rest.includes('HEAD') && !rest.some((a) => /^--(cached|staged|name-only|name-status|stat)$/.test(a))) return ok(world.diffs[root] ?? '')
      if (rest[0] === 'check-ignore') {
        const isIgnored = (p: string) => world.ignored.some((i: any) => p === i.path || (i.folder && p.startsWith(`${i.path}/`)))
        const hits = rest.slice(1).filter((a) => !a.startsWith('-') && isIgnored(norm(a, dir)))
        if (!hits.length) return ok('', '', 1)
        return ok(rest.includes('-q') ? '' : hits.map((a) => `${a}\n`).join(''))
      }
      // The untracked files are the status's `??` lines, each a file.
      if (rest[0] === 'ls-files' && rest.includes('--others') && !rest.includes('--cached')) {
        const list = (world.status[root] ?? '').split('\n').filter((l: string) => l.startsWith('?? ')).map((l: string) => l.slice(3)).sort()
        return rest.includes('-z') ? ok(list.map((f: string) => `${f}\0`).join('')) : ok(list.map((f: string) => `${f}\n`).join(''))
      }
      if (rest[0] === 'ls-files') {
        const list = [...files.keys()].filter((f) => f.startsWith(`${root}/`) && !f.startsWith(`${root}/.git/`))
          .map((f) => f.slice(root.length + 1)).sort()
        return rest.includes('-z') ? ok(list.map((f) => `${f}\0`).join('')) : ok(list.map((f) => `${f}\n`).join(''))
      }
      return ok('', '', 1)
    }
    if (cmd === 'gh' && argv[1] === 'release' && argv[2] === 'view') {
      if (world.releases === 'offline') return ok('', 'gh: To get started with GitHub CLI, please run: gh auth login\n', 1)
      return world.releases.tags.includes(argv[3]) ? ok(`${argv[3]}\n`) : ok('', 'release not found\n', 1)
    }
    // `npm view <name>@<version> version`, the registry answering as npm does:
    // the version when taken, nothing for a known package without it, E404 else.
    if (cmd === 'npm' && argv[1] === 'view') {
      if (world.npm === 'offline') return ok('', 'npm error code ENOTFOUND request to https://registry.npmjs.org failed\n', 1)
      const spec = argv.slice(2).filter((a) => !a.startsWith('-') && a !== 'version').pop() || ''
      if (world.npm.taken.includes(spec)) return ok(`${spec.slice(spec.lastIndexOf('@') + 1)}\n`)
      if (world.npm.known.includes(spec.slice(0, spec.lastIndexOf('@')))) return ok()
      return ok('', 'npm error code E404\n', 1)
    }
    if (argv.some((a) => a.endsWith('tree-hash.sh'))) return ok(`${world.treeId}\n`)
    // `opts.rewrite`: the rewrite entry's stdout; `opts.scriptShell`: npm's value, npm missing when unset.
    if (argv.some((a) => a.endsWith('changelog-job.sh'))) return ok(opts.rewrite ?? '')
    if (cmd === 'npm' && argv.slice(1, 4).join(' ') === 'config get script-shell') {
      return typeof opts.scriptShell === 'string' ? ok(`${opts.scriptShell}\n`) : ok('', 'npm: command not found\n', 127)
    }
    // `gh issue view <n>`: the number's view from `gh.views`, gh's not-found error else.
    if (cmd === 'gh' && argv[1] === 'issue' && argv[2] === 'view' && world.gh?.views) {
      const n = String(argv[3]).replace(/^.*\//, '')
      const view = world.gh.views[n]
      return view === undefined ? ok('', `GraphQL: Could not resolve to an issue or pull request with the number of ${n}.\n`, 1) : ok(JSON.stringify(view))
    }
    // `bash <kit>/hooks/lib/snapshot.sh <mode> <root> ...`: `opts.snapshot[mode]`'s answer, a success else.
    // A root in `opts.snapshotDirs` keeps its folder in `files` as a successful take, add or drop leaves it.
    const snap = argv.findIndex((a) => a.endsWith('snapshot.sh'))
    if (snap >= 0) {
      const [mode, root, ...nums] = argv.slice(snap + 1)
      const r = (opts.snapshot || {})[mode] || {}
      const dir = (opts.snapshotDirs || {})[root]
      if (dir && (r.exitCode ?? 0) === 0) {
        const had = mode === 'add' ? (files.get(`${dir}/issues`) || '').split('\n').filter(Boolean) : []
        if (mode === 'drop') for (const f of [...files.keys()]) { if (f.startsWith(`${dir}/`)) files.delete(f) }
        if (mode === 'take') files.set(`${dir}/tree/.keep`, '')
        if (mode === 'take' || mode === 'add') files.set(`${dir}/issues`, [...new Set([...had, ...nums])].map((n) => `${n}\n`).join(''))
      }
      return ok(r.stdout || '', r.stderr || '', r.exitCode ?? 0)
    }
    if (cmd === 'gh') {
      if (world.gh === 'absent') return { deny: 'spawn gh ENOENT' }
      if (world.gh === 'offline') return ok('', 'error connecting to api.github.com\n', 1)
      return ok(JSON.stringify(world.gh.issues))
    }
    const script = argv.find((a) => /(standards|workkit|changelog|hooks)\.(sh|js)$/.test(a)) || ''
    if (script.endsWith('changelog.js')) return ok(world.lint.stdout || '', world.lint.stderr || '', world.lint.exitCode)
    if (script.endsWith('standards.sh')) {
      if (argv.includes('--state')) return ok(`${world.standards.state}\n`)
      if (argv.includes('--announce')) {
        const root = argv[argv.length - 1]
        return ok(`this repo is not in the issue workflow; say the word to enable it (bash ${script} --enable ${root}), or decline and it will not ask again (--decline).\n`)
      }
      const r = world.standards.heal
      return ok(r.stdout || '', r.stderr || '', r.exitCode ?? 0)
    }
    if (script.endsWith('workkit.sh')) {
      const r = world.standards.update
      return ok(r.stdout || '', r.stderr || '', r.exitCode ?? 0)
    }
    if (script.endsWith('hooks.sh')) return ok()
    return ok('', `${cmd}: command not found\n`, 127)
  })

  mock.env(on, env)
  mock.clock(on, { now })
  on('store.get', ($: any, e: any) => ({ value: world.store.get(e.key) }))
  on('store.set', ($: any, e: any) => { world.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { world.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...world.store.keys()] }))
  on('session.model', () => ({ value: world.model }))
  // `opts.cwdFails`: the session's folder cannot be read, as a dead session answers.
  on('session.cwd', () => (opts.cwdFails ? { deny: 'session.cwd: the session has no folder' } : { value: world.cwd }))
  on('session.root', () => ({ value: world.cwd }))
  on('session.id', () => ({ value: SID }))
  on('session.messages', () => ({ value: world.messages }))
  on('ui.log', ($: any, e: any) => { world.logs.push(e.text); return { value: undefined } })

  // The engine beneath every event the module hooks: it answers as given, and
  // `reached` names each event that got this far.
  for (const ev of ['UserPromptSubmit', 'SessionStart', 'PostToolUse', 'SubagentStart', 'PreToolUse', 'Stop']) {
    on(`classic.${ev}`, () => { world.reached.push(`classic.${ev}`); return {} })
  }
  on('tool.call', ($: any, e: any) => { world.toolRan = e; return { result: { text: 'ran' } } })
  on('agent.spawn', ($: any, e: any) => { world.spawned.push(e); return { model: e.model ?? 'inherit', agentId: 'agent-1' } })
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))

  world.sessionKeys = (sid: string) => [...world.store.keys()].filter((k: string) => k.startsWith(`workkit:${sid}:`))
  world.touchKit = (rel: string, text?: string | null) => {
    if (text === null) kit.delete(rel)
    else if (text !== undefined) kit.set(rel, text)
    kitMtimes.set(rel, (kitMtimes.get(rel) ?? 1700000000000) + 600e3)
  }
  world.ghCalls = () => world.calls.filter((c: any) => c.argv[0].split('/').pop() === 'gh')
  world.runs = (suffix: string) => world.calls.filter((c: any) => c.argv.some((a: string) => a.endsWith(suffix)))
  return world
}

/** The hooks-log lines in `<dir>/hooks.log`, each split into its six fields. */
export const hooksLog = (world: any, dir = `${HOME}/.workkit`) => (world.files.get(`${dir}/hooks.log`) || '')
  .split('\n').filter(Boolean)
  .map((line: string) => {
    const [iso, hook, event, sid, cwd, verdict] = line.split('\t')
    return { line, iso, hook, event, sid, cwd, verdict }
  })

/** Every context entry of a classic result joined into one text. */
export const contextOf = (r: any) => (r && Array.isArray(r.additionalContext) ? r.additionalContext.join('\n') : '')

// A plugin seated above the kit that relays what the kit's classic.PreToolUse
// hook answered, since $.tool.call returns the tool's result, not the hook's.
export const SPY = {
  name: 'spy',
  tier: 'prepend' as const,
  register(on: any) {
    on('classic.PreToolUse', async ($: any, e: any, next: any) => {
      const r = await next(e)
      await $.ui.log(`spy:${JSON.stringify(r ?? null)}`)
      return r
    })
  },
}

/** What the kit's PreToolUse hook answered, as the SPY relayed it. */
export const spied = (world: any) => world.logs.filter((l: string) => l.startsWith('spy:')).map((l: string) => JSON.parse(l.slice(4)))

// The same relay for tool.call: what the kit's Bash handler answered, its
// `deny` or its pass-through result with `context`.
export const TOOL_SPY = {
  name: 'tool-spy',
  tier: 'prepend' as const,
  register(on: any) {
    on('tool.call', async ($: any, e: any, next: any) => {
      const r = await next(e)
      await $.ui.log(`toolspy:${JSON.stringify(r ?? null)}`)
      return r
    })
  },
}

/** What the kit's tool.call handler answered, as the TOOL_SPY relayed it. */
export const toolSpied = (world: any) => world.logs.filter((l: string) => l.startsWith('toolspy:')).map((l: string) => JSON.parse(l.slice(8)))

/** A Bash tool.call through the module, as Claude Code makes one. */
export const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command, description: 'x' } as any)

/** The i-th answer the kit's tool.call handler gave, as the TOOL_SPY relayed it; null for none. */
export const answered = (world: any, i = 0) => toolSpied(world)[i] ?? null

/** That answer's deny, its trailing newline dropped; null when it did not deny. */
export const denyOf = (world: any, i = 0) => (typeof answered(world, i)?.deny === 'string' ? answered(world, i).deny.replace(/\n$/, '') : null)

/** The $.ui.log lines the kit wrote, the spies' relays left out. */
export const kitLogs = (world: any) => world.logs.filter((l: string) => !l.startsWith('spy:') && !l.startsWith('toolspy:'))
