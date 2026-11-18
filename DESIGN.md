# Hearth

The design system behind pomo's drawings: one palette and a short set of rules.

## The idea

A long session is a fire you tend. A focus block burns down like a stick of incense. Finished blocks are coals you have lit. A break is the room going quiet and green.

That gives the system its one test for any new element: is it lit, or is it ash?

## Palette

Every card is the red-black of the dark around a fire: warm, but not brown. Nothing is neutral grey and nothing is blue. The drawings carry their own ground, so they read the same over any app theme.

| Name | Hex | Used for |
|---|---|---|
| Char | `#1e1013` | Cards |
| Kindling | `#45222a` | Anything unlit: tracks, empty coals, days with no blocks |
| Ash | `#bd9c93` | Muted text, a paused timer |
| Bone | `#fbeee4` | Text and digits |
| Gold | `#ffc640` | The one live point: the tip of the ring, the centre of a coal |
| Ember | `#ff6a1a` | What counts now: the lit arc, today's bar, the next coal |
| Garnet | `#e8341c` | The cool end of the heat ramp, low on the ring and at a coal's edge |
| Cinder | `#a8381f` | The past: other days' bars |
| Moss | `#b6d65a` | Rest: a break |

The values live in `plugins/pomo/hooks/art.ts`, and the cards' ground and edge are repeated in `register.tsx`.

## Rules

1. **Lit and ash.** Solid ember is live or done. Dotted kindling is waiting or spent. The ring's burnt stretch, an unlit coal and an empty day are all dotted for the same reason.
2. **Heat is the hierarchy.** Gold marks a single point at a time. Ember marks what matters now. Cinder marks what is over. If two things on one card are gold, one of them is wrong.
3. **Only fire moves.** The tip flickers and the coals breathe. Cards, buttons and text hold still. Every animation stops under the system's reduce-motion setting. No animation carries the time for long: the app restarts a drawing's animations whenever it redraws it, so the arc moves only twenty seconds ahead and a fresh drawing comes every ten.
4. **Rest is green and still.** A break swaps the heat for moss and turns the flicker off. The change of colour is the cue to step away.
5. **One drawing per state.** A drawing is built when the timer changes and then runs by itself on CSS. Nothing redraws on a tick, so nothing blinks.
6. **Plain words.** Sentence case. A button says what it does and the toast that follows uses the same word: *park* gives *Parked*. Empty states say what to do next.

## Pieces

**The ring** (`ringSvg`). 320 by 264, radius 96. The lit arc is the time left and burns away clockwise from the top behind a gold tip. Sixty dots of kindling mark where it has been. In the middle, the whole minutes left in large numerals, read like a clock across the room, with `<1` in the last minute, and one pip per block of the set. What the block is for sits in the card below, as its title.

**The day** (`daySvg`). 280 by 200. One coal per block of the daily goal, lit as you finish them, the next one outlined while a block runs. A finished block's coal flares once. Below, the week as bars with today in full heat, and the streak and on-task share in ash.

**Native controls.** Buttons, fields and text are the app's own and take whatever theme the app is using. One primary button per state. Each group sits on a card of char with a warm hairline edge and a short caption, so the pane reads as one stack of cards with the drawings. The drawings stretch to the pane's width.

## Adding something

Draw it on char with the card helper in `art.ts`, so it picks up the hairline of light along the top edge. Pick its colours by asking what state each part is in, using the table above. Then look at it at its real size before shipping: these cards are read at 280 pixels wide, beside a chat.
