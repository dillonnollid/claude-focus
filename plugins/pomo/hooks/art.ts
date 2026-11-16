// The dashboard's two drawings, as SVG text: the timer ring and the week's
// bars. Each carries its own dark card behind it, so it reads the same over
// any theme. Colours are Ember's.

const CARD = '#1b1815'
const TRACK = '#2c2620'
const CREAM = '#f3e6cf'
const MUTED = '#ad9c84'
const EMBER = '#ff7a1a'
const EMBER_DIM = '#7a4318'
const GREEN = '#9acb55'

function esc(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/**
 * A ring that fills as the block runs, with the time left in the middle.
 * `fraction` is how much of the block has gone, from 0 to 1.
 */
export function ringSvg(args: {
  fraction: number
  phase: 'idle' | 'focus' | 'break' | 'paused'
  label: string
  clock: string
  sub: string
}): string {
  const size = 240
  const c = size / 2
  const r = 96
  const length = 2 * Math.PI * r
  const f = Math.min(1, Math.max(0, args.fraction))
  const color = args.phase === 'break' ? GREEN : args.phase === 'paused' || args.phase === 'idle' ? MUTED : EMBER
  const glow = args.phase === 'focus' ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${EMBER}" stroke-opacity="0.18" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(length * f).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" rx="28" fill="${CARD}"/>
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="10"/>
${glow}
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(length * f).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>
<text x="${c}" y="${c - 30}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="12" font-weight="600" letter-spacing="2.5" fill="${color}">${esc(args.label.toUpperCase())}</text>
<text x="${c}" y="${c + 16}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="48" font-weight="600" fill="${CREAM}" style="font-variant-numeric: tabular-nums">${esc(args.clock)}</text>
<text x="${c}" y="${c + 42}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="12" fill="${MUTED}">${esc(args.sub)}</text>
</svg>`
}

/** Seven bars, oldest first, today in full ember. */
export function weekSvg(week: readonly { label: string; count: number; isToday: boolean }[], goal: number): string {
  const width = 280
  const height = 112
  const top = 22
  const base = 84
  const slot = width / Math.max(1, week.length)
  const most = Math.max(goal, 1, ...week.map(d => d.count))
  const bars = week
    .map((day, i) => {
      const x = i * slot + slot / 2
      const h = day.count === 0 ? 3 : Math.max(6, ((base - top) * day.count) / most)
      const fill = day.count === 0 ? TRACK : day.isToday ? EMBER : EMBER_DIM
      const count =
        day.count > 0
          ? `<text x="${x}" y="${base - h - 6}" text-anchor="middle" font-size="11" fill="${day.isToday ? CREAM : MUTED}">${day.count}</text>`
          : ''
      const initial = esc(day.label.slice(0, 1))

      return `<rect x="${(x - 11).toFixed(1)}" y="${(base - h).toFixed(1)}" width="22" height="${h.toFixed(1)}" rx="5" fill="${fill}"/>${count}<text x="${x}" y="${base + 18}" text-anchor="middle" font-size="11" font-weight="${day.isToday ? 700 : 400}" fill="${day.isToday ? CREAM : MUTED}">${initial}</text>`
    })
    .join('')
  const goalY = base - ((base - top) * goal) / most
  const goalLine =
    goal > 0
      ? `<line x1="6" x2="${width - 6}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}" stroke="${MUTED}" stroke-opacity="0.35" stroke-dasharray="3 4"/>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">
<rect width="${width}" height="${height}" rx="16" fill="${CARD}"/>
${goalLine}${bars}
</svg>`
}
