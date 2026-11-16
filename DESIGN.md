# Design

How both mods look, and why. The rules follow [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. Keep this credit if you copy them.

## Direction

- **Product.** A focus timer beside a Claude Code chat, for one person working through long sessions.
- **Character.** Steady, unhurried, warm.
- **World.** A desk late at night, with a stick of incense burning down beside the keyboard.
- **Moment.** The ring. It is the one bright thing on the dashboard, and everything around it stays quiet.
- **Signature.** The tip of the incense: a solid dot where the lit arc ends, cut out from the card by a ring of the card's colour. It appears on the ring and nowhere else.

## Palette

Warm neutrals for every surface, so you can look at them for hours. The colour lives in the accent, and the accent is used rarely.

| Role | Hex | Used for |
|---|---|---|
| Page | `#161513` | The theme's page |
| Card | `#1c1a18` | Cards, and the ground of pomo's drawings |
| Panel | `#232120` | Panels and fields |
| Hairline | primary text at 8% | Card edges. Depth comes from these and from surface steps, never from shadows or glows |
| Track | primary text at 14% | The dial's dots, empty days, the goal line |
| Primary text | `#efe9de` | Text and digits |
| Secondary text | `#aaa398` | Labels, a paused or idle clock |
| Muted text | `#9a9387` | Meta and captions |
| Ember | `#ff7a1f` | The accent. A running focus block, today's bar, links, the selection |
| Moss | `#b3c95a` | A break, and success. Strings in code |
| Amber, red, rose | `#f5b43c`, `#ef5b5e`, `#ee8aa8` | Warning, danger, and the theme's fifth role. Meaning only |

The values live in `plugins/pomo/hooks/art.ts` and `plugins/ember-theme/hooks/register.ts`. A mod can't import from another mod, so they are written out in each.

## Rules

1. **Flat colour.** No gradients from one hue to another, no glows, no colour washes behind content, no glossy dots. A shape is one colour.
2. **One accent per view.** On the dashboard that is the lit arc while you focus, and today's bar in the week. Other days are a neutral step. A break swaps ember for moss.
3. **Motion tells the time.** The arc burns down, the tip travels with it, and the digits roll. Nothing loops for decoration, nothing breathes or flickers, and nothing moves on hover.
4. **One drawing per state.** A drawing is built when the timer changes and then runs by itself on CSS. Nothing redraws on a tick, so nothing blinks.
5. **Sentence case, plain words.** Weights 400 and 500. Numbers in tabular figures. A button says what it does, and the toast that follows uses the same word: *park* gives *Parked*. Empty states say what to do next.
6. **Sizes on a 4 pixel grid.** Cards round at 16, controls at 8.

## Pieces

**The ring** (`ringSvg`). 280 by 264, radius 96. The lit arc is the time left and burns away clockwise from the top. Sixty faint dots mark the dial. The digits are four columns of glyphs that step on CSS, zero padded so the colon never moves. Under them sits what the block is for, then one pip per block of the set.

**The day** (`daySvg`). 280 by 196. Today's count against the goal as a figure, minutes, streak and on-task share as one muted line, and the week as bars with a dotted goal line. Today is the only bar in colour.

**Native controls.** Buttons, fields and text are the app's own and take the theme's colours. One primary button per state.

## Adding something

Draw it on the card with the `card` helper in `art.ts`. Use the text roles for words and a neutral step for anything that isn't the one thing that matters now. Then look at it at its real size before shipping: these cards are read at 280 pixels wide, beside a chat.
