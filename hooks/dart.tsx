import type { ClientModule, RenderChildren } from 'claude-code'

// The other playground, played every other session (hoops.tsx the rest): darts.
//
// - A tiny ball waits on a peg at the left; the board stands at the right
//   edge with holes through it. Pull back from the ball and let go: the ball
//   flies in an arc, and the hole it goes through scores.
// - The holes shrink towards the middle: the outer ones are wide and worth
//   10, the next ring 25, and the middle one, a single pixel, is the bullseye:
//   50. A ball that meets the board between holes scores nothing.
// - Ten darts a round. The peg moves to a new height every dart, so no two
//   throws ask for the same pull. Bullseyes in a row earn 25 more each.
// - The best round is kept across sessions.
//
// Hard to master, quick to try again, calm to watch: no clock, a fading
// number for feedback, and Claude watching from the corner, glad of every hit.
// Claude can be picked up too: dragged, thrown, and it walks home after.

type Seg = { text: string; color: string; bold: boolean; dim: boolean }
type PlayProps = {
  pose: string[]
  palette: Record<string, string>
  tip: string
  /** The subagents at work. */
  helpers: HelperProp[]
  /** What Claude does now, while it works; '' when it waits. */
  claudeDoing: string
  /** Claude's mood in words ('Waiting for you'), for its card. */
  claudeMood: string
  /** Claude's level, for its card. */
  levels: Record<string, { level: number; pct: number }>
  /** The best round of ten darts, in points. */
  best: number
}

type Point = { x: number; y: number }
type Popup = { text: string; x: number; y: number; until: number; color: string }
type Bit = Point & { vx: number; vy: number; color: string; life: number }
type Play = {
  /** Where the pointer rests, unpressed: the crab under it shows its card. */
  hover?: Point
  /** The playground's own clock, advanced only while something moves. */
  t: number
  isAwake: boolean
  isTouched: boolean
  ball: Point & { vx: number; vy: number; isFlying: boolean; isDone: boolean }
  /** The peg's height for this dart, in pixels. */
  tee: number
  aim?: { from: Point; to: Point }
  /** Which dart of the round, 1 to 10. */
  dart: number
  score: number
  /** Bullseyes in a row. */
  streak: number
  best: number
  /** When a thrown dart gives way to the next. */
  nextAt: number
  cheerUntil: number
  popups: Popup[]
  bits: Bit[]
  trail: Point[]
  /** Claude: at home in the corner, held by the person, flying, or walking home. */
  claude: Point & {
    vx: number
    vy: number
    mode: 'home' | 'held' | 'flying' | 'walking'
    dx: number
    dy: number
    samples: (Point & { t: number })[]
  }
}

// Pixels are quarter cells: x in half columns, y in half rows. The ball is a
// point with a pixel either side, drawn as one round glyph.
const TICK = 33
const DT = TICK / 1000
const G = 120
const DARTS = 10
const PULL_MAX = 36
const POWER = 4.2
const TEE_X = 3
const RINGS: readonly { size: number; points: number }[] = [
  { size: 1, points: 50 },
  { size: 2, points: 25 },
  { size: 3, points: 10 },
]
const HOLE_LOOK: Record<number, string> = { 50: '#E5533D', 25: '#F5D547', 10: '#5B9BD5' }
const BOARD = '#8B6B4A'
const PEG = '#6B7280'
const AIM = '#8A8F98'
const BALL = '#F2F2F2'
const CONFETTI = ['#F5D547', '#7EC8F0', '#E07AA5', '#7BB662', '#D97757']
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

// Claude, watching from the corner: at rest, or cheering a good dart.
const HEAD = '..OOOOOOOOOOOO..'
const LEGS = '...O.O....O.O...'
const CHEER = [HEAD, 'O.OOOKOOOOKOOO.O', 'O.OOKOKOOKOKOO.O', '.OOOOOOOOOOOOOO.', HEAD, LEGS]
const WEE = [HEAD, 'O.OOOKOOOOKOOO.O', 'O.OOOKOOOOKOOO.O', '.OOOOOOOOOOOOOO.', HEAD, '....O.O..O.O....']
const STAND = [HEAD, HEAD, '..OOOKOOOOKOOO..', 'OOOOOOOOOOOOOOOO', HEAD, LEGS]
const STEP = [...STAND.slice(0, 5), '..O.O....O.O....']
const CLAUDE_W = 16
const CLAUDE_H = 6
const WALK = 18

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

/**
 * The board, top to bottom, a pixel row at a time: the points a ball passing
 * that row scores, 0 where the board is solid. The bullseye in the middle,
 * then each ring above and below it, a solid pixel between each.
 */
function boardOf(h: number): number[] {
  const rows = Array.from({ length: h }, () => 0)
  const centre = Math.floor(h / 2)
  rows[centre] = RINGS[0]!.points
  let up = centre - 1
  let down = centre + 1
  for (const ring of RINGS.slice(1)) {
    up -= 1
    down += 1
    for (let i = 0; i < ring.size; i++) {
      if (up >= 0) rows[up] = ring.points
      if (down < h) rows[down] = ring.points
      up -= 1
      down += 1
    }
  }
  return rows
}

/** A peg height the ball can be thrown from: over Claude's head, under the score. */
const teeFor = (h: number) => Math.round(4 + Math.random() * Math.max(0, h - 12))

function fresh(h: number): Play {
  const tee = teeFor(h)
  return {
    t: 0,
    isAwake: false,
    isTouched: false,
    ball: { x: TEE_X, y: tee, vx: 0, vy: 0, isFlying: false, isDone: false },
    tee,
    dart: 1,
    score: 0,
    streak: 0,
    best: 0,
    nextAt: 0,
    cheerUntil: 0,
    popups: [],
    bits: [],
    trail: [],
    claude: { x: 0, y: h - CLAUDE_H, vx: 0, vy: 0, mode: 'home', dx: 0, dy: 0, samples: [] },
  }
}

const popup = (s: Play, text: string, x: number, y: number, color: string, ms = 1400): Play => ({
  ...s,
  popups: [...s.popups, { text, x, y, color, until: s.t + ms }].slice(-3),
})

function confetti(bits: readonly Bit[], x: number, y: number, count: number): Bit[] {
  const born = Array.from({ length: count }, () => ({
    x, y, vx: -20 - Math.random() * 80, vy: -30 - Math.random() * 50, color: pick(CONFETTI), life: 1.2 + Math.random(),
  }))
  return [...bits, ...born].slice(-30)
}

/** A slingshot's launch: away from the pull, stronger the further back, up to a limit. */
function launchOf(aim: NonNullable<Play['aim']>) {
  let dx = aim.from.x - aim.to.x
  let dy = aim.from.y - aim.to.y
  const length = Math.hypot(dx, dy)
  if (length > PULL_MAX) {
    dx = (dx / length) * PULL_MAX
    dy = (dy / length) * PULL_MAX
  }
  return { vx: dx * POWER, vy: dy * POWER, length: Math.min(length, PULL_MAX) }
}

/** The dart through a hole: its points, a fading number, and a cheer for a good one. */
function hit(s: Play, points: number, w: number, y: number): Play {
  const isBull = points === RINGS[0]!.points
  const bonus = isBull && s.streak > 0 ? 25 * s.streak : 0
  const total = points + bonus
  let next: Play = { ...s, score: s.score + total, streak: isBull ? s.streak + 1 : 0 }
  const word = isBull ? (bonus > 0 ? `BULLSEYE +${total}!` : 'BULLSEYE 50!') : `+${points}`
  next = popup(next, word, w - 6 - word.length * 2, y - 2, isBull ? 'success' : points >= 25 ? 'warning' : 'subtle')
  if (points >= 25) next = { ...next, cheerUntil: s.t + (isBull ? 1600 : 900) }
  if (isBull) next = { ...next, bits: confetti(next.bits, w - 4, y, 14) }
  return next
}

/** After the tenth dart: the round's score, and the best kept. */
function endRound(s: Play, w: number): Play {
  let next: Play = { ...s, dart: 1, score: 0, streak: 0 }
  if (s.score > s.best) {
    next = popup({ ...next, best: s.score }, `new best: ${s.score}!`, w / 2 - 10, 6, 'success', 3200)
    return { ...next, cheerUntil: s.t + 2000, bits: confetti(next.bits, w / 2, 6, 24) }
  }
  return popup(next, `round: ${s.score}`, w / 2 - 6, 6, 'subtle', 2600)
}

function step(s0: Play, w: number, h: number): Play {
  let s: Play = { ...s0, t: s0.t + TICK }
  const t = s.t
  const ball = { ...s.ball }
  const boardX = w - 3

  if (ball.isFlying) {
    const was = { x: ball.x, y: ball.y }
    ball.vy += G * DT
    ball.x += ball.vx * DT
    ball.y += ball.vy * DT
    if (ball.y < 0) {
      ball.y = 0
      ball.vy = -ball.vy * 0.5
    }
    // The board: a hole scores and the ball goes through; the wood stops it.
    if (!ball.isDone && was.x < boardX && ball.x >= boardX) {
      const along = (boardX - was.x) / (ball.x - was.x)
      const y = was.y + (ball.y - was.y) * along
      const points = boardOf(h)[Math.floor(y)] ?? 0
      if (points > 0) {
        s = hit(s, points, w, y)
        ball.isDone = true
      } else {
        ball.x = boardX - 1
        ball.vx = -Math.abs(ball.vx) * 0.25
        ball.isDone = true
        s = { ...popup(s, '0', boardX - 4, y - 2, 'subtle', 900), streak: 0 }
      }
      s = { ...s, nextAt: t + 1100 }
    }
    if (ball.x < 0) {
      ball.x = 0
      ball.vx = -ball.vx * 0.4
    }
    // The floor ends a dart that fell short.
    if (ball.y >= h - 1) {
      ball.y = h - 1
      ball.vy = 0
      ball.vx *= 0.6
      if (!ball.isDone) {
        ball.isDone = true
        s = { ...popup(s, 'short', Math.max(ball.x, 24), h - 5, 'subtle', 900), streak: 0, nextAt: t + 900 }
      }
    }
  }
  s = { ...s, ball, trail: ball.isFlying && !ball.isDone ? [...s.trail, { x: ball.x, y: ball.y }].slice(-4) : [] }

  // The next dart: back on a peg at a new height; after the tenth, the round.
  if (s.nextAt > 0 && t >= s.nextAt) {
    if (s.dart >= DARTS) s = endRound(s, w)
    else s = { ...s, dart: s.dart + 1 }
    const tee = teeFor(h)
    s = { ...s, tee, nextAt: 0, ball: { x: TEE_X, y: tee, vx: 0, vy: 0, isFlying: false, isDone: false } }
  }

  // Claude, let go: falls, bounces off the walls, lands, walks home to the corner.
  const c = { ...s.claude }
  if (c.mode === 'flying') {
    c.vy += G * DT
    c.x += c.vx * DT
    c.y += c.vy * DT
    if (c.x < 0 || c.x > w - CLAUDE_W - 4) {
      c.x = clamp(c.x, 0, w - CLAUDE_W - 4)
      c.vx = -c.vx * 0.5
    }
    if (c.y < 0) {
      c.y = 0
      c.vy = -c.vy * 0.5
    }
    if (c.y >= h - CLAUDE_H) {
      c.y = h - CLAUDE_H
      if (c.vy > 40) c.vy = -c.vy * 0.35
      else c.mode = 'walking'
    }
  } else if (c.mode === 'walking') {
    c.x = Math.max(0, c.x - WALK * DT)
    if (c.x === 0) c.mode = 'home'
  }
  s = { ...s, claude: c }

  const bits = s.bits
    .map(b => ({ ...b, vy: b.vy + G * 0.5 * DT, x: b.x + b.vx * DT, y: b.y + b.vy * DT, life: b.life - DT }))
    .filter(b => b.life > 0 && b.y < h && b.x >= 0 && b.x < w)
  const popups = s.popups.filter(p => t < p.until)
  const isAwake =
    s.ball.isFlying || s.aim !== undefined || s.nextAt > 0 || bits.length > 0 || popups.length > 0 || t < s.cheerUntil || c.mode !== 'home'
  return { ...s, bits, popups, isAwake }
}

// ---------------------------------------------------------------- the helpers

/** A subagent at work, from the panel: its character, and what it does now. */
type HelperProp = { id: string; name: string; body: string; hat: string; glasses: string; gearColor: string; isDone: boolean; doing: string; title: string; level: number }

// A subagent's crab, smaller than Claude: a 10 x 3 body, its hat on a row above.
const M_STAND = ['.OOKOOKOO.', 'OOOOOOOOOO', '.O.O..O.O.']
const M_SIT = ['..........', '.OKKOOKKO.', 'OOOOOOOOOO']
const M_HAPPY = ['OOKKOOKKOO', '.OOOOOOOO.', '.O.O..O.O.']
const HELPER_STEP = 12

/** A helper's activity as one short verb that fits under six columns. */
const VERBS: Record<string, string> = { Reading: 'reads', Editing: 'edits', Writing: 'writes', Running: 'runs', Searching: 'looks', Starting: 'starts', Using: 'uses' }
const verbOf = (doing: string) => VERBS[doing.split(' ')[0] ?? ''] ?? (doing.split(' ')[0] ?? '').toLowerCase()

/** What a crab does, short: lower case, cut to fit. */
function shortly(doing: string, max: number): string {
  const text = doing.replace(/\s+/g, ' ').trim()
  const lower = text.charAt(0).toLowerCase() + text.slice(1)
  return lower.length > max ? `${lower.slice(0, Math.max(1, max - 1))}…` : lower
}

/** Where each helper stands: in a row on the floor from `from`, as many as fit before `to`. */
function helperSpots(helpers: readonly HelperProp[], from: number, to: number) {
  return helpers.map((helper, i) => ({ helper, x: from + i * HELPER_STEP })).filter(spot => spot.x + 10 <= to)
}

/** A helper's body, sitting when done, arms up when cheering, glasses over its eyes. */
function helperGrid(helper: HelperProp, isCheering: boolean): { body: string[]; top: number } {
  let body = helper.isDone ? M_SIT : isCheering ? M_HAPPY : M_STAND
  const eyes = body.findIndex(row => row.includes('K'))
  if (helper.glasses && eyes >= 0) {
    body = body.map((row, y) => (y !== eyes ? row : [...row].map((p, x) => (helper.glasses[x] === 'G' && p === 'O' ? 'G' : p)).join('')))
  }
  return { body, top: body.findIndex(row => /[^.]/.test(row)) }
}

/** The card over a crab the pointer rests on. */
const CARD_BG = '#2B2B2B'
const CARD_TEXT = '#E8E8E8'

type Surface = Parameters<ClientModule<PlayProps, Play>>[1]
type PointerEvent = Parameters<Parameters<Surface['onPointer']>[0]>[0]

function handle(surface: Surface, e: PointerEvent) {
  const s = surface.state
  if (!s || surface.columns === 0) return
  const at = { x: (e.fine?.x ?? e.x + 0.5) * 2, y: (e.fine?.y ?? e.y + 0.5) * 2 }
  const c = s.claude
  // An unpressed pointer only points: the crab under it gets its card.
  if (e.type === 'leave') {
    if (s.hover) surface.setState({ ...s, hover: undefined })
    return
  }
  if ((e.type === 'move' || e.type === 'enter') && e.button === undefined && !s.aim && s.claude.mode !== 'held') {
    const was = s.hover
    const isSameCell = was !== undefined && Math.floor(was.x / 2) === Math.floor(at.x / 2) && Math.floor(was.y / 2) === Math.floor(at.y / 2)
    if (!isSameCell) surface.setState({ ...s, hover: at })
    return
  }
  if (e.type === 'down' && e.button === 'left') {
    const isReady = !s.ball.isFlying && s.nextAt === 0
    if (isReady && Math.hypot(at.x - s.ball.x, at.y - s.ball.y) <= 4) {
      surface.setState({ ...s, isTouched: true, isAwake: true, aim: { from: at, to: at } })
      return
    }
    // Claude, picked up anywhere on its body.
    const isOnClaude = at.x >= c.x && at.x <= c.x + CLAUDE_W && at.y >= c.y - 1 && at.y <= c.y + CLAUDE_H
    if (isOnClaude) {
      const held = { ...c, mode: 'held' as const, vx: 0, vy: 0, dx: at.x - c.x, dy: at.y - c.y, samples: [{ ...at, t: s.t }] }
      surface.setState(popup({ ...s, isTouched: true, isAwake: true, claude: held }, pick(['whee!', 'oops!', 'hi!']), c.x + 4, c.y - 3, 'warning', 900))
    }
    return
  }
  if (c.mode === 'held') {
    const w = surface.columns * 2
    const h = surface.rows * 2
    const samples = [...c.samples, { ...at, t: s.t }].slice(-8)
    const x = clamp(at.x - c.dx, 0, w - CLAUDE_W - 4)
    const y = clamp(at.y - c.dy, 0, h - CLAUDE_H)
    if (e.type === 'move') surface.setState({ ...s, claude: { ...c, x, y, samples } })
    if (e.type !== 'up') return
    // Let go: thrown as fast as the hand moved over the last tenth of a second.
    const newest = samples[samples.length - 1]!
    const oldest = samples.find(q => newest.t - q.t <= 100) ?? newest
    const dt = Math.max(TICK, newest.t - oldest.t) / 1000
    const vx = clamp((newest.x - oldest.x) / dt, -150, 150)
    const vy = clamp((newest.y - oldest.y) / dt, -120, 120)
    surface.setState({ ...s, isAwake: true, claude: { ...c, x, y, vx, vy, mode: 'flying', samples: [] } })
    return
  }
  if (!s.aim) return
  if (e.type === 'move') surface.setState({ ...s, aim: { ...s.aim, to: at } })
  if (e.type !== 'up') return
  const launch = launchOf({ ...s.aim, to: at })
  // Too short a pull is no dart: nothing counted.
  if (launch.length < 2) {
    surface.setState({ ...s, aim: undefined })
    return
  }
  surface.setState({ ...s, aim: undefined, isAwake: true, ball: { ...s.ball, vx: launch.vx, vy: launch.vy, isFlying: true } })
}

type Cell = { ch: string; fg: string; bg: string; bold: boolean; dim: boolean }

const Darts: ClientModule<PlayProps, Play> = (props, surface) => {
  const { Box, Text } = surface.elements
  const columns = surface.columns
  const rows = surface.rows

  if (surface.state === undefined) {
    surface.setState(fresh(Math.max(16, rows * 2)))
    surface.onPointer(e => handle(surface, e))
    surface.every(TICK, () => {
      const s = surface.state
      if (!s || !s.isAwake || surface.columns === 0) return
      const next = step(s, surface.columns * 2, surface.rows * 2)
      // A round better than the stored best goes to the panel to keep.
      if (next.best > s.best) surface.post({ dart: next.best })
      surface.setState(next)
    })
  }
  if (columns < 10 || rows < 4) return <Box />
  const pxWide = columns * 2
  const pxTall = rows * 2
  const current = surface.state ?? fresh(pxTall)
  const s = current.best < props.best ? { ...current, best: props.best } : current
  if (s !== current) surface.setState(s)

  // Pixels, as colors: Claude watching, the peg, the board with its holes
  // marked by their colors, the aim, the trail, confetti.
  const canvas = Array.from({ length: pxTall }, () => Array.from({ length: pxWide }, () => ''))
  const paint = (grid: readonly string[], ox: number, oy: number, colorOf: (c: string) => string | undefined) => {
    grid.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const color = c === '.' ? undefined : colorOf(c)
        const px = Math.round(ox) + x
        const py = Math.round(oy) + y
        if (color && canvas[py]?.[px] !== undefined) canvas[py]![px] = color
      }),
    )
  }
  const dot = (x: number, y: number, color: string) => paint(['x'], x, y, () => color)

  const claude = s.claude.mode === 'home' ? { ...s.claude, y: pxTall - CLAUDE_H } : s.claude
  const pose =
    claude.mode === 'held' || claude.mode === 'flying'
      ? WEE
      : claude.mode === 'walking'
        ? Math.floor(s.t / 180) % 2
          ? STEP
          : STAND
        : s.t < s.cheerUntil
          ? CHEER
          : props.pose.length === 6
            ? props.pose
            : STAND
  paint(pose, claude.x, claude.y, k => props.palette[k])
  // The helpers, standing in a row on the floor: just there, the game goes through them.
  const spots = helperSpots(props.helpers, CLAUDE_W + 2, pxWide - 4)
  for (const { helper, x } of spots) {
    const { body, top } = helperGrid(helper, s.t < s.cheerUntil)
    const colorOf = (k: string) => (k === 'K' ? props.palette.K : k === 'G' ? helper.gearColor : helper.body)
    paint(body, x, pxTall - 3, colorOf)
    if (helper.hat) paint([helper.hat], x, pxTall - 3 + top - 1, colorOf)
  }

  if (!s.ball.isFlying) paint(['xxxx'], TEE_X - 2, s.tee + 1, () => PEG)
  boardOf(pxTall).forEach((points, y) => {
    paint(['xx'], pxWide - 3, y, () => (points > 0 ? undefined : BOARD))
    dot(pxWide - 1, y, points > 0 ? HOLE_LOOK[points]! : BOARD)
  })
  if (s.aim) {
    const { vx, vy, length } = launchOf(s.aim)
    if (length >= 2) for (let k = 1; k <= 3; k++) dot(s.ball.x + vx * k * 0.07, s.ball.y + vy * k * 0.07 + 0.5 * G * (k * 0.07) ** 2, AIM)
  }
  for (const p of s.trail) dot(p.x, p.y, AIM)
  for (const b of s.bits) dot(b.x, b.y, b.color)

  const cells: Cell[][] = Array.from({ length: rows }, (_, cy) =>
    Array.from({ length: columns }, (_, cx) => {
      const quads = [canvas[cy * 2]![cx * 2]!, canvas[cy * 2]![cx * 2 + 1]!, canvas[cy * 2 + 1]![cx * 2]!, canvas[cy * 2 + 1]![cx * 2 + 1]!]
      const counts = new Map<string, number>()
      for (const q of quads) if (q !== '') counts.set(q, (counts.get(q) ?? 0) + 1)
      const [ink, behind] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
      if (ink === undefined) return { ch: ' ', fg: '', bg: '', bold: false, dim: false }
      const mask = quads.reduce((m, q, i) => (q === ink ? m | (1 << i) : m), 0)
      return { ch: QUADRANTS[mask]!, fg: ink, bg: behind ?? '', bold: false, dim: false }
    }),
  )

  // Words: the score top left, fading numbers, Claude's tip, a hint. The ball over all.
  const taken = cells.map(row => row.map(() => false))
  const write = (row: number, col: number, seg: Seg) => {
    ;[...seg.text].forEach((ch, i) => {
      if (!cells[row]?.[col + i]) return
      cells[row]![col + i] = { ch, fg: seg.color, bg: '', bold: seg.bold, dim: seg.dim }
      taken[row]![col + i] = true
    })
  }
  const isOpen = (row: number, col: number, length: number) =>
    row >= 0 && row < rows && col >= 0 && col + length <= columns - 2 && cells[row]!.slice(col, col + length).every((c, i) => c.ch === ' ' && !taken[row]![col + i])
  const plain = (text: string): Seg => ({ text, color: '', bold: false, dim: true })

  const counter = `Dart ${s.dart}/${DARTS}`
  write(0, 0, { text: counter, color: 'claude', bold: true, dim: false })
  const rest = `  ★ ${s.score}  best ${s.best}`
  if (isOpen(0, counter.length, rest.length)) write(0, counter.length, plain(rest))
  for (const p of s.popups) {
    const row = clamp(Math.floor(p.y / 2), 0, rows - 1)
    const col = clamp(Math.round(p.x / 2), 0, Math.max(0, columns - 2 - p.text.length))
    const spot = [[row, col], [row + 1, col], [row - 1, col]].find(([r, c]) => isOpen(r!, c!, p.text.length))
    if (spot) write(spot[0]!, spot[1]!, { text: p.text, color: p.color, bold: true, dim: false })
  }
  if (props.tip !== '') {
    const row = rows - 4
    if (isOpen(row, 1, props.tip.length)) write(row, 1, { text: props.tip, color: 'claude', bold: false, dim: false })
  }
  // What each crab does, a few words over its head, dim: Claude's work and each helper's.
  const label = (text: string, x: number, row: number, room: number) => {
    const shown = shortly(text, room)
    const col = clamp(Math.round(x / 2), 0, Math.max(0, columns - shown.length))
    // Over the head, or a row or two higher when the hoop or a word is in the way.
    const free = [row, row - 1, row - 2].find(r => r > 0 && isOpen(r, col, shown.length))
    if (shown !== '' && free !== undefined) write(free, col, plain(shown))
  }
  // The crab under the pointer: a small card with its name, level and work.
  const hover = s.hover
  const card = (() => {
    if (!hover) return undefined
    if (hover.x >= claude.x && hover.x <= claude.x + CLAUDE_W && hover.y >= claude.y - 1 && hover.y <= claude.y + CLAUDE_H) {
      const lines = [`Claude · Lv ${props.levels.main?.level ?? 1}`, props.claudeDoing || props.claudeMood]
      return { x: claude.x + CLAUDE_W / 2, top: claude.y, color: 'claude', lines }
    }
    const spot = spots.find(({ x }) => hover.x >= x && hover.x <= x + 10 && hover.y >= pxTall - 5)
    if (!spot) return undefined
    const { helper } = spot
    const lines = [`${helper.name} · ${helper.title} Lv${helper.level}`, helper.isDone ? 'done' : helper.doing]
    return { x: spot.x + 5, top: pxTall - 5, color: helper.body, lines } // over its hat
  })()
  if (!card) {
    if (props.claudeDoing !== '') label(props.claudeDoing, claude.x, Math.floor((pxTall - CLAUDE_H) / 2) - 1, 16)
    // A helper has six columns: its verb alone, short: 'reads', 'edits', 'runs'.
    for (const { helper, x } of spots) label(helper.isDone ? 'done' : verbOf(helper.doing), x, Math.floor((pxTall - 4) / 2) - 1, 6)
  }
  if (card) {
    const width = Math.min(columns, Math.max(...card.lines.map(line => [...line].length)) + 2)
    const col = clamp(Math.round(card.x / 2 - width / 2), 0, Math.max(0, columns - width))
    const row = clamp(Math.floor(card.top / 2) - card.lines.length, 1, Math.max(1, rows - card.lines.length))
    card.lines.forEach((line, i) => {
      const chars = [...line]
      const fitted = chars.length > width - 2 ? [...chars.slice(0, width - 3), '…'] : chars
      const padded = [' ', ...fitted, ...Array(Math.max(0, width - 1 - fitted.length)).fill(' ')]
      padded.forEach((ch, k) => {
        if (cells[row + i]?.[col + k]) cells[row + i]![col + k] = { ch, fg: i === 0 ? card.color : CARD_TEXT, bg: CARD_BG, bold: i === 0, dim: false }
      })
    })
  }
  if (!s.isTouched) {
    const hint = 'pull back from the ball'
    const row = rows - 1
    if (isOpen(row, 9, hint.length)) write(row, 9, plain(hint))
  }
  const ballRow = cells[clamp(Math.floor(s.ball.y / 2), 0, rows - 1)]!
  ballRow[clamp(Math.floor(s.ball.x / 2), 0, columns - 1)] = { ch: '●', fg: BALL, bg: '', bold: true, dim: false }

  const lines: RenderChildren[] = cells.map(row => {
    const runs: Cell[] = []
    for (const cell of row) {
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg && last.bold === cell.bold && last.dim === cell.dim) last.ch += cell.ch
      else runs.push({ ...cell })
    }
    return (
      <Text>
        {runs.map(run =>
          run.fg === '' && run.bg === '' && !run.bold && !run.dim ? (
            <Text>{run.ch}</Text>
          ) : run.bg === '' ? (
            <Text color={run.fg || undefined} bold={run.bold} dimColor={run.dim}>
              {run.ch}
            </Text>
          ) : (
            <Text color={run.fg || undefined} backgroundColor={run.bg} bold={run.bold} dimColor={run.dim}>
              {run.ch}
            </Text>
          ),
        )}
      </Text>
    )
  })
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {lines}
    </Box>
  )
}

export default Darts
