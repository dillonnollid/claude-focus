export type Phase = 'focus' | 'break'

export type Running = {
  phase: Phase
  id: string
  endsAt: number
  lengthMs: number
  isLong: boolean
  intention: string
}

export type Paused = {
  phase: 'paused'
  of: Phase
  id: string
  remainingMs: number
  lengthMs: number
  isLong: boolean
  intention: string
}

export type Idle = { phase: 'idle' }

export type Timer = Idle | Running | Paused

/** What the band draws: a snapshot the module refreshes on its tick. */
export type View = {
  timer: Timer
  /** Blocks finished since the last long break. */
  cycleDone: number
  /** Focus blocks finished today. */
  today: number
  /** When the snapshot was taken, for the time left. */
  now: number
  /** The last seven days, oldest first. */
  week: { label: string; count: number; isToday: boolean }[]
  /** One line on where finished blocks are logged. */
  logLine: string
}

declare module 'claude-code' {
  interface PluginState {
    'ember-focus': { view: Shaped<View | null> }
  }
}
