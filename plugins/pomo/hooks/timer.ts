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
  | { kind: 'focus-done'; id: string; at: number; lengthMs: number; intention: string; isFlow: boolean }
  | { kind: 'break-done'; at: number; isLong: boolean }

export const IDLE: Saved = { timer: { phase: 'idle' }, cycleDone: 0, cycleDay: '' }

export function newId(now: number): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** A flow block can run this long before it ends by itself. */
export const FLOW_CAP_MS = 180 * 60_000
/** A flow block shorter than this isn't counted. */
export const FLOW_MIN_MS = 5 * 60_000

/** Flowtime: a break of a fifth of the work, from 3 to 20 minutes. */
export function flowBreakMs(workedMs: number): number {
  const minutes = Math.min(20, Math.max(3, Math.round(workedMs / 60_000 / 5)))

  return minutes * 60_000
}

export type Preset = { focusMs: number; breakMs?: number; isFlow?: boolean }

function startBreak(saved: Saved, at: number, cfg: Config, intention: string, earned?: number): Saved {
  const isLong = earned === undefined && saved.cycleDone > 0 && saved.cycleDone % cfg.longEvery === 0
  const lengthMs = earned ?? (isLong ? cfg.longMs : cfg.shortMs)

  return {
    ...saved,
    timer: { phase: 'break', id: newId(at), endsAt: at + lengthMs, lengthMs, isLong, intention },
  }
}

export function startFocus(saved: Saved, at: number, cfg: Config, intention: string, preset?: Preset): Saved {
  const isFlow = preset?.isFlow === true
  const lengthMs = isFlow ? FLOW_CAP_MS : (preset?.focusMs ?? cfg.focusMs)

  return {
    ...saved,
    timer: {
      phase: 'focus',
      id: newId(at),
      endsAt: at + lengthMs,
      lengthMs,
      isLong: false,
      intention,
      ...(isFlow ? { isFlow: true } : {}),
      ...(preset?.breakMs === undefined ? {} : { breakMs: preset.breakMs }),
    },
  }
}

/** How long the focus block has run, paused time left out. */
export function elapsed(t: Timer, now: number): number {
  return t.phase === 'idle' ? 0 : Math.max(0, t.lengthMs - remaining(t, now))
}

/** Adds time to a running or paused block. */
export function extend(saved: Saved, ms: number): Saved {
  const t = saved.timer

  if (t.phase === 'focus' || t.phase === 'break') {
    return { ...saved, timer: { ...t, endsAt: t.endsAt + ms, lengthMs: t.lengthMs + ms } }
  }

  if (t.phase === 'paused') {
    return { ...saved, timer: { ...t, remainingMs: t.remainingMs + ms, lengthMs: t.lengthMs + ms } }
  }

  return saved
}

/**
 * Ends a flow block now: it counts if it ran long enough, and the break is a
 * fifth of the time worked.
 */
export function finishFlow(
  saved: Saved,
  now: number,
  cfg: Config,
  dayOf: (ms: number) => string,
): { saved: Saved; ended: Ended[] } {
  const t = saved.timer
  const isFlowFocus = (t.phase === 'focus' || (t.phase === 'paused' && t.of === 'focus')) && t.isFlow === true

  if (!isFlowFocus) {
    return { saved, ended: [] }
  }

  const worked = elapsed(t, now)

  if (worked < FLOW_MIN_MS) {
    return { saved: { ...saved, timer: { phase: 'idle' } }, ended: [] }
  }

  const day = dayOf(now)
  const cycleDone = (saved.cycleDay === day ? saved.cycleDone : 0) + 1
  const counted: Saved = { ...saved, cycleDone, cycleDay: day }

  return {
    saved: startBreak(counted, now, cfg, t.intention, flowBreakMs(worked)),
    ended: [{ kind: 'focus-done', id: t.id, at: now, lengthMs: worked, intention: t.intention, isFlow: true }],
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
      const isFlow = t.isFlow === true
      ended.push({ kind: 'focus-done', id: t.id, at: t.endsAt, lengthMs: t.lengthMs, intention: t.intention, isFlow })
      saved = { ...saved, cycleDone, cycleDay: day }
      const earned = isFlow ? flowBreakMs(t.lengthMs) : t.breakMs
      saved = cfg.autoBreaks || isFlow
        ? startBreak(saved, t.endsAt, cfg, t.intention, earned)
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
      ...(t.isFlow === true ? { isFlow: true } : {}),
      ...(t.breakMs === undefined ? {} : { breakMs: t.breakMs }),
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
      ...(t.isFlow === true ? { isFlow: true } : {}),
      ...(t.breakMs === undefined ? {} : { breakMs: t.breakMs }),
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
