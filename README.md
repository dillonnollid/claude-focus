# claude-focus

Two small mods for Claude Code, made for long sessions where you want to stay on one thing.

- **pomo** puts a focus dashboard beside the chat. A ring counts each pomodoro down live, with buttons to start, pause and skip. It shows today's progress and the week as a small chart, can play a quiet brown, pink or white noise bed while you work, chimes softly when a block or break ends, and can log each finished block to your Obsidian daily note.
- **ember-theme** is a dark-only theme in warm charcoal, ember orange and cream text. Nothing on screen is blue, which is easier on the eyes late at night.

Install either one on its own, or both.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pomo --marketplace dillonnollid/claude-focus
/plugin install ember-theme --marketplace dillonnollid/claude-focus
```

Or from a shell:

```bash
claude plugin install pomo --marketplace dillonnollid/claude-focus
claude plugin install ember-theme --marketplace dillonnollid/claude-focus
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session. In the desktop app, where `/plugin` doesn't run, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `dillonnollid/claude-focus`, then **Add plugin**.

## Where it shows

| | Desktop app | Mobile app | Terminal |
|---|---|---|---|
| Theme | yes | yes | no, terminals keep their own colours |
| Focus dashboard | yes | yes | yes, as a pane in fullscreen mode |
| Timer band above the prompt | yes | yes | yes |
| Chimes and noise | yes | yes | macOS only |

These are mods, which is an early-access part of Claude Code. In testing, the apps did not draw the theme for a cloud session (one running on claude.ai rather than your own computer). The timer, its commands and its counts still work there. For the full look, run the session on your own machine.

## Using the timer

Type `/pomo` to open the dashboard. From there you can type what you're working on and press Start, or use the buttons. Everything also works as a command, which is handy on a phone.

| Command | What it does |
|---|---|
| `/pomo` | Open the dashboard |
| `/pomo write the intro` | Start a focus block with a note of what it's for |
| `/pomo start` | Start a focus block, or resume a paused one |
| `/pomo pause` and `/pomo resume` | Pause and carry on |
| `/pomo stop` | Abandon the block. An unfinished block isn't counted |
| `/pomo skip` | End a break early |
| `/pomo stats` | The last seven days, and where blocks are logged |
| `/pomo noise brown` | Play a noise bed (`brown`, `pink`, `white`, or `off`) |

The defaults are 25 minutes of focus and a 5 minute break, with a 15 minute break after every fourth block. Breaks start by themselves. The next focus block waits for you, so a break never runs into work you didn't choose to start.

The timer keeps the time each block ends rather than counting down in memory. Closing the app, reloading, or opening a second session doesn't lose it, and a block that ended while the app was closed is still counted (quietly, with no chime).

## Noise

The dashboard has Off, Brown, Pink and White buttons. Brown is the deepest and softest, white the brightest. Each is a short seamless loop the app plays, so it costs almost nothing to run and uses none of your Claude usage. By default it goes quiet during breaks and pauses, as a cue to step away. The choice lasts for that session only, so two open sessions never play two beds at once.

## Logging to Obsidian

When a block finishes, pomo adds 25 to a number in that day's daily note, `deep_work_mins` by default. It reads your Daily Notes settings (`.obsidian/daily-notes.json`) to find the note, so a custom folder or date format like `YYYY-MM-DD` works.

- It changes one line of the frontmatter and leaves everything else in the file alone. If the property is missing it adds it, and if it holds something that isn't a number it leaves the note untouched.
- If today's note doesn't exist yet, the minutes wait and are written as soon as it does. It never creates a note itself, so your template still applies.
- It logs when the session runs inside a vault, or from anywhere once you set **Obsidian vault** in `/config` to your vault's path. Set it to `off` to turn logging off.
- It doesn't write from cloud sessions, because their copy of your vault is temporary.

## Settings

All of these are in `/config`, under each plugin.

**pomo**: focus, short break and long break lengths, blocks before a long break, whether breaks and focus blocks start by themselves, daily goal, chimes and their volume, noise volume and whether it stops for breaks, seconds in the band, whether the dashboard opens at start, vault path, which property to add to, minutes or one per block, and a time zone (for example `Australia/Perth`) if your computer's clock zone isn't the one you live in.

**ember-theme**: the faint orange glow at the foot of the window, on or off.

## Make it yours

Everything is plain TypeScript.

- Colours are in `plugins/ember-theme/hooks/register.ts`. Change the hex values and keep `make-colors.js` as it is, since it builds the full palette from those few colours and checks the contrast.
- The timer's logic is in `plugins/pomo/hooks/timer.ts` and `focus.ts`, and the dashboard's layout is in `register.tsx`.
- The chimes and noise loops are WAV files in `plugins/pomo/sounds/`. Swap in your own.
- The ring and the week chart are drawn as SVG in `plugins/pomo/hooks/art.ts`.

To check a change:

```bash
claude plugin validate plugins/pomo
claude plugin test plugins/pomo
```

## Licence

MIT
