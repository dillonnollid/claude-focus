// The dashboard's drawings, as SVG text: the timer ring and the day's card,
// in chunky pixel art. Each carries its own card, so it reads the same over
// any theme. DESIGN.md at the repository root says why they look this way.
//
// The ring is drawn once per change of the timer and then runs by itself:
// sixty pixel segments go out one by one as the block burns down, the one
// burning now glows, and the pixel digits roll on CSS steps. Nothing in it
// needs the plugin again until the timer changes, so the dashboard never has
// to swap the drawing mid-block, which is what made the old clock blink.

// The palette. ember-theme's register.ts holds the same values.
const CARD = '#1c1a18'
const HAIR = 'rgba(239, 233, 222, 0.08)'
const TRACK = 'rgba(239, 233, 222, 0.14)'
const TEXT = '#efe9de'
const SECOND = '#aaa398'
const MUTED = '#9a9387'
const EMBER = '#ff7a1f'
const LIGHT = '#ffb37a'
const MOSS = '#b3c95a'
const MOSS_LIGHT = '#dbe8a0'
const PAST = '#3a3631'
const MONO = "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"

/** A card's ground: a flat surface with a hairline edge. */
function card(width: number, height: number): string {
  return `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="${CARD}" stroke="${HAIR}"/>`
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

// A 5 by 7 pixel font for the digits, one string of rows per digit.
const FONT: Record<string, string> = {
  '0': '01110 10001 10001 10001 10001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
}

const P = 5

/** Path data for one digit with its top left at x, y. */
function glyph(digit: string, x: number, y: number): string {
  const rows = (FONT[digit] ?? FONT['0'] ?? '').split(' ')
  let d = ''

  rows.forEach((row, r) => {
    for (const m of row.matchAll(/1+/g)) {
      d += `M${x + (m.index ?? 0) * P} ${y + r * P}h${m[0].length * P}v${P}h-${m[0].length * P}z`
    }
  })

  return d
}

export type RingArgs = {
  phase: 'idle' | 'focus' | 'break' | 'paused'
  label: string
  /** A line under the time; empty for none. */
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
const CY = 132
const R = 100
const N = 60
// The digits: one cell each, so they never shuffle sideways as they change.
const TOP = CY - 18
const LINE = 44
const X = { m10: CX - 68, m1: CX - 38, colon: CX - 3, s10: CX + 13, s1: CX + 43 }

/**
 * A column of digits that steps to the next every `stepS` seconds, already
 * `into` seconds along. A looping one goes round; any other stops on its last.
 */
function column(id: string, x: number, digits: readonly string[], stepS: number, into: number, isLoop: boolean) {
  const n = digits.length
  const all = isLoop ? digits : [...digits, digits[n - 1] ?? '0']

  return {
    css: `@keyframes ${id} { to { transform: translateY(-${n * LINE}px); } } .${id} { animation: ${id} ${n * stepS}s steps(${n}) ${isLoop ? 'infinite' : '1 forwards'}; animation-delay: -${into.toFixed(3)}s; }`,
    svg: `<g class="${id}"><path d="${all.map((g, i) => glyph(g, x, TOP + i * LINE)).join('')}"/></g>`,
  }
}

/** The four columns of a running clock, counting down from or up through `seconds`. */
function liveDigits(seconds: number, isCountUp: boolean): { css: string; svg: string } {
  // What shows now, and how far into its second we already are.
  const shown = isCountUp ? Math.floor(seconds) : Math.ceil(seconds)
  const part = isCountUp ? seconds - shown : shown - seconds
  const up = (n: number) => Array.from({ length: n }, (_, i) => String(i))
  const order = (digits: string[]) => (isCountUp ? digits : digits.reverse())
  // Where each column stands in its own cycle of `period` seconds.
  const into = (period: number) => (isCountUp ? shown % period : period - 1 - (shown % period)) + part
  const tens = Math.floor(shown / 600)
  // Counting down, the tens of minutes run out at zero; counting up, five hours is plenty.
  const tensList = isCountUp ? Array.from({ length: 30 }, (_, i) => String((tens + i) % 10)) : Array.from({ length: tens + 1 }, (_, i) => String(tens - i))
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

  return `<path d="${glyph(m.slice(-2, -1) || '0', X.m10, TOP)}${glyph(m.slice(-1), X.m1, TOP)}${glyph(s[0] ?? '0', X.s10, TOP)}${glyph(s[1] ?? '0', X.s1, TOP)}"/>`
}

/** Where segment `i` sits on the dial, clockwise from the top. */
function at(i: number, r = R): { x: number; y: number } {
  const a = ((i + 0.5) / N) * 2 * Math.PI

  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) }
}

function square(x: number, y: number, size: number, extra = ''): string {
  return `<rect x="${(x - size / 2).toFixed(1)}" y="${(y - size / 2).toFixed(1)}" width="${size}" height="${size}"${extra}/>`
}

/** The ring of pixel segments that burns down as the block runs, with the time in the middle. */
export function ringSvg(a: RingArgs): string {
  const length = Math.max(1, a.lengthMs)
  const elapsedS = Math.min(length, Math.max(0, a.elapsedMs)) / 1000
  const stepS = length / 1000 / N
  const leftS = Math.max(0, length / 1000 - elapsedS)
  const lit = a.phase === 'focus' ? EMBER : a.phase === 'break' ? MOSS : SECOND
  const hot = a.phase === 'break' ? MOSS_LIGHT : LIGHT
  const isMoving = a.isLive && leftS > 0
  const isTicking = a.isLive && (a.isCountUp || leftS > 0)
  // Flow keeps counting past the mark the ring fills to.
  const seconds = a.isCountUp ? Math.max(0, a.elapsedMs) / 1000 : leftS
  const text = clockText(a.isCountUp ? Math.floor(seconds) : Math.ceil(seconds))
  const live = a.isLive ? liveDigits(seconds, a.isCountUp) : undefined

  // Every segment has an ash pixel underneath; a lit one sits on top while it
  // has time left, and the one burning now glows. Each keeps its own clock
  // in its animation delay, so the whole ring runs with no redraws.
  const ash: string[] = []
  const on: string[] = []
  const glow: string[] = []

  for (let i = 0; i < N; i += 1) {
    const { x, y } = at(i)
    ash.push(square(x, y, 3))

    if (a.phase === 'idle') {
      continue
    }

    // Counting down, segment i burns out at the end of its slot; counting up, it lights at the start.
    const startS = i * stepS
    const endS = (i + 1) * stepS
    const isLitNow = a.isCountUp ? elapsedS >= startS : elapsedS < endS

    if (a.isCountUp) {
      if (isLitNow) {
        on.push(square(x, y, 7))
      } else if (isMoving) {
        on.push(square(x, y, 7, ` class="on" style="animation-delay:${(startS - elapsedS).toFixed(2)}s"`))
      }
    } else if (isLitNow) {
      on.push(square(x, y, 7, isMoving ? ` class="off" style="animation-delay:${(endS - elapsedS).toFixed(2)}s"` : ''))
    }

    if (isMoving && elapsedS < endS) {
      glow.push(square(x, y, 9, ` class="hot" style="animation-duration:${stepS.toFixed(2)}s;animation-delay:${(startS - elapsedS).toFixed(2)}s"`))
    }
  }

  const css = [
    live?.css ?? '',
    '.off { animation: off 1ms linear forwards; } @keyframes off { to { opacity: 0; } }',
    '.on { opacity: 0; animation: on 1ms linear forwards; } @keyframes on { to { opacity: 1; } }',
    '.hot { opacity: 0; animation-name: hot; animation-timing-function: linear; } @keyframes hot { from, to { opacity: 1; } }',
    '.blink { animation: blink 1s step-end infinite; } @keyframes blink { 50% { opacity: 0.3; } }',
  ]

  // A countdown that reaches zero rests on 00:00 instead of rolling round.
  if (live !== undefined && !a.isCountUp) {
    css.push(`.live { animation: gone 1ms linear ${leftS.toFixed(2)}s forwards; } @keyframes gone { to { visibility: hidden; } }`)
    css.push(`.rest { visibility: hidden; animation: here 1ms linear ${leftS.toFixed(2)}s forwards; } @keyframes here { to { visibility: visible; } }`)
  }

  const digits =
    live === undefined
      ? stillDigits(text)
      : `<g class="live">${live.svg}</g>${a.isCountUp ? '' : `<g class="rest">${stillDigits('00:00')}</g>`}`
  const colon = `<g${isTicking ? ' class="blink"' : ''} opacity="0.7">${square(X.colon + 2.5, TOP + 12.5, P)}${square(X.colon + 2.5, TOP + 22.5, P)}</g>`
  const pips =
    a.rounds > 1 && a.rounds <= 8
      ? Array.from({ length: a.rounds }, (_, i) => {
          const x = CX - ((a.rounds - 1) * 12) / 2 + i * 12
          const isDone = i < a.round - 1
          const isNow = i === a.round - 1

          return square(x, CY + 58, 6, ` fill="${isDone ? lit : 'none'}" stroke="${isNow ? lit : isDone ? 'none' : TRACK}"`)
        }).join('')
      : ''
  const isStill = a.phase === 'idle' || a.phase === 'paused'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<title>${esc(a.label)} ${text}</title>
<defs><clipPath id="win"><rect x="0" y="${TOP}" width="${W}" height="${7 * P}"/></clipPath></defs>
<style>
${css.join('\n')}
@media (prefers-reduced-motion: reduce) { .hot, .blink { animation: none; } }
</style>
${card(W, H)}
<g fill="${TRACK}" shape-rendering="crispEdges">${ash.join('')}</g>
<g fill="${lit}" shape-rendering="crispEdges">${on.join('')}</g>
<g fill="${hot}" shape-rendering="crispEdges">${glow.join('')}</g>
<text x="${CX}" y="${CY - 36}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${a.phase === 'idle' ? MUTED : lit}">${esc(a.label)}</text>
<g fill="${isStill ? SECOND : TEXT}" shape-rendering="crispEdges"><g clip-path="url(#win)">${digits}</g>${colon}</g>
${a.sub === '' ? '' : `<text x="${CX}" y="${CY + 40}" text-anchor="middle" font-family="${MONO}" font-size="11.5" fill="${MUTED}">${esc(cut(a.sub, 28))}</text>`}
<g stroke-width="1.5">${pips}</g>
</svg>`
}

export type DayArgs = {
  today: number
  goal: number
  minutes: number
  streak: number
  /** Share of today's check-ins that stayed on task, 0 to 1, or undefined before any. */
  onTask: number | undefined
  /** A block has just finished and waits for its check-in: its tile blinks. */
  isFresh: boolean
  week: readonly { label: string; count: number; isToday: boolean }[]
}

/** Today as a row of pixel tiles toward the goal, over the week as stacked pixel bars. */
export function daySvg(a: DayArgs): string {
  const width = W
  const height = 200
  const top = 92
  const base = 156
  const slot = (width - 32) / Math.max(1, a.week.length)
  const most = Math.max(a.goal, 1, ...a.week.map(d => d.count))
  // One cell per block, as tall as the room allows.
  const cell = Math.max(2, Math.min(7, Math.floor((base - top) / most) - 2))
  const isEmpty = a.week.every(d => d.count === 0)
  const tiles = Math.min(12, Math.max(a.goal, a.today))
  const tileRow =
    tiles === 0
      ? ''
      : Array.from({ length: tiles }, (_, i) => {
          const x = 16 + i * 16
          const isLit = i < a.today
          const isNew = a.isFresh && i === a.today - 1

          return isLit
            ? `<rect x="${x}" y="52" width="12" height="12" fill="${EMBER}"${isNew ? ' class="new"' : ''}/>`
            : `<rect x="${x + 0.75}" y="52.75" width="10.5" height="10.5" fill="none" stroke="${TRACK}" stroke-width="1.5"/>`
        }).join('')
  const bars = a.week
    .map((day, i) => {
      const x = 16 + i * slot + slot / 2
      const fill = day.isToday ? EMBER : PAST
      const cells =
        day.count === 0
          ? `<rect x="${x - 7}" y="${base - 2}" width="14" height="2" fill="${TRACK}"/>`
          : Array.from({ length: day.count }, (_, k) => `<rect x="${x - 7}" y="${base - (k + 1) * (cell + 2) + 2}" width="14" height="${cell}" fill="${fill}"/>`).join('')

      return `${cells}<text x="${x}" y="${base + 18}" text-anchor="middle" font-size="11" fill="${day.isToday ? TEXT : MUTED}">${esc(day.label.slice(0, 2))}</text>`
    })
    .join('')
  const goalY = base - a.goal * (cell + 2) + 1
  const goalLine =
    a.goal > 0 && !isEmpty && a.goal * (cell + 2) <= base - top + 2
      ? `<line x1="16" x2="${width - 16}" y1="${goalY}" y2="${goalY}" stroke="${TRACK}" stroke-dasharray="2 4"/>`
      : ''
  const hint = isEmpty ? `<text x="${width / 2}" y="${(top + base) / 2 + 4}" text-anchor="middle" font-size="11.5" fill="${MUTED}">your week fills in as you finish blocks</text>` : ''
  const of = a.goal > 0 ? `/${a.goal}` : ''
  const meta = [`${a.minutes} min`, a.streak > 1 ? `${a.streak} day streak` : '', a.onTask === undefined ? '' : `${Math.round(a.onTask * 100)}% on task`].filter(Boolean).join('  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${MONO}" shape-rendering="crispEdges">
<title>Today ${a.today}${of} blocks, ${meta}</title>
<style>.new { animation: new 1s step-end infinite; } @keyframes new { 50% { fill: ${LIGHT}; } } @media (prefers-reduced-motion: reduce) { .new { animation: none; } }</style>
${card(width, height)}
<text x="16" y="30" font-size="12" fill="${SECOND}">today <tspan fill="${TEXT}">${a.today}${of}</tspan></text>
<text x="${width - 16}" y="30" text-anchor="end" font-size="11.5" fill="${MUTED}">${esc(meta)}</text>
${tileRow}
${goalLine}${bars}${hint}
</svg>`
}
