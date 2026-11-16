# claude-focus

Two small mods for Claude Code, made for long sessions where you want to stay on one thing.

- **pomo** turns a Claude Code session into a place to lock in. Say what the block is for and start it. Your desktop notifications go quiet, Claude keeps its answers on that task, and a ring beside the chat counts the block down. Stray thoughts get parked for the break instead of chased. Afterwards it asks how the block went, and it can log every finished block to your Obsidian daily note.
- **ember-theme** is a dark-only theme in warm charcoal, ember orange and cream text. Nothing on screen is blue, which is easier on the eyes late at night.

Install either one on its own, or both.

## Install

In a terminal, paste this whole block:

```bash
claude plugin marketplace add dillonnollid/claude-focus
claude plugin install pomo@claude-focus
claude plugin install ember-theme@claude-focus
```

Then quit and reopen Claude, or run `/reload-plugins` in a session that's already open. Leave out the last line if you only want the timer.

No terminal? In the desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `dillonnollid/claude-focus`, then add each plugin.

### Turn on updates, once

Claude Code only updates plugins by itself for Anthropic's own marketplace. For this one, switch it on once: start `claude` in a terminal, run `/plugin`, open the **Marketplaces** tab, pick **claude-focus** and choose **Enable auto-update**. New versions then arrive on their own and load the next time Claude starts.

If you'd rather update by hand:

```bash
claude plugin marketplace update claude-focus
claude plugin update pomo@claude-focus
claude plugin update ember-theme@claude-focus
```

## Where it shows

| | Desktop app | Mobile app | Terminal |
|---|---|---|---|
| Theme | yes | yes | no, terminals keep their own colours |
| Focus dashboard | yes | yes | yes, as a pane in fullscreen mode |
| Timer band above the prompt | yes | yes | yes |
| Chimes and noise | macOS, and Linux with mpv, PipeWire, PulseAudio or ffplay | yes | macOS only |

These are mods, which is an early-access part of Claude Code. In testing, the apps did not draw the theme for a cloud session (one running on claude.ai rather than your own computer). The timer, its commands and its counts still work there. For the full look, run the session on your own machine.

## How a block works

1. **Say what it's for.** Type the one thing into the dashboard, or `/pomo write the intro`.
2. **Pick a length.** 25 minutes, 50 minutes, or **Flow**. Flow counts up until you press *Done*, then gives you a break of a fifth of the time you worked (3 to 20 minutes). Pomodoro-style fixed breaks and Flowtime both have some research behind them, so both are here.
3. **Lock in.** For the length of the block:
   - Desktop notifications are silenced (mako, which Omarchy and other wlroots desktops use, or GNOME's banners), and come back for the break. mako only hides notifications in that mode if its config has a `[mode=do-not-disturb]` section with `invisible=1`. On macOS, or for anything else such as a site blocker, set your own start and end commands.
   - On Hyprland, the Claude window can go fullscreen and come back for the break (off by default).
   - Claude is told what the block is for. It keeps replies tight and, when you ask for something unrelated, offers to park it rather than wander off. This adds a few lines to Claude's instructions only while a block runs.
4. **Park stray thoughts.** The field under the timer, or `/park look up flights`. They stay out of sight until the break, then show up as a list you can tick off. They're also added under a *Parked* heading in that day's daily note.
5. **Check in.** When the block ends, three buttons ask how it went: *Did it*, *Partly*, *Got distracted*. The *On task* tile shows your share for the day.

The ring animates its own seconds, sweep and breathing glow, and the tiles show today's blocks, minutes, streak and on-task share above a week chart. If a block runs over, *+5 min* extends it.

| Command | What it does |
|---|---|
| `/pomo` | Open the dashboard |
| `/pomo write the intro` | Start a 25 minute block on it |
| `/pomo 50 write the intro` or `/pomo flow write the intro` | Start a 50 minute or flow block |
| `/pomo pause`, `resume`, `+5` | Pause, carry on, or add five minutes |
| `/pomo done` | End a flow block and take the break it earned |
| `/pomo stop` | Give up on the block. An unfinished block isn't counted |
| `/pomo skip` | End a break early |
| `/park <thought>` | Park a thought for the break |
| `/pomo noise brown` | Play a noise bed (`brown`, `pink`, `white`, or `off`) |
| `/pomo stats` | The last seven days, your streak, and where blocks are logged |

Breaks start by themselves. The next block waits for you, so a break never runs into work you didn't choose to start.

The timer keeps the time each block ends rather than counting down in memory. Quitting the app, reloading, or opening a second session doesn't lose it, so a block keeps running until it ends or you give it up. A block that ended while the app was closed still counts, quietly, with no chime.

## Noise

The dashboard has Off, Brown, Pink and White buttons. Brown is the deepest and softest, white the brightest. Each is a short seamless loop, so it costs almost nothing to run and uses none of your Claude usage. On macOS Claude plays it. On Linux, pomo plays it with the first of `mpv`, `pw-play`, `paplay` or `ffplay` it finds. By default it goes quiet during breaks and pauses, as a cue to step away. The choice lasts for that session only, so two open sessions never play two beds at once.

## Logging to Obsidian

When a block finishes, pomo adds its minutes to a number in that day's daily note, `deep_work_mins` by default. It reads your Daily Notes settings (`.obsidian/daily-notes.json`) to find the note, so a custom folder or date format like `YYYY-MM-DD` works.

- It changes one line of the frontmatter and leaves everything else in the file alone. If the property is missing it adds it, and if it holds something that isn't a number it leaves the note untouched.
- If today's note doesn't exist yet, the minutes wait and are written as soon as it does. It never creates a note itself, so your template still applies.
- It logs when the session runs inside a vault, or from anywhere once you set **Obsidian vault** in `/config` to your vault's path. Set it to `off` to turn logging off.
- It doesn't write from cloud sessions, because their copy of your vault is temporary.

## Settings

All of these are in `/config`, under each plugin.

**pomo**: the focus switch (on or off), fullscreen on Hyprland, your own commands for a block's start and end, keeping Claude on task, parked thoughts to the daily note and their heading, focus, short break and long break lengths, blocks before a long break, whether breaks and focus blocks start by themselves, daily goal, chimes and their volume, noise volume and whether it stops for breaks, seconds in the band, whether the dashboard opens at start, vault path, which property to add to, minutes or one per block, and a time zone (for example `Australia/Perth`) if your computer's clock zone isn't the one you live in.

**ember-theme**: the faint orange glow at the foot of the window, on or off.

## Make it yours

Everything is plain TypeScript.

- Colours are in `plugins/ember-theme/hooks/register.ts`. Change the hex values and keep `make-colors.js` as it is, since it builds the full palette from those few colours and checks the contrast.
- The timer's logic is in `plugins/pomo/hooks/timer.ts` and `focus.ts`, and the dashboard's layout is in `register.tsx`.
- The chimes and noise loops are WAV files in `plugins/pomo/sounds/`. Swap in your own.
- The ring, the tiles and the week chart are drawn as SVG in `plugins/pomo/hooks/art.ts`.

To check a change:

```bash
claude plugin validate plugins/pomo
claude plugin test plugins/pomo
```

## Licence

MIT
