// The dashboard's drawings, as SVG text: the timer ring, the stat tiles and
// the week's bars. Each carries its own dark card, so it reads the same over
// any theme. Colours are Ember's.
//
// The ring animates itself between redraws: its seconds, its sweep, the dot
// at the tip and the breathing glow all run as SMIL and CSS inside the SVG.
// Every animation is phase-aligned to the clock, so when the plugin redraws
// it (every ten seconds) the new drawing carries on exactly where the old
// one was, and a surface that doesn't animate still shows the right time.

const CARD = '#1b1815'
const TRACK = '#2c2620'
const CREAM = '#f3e6cf'
const MUTED = '#ad9c84'
const EMBER = '#ff7a1a'
const EMBER_DIM = '#7a4318'
const GREEN = '#9acb55'
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'

function esc(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function clockText(totalSeconds: number): string {
  const t = Math.max(0, totalSeconds)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  const ss = sec.toString().padStart(2, '0')

  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export type RingArgs = {
  phase: 'idle' | 'focus' | 'break' | 'paused'
  label: string
  sub: string
  /** Milliseconds the block has run. */
  elapsedMs: number
  /** Its whole length in milliseconds; for flow, the mark the ring fills to. */
  lengthMs: number
  /** Counting up (flow) rather than down. */
  isCountUp: boolean
  /** Whether the clock is moving: false while paused or idle. */
  isLive: boolean
  /** Milliseconds since the epoch, for aligning the glow. */
  now: number
  /** Milliseconds since the block began, for the one-off burst at a break. */
  sinceStartMs: number
}

/** The ring that fills as the block runs, with the time in the middle. */
export function ringSvg(a: RingArgs): string {
  const size = 240
  const c = size / 2
  const r = 96
  const L = 2 * Math.PI * r
  const length = Math.max(1, a.lengthMs)
  const f0 = Math.min(1, Math.max(0, a.elapsedMs / length))
  const color = a.phase === 'break' ? GREEN : a.phase === 'focus' ? EMBER : MUTED
  const left = Math.max(0, length - a.elapsedMs) / 1000
  const shown = (ms: number) => (a.isCountUp ? Math.floor(ms / 1000) : Math.ceil((length - ms) / 1000))

  // The arc: drawn from 12 o'clock, its length animated to full over the time left.
  const filled = (L * f0).toFixed(1)
  const sweep =
    a.isLive && f0 < 1
      ? `<animate attributeName="stroke-dasharray" from="${filled} ${L.toFixed(1)}" to="${L.toFixed(1)} ${L.toFixed(1)}" dur="${left.toFixed(2)}s" fill="freeze"/>`
      : ''
  const tipAngle = (360 * f0).toFixed(2)
  const tip =
    a.phase === 'idle'
      ? ''
      : `<g transform="rotate(${tipAngle} ${c} ${c})"><circle cx="${c}" cy="${c - r}" r="7" fill="${CREAM}"/>${
          a.isLive && f0 < 1
            ? `<animateTransform attributeName="transform" type="rotate" from="${tipAngle} ${c} ${c}" to="360 ${c} ${c}" dur="${left.toFixed(2)}s" fill="freeze"/>`
            : ''
        }</g>`

  // The seconds: seventy frames, each shown for its second, so the clock runs
  // between redraws. The first frame lasts until the next whole second.
  let digits: string
  const first = shown(a.elapsedMs)

  if (!a.isLive) {
    digits = `<text x="${c}" y="${c + 16}" class="clock">${clockText(first)}</text>`
  } else {
    const msIntoSecond = a.isCountUp ? a.elapsedMs % 1000 : (1000 - ((length - a.elapsedMs) % 1000)) % 1000
    const firstFor = (1000 - msIntoSecond) / 1000
    const frames: string[] = []

    const count = a.isCountUp ? 70 : Math.min(70, first + 1)

    for (let i = 0; i < count; i += 1) {
      const value = a.isCountUp ? first + i : first - i
      const isLast = i === count - 1
      const begin = i === 0 ? 0 : firstFor + (i - 1)
      // The last frame stays up, so a surface that stops redrawing never goes blank.
      const hide = isLast ? '' : `<set attributeName="visibility" to="hidden" begin="${(i === 0 ? firstFor : begin + 1).toFixed(3)}s"/>`
      const timing = i === 0 ? hide : `<set attributeName="visibility" to="visible" begin="${begin.toFixed(3)}s"/>${hide}`
      frames.push(`<text x="${c}" y="${c + 16}" class="clock" visibility="${i === 0 ? 'visible' : 'hidden'}">${clockText(value)}${timing}</text>`)
    }

    digits = frames.join('')
  }

  // The glow breathes on a six second cycle (about the pace of a slow breath).
  const breathe = a.phase === 'focus' ? `animation: breathe 6s ease-in-out infinite; animation-delay: -${((a.now % 6000) / 1000).toFixed(2)}s;` : ''
  const glow =
    a.phase === 'focus'
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${EMBER}" stroke-width="24" stroke-linecap="round" stroke-dasharray="${filled} ${L.toFixed(1)}" transform="rotate(-90 ${c} ${c})" class="glow">${sweep}</circle>`
      : ''

  // A soft ring that rolls out once when a break begins.
  const burst =
    a.phase === 'break' && a.sinceStartMs < 4000
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${GREEN}" stroke-width="3" opacity="0"><animate attributeName="r" from="${r}" to="${r + 18}" dur="1.6s" begin="${(-a.sinceStartMs / 1000).toFixed(2)}s" fill="freeze"/><animate attributeName="opacity" values="0.7;0" dur="1.6s" begin="${(-a.sinceStartMs / 1000).toFixed(2)}s" fill="freeze"/></circle>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<style>
.clock { font-family: ${FONT}; font-size: 48px; font-weight: 600; fill: ${CREAM}; text-anchor: middle; font-variant-numeric: tabular-nums; }
.glow { opacity: 0.16; ${breathe} }
@keyframes breathe { 0%, 100% { opacity: 0.08; } 50% { opacity: 0.32; } }
</style>
<rect width="${size}" height="${size}" rx="28" fill="${CARD}"/>
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="10"/>
${glow}
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${filled} ${L.toFixed(1)}" transform="rotate(-90 ${c} ${c})">${sweep}</circle>
${tip}
${burst}
<text x="${c}" y="${c - 30}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="600" letter-spacing="2.5" fill="${color}">${esc(a.label.toUpperCase())}</text>
${digits}
<text x="${c}" y="${c + 42}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${MUTED}">${esc(a.sub)}</text>
</svg>`
}

export type Tile = { label: string; value: string; note?: string; fill?: number }

/** A row of small stat tiles, each with an optional bar along its foot. */
export function tilesSvg(tiles: readonly Tile[]): string {
  const width = 280
  const gap = 8
  const height = 72
  const w = (width - gap * (tiles.length - 1)) / tiles.length
  const cells = tiles
    .map((t, i) => {
      const x = i * (w + gap)
      const bar =
        t.fill === undefined
          ? ''
          : `<rect x="${(x + 10).toFixed(1)}" y="${height - 12}" width="${(w - 20).toFixed(1)}" height="4" rx="2" fill="${TRACK}"/><rect x="${(x + 10).toFixed(1)}" y="${height - 12}" width="${((w - 20) * Math.min(1, Math.max(0, t.fill))).toFixed(1)}" height="4" rx="2" fill="${EMBER}"/>`

      return `<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="${height}" rx="12" fill="${CARD}"/>
<text x="${(x + 10).toFixed(1)}" y="20" font-size="9.5" font-weight="600" letter-spacing="1.2" fill="${MUTED}">${esc(t.label.toUpperCase())}</text>
<text x="${(x + 10).toFixed(1)}" y="46" font-size="22" font-weight="600" fill="${CREAM}" style="font-variant-numeric: tabular-nums">${esc(t.value)}${
        t.note === undefined ? '' : `<tspan font-size="11" font-weight="400" fill="${MUTED}"> ${esc(t.note)}</tspan>`
      }</text>${bar}`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}">${cells}</svg>`
}

/** Seven bars, oldest first, today in full ember, the goal as a dotted line. */
export function weekSvg(week: readonly { label: string; count: number; isToday: boolean }[], goal: number): string {
  const width = 280
  const height = 112
  const top = 22
  const base = 84
  const slot = width / Math.max(1, week.length)
  const most = Math.max(goal, 1, ...week.map(d => d.count))
  const isEmpty = week.every(d => d.count === 0)
  const bars = week
    .map((day, i) => {
      const x = i * slot + slot / 2
      const h = day.count === 0 ? 3 : Math.max(6, ((base - top) * day.count) / most)
      const fill = day.count === 0 ? TRACK : day.isToday ? EMBER : EMBER_DIM
      const count =
        day.count > 0
          ? `<text x="${x}" y="${base - h - 6}" text-anchor="middle" font-size="11" fill="${day.isToday ? CREAM : MUTED}">${day.count}</text>`
          : ''

      return `<rect x="${(x - 11).toFixed(1)}" y="${(base - h).toFixed(1)}" width="22" height="${h.toFixed(1)}" rx="5" fill="${fill}"/>${count}<text x="${x}" y="${base + 18}" text-anchor="middle" font-size="11" font-weight="${day.isToday ? 700 : 400}" fill="${day.isToday ? CREAM : MUTED}">${esc(day.label.slice(0, 1))}</text>`
    })
    .join('')
  const goalY = base - ((base - top) * goal) / most
  const goalLine =
    goal > 0 && !isEmpty
      ? `<line x1="6" x2="${width - 6}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}" stroke="${MUTED}" stroke-opacity="0.35" stroke-dasharray="3 4"/>`
      : ''
  const hint = isEmpty
    ? `<text x="${width / 2}" y="${(top + base) / 2 + 4}" text-anchor="middle" font-size="12" fill="${MUTED}">Your week fills in as you finish blocks</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}">
<rect width="${width}" height="${height}" rx="16" fill="${CARD}"/>
${goalLine}${bars}${hint}
</svg>`
}
