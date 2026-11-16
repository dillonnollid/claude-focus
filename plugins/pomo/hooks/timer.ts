// The timer as plain data and pure functions: no `$`, so tests drive it with
// numbers. Every running block stores the wall-clock time it ends, never a
// countdown, so a reload, a restart or a second open session all agree on
// how long is left.

import type { Phase, Timer } from '../types'

export type { Phase, Timer }

/** What the store keeps: the timer, and how far through the set of rounds. */
export type Saved = {
  timer: Timer
  /** Focus blocks finished since the last long break. */
  cycleDone: number
  /** The day `cycleDone` belongs to; a new day starts a fresh set. */
  cycleDay: string
}

export type Config = {
  focusMs: number
  shortMs: number
  longMs: number
  longEvery: number
  autoBreaks: boolean
  autoFocus: boolean
}

export type Ended =
  | { kind: 'focus-done'; id: string; at: number; lengthMs: number; intention: string }
  | { kind: 'break-done'; at: number; isLong: boolean }

export const IDLE: Saved = { timer: { phase: 'idle' }, cycleDone: 0, cycleDay: '' }

export function newId(now: number): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function startBreak(saved: Saved, at: number, cfg: Config, intention: string): Saved {
  const isLong = saved.cycleDone > 0 && saved.cycleDone % cfg.longEvery === 0
  const lengthMs = isLong ? cfg.longMs : cfg.shortMs

  return {
    ...saved,
    timer: { phase: 'break', id: newId(at), endsAt: at + lengthMs, lengthMs, isLong, intention },
  }
}

export function startFocus(saved: Saved, at: number, cfg: Config, intention: string): Saved {
  return {
    ...saved,
    timer: {
      phase: 'focus',
      id: newId(at),
      endsAt: at + cfg.focusMs,
      lengthMs: cfg.focusMs,
      isLong: false,
      intention,
    },
  }
}

/**
 * Moves the timer past every block that has ended by `now`, in order, and
 * says what ended. Run it before reading or changing the timer: a block that
 * ended while the app was closed is settled the moment it opens again.
 */
export function settle(
  start: Saved,
  now: number,
  cfg: Config,
  dayOf: (ms: number) => string,
): { saved: Saved; ended: Ended[] } {
  let saved = start
  const ended: Ended[] = []

  // A handful of steps at most; the bound only guards against a bad config.
  for (let step = 0; step < 16; step += 1) {
    const t = saved.timer

    if (t.phase !== 'focus' && t.phase !== 'break') {
      break
    }

    if (t.endsAt > now) {
      break
    }

    if (t.phase === 'focus') {
      const day = dayOf(t.endsAt)
      const cycleDone = (saved.cycleDay === day ? saved.cycleDone : 0) + 1
      ended.push({ kind: 'focus-done', id: t.id, at: t.endsAt, lengthMs: t.lengthMs, intention: t.intention })
      saved = { ...saved, cycleDone, cycleDay: day }
      saved = cfg.autoBreaks
        ? startBreak(saved, t.endsAt, cfg, t.intention)
        : { ...saved, timer: { phase: 'idle' } }
    } else {
      ended.push({ kind: 'break-done', at: t.endsAt, isLong: t.isLong })
      const cycleDone = t.isLong ? 0 : saved.cycleDone
      saved = { ...saved, cycleDone }
      saved = cfg.autoFocus
        ? startFocus(saved, t.endsAt, cfg, t.intention)
        : { ...saved, timer: { phase: 'idle' } }
    }
  }

  return { saved, ended }
}

export function pause(saved: Saved, now: number): Saved {
  const t = saved.timer

  if (t.phase !== 'focus' && t.phase !== 'break') {
    return saved
  }

  return {
    ...saved,
    timer: {
      phase: 'paused',
      of: t.phase,
      id: t.id,
      remainingMs: Math.max(0, t.endsAt - now),
      lengthMs: t.lengthMs,
      isLong: t.isLong,
      intention: t.intention,
    },
  }
}

export function resume(saved: Saved, now: number): Saved {
  const t = saved.timer

  if (t.phase !== 'paused') {
    return saved
  }

  return {
    ...saved,
    timer: {
      phase: t.of,
      id: t.id,
      endsAt: now + t.remainingMs,
      lengthMs: t.lengthMs,
      isLong: t.isLong,
      intention: t.intention,
    },
  }
}

/** Milliseconds left in the block, or 0 when nothing runs. */
export function remaining(t: Timer, now: number): number {
  if (t.phase === 'paused') {
    return t.remainingMs
  }

  if (t.phase === 'focus' || t.phase === 'break') {
    return Math.max(0, t.endsAt - now)
  }

  return 0
}

/** "18 min", "< 1 min", or "17:42" with seconds on. */
export function formatLeft(ms: number, showSeconds: boolean): string {
  if (showSeconds) {
    const total = Math.ceil(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60

    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (ms < 60_000) {
    return '< 1 min'
  }

  return `${Math.ceil(ms / 60_000)} min`
}

/** `●●○○`: rounds done in this set, out of the set's length. */
export function dots(done: number, every: number): string {
  const inSet = done % every === 0 && done > 0 ? every : done % every

  return '●'.repeat(inSet) + '○'.repeat(Math.max(0, every - inSet))
}
