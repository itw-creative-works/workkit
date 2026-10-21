// The world beneath the kit's hooks module for the hooks/*.test.ts wiring
// suites: a file tree, git, gh, the engine scripts, the store and the session,
// each answered from memory through the test kit's `on`. World paths live
// under /w/; any other path is the kit's own folder, answered from KIT.

import { mock } from 'claude-code/testing'

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
export const MODELS = {
  fable: 'claude-fable-5[1m]', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5',
}
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

/**
 * Registers the world on the test's `on` and hands back its state: `files`
 * (path to text), `mtimes`, `store`, `calls` (every process.run argv and
 * init), `logs` ($.ui.log lines), `spawned` (what reached the engine's spawn).
 * `opts.links` maps a link path to its target: every read goes through it and
 * a resolving stat answers the target as `realPath`.
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
  const through = (p: string) => links.get(p) ?? p
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
    calls: [] as any[], logs: [] as string[], spawned: [] as any[],
    cwd: opts.cwd ? norm(opts.cwd, '/') : REPO,
    model: opts.model ?? MODELS.opus,
    gh: opts.gh ?? { issues: [] },
    lint: opts.lint ?? { exitCode: 0, stdout: '', stderr: '' },
    standards: { state: 'enabled', heal: { exitCode: 0, stdout: '', stderr: '' }, update: { exitCode: 0, stdout: '', stderr: '' }, ...(opts.standards || {}) },
  }

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
    if (unreadable.has(p)) return { deny: `EACCES: permission denied, open '${p}'` }
    const text = fileText(p)
    return text === undefined ? missing(p) : { value: text }
  })
  on('fs.write', ($: any, e: any) => {
    const p = norm(e.path, world.cwd)
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
    const base = (s: string) => s.split('/').pop() as string
    const cmd = base(argv[0])
    if (cmd === 'git') {
      let dir = init.cwd ? norm(init.cwd, world.cwd) : world.cwd
      const rest = argv.slice(1)
      while (rest[0] === '-C') { dir = norm(rest[1], dir); rest.splice(0, 2) }
      const root = rootOf(dir)
      if (!root) return ok('', 'fatal: not a git repository (or any of the parent directories): .git\n', 128)
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
      if (rest[0] === 'ls-files') {
        const list = [...files.keys()].filter((f) => f.startsWith(`${root}/`) && !f.startsWith(`${root}/.git/`))
          .map((f) => f.slice(root.length + 1)).sort()
        return rest.includes('-z') ? ok(list.map((f) => `${f}\0`).join('')) : ok(list.map((f) => `${f}\n`).join(''))
      }
      return ok('', '', 1)
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
  on('session.cwd', () => ({ value: world.cwd }))
  on('session.root', () => ({ value: world.cwd }))
  on('session.id', () => ({ value: SID }))
  on('ui.log', ($: any, e: any) => { world.logs.push(e.text); return { value: undefined } })

  // The engine beneath every event the module hooks: it answers as given.
  for (const ev of ['UserPromptSubmit', 'SessionStart', 'PostToolUse', 'SubagentStart', 'PreToolUse']) {
    on(`classic.${ev}`, () => ({}))
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
