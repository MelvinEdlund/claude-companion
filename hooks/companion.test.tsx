import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

type Surface = 'terminal' | 'desktop' | 'vscode'

const pane = <S extends Surface>(surface: S, columns = 40, rows = 30, placement: 'dock' | 'inline' = 'dock') =>
  ({
    plugin: 'companion-kit',
    component: 'Pane',
    requestId: 'companion',
    surface,
    props: {
      title: 'Claude',
      isFocused: false,
      bodyColumns: columns,
      placement,
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
  }) as const

/** The drawn tree's words, a line per Box. */
const words = (n: unknown): string => {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(words).join('')
  if (n && typeof n === 'object') {
    const o = n as { type?: string; props?: { children?: unknown }; children?: unknown }
    const inner = words(o.props?.children ?? o.children ?? '')
    return o.type === 'Box' ? `${inner}\n` : inner
  }
  return ''
}

/** The game is picked at random each session; a test pins one in the store. */
const DART_NEXT = { game: 'dart' }

/** What the engine would answer beneath the plugin; `stored` is what the store holds. */
function engine(on: On, given: Record<string, unknown> = {}, toolResult: Record<string, unknown> = {}) {
  const stored: Record<string, unknown> = { game: 'hoops', ...given }
  on('command.register', () => ({ value: { command: 'panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => e)
  on('tool.call', () => ({ result: toolResult }))
  // A Wednesday afternoon: no nightcap, no weekend sunglasses.
  on('clock.now', () => ({ value: new Date(2026, 10, 18, 14, 0).getTime() }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('store.get', (_, e) => ({ value: stored[(e as { key: string }).key] }))
  on('store.set', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
}

type Ui = {
  advance: (ms: number) => Promise<void>
  drawn: (scope?: { in: string }) => Promise<unknown>
  pointer: (e: {
    type: 'down' | 'move' | 'up'
    x: number
    y: number
    fine?: { x: number; y: number }
    button?: 'left'
    in?: string
  }) => Promise<void>
}
const play = async (ui: Ui) => words(await ui.drawn({ in: 'play' }))

/** Moves the playground on in steps, gathering every word it showed. */
async function watch(ui: Ui, ms: number) {
  let seen = ''
  for (let at = 0; at < ms; at += 99) {
    await ui.advance(99)
    seen += await play(ui)
  }
  return seen
}

type Node = { type?: string; children?: unknown; props?: { children?: unknown; color?: string; backgroundColor?: string } }
const kids = (n: Node) => ([] as Node[]).concat((n.children ?? n.props?.children ?? []) as Node[])

/** The playground's rows of cells, as text. */
const cellRows = (drawn: string, columns = 40) => drawn.replace(/\n$/, '').match(new RegExp(`.{1,${columns}}`, 'gsu')) ?? []

/** Every cell drawn in a color, as [column, row]. */
async function cellsOf(ui: Ui, color: string): Promise<[number, number][]> {
  const found: [number, number][] = []
  const rows = kids((await ui.drawn({ in: 'play' })) as Node)
  for (const [y, row] of rows.entries()) {
    let x = 0
    for (const run of kids(row)) {
      const length = [...words(run)].length
      if (run.props?.color === color || run.props?.backgroundColor === color) for (let i = 0; i < length; i++) found.push([x + i, y])
      x += length
    }
  }
  return found
}
const BALL = '#F2F2F2'
/** Mike, the implementer: his body's color. */
const MIKE = '#E0B341'

/** Rests the pointer, no button down, on the first cell drawn in a color. */
async function hover(ui: Ui, color: string) {
  const [x, y] = (await cellsOf(ui, color))[0]!
  await ui.pointer({ type: 'move', x: x!, y: y!, in: 'play' })
}
const RIM = '#E5533D'

/** A press, a drag through the points and a release: a throw when the last steps are quick. */
async function drag(ui: Ui, points: readonly (readonly [number, number])[]) {
  const [first, ...rest] = points
  await ui.pointer({ type: 'down', x: first![0], y: first![1], button: 'left', in: 'play' })
  for (const [x, y] of rest) await ui.pointer({ type: 'move', x, y, button: 'left', in: 'play' })
  const last = points[points.length - 1]!
  await ui.pointer({ type: 'up', x: last[0], y: last[1], button: 'left', in: 'play' })
}

/** A slingshot stroke: press on the ball, pull back by (dx, dy) cells, let go. */
async function stroke(ui: Ui, dx: number, dy: number) {
  const [bx, by] = (await cellsOf(ui, BALL))[0]!
  const from = { x: bx! + 0.5, y: by! + 0.5 }
  const to = { x: from.x + dx, y: from.y + dy }
  await ui.pointer({ type: 'down', x: bx!, y: by!, fine: from, button: 'left', in: 'play' })
  await ui.pointer({ type: 'move', x: Math.floor(to.x), y: Math.floor(to.y), fine: to, button: 'left', in: 'play' })
  await ui.pointer({ type: 'up', x: Math.floor(to.x), y: Math.floor(to.y), fine: to, button: 'left', in: 'play' })
}

async function start($: Engine, surface: Surface = 'terminal') {
  await $.session.start({ cwd: '/repo', surface, isInteractive: true })
}

// ---------------------------------------------------------------- both games

test('the game pinned in the store is the one played', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 10, in: 'play' })
  const drawn = await play(ui)
  expect(drawn).toContain('★ 0')
  expect(drawn).toContain('●●●')
  expect(drawn).toContain('pull back from the ball')
  // The ball: one small round glyph.
  expect((await cellsOf(ui, BALL)).length).toBe(1)
  await ui.unmount()
})

test('the status over a little playground with a hoop, on terminal and desktop', async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    await ui.resize({ columns: 40, rows: 10, in: 'play' })
    expect(words(await ui.drawn())).toContain('Waiting for you')
    expect(await play(ui)).toMatch(/[▙▘▜▛]/)
    expect((await cellsOf(ui, RIM)).length).toBeGreaterThan(0)
    await ui.unmount()
  }
})

test('vscode has no Client: the still figure and the status draw instead', async ($, on) => {
  engine(on)
  await start($, 'vscode')
  const ui = await $.ui.mount(pane('vscode'))
  const drawn = words(await ui.drawn())
  expect(drawn).toContain('Waiting for you')
  expect(drawn).toMatch(/[▙▘▜▛]/)
  expect(await ui.find({ key: 'play' })).toBeUndefined()
  await ui.unmount()
})

test('a narrow terminal, unasked, gets nothing over the prompt', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal', 60, 3, 'inline'))
  expect(words(await ui.drawn()).trim()).toBe('')
  await ui.unmount()
})

test('tokens unlock gifts: the newest ball is the one played with', async ($, on) => {
  engine(on, { tokens: 250_000 })
  await start($)
  const ui = await $.ui.mount(pane('terminal', 60))
  await ui.resize({ columns: 60, rows: 10, in: 'play' })
  // Two gifts, the tennis ball and then the mint ball: the mint one is in play.
  expect((await cellsOf(ui, '#5FD3B6')).length).toBeGreaterThan(0)
  expect(await cellsOf(ui, '#C8E64A')).toEqual([])
  await ui.unmount()
})

test('hoops: Claude can be picked up, thrown, and walks back to its spot', { timeoutMs: 30_000 }, async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  const claudeAt = async () => (await cellsOf(ui, '#D97757')).map(([x]) => x)
  const home = Math.min(...(await claudeAt()))
  await ui.pointer({ type: 'down', x: home + 4, y: 6, button: 'left', in: 'play' })
  for (const x of [home + 1, home - 2, home - 5]) {
    await ui.pointer({ type: 'move', x, y: 3, button: 'left', in: 'play' })
    await ui.advance(100)
  }
  expect(Math.min(...(await claudeAt()))).toBeLessThan(home)
  await ui.pointer({ type: 'up', x: home - 5, y: 3, button: 'left', in: 'play' })
  await ui.advance(12000)
  expect(Math.min(...(await claudeAt()))).toBe(home)
  await ui.unmount()
})
test('a subagent arrives: hovering it in the game names it and what it does, the top stays clear', async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: 'build', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 8, in: 'play' })
  await $.tool.call({ tool: 'Agent', subagent_type: 'implementer', description: 'Build the pane', prompt: 'do it' })
  expect(words(await ui.drawn())).not.toContain('Mike')
  expect(await play(ui)).not.toContain('Mike')
  await hover(ui, MIKE)
  expect(await play(ui)).toContain('Mike · Builder')
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'play' })
  expect(await play(ui)).not.toContain('Mike')
  await ui.unmount()
})

test('hovering Claude shows its level and what it is doing', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 8, in: 'play' })
  await hover(ui, '#D97757')
  const drawn = await play(ui)
  expect(drawn).toContain('Claude · Lv 1')
  expect(drawn).toContain('Waiting for you')
  await ui.unmount()
})
test('a short pane keeps the still figure', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal', 40, 12))
  expect(await ui.find({ key: 'play' })).toBeUndefined()
  expect(words(await ui.drawn())).toContain('Waiting for you')
  await ui.unmount()
})

test('a prompt turns the figure to thinking', async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('terminal'))
  expect(words(await ui.drawn())).toContain('Thinking')
  await ui.unmount()
})

// ---------------------------------------------------------------- hoops

test('hoops: a shot is a pull and a release from the slingshot; a miss spends a try', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  const [sling] = await cellsOf(ui, BALL)
  // The slingshot stands at the bottom left.
  expect(sling![0]).toBeLessThan(4)
  expect(sling![1]).toBeGreaterThanOrEqual(5)
  expect(await play(ui)).toContain('●●●')
  // Too short a pull: nothing happens.
  await stroke(ui, 0.3, 0)
  await ui.advance(500)
  expect(await play(ui)).toContain('●●●')
  // A weak one that falls short: a try spent, the ball back in the slingshot.
  await stroke(ui, -2, 1)
  await ui.advance(6000)
  expect(await play(ui)).toContain('●●○')
  expect((await cellsOf(ui, BALL))[0]).toEqual(sling)
  await ui.unmount()
})
test('hoops: the ball cannot be carried, only shot', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 10, in: 'play' })
  const [before] = await cellsOf(ui, BALL)
  const [bx, by] = before!
  // Pressed and moved about: the ball stays put while the pull is drawn.
  await ui.pointer({ type: 'down', x: bx, y: by, button: 'left', in: 'play' })
  await ui.pointer({ type: 'move', x: 5, y: 1, button: 'left', in: 'play' })
  expect((await cellsOf(ui, BALL))[0]).toEqual(before)
  await ui.unmount()
})

test('hoops: a shot through the hoop scores, and a new hoop follows', { timeoutMs: 60_000 }, async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal', 32))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  let seen = ''
  const sunk = /\+[123](?!\d)/
  // Aimed at the hoop from a drawing a cell coarse: a few shots may be needed.
  for (let i = 0; i < 30 && !sunk.test(seen); i++) {
    const [bx, by] = (await cellsOf(ui, BALL))[0]!
    const rim = await cellsOf(ui, RIM)
    const xs = rim.map(([x]) => x)
    const target = { x: Math.min(...xs) + Math.max(...xs) + 1, y: Math.min(...rim.map(([, y]) => y)) * 2 + 1 }
    const ball = { x: bx! * 2 + 1, y: by! * 2 + 1 }
    const T = 0.7 + (i % 3) * 0.15
    const vx = (target.x - ball.x) / T
    const vy = (target.y - ball.y - 0.5 * 120 * T * T) / T
    await stroke(ui, -vx / 4.2 / 2, -vy / 4.2 / 2)
    seen += await watch(ui, 4000)
  }
  expect(seen).toMatch(sunk)
  expect(seen).toMatch(/★ [1-9]/)
  await ui.unmount()
})
test('hoops: a better round is kept as the record', async ($, on) => {
  engine(on, { hoops: 120 })
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 10, in: 'play' })
  expect(await play(ui)).toContain('best 120')
  await ui.post({ round: 200 }, { in: 'play' })
  expect(await play(ui)).toContain('best 200')
  await ui.unmount()
})


// ---------------------------------------------------------------- Claude's tip and presents

test('after an answer, Claude tips the next step in a small bubble', async ($, on) => {
  engine(on)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($)
  await $.prompt.submit({ text: 'fix', wait: false, origin: { kind: 'composer' } })
  const answer = 'Done.\n👉 Next step: `/push`'
  await $.turn.complete({ reason: 'answer', answer, durationMs: 1, isAborted: false, turnId: 't1' })
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 10, in: 'play' })
  expect(await play(ui)).toContain('next: /push')
  await ui.unmount()
})

test("Claude's own work raises its level, and the playground cheers it", async ($, on) => {
  engine(on)
  // A turn of 60k fresh tokens: 60 experience, past level 2's 50.
  const usage = { input_tokens: 0, output_tokens: 60_000, cache_read_input_tokens: 500_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.complete', (_, e) => ({ text: e.answer, usage }))
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 10, in: 'play' })
  await $.prompt.submit({ text: 'work', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })
  expect(await watch(ui, 800)).toContain('Claude Lv 2!')
  await ui.unmount()
})

test('a helper keeps its level from session to session, shown by its name', async ($, on) => {
  engine(on, { xp: JSON.stringify({ implementer: 210 }) })
  await start($)
  await $.prompt.submit({ text: 'build', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 8, in: 'play' })
  await $.tool.call({ tool: 'Agent', subagent_type: 'implementer', description: 'Build the pane', prompt: 'do it' })
  await hover(ui, MIKE)
  expect(await play(ui)).toContain('Mike · Builder Lv3')
  await ui.unmount()
})

// ---------------------------------------------------------------- darts

const DART_BALL = '#F2F2F2'
const BULL = '#E5533D'

/** The ball on its peg: its cell. */
const dartAt = async (ui: Ui) => (await cellsOf(ui, DART_BALL))[0]!

/** A dart thrown at a height on the board, from the cell the ball is in, to land after T seconds. */
async function throwAt(ui: Ui, columns: number, rows: number, y: number, T: number) {
  const [bx, by] = await dartAt(ui)
  const ball = { x: 3, y: by! * 2 + 1 }
  const target = { x: columns * 2 - 3, y }
  const vx = (target.x - ball.x) / T
  const vy = (target.y - ball.y - 0.5 * 120 * T * T) / T
  const from = { x: bx! + 0.5, y: by! + 0.5 }
  const to = { x: from.x - vx / 4.2 / 2, y: from.y - vy / 4.2 / 2 }
  await ui.pointer({ type: 'down', x: bx!, y: by!, fine: from, button: 'left', in: 'play' })
  await ui.pointer({ type: 'move', x: Math.floor(to.x), y: Math.floor(to.y), fine: to, button: 'left', in: 'play' })
  await ui.pointer({ type: 'up', x: Math.floor(to.x), y: Math.floor(to.y), fine: to, button: 'left', in: 'play' })
}

test('darts: a ball on a peg, a board with holes, ten darts a round', async ($, on) => {
  engine(on, DART_NEXT)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  const drawn = await play(ui)
  expect(drawn).toContain('Dart 1/10')
  expect(drawn).toContain('●')
  // The bullseye's mark, one pixel, in the board's middle.
  expect((await cellsOf(ui, BULL)).length).toBe(1)
  await ui.unmount()
})

test('darts: a dart aimed at the board scores, the bullseye most', { timeoutMs: 60_000 }, async ($, on) => {
  engine(on, DART_NEXT)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  let seen = ''
  // At the bullseye's row, from a drawing a cell coarse: most darts land in a ring near it.
  for (let i = 0; i < 10 && !/BULLSEYE/.test(seen); i++) {
    await throwAt(ui, 32, 8, 8.5, 0.5 + (i % 3) * 0.1)
    seen += await watch(ui, 1800)
  }
  expect(seen).toMatch(/\+(10|25)|BULLSEYE/)
  // Points on the card, or a whole round of hits already banked as a record.
  expect(seen + (await play(ui))).toMatch(/★ [1-9]|new best/)
  await ui.unmount()
})

test('darts: ten darts end the round', { timeoutMs: 30_000 }, async ($, on) => {
  engine(on, DART_NEXT)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  let seen = ''
  for (let i = 0; i < 10; i++) {
    // A weak lob that falls short.
    const [bx, by] = await dartAt(ui)
    await drag(ui, [[bx!, by!], [bx! - 3, by!]])
    seen += await watch(ui, 1600)
  }
  expect(seen).toContain('short')
  expect(seen).toContain('round: 0')
  expect(await play(ui)).toContain('Dart 1/10')
  await ui.unmount()
})

test('darts: a better round is kept as the record', async ($, on) => {
  engine(on, { ...DART_NEXT, dart: 120 })
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  expect(await play(ui)).toContain('best 120')
  await ui.post({ dart: 180 }, { in: 'play' })
  expect(await play(ui)).toContain('best 180')
  await ui.unmount()
})

test('darts: Claude can be picked up, thrown, and walks home', { timeoutMs: 30_000 }, async ($, on) => {
  engine(on, DART_NEXT)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  const claudeAt = async () => (await cellsOf(ui, '#D97757')).map(([x]) => x)
  expect(Math.min(...(await claudeAt()))).toBe(0)
  // Picked up in the corner, carried to the middle and let go.
  await ui.pointer({ type: 'down', x: 4, y: 6, button: 'left', in: 'play' })
  for (const x of [8, 12, 16]) {
    await ui.pointer({ type: 'move', x, y: 4, button: 'left', in: 'play' })
    await ui.advance(100)
  }
  expect(Math.min(...(await claudeAt()))).toBeGreaterThan(5)
  await ui.pointer({ type: 'up', x: 16, y: 4, button: 'left', in: 'play' })
  await ui.advance(12000)
  expect(Math.min(...(await claudeAt()))).toBe(0)
  await ui.unmount()
})

test('hoops: three misses at one hoop end the run', { timeoutMs: 30_000 }, async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 32, rows: 8, in: 'play' })
  let seen = ''
  for (let i = 0; i < 3; i++) {
    await stroke(ui, -2, 1)
    seen += await watch(ui, 3000)
  }
  expect(seen).toContain('game over: 0')
  await ui.advance(3000)
  expect(await play(ui)).toContain('●●●')
  await ui.unmount()
})

// ---------------------------------------------------------------- what each crab does, and the files

test('the helpers stand in the game, each with a word for what it does', async ($, on) => {
  engine(on, {}, { agentId: 'a1' })
  on('session.cwd', () => ({ value: '/repo' }))
  await start($)
  await $.prompt.submit({ text: 'build', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Agent', subagent_type: 'implementer', description: 'Build', prompt: 'x' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts', agentId: 'a1' } as never)
  const ui = await $.ui.mount(pane('terminal', 40))
  await ui.resize({ columns: 40, rows: 8, in: 'play' })
  // Mike, yellow, on the floor, and over his head what he does.
  expect((await cellsOf(ui, '#E0B341')).length).toBeGreaterThan(0)
  expect(await play(ui)).toContain('reads')
  await ui.unmount()
})

test('while Claude works, a few words over its head say what it does', async ($, on) => {
  engine(on)
  on('session.cwd', () => ({ value: '/repo' }))
  await start($)
  await $.prompt.submit({ text: 'check', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('terminal', 40))
  await ui.resize({ columns: 40, rows: 8, in: 'play' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/hoops.tsx' } as never)
  await ui.redraw()
  expect(words(await ui.drawn())).toContain('Thinking')
  await ui.unmount()
})

test('a click on a changed file folds its change out; its whole path is there for the hover', async ($, on) => {
  engine(on, {}, { filePath: '/repo/src/a.ts', structuredPatch: [{ newStart: 3, lines: [' x', '+hello', '-world'] }] })
  on('session.cwd', () => ({ value: '/repo' }))
  await start($)
  await $.prompt.submit({ text: 'change it', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'world', new_string: 'hello' } as never)
  const ui = await $.ui.mount(pane('terminal', 40))
  const before = words(await ui.drawn())
  expect(before).toContain('a.ts')
  expect(before).toContain('/repo/src/a.ts')
  expect(before).not.toContain('+hello')
  await ui.press({ key: 'f:src/a.ts' })
  const open = words(await ui.drawn())
  expect(open).toContain('line 3')
  expect(open).toContain('+hello')
  expect(open).toContain('−world')
  await ui.press({ key: 'f:src/a.ts' })
  expect(words(await ui.drawn())).not.toContain('+hello')
  await ui.unmount()
})

test('darts: hovering a helper names it and what it does', async ($, on) => {
  engine(on, DART_NEXT)
  await start($)
  await $.prompt.submit({ text: 'build', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('terminal'))
  await ui.resize({ columns: 40, rows: 8, in: 'play' })
  await $.tool.call({ tool: 'Agent', subagent_type: 'implementer', description: 'Build the pane', prompt: 'do it' })
  await hover(ui, MIKE)
  expect(await play(ui)).toContain('Mike · Builder')
  await ui.unmount()
})
