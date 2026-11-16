# Hearth

The design system behind both mods. pomo's drawings and the Ember theme are one fireside, so they share a palette and a short set of rules. If you change one, change the other.

## The idea

A long session is a fire you tend. A focus block burns down like a stick of incense. Finished blocks are coals you have lit. A break is the room going quiet and green. The window itself sits over a hearth.

That gives the system its one test for any new element: is it lit, or is it ash?

## Palette

Every surface is the red-black of the dark around a fire: warm, but not brown. Nothing is neutral grey and nothing is blue.

| Name | Hex | Used for |
|---|---|---|
| Soot | `#150b0d` | The page, and the tint of frosted panels |
| Char | `#1e1013` | Cards |
| Bark | `#271519` | Panels and menus |
| Kindling | `#45222a` | Anything unlit: tracks, empty coals, days with no blocks |
| Ash | `#bd9c93` | Muted text, a paused timer |
| Bone | `#fbeee4` | Text and digits |
| Gold | `#ffc640` | The one live point: the tip of the ring, the centre of a coal. Warnings in the theme |
| Ember | `#ff6a1a` | What counts now: the lit arc, today's bar, links, focus rings |
| Garnet | `#e8341c` | The cool end of the heat ramp, low on the ring and at a coal's edge |
| Cinder | `#a8381f` | The past: other days' bars |
| Moss | `#b6d65a` | Rest and success: a break, strings in code, "added" |
| Rose | `#ff7aa8` | The theme's fifth role, where most themes put purple |
| Red | `#ff4d5e` | Danger. A step cooler than ember so the two never blur |

The values live in `plugins/pomo/hooks/art.ts`, `plugins/ember-theme/hooks/register.tsx` and `plugins/ember-theme/hooks/scene.ts`. A mod can't import from another mod, so they are written out in each.

## Rules

1. **Lit and ash.** Solid ember is live or done. Dotted kindling is waiting or spent. The ring's burnt stretch, an unlit coal and an empty day are all dotted for the same reason.
2. **Heat is the hierarchy.** Gold marks a single point at a time. Ember marks what matters now. Cinder marks what is over. If two things on one card are gold, one of them is wrong.
3. **Only fire moves.** The tip flickers, the coals breathe, sparks rise. Cards, buttons and text hold still. Every animation stops under the system's reduce-motion setting except the clock's digits, which are information.
4. **Rest is green and still.** A break swaps the heat for moss and turns the flicker off. The change of colour is the cue to step away.
5. **One drawing per state.** A drawing is built when the timer changes and then runs by itself on CSS. Nothing redraws on a tick, so nothing blinks.
6. **Plain words.** Sentence case. A button says what it does and the toast that follows uses the same word: *park* gives *Parked*. Empty states say what to do next.

## Pieces

**The ring** (`ringSvg`). 280 by 264, radius 96. The lit arc is the time left and burns away clockwise from the top behind a gold tip. Sixty dots of kindling mark where it has been. The digits are four columns of glyphs that step on CSS, zero padded so the colon never moves. Under them sits what the block is for, then one pip per block of the set.

**The day** (`daySvg`). 280 by 200. One coal per block of the daily goal, lit as you finish them, the next one outlined while a block runs. A finished block's coal flares once. Below, the week as bars with today in full heat, and the streak and on-task share in ash.

**The hearth** (`hearthSvg`). The theme's backdrop. A bed of coals glows along the foot of the window and eighteen sparks drift up from it, each on its own slow loop of 15 to 35 seconds. Panels are frosted over it in soot so text keeps its contrast.

**Native controls.** Buttons, fields and text are the app's own and take the theme's colours. One primary button per state. Each group sits on a card of char with a warm hairline edge and a short caption, so the pane reads as one stack of cards with the drawings. The drawings stretch to the pane's width.

## Adding something

Draw it on char with the card helper in `art.ts`, so it picks up the hairline of light along the top edge. Pick its colours by asking what state each part is in, using the table above. Then look at it at its real size before shipping: these cards are read at 280 pixels wide, beside a chat.
