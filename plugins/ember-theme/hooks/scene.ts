// The ash field: what the Ember theme draws behind the conversation. A faint
// scatter of ASCII glyphs along the edges of the window, thinning to nothing
// before it reaches the chat in the middle or the message box at the foot.
// A few glyphs breathe slowly and a few specks drift up.
//
// It follows the pomo timer when pomo is installed: still and grey when
// nothing is running, a few embers glowing among the ash while you focus,
// moss and slower while you rest, and frozen while a block is paused.

export type Phase = 'idle' | 'focus' | 'break' | 'paused'

const ASH = '#efe9de'
const EMBER = '#ff7a1f'
const MOSS = '#b3c95a'
const MONO = "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"

const VW = 1600
const VH = 1000
const CELL_W = 24
const CELL_H = 30

/** A small repeatable random source, so the field is the same every time. */
function seeded(seed: number): () => number {
  let s = seed

  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296

    return s / 4294967296
  }
}

const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))

  return t * t * (3 - 2 * t)
}

/** The scene's SVG for a phase of the timer. */
export function ashSvg(phase: Phase): string {
  const rand = seeded(11)
  const warm = phase === 'focus' ? EMBER : phase === 'break' ? MOSS : ''
  const isStill = phase === 'paused'
  const pace = phase === 'break' ? 1.6 : 1
  const glyphs: string[] = []

  for (let y = CELL_H; y < VH; y += CELL_H) {
    for (let x = CELL_W / 2; x < VW; x += CELL_W) {
      // Dense at the sides, gone by the chat column; thin along the top, none at the foot.
      const side = smooth(0.42, 0.95, Math.abs(x / VW - 0.5) * 2)
      const top = smooth(0.32, 0, y / VH) * 0.5
      const foot = smooth(0.92, 0.72, y / VH)
      const weight = Math.max(side, top) * foot
      const roll = rand()
      const pick = rand()
      const twinkle = rand()

      if (roll > weight * 0.5) {
        continue
      }

      const char = weight > 0.75 && pick < 0.3 ? (pick < 0.12 ? '+' : ':') : pick < 0.6 ? '·' : '.'
      const isWarm = warm !== '' && pick > 0.82 && weight > 0.4
      const opacity = (0.1 + weight * 0.22 + (isWarm ? 0.3 : 0)).toFixed(2)
      const breathes = !isStill && twinkle < 0.22
      const style = breathes ? ` class="b" style="animation-duration:${((6 + twinkle * 30) * pace).toFixed(1)}s;animation-delay:-${(twinkle * 40).toFixed(1)}s"` : ''

      glyphs.push(`<text x="${x}" y="${y}" fill="${isWarm ? warm : ASH}" fill-opacity="${opacity}"${style}>${isWarm ? '*' : char}</text>`)
    }
  }

  // A few specks rising along each side while the clock runs.
  const drift =
    phase === 'focus' || phase === 'break'
      ? Array.from({ length: 14 }, (_, i) => {
          const x = i % 2 === 0 ? 40 + rand() * 300 : VW - 40 - rand() * 300
          const dur = (28 + rand() * 24) * pace

          return `<text x="${x.toFixed(0)}" y="${(VH * 0.8).toFixed(0)}" class="d" fill="${warm}" style="animation-duration:${dur.toFixed(1)}s;animation-delay:-${(rand() * dur).toFixed(1)}s">·</text>`
        }).join('')
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid slice">
<style>
text { font-family: ${MONO}; font-size: 15px; text-anchor: middle; }
.b { animation: b ease-in-out infinite alternate; }
@keyframes b { from { opacity: 1; } to { opacity: 0.2; } }
.d { opacity: 0; font-size: 16px; animation: d linear infinite; }
@keyframes d { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: 0.5; } 100% { transform: translateY(-640px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .b, .d { animation: none; } .d { display: none; } }
</style>
<rect width="${VW}" height="${VH}" fill="#161513"/>
${glyphs.join('')}
${drift}
</svg>`
}
