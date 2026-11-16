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
// A block burns down like a stick of incense: the lit arc is the time left,
// shrinking behind a glowing tip. The ring is drawn afresh each minute and
// holds no countdown of its own (see ringSvg for why).

// The Hearth palette. ember-theme's register.tsx holds the same values.
const CHAR = '#1e1013'
const KINDLING = '#45222a'
const BONE = '#fbeee4'
const ASH = '#bd9c93'
const GOLD = '#ffc640'
const EMBER = '#ff6a1a'
const CINDER = '#a8381f'
const GARNET = '#e8341c'
const MOSS = '#b6d65a'
const FONT = "ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** A card's ground: char, with a hairline of light along its top edge. */
function card(width: number, height: number, rx: number): string {
  return `<rect width="${width}" height="${height}" rx="${rx}" fill="${CHAR}"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${rx - 0.5}" fill="none" stroke="url(#edge)"/>`
}

const EDGE = `<linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BONE}" stop-opacity="0.13"/><stop offset="0.5" stop-color="${BONE}" stop-opacity="0.02"/><stop offset="1" stop-color="${BONE}" stop-opacity="0.04"/></linearGradient>`

function esc(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** Whole seconds as `MM:SS`, the minutes running past 99 for a long flow. */
export function clockText(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds))

  return `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toString().padStart(2, '0')}`
}

export type RingArgs = {
  phase: 'idle' | 'focus' | 'break' | 'paused'
  label: string
  /** Milliseconds the block has run. */
  elapsedMs: number
  /** Its whole length in milliseconds; for flow, the mark the ring fills to. */
  lengthMs: number
  /** Counting up (flow) rather than down. */
  isCountUp: boolean
  /** Which block of the set this is, from 1, and how many make a set; 0 hides the pips. */
  round: number
  rounds: number
  /** How far ahead to animate the arc, in milliseconds; 0 draws it still. */
  moveMs: number
}

// Both cards share one width, so the pane stretches them to the same scale.
const W = 320
const H = 264
const CX = W / 2
const CY = H / 2
const R = 96
const LEN = 2 * Math.PI * R

/**
 * The ring for one moment: the lit arc is the time left, burning away
 * clockwise from the top, and the middle says it in whole minutes.
 *
 * The arc moves smoothly, but only a short way ahead (`moveMs`): the app
 * redraws an image whenever it likes (a window switch, a tab change) and
 * restarts its animations, so a drawing that ran the whole block showed the
 * time it was drawn at. pomo draws a fresh one every ten seconds, so a
 * restart puts the arc back by seconds at most, and the minutes never lie.
 */
export function ringSvg(a: RingArgs): string {
  const length = Math.max(1, a.lengthMs)
  const f0 = Math.min(1, Math.max(0, a.elapsedMs / length))
  const leftMs = Math.max(0, length - a.elapsedMs)
  const color = a.phase === 'break' ? MOSS : a.phase === 'focus' ? EMBER : a.phase === 'paused' ? ASH : KINDLING
  // While you focus the arc carries the whole heat ramp, deep red low on the left to gold at the top right.
  const stroke = a.phase === 'focus' ? 'url(#heat)' : color
  const seconds = a.isCountUp ? Math.floor(a.elapsedMs / 1000) : Math.ceil(leftMs / 1000)
  // Whole minutes, as a person reads a clock across the room; under one is "<1".
  const minutes = a.isCountUp ? Math.floor(a.elapsedMs / 60_000) : leftMs > 0 && leftMs < 60_000 ? -1 : Math.ceil(leftMs / 60_000)
  const big = minutes === -1 ? '<1' : String(minutes)
  const unit = a.phase === 'idle' ? 'minute block' : a.isCountUp ? (minutes === 1 ? 'minute in' : 'minutes in') : minutes === 1 ? 'minute left' : 'minutes left'

  // Where the arc will be when this drawing's motion ends, and how long it takes to get there.
  const f1 = a.moveMs > 0 ? Math.min(1, (a.elapsedMs + a.moveMs) / length) : f0
  const moveS = f1 > f0 ? ((f1 - f0) * length) / 1000 : 0
  const css =
    moveS > 0
      ? `.arc { animation: arc ${moveS.toFixed(2)}s linear forwards; } @keyframes arc { to { ${a.isCountUp ? `stroke-dasharray: ${(LEN * f1).toFixed(2)} ${LEN.toFixed(1)}` : `stroke-dashoffset: ${(-LEN * f1).toFixed(2)}`}; } }
.tip { transform-origin: ${CX}px ${CY}px; animation: tip ${moveS.toFixed(2)}s linear forwards; } @keyframes tip { from { transform: rotate(0deg); } to { transform: rotate(${(360 * (f1 - f0)).toFixed(3)}deg); } }`
      : ''

  // Counting down, the lit arc is what's left; flow's grows toward its mark.
  const arc =
    a.phase === 'idle'
      ? `stroke-dasharray="${LEN.toFixed(1)}"`
      : a.isCountUp
        ? `stroke-dasharray="${(LEN * f0).toFixed(2)} ${LEN.toFixed(1)}" class="arc"`
        : `stroke-dasharray="${LEN.toFixed(1)} ${LEN.toFixed(1)}" stroke-dashoffset="${(-LEN * f0).toFixed(2)}" class="arc"`

  // The tip: a coal with a soft halo while you focus, a plain bead otherwise.
  const isLit = a.phase === 'focus'
  const tip =
    a.phase === 'idle'
      ? `<circle cx="${CX}" cy="${CY - R}" r="5" fill="${CHAR}" stroke="${ASH}" stroke-width="1.5"/>`
      : `<g transform="rotate(${(360 * f0).toFixed(3)} ${CX} ${CY})"><g class="tip">${
          isLit ? `<circle cx="${CX}" cy="${CY - R}" r="19" fill="url(#halo)" class="halo"/>` : ''
        }<circle cx="${CX}" cy="${CY - R}" r="${isLit ? 6 : 5}" fill="${isLit ? '#fff3d6' : a.phase === 'break' ? BONE : ASH}"/></g></g>`
  const pips =
    a.rounds > 1 && a.rounds <= 8
      ? Array.from({ length: a.rounds }, (_, i) => {
          const x = CX - ((a.rounds - 1) * 13) / 2 + i * 13
          const isDone = i < a.round - 1
          const isNow = i === a.round - 1

          return `<circle cx="${x}" cy="${CY + 62}" r="3" fill="${isDone ? color : 'none'}" stroke="${isDone || isNow ? color : KINDLING}" stroke-width="1.5"/>`
        }).join('')
      : ''
  const isStill = a.phase === 'idle' || a.phase === 'paused'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}" font-family="${FONT}">
<title>${esc(a.label)} ${clockText(seconds)}</title>
<defs>
<radialGradient id="halo"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.9"/><stop offset="0.35" stop-color="${EMBER}" stop-opacity="0.55"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient>
<radialGradient id="warm"><stop offset="0" stop-color="${EMBER}" stop-opacity="0.16"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient>
<linearGradient id="heat" gradientUnits="userSpaceOnUse" x1="${CX - R}" y1="${CY + R}" x2="${CX + R}" y2="${CY - R}"><stop offset="0" stop-color="${GARNET}"/><stop offset="0.55" stop-color="${EMBER}"/><stop offset="1" stop-color="${GOLD}"/></linearGradient>
${EDGE}
</defs>
<style>
.halo { animation: flicker 2.6s ease-in-out infinite; } @keyframes flicker { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
.warm { animation: breathe 7s ease-in-out infinite; } @keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
${css}
@media (prefers-reduced-motion: reduce) { .halo, .warm { animation: none; } }
</style>
${card(W, H, 26)}
${isLit ? `<circle cx="${CX}" cy="${CY}" r="${R - 6}" fill="url(#warm)" class="warm"/>` : ''}
<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${KINDLING}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 ${(LEN / 60 - 0.1).toFixed(3)}"/>
${a.phase === 'focus' || a.phase === 'break' ? `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-opacity="0.14" stroke-width="19" stroke-linecap="round" transform="rotate(-90 ${CX} ${CY})" ${arc}/>` : ''}
${a.phase === 'idle' ? '' : `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="round" transform="rotate(-90 ${CX} ${CY})" ${arc}/>`}
${tip}
<text x="${CX}" y="${CY - 36}" text-anchor="middle" font-size="13" font-weight="600" fill="${a.phase === 'idle' ? ASH : color}">${esc(a.label)}</text>
<text x="${CX}" y="${CY + 22}" text-anchor="middle" font-size="64" font-weight="600" letter-spacing="-1.5" fill="${isStill ? ASH : BONE}" style="font-variant-numeric: tabular-nums">${esc(big)}</text>
<text x="${CX}" y="${CY + 42}" text-anchor="middle" font-size="12.5" fill="${ASH}">${unit}</text>
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

        return isLit
          ? `<circle cx="${x}" cy="52" r="6.5" fill="url(#coal)"/>`
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
