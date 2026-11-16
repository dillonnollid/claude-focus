// The dashboard's drawings, as SVG text: the timer ring and the day's card.
// Each carries its own dark card, so it reads the same over any theme. The
// markup is drawn at twice its size so the pane can stretch it to its width.
//
// They follow the Hearth design system (DESIGN.md at the repository root):
//   lit and ash   solid ember is live or done; dotted kindling is waiting or spent
//   heat          gold marks the one live point, ember what counts, cinder the past
//   only fire moves   the tip flickers and the coals breathe; nothing else does
//   rest is green     a break swaps the heat for moss and holds still
//
// The ring is drawn once per change of the timer and then runs by itself: a
// block burns down like a stick of incense, the lit arc shrinking behind a
// glowing tip, and the digits roll on CSS steps. Nothing in it needs the
// plugin again until the timer changes, so the dashboard never has to swap
// the drawing mid-block, which is what made the old clock blink.

// The Hearth palette. ember-theme's register.tsx holds the same values.
const CHAR = '#22140f'
const KINDLING = '#47291b'
const BONE = '#f6e7cf'
const ASH = '#b89c84'
const GOLD = '#ffcf70'
const EMBER = '#ff7a1f'
const CINDER = '#9a431d'
const GARNET = '#d93a1a'
const MOSS = '#b3c95a'
const FONT = "ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** A card's ground: char, with a hairline of light along its top edge. */
function card(width: number, height: number, rx: number): string {
  return `<rect width="${width}" height="${height}" rx="${rx}" fill="${CHAR}"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${rx - 0.5}" fill="none" stroke="url(#edge)"/>`
}

const EDGE = `<linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BONE}" stop-opacity="0.13"/><stop offset="0.5" stop-color="${BONE}" stop-opacity="0.02"/><stop offset="1" stop-color="${BONE}" stop-opacity="0.04"/></linearGradient>`

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
  const color = a.phase === 'break' ? MOSS : a.phase === 'focus' ? EMBER : a.phase === 'paused' ? ASH : KINDLING
  // While you focus the arc carries the whole heat ramp, deep red low on the left to gold at the top right.
  const stroke = a.phase === 'focus' ? 'url(#heat)' : color
  const isMoving = a.isLive && f0 < 1
  const seconds = a.isCountUp ? a.elapsedMs / 1000 : leftS
  const text = clockText(a.isCountUp ? Math.floor(seconds) : Math.ceil(seconds))
  const live = a.isLive ? liveDigits(seconds, a.isCountUp) : undefined
  const css: string[] = []

  // Counting down, the lit arc is what's left and burns away from the top,
  // clockwise. Flow has no end, so its arc grows toward the 25 minute mark.
  let arc: string

  if (a.phase === 'idle') {
    arc = `stroke-dasharray="${LEN.toFixed(1)}"`
  } else if (a.isCountUp) {
    arc = `stroke-dasharray="${(LEN * f0).toFixed(1)} ${LEN.toFixed(1)}" class="arc"`
    css.push(`@keyframes arc { to { stroke-dasharray: ${LEN.toFixed(1)} ${LEN.toFixed(1)}; } }`)
  } else {
    arc = `stroke-dasharray="${LEN.toFixed(1)} ${LEN.toFixed(1)}" stroke-dashoffset="${(-LEN * f0).toFixed(1)}" class="arc"`
    css.push(`@keyframes arc { to { stroke-dashoffset: ${(-LEN).toFixed(1)}; } }`)
  }

  if (isMoving) {
    css.push(`.arc { animation: arc ${leftS.toFixed(2)}s linear forwards; }`)
    css.push(`@keyframes tip { to { transform: rotate(360deg); } } .tip { animation: tip ${leftS.toFixed(2)}s linear forwards; }`)
  }

  // The tip: a coal with a soft halo while you focus, a plain bead otherwise.
  const isLit = a.phase === 'focus'
  const tip =
    a.phase === 'idle'
      ? ''
      : `<g class="tip" style="transform-origin: ${CX}px ${CY}px; transform: rotate(${(360 * f0).toFixed(2)}deg)">${
          isLit ? `<circle cx="${CX}" cy="${CY - R}" r="19" fill="url(#halo)" class="halo"/>` : ''
        }<circle cx="${CX}" cy="${CY - R}" r="${isLit ? 6 : 5}" fill="${isLit ? '#fff3d6' : a.phase === 'break' ? BONE : ASH}"/></g>`

  if (isLit) {
    css.push('.halo { animation: flicker 2.6s ease-in-out infinite; } @keyframes flicker { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }')
    css.push('.warm { animation: breathe 7s ease-in-out infinite; } @keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }')
    css.push('@media (prefers-reduced-motion: reduce) { .halo, .warm { animation: none; } }')
  }

  // A countdown that reaches zero rests on 00:00 instead of rolling round.
  if (live !== undefined && !a.isCountUp) {
    css.push(`.live { animation: gone 1ms linear ${leftS.toFixed(2)}s forwards; } @keyframes gone { to { visibility: hidden; } }`)
    css.push(`.rest { visibility: hidden; animation: here 1ms linear ${leftS.toFixed(2)}s forwards; } @keyframes here { to { visibility: visible; } }`)
  }

  const digits =
    live === undefined
      ? stillDigits(text)
      : `<g class="live">${live.svg}</g>${a.isCountUp ? '' : `<g class="rest">${stillDigits('00:00')}</g>`}`
  const pips =
    a.rounds > 1 && a.rounds <= 8
      ? Array.from({ length: a.rounds }, (_, i) => {
          const x = CX - ((a.rounds - 1) * 13) / 2 + i * 13
          const isDone = i < a.round - 1
          const isNow = i === a.round - 1

          return `<circle cx="${x}" cy="${CY + 66}" r="3" fill="${isDone ? color : 'none'}" stroke="${isDone || isNow ? color : KINDLING}" stroke-width="1.5"/>`
        }).join('')
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">
<title>${esc(a.label)} ${text}</title>
<defs>
<radialGradient id="halo"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.9"/><stop offset="0.35" stop-color="${EMBER}" stop-opacity="0.55"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient>
<radialGradient id="warm"><stop offset="0" stop-color="${EMBER}" stop-opacity="0.16"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient>
<linearGradient id="heat" gradientUnits="userSpaceOnUse" x1="${CX - R}" y1="${CY + R}" x2="${CX + R}" y2="${CY - R}"><stop offset="0" stop-color="${GARNET}"/><stop offset="0.55" stop-color="${EMBER}"/><stop offset="1" stop-color="${GOLD}"/></linearGradient>
${EDGE}
<clipPath id="win"><rect x="0" y="${BASE - 50}" width="${W}" height="${LINE}"/></clipPath>
</defs>
<style>
.d { font-family: ${FONT}; font-size: 50px; font-weight: 500; text-anchor: middle; fill: ${a.phase === 'idle' || a.phase === 'paused' ? ASH : BONE}; font-variant-numeric: tabular-nums; }
.t { font-family: ${FONT}; text-anchor: middle; }
${(live?.css ?? '') + '\n' + css.join('\n')}
</style>
${card(W, H, 26)}
${isLit ? `<circle cx="${CX}" cy="${CY}" r="${R - 6}" fill="url(#warm)" class="warm"/>` : ''}
${a.phase === 'idle' ? '' : `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${KINDLING}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 ${(LEN / 60 - 0.1).toFixed(3)}"/>`}
${a.phase === 'focus' || a.phase === 'break' ? `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-opacity="0.14" stroke-width="19" stroke-linecap="round" transform="rotate(-90 ${CX} ${CY})" ${arc}/>` : ''}
<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${stroke}" stroke-width="${a.phase === 'idle' ? 2 : 7}" stroke-linecap="round" transform="rotate(-90 ${CX} ${CY})" ${arc}/>
${a.phase === 'idle' ? `<circle cx="${CX}" cy="${CY - R}" r="5" fill="${CHAR}" stroke="${ASH}" stroke-width="1.5"/>` : ''}
${tip}
<text x="${CX}" y="${CY - 42}" class="t" font-size="13" font-weight="600" fill="${a.phase === 'idle' ? ASH : color}">${esc(a.label)}</text>
<g clip-path="url(#win)">${digits}<text x="${CX}" y="${BASE - 4}" class="d" opacity="0.5">:</text></g>
<text x="${CX}" y="${CY + 44}" class="t" font-size="12.5" fill="${ASH}">${esc(cut(a.sub, 26))}</text>
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
  /** Whether a focus block is running now: the next coal shows as catching. */
  isFocusing: boolean
  /** A block has just finished: its coal flares once as the card is drawn. */
  isFresh: boolean
  week: readonly { label: string; count: number; isToday: boolean }[]
}

/** Today as a row of coals, one per block of the goal, over the week's bars. */
export function daySvg(a: DayArgs): string {
  const width = W
  const height = 200
  const top = 84
  const base = 148
  const slot = (width - 16) / Math.max(1, a.week.length)
  const most = Math.max(a.goal, 1, ...a.week.map(d => d.count))
  const isEmpty = a.week.every(d => d.count === 0)
  const hasCoals = a.goal > 0 && a.goal <= 12
  const coals = hasCoals
    ? Array.from({ length: Math.max(a.goal, a.today) > 12 ? 12 : a.goal }, (_, i) => {
        const x = 23 + i * 19
        const isLit = i < a.today
        const isNext = i === a.today && a.isFocusing

        const flare =
          isLit && a.isFresh && i === a.today - 1
            ? `<circle cx="${x}" cy="52" r="7" fill="none" stroke="${GOLD}" stroke-width="2" opacity="0"><animate attributeName="r" values="7;20" dur="1.4s" begin="0.2s" fill="freeze"/><animate attributeName="opacity" values="0.9;0" dur="1.4s" begin="0.2s" fill="freeze"/></circle>`
            : ''

        return isLit
          ? `<circle cx="${x}" cy="52" r="6.5" fill="url(#coal)"/>${flare}`
          : `<circle cx="${x}" cy="52" r="5.75" fill="none" stroke="${isNext ? EMBER : KINDLING}" stroke-width="1.5" ${isNext ? '' : 'stroke-dasharray="1.6 2.4" stroke-linecap="round"'}/>`
      }).join('')
    : ''
  const count = a.goal > 0 ? `${a.today} of ${a.goal}` : `${a.today} ${a.today === 1 ? 'block' : 'blocks'}`
  const bars = a.week
    .map((day, i) => {
      const x = 8 + i * slot + slot / 2
      const h = day.count === 0 ? 3 : Math.max(6, ((base - top) * day.count) / most)
      const fill = day.count === 0 ? KINDLING : day.isToday ? 'url(#bar)' : CINDER
      const n = day.count > 0 ? `<text x="${x}" y="${base - h - 6}" text-anchor="middle" font-size="11" fill="${day.isToday ? BONE : ASH}">${day.count}</text>` : ''

      return `<rect x="${(x - 10).toFixed(1)}" y="${(base - h).toFixed(1)}" width="20" height="${h.toFixed(1)}" rx="5" fill="${fill}"/>${n}<text x="${x}" y="${base + 17}" text-anchor="middle" font-size="11" font-weight="${day.isToday ? 700 : 400}" fill="${day.isToday ? BONE : ASH}">${esc(day.label.slice(0, 1))}</text>`
    })
    .join('')
  const goalY = base - ((base - top) * a.goal) / most
  const goalLine =
    a.goal > 0 && !isEmpty
      ? `<line x1="16" x2="${width - 16}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}" stroke="${ASH}" stroke-opacity="0.35" stroke-dasharray="3 4"/>`
      : ''
  const hint = isEmpty
    ? `<text x="${width / 2}" y="${(top + base) / 2 + 4}" text-anchor="middle" font-size="12" fill="${ASH}">Your week fills in as you finish blocks</text>`
    : ''
  const streak = a.streak > 0 ? `${a.streak} day streak` : 'No streak yet'
  const onTask = a.onTask === undefined ? '' : `<text x="${width - 16}" y="${height - 14}" text-anchor="end" font-size="11.5" fill="${ASH}">${Math.round(a.onTask * 100)}% on task</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * 2}" height="${height * 2}" font-family="${FONT}">
<title>Today ${count}, ${a.minutes} min, ${streak}</title>
<defs>
<radialGradient id="coal" cx="0.38" cy="0.34" r="0.75"><stop offset="0" stop-color="${GOLD}"/><stop offset="0.5" stop-color="${EMBER}"/><stop offset="1" stop-color="${GARNET}"/></radialGradient>
<linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD}"/><stop offset="0.45" stop-color="${EMBER}"/><stop offset="1" stop-color="${GARNET}"/></linearGradient>
${EDGE}
</defs>
${card(width, height, 22)}
<text x="16" y="28" font-size="13" font-weight="600" fill="${BONE}">Today</text>
<text x="${width - 16}" y="28" text-anchor="end" font-size="12" fill="${ASH}">${a.minutes} min of focus</text>
${coals}
<text x="${width - 16}" y="${hasCoals ? 56 : 52}" text-anchor="end" font-size="12" fill="${ASH}" style="font-variant-numeric: tabular-nums">${count}</text>
${goalLine}${bars}${hint}
<text x="16" y="${height - 14}" font-size="11.5" fill="${ASH}">${streak}</text>${onTask}
</svg>`
}
