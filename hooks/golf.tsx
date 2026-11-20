import type { ClientModule, RenderChildren } from 'claude-code'

// The playground, played every other session (dart.tsx the rest): one hoop
// at a time.
//
// - A small ball waits in a slingshot at the bottom left; one hoop hangs over
//   on the right, at a new height and a new reach each time. Pull back from
//   the ball and let go: it flies in an arc, and a ball that drops down
//   through the hoop scores. Every shot is from the slingshot.
// - Three tries a hoop. A basket scores 1, one more in the first try, one
//   more clean through without touching the rim (swish), and the hoop moves
//   on with three fresh tries. Three misses at one hoop end the run.
// - Easy to start, hard to keep going: the hoop shrinks a little every ten
//   points. A run of baskets in a row shows, and every fifth throws confetti.
//   The best run is kept across sessions.
// - Claude stands mid-floor: a ball that drops on its head bounces off it,
//   and it can be picked up, dragged and thrown, and walks back after.
//
// Calm by design: no clock, nothing moves until the person plays, feedback is
// a word that fades.

type Seg = { text: string; color: string; bold: boolean; dim: boolean }
type PlayProps = {
  pose: string[]
  palette: Record<string, string>
  tip: string
  /** The subagents at work. */
  helpers: HelperProp[]
  /** What Claude does now, while it works; '' when it waits. */
  claudeDoing: string
  /** The best run, in points. */
  best: number
  tokens: number
  levels: Record<string, { level: number; pct: number }>
}

type Point = { x: number; y: number }
type Popup = { text: string; x: number; y: number; until: number; color: string }
type Bit = Point & { vx: number; vy: number; color: string; life: number }
/** The hoop: its left rim, the rim's height, how wide its opening is. */
type Hoop = Point & { open: number }
type Play = {
  /** The playground's own clock, advanced only while something moves. */
  t: number
  isAwake: boolean
  isTouched: boolean
  ball: Point & { vx: number; vy: number; isFlying: boolean }
  aim?: { from: Point; to: Point }
  hoop: Hoop
  /** Tries left at this hoop. */
  tries: number
  /** The shot in flight touched the rim: no swish. */
  isRimmed: boolean
  score: number
  /** Baskets in a row. */
  streak: number
  best: number
  /** The basket is in, or the run is over: what follows, after a moment. */
  nextAt: number
  isOver: boolean
  cheerUntil: number
  popups: Popup[]
  bits: Bit[]
  trail: Point[]
  /** Experience earned and not yet sent to the panel. */
  xp: number
  /** Claude's level last seen, for the cheer when it goes up. */
  seenLevel: number
  /** The width the hoop was placed for: placed again at a new one before the first shot. */
  layoutW: number
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
const TRIES = 3
const PULL_MAX = 36
const POWER = 4.2
const RIM = '#E5533D'
const NET = '#9AA0A6'
const FORK = '#8B6B4A'
const AIM = '#8A8F98'
const CONFETTI = ['#F5D547', '#7EC8F0', '#E07AA5', '#7BB662', '#D97757']
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
const GIFT_TOKENS = 100_000
/** The ball each 100k tokens brings, in order; the newest is played with. */
const BALL_COLORS = ['#F2F2F2', '#C8E64A', '#5FD3B6', '#F28C28', '#F28C28', '#E07B39', '#E07B39', '#F5C542', '#F5C542', '#9B7FD1', '#E5533D']

/** The slingshot, bottom left: where the ball sits before every shot. */
const SLING_X = 4
const slingOf = (h: number) => ({ x: SLING_X, y: h - 4 })

// Claude, mid-floor: at rest, walking, held, or cheering a basket.
const HEAD = '..OOOOOOOOOOOO..'
const LEGS = '...O.O....O.O...'
const STAND = [HEAD, HEAD, '..OOOKOOOOKOOO..', 'OOOOOOOOOOOOOOOO', HEAD, LEGS]
const STEP = [...STAND.slice(0, 5), '..O.O....O.O....']
const CHEER = [HEAD, 'O.OOOKOOOOKOOO.O', 'O.OOKOKOOKOKOO.O', '.OOOOOOOOOOOOOO.', HEAD, LEGS]
const WEE = [HEAD, 'O.OOOKOOOOKOOO.O', 'O.OOOKOOOOKOOO.O', '.OOOOOOOOOOOOOO.', HEAD, '....O.O..O.O....']
const CLAUDE_W = 16
const CLAUDE_H = 6
const WALK = 18
/** Claude's spot: the middle of the floor, clear of the slingshot and the hoop. */
const homeXOf = (w: number) => Math.max(10, Math.round((w - CLAUDE_W) / 2) - 6)

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

/**
 * The next hoop: over on the right but not always at the edge, at a height
 * a lob can reach and come down through, never where the last one was. Its
 * opening narrows a pixel every ten points, from 8 down to 4.
 */
function hoopFor(score: number, w: number, h: number, was?: Hoop): Hoop {
  const open = Math.max(4, 8 - Math.floor(score / 10))
  const width = open + 2
  const from = Math.round(w * 0.62)
  const to = w - width - 2
  const top = 6
  const bottom = Math.max(top, h - 6)
  for (let tries = 0; tries < 8; tries++) {
    const hoop = { x: Math.round(from + Math.random() * Math.max(0, to - from)), y: Math.round(top + Math.random() * (bottom - top)), open }
    if (!was || Math.abs(hoop.x - was.x) + Math.abs(hoop.y - was.y) > 6) return hoop
  }
  return { x: to, y: top, open }
}

function fresh(w: number, h: number): Play {
  return {
    t: 0,
    isAwake: false,
    isTouched: false,
    ball: { ...slingOf(h), vx: 0, vy: 0, isFlying: false },
    hoop: hoopFor(0, w, h),
    tries: TRIES,
    isRimmed: false,
    score: 0,
    streak: 0,
    best: 0,
    nextAt: 0,
    isOver: false,
    cheerUntil: 0,
    popups: [],
    bits: [],
    trail: [],
    xp: 0,
    seenLevel: -1,
    layoutW: 0,
    claude: { x: homeXOf(w), y: h - CLAUDE_H, vx: 0, vy: 0, mode: 'home', dx: 0, dy: 0, samples: [] },
  }
}

const popup = (s: Play, text: string, x: number, y: number, color: string, ms = 1300): Play => ({
  ...s,
  popups: [...s.popups, { text, x, y, color, until: s.t + ms }].slice(-3),
})

function confetti(bits: readonly Bit[], x: number, y: number, count: number): Bit[] {
  const born = Array.from({ length: count }, () => ({
    x, y, vx: (Math.random() - 0.5) * 100, vy: -30 - Math.random() * 50, color: pick(CONFETTI), life: 1.2 + Math.random(),
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

/** In: a point, one more in the first try, one more for a swish; the hoop moves on after a moment. */
function basket(s: Play): Play {
  const isFirst = s.tries === TRIES
  const isSwish = !s.isRimmed
  const points = 1 + (isFirst ? 1 : 0) + (isSwish ? 1 : 0)
  const streak = s.streak + 1
  const how = [isSwish && 'swish', isFirst && 'first try'].filter(Boolean).join(' ')
  let next: Play = { ...s, score: s.score + points, streak, xp: s.xp + points, nextAt: s.t + 900 }
  next = popup(next, how ? `+${points} ${how}` : `+${points}`, s.hoop.x - 8, s.hoop.y - 3, points >= 3 ? 'success' : 'warning')
  if (points >= 3 || streak % 5 === 0) next = { ...next, cheerUntil: s.t + 1100 }
  if (streak % 5 === 0) {
    next = popup({ ...next, bits: confetti(next.bits, s.hoop.x + s.hoop.open / 2, s.hoop.y, 16) }, `${streak} in a row!`, s.hoop.x - 10, s.hoop.y + 4, 'success', 1600)
  }
  return next
}

/** A shot that missed: a try spent; the last one ends the run. */
function miss(s: Play, w: number): Play {
  const tries = s.tries - 1
  if (tries > 0) return { ...s, tries, streak: 0 }
  let next: Play = { ...s, tries: 0, streak: 0, isOver: true, nextAt: s.t + 2400 }
  if (s.score > s.best) {
    next = popup({ ...next, best: s.score }, `new best: ${s.score}!`, w / 2 - 12, 6, 'success', 2400)
    return { ...next, cheerUntil: s.t + 2000, bits: confetti(next.bits, w / 2, 6, 24) }
  }
  return popup(next, `game over: ${s.score}`, w / 2 - 12, 6, 'subtle', 2400)
}

function step(s0: Play, w: number, h: number): Play {
  let s: Play = { ...s0, t: s0.t + TICK }
  if (!s.ball.isFlying && s.nextAt === 0) s = { ...s, ball: { ...s.ball, ...slingOf(h) } }
  if (s.claude.mode === 'home') s = { ...s, claude: { ...s.claude, x: homeXOf(w), y: h - CLAUDE_H } }
  const t = s.t
  const ball = { ...s.ball }
  const hoop = s.hoop
  let rested = false

  if (ball.isFlying && s.nextAt === 0) {
    const was = { x: ball.x, y: ball.y }
    ball.vy += G * DT
    ball.x += ball.vx * DT
    ball.y += ball.vy * DT
    if (ball.y < 0) {
      ball.y = 0
      ball.vy = -ball.vy * 0.5
    }
    if (ball.x < 0 || ball.x > w - 1) {
      ball.x = clamp(ball.x, 0, w - 1)
      ball.vx = -ball.vx * 0.5
    }
    // The rim: a pixel each side of the opening; the ball glances off it.
    for (const rx of [hoop.x, hoop.x + hoop.open + 1]) {
      const isTouching = Math.abs(ball.x - (rx + 0.5)) < 1.2 && Math.abs(ball.y - (hoop.y + 0.5)) < 1.2
      if (!isTouching) continue
      s = { ...s, isRimmed: true }
      if (was.y < hoop.y) ball.vy = -Math.abs(ball.vy) * 0.45
      ball.vx = (ball.x < rx + 0.5 ? -1 : 1) * Math.max(15, Math.abs(ball.vx) * 0.5)
      ball.x = was.x
      ball.y = Math.min(ball.y, was.y)
      break
    }
    // In: the ball falls down through the rim line between the rims.
    if (was.y < hoop.y && ball.y >= hoop.y && ball.vy > 0 && ball.x > hoop.x + 1 && ball.x < hoop.x + hoop.open + 1) {
      s = basket(s)
      ball.vx = 0
    }
    // Claude's head: the ball bounces off it, up and on.
    const c = s.claude
    const onHead = ball.x > c.x + 1 && ball.x < c.x + CLAUDE_W - 1 && ball.y >= c.y - 1 && ball.y <= c.y + 1 && ball.vy > 0
    if (onHead && s.nextAt === 0) {
      ball.y = c.y - 1
      ball.vy = -Math.max(40, ball.vy * 0.8)
      ball.vx = Math.max(ball.vx, 25)
      s = { ...s, cheerUntil: t + 500 }
    }
    // The floor takes the bounce out of it; still, the shot is over.
    if (ball.y >= h - 1) {
      ball.y = h - 1
      ball.vy = ball.vy > 20 ? -ball.vy * 0.4 : 0
      if (ball.vy === 0) {
        ball.vx *= 0.8
        if (Math.abs(ball.vx) < 3) ball.vx = 0
      }
    }
    rested = ball.vx === 0 && ball.vy === 0 && ball.y >= h - 1
  } else if (ball.isFlying) {
    // In the hoop: the ball drops through the net.
    ball.vy += G * DT
    ball.y = Math.min(h - 1, ball.y + ball.vy * DT)
  }
  s = { ...s, ball, trail: ball.isFlying && s.nextAt === 0 ? [...s.trail, { x: ball.x, y: ball.y }].slice(-4) : [] }

  // Missed and come to rest: a try spent, the ball back in the slingshot.
  if (rested && s.nextAt === 0) {
    s = miss(s, w)
    s = { ...s, isRimmed: false, ball: { ...slingOf(h), vx: 0, vy: 0, isFlying: false } }
  }

  // After a basket, the next hoop; after the last miss, a new run.
  if (s.nextAt > 0 && t >= s.nextAt) {
    const next = s.isOver ? { ...s, score: 0, tries: TRIES, isOver: false } : { ...s, tries: TRIES }
    s = { ...next, nextAt: 0, isRimmed: false, hoop: hoopFor(next.score, w, h, s.hoop), ball: { ...slingOf(h), vx: 0, vy: 0, isFlying: false } }
  }

  // Claude, let go: falls, bounces off the walls, lands, walks back to its spot.
  let c = { ...s.claude }
  if (c.mode === 'flying') {
    c.vy += G * DT
    c.x += c.vx * DT
    c.y += c.vy * DT
    if (c.x < 0 || c.x > w - CLAUDE_W) {
      c.x = clamp(c.x, 0, w - CLAUDE_W)
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
    const home = homeXOf(w)
    c.x += clamp(home - c.x, -WALK * DT, WALK * DT)
    if (Math.abs(c.x - home) < 0.5) c = { ...c, x: home, mode: 'home' }
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
type HelperProp = { id: string; name: string; body: string; hat: string; glasses: string; gearColor: string; isDone: boolean; doing: string }

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

type Surface = Parameters<ClientModule<PlayProps, Play>>[1]
type PointerEvent = Parameters<Parameters<Surface['onPointer']>[0]>[0]

function handle(surface: Surface, e: PointerEvent) {
  const s0 = surface.state
  if (!s0 || surface.columns === 0) return
  const w = surface.columns * 2
  const h = surface.rows * 2
  const at = { x: (e.fine?.x ?? e.x + 0.5) * 2, y: (e.fine?.y ?? e.y + 0.5) * 2 }
  // The ball in the slingshot and Claude at home sit where they are drawn, at the size the field is now.
  const s = !s0.ball.isFlying && s0.nextAt === 0 ? { ...s0, ball: { ...s0.ball, ...slingOf(h) } } : s0
  const c = s.claude.mode === 'home' ? { ...s.claude, x: homeXOf(w), y: h - CLAUDE_H } : s.claude
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
    const samples = [...c.samples, { ...at, t: s.t }].slice(-8)
    const x = clamp(at.x - c.dx, 0, w - CLAUDE_W)
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
  // Too short a pull is no shot: nothing counted.
  if (launch.length < 2) {
    surface.setState({ ...s, aim: undefined })
    return
  }
  surface.setState({ ...s, aim: undefined, isAwake: true, isRimmed: false, ball: { ...s.ball, vx: launch.vx, vy: launch.vy, isFlying: true } })
}

type Cell = { ch: string; fg: string; bg: string; bold: boolean; dim: boolean }

const Golf: ClientModule<PlayProps, Play> = (props, surface) => {
  const { Box, Text } = surface.elements
  const columns = surface.columns
  const rows = surface.rows

  if (surface.state === undefined) {
    surface.setState(fresh(Math.max(32, columns * 2), Math.max(16, rows * 2)))
    surface.onPointer(e => handle(surface, e))
    surface.every(TICK, () => {
      const s = surface.state
      if (!s || !s.isAwake || surface.columns === 0) return
      const next = step(s, surface.columns * 2, surface.rows * 2)
      // What the panel keeps, in one message: a better run, experience earned.
      const message: Record<string, number | Record<string, number>> = {}
      if (next.best > s.best) message.round = next.best
      if (next.xp > 0) message.xp = { main: next.xp }
      const isSent = Object.keys(message).length > 0
      if (isSent) surface.post(message)
      surface.setState(isSent ? { ...next, xp: 0 } : next)
    })
  }
  if (columns < 10 || rows < 4) return <Box />
  const pxWide = columns * 2
  const pxTall = rows * 2

  // From outside: the field's size before the first shot, a better stored run, Claude's level.
  const current = surface.state ?? fresh(pxWide, pxTall)
  let s = current
  if (s.layoutW !== pxWide && s.score === 0 && s.tries === TRIES && !s.ball.isFlying) {
    s = { ...s, hoop: hoopFor(0, pxWide, pxTall), layoutW: pxWide }
  }
  if (s.best < props.best) s = { ...s, best: props.best }
  const level = props.levels.main?.level ?? 1
  if (s.seenLevel !== level) {
    if (s.seenLevel > 0 && level > s.seenLevel) {
      s = popup({ ...s, isAwake: true, cheerUntil: s.t + 1600 }, `Claude Lv ${level}!`, homeXOf(pxWide), pxTall - 9, 'success', 2600)
    }
    s = { ...s, seenLevel: level }
  }
  if (s !== current) surface.setState(s)
  const isInSling = !s.ball.isFlying && s.nextAt === 0
  const ball = isInSling ? { ...s.ball, ...slingOf(pxTall) } : s.ball

  // Pixels, as colors: Claude, the helpers, the slingshot, the hoop and
  // its net, the aim, the trail, confetti.
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

  const claude = s.claude.mode === 'home' ? { ...s.claude, x: homeXOf(pxWide), y: pxTall - CLAUDE_H } : s.claude
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
  const spots = helperSpots(props.helpers, homeXOf(pxWide) + CLAUDE_W + 2, pxWide - 2)
  for (const { helper, x } of spots) {
    const { body, top } = helperGrid(helper, s.t < s.cheerUntil)
    const colorOf = (k: string) => (k === 'K' ? props.palette.K : k === 'G' ? helper.gearColor : helper.body)
    paint(body, x, pxTall - 3, colorOf)
    if (helper.hat) paint([helper.hat], x, pxTall - 3 + top - 1, colorOf)
  }

  // The slingshot: a fork on a stem, the ball resting in it.
  paint(['x..x', 'x..x', '.xx.', '.xx.'], SLING_X - 1, pxTall - 4, () => FORK)
  const hoop = s.hoop
  paint(['.' + 'n'.repeat(hoop.open) + '.', '..' + 'n'.repeat(Math.max(0, hoop.open - 2)) + '..'], hoop.x, hoop.y + 1, () => NET)
  paint(['x' + '.'.repeat(hoop.open) + 'x'], hoop.x, hoop.y, () => RIM)
  if (s.aim) {
    const { vx, vy, length } = launchOf(s.aim)
    if (length >= 2) for (let k = 1; k <= 3; k++) dot(ball.x + vx * k * 0.07, ball.y + vy * k * 0.07 + 0.5 * G * (k * 0.07) ** 2, AIM)
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

  // Words: the score top left, fading words, Claude's tip, a hint. The ball over all.
  const taken = cells.map(row => row.map(() => false))
  const write = (row: number, col: number, seg: Seg) => {
    ;[...seg.text].forEach((ch, i) => {
      if (!cells[row]?.[col + i]) return
      cells[row]![col + i] = { ch, fg: seg.color, bg: '', bold: seg.bold, dim: seg.dim }
      taken[row]![col + i] = true
    })
  }
  const isOpen = (row: number, col: number, length: number) =>
    row >= 0 && row < rows && col >= 0 && col + length <= columns && cells[row]!.slice(col, col + length).every((c, i) => c.ch === ' ' && !taken[row]![col + i])
  const plain = (text: string): Seg => ({ text, color: '', bold: false, dim: true })

  const score = `★ ${s.score}`
  write(0, 0, { text: score, color: 'claude', bold: true, dim: false })
  const tries = '●'.repeat(s.tries) + '○'.repeat(TRIES - s.tries)
  const streak = s.streak >= 2 ? `  ${s.streak} in a row` : ''
  const rest = [`  ${tries}  best ${s.best}${streak}`, `  ${tries}  best ${s.best}`, `  ${tries}`].find(text => isOpen(0, score.length, text.length))
  if (rest) write(0, score.length, plain(rest))
  for (const p of s.popups) {
    const row = clamp(Math.floor(p.y / 2), 0, rows - 1)
    const col = clamp(Math.round(p.x / 2), 0, Math.max(0, columns - p.text.length))
    const spot = [[row, col], [row - 1, col], [row + 1, col]].find(([r, c]) => isOpen(r!, c!, p.text.length))
    if (spot) write(spot[0]!, spot[1]!, { text: p.text, color: p.color, bold: true, dim: false })
  }
  if (props.tip !== '') {
    const spot = [rows - 4, rows - 5, 1].find(row => isOpen(row, 1, props.tip.length))
    if (spot !== undefined) write(spot, 1, { text: props.tip, color: 'claude', bold: false, dim: false })
  }
  // What each crab does, a few words over its head, dim: Claude's work and each helper's.
  const label = (text: string, x: number, row: number, room: number) => {
    const shown = shortly(text, room)
    const col = clamp(Math.round(x / 2), 0, Math.max(0, columns - shown.length))
    // Over the head, or a row higher when the hoop or a word is in the way.
    const free = [row, row - 1].find(r => isOpen(r, col, shown.length))
    if (shown !== '' && free !== undefined) write(free, col, plain(shown))
  }
  if (props.claudeDoing !== '') label(props.claudeDoing, claude.x, Math.floor((pxTall - CLAUDE_H) / 2) - 1, 16)
  // A helper has six columns: its verb alone, short: 'reads', 'edits', 'runs'.
  for (const { helper, x } of spots) label(helper.isDone ? 'done' : verbOf(helper.doing), x, Math.floor((pxTall - 4) / 2) - 1, 6)
  if (!s.isTouched) {
    const hint = 'pull back from the ball'
    const spot = [1, rows - 3].find(row => isOpen(row, 3, hint.length))
    if (spot !== undefined) write(spot, 3, plain(hint))
  }
  const ballColor = BALL_COLORS[Math.min(BALL_COLORS.length - 1, Math.floor(props.tokens / GIFT_TOKENS))]!
  const ballRow = cells[clamp(Math.floor(ball.y / 2), 0, rows - 1)]!
  ballRow[clamp(Math.floor(ball.x / 2), 0, columns - 1)] = { ch: '●', fg: ballColor, bg: '', bold: true, dim: false }

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

export default Golf
