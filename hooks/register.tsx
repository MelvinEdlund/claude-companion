import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, TurnCompleteResult } from 'claude-code'

import type { FileEntry, Focus, Helper, Mood, Streak, Tokens } from '../types'

// The companion pane: what Claude changed, what it and its helpers are doing,
// and a small, calm game to play while you wait.
//
// From the top: one line per subagent at work; the files changed this
// session, grouped by folder (a click folds a file's latest change out under
// it, hovering shows its whole path); Claude's status in two quiet lines; and
// a playground where Claude lives (hoops.tsx or dart.tsx, picked at random each
// session).

const PANE = 'companion'
const MAX_LINES = 300
const FRAME_MS = 500
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const AGENT_TOOLS = new Set(['Agent', 'Task'])
const SLEEP_AFTER_MS = 5 * 60_000
const DONE_SHOWN_MS = 20_000
const SWEAT_AFTER_MS = 3 * 60_000
const BREAK_AFTER_MS = 50 * 60_000
const NEW_STREAK_AFTER_MS = 10 * 60_000
const PANE_COLUMNS = 32

const files = atom({ plugin: 'companion-kit', key: 'files' } as const, [] as FileEntry[], { shape: 'files-1' })
/** The file folded out in the list, '' for none. */
const selected = atom({ plugin: 'companion-kit', key: 'selected' } as const, '', { shape: 'selected-1' })
const mood = atom({ plugin: 'companion-kit', key: 'mood' } as const, 'idle' as Mood, { shape: 'mood-1' })
const activity = atom({ plugin: 'companion-kit', key: 'activity' } as const, '', { shape: 'activity-1' })
const frame = atom({ plugin: 'companion-kit', key: 'frame' } as const, 0, { shape: 'frame-1' })
/** When the mood last changed, and when the current turn began. */
const since = atom({ plugin: 'companion-kit', key: 'since' } as const, 0, { shape: 'since-1' })
const turnStart = atom({ plugin: 'companion-kit', key: 'turnStart' } as const, 0, { shape: 'turnStart-1' })
/** Subagents running now, each drawn as a small crab in its own color. */
const helpers = atom({ plugin: 'companion-kit', key: 'helpers' } as const, [] as Helper[], { shape: 'helpers-1' })
/** Focused time today (turns Claude worked), kept across sessions in the store. */
const focus = atom({ plugin: 'companion-kit', key: 'focus' } as const, { day: '', ms: 0 } as Focus, { shape: 'focus-1' })
/** When the current run of turns began, and when the last turn ended. */
const streak = atom({ plugin: 'companion-kit', key: 'streak' } as const, { start: 0, lastEnd: 0 } as Streak, { shape: 'streak-1' })
/** The best hoops run and the best round of darts, in points, kept across sessions. */
const hoopsBest = atom({ plugin: 'companion-kit', key: 'hoopsBest' } as const, 0, { shape: 'hoopsBest-1' })
const dartBest = atom({ plugin: 'companion-kit', key: 'dartBest' } as const, 0, { shape: 'dartBest-1' })
/** The next step the last answer recommended (its "Next step:" command), '' when none. */
const tip = atom({ plugin: 'companion-kit', key: 'tip' } as const, '', { shape: 'tip-1' })
/** Fresh tokens used, ever and today: every 100k brings a new ball. */
const tokens = atom({ plugin: 'companion-kit', key: 'tokens' } as const, { total: 0, day: '', today: 0 } as Tokens, { shape: 'tokens-1' })
/**
 * Experience, by crab: 'main' for Claude, a subagent's type for each helper
 * (so the tester is the same tester every session). Work earns it, a point
 * for every thousand fresh tokens the crab's own turns use, and so does play.
 */
const xp = atom({ plugin: 'companion-kit', key: 'xp' } as const, {} as Record<string, number>, { shape: 'xp-1' })

/** Which game this session plays: picked at random each session, so neither grows stale. */
type Game = 'hoops' | 'dart'
let game: Game = 'hoops'
let ticker: { cancel: () => void } | undefined
let lastKey = -1
let editsThisTurn = 0
let helperCount = 0
/** The terminal's width and layout, as the last drawing measured them. */
let viewport: { columns: number; isFullscreen: boolean } | undefined
/** The person opened the pane with /companion: a narrow terminal may then show it inline. */
let isAsked = false

/** Levels come slowly: level n from 50·(n−1)² experience, so 50, 200, 450, 800 … */
const levelOf = (points: number) => Math.floor(Math.sqrt(Math.max(0, points) / 50)) + 1
function levelFor(points: number) {
  const level = levelOf(points)
  const from = 50 * (level - 1) ** 2
  const to = 50 * level ** 2
  return { level, pct: Math.floor(((points - from) / (to - from)) * 100) }
}

async function earn($: EngineInterface, gains: Record<string, number>) {
  await update($, xp, old => {
    const next = { ...old }
    for (const [who, n] of Object.entries(gains)) if (n > 0) next[who] = (next[who] ?? 0) + n
    return next
  })
  await $.store.set('xp', JSON.stringify(await read($, xp)))
}

async function setMood($: EngineInterface, next: Mood) {
  await update($, mood, () => next)
  const now = await $.clock.now()
  await update($, since, () => now)
}

/** The command an answer ends on ("👉 Next step: `/test`"), or '' when it names none. */
function nextStepOf(text: string): string {
  const all = [...text.matchAll(/Next step:\s*`([^`]+)`/gi)]
  return all.length > 0 ? cut(all[all.length - 1]![1]!, 24) : ''
}

// ---------------------------------------------------------------- the figure
//
// Figures are drawn in quarter blocks: each text cell holds 2 x 2 pixels, so a
// pixel is half a column wide and half a row tall. '.' is transparent; a cell
// holds at most two colors.

/** A cell's glyph by which of its quarters are inked: TL 1, TR 2, BL 4, BR 8. */
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

const PALETTE: Record<string, string> = {
  O: '#D97757', // Claude orange
  K: '#2B1A14', // eyes
  N: '#3B5BA9', // nightcap
  Y: '#F5D547', // nightcap's pom-pom
  S: '#111111', // sunglasses
  B: '#7EC8F0', // sweat drop
}

// 16 x 6 pixels: 8 columns x 3 rows, symmetric: a flat-topped body, two slit
// eyes, arms straight out, a lower body and four thin legs in two pairs.
const STAND = ['..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..', '..OOOKOOOOKOOO..', 'OOOOOOOOOOOOOOOO', '..OOOOOOOOOOOO..', '...O.O....O.O...']
const HEAD = STAND[0]!
const ARMS = STAND[3]!
const LEGS = STAND[5]!

// Calm by design, for a person who keeps it in view for hours. Motion at the
// edge of sight pulls the eye whether one wants it or not, so the figure holds
// still: one pose per state, a slow breath (one every 10 s, the six-a-minute
// pace slow-breathing studies call calming), a blink about twice a minute.
const POSES: Record<Mood, string[]> = {
  // eyes on you, arms out
  idle: STAND,
  // eyes up and aside
  thinking: [HEAD, '..OOOOKOOOOKOO..', HEAD, ARMS, HEAD, LEGS],
  // eyes lowered to the work, both fists up: on it
  working: [HEAD, HEAD, 'O.OOOOOOOOOOOO.O', 'OOOOOKOOOOKOOOOO', HEAD, LEGS],
  // one hand raised and held, not waved
  needsYou: [HEAD, '..OOOOOOOOOOOO.O', '..OOOKOOOOKOOO.O', 'OOOOOOOOOOOOOOO.', HEAD, LEGS],
  // both arms up for a moment after a turn that changed files, smiling eyes ^ ^
  happy: [HEAD, 'O.OOOKOOOOKOOO.O', 'O.OOKOKOOKOKOO.O', '.OOOOOOOOOOOOOO.', HEAD, LEGS],
  // sat down, legs tucked under, eyes shut
  sleeping: ['................', HEAD, HEAD, '..OOKKOOOOKKOO..', ARMS, HEAD],
}
/** Poses whose eyes are already shut or smiling: they do not blink. */
const STILL_EYES: readonly string[][] = [POSES.sleeping, POSES.happy]

const BREATH_MS = 10_000
const BLINK_EVERY_MS = 29_000
const CHEER_MS = 8_000

/** The breath (the top corners soften while breathing out) and the blink, by time. */
function alive(grid: readonly string[], now: number, canBlink: boolean): string[] {
  const rows = [...grid]
  const top = rows.findIndex(row => /[^.]/.test(row))
  const head = rows[top]?.match(/^(\.*)(O{3,})(\.*)$/)
  if (now % BREATH_MS >= BREATH_MS / 2 && head) rows[top] = `${head[1]}.${'O'.repeat(head[2]!.length - 2)}.${head[3]}`
  if (canBlink && now % BLINK_EVERY_MS < FRAME_MS) return rows.map(row => row.replace(/K/g, 'O'))
  return rows
}

/** Changes only when what is drawn changes: the breath and a blink. */
function visualKey(now: number): number {
  const blink = now % BLINK_EVERY_MS < FRAME_MS ? 1 : 0
  return Math.floor(now / (BREATH_MS / 2)) * 2 + blink
}

type Extras = { isNight: boolean; isWeekend: boolean; isSweaty: boolean }

/** Accessories drawn over a pose: a nightcap late, weekend sunglasses, a sweat drop on a long turn. */
function dress(grid: readonly string[], state: Mood, extras: Extras): string[] {
  const rows = grid.map(row => [...row])
  const set = (y: number, x: number, c: string) => {
    if (rows[y] && x >= 0 && x < rows[y]!.length) rows[y]![x] = c
  }
  if (extras.isNight) {
    const top = rows.findIndex(row => row.some(c => c !== '.'))
    for (let x = 2; x <= 13; x++) set(top, x, 'N')
    set(top, 14, 'Y')
  }
  if (extras.isWeekend && (state === 'idle' || state === 'thinking')) {
    const y = rows.findIndex(row => row.includes('K'))
    if (y >= 0) for (let x = rows[y]!.indexOf('K') - 1; x <= rows[y]!.lastIndexOf('K') + 1; x++) set(y, x, 'S')
  }
  if (extras.isSweaty) set(1, 15, 'B')
  return rows.map(row => row.join(''))
}

// ---------------------------------------------------------------- the helpers' characters

/**
 * A subagent is a crab smaller than Claude's, in its job's color, wearing its
 * gear: `hat` is a row over its head and `glasses` a row over its eyes, 10
 * pixels each, 'G' where the gear color goes.
 */
type Job = { name: string; title: string; body: string; hat: string; glasses: string; gearColor: string }

/** Common subagent types, each a character of its own; any other type gets a helper's look. */
const JOBS: Record<string, Job> = {
  Explore: { name: 'Sam', title: 'Scout', body: '#C9A66B', hat: '..GGGGGG..', glasses: '', gearColor: '#8B5E3C' }, // deerstalker
  Plan: { name: 'Pip', title: 'Planner', body: '#E8DCC2', hat: '...GGGG...', glasses: '', gearColor: '#1E1E1E' }, // top hat
  'general-purpose': { name: 'Hal', title: 'Helper', body: '#A0A0A0', hat: '', glasses: '', gearColor: '#A0A0A0' },
  explorer: { name: 'Ivy', title: 'Explorer', body: '#4FB3A9', hat: 'GGGGGGGGGG', glasses: '', gearColor: '#C2A061' }, // safari hat
  implementer: { name: 'Bea', title: 'Builder', body: '#E0B341', hat: '.GGGGGGGG.', glasses: '', gearColor: '#F28C28' }, // hard hat
  'test-writer': { name: 'Tess', title: 'Tester', body: '#7BB662', hat: 'GGGGGG....', glasses: '', gearColor: '#2F6B2A' }, // cap
  'code-reviewer': { name: 'Rex', title: 'Reviewer', body: '#9B7FD1', hat: '', glasses: '..G.GG.G..', gearColor: '#F5D547' }, // glasses
  'security-reviewer': { name: 'Sid', title: 'Security', body: '#5B9BD5', hat: '.GGGGGGGG.', glasses: '', gearColor: '#2B3A55' }, // helmet
  'ui-reviewer': { name: 'Uma', title: 'Designer', body: '#E07AA5', hat: '....GGGGGG', glasses: '', gearColor: '#7A2E52' }, // beret
}
const OTHER_BODIES = ['#4FB3A9', '#9B7FD1', '#5B9BD5', '#7BB662', '#E07AA5', '#E0B341']

function jobOf(kind: string, index: number): Job {
  return JOBS[kind] ?? { ...JOBS['general-purpose']!, title: kind || 'Helper', body: OTHER_BODIES[index % OTHER_BODIES.length]! }
}

// ---------------------------------------------------------------- words and paths

// Quiet colors: only a question for the person and a finished turn stand out.
const MOOD_LOOK: Record<Mood, { text: string; color: string; isBusy?: true }> = {
  idle: { text: 'Waiting for you', color: 'subtle' },
  thinking: { text: 'Thinking', color: 'claude', isBusy: true },
  working: { text: 'Working', color: 'claude', isBusy: true },
  needsYou: { text: 'Has a question', color: 'warning' },
  happy: { text: 'Done', color: 'success' },
  sleeping: { text: 'Resting', color: 'subtle' },
}

function dayKey(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function relative(path: string, cwd: string): string {
  const p = path.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return p.slice(root.length + 1)
  // Outside the session's folder: the whole path, the home folder as ~
  return p.replace(/^[A-Za-z]:\/Users\/[^/]+/i, '~').replace(/^\/(Users|home)\/[^/]+/, '~')
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')
/** A folder path cut to its last two folders, so a row reads at a glance: …/src/routes */
const shortPath = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

/** The file or folder a tool call works in, from its input. */
function fileOf(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'notebook_path', 'path']) {
    if (typeof input[key] === 'string' && input[key] !== '') return input[key] as string
  }
  return ''
}

function cut(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, Math.max(1, max - 1))}…` : line
}

const EXT_LOOK: Record<string, string> = {
  MD: '#E5C07B', YML: '#E5C07B', YAML: '#E5C07B', TXT: '#ABB2BF',
  TS: '#61AFEF', TSX: '#61AFEF', JS: '#E5C07B', MJS: '#E5C07B',
  JSON: '#98C379', SQL: '#C678DD', CSS: '#C678DD', HTML: '#E06C75',
  PY: '#61AFEF', GO: '#56B6C2', RS: '#E06C75', RB: '#E06C75',
}

const badge = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : 'FILE').toUpperCase().slice(0, 4)

/** What a tool call is doing, in a few plain words. */
function describe(tool: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const file = basename((str('file_path') || str('notebook_path')).replace(/\\/g, '/'))
  switch (tool) {
    case 'Read':
      return `Reading ${file}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${file}`
    case 'Write':
      return `Writing ${file}`
    case 'Bash':
    case 'PowerShell':
      return `Running ${cut(str('description') || str('command'), 48)}`
    case 'Grep':
    case 'Glob':
      return `Searching for ${cut(str('pattern'), 40)}`
    case 'Agent':
    case 'Task':
      return `Starting a helper: ${cut(str('description'), 40)}`
    case 'WebFetch':
    case 'WebSearch':
      return 'Reading the web'
    case 'Skill':
      return `Reading skill ${str('skill')}`
    default:
      return `Using ${tool.replace(/^mcp__[^_]+__/, '')}`
  }
}

type Hunk = { oldStart: number; newStart: number; lines: string[] }

/** Keeps only what changed: '+' and '-' lines, each hunk headed by its line. */
function fromHunks(hunks: readonly Hunk[], fallback: string | undefined) {
  const lines =
    hunks.length > 0
      ? hunks.flatMap(hunk => [`@${hunk.newStart}`, ...hunk.lines.filter(l => l[0] === '+' || l[0] === '-')])
      : (fallback ?? '').split('\n').map(line => `+${line}`)
  return {
    lines: lines.slice(0, MAX_LINES),
    plus: lines.filter(l => l.startsWith('+')).length,
    minus: lines.filter(l => l.startsWith('-')).length,
  }
}

/**
 * Adds a finished turn's fresh tokens to today's and the lifetime count:
 * uncached input, cache writes and output. Cache reads are left out: every
 * call reads the whole context again, so they would count the same words
 * over and over. The crab whose turn it was earns the experience.
 */
async function count($: EngineInterface, ran: TurnCompleteResult, who: string) {
  const used = ran.usage
  if (!used) return ran
  const fresh = used.input_tokens + used.cache_creation_input_tokens + used.output_tokens
  const day = dayKey(await $.clock.now())
  await update($, tokens, t => ({ total: t.total + fresh, day, today: (t.day === day ? t.today : 0) + fresh }))
  const now = await read($, tokens)
  await $.store.set('tokens', now.total)
  await $.store.set(`tokens:${day}`, now.today)
  await earn($, { [who]: fresh / 1000 })
  return ran
}

// ---------------------------------------------------------------- register

const openPane = ($: EngineInterface, focusIt = false) =>
  $.ui.open({ id: PANE, title: 'Claude', columns: PANE_COLUMNS, rows: 3, ...(focusIt ? { focus: true } : {}) })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'companion', description: 'Open the companion pane: changed files, helpers and Claude' })
    await $.command.register({ name: 'game', description: 'Switch the companion pane game: hoops or darts' })
    void openPane($)

    const startedAt = await $.clock.now()
    const today = dayKey(startedAt)
    // A fresh session starts waiting, not asleep: the mood is as old as the session.
    await update($, since, old => (old === 0 ? startedAt : old))
    const saved = Number((await $.store.get(`focus:${today}`)) ?? 0)
    await update($, focus, old => (old.day === today && old.ms >= saved ? old : { day: today, ms: saved }))
    const savedHoops = Number((await $.store.get('hoops')) ?? 0)
    await update($, hoopsBest, old => Math.max(old, savedHoops))
    const savedDart = Number((await $.store.get('dart')) ?? 0)
    await update($, dartBest, old => Math.max(old, savedDart))
    const savedTotal = Number((await $.store.get('tokens')) ?? 0)
    const savedToday = Number((await $.store.get(`tokens:${today}`)) ?? 0)
    await update($, tokens, old => ({
      total: Math.max(old.total, savedTotal),
      day: today,
      today: old.day === today ? Math.max(old.today, savedToday) : savedToday,
    }))
    const savedXp = await $.store.get('xp')
    if (typeof savedXp === 'string') await update($, xp, () => JSON.parse(savedXp) as Record<string, number>)
    // A game pinned in the store wins (the tests pin one); otherwise a coin toss.
    const pinned = await $.store.get('game')
    game = pinned === 'hoops' || pinned === 'dart' ? pinned : Math.random() < 0.5 ? 'hoops' : 'dart'

    // Redraw only when the picture changes: a breath every 5 s, a blink, the
    // minute in the text. Nothing ticks faster than that.
    ticker?.cancel()
    ticker = $.clock.every(FRAME_MS, () => {
      void $.clock.now().then(now => {
        const key = visualKey(now) * 1000 + (Math.floor(now / 60_000) % 1000)
        if (key === lastKey) return
        lastKey = key
        return update($, frame, () => key)
      })
    })
    return next(e)
  })

  on('command.run', { command: 'game' }, async $ => {
    game = game === 'hoops' ? 'dart' : 'hoops'
    await update($, frame, n => n + 1) // redraws the pane with the other game
    return { text: game === 'hoops' ? 'Hoops: pull back from the ball and let go.' : 'Darts: pull back from the ball and hit the board.' }
  })

  on('command.run', { command: 'companion' }, async $ => {
    isAsked = true
    await openPane($, true)
    return { text: 'The companion pane is open. Esc returns to the prompt.' }
  })

  // Every drawing carries the terminal's size; the band above the prompt is
  // drawn in every session, so it keeps the latest at hand. Drawn unchanged.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.viewport?.isFullscreen !== undefined) viewport = { columns: e.viewport.columns, isFullscreen: e.viewport.isFullscreen }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Wide enough to dock and not shown (a terminal window dragged wider, say):
    // opened from the person's own prompt, the pane docks beside the chat.
    if (viewport?.isFullscreen && viewport.columns >= 110) {
      const isShown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
      if (!isShown) void openPane($).catch(() => undefined)
    }
    editsThisTurn = 0
    const now = await $.clock.now()
    await update($, turnStart, () => now)
    // A pause of ten minutes or more starts a new run of focus.
    await update($, streak, s => (now - s.lastEnd > NEW_STREAK_AFTER_MS ? { ...s, start: now } : s))
    await setMood($, 'thinking')
    await update($, activity, () => '')
    await update($, tip, () => '')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // A subagent finished: marked done, it stays a short while, then goes.
      const done = e.agentId
      const at = await $.clock.now()
      await update($, helpers, list => list.map(one => (one.agentId === done ? { ...one, doneAt: at } : one)))
      const kind = (await read($, helpers)).find(one => one.agentId === done)?.kind ?? 'general-purpose'
      return count($, await next(e), kind)
    }
    await setMood($, editsThisTurn > 0 ? 'happy' : 'idle')
    await update($, activity, () => '')

    const now = await $.clock.now()
    // A turn with no start seen (none this session) adds no focus time.
    const begun = await read($, turnStart)
    const worked = begun > 0 ? Math.max(0, now - begun) : 0
    const today = dayKey(now)
    await update($, focus, old => ({ day: today, ms: (old.day === today ? old.ms : 0) + worked }))
    await $.store.set(`focus:${today}`, (await read($, focus)).ms)
    await update($, streak, s => ({ ...s, lastEnd: now }))
    const ran = await next(e)
    await update($, tip, () => nextStepOf(e.answer || ran.text || ''))
    return count($, ran, 'main')
  }).catch(($, e, next) => next(e))

  // The playground posts a better round (hoops or darts) and the experience play earned.
  on('ui.message', { requestId: PANE }, async ($, e) => {
    if (e.element !== 'play') return {}
    const sent = e.data as { round?: unknown; dart?: unknown; xp?: unknown } | null
    if (typeof sent?.round === 'number') {
      const round = sent.round
      await update($, hoopsBest, old => Math.max(old, round))
      await $.store.set('hoops', await read($, hoopsBest))
    }
    if (typeof sent?.dart === 'number') {
      const points = sent.dart
      await update($, dartBest, old => Math.max(old, points))
      await $.store.set('dart', await read($, dartBest))
    }
    if (sent?.xp && typeof sent.xp === 'object') {
      await earn($, Object.fromEntries(Object.entries(sent.xp).filter(([, n]) => typeof n === 'number')) as Record<string, number>)
    }
    return {}
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const agentId = e.agentId
    const doing = describe(tool, input)

    if (agentId !== undefined) {
      // A subagent's call: it updates its own line, not the main figure.
      await update($, helpers, list => {
        const mine = list.find(one => one.agentId === agentId) ?? list.find(one => one.agentId === undefined && !one.doneAt)
        return mine ? list.map(one => (one === mine ? { ...one, agentId, doing } : one)) : list
      })
    } else {
      const asks = tool === 'AskUserQuestion' || tool === 'ExitPlanMode'
      await setMood($, asks ? 'needsYou' : 'working')
      await update($, activity, () => (asks ? 'Has a question for you' : doing))
    }

    const isHelper = AGENT_TOOLS.has(tool)
    if (isHelper) {
      const kind = String(input.subagent_type ?? 'general-purpose')
      const startedAt = await $.clock.now()
      const helper: Helper = { id: e.tool_use_id, kind, index: helperCount++, doing: 'Starting', startedAt }
      // Finished helpers from earlier leave as a new one arrives.
      await update($, helpers, list => [...list.filter(one => !one.doneAt || startedAt - one.doneAt < DONE_SHOWN_MS), helper])
    }

    const ran = await next(e)

    if (isHelper) {
      // A background agent answers at once with its id and runs on: kept until
      // its turn.complete. A foreground one is done now. A refused one leaves.
      const child = (ran.result as { agentId?: string } | undefined)?.agentId
      const doneAt = await $.clock.now()
      await update($, helpers, list =>
        ran.deny !== undefined
          ? list.filter(one => one.id !== e.tool_use_id)
          : list.map(one => (one.id !== e.tool_use_id ? one : child !== undefined ? { ...one, agentId: child } : { ...one, doneAt })),
      )
    }
    if (agentId === undefined) await setMood($, 'thinking')

    if (!EDIT_TOOLS.has(tool) || ran.deny !== undefined || ran.isError) return ran
    const result = ran.result as { filePath?: string; structuredPatch?: Hunk[]; content?: string; staged?: boolean }
    const raw = result?.filePath ?? (input.file_path as string | undefined) ?? (input.notebook_path as string | undefined)
    if (raw === undefined || result?.staged) return ran

    const path = relative(raw, await $.session.cwd())
    const at = await $.clock.now()
    const patched = fromHunks(result?.structuredPatch ?? [], result?.content)
    editsThisTurn += 1
    await update($, files, list => {
      const old = list.find(f => f.path === path)
      const entry: FileEntry = { path, at, tool, count: (old?.count ?? 0) + 1, ...patched }
      return [...list.filter(f => f.path !== path), entry]
    })
    return ran
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------ the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    /** A pixel grid drawn as text: two pixels across and two down to a cell, in quarter blocks. */
    const drawGrid = (grid: readonly string[], color: (c: string) => string | undefined) => {
      const out: RenderChildren[] = []
      for (let y = 0; y < grid.length; y += 2) {
        const cells: RenderChildren[] = []
        for (let x = 0; x < grid[y]!.length; x += 2) {
          // top left, top right, bottom left, bottom right
          const quads = [grid[y]![x]!, grid[y]![x + 1]!, grid[y + 1]![x]!, grid[y + 1]![x + 1]!]
          const [ink, behind] = [...new Set(quads.filter(q => q !== '.'))]
          if (ink === undefined) {
            cells.push(<Text> </Text>)
            continue
          }
          const glyph = QUADRANTS[quads.reduce((mask, q, i) => (q === ink ? mask | (1 << i) : mask), 0)]
          cells.push(
            behind === undefined ? (
              <Text color={color(ink)}>{glyph}</Text>
            ) : (
              <Text color={color(ink)} backgroundColor={color(behind)}>
                {glyph}
              </Text>
            ),
          )
        }
        out.push(<Text>{cells}</Text>)
      }
      return out
    }
    // The playground needs a surface that hands it the mouse (terminal, desktop).
    const Client = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in elements ? elements.Client : undefined
    const list = await read($, files)
    const current = await read($, selected)
    const stored = await read($, mood)
    const doing = await read($, activity)
    await read($, frame) // subscribes: redrawn when the breath or a blink changes
    const running = await read($, helpers)
    const today = await read($, focus)
    const run = await read($, streak)
    const earned = await read($, xp)
    const now = await $.clock.now()
    const moodAge = now - (await read($, since))
    const startedTurn = await read($, turnStart)
    // No turn yet this session: nothing has run, so no time either.
    const turnAge = startedTurn > 0 ? now - startedTurn : 0
    const width = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows

    // -------- the helpers at work: one quiet line each
    const shownHelpers = running.filter(h => !h.doneAt || now - h.doneAt < DONE_SHOWN_MS)
    const helpersView = shownHelpers.length > 0 && (
      <Box flexDirection="column" flexShrink={0}>
        {shownHelpers.map(helper => {
          const job = jobOf(helper.kind, helper.index)
          return (
            <Text wrap="truncate-end">
              <Text color={job.body} bold>
                {job.name}
              </Text>
              <Text dimColor>
                {' '}
                Lv{levelOf(earned[helper.kind] ?? 0)} {helper.doneAt !== undefined ? 'done' : helper.doing}
              </Text>
            </Text>
          )
        })}
      </Box>
    )

    // -------- Claude's state
    const state: Mood = stored === 'idle' && moodAge > SLEEP_AFTER_MS ? 'sleeping' : stored
    const date = new Date(now)
    const extras: Extras = {
      isNight: date.getHours() >= 22 || date.getHours() < 6,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      isSweaty: (state === 'working' || state === 'thinking') && turnAge > SWEAT_AFTER_MS,
    }
    const look = MOOD_LOOK[state]
    // The cheer lasts a moment; then the figure rests while the word stays.
    const pose = state === 'happy' && moodAge > CHEER_MS ? POSES.idle : POSES[state]
    const grid = alive(dress(pose, state, extras), now, !STILL_EYES.includes(pose))

    // Minutes, never seconds: a number that ticks every second pulls the eye.
    const minutes = Math.floor(turnAge / 60_000)
    const elapsed = look.isBusy && minutes >= 1 ? ` · ${minutes} min` : ''
    const focusMs = (today.day === dayKey(now) ? today.ms : 0) + (look.isBusy ? turnAge : 0)
    const runMs = run.start > 0 && (now - run.lastEnd < NEW_STREAK_AFTER_MS || look.isBusy) ? now - run.start : 0
    const needsBreak = run.start > 0 && runMs >= BREAK_AFTER_MS
    const focusLine = focusMs < 60_000 ? '' : needsBreak ? `${duration(runMs)} straight · break?` : `Focused today ${duration(focusMs)}`

    if (e.props.placement === 'inline' && !isAsked) {
      // Unasked, a narrow terminal would seat the pane over the prompt, in the
      // chat's way: it steps aside instead, and asks again unasked, which waits
      // undrawn until the terminal is wide enough to dock it beside the chat.
      void $.ui
        .close({ id: PANE })
        .then(() => $.clock.after(1500, () => void openPane($).catch(() => undefined)))
        .catch(() => undefined)
      return <Box />
    }

    // Asked for with /companion on a narrow terminal, the pane sits inline over
    // the prompt: three quiet rows, Claude and the helpers at work.
    if (e.props.placement === 'inline') {
      const busy = shownHelpers.filter(helper => !helper.doneAt)
      const listed = busy.slice(0, busy.length > 2 ? 1 : 2)
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={look.color} bold>
              {look.text}
            </Text>
            <Text dimColor>
              {elapsed}
              {doing !== '' ? ` · ${doing}` : ''}
            </Text>
          </Text>
          {listed.map(helper => {
            const job = jobOf(helper.kind, helper.index)
            const helperMinutes = Math.floor((now - helper.startedAt) / 60_000)
            return (
              <Text wrap="truncate-end">
                <Text color={job.body} bold>
                  {job.name}
                </Text>
                <Text dimColor>
                  {helperMinutes >= 1 ? ` ${helperMinutes} min ·` : ''} {helper.doing}
                </Text>
              </Text>
            )
          })}
          {busy.length > listed.length && <Text dimColor>+{busy.length - listed.length} more helpers</Text>}
        </Box>
      )
    }

    // -------- Claude and the playground, at the bottom
    const playRows = rows >= 18 ? 8 : 0
    const used = await read($, tokens)
    const playHelpers = shownHelpers.map(helper => ({
      ...jobOf(helper.kind, helper.index),
      id: helper.id,
      isDone: helper.doneAt !== undefined,
      doing: helper.doing,
    }))
    // Claude's tip, small: your turn when it asks, a break after long work, else the next step.
    const nextStep = await read($, tip)
    const tipText = stored === 'needsYou' ? 'your turn!' : needsBreak && !look.isBusy ? 'take a break?' : nextStep !== '' ? `next: ${nextStep}` : ''
    const levels = { main: levelFor(earned.main ?? 0) }
    const play = { pose: grid, palette: PALETTE, helpers: playHelpers, claudeDoing: look.isBusy ? doing : '', tokens: used.total, tip: tipText, levels }
    const status = [
      <Text wrap="truncate-end">
        <Text color={look.color} bold>
          {look.text}
        </Text>
        <Text dimColor>{elapsed}</Text>
      </Text>,
      <Text dimColor wrap="truncate-end">
        {doing !== '' ? doing : focusLine}
      </Text>,
    ]
    const figures =
      Client && playRows > 0 ? (
        <Box flexDirection="column" flexShrink={0}>
          {status}
          {game === 'hoops' ? (
            <Client key="play" module="./hoops.tsx" width="100%" height={playRows} props={{ ...play, best: await read($, hoopsBest) }} />
          ) : (
            <Client key="play" module="./dart.tsx" width="100%" height={playRows} props={{ ...play, best: await read($, dartBest) }} />
          )}
        </Box>
      ) : (
        <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end" gap={1} flexShrink={0}>
          <Box flexDirection="column" alignItems="flex-end" flexShrink={1}>
            {status}
          </Box>
          <Box flexDirection="column" width={8} flexShrink={0}>
            {drawGrid(grid, c => PALETTE[c])}
          </Box>
        </Box>
      )
    const figureRows = Client && playRows > 0 ? playRows + 2 : 3

    const pinned = (content: RenderChildren) => (
      <Box flexDirection="column" height={rows} justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {helpersView}
          {content}
        </Box>
        {figures}
      </Box>
    )

    // -------- the changed files, grouped by folder, newest first
    if (list.length === 0) return pinned(<Text dimColor>No files changed yet.</Text>)

    const open = list.find(f => f.path === current)
    const toggle = (path: string) => update($, selected, old => (old === path ? '' : path))
    const cwd = (await $.session.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
    const fullPath = (path: string) => (/^(~|\/|[A-Za-z]:)/.test(path) ? path : `${cwd}/${path}`)
    /** A row that shows its whole path in a small card while the pointer is on it. */
    const withPath = (key: string, row: RenderChildren, path: string) => (
      <Box flexDirection="column" hover={{ scope: key }}>
        {row}
        {/* A card over the rows below, out of the flow: showing it moves nothing. */}
        <Box
          position="absolute"
          top={1}
          left={2}
          display="none"
          hover={{ scope: key, display: 'flex' }}
          backgroundColor="#2B2B2B"
          paddingX={1}
        >
          <Text color="#E8E8E8" wrap="wrap">
            {path}
          </Text>
        </Box>
      </Box>
    )
    /** A file's latest change, folded out under its row: the first lines of it. */
    const change = (file: FileEntry) => (
      <Box flexDirection="column" paddingLeft={2}>
        {file.lines.slice(0, 10).map(line =>
          line[0] === '@' ? (
            <Text dimColor>line {line.slice(1)}</Text>
          ) : (
            <Text color={line[0] === '+' ? 'diffAdded' : 'diffRemoved'} wrap="truncate-end">
              {line[0] === '+' ? '+' : '−'}
              {line.slice(1)}
            </Text>
          ),
        )}
        {file.lines.length > 10 && <Text dimColor>… {file.lines.length - 10} more lines</Text>}
      </Box>
    )
    const counts = (file: FileEntry) => [
      file.plus > 0 ? <Text color="diffAdded"> +{file.plus}</Text> : null,
      file.minus > 0 ? <Text color="diffRemoved"> −{file.minus}</Text> : null,
    ]
    const countWidth = (file: FileEntry) =>
      (file.plus > 0 ? String(file.plus).length + 2 : 0) + (file.minus > 0 ? String(file.minus).length + 2 : 0)

    const fileRow = (file: FileEntry) => {
      const name = basename(file.path)
      const isOpen = file.path === open?.path
      const row = (
        <Button key={`f:${file.path}`} plain onPress={() => toggle(file.path)}>
          <Text color="claude">{isOpen ? '▾' : '›'}</Text>
          <Text color={EXT_LOOK[badge(name)] ?? '#ABB2BF'}>●</Text>
          <Text color={isOpen ? 'claude' : 'text'} bold={isOpen}>
            {` ${cut(name, width - countWidth(file) - 4)}`}
          </Text>
          {counts(file)}
        </Button>
      )
      return (
        <Box flexDirection="column">
          {withPath(`p:${file.path}`.slice(0, 64), row, fullPath(file.path))}
          {isOpen && change(file)}
        </Box>
      )
    }

    const byFolder = new Map<string, FileEntry[]>()
    for (const file of [...list].sort((a, b) => b.at - a.at)) {
      const folder = folderOf(file.path)
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), file])
    }
    const cap = Math.max(3, rows - shownHelpers.length - figureRows - 2)
    const lines: RenderChildren[] = []
    let hidden = 0
    for (const [folder, inFolder] of byFolder) {
      const fits = lines.length + 1 + inFolder.length <= cap || inFolder.some(f => f.path === open?.path)
      if (!fits) {
        hidden += inFolder.length
        continue
      }
      lines.push(
        withPath(
          `d:${folder}`.slice(0, 64),
          <Text color="claude" wrap="truncate-start">
            ▾ {folder === '.' ? 'project folder' : `${shortPath(folder)}/`}
          </Text>,
          folder === '.' ? cwd : fullPath(folder),
        ),
      )
      for (const file of inFolder) lines.push(fileRow(file))
    }
    if (hidden > 0) lines.push(<Text dimColor>  + {hidden} more files</Text>)

    return pinned(
      <Box flexDirection="column" marginTop={shownHelpers.length > 0 ? 1 : 0}>
        {lines}
      </Box>,
    )
  })
}

