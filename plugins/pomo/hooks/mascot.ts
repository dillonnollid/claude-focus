// Cinder, the little ember that keeps you company: chunky pixel art in the
// style of a 1920s rubber-hose cartoon (pie-cut eyes, white gloves, hose arms
// and big shoes), with ASCII effects. An original character, not anyone's
// mascot. One SVG per pose, animated by CSS alone, so it plays by itself
// between the dashboard's redraws.
//
// The sprite is 24 by 22 pixels on a 4 point grid. Each layer is a list of
// pixels in one colour, drawn as a single path.

const EMBER = '#ff7a1f'
const SHADE = '#c9530e'
const LIGHT = '#ffc08a'
const INK = '#1a1310'
// Hose arms and legs: light enough to read on a dark card.
const LIMB = '#9c8471'
const GLOVE = '#f7efe1'
const SHOE = '#3b2a20'
const SHOE_LIGHT = '#6b5244'
const KEY = '#4a3b31'
const KEYTOP = '#7a6656'
const MUG = '#f4e8d6'
const TONGUE = '#e0584f'
const SECOND = '#cdb9a2'
const MOSS = '#b3c95a'
const MONO = "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"

const P = 4
const W = 136
const H = 112
const OX = 20
const OY = 18

type Px = readonly (readonly [number, number])[]

const rect = (x: number, y: number, w: number, h: number): [number, number][] =>
  Array.from({ length: w * h }, (_, i) => [x + (i % w), y + Math.floor(i / w)])

/** One colour's pixels as a single path, runs along a row merged. */
function paint(px: Px, fill: string): string {
  const rows = new Map<number, number[]>()

  for (const [x, y] of px) {
    rows.set(y, [...(rows.get(y) ?? []), x])
  }

  let d = ''

  for (const [y, xs] of rows) {
    const sorted = [...new Set(xs)].sort((a, b) => a - b)
    let start = sorted[0] ?? 0
    let prev = start - 1

    for (const x of [...sorted, Number.NaN]) {
      if (x !== prev + 1) {
        d += `M${OX + start * P} ${OY + y * P}h${(prev - start + 1) * P}v${P}h-${(prev - start + 1) * P}z`
        start = x
      }

      prev = x
    }
  }

  return `<path fill="${fill}" d="${d}"/>`
}

// The body: a round ember, shaded on its right, with a wisp of flame on top.
const BODY: [number, number][] = []
const SHADOW: [number, number][] = []

for (let y = 4; y <= 17; y += 1) {
  for (let x = 2; x <= 21; x += 1) {
    const dx = (x + 0.5 - 12) / 9
    const dy = (y + 0.5 - 11) / 7

    if (dx * dx + dy * dy <= 1) {
      ;(dx > 0.6 || dy > 0.82 ? SHADOW : BODY).push([x, y])
    }
  }
}

const FLAME: Px = [[11, 1], [11, 2], [12, 2], [11, 3], [12, 3], [13, 3]]
const SHINE: Px = [[11, 0], [12, 1], [6, 7], [7, 7], [6, 8]]
const LEGS: Px = [[9, 18], [9, 19], [14, 18], [14, 19]]
const SHOES: Px = [...rect(6, 20, 4, 2), [5, 21], ...rect(14, 20, 4, 2), [18, 21]]
const SHOE_SHINE: Px = [[7, 20], [15, 20]]

const EYES = {
  // Pie-cut: a tall black oval with a wedge taken from its outer top corner.
  open: [[9, 8], ...rect(8, 9, 2, 3), [14, 8], ...rect(14, 9, 2, 3)],
  down: [[9, 9], ...rect(8, 10, 2, 3), [14, 9], ...rect(14, 10, 2, 3)],
  shut: [...rect(8, 10, 2, 1), ...rect(14, 10, 2, 1)],
  happy: [[7, 10], [8, 9], [9, 10], [14, 10], [15, 9], [16, 10]],
} satisfies Record<string, Px>

const SMILE: Px = [[10, 13], [11, 14], [12, 14], [13, 13]]
const GRIN: Px = [...rect(10, 13, 4, 1), [10, 14], [13, 14]]

/** A white glove: a round mitt with a thumb. */
const glove = (x: number, y: number, thumbLeft: boolean): Px => [...rect(x, y, 3, 3), [thumbLeft ? x - 1 : x + 3, y + 1]]

const POSES = {
  rest: { arms: [[2, 13], [1, 14], [21, 13], [22, 14]], gloves: [...glove(0, 15, false), ...glove(21, 15, true)] },
  typeA: { arms: [[4, 14], [5, 15], [19, 14], [18, 15]], gloves: [...glove(5, 16, true), ...glove(16, 15, false)] },
  typeB: { arms: [[4, 14], [5, 15], [19, 14], [18, 15]], gloves: [...glove(5, 15, true), ...glove(16, 16, false)] },
  cheer: { arms: [[3, 8], [2, 7], [1, 6], [20, 8], [21, 7], [22, 6]], gloves: [...glove(0, 3, false), ...glove(21, 3, true)] },
  mug: { arms: [[2, 13], [1, 14], [20, 12], [19, 12]], gloves: [...glove(0, 15, false), ...glove(17, 11, true)] },
} satisfies Record<string, { arms: Px; gloves: Px }>

const pose = (p: { arms: Px; gloves: Px }) => `${paint(p.arms, LIMB)}${paint(p.gloves, GLOVE)}`

const KEYBOARD = `${paint(rect(4, 18, 16, 1), KEYTOP)}${paint(rect(3, 19, 18, 1), KEY)}`
const MUG_PX = `${paint([...rect(20, 9, 3, 4)], MUG)}${paint([[23, 10], [23, 11]], MUG)}`
const HEADPHONES = paint([...rect(7, 1, 10, 1), [6, 2], [17, 2], [5, 3], [18, 3], [4, 4], [19, 4], ...rect(2, 8, 2, 3), ...rect(20, 8, 2, 3)], GLOVE)

export type MascotState = 'idle' | 'focus' | 'flow' | 'paused' | 'break'

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A glyph that floats up and fades, `delay` seconds into a `dur` second loop. */
function rising(text: string, x: number, y: number, dur: number, delay: number, fill: string, rise = 22): string {
  return `<text x="${x}" y="${y}" class="r" fill="${fill}" style="--h:-${rise}px;animation-duration:${dur}s;animation-delay:-${delay.toFixed(2)}s">${esc(text)}</text>`
}

const CSS = `
.r { font-family: ${MONO}; font-size: 12px; opacity: 0; animation: rise linear infinite; }
@keyframes rise { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 0.9; } 100% { transform: translateY(var(--h)); opacity: 0; } }
/* Each second frame starts hidden, so a still render shows one clean pose. */
.a { animation: a var(--t, 0.5s) step-end infinite; }
.b { opacity: 0; animation: b var(--t, 0.5s) step-end infinite; }
@keyframes a { 0% { opacity: 1; } 50% { opacity: 0; } }
@keyframes b { 0% { opacity: 0; } 50% { opacity: 1; } }
.open { animation: bo 4.2s step-end infinite; }
.shut { opacity: 0; animation: bs 4.2s step-end infinite; }
@keyframes bo { 0% { opacity: 1; } 95% { opacity: 0; } }
@keyframes bs { 0% { opacity: 0; } 95% { opacity: 1; } }
/* The rubber-hose bounce: down a pixel, up a pixel, on the beat. */
.bounce { animation: bounce var(--t, 1.2s) step-end infinite; }
@keyframes bounce { 0% { transform: translateY(0); } 25% { transform: translateY(${P}px); } 50% { transform: translateY(0); } 75% { transform: translateY(-${P}px); } }
.jump { animation: jump 0.6s step-end 3; }
@keyframes jump { 0% { transform: translateY(0); } 25% { transform: translateY(-${P * 2}px); } 50% { transform: translateY(-${P * 4}px); } 75% { transform: translateY(-${P * 2}px); } }
.first { animation: first 1.8s step-end forwards; }
.later { opacity: 0; animation: later 1.8s step-end forwards; }
@keyframes first { 100% { opacity: 0; } }
@keyframes later { 100% { opacity: 1; } }
.pop { opacity: 0; animation: pop 1.8s steps(6) 1 forwards; }
@keyframes pop { 0% { opacity: 1; transform: translate(0, 0); } 100% { opacity: 0; transform: translate(var(--x), var(--y)); } }
@media (prefers-reduced-motion: reduce) { .r, .a, .b, .bounce, .jump, .pop, .open, .shut, .first, .later { animation: none; } .b, .shut, .r, .pop, .first { opacity: 0; } .later { opacity: 1; } }
`

/** The mascot for a state. `isFresh` marks a break that has only just begun: it cheers and jumps first. */
export function mascotSvg(state: MascotState, isFresh = false): string {
  const feet = `${paint(LEGS, LIMB)}${paint(SHOES, SHOE)}${paint(SHOE_SHINE, SHOE_LIGHT)}`
  const body = `${paint(BODY, EMBER)}${paint(SHADOW, SHADE)}${paint(FLAME, EMBER)}${paint(SHINE, LIGHT)}`
  let inner = ''
  let extra = ''
  let wrap = ''

  switch (state) {
    case 'idle':
      wrap = 'bounce'
      inner = `${feet}${body}${paint(SMILE, INK)}${pose(POSES.rest)}<g class="open">${paint(EYES.open, INK)}</g><g class="shut">${paint(EYES.shut, INK)}</g>`
      break

    case 'focus':
    case 'flow': {
      const isFlow = state === 'flow'
      const t = isFlow ? '0.32s' : '0.5s'
      wrap = isFlow ? 'bounce' : ''
      inner = `${feet}${body}${paint(EYES.down, INK)}${paint(SMILE, INK)}${isFlow ? HEADPHONES : ''}${KEYBOARD}<g class="a" style="--t:${t}">${pose(POSES.typeA)}</g><g class="b" style="--t:${t}">${pose(POSES.typeB)}</g>`
      // Code, in ASCII, drifting up off both ends of the keyboard.
      const glyphs = isFlow ? ['{', '}', ';', '<', '/', '>', '=', '*'] : ['.', ':', '{', '}', ';', '|']
      const dur = isFlow ? 2.2 : 3.4
      extra = glyphs.map((g, i) => rising(g, i % 2 === 0 ? 6 + (i % 4) * 3 : W - 10 - (i % 4) * 3, OY + 78, dur, (i * dur) / glyphs.length, i % 3 === 0 ? EMBER : SECOND, 56)).join('')
      break
    }

    case 'paused':
      inner = `${feet}${body}${paint(EYES.shut, INK)}${paint([[11, 14], [12, 14]], INK)}${pose(POSES.rest)}`
      extra = ['z', 'z', 'Z'].map((g, i) => rising(g, OX + 84 + i * 5, OY + 18, 3.6, i * 1.2, SECOND, 22)).join('')
      break

    case 'break': {
      const sip = `${feet}${body}${paint(EYES.happy, INK)}${paint(SMILE, INK)}${pose(POSES.mug)}${MUG_PX}`
      const steam = ['~', '.', '~', "'"].map((g, i) => rising(g, OX + 84 + (i % 2) * 5, OY + 34, 3, i * 0.75, SECOND, 20)).join('')

      if (!isFresh) {
        inner = sip
        extra = steam
        break
      }

      // A block just finished: arms up, a grin and three jumps, then the tea.
      const cheer = `${feet}${body}${paint(EYES.happy, INK)}${paint(GRIN, INK)}${paint([[11, 14], [12, 14]], TONGUE)}${pose(POSES.cheer)}`
      inner = `<g class="first"><g class="jump">${cheer}</g></g><g class="later">${sip}</g>`
      extra =
        `<g class="later">${steam}</g>` +
        ['*', '+', '.', '*', '+', '.'].map((g, i) => {
          const a = (i / 6) * Math.PI * 2

          return `<text x="${W / 2}" y="${OY + 30}" class="pop" fill="${i % 2 === 0 ? EMBER : MOSS}" style="font-family:${MONO};font-size:13px;--x:${Math.round(Math.cos(a) * 48)}px;--y:${Math.round(Math.sin(a) * 32)}px;animation-delay:${(i * 0.05).toFixed(2)}s">${g}</text>`
        }).join('')
      break
    }
  }

  const label = { idle: 'waiting', focus: 'typing away', flow: 'deep in it, headphones on', paused: 'dozing', break: 'having a cuppa' }[state]

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">
<title>Cinder, ${label}</title>
<style>${CSS}</style>
<g class="${wrap}">${inner}</g>
${extra}
</svg>`
}
