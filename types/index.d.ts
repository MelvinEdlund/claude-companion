/** A file Claude changed this session, with its latest change. */
export type FileEntry = {
  /** Path relative to the session's folder, with forward slashes. */
  path: string
  /** How many times Claude changed it this session. */
  count: number
  /** When it last changed, in $.clock.now() milliseconds. */
  at: number
  /** The tool that last changed it. */
  tool: string
  /** The latest change: '+' and '-' lines, and '@<line>' heading each hunk. */
  lines: string[]
  plus: number
  minus: number
}

/** A subagent at work. */
export type Helper = {
  /** The Agent call's tool_use_id. */
  id: string
  /** The subagent type it was started as (Explore, Plan, test-writer, ...). */
  kind: string
  /** The order it started in, for a color when its type has none of its own. */
  index: number
  /** The subagent's loop id, once its call returns or one of its tool calls is seen. */
  agentId?: string
  /** What it does now, in a few plain words ("Reading login.tsx"). */
  doing: string
  startedAt: number
  /** When it finished; it stays a short while, then goes. */
  doneAt?: number
}

/** Focused time on one day: the sum of the turns Claude worked. */
export type Focus = { day: string; ms: number }

/** A run of turns with no pause of ten minutes or more between them. */
export type Streak = { start: number; lastEnd: number }

/** Fresh tokens (input, cache writes, output) used: in all, and on `day` (the Focus day key). */
export type Tokens = { total: number; day: string; today: number }

export type Mood = 'idle' | 'thinking' | 'working' | 'needsYou' | 'happy' | 'sleeping'

declare module 'claude-code' {
  interface PluginState {
    'companion-kit': {
      files: Shaped<FileEntry[]>
      selected: Shaped<string>
      mood: Shaped<Mood>
      frame: Shaped<number>
      activity: Shaped<string>
      since: Shaped<number>
      turnStart: Shaped<number>
      helpers: Shaped<Helper[]>
      focus: Shaped<Focus>
      streak: Shaped<Streak>
      /** The best golf run, in points, kept across sessions in the store. */
      golfBest: Shaped<number>
      /** The best round of darts, in points, kept across sessions in the store. */
      dartBest: Shaped<number>
      /** The next step the last answer recommended, for Claude's tip bubble. */
      tip: Shaped<string>
      /** Every 100k tokens in all brings a new ball. */
      tokens: Shaped<Tokens>
      /** Experience by crab ('main' for Claude, a subagent's type for each helper), kept across sessions. */
      xp: Shaped<Record<string, number>>
    }
  }
}
