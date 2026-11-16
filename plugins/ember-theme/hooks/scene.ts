// The hearth: what the Ember theme draws behind the conversation. A bed of
// coals glowing at the foot of the window, and a few sparks drifting up from
// it. It follows the Hearth design system (DESIGN.md at the repository root):
// only fire moves, and it moves slowly enough to sit at the edge of sight.

const SOOT = '#1a0f0c'
const GOLD = '#ffcf70'
const EMBER = '#ff7a1f'
const GARNET = '#d93a1a'

/** A small repeatable random source, so the scene is the same every time. */
function seeded(seed: number): () => number {
  let s = seed

  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296

    return s / 4294967296
  }
}

/** The scene's SVG. `hasSparks: false` leaves the glow alone, quite still. */
export function hearthSvg(hasSparks: boolean): string {
  const rand = seeded(7)
  const sparks = hasSparks
    ? Array.from({ length: 18 }, (_, i) => {
        // One spark to each slice of the width, so they never bunch up.
        const x = 40 + ((i + rand()) / 18) * 1520
        const r = 2.2 + rand() * 2.6
        const rise = 300 + rand() * 380
        const drift = (rand() - 0.5) * 160
        const dur = 15 + rand() * 20
        const wait = rand() * dur
        const sway = 4 + rand() * 4

        return `<g class="rise" style="--h:${rise.toFixed(0)}px;--x:${drift.toFixed(0)}px;animation-duration:${dur.toFixed(1)}s;animation-delay:-${wait.toFixed(1)}s"><circle class="sway" style="animation-duration:${sway.toFixed(1)}s" cx="${x.toFixed(0)}" cy="1004" r="${r.toFixed(1)}" fill="url(#spark)"/></g>`
      }).join('')
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
<defs>
<radialGradient id="bed"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.6"/><stop offset="0.16" stop-color="${EMBER}" stop-opacity="0.48"/><stop offset="0.42" stop-color="${GARNET}" stop-opacity="0.27"/><stop offset="0.72" stop-color="${GARNET}" stop-opacity="0.09"/><stop offset="1" stop-color="${GARNET}" stop-opacity="0"/></radialGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GARNET}" stop-opacity="0"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0.2"/></linearGradient>
<radialGradient id="coal"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.34"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient>
<radialGradient id="spark"><stop offset="0" stop-color="#fff3d6"/><stop offset="0.3" stop-color="${GOLD}"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient>
<linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120a08"/><stop offset="0.5" stop-color="${SOOT}" stop-opacity="0"/></linearGradient>
</defs>
<style>
.bed { animation: breathe 11s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { opacity: 0.78; } 50% { opacity: 1; } }
.rise { opacity: 0; animation: rise linear infinite; }
@keyframes rise { 0% { transform: translate(0, 0); opacity: 0; } 7% { opacity: 0.85; } 55% { opacity: 0.45; } 100% { transform: translate(var(--x), calc(-1 * var(--h))); opacity: 0; } }
.sway { animation: sway ease-in-out infinite alternate; }
@keyframes sway { from { transform: translateX(-9px); } to { transform: translateX(9px); } }
@media (prefers-reduced-motion: reduce) { .bed, .sway { animation: none; } .rise { display: none; } }
</style>
<rect width="1600" height="1000" fill="${SOOT}"/>
<rect width="1600" height="1000" fill="url(#night)"/>
<g class="bed"><ellipse cx="800" cy="1030" rx="1300" ry="560" fill="url(#bed)"/><rect y="760" width="1600" height="240" fill="url(#floor)"/></g>
<ellipse cx="330" cy="1005" rx="430" ry="170" fill="url(#coal)"/>
<ellipse cx="1220" cy="1010" rx="520" ry="190" fill="url(#coal)"/>
${sparks}
</svg>`
}
