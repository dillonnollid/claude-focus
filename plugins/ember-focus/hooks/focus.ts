// The pomodoro itself: settling the timer against the clock, counting
// finished blocks once, chiming, logging to the vault and answering /pomo.
// It reaches the engine only through `Io`, which register.tsx builds over
// `$`, so a test can hand it a fake clock and store.

import type { View } from '../types'
import { IDLE, formatLeft, pause, remaining, resume, settle, startFocus } from './timer'
import type { Config, Ended, Saved, Timer } from './timer'
import { addToProperty, dayKey, dayOf, notePath, parseDailyNotes, parseDayKey } from './vault'
import type { DailyNotes } from './vault'

export type Cancel = { cancel: () => void }

export type Io = {
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  home: () => Promise<string | undefined>
  isCloud: () => Promise<boolean>
  toast: (text: string, timeoutMs: number) => void
  notify: (text: string) => void
  play: (asset: string, gain: number) => void
  after: (ms: number, fn: () => void) => Cancel
  every: (ms: number, fn: () => void) => Cancel
  publish: (view: View) => Promise<void>
}

export type Settings = Config & {
  goal: number
  sound: boolean
  gain: number
  showSeconds: boolean
  showWhenIdle: boolean
  vaultPath: string
  property: string
  unit: 'minutes' | 'sessions'
  timeZone: string
}

type Options = Readonly<Record<string, string | number | boolean | readonly string[]>>

const MIN = 60_000
// A block that ended this long before anything saw it ended while the app
// was closed: it still counts, but it doesn't chime at you.
const LATE_MS = 2 * MIN
const KEEP_DAYS = 120

function num(o: Options, key: string, fallback: number, min: number, max: number): number {
  const v = Number(o[key])

  return o[key] !== '' && Number.isFinite(v) && v >= min && v <= max ? v : fallback
}

function bool(o: Options, key: string, fallback: boolean): boolean {
  const v = o[key]

  return typeof v === 'boolean' ? v : fallback
}

function str(o: Options, key: string, fallback: string): string {
  const v = o[key]

  return typeof v === 'string' ? v.trim() : fallback
}

export function settingsFrom(o: Options): Settings {
  return {
    focusMs: num(o, 'focusMinutes', 25, 1, 180) * MIN,
    shortMs: num(o, 'shortBreakMinutes', 5, 1, 60) * MIN,
    longMs: num(o, 'longBreakMinutes', 15, 1, 120) * MIN,
    longEvery: Math.round(num(o, 'longBreakEvery', 4, 1, 12)),
    autoBreaks: bool(o, 'autoStartBreaks', true),
    autoFocus: bool(o, 'autoStartFocus', false),
    goal: Math.round(num(o, 'dailyGoal', 8, 0, 48)),
    sound: bool(o, 'sound', true),
    gain: num(o, 'volume', 0.6, 0, 1),
    showSeconds: bool(o, 'showSeconds', false),
    showWhenIdle: bool(o, 'showWhenIdle', true),
    vaultPath: str(o, 'vaultPath', ''),
    property: str(o, 'vaultProperty', 'deep_work_mins') || 'deep_work_mins',
    unit: str(o, 'vaultUnit', 'minutes') === 'sessions' ? 'sessions' : 'minutes',
    timeZone: str(o, 'timeZone', ''),
  }
}

// Every store read is checked: a value an older version wrote, or a hand
// edit, falls back to empty instead of breaking the timer.

function isTimer(v: unknown): v is Timer {
  if (v === null || typeof v !== 'object') {
    return false
  }

  const t = v as Record<string, unknown>

  if (t.phase === 'idle') {
    return true
  }

  const common = typeof t.id === 'string' && typeof t.lengthMs === 'number' && typeof t.intention === 'string'

  if (t.phase === 'focus' || t.phase === 'break') {
    return common && typeof t.endsAt === 'number'
  }

  return t.phase === 'paused' && common && typeof t.remainingMs === 'number'
}

function prune(days: Record<string, number>, todayKey: string, keep: number): Record<string, number> {
  const t = parseDayKey(todayKey)
  const cutoff = Date.UTC(t.y, t.m - 1, t.d) - keep * 86_400_000

  return Object.fromEntries(
    Object.entries(days).filter(([k]) => {
      const d = parseDayKey(k)

      return Date.UTC(d.y, d.m - 1, d.d) >= cutoff
    }),
  )
}

export type Vault = { root: string; notes: DailyNotes } | { root: null; why: string }

function joinPath(a: string, b: string): string {
  return `${a.replace(/[\\/]+$/, '')}/${b}`
}

function parentOf(path: string): string | undefined {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))

  return cut <= 0 ? undefined : trimmed.slice(0, cut)
}

export function createFocus(io: Io, s: Settings, cwd: string) {
  const dayKeyOf = (ms: number) => dayKey(dayOf(ms, s.timeZone))
  let vault: Vault | undefined
  let endTimer: Cancel | undefined
  let tick: (Cancel & { ms: number }) | undefined
  let chain: Promise<unknown> = Promise.resolve()
  // The last snapshot drawn, so the per-second tick only moves the clock.
  let shown: View | undefined
  let ticks = 0

  // One change to the timer at a time, so a tick and a button press can't
  // both count the same block.
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => undefined)

    return run
  }

  const loadSaved = async (): Promise<Saved> => {
    const v = (await io.get('timer')) as Partial<Saved> | undefined

    if (v === undefined || v === null || !isTimer(v.timer)) {
      return IDLE
    }

    return {
      timer: v.timer,
      cycleDone: typeof v.cycleDone === 'number' ? v.cycleDone : 0,
      cycleDay: typeof v.cycleDay === 'string' ? v.cycleDay : '',
    }
  }

  const loadRecord = async (key: 'days' | 'pending'): Promise<Record<string, number>> => {
    const v = await io.get(key)
    const out: Record<string, number> = {}

    if (v !== null && typeof v === 'object') {
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof n === 'number' && Number.isFinite(n)) {
          out[k] = n
        }
      }
    }

    return out
  }

  const loadDone = async (): Promise<string[]> => {
    const v = await io.get('done')

    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }

  const findVault = async (): Promise<Vault> => {
    if (s.vaultPath.toLowerCase() === 'off') {
      return { root: null, why: 'vault logging is off' }
    }

    let root: string | undefined

    if (s.vaultPath !== '') {
      const home = (await io.home()) ?? ''
      const given = s.vaultPath.replace(/^~(?=$|[\\/])/, home)

      if (!(await io.exists(joinPath(given, '.obsidian')))) {
        return { root: null, why: `there is no Obsidian vault at ${given}` }
      }

      root = given
    } else {
      // A cloud session's folder is a fresh clone: a note written there never
      // reaches the vault you open, so don't pretend it did.
      if (await io.isCloud()) {
        return { root: null, why: 'this is a cloud session, and its copy of the vault is temporary' }
      }

      for (let dir: string | undefined = cwd, up = 0; dir !== undefined && up < 6; dir = parentOf(dir), up += 1) {
        if (await io.exists(joinPath(dir, '.obsidian'))) {
          root = dir
          break
        }
      }

      if (root === undefined) {
        return { root: null, why: 'this session is not inside a vault (set "Obsidian vault" in /config to log from anywhere)' }
      }
    }

    const json = await io.read(joinPath(root, '.obsidian/daily-notes.json')).catch(() => undefined)

    return { root, notes: parseDailyNotes(json) }
  }

  const getVault = async (): Promise<Vault> => {
    vault ??= await findVault().catch((error: unknown): Vault => ({ root: null, why: `the vault check failed (${String(error)})` }))

    return vault
  }

  /** Writes what's owed to each day's note; a day whose note isn't there yet waits. */
  const flushVault = async (): Promise<void> => {
    const v = await getVault()

    if (v.root === null) {
      return
    }

    const pending = await loadRecord('pending')

    for (const [key, amount] of Object.entries(pending)) {
      const rel = notePath(v.notes, parseDayKey(key))

      if (rel === undefined) {
        continue
      }

      const path = joinPath(v.root, rel)
      const text = await io.read(path).catch(() => undefined)
      const next = text === undefined ? undefined : addToProperty(text, s.property, amount)

      if (next === undefined) {
        continue
      }

      await io.write(path, next)
      delete pending[key]
    }

    await io.set('pending', prune(pending, dayKeyOf(await io.now()), 14))
  }

  const chime = (asset: string) => {
    if (s.sound && s.gain > 0) {
      io.play(asset, s.gain)
    }
  }

  /** Counts a finished focus block once, however many sessions saw it end. */
  const recordFocus = async (ended: Extract<Ended, { kind: 'focus-done' }>, isLate: boolean, after: Saved) => {
    const done = await loadDone()

    if (done.includes(ended.id)) {
      return
    }

    await io.set('done', [...done, ended.id].slice(-200))

    const key = dayKeyOf(ended.at)
    const days = await loadRecord('days')
    const today = (days[key] ?? 0) + 1
    days[key] = today
    await io.set('days', prune(days, key, KEEP_DAYS))

    const pending = await loadRecord('pending')
    pending[key] = (pending[key] ?? 0) + (s.unit === 'sessions' ? 1 : Math.round(ended.lengthMs / MIN))
    await io.set('pending', pending)
    await flushVault().catch(() => undefined)

    if (isLate) {
      return
    }

    const breakMin = Math.round((after.timer.phase === 'break' ? after.timer.lengthMs : s.shortMs) / MIN)
    const goal = s.goal > 0 && today === s.goal ? ` That's your ${s.goal} for today.` : ''
    const rest = s.autoBreaks
      ? ` ${breakMin} min break. Stand up, get some water, look at something far away.`
      : ' Take a break when you are ready.'

    chime('sounds/focus-done.wav')
    io.toast(`Focus block done, ${today} today.${goal}${rest}`, 12_000)
    io.notify(`Focus block done, ${today} today.`)
  }

  const weekOf = (days: Record<string, number>, now: number) => {
    const today = dayOf(now, s.timeZone)
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const rows: { label: string; count: number; isToday: boolean }[] = []

    for (let back = 6; back >= 0; back -= 1) {
      const at = new Date(Date.UTC(today.y, today.m - 1, today.d) - back * 86_400_000)
      const count = days[dayKey({ y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() })] ?? 0
      const label = `${names[at.getUTCDay()]} ${at.getUTCDate()} ${months[at.getUTCMonth()]}`
      rows.push({ label, count, isToday: back === 0 })
    }

    return rows
  }

  const logLine = async (): Promise<string> => {
    const v = await getVault()
    const per = s.unit === 'sessions' ? '1' : String(Math.round(s.focusMs / MIN))

    return v.root === null
      ? `Not logging to a vault, because ${v.why}.`
      : `Each block adds ${per} to ${s.property} in today's note in ${joinPath(v.root, v.notes.folder || '.')}.`
  }

  const publish = async (saved: Saved, now: number) => {
    const days = await loadRecord('days')
    const todayKey = dayKeyOf(now)

    shown = {
      timer: saved.timer,
      cycleDone: saved.cycleDay === todayKey ? saved.cycleDone : 0,
      today: days[todayKey] ?? 0,
      now,
      week: weekOf(days, now),
      logLine: await logLine(),
    }
    await io.publish(shown)
  }

  /**
   * The per-second tick: moves the countdown on from the last snapshot, and
   * every fifteenth second reads the store again, which also picks up a
   * timer another open session changed. A block's end has its own timer.
   */
  const onTick = () => {
    ticks += 1

    if (shown === undefined || ticks % 15 === 0) {
      void sync()

      return
    }

    const last = shown
    void locked(async () => {
      if (shown !== last) {
        return
      }

      shown = { ...last, now: await io.now() }
      await io.publish(shown)
    })
  }

  const schedule = (saved: Saved, now: number) => {
    endTimer?.cancel()
    endTimer = undefined
    const t = saved.timer
    const isRunning = t.phase === 'focus' || t.phase === 'break'

    if (isRunning) {
      endTimer = io.after(Math.max(0, t.endsAt - now) + 200, () => {
        void sync()
      })
    }

    // A second while running, so the dashboard counts down live; the slow
    // idle tick picks up a timer started from another open session.
    const ms = isRunning ? 1000 : 30_000

    if (tick?.ms !== ms) {
      tick?.cancel()
      tick = { ...io.every(ms, onTick), ms }
    }
  }

  /** Settles the timer against the clock, counts and chimes what ended, redraws. */
  const sync = () =>
    locked(async () => {
      const now = await io.now()
      const { saved, ended } = settle(await loadSaved(), now, s, dayKeyOf)

      if (ended.length > 0) {
        await io.set('timer', saved)
      }

      for (const one of ended) {
        const isLate = now - one.at > LATE_MS

        if (one.kind === 'focus-done') {
          await recordFocus(one, isLate, saved)
        } else if (!isLate) {
          chime('sounds/break-done.wav')
          io.toast(
            s.autoFocus
              ? 'Break is over. The next focus block has started.'
              : 'Break is over. Start the next block when you are ready.',
            10_000,
          )
        }
      }

      await publish(saved, now)
      schedule(saved, now)

      return saved
    })

  /** Runs one change against the settled timer, then saves and redraws. */
  const change = (fn: (saved: Saved, now: number) => { saved: Saved; text: string }) =>
    sync().then(() =>
      locked(async () => {
        const now = await io.now()
        const { saved, text } = fn(await loadSaved(), now)
        await io.set('timer', saved)
        await publish(saved, now)
        schedule(saved, now)

        return text
      }),
    )

  const start = (intention: string) =>
    change((saved, now) => {
      const t = saved.timer

      if (t.phase === 'focus') {
        return intention === ''
          ? { saved, text: `Already focusing, ${formatLeft(remaining(t, now), false)} left.` }
          : { saved: { ...saved, timer: { ...t, intention } }, text: `Now working on ${intention}.` }
      }

      if (t.phase === 'paused' && intention === '') {
        return { saved: resume(saved, now), text: 'Resumed.' }
      }

      const what = intention === '' ? '' : ` on ${intention}`

      return {
        saved: startFocus(saved, now, s, intention),
        text: `Focus${what} for ${Math.round(s.focusMs / MIN)} min. Phone out of reach, one window, one thing.`,
      }
    })

  const pauseIt = () =>
    change((saved, now) =>
      saved.timer.phase === 'focus' || saved.timer.phase === 'break'
        ? { saved: pause(saved, now), text: `Paused with ${formatLeft(remaining(saved.timer, now), false)} left.` }
        : { saved, text: 'Nothing is running.' },
    )

  const resumeIt = () =>
    change((saved, now) =>
      saved.timer.phase === 'paused'
        ? { saved: resume(saved, now), text: 'Resumed.' }
        : { saved, text: 'Nothing is paused.' },
    )

  const stop = () =>
    change(saved => {
      const t = saved.timer

      if (t.phase === 'idle') {
        return { saved, text: 'Nothing is running.' }
      }

      const wasFocus = t.phase === 'focus' || (t.phase === 'paused' && t.of === 'focus')

      return {
        saved: { ...saved, timer: { phase: 'idle' } },
        text: wasFocus ? 'Stopped. An unfinished block is not counted.' : 'Break ended.',
      }
    })

  const skip = () =>
    change((saved, now) => {
      const t = saved.timer
      const isBreak = t.phase === 'break' || (t.phase === 'paused' && t.of === 'break')

      if (!isBreak) {
        return { saved, text: 'Skip ends a break. To abandon a focus block, use /pomo stop.' }
      }

      const next = { ...saved, cycleDone: t.isLong ? 0 : saved.cycleDone }

      return s.autoFocus
        ? { saved: startFocus(next, now, s, t.intention), text: 'Break skipped. Focus block started.' }
        : { saved: { ...next, timer: { phase: 'idle' } }, text: 'Break skipped.' }
    })

  const stats = async (): Promise<string> => {
    const now = await io.now()
    const days = await loadRecord('days')
    const mins = Math.round(s.focusMs / MIN)
    const week = weekOf(days, now)
    const total = week.reduce((sum, d) => sum + d.count, 0)
    const rows = week.map(d => `${d.label.padEnd(10)} ${d.count.toString().padStart(2)}  ${'●'.repeat(Math.min(d.count, 16))}`)
    const v = await getVault()
    const waiting = Object.keys(await loadRecord('pending')).length
    const wait = waiting > 0 && v.root !== null ? `\n${waiting} day(s) wait for their daily note to exist, and are written once it does.` : ''
    const goal = s.goal > 0 ? ` of ${s.goal}` : ''
    const today = week[week.length - 1]?.count ?? 0

    return [
      `Focus blocks, last 7 days (${mins} min each)`,
      '',
      ...rows,
      '',
      `This week ${total} blocks, ${Math.floor((total * mins) / 60)} h ${(total * mins) % 60} min. Today ${today}${goal}.`,
      (await logLine()) + wait,
    ].join('\n')
  }

  const command = async (args: string): Promise<string> => {
    const word = args.trim().toLowerCase()

    switch (word) {
      case 'pause':
        return pauseIt()
      case 'resume':
        return resumeIt()
      case 'stop':
      case 'cancel':
        return stop()
      case 'skip':
        return skip()
      case 'stats':
        return stats()
      case 'start':
        return start('')
      case 'help':
        return [
          '/pomo                             open the focus dashboard',
          '/pomo start | <what you are on>   start a focus block, or resume a paused one',
          '/pomo pause | resume | stop       stop abandons the block, and it is not counted',
          '/pomo skip                        end a break early',
          '/pomo stats                       the last 7 days, and where blocks are logged',
        ].join('\n')
      default:
        return start(args.trim().replace(/^start\s+/i, ''))
    }
  }

  const begin = async () => {
    await sync()
    await flushVault().catch(() => undefined)
  }

  const end = () => {
    endTimer?.cancel()
    tick?.cancel()
    endTimer = undefined
    tick = undefined
  }

  return { begin, end, sync, command, start, pause: pauseIt, resume: resumeIt, stop, skip, stats }
}

export type Focus = ReturnType<typeof createFocus>
