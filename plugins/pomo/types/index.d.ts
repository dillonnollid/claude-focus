export type Phase = 'focus' | 'break'

export type Running = {
  phase: Phase
  id: string
  endsAt: number
  lengthMs: number
  isLong: boolean
  intention: string
  /** A flow block: no set end, you stop it, and the break scales with it. */
  isFlow?: boolean
  /** The break this block earns, when it isn't the usual one (a 50 minute block). */
  breakMs?: number
}

export type Paused = {
  phase: 'paused'
  of: Phase
  id: string
  remainingMs: number
  lengthMs: number
  isLong: boolean
  intention: string
  isFlow?: boolean
  breakMs?: number
}

export type Idle = { phase: 'idle' }

export type Timer = Idle | Running | Paused

/** A thought parked during a block, to deal with at the break. */
export type Parked = { id: string; text: string; at: number; day: string; isDone: boolean }

/** What the dashboard and the band draw: a snapshot the module refreshes. */
export type View = {
  timer: Timer
  /** Blocks finished since the last long break. */
  cycleDone: number
  /** Focus blocks finished today. */
  today: number
  /** Minutes of focus finished today. */
  todayMinutes: number
  /** Days in a row with at least one finished block. */
  streak: number
  /** Today's check-ins: did it, partly, got distracted. */
  quality: [number, number, number]
  /** When the snapshot was taken, for the time left. */
  now: number
  /** Goes up when the clock jumped (the computer slept), so the ring is drawn afresh. */
  epoch: number
  /** The last seven days, oldest first. */
  week: { label: string; count: number; isToday: boolean }[]
  /** One line on where finished blocks are logged. */
  logLine: string
  /** The vault's folder name, or empty when blocks aren't being logged. */
  vaultName: string
  /** True when no vault was found and the dashboard should ask for one. */
  needsVault: boolean
  /** The noise bed chosen in this session. */
  noise: 'off' | 'brown' | 'pink' | 'white'
  /** The block waiting for its check-in, if any. */
  checkIn: { id: string; intention: string } | null
  /** Thoughts parked and not yet dealt with, newest last. */
  parked: Parked[]
  /** What the focus switch is doing, or empty when it's off. */
  switchLine: string
}

declare module 'claude-code' {
  interface PluginState {
    'pomo': { view: Shaped<View | null> }
  }
}
