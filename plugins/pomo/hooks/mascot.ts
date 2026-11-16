// Cinder, the little ember that keeps you company, as chunky pixel art with
// ASCII effects. One SVG per state, animated by CSS alone, so it plays by
// itself between the dashboard's redraws.
//
// The sprite is 20 by 18 pixels on a 4 point grid. Layers are drawn from
// lists of pixels, each one colour, so the whole thing is a handful of paths.

const EMBER = '#ff7a1f'
const SHADE = '#c4520f'
const LIGHT = '#ffb37a'
const EYE = '#161513'
const KEY = '#4a4540'
const KEYTOP = '#6e675e'
const PHONES = '#efe9de'
const MUG = '#efe9de'
const SECOND = '#aaa398'
const MOSS = '#b3c95a'
const MONO = "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"

const P = 4
const W = 120
const H = 92
const OX = 20
const OY = 18

type Px = readonly (readonly [number, number])[]

/** One colour's pixels as a single path, runs along a row merged. */
function paint(px: Px, fill: string, cls = ''): string {
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

  return `<path${cls === '' ? '' : ` class="${cls}"`} fill="${fill}" d="${d}"/>`
}

const span = (y: number, from: number, to: number): [number, number][] => Array.from({ length: to - from + 1 }, (_, i) => [from + i, y])

// The body: a rounded block with a wisp of flame on top.
const BODY: Px = [
  [10, 1], [10, 2], [11, 2], [9, 3], [10, 3], [11, 3],
  ...span(4, 5, 14),
  ...span(5, 4, 15),
  ...[6, 7, 8, 9, 10, 11, 12].flatMap(y => span(y, 3, 16)),
  ...span(13, 4, 15),
]
const SHADOW: Px = [...span(13, 4, 15), [16, 9], [16, 10], [16, 11], [16, 12]]
const SHINE: Px = [[10, 0], [10, 1], [5, 6], [6, 6], [5, 7]]
const LEGS: Px = [[6, 14], [7, 14], [12, 14], [13, 14]]

const EYES = {
  open: [[7, 8], [7, 9], [12, 8], [12, 9]],
  down: [[7, 10], [7, 11], [12, 10], [12, 11]],
  shut: [[6, 9], [7, 9], [12, 9], [13, 9]],
  happy: [[6, 9], [7, 8], [8, 9], [11, 9], [12, 8], [13, 9]],
} satisfies Record<string, Px>

const ARMS = {
  rest: [[2, 10], [2, 11], [17, 10], [17, 11]],
  leftDown: [[2, 12], [17, 11]],
  rightDown: [[2, 11], [17, 12]],
  cheer: [[2, 5], [2, 6], [17, 5], [17, 6]],
} satisfies Record<string, Px>

const KEYBOARD_TOP: Px = span(14, 2, 17)
const KEYBOARD: Px = span(15, 1, 18)
const HEADPHONES: Px = [...span(1, 6, 13), [5, 2], [14, 2], [4, 3], [15, 3], [4, 4], [15, 4], [2, 7], [2, 8], [2, 9], [17, 7], [17, 8], [17, 9]]
const MUG_PX: Px = [...span(9, 16, 18), ...span(10, 16, 18), ...span(11, 16, 18), [19, 10]]

export type MascotState = 'idle' | 'focus' | 'flow' | 'paused' | 'break'

/** A glyph that floats up and fades, `delay` seconds into a `dur` second loop. */
function rising(text: string, x: number, y: number, dur: number, delay: number, fill: string, rise = 22): string {
  return `<text x="${x}" y="${y}" class="r" fill="${fill}" style="--h:-${rise}px;animation-duration:${dur}s;animation-delay:-${delay.toFixed(2)}s">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`
}

const CSS = `
.r { font-family: ${MONO}; font-size: 11px; opacity: 0; animation: rise linear infinite; }
@keyframes rise { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 0.9; } 100% { transform: translateY(var(--h)); opacity: 0; } }
/* Each second frame starts hidden, so a still render shows one clean pose. */
.a { animation: a var(--t, 0.5s) step-end infinite; }
.b { opacity: 0; animation: b var(--t, 0.5s) step-end infinite; }
@keyframes a { 0% { opacity: 1; } 50% { opacity: 0; } }
@keyframes b { 0% { opacity: 0; } 50% { opacity: 1; } }
.blink-open { animation: bo 4.2s step-end infinite; }
.blink-shut { opacity: 0; animation: bs 4.2s step-end infinite; }
@keyframes bo { 0% { opacity: 1; } 95% { opacity: 0; } }
@keyframes bs { 0% { opacity: 0; } 95% { opacity: 1; } }
.bob { animation: bob var(--t, 1.6s) step-end infinite; }
@keyframes bob { 0% { transform: translateY(0); } 50% { transform: translateY(-${P}px); } }
.jump { animation: jump 0.6s step-end 3; }
@keyframes jump { 0% { transform: translateY(0); } 25% { transform: translateY(-${P * 2}px); } 50% { transform: translateY(-${P * 3}px); } 75% { transform: translateY(-${P}px); } }
.pop { opacity: 0; animation: pop 1.8s steps(6) 1 forwards; }
@keyframes pop { 0% { opacity: 1; transform: translate(0, 0); } 100% { opacity: 0; transform: translate(var(--x), var(--y)); } }
@media (prefers-reduced-motion: reduce) { .r, .a, .b, .bob, .jump, .pop, .blink-open, .blink-shut { animation: none; } .b, .blink-shut, .r, .pop { opacity: 0; } }
`

/** The mascot for a state. `isFresh` marks a break that has only just begun: it jumps first. */
export function mascotSvg(state: MascotState, isFresh = false): string {
  const body = `${paint(BODY, EMBER)}${paint(SHADOW, SHADE)}${paint(SHINE, LIGHT)}${paint(LEGS, SHADE)}`
  let inner = ''
  let extra = ''
  let wrap = ''

  switch (state) {
    case 'idle':
      wrap = 'bob'
      inner = `${body}${paint(ARMS.rest, EMBER)}<g class="blink-open">${paint(EYES.open, EYE)}</g><g class="blink-shut">${paint(EYES.shut, EYE)}</g>`
      break

    case 'focus':
    case 'flow': {
      const isFlow = state === 'flow'
      const t = isFlow ? '0.32s' : '0.5s'
      wrap = isFlow ? 'bob' : ''
      inner = `${body}${paint(EYES.down, EYE)}${isFlow ? paint(HEADPHONES, PHONES) : ''}<g class="a" style="--t:${t}">${paint(ARMS.leftDown, EMBER)}</g><g class="b" style="--t:${t}">${paint(ARMS.rightDown, EMBER)}</g>${paint(KEYBOARD_TOP, KEYTOP)}${paint(KEYBOARD, KEY)}`
      // Code, in ASCII, drifting up off both ends of the keyboard.
      const glyphs = isFlow ? ['{', '}', ';', '<', '/', '>', '=', '*'] : ['.', ':', '{', '}', ';', '|']
      extra = glyphs
        .map((g, i) => rising(g, i % 2 === 0 ? 6 + (i % 4) * 3 : W - 8 - (i % 4) * 3, OY + 60, isFlow ? 2.2 : 3.4, (i * (isFlow ? 2.2 : 3.4)) / glyphs.length, i % 3 === 0 ? EMBER : SECOND, 44))
        .join('')
      break
    }

    case 'paused':
      inner = `${body}${paint(ARMS.rest, EMBER)}${paint(EYES.shut, EYE)}`
      extra = ['z', 'z', 'Z'].map((g, i) => rising(g, OX + 66 + i * 4, OY + 14, 3.6, i * 1.2, SECOND, 20)).join('')
      break

    case 'break':
      wrap = isFresh ? 'jump' : ''
      inner = `${body}${paint(EYES.happy, EYE)}${paint([[2, 10], [2, 11], [16, 12]], EMBER)}${paint(MUG_PX, MUG)}`
      extra =
        ['~', '.', '~', "'"].map((g, i) => rising(g, OX + 66 + (i % 2) * 4, OY + 34, 3, i * 0.75, SECOND, 18)).join('') +
        (isFresh
          ? ['*', '+', '.', '*', '+', '.']
              .map((g, i) => {
                const a = (i / 6) * Math.PI * 2
                return `<text x="${W / 2}" y="${OY + 30}" class="pop" fill="${i % 2 === 0 ? EMBER : MOSS}" style="font-family:${MONO};font-size:12px;--x:${Math.round(Math.cos(a) * 40)}px;--y:${Math.round(Math.sin(a) * 28)}px;animation-delay:${(i * 0.05).toFixed(2)}s">${g}</text>`
              })
              .join('')
          : '')
      break
  }

  const label = { idle: 'waiting', focus: 'typing away', flow: 'deep in it, headphones on', paused: 'dozing', break: 'having a cuppa' }[state]

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">
<title>Cinder, ${label}</title>
<style>${CSS}</style>
<g class="${wrap}">${inner}</g>
${extra}
</svg>`
}
