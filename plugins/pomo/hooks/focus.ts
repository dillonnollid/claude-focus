// The pomodoro itself: settling the timer against the clock, counting
// finished blocks once, chimes and noise, the focus switch, the parking lot,
// check-ins, logging to the vault, and answering /pomo and /park.
// It reaches the engine only through `Io`, which register.tsx builds over
// `$`, so a test can hand it a fake clock, store and shell.

import type { Parked, View } from '../types'
import { IDLE, elapsed, extend, finishFlow, formatLeft, pause, remaining, resume, settle, startFocus } from './timer'
import type { Config, Ended, Preset, Saved, Timer } from './timer'
import { addToProperty, addUnderHeading, dayKey, dayOf, notePath, obsidianVaults, parseDailyNotes, parseDayKey } from './vault'
import type { DailyNotes } from './vault'

export type Cancel = { cancel: () => void }

export type RunResult = { exitCode: number; stdout: string }

export type Io = {
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  home: () => Promise<string | undefined>
  /** The folder the session is in now, which can move after it starts. */
  cwd: () => Promise<string>
  /** Puts text in the prompt box as a draft; false where there is no box. */
  fill: (text: string) => Promise<boolean>
  isCloud: () => Promise<boolean>
  /** Runs a command on this computer by its argument vector. */
  run: (argv: readonly string[]) => Promise<RunResult>
  toast: (text: string, timeoutMs: number) => void
  notify: (text: string) => void
  play: (asset: string, gain: number) => void
  /** Starts a clip on a loop; the function it answers stops it. */
  loop: (asset: string, gain: number) => () => void
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
  noiseGain: number
  noiseQuietInBreaks: boolean
  focusSwitch: 'auto' | 'off'
  fullscreen: boolean
  startCommand: string
  endCommand: string
  keepOnTask: boolean
  parkToVault: boolean
  parkHeading: string
}

export type Noise = 'off' | 'brown' | 'pink' | 'white'

export const NOISES: readonly Noise[] = ['off', 'brown', 'pink', 'white']

export type PresetName = 'pomodoro' | 'long' | 'flow'

export type CheckIn = 'did' | 'partly' | 'distracted'

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
    noiseGain: num(o, 'noiseVolume', 0.8, 0, 1),
    noiseQuietInBreaks: bool(o, 'noiseQuietInBreaks', true),
    focusSwitch: str(o, 'focusSwitch', 'auto') === 'off' ? 'off' : 'auto',
    fullscreen: bool(o, 'fullscreen', false),
    startCommand: str(o, 'focusStartCommand', ''),
    endCommand: str(o, 'focusEndCommand', ''),
    keepOnTask: bool(o, 'keepClaudeOnTask', true),
    parkToVault: bool(o, 'parkToVault', true),
    parkHeading: str(o, 'parkHeading', 'Parked') || 'Parked',
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

function prune<T>(days: Record<string, T>, todayKey: string, keep: number): Record<string, T> {
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

function shiftDay(key: string, by: number): string {
  const d = parseDayKey(key)
  const at = new Date(Date.UTC(d.y, d.m - 1, d.d) + by * 86_400_000)

  return dayKey({ y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() })
}

/** The commands the focus switch runs, worked out once per session. */
type SwitchPlan = {
  /** The desktop's do-not-disturb, when pomo found one it can drive; `isOn` asks whether it is on already. */
  quiet?: { on: string[][]; off: string[][]; isOn?: string[] }
  /** The person's own start and end commands. */
  custom: { on: string[][]; off: string[][] }
  canFullscreen: boolean
}

/** What the switch has done for the block that's running, kept in the store. */
type SwitchState = { on?: boolean; quieted?: boolean; address?: string }

const isFocusing = (t: Timer) => t.phase === 'focus'

export function createFocus(io: Io, s: Settings) {
  const dayKeyOf = (ms: number) => dayKey(dayOf(ms, s.timeZone))
  let plan: SwitchPlan | undefined
  let endTimer: Cancel | undefined
  let tick: (Cancel & { ms: number }) | undefined
  let chain: Promise<unknown> = Promise.resolve()
  let shown: View | undefined
  let drawn = ''
  // Noise belongs to this session alone, so two open sessions never play
  // two beds over each other.
  let noise: Noise = 'off'
  let playing: { kind: Noise; stop: () => void } | undefined

  const applyNoise = (t: Timer) => {
    const isResting = t.phase === 'break' || t.phase === 'paused'
    const want = noise !== 'off' && s.noiseGain > 0 && !(s.noiseQuietInBreaks && isResting) ? noise : 'off'

    if (playing?.kind === want) {
      return
    }

    playing?.stop()
    playing = want === 'off' ? undefined : { kind: want, stop: io.loop(`sounds/noise-${want}.wav`, s.noiseGain) }
  }

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

  const loadRecord = async (key: 'days' | 'minutes' | 'pending'): Promise<Record<string, number>> => {
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

  const loadQuality = async (): Promise<Record<string, [number, number, number]>> => {
    const v = await io.get('quality')
    const out: Record<string, [number, number, number]> = {}

    if (v !== null && typeof v === 'object') {
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        if (Array.isArray(n) && n.length === 3 && n.every(x => typeof x === 'number')) {
          out[k] = [n[0] as number, n[1] as number, n[2] as number]
        }
      }
    }

    return out
  }

  const loadParked = async (): Promise<Parked[]> => {
    const v = await io.get('parked')

    return Array.isArray(v)
      ? v.filter(
          (p): p is Parked =>
            p !== null && typeof p === 'object' && typeof p.id === 'string' && typeof p.text === 'string' && typeof p.day === 'string',
        )
      : []
  }

  const loadDone = async (): Promise<string[]> => {
    const v = await io.get('done')

    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }

  const hasVault = (dir: string) => io.exists(joinPath(dir, '.obsidian'))

  /** Where Obsidian itself says its vaults are, the open one first. */
  const knownVaults = async (home: string): Promise<string[]> => {
    // ponytail: Linux and macOS only; read %APPDATA%\obsidian when someone on Windows asks.
    const lists = [
      '.config/obsidian/obsidian.json',
      '.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json',
      'snap/obsidian/current/.config/obsidian/obsidian.json',
      'Library/Application Support/obsidian/obsidian.json',
    ]

    for (const list of lists) {
      const path = joinPath(home, list)
      const found = (await io.exists(path).catch(() => false)) ? obsidianVaults(await io.read(path).catch(() => undefined)) : []

      if (found.length > 0) {
        return found
      }
    }

    return []
  }

  // Looked up fresh each time: the app can start a session in a spare folder
  // and move it, and a vault can be set from the dashboard at any moment.
  const findVault = async (): Promise<Vault> => {
    if (s.vaultPath.toLowerCase() === 'off') {
      return { root: null, why: 'vault logging is off' }
    }

    const home = (await io.home()) ?? ''
    const saved = await io.get('vaultPath')
    const chosen = s.vaultPath !== '' ? s.vaultPath : typeof saved === 'string' ? saved : ''
    let root: string | undefined

    if (chosen !== '') {
      const given = chosen.replace(/^~(?=$|[\\/])/, home)

      if (!(await hasVault(given))) {
        return { root: null, why: `there is no Obsidian vault at ${given}` }
      }

      root = given
    } else {
      // A cloud session's folder is a fresh clone: a note written there never
      // reaches the vault you open, so don't pretend it did.
      if (await io.isCloud()) {
        return { root: null, why: 'this is a cloud session, and its copy of the vault is temporary' }
      }

      const cwd = await io.cwd().catch(() => undefined)

      for (let dir = cwd, up = 0; dir !== undefined && up < 6; dir = parentOf(dir), up += 1) {
        if (await hasVault(dir)) {
          root = dir
          break
        }
      }

      if (root === undefined && home !== '') {
        for (const dir of await knownVaults(home)) {
          if (await hasVault(dir)) {
            root = dir
            break
          }
        }
      }

      if (root === undefined) {
        return { root: null, why: 'no vault found on this computer' }
      }
    }

    const json = await io.read(joinPath(root, '.obsidian/daily-notes.json')).catch(() => undefined)

    return { root, notes: parseDailyNotes(json) }
  }

  const getVault = (): Promise<Vault> =>
    findVault().catch((error: unknown): Vault => ({ root: null, why: `the vault check failed (${String(error)})` }))

  /** Writes what's owed to each day's note; a day whose note isn't there yet waits. */
  const flushVault = async (): Promise<void> => {
    const pending = await loadRecord('pending')
    const parkQueue = ((await io.get('parkQueue')) ?? {}) as Record<string, unknown>
    const days = new Set([...Object.keys(pending), ...Object.keys(parkQueue)])

    if (days.size === 0) {
      return
    }

    const v = await getVault()

    if (v.root === null) {
      return
    }

    for (const key of days) {
      const rel = notePath(v.notes, parseDayKey(key))

      if (rel === undefined) {
        continue
      }

      const path = joinPath(v.root, rel)
      let text = await io.read(path).catch(() => undefined)

      if (text === undefined) {
        continue
      }

      const amount = pending[key]

      if (amount !== undefined) {
        const next = addToProperty(text, s.property, amount)

        if (next !== undefined) {
          text = next
          delete pending[key]
        }
      }

      const lines = parkQueue[key]

      if (Array.isArray(lines)) {
        for (const line of lines) {
          if (typeof line === 'string') {
            text = addUnderHeading(text, s.parkHeading, line)
          }
        }

        delete parkQueue[key]
      }

      await io.write(path, text)
    }

    const todayKey = dayKeyOf(await io.now())
    await io.set('pending', prune(pending, todayKey, 14))
    await io.set('parkQueue', prune(parkQueue, todayKey, 14))
  }

  const chime = (asset: string) => {
    if (s.sound && s.gain > 0) {
      io.play(asset, s.gain)
    }
  }

  // The focus switch: Do Not Disturb, and optionally fullscreen, for the
  // length of a focus block. Worked out once from what this computer has.
  const has = async (tool: string) => (await io.run(['sh', '-c', `command -v ${tool}`]).catch(() => ({ exitCode: 1, stdout: '' }))).exitCode === 0

  const stdoutOf = async (argv: string[]) => (await io.run(argv).catch(() => ({ exitCode: 1, stdout: '' }))).stdout.trim()

  /** The notification daemon on this computer that pomo knows how to quiet, if any. */
  const findQuiet = async (): Promise<SwitchPlan['quiet']> => {
    // Omarchy's own shell draws its notifications now; mako was its daemon before.
    if ((await has('omarchy-shell')) && (await stdoutOf(['omarchy-shell', 'notifications', 'ping'])) === 'ok') {
      const refresh = ['omarchy-shell', '-q', 'omarchy.indicators', 'refresh']

      return {
        on: [['omarchy-shell', 'notifications', 'setDnd', 'on'], refresh],
        off: [['omarchy-shell', 'notifications', 'setDnd', 'off'], refresh],
        isOn: ['omarchy-shell', 'notifications', 'isDnd'],
      }
    }

    if (await has('makoctl')) {
      return { on: [['makoctl', 'mode', '-a', 'do-not-disturb']], off: [['makoctl', 'mode', '-r', 'do-not-disturb']] }
    }

    if (await has('swaync-client')) {
      return { on: [['swaync-client', '-dn']], off: [['swaync-client', '-df']] }
    }

    if (await has('dunstctl')) {
      return { on: [['dunstctl', 'set-paused', 'true']], off: [['dunstctl', 'set-paused', 'false']] }
    }

    // GNOME's setting only means something on GNOME.
    if (/gnome/i.test(await stdoutOf(['sh', '-c', 'printf %s "$XDG_CURRENT_DESKTOP"'])) && (await has('gsettings'))) {
      return {
        on: [['gsettings', 'set', 'org.gnome.desktop.notifications', 'show-banners', 'false']],
        off: [['gsettings', 'set', 'org.gnome.desktop.notifications', 'show-banners', 'true']],
      }
    }

    return undefined
  }

  const getPlan = async (): Promise<SwitchPlan> => {
    if (plan !== undefined) {
      return plan
    }

    const isLocal = !(await io.isCloud())
    plan = {
      quiet: isLocal ? await findQuiet() : undefined,
      custom: {
        on: s.startCommand === '' ? [] : [['sh', '-c', s.startCommand]],
        off: s.endCommand === '' ? [] : [['sh', '-c', s.endCommand]],
      },
      canFullscreen: s.fullscreen && isLocal && (await has('hyprctl')),
    }

    return plan
  }

  /** Whether to silence notifications in blocks: the dashboard's choice, else the setting. */
  const silencePref = async (): Promise<boolean> => {
    const chosen = await io.get('silence')

    return typeof chosen === 'boolean' ? chosen : s.focusSwitch !== 'off'
  }

  /** Maximizes the Claude window on Hyprland, if Claude is the window in front. */
  const fullscreenOn = async (): Promise<string | undefined> => {
    const active = await io.run(['hyprctl', 'activewindow', '-j']).catch(() => undefined)
    const win = (() => {
      try {
        return JSON.parse(active?.stdout ?? '') as { address?: string; class?: string; title?: string; fullscreen?: number | boolean }
      } catch {
        return undefined
      }
    })()
    const isClaude = /claude/i.test(`${win?.class ?? ''} ${win?.title ?? ''}`)

    if (win?.address === undefined || !isClaude || (win.fullscreen !== undefined && win.fullscreen !== 0 && win.fullscreen !== false)) {
      return undefined
    }

    await io.run(['hyprctl', 'dispatch', 'fullscreen', '1']).catch(() => undefined)

    return win.address
  }

  const fullscreenOff = async (address: string) => {
    const clients = await io.run(['hyprctl', 'clients', '-j']).catch(() => undefined)
    let win: { address?: string; fullscreen?: number | boolean } | undefined

    try {
      const list = JSON.parse(clients?.stdout ?? '[]') as { address?: string; fullscreen?: number | boolean }[]
      win = list.find(c => c.address === address)
    } catch {
      win = undefined
    }

    if (win === undefined || win.fullscreen === 0 || win.fullscreen === false) {
      return
    }

    await io.run(['hyprctl', '--batch', `dispatch focuswindow address:${address} ; dispatch fullscreen 1`]).catch(() => undefined)
  }

  const runAll = async (list: string[][]) => {
    for (const argv of list) {
      await io.run(argv).catch(() => undefined)
    }
  }

  /**
   * Turns the switch on for a focus block and off for anything else, each part
   * once: the person's commands and fullscreen, and do-not-disturb when they
   * chose it. Do-not-disturb that was on before the block is left alone.
   */
  const applySwitch = async (t: Timer): Promise<string> => {
    const p = await getPlan()
    const want = isFocusing(t)
    const wantQuiet = want && p.quiet !== undefined && (await silencePref())
    const state = ((await io.get('switch')) ?? {}) as SwitchState
    const next: SwitchState = { ...state }
    const lines: string[] = []

    if (want && state.on !== true) {
      await runAll(p.custom.on)
      next.address = p.canFullscreen ? await fullscreenOn() : undefined
      next.on = true
    } else if (!want && state.on === true) {
      await runAll(p.custom.off)

      if (state.address !== undefined) {
        await fullscreenOff(state.address)
      }

      next.on = false
      next.address = undefined
    }

    if (p.quiet !== undefined) {
      if (wantQuiet && state.quieted !== true) {
        const isOnAlready = p.quiet.isOn !== undefined && (await stdoutOf(p.quiet.isOn)) === 'on'

        if (!isOnAlready) {
          await runAll(p.quiet.on)
          next.quieted = true
        }
      } else if (!wantQuiet && state.quieted === true) {
        await runAll(p.quiet.off)
        next.quieted = false
      }
    }

    if (JSON.stringify(next) !== JSON.stringify(state)) {
      await io.set('switch', next)
    }

    if (want) {
      if (wantQuiet) {
        lines.push('Notifications silenced')
      }

      if (p.custom.on.length > 0) {
        lines.push('Focus commands ran')
      }

      if (next.address !== undefined) {
        lines.push('Fullscreen')
      }
    }

    return lines.join(', ')
  }

  /** Chooses whether blocks silence notifications, and applies it to a block that's running. */
  const setSilence = (value: boolean) =>
    locked(async () => {
      await io.set('silence', value)
      io.toast(value ? 'Notifications will be silenced during blocks.' : 'Notifications stay on during blocks.', 4000)
    }).then(() => sync())

  /** Counts a finished focus block once, however many sessions saw it end. */
  const recordFocus = async (ended: Extract<Ended, { kind: 'focus-done' }>, isLate: boolean, after: Saved) => {
    const done = await loadDone()

    if (done.includes(ended.id)) {
      return
    }

    await io.set('done', [...done, ended.id].slice(-200))

    const key = dayKeyOf(ended.at)
    const minutes = Math.round(ended.lengthMs / MIN)
    const days = await loadRecord('days')
    const today = (days[key] ?? 0) + 1
    days[key] = today
    await io.set('days', prune(days, key, KEEP_DAYS))
    const mins = await loadRecord('minutes')
    mins[key] = (mins[key] ?? 0) + minutes
    await io.set('minutes', prune(mins, key, KEEP_DAYS))

    const pending = await loadRecord('pending')
    pending[key] = (pending[key] ?? 0) + (s.unit === 'sessions' ? 1 : minutes)
    await io.set('pending', pending)
    await flushVault().catch(() => undefined)

    if (isLate) {
      return
    }

    await io.set('checkIn', { id: ended.id, intention: ended.intention, day: key })

    const breakMin = Math.round((after.timer.phase === 'break' ? after.timer.lengthMs : s.shortMs) / MIN)
    const goal = s.goal > 0 && today === s.goal ? ` That's your ${s.goal} for today.` : ''
    const rest = after.timer.phase === 'break' ? ` ${breakMin} min break. Stand up and look at something far away.` : ''

    chime('sounds/focus-done.wav')
    io.toast(`${minutes} min block done, ${today} today.${goal}${rest}`, 12_000)
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

  const streakOf = (days: Record<string, number>, todayKey: string): number => {
    // Today still counts as "on the way" until it ends.
    let key = (days[todayKey] ?? 0) > 0 ? todayKey : shiftDay(todayKey, -1)
    let streak = 0

    while ((days[key] ?? 0) > 0 && streak < 1000) {
      streak += 1
      key = shiftDay(key, -1)
    }

    return streak
  }

  const logLine = (v: Vault): string =>
    v.root === null ? `Not logging to Obsidian: ${v.why}.` : `Logging to ${s.property} in ${joinPath(v.root, v.notes.folder || '.')}.`

  const publish = async (saved: Saved, now: number) => {
    const todayKey = dayKeyOf(now)
    const days = await loadRecord('days')
    const mins = await loadRecord('minutes')
    const quality = (await loadQuality())[todayKey] ?? [0, 0, 0]
    const rawCheck = (await io.get('checkIn')) as { id?: string; intention?: string } | undefined
    const checkIn =
      rawCheck !== undefined && rawCheck !== null && typeof rawCheck.id === 'string'
        ? { id: rawCheck.id, intention: typeof rawCheck.intention === 'string' ? rawCheck.intention : '' }
        : null
    const parked = (await loadParked()).filter(p => !p.isDone).slice(-8)
    const switchLine = await applySwitch(saved.timer).catch(() => '')
    const canSilence = (await getPlan().catch(() => undefined))?.quiet !== undefined
    const vault = await getVault()

    shown = {
      timer: saved.timer,
      cycleDone: saved.cycleDay === todayKey ? saved.cycleDone : 0,
      today: days[todayKey] ?? 0,
      todayMinutes: mins[todayKey] ?? 0,
      streak: streakOf(days, todayKey),
      quality,
      now,
      week: weekOf(days, now),
      logLine: logLine(vault),
      vaultName: vault.root === null ? '' : (vault.root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''),
      // A path set in the settings that turned out wrong is explained in the log line instead.
      needsVault: vault.root === null && s.vaultPath === '' && !(await io.isCloud()),
      noise,
      checkIn,
      parked,
      switchLine,
      silence: canSilence ? await silencePref() : null,
    }
    applyNoise(saved.timer)

    // The ring runs its own clock, so a tick that changes nothing a person
    // can read draws nothing: the dashboard only redraws when it has news.
    const t = saved.timer
    // While the clock runs the ring is drawn afresh every ten seconds, so it
    // keeps moving smoothly and a restarted animation is off by seconds at most.
    const isRunning = t.phase === 'focus' || t.phase === 'break'
    const face = JSON.stringify([{ ...shown, now: 0 }, formatLeft(remaining(t, now), s.showSeconds), Math.floor(elapsed(t, now) / MIN), isRunning ? Math.floor(now / 10_000) : 0])

    if (face !== drawn) {
      drawn = face
      await io.publish(shown)
    }
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

    // The ring animates its own seconds, so a redraw every ten seconds keeps
    // it honest; the slow idle tick picks up a timer another session started.
    const ms = isRunning ? 10_000 : 30_000

    if (tick?.ms !== ms) {
      tick?.cancel()
      tick = { ...io.every(ms, () => void sync()), ms }
    }
  }

  const handleEnded = async (ended: readonly Ended[], saved: Saved, now: number) => {
    for (const one of ended) {
      const isLate = now - one.at > LATE_MS

      if (one.kind === 'focus-done') {
        await recordFocus(one, isLate, saved)
      } else if (!isLate) {
        chime('sounds/break-done.wav')
        io.toast(
          saved.timer.phase === 'focus' ? 'Break is over. The next focus block has started.' : 'Break is over. Pick the next thing when you are ready.',
          10_000,
        )
      }
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

      await handleEnded(ended, saved, now)
      // Anything still owed to a daily note goes in once the note or the vault turns up.
      await flushVault().catch(() => undefined)
      await publish(saved, now)
      schedule(saved, now)

      return saved
    })

  /** Runs one change against the settled timer, then saves and redraws. */
  const change = (fn: (saved: Saved, now: number) => { saved: Saved; text: string; ended?: readonly Ended[] }) =>
    sync().then(() =>
      locked(async () => {
        const now = await io.now()
        const { saved, text, ended } = fn(await loadSaved(), now)
        await io.set('timer', saved)
        await handleEnded(ended ?? [], saved, now)
        await publish(saved, now)
        schedule(saved, now)

        return text
      }),
    )

  // A number is a block of that many minutes; from 45 up it earns a break of a fifth.
  const presetOf = (name: PresetName | number): Preset =>
    typeof name === 'number'
      ? { focusMs: name * MIN, ...(name >= 45 ? { breakMs: Math.round(name / 5) * MIN } : {}) }
      : name === 'flow'
        ? { focusMs: 0, isFlow: true }
        : name === 'long'
          ? { focusMs: 50 * MIN, breakMs: 10 * MIN }
          : { focusMs: s.focusMs }

  const start = (intention: string, preset: PresetName | number = 'pomodoro') =>
    change((saved, now) => {
      const t = saved.timer

      if (t.phase === 'focus') {
        return intention === ''
          ? { saved, text: 'Already focusing.' }
          : { saved: { ...saved, timer: { ...t, intention } }, text: `Now working on ${intention}.` }
      }

      if (t.phase === 'paused' && intention === '') {
        return { saved: resume(saved, now), text: 'Resumed.' }
      }

      const p = presetOf(preset)
      const what = intention === '' ? '' : ` on ${intention}`
      const how = p.isFlow === true ? 'in flow mode. Stop when you lose the thread, and the break scales to match' : `for ${Math.round(p.focusMs / MIN)} min`

      return { saved: startFocus(saved, now, s, intention, p), text: `Focus${what} ${how}.` }
    }).then(async text => {
      // A new block clears the last one's unanswered check-in.
      await io.set('checkIn', null)
      await sync()

      return text
    })

  const pauseIt = () =>
    change((saved, now) =>
      saved.timer.phase === 'focus' || saved.timer.phase === 'break'
        ? { saved: pause(saved, now), text: 'Paused.' }
        : { saved, text: 'Nothing is running.' },
    )

  const resumeIt = () =>
    change((saved, now) =>
      saved.timer.phase === 'paused' ? { saved: resume(saved, now), text: 'Resumed.' } : { saved, text: 'Nothing is paused.' },
    )

  const addFive = () =>
    change(saved => (saved.timer.phase === 'idle' ? { saved, text: 'Nothing is running.' } : { saved: extend(saved, 5 * MIN), text: 'Five more minutes.' }))

  const finish = () =>
    change((saved, now) => {
      const t = saved.timer
      const isFlow = t.phase !== 'idle' && t.isFlow === true

      if (!isFlow) {
        return { saved, text: 'Only a flow block ends early and still counts. To abandon this one, use /pomo stop.' }
      }

      const worked = elapsed(t, now)
      const result = finishFlow(saved, now, s, dayKeyOf)

      return {
        ...result,
        text:
          result.ended.length > 0
            ? `${Math.round(worked / MIN)} min of flow counted.`
            : 'Under 5 minutes, so that one is not counted.',
      }
    })

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

  const answerCheckIn = (answer: CheckIn) =>
    locked(async () => {
      const raw = (await io.get('checkIn')) as { day?: string } | null | undefined
      const day = typeof raw?.day === 'string' ? raw.day : dayKeyOf(await io.now())
      const quality = await loadQuality()
      const row = quality[day] ?? [0, 0, 0]
      row[answer === 'did' ? 0 : answer === 'partly' ? 1 : 2] += 1
      quality[day] = row
      await io.set('quality', prune(quality, day, KEEP_DAYS))
      await io.set('checkIn', null)
    }).then(async () => {
      await sync()

      return answer === 'distracted' ? 'Noted. Park the next distraction instead of chasing it.' : 'Noted.'
    })

  const park = (text: string) =>
    locked(async () => {
      const clean = text.trim()

      if (clean === '') {
        return 'Nothing to park. Use /park and the thought.'
      }

      const now = await io.now()
      const day = dayKeyOf(now)
      const list = await loadParked()

      // Enter pressed twice on the same thought parks it once.
      if (list.some(p => !p.isDone && p.text === clean)) {
        io.toast('Already parked.', 4000)

        return 'Already parked.'
      }

      list.push({ id: `${now.toString(36)}-${list.length}`, text: clean, at: now, day, isDone: false })
      await io.set('parked', list.slice(-100))

      if (s.parkToVault) {
        const queue = ((await io.get('parkQueue')) ?? {}) as Record<string, string[]>
        queue[day] = [...(Array.isArray(queue[day]) ? queue[day] : []), clean]
        await io.set('parkQueue', queue)
        await flushVault().catch(() => undefined)
      }

      // Only say it reached the note if it did: with no vault, or no note yet, it waits.
      const waiting = ((await io.get('parkQueue')) ?? {}) as Record<string, unknown>
      const where = s.parkToVault && !(day in waiting) ? ' and added to your daily note' : ''
      io.toast(`Parked${where}. Back to it.`, 4000)

      return `Parked${where}. It will be there at your break.`
    }).then(async text => {
      await sync()

      return text
    })

  const markParked = (id: string) =>
    locked(async () => {
      const list = await loadParked()
      const one = list.find(p => p.id === id)
      await io.set(
        'parked',
        list.map(p => (p.id === id ? { ...p, isDone: true } : p)),
      )

      return one
    })

  const clearParked = (id: string) => markParked(id).then(() => sync())

  /** Hands a parked thought to the prompt box as a draft, and ticks it off if it got there. */
  const askParked = async (id: string) => {
    const one = (await loadParked()).find(p => p.id === id)

    if (one !== undefined && (await io.fill(one.text).catch(() => false))) {
      await clearParked(id)
    }
  }

  /** Remembers the vault typed into the dashboard, if there is one there. */
  const setVaultPath = async (path: string): Promise<string> => {
    const home = (await io.home()) ?? ''
    const given = path.trim().replace(/^~(?=$|[\\/])/, home).replace(/[\\/]+$/, '')
    const isVault = given !== '' && (await hasVault(given).catch(() => false))
    const text = isVault
      ? `Logging to the vault at ${given}.`
      : `No Obsidian vault at ${given || 'an empty path'}. It is the folder with a .obsidian folder inside.`

    if (isVault) {
      await io.set('vaultPath', given)
    }

    io.toast(text, 8000)
    await sync()

    return text
  }

  const setNoise = (kind: Noise) =>
    locked(async () => {
      noise = kind

      if (shown !== undefined) {
        shown = { ...shown, noise }
        applyNoise(shown.timer)
        drawn = ''
        await io.publish(shown)
      }

      return kind === 'off' ? 'Noise off.' : `${kind[0]?.toUpperCase()}${kind.slice(1)} noise on.`
    })

  /** What Claude is told while a block runs, or undefined when none is. */
  const taskNote = (): string | undefined => {
    const t = shown?.timer

    if (!s.keepOnTask || t === undefined || t.phase !== 'focus') {
      return undefined
    }

    const what = t.intention === '' ? 'one task they chose' : `this, in their words: "${t.intention.slice(0, 200)}"`

    return [
      `The user is in a timed focus block (the pomo plugin), working on ${what}.`,
      'Keep replies tight and on that task. If they ask for something unrelated, say so in one line and offer to park it for their break with `/park <the thought>` rather than starting on it, unless they say to go ahead.',
    ].join(' ')
  }

  const stats = async (): Promise<string> => {
    const now = await io.now()
    const todayKey = dayKeyOf(now)
    const days = await loadRecord('days')
    const mins = await loadRecord('minutes')
    const week = weekOf(days, now)
    const total = week.reduce((sum, d) => sum + d.count, 0)
    let weekMinutes = 0

    for (let back = 0; back < 7; back += 1) {
      weekMinutes += mins[shiftDay(todayKey, -back)] ?? 0
    }

    const rows = week.map(d => `${d.label.padEnd(10)} ${d.count.toString().padStart(2)}  ${'●'.repeat(Math.min(d.count, 16))}`)
    const [did, partly, distracted] = (await loadQuality())[todayKey] ?? [0, 0, 0]
    const answered = did + partly + distracted
    const quality = answered > 0 ? ` Check-ins today: ${did} did it, ${partly} partly, ${distracted} distracted.` : ''
    const goal = s.goal > 0 ? ` of ${s.goal}` : ''
    const v = await getVault()
    const waiting = Object.keys(await loadRecord('pending')).length
    const wait = waiting > 0 && v.root !== null ? `\n${waiting} day(s) wait for their daily note to exist, and are written once it does.` : ''

    return [
      'Focus blocks, last 7 days',
      '',
      ...rows,
      '',
      `This week ${total} blocks, ${Math.floor(weekMinutes / 60)} h ${weekMinutes % 60} min. Today ${days[todayKey] ?? 0}${goal}, streak ${streakOf(days, todayKey)} day(s).${quality}`,
      logLine(v) + wait,
    ].join('\n')
  }

  /** The dashboard as a few lines of text, for where no dashboard is drawn. */
  const status = async (): Promise<string> => {
    await sync()
    const v = shown

    if (v === undefined) {
      return 'The focus timer is still starting.'
    }

    const t = v.timer
    const goal = s.goal > 0 ? ` of ${s.goal}` : ''
    const today = `Today ${v.today}${goal} blocks, ${v.todayMinutes} min, streak ${v.streak}.`
    const parked = v.parked.length > 0 ? ` ${v.parked.length} parked.` : ''

    if (t.phase === 'idle') {
      return `Ready. ${today}${parked}\nStart with /pomo <what it is for>, /pomo 50 <what>, or /pomo flow <what>.`
    }

    const isFocus = t.phase === 'focus' || (t.phase === 'paused' && t.of === 'focus')
    const isFlow = t.isFlow === true
    const name = isFocus ? (isFlow ? 'Flow' : 'Focus') : t.isLong ? 'Long break' : 'Break'
    const time = isFlow && isFocus ? `${Math.floor(elapsed(t, v.now) / MIN)} min in` : `${formatLeft(remaining(t, v.now), false)} left`
    const what = isFocus && t.intention !== '' ? ` on ${t.intention}` : ''
    const paused = t.phase === 'paused' ? ' (paused)' : ''
    const next = isFocus
      ? isFlow
        ? '/pomo done to take your break, /park <thought> for stray thoughts.'
        : '/park <thought> for stray thoughts, /pomo pause or +5 if you need them.'
      : v.checkIn !== null
        ? 'How did that block go? /pomo did, /pomo partly, or /pomo distracted.'
        : '/pomo skip to end the break early.'
    const list = !isFocus && v.parked.length > 0 ? `\nParked:\n${v.parked.map(p => `- ${p.text}`).join('\n')}` : ''

    return `${name}${what}, ${time}${paused}. ${today}${parked}\n${next}${list}`
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
      case 'done':
      case 'finish':
        return finish()
      case '+5':
      case 'more':
        return addFive()
      case 'stats':
        return stats()
      case 'status':
        return status()
      case 'did':
      case 'did it':
        return answerCheckIn('did')
      case 'partly':
        return answerCheckIn('partly')
      case 'distracted':
      case 'got distracted':
        return answerCheckIn('distracted')
      case 'start':
        return start('')
      case 'flow':
        return start('', 'flow')
      case 'noise':
        return setNoise(noise === 'off' ? 'brown' : 'off')
      case 'noise off':
      case 'noise brown':
      case 'noise pink':
      case 'noise white':
        return setNoise(word.slice(6) as Noise)
      case 'help':
        return [
          '/pomo                              open the dashboard, or show where things stand',
          '/pomo <what you are working on>    start a 25 minute block on it',
          '/pomo 40 <what> | flow <what>      a block of any length, or flow (stop when you are done)',
          '/pomo pause | resume | +5 | stop   stop abandons the block, and it is not counted',
          '/pomo done                         end a flow block and take the break it earned',
          '/pomo did | partly | distracted    answer the check-in after a block',
          '/pomo status                       where things stand, as text',
          '/pomo skip                         end a break early',
          '/pomo noise [brown|pink|white|off] a quiet noise bed, in this session only',
          '/pomo stats                        the last 7 days, and where blocks are logged',
          '/park <thought>                    park a distraction for the break',
        ].join('\n')
      default: {
        const rest = args.trim().replace(/^start\s+/i, '')
        const flow = /^flow(\s+|$)/i.exec(rest)
        const length = /^(\d{1,3})\s*(?:m|min|mins|minutes)?(?:\s+|$)/i.exec(rest)

        if (flow !== null) {
          return start(rest.slice(flow[0].length).trim(), 'flow')
        }

        if (length !== null) {
          const minutes = Number(length[1])

          if (minutes < 5 || minutes > 180) {
            return 'A block can be 5 to 180 minutes long.'
          }

          return start(rest.slice(length[0].length).trim(), minutes)
        }

        return start(rest)
      }
    }
  }

  // Blocks finished before pomo counted minutes have a day but no minutes.
  // Once, give each such block the usual length, so the day's minutes match
  // its blocks; a day's minutes already cover whole blocks of that length.
  const backfillMinutes = () =>
    locked(async () => {
      if ((await io.get('minutesBackfilled')) === true) {
        return
      }

      const days = await loadRecord('days')
      const mins = await loadRecord('minutes')
      const block = Math.round(s.focusMs / MIN)

      for (const [key, count] of Object.entries(days)) {
        const covered = Math.round((mins[key] ?? 0) / block)

        if (count > covered) {
          mins[key] = (mins[key] ?? 0) + (count - covered) * block
        }
      }

      await io.set('minutes', mins)
      await io.set('minutesBackfilled', true)
    })

  const begin = () => backfillMinutes().then(() => sync())

  const end = () => {
    playing?.stop()
    playing = undefined
    endTimer?.cancel()
    tick?.cancel()
    endTimer = undefined
    tick = undefined
  }

  return {
    begin,
    end,
    sync,
    command,
    start,
    pause: pauseIt,
    resume: resumeIt,
    addFive,
    finish,
    stop,
    skip,
    stats,
    status,
    setNoise,
    park,
    clearParked,
    setSilence,
    askParked,
    setVaultPath,
    answerCheckIn,
    taskNote,
  }
}

export type Focus = ReturnType<typeof createFocus>

export { formatLeft, remaining }
