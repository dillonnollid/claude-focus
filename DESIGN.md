# Design

How both mods look, and why. The colour rules start from [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. Keep this credit if you copy them.

## Direction

- **Product.** A focus timer beside a Claude Code chat, for one person working through long sessions.
- **Character.** Steady, warm, a little playful.
- **World.** A terminal late at night: chunky pixels, ASCII, a stick of incense burning down beside the keyboard, and a 1920s rubber-hose cartoon on the screen.
- **Moments.** Cinder, the mascot, who shows what you're doing. The ring, which burns down pixel by pixel.
- **Signature.** The ember: the one segment of the ring burning right now, Cinder's flame, the ember glyphs in the backdrop while you focus.

## Palette

Warm, near-black surfaces, tinted enough that the theme is unmistakably on, and quiet enough to look at for hours. Colour lives in the moments, and each colour means one thing.

| Role | Hex | Used for |
|---|---|---|
| Page | `#1a1310` | The theme's page |
| Card | `#211814` | Cards, and the ground of pomo's drawings |
| Panel | `#291e19` | Panels and fields |
| Hairline | primary text at 8% | Card edges |
| Track | primary text at 14% | Unlit segments, empty tiles, the goal line |
| Primary text | `#f4e8d6` | Text and digits |
| Secondary text | `#cdb9a2` | Labels, a paused or idle clock |
| Muted text | `#ab9784` | Meta and captions |
| Ember | `#ff7a1f` | Focus. Cinder, a running block, today's blocks, links, the selection |
| Glow | `#ffb37a` | The segment burning now, a block just earned |
| Moss | `#b3c95a` | A break, and success |
| Amber, red, rose | `#f5b43c`, `#ef5b5e`, `#ee8aa8` | Warning, danger, and the theme's fifth role. Meaning only |

The values live in `plugins/pomo/hooks/art.ts`, `mascot.ts` and `plugins/ember-theme/hooks/register.tsx` and `scene.ts`. A mod can't import from another mod, so they are written out in each.

## Rules

1. **Pixels and glyphs, flat colour.** Shapes are squares on a grid and effects are ASCII characters. No gradients from one hue to another, no glows, no glossy shapes.
2. **Motion says what's happening.** Cinder types while you focus, dozes while paused, drinks tea on a break and jumps when a block is done. The ring burns down one segment at a time. Loops stay small and slow, and every one stops under the system's reduce-motion setting.
3. **Phase is colour.** Ember is focus, moss is a break, grey is idle or paused. The pane, Cinder, the ring and the theme's backdrop all change together.
4. **One drawing per state.** A drawing is built when the timer changes and then runs by itself on CSS. Nothing redraws on a tick, so nothing blinks.
5. **The edges, not the middle.** The backdrop keeps to the sides of the window and fades out before the chat and the message box.
6. **Plain words.** Sentence case, weights 400 and 500, a monospace face for figures and labels in the drawings. A button says what it does, and the toast that follows uses the same word.

## Pieces

**Cinder** (`mascotSvg`). A 24 by 22 pixel ember with a wisp of flame, drawn at 4 points a pixel in the style of a 1920s rubber-hose cartoon: pie-cut eyes, white gloves, hose arms and big shoes. An original character, not anyone's mascot. One SVG per pose: idle (blinks and bobs), focus (types, with ASCII code drifting off the keyboard), flow (headphones on, typing faster), paused (asleep, `z`s rising), break (a mug of tea, steam rising) and a jump with a burst of `*` and `+` when a break has just begun.

**The ring** (`ringSvg`). Sixty pixel segments on a dial, with the time in a 5 by 7 pixel font. Counting down, the lit segments are the time left and go out clockwise from the top, and the one burning now glows. In flow they light up instead, toward the 25 minute mark.

**The day** (`daySvg`). One tile per block of the daily goal, lit as you finish them, the newest blinking until you answer the check-in. Below, the week as stacked pixel bars, one cell per block, with today in ember.

**The ash field** (`ashSvg`, in the theme). A scatter of `.`, `·`, `:` and `+` along the sides of the window. A few breathe slowly. While you focus, embers glow among them and specks drift up; on a break they turn to moss and slow down; paused, everything stops.

**The pane.** A stack of cards, all the same colour and edge, each named by a caption: Cinder and what you're doing at the top, the ring, the controls for the moment (start a block, stay on it, or take a breather), parked thoughts, the day, and sound and notes. The drawings stretch to the pane's width. Buttons carry a glyph that says what they do: `▶` start, `❚❚` pause, `✓` done, `✕` give up, and bars for how deep each noise is.

## Adding something

Draw it on the card with the `card` helper in `art.ts`, on a grid, in the palette above. Ask what state each part is in and colour it by phase. Then look at it at its real size before shipping: these cards are read at 280 pixels wide, beside a chat.
