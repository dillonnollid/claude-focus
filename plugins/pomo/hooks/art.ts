// The dashboard's drawings, as SVG text: the timer ring and the day's card.
// Each carries its own card, so it reads the same over any theme.
//
// They follow DESIGN.md at the repository root. In short: quiet warm
// neutrals, one accent, flat colour, hairlines for depth, and motion only
// where it tells the time. The ring is the screen's one bright element; the
// day card is quiet beside it.
//
// The ring is drawn once per change of the timer and then runs by itself: a
// block burns down like a stick of incense, the lit arc shrinking behind its
// tip, and the digits roll on CSS steps. Nothing in it needs the plugin again
// until the timer changes, so the dashboard never has to swap the drawing
// mid-block, which is what made the old clock blink.

// The palette. ember-theme's register.ts holds the same values.
const CARD = '#1c1a18'
const HAIR = 'rgba(239, 233, 222, 0.08)'
const TRACK = 'rgba(239, 233, 222, 0.14)'
const TEXT = '#efe9de'
const SECOND = '#aaa398'
const MUTED = '#9a9387'
const EMBER = '#ff7a1f'
const MOSS = '#b3c95a'
// Other days' bars: a neutral step, so today's ember is the only colour on the card.
const PAST = '#3a3631'
const FONT = "ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** A card's ground: a flat surface with a hairline edge. */
function card(width: number, height: number): string {
  return `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="15.5" fill="${CARD}" stroke="${HAIR}"/>`
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Whole seconds as `MM:SS`, the minutes running past 99 for a long flow. */
export function clockText(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds))

  return `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toString().padStart(2, '0')}`
}

export type RingArgs = {
  phase: 'idle' | 'focus' | 'break' | 'paused'
  label: string
  /** What the block is for, or a hint; drawn under the time. */
  sub: string
  /** Milliseconds the block has run. */
  elapsedMs: number
  /** Its whole length in milliseconds; for flow, the mark the ring fills to. */
  lengthMs: number
  /** Counting up (flow) rather than down. */
  isCountUp: boolean
  /** Whether the clock is moving: false while paused or idle. */
  isLive: boolean
  /** Which block of the set this is, from 1, and how many make a set; 0 hides the pips. */
  round: number
  rounds: number
}

const W = 280
const H = 264
const CX = W / 2
const CY = H / 2
const R = 96
const LEN = 2 * Math.PI * R
// The digits: one cell each, so they never shuffle sideways as they change.
const BASE = CY + 19
const LINE = 64
const CELL = 33
const X = { m10: CX - 9 - CELL * 1.5, m1: CX - 9 - CELL / 2, s10: CX + 9 + CELL / 2, s1: CX + 9 + CELL * 1.5 }

/**
 * A column of glyphs that steps to the next every `stepS` seconds, already
 * `into` seconds along. A looping one goes round; any other stops on its last.
 */
function column(id: string, x: number, glyphs: readonly string[], stepS: number, into: number, isLoop: boolean) {
  const n = glyphs.length
  const all = isLoop ? glyphs : [...glyphs, glyphs[n - 1] ?? '']
  const texts = all.map((g, i) => `<text x="${x}" y="${BASE + i * LINE}" class="d">${g}</text>`).join('')

  return {
    css: `@keyframes ${id} { to { transform: translateY(-${n * LINE}px); } } .${id} { animation: ${id} ${n * stepS}s steps(${n}) ${isLoop ? 'infinite' : '1 forwards'}; animation-delay: -${into.toFixed(3)}s; }`,
    svg: `<g class="${id}">${texts}</g>`,
  }
}

/** The four columns of a running clock, counting down from or up through `seconds`. */
function liveDigits(seconds: number, isCountUp: boolean): { css: string; svg: string } {
  // What shows now, and how far into its second we already are.
  const shown = isCountUp ? Math.floor(seconds) : Math.ceil(seconds)
  const part = isCountUp ? seconds - shown : shown - seconds
  const up = (n: number) => Array.from({ length: n }, (_, i) => String(i))
  const order = (glyphs: string[]) => (isCountUp ? glyphs : glyphs.reverse())
  // Where each column stands in its own cycle of `period` seconds.
  const into = (period: number) => (isCountUp ? shown % period : period - 1 - (shown % period)) + part
  const tens = Math.floor(shown / 600)
  // Counting down, the tens of minutes run out at zero; counting up, five hours is plenty.
  const tensList = isCountUp ? Array.from({ length: 30 }, (_, i) => String(tens + i)) : Array.from({ length: tens + 1 }, (_, i) => String(tens - i))
  const cols = [
    column('m10', X.m10, tensList, 600, into(600), false),
    column('m1', X.m1, order(up(10)), 60, into(600), true),
    column('s10', X.s10, order(up(6)), 10, into(60), true),
    column('s1', X.s1, order(up(10)), 1, into(10), true),
  ]

  return { css: cols.map(c => c.css).join('\n'), svg: cols.map(c => c.svg).join('') }
}

function stillDigits(text: string): string {
  const [m = '00', s = '00'] = text.split(':')

  return [
    `<text x="${X.m10}" y="${BASE}" class="d">${m.slice(0, -1)}</text>`,
    `<text x="${X.m1}" y="${BASE}" class="d">${m.slice(-1)}</text>`,
    `<text x="${X.s10}" y="${BASE}" class="d">${s[0]}</text>`,
    `<text x="${X.s1}" y="${BASE}" class="d">${s[1]}</text>`,
  ].join('')
}

/** The ring that burns down as the block runs, with the time in the middle. */
export function ringSvg(a: RingArgs): string {
  const length = Math.max(1, a.lengthMs)
  const f0 = Math.min(1, Math.max(0, a.elapsedMs / length))
  const leftS = Math.max(0, length - a.elapsedMs) / 1000
  // The accent belongs to a running block alone; a break is moss, anything still is muted.
  const color = a.phase === 'focus' ? EMBER : a.phase === 'break' ? MOSS : MUTED
  const isMoving = a.isLive && f0 < 1
  const seconds = a.isCountUp ? a.elapsedMs / 1000 : leftS
  const text = clockText(a.isCountUp ? Math.floor(seconds) : Math.ceil(seconds))
  const live = a.isLive ? liveDigits(seconds, a.isCountUp) : undefined
  const css: string[] = []

  // Counting down, the lit arc is what's left and burns away from the top,
  // clockwise. Flow has no end, so its arc grows toward the 25 minute mark.
  let arc = ''

  if (a.isCountUp) {
    arc = `stroke-dasharray="${(LEN * f0).toFixed(1)} ${LEN.toFixed(1)}" class="arc"`
    css.push(`@keyframes arc { to { stroke-dasharray: ${LEN.toFixed(1)} ${LEN.toFixed(1)}; } }`)
  } else {
    arc = `stroke-dasharray="${LEN.toFixed(1)} ${LEN.toFixed(1)}" stroke-dashoffset="${(-LEN * f0).toFixed(1)}" class="arc"`
    css.push(`@keyframes arc { to { stroke-dashoffset: ${(-LEN).toFixed(1)}; } }`)
  }

  if (isMoving) {
    css.push(`.arc { animation: arc ${leftS.toFixed(2)}s linear forwards; }`)
    css.push(`@keyframes tip { to { transform: rotate(${(360 * (1 - f0)).toFixed(2)}deg); } } .tip { transform-origin: ${CX}px ${CY}px; animation: tip ${leftS.toFixed(2)}s linear forwards; }`)
  }

  // A countdown that reaches zero rests on 00:00 instead of rolling round.
  if (live !== undefined && !a.isCountUp) {
    css.push(`.live { animation: gone 1ms linear ${leftS.toFixed(2)}s forwards; } @keyframes gone { to { visibility: hidden; } }`)
    css.push(`.rest { visibility: hidden; animation: here 1ms linear ${leftS.toFixed(2)}s forwards; } @keyframes here { to { visibility: visible; } }`)
  }

  // Idle draws only the dial: a full ring of ash, waiting to be lit.
  const lit =
    a.phase === 'idle'
      ? ''
      : `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" transform="rotate(-90 ${CX} ${CY})" ${arc}/>`
  // The tip, where the incense is burning: a ring of the card's colour cut into the arc.
  const tip =
    a.phase === 'idle'
      ? ''
      : `<g transform="rotate(${(360 * f0).toFixed(2)} ${CX} ${CY})"><g class="tip"><circle cx="${CX}" cy="${CY - R}" r="7" fill="${color}" stroke="${CARD}" stroke-width="3"/></g></g>`
  const digits =
    live === undefined
      ? stillDigits(text)
      : `<g class="live">${live.svg}</g>${a.isCountUp ? '' : `<g class="rest">${stillDigits('00:00')}</g>`}`
  const pips =
    a.rounds > 1 && a.rounds <= 8
      ? Array.from({ length: a.rounds }, (_, i) => {
          const x = CX - ((a.rounds - 1) * 12) / 2 + i * 12
          const isDone = i < a.round - 1
          const isNow = i === a.round - 1

          return isDone
            ? `<circle cx="${x}" cy="${CY + 64}" r="3" fill="${SECOND}"/>`
            : `<circle cx="${x}" cy="${CY + 64}" r="2.5" fill="none" stroke="${isNow ? SECOND : TRACK}" stroke-width="1"/>`
        }).join('')
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<title>${esc(a.label)} ${text}</title>
<defs><clipPath id="win"><rect x="0" y="${BASE - 50}" width="${W}" height="${LINE}"/></clipPath></defs>
<style>
.d { font-family: ${FONT}; font-size: 50px; font-weight: 400; text-anchor: middle; fill: ${a.phase === 'idle' || a.phase === 'paused' ? SECOND : TEXT}; font-variant-numeric: tabular-nums; }
.t { font-family: ${FONT}; text-anchor: middle; }
${(live?.css ?? '') + '\n' + css.join('\n')}
</style>
${card(W, H)}
<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${TRACK}" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 ${(LEN / 60 - 0.1).toFixed(3)}"/>
${lit}
${tip}
<text x="${CX}" y="${CY - 42}" class="t" font-size="13" font-weight="500" fill="${SECOND}">${esc(a.label)}</text>
<g clip-path="url(#win)">${digits}<text x="${CX}" y="${BASE - 4}" class="d" fill-opacity="0.5">:</text></g>
<text x="${CX}" y="${CY + 44}" class="t" font-size="13" fill="${MUTED}">${esc(cut(a.sub, 26))}</text>
${pips}
</svg>`
}

export type DayArgs = {
  today: number
  goal: number
  minutes: number
  streak: number
  /** Share of today's check-ins that stayed on task, 0 to 1, or undefined before any. */
  onTask: number | undefined
  week: readonly { label: string; count: number; isToday: boolean }[]
}

/** Today's count against the goal, over the week as bars. Today is the only colour. */
export function daySvg(a: DayArgs): string {
  const width = W
  const height = 196
  const top = 84
  const base = 148
  const slot = (width - 32) / Math.max(1, a.week.length)
  const most = Math.max(a.goal, 1, ...a.week.map(d => d.count))
  const isEmpty = a.week.every(d => d.count === 0)
  const bars = a.week
    .map((day, i) => {
      const x = 16 + i * slot + slot / 2
      const h = day.count === 0 ? 2 : Math.max(4, ((base - top) * day.count) / most)
      const fill = day.count === 0 ? TRACK : day.isToday ? EMBER : PAST
      const n = day.count > 0 ? `<text x="${x}" y="${base - h - 6}" text-anchor="middle" font-size="12" fill="${day.isToday ? TEXT : MUTED}">${day.count}</text>` : ''

      return `<rect x="${(x - 9).toFixed(1)}" y="${(base - h).toFixed(1)}" width="18" height="${h.toFixed(1)}" rx="4" fill="${fill}"/>${n}<text x="${x}" y="${base + 20}" text-anchor="middle" font-size="12" fill="${day.isToday ? TEXT : MUTED}">${esc(day.label.slice(0, 2))}</text>`
    })
    .join('')
  const goalY = base - ((base - top) * a.goal) / most
  const goalLine =
    a.goal > 0 && !isEmpty
      ? `<line x1="16" x2="${width - 16}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}" stroke="${TRACK}" stroke-dasharray="2 4"/>`
      : ''
  const hint = isEmpty
    ? `<text x="${width / 2}" y="${(top + base) / 2 + 4}" text-anchor="middle" font-size="13" fill="${MUTED}">Your week fills in as you finish blocks</text>`
    : ''
  const of = a.goal > 0 ? ` of ${a.goal}` : ''
  const meta = [
    `${a.minutes} min`,
    a.streak > 1 ? `${a.streak} day streak` : '',
    a.onTask === undefined ? '' : `${Math.round(a.onTask * 100)}% on task`,
  ].filter(Boolean).join(', ')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}" style="font-variant-numeric: tabular-nums">
<title>Today ${a.today}${of} blocks, ${meta}</title>
${card(width, height)}
<text x="16" y="28" font-size="13" fill="${SECOND}">Today</text>
<text x="16" y="60"><tspan font-size="30" font-weight="500" fill="${TEXT}">${a.today}</tspan><tspan font-size="14" fill="${SECOND}" dx="6">${of.trim()} ${a.today === 1 && a.goal === 0 ? 'block' : 'blocks'}</tspan></text>
<text x="${width - 16}" y="60" text-anchor="end" font-size="13" fill="${MUTED}">${esc(meta)}</text>
${goalLine}${bars}${hint}
</svg>`
}
