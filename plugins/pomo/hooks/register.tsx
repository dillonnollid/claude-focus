import { atom, read, update } from 'claude-code'
import type { Register, RenderElement } from 'claude-code'

import type { View } from '../types'
import { daySvg, ringSvg } from './art'
import { NOISES, createFocus, settingsFrom } from './focus'
import type { Focus, Io, RunResult } from './focus'
import { dots, elapsed, formatLeft, remaining } from './timer'

const view = atom({ plugin: 'pomo', key: 'view' } as const, null, { shape: 'view-5' })

const PANE = 'focus'
// The cards' ground and edge: Hearth's char, as in art.ts, with a warm hairline.
const CARD = '#1e1013'
const EDGE = '#3a1c22'
const TITLE = 'Focus'

type Player = 'app' | 'mpv' | 'pw-play' | 'paplay' | 'ffplay'

/** How one clip is played by a player on this computer, once or on a loop. */
function playerArgv(player: Exclude<Player, 'app'>, path: string, gain: number, isLoop: boolean): string[] {
  const pct = String(Math.round(gain * 100))

  switch (player) {
    case 'mpv':
      return ['mpv', '--no-video', '--really-quiet', `--volume=${pct}`, ...(isLoop ? ['--loop-file=inf'] : []), path]
    case 'ffplay':
      return ['ffplay', '-nodisp', '-loglevel', 'quiet', '-volume', pct, ...(isLoop ? ['-loop', '0'] : ['-autoexit']), path]
    case 'pw-play':
      return ['pw-play', `--volume=${gain.toFixed(2)}`, path]
    case 'paplay':
      return ['paplay', `--volume=${Math.round(gain * 65536)}`, path]
  }
}

/** What the timer is doing, in the words and colors every drawing uses. */
function describe(v: View) {
  const t = v.timer
  const isIdle = t.phase === 'idle'
  const isPaused = t.phase === 'paused'
  const isFocus = t.phase === 'focus' || (t.phase === 'paused' && t.of === 'focus')
  const isFlow = t.phase !== 'idle' && t.isFlow === true
  const isLong = t.phase !== 'idle' && t.isLong
  const name = isIdle ? 'Ready' : isFocus ? (isFlow ? 'Flow' : 'Focus') : isLong ? 'Long break' : 'Break'
  const color = isIdle || isPaused ? 'inactive' : isFocus ? 'claude' : 'success'
  const left = remaining(t, v.now)
  const done = elapsed(t, v.now)
  const length = t.phase === 'idle' ? 0 : t.lengthMs
  const intention = t.phase !== 'idle' && isFocus ? t.intention : ''
  const ringPhase: 'idle' | 'focus' | 'break' | 'paused' = isIdle ? 'idle' : isPaused ? 'paused' : isFocus ? 'focus' : 'break'

  return { t, isIdle, isPaused, isFocus, isFlow, name, color, left, done, length, intention, ringPhase }
}

export const register: Register = (on, options) => {
  const s = settingsFrom(options)
  const openOnStart = options.openOnStart !== false
  let focus: Focus | undefined
  // What's typed in the dashboard's fields, so a button can use it.
  let draft = ''
  let toldNoDashboard = false
  // Each parked thought gets a new field, which is what empties the box.
  let parkSeq = 0
  let ring: { key: string; source: string } | undefined

  on('session.start', async ($, e, next) => {
    // macOS plays a plugin's audio itself; Linux needs a player of its own,
    // so look for one once.
    const probe = await $.process
      .run(['sh', '-c', 'uname -s; for p in mpv pw-play paplay ffplay; do command -v "$p" >/dev/null 2>&1 && echo "$p"; done'])
      .catch(() => ({ stdout: '' }))
    const [system = '', ...found] = probe.stdout.split('\n').map(line => line.trim()).filter(Boolean)
    const player: Player = system === 'Darwin' ? 'app' : ((found[0] as Player | undefined) ?? 'app')
    const pathOf = (asset: string) => `${$.plugin.root}/${asset}`

    // Everything the timer does later, from its own timers, a command or a
    // button, goes through these, made once here where the work starts.
    const io: Io = {
      now: () => $.clock.now(),
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      exists: path => $.fs.exists(path),
      read: path => $.fs.read(path),
      write: (path, text) => $.fs.write(path, text),
      home: () => $.env.get('HOME'),
      cwd: () => $.session.cwd().catch(() => e.cwd),
      fill: async text => {
        // A draft already in the box is kept: the thought goes after it.
        const box = await $.prompt.read()
        const filled = await $.prompt.fill(box.text.trim() === '' ? { text } : { text: `\n${text}`, mode: 'append' })

        return filled.isFilled
      },
      isCloud: async () => (await $.env.get('CLAUDE_CODE_REMOTE')) === 'true',
      run: async (argv): Promise<RunResult> => {
        const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 10_000 })

        return { exitCode, stdout }
      },
      toast: (text, timeoutMs) => $.ui.toast(text, { timeoutMs }),
      notify: text => {
        void $.ui.notify(text, { title: 'Focus' }).catch(() => undefined)
      },
      play: (asset, gain) => {
        if (player === 'app') {
          void $.audio.play({ asset }, { gain }).catch(() => undefined)
        } else {
          void $.process.run(playerArgv(player, pathOf(asset), gain, false), { timeoutMs: 30_000 }).catch(() => undefined)
        }
      },
      loop: (asset, gain) => {
        if (player === 'app') {
          const playing = new AbortController()
          void $.audio.play({ asset }, { shouldLoop: true, gain, signal: playing.signal }).catch(() => undefined)

          return () => playing.abort()
        }

        let isStopped = false
        let child: ReturnType<typeof $.process.spawn> | undefined
        const loopsItself = player === 'mpv' || player === 'ffplay'

        void (async () => {
          while (!isStopped) {
            const startedAt = await $.clock.now()
            child = $.process.spawn({ argv: playerArgv(player, pathOf(asset), gain, true) })

            try {
              for await (const piece of child) {
                if (isStopped || piece === undefined) {
                  break
                }
              }
            } catch {
              return
            }

            // A player that loops by itself, or one that quit at once, isn't restarted.
            if (loopsItself || (await $.clock.now()) - startedAt < 1000) {
              return
            }
          }
        })()

        return () => {
          isStopped = true
          void child?.return(undefined as never).catch(() => undefined)
        }
      },
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
      publish: async snapshot => {
        await update($, view, () => snapshot)
      },
    }

    focus?.end()
    focus = createFocus(io, s)
    await $.command.register({
      name: 'pomo',
      description: 'Focus dashboard and pomodoro timer: start a block on something, 50, flow, pause, noise, stats',
      argumentHint: '[<what you are working on> | 50 | flow | pause | +5 | done | stop | noise | stats | help]',
    })
    await $.command.register({
      name: 'park',
      description: 'Park a stray thought for your next break, so you can get back to the block',
      argumentHint: '<the thought>',
      immediate: true,
    })
    await focus.begin()

    if (openOnStart) {
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }

    return next(e)
  })

  // The app can connect after the session has started, as the desktop app
  // does. Open the dashboard then too: opening an open pane is harmless.
  on('session.attach', async ($, e, next) => {
    if (openOnStart && e.surface !== 'terminal') {
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }

    return next(e)
  })

  on('session.end', ($, e, next) => {
    focus?.end()

    return next(e)
  })

  // While a block runs, Claude is told what it's for and to keep to it. The
  // note is the same for the whole block, so it costs one cache write a block.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const note = focus?.taskNote()

    return note === undefined ? result : { sections: [...result.sections, { id: 'pomo:focus', text: note, scope: 'session' as const }] }
  })

  on('command.run', { command: 'pomo' }, async ($, e) => {
    if (focus === undefined) {
      return { text: 'The focus timer is still starting. Try again in a moment.' }
    }

    const opened = await $.ui.open({ id: PANE, title: TITLE })

    // Where nothing draws the dashboard (a cloud session, as the apps show
    // one today), /pomo answers with the dashboard as text instead.
    if (e.args.trim() === '') {
      return { text: opened.isPlaced ? 'Focus dashboard open.' : await focus.status() }
    }

    const hint =
      opened.isPlaced || toldNoDashboard
        ? ''
        : '\n(No dashboard is drawn in this session yet. /pomo on its own shows where things stand.)'
    toldNoDashboard ||= !opened.isPlaced

    return { text: (await focus.command(e.args)) + hint }
  }).catch(() => ({ text: 'The focus timer hit an error. Run /pomo again, or restart the session.' }))

  on('command.run', { command: 'park' }, async ($, e) => {
    if (focus === undefined) {
      return { text: 'The focus timer is still starting. Try again in a moment.' }
    }

    return { text: await focus.park(e.args) }
  }).catch(() => ({ text: 'Could not park that. Try again.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const stored = await read($, view)
    const f = focus
    const els = $.ui.resolve(e)
    const { Box, Button, Input, Text } = els

    if (stored === null || f === undefined) {
      return <Text dimColor>Starting the focus timer…</Text>
    }

    // The snapshot is only published when it has news, so the time is read here.
    const v = { ...stored, now: await $.clock.now() }
    const d = describe(v)
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const round = Math.min((v.cycleDone % s.longEvery) + (d.isFocus ? 1 : 0), s.longEvery)
    const goal = s.goal > 0 ? `${v.today} of ${s.goal} today` : `${v.today} today`
    const label = d.isPaused ? `${d.name}, paused` : d.name
    const blockMinutes = Math.round(s.focusMs / 60_000)
    // The minute on the clock: the ring is drawn again whenever it changes.
    const shownMinute = d.isIdle ? blockMinutes : d.isFlow && d.isFocus ? Math.floor(d.done / 60_000) : Math.ceil(d.left / 60_000)

    // The small form of a minimized pane on the desktop: a glance, no form.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text color={d.color} weight="semibold" size="caption">
            {label}
          </Text>
          <Text size="title" weight="bold" tabular>
            {d.isFlow && d.isFocus ? `${Math.floor(d.done / 60_000)} min` : formatLeft(d.isIdle ? s.focusMs : d.left, false)}
          </Text>
          <Text dimColor size="caption">
            {goal}
          </Text>
        </Box>
      )
    }

    let hero

    if (Svg !== undefined) {
      // One drawing per minute shown, kept between redraws in between. It is an
      // image, as the day card is, so it stretches to the pane's width.
      const key = JSON.stringify([d.t, label, shownMinute, round, s.longEvery, s.focusMs])

      if (ring === undefined || ring.key !== key) {
        ring = {
          key,
          source: ringSvg({
            phase: d.ringPhase,
            label,
            elapsedMs: d.isIdle ? 0 : d.done,
            lengthMs: d.isIdle ? s.focusMs : d.isFlow && d.isFocus ? 25 * 60_000 : d.length,
            isCountUp: d.isFlow && d.isFocus,
            round: d.isIdle || !d.isFocus || d.isFlow ? 0 : round,
            rounds: d.isIdle || !d.isFocus || d.isFlow ? 0 : s.longEvery,
          }),
        }
      }

      hero = <Svg source={ring.source} alt={`${label}, ${formatLeft(d.isIdle ? s.focusMs : d.left, false)}${d.isIdle ? '' : ' left'}`} />
    } else {
      hero = (
        <Box flexDirection="column">
          <Text color={d.color} weight="semibold">
            {label}
            <Text dimColor> {d.isIdle ? goal : d.intention}</Text>
          </Text>
          <Text weight="bold" tabular>
            {d.isFlow && d.isFocus ? `${Math.floor(d.done / 60_000)} min in` : `${formatLeft(d.isIdle ? s.focusMs : d.left, false)}${d.isIdle ? '' : ' left'}`}
          </Text>
        </Box>
      )
    }

    const startWith = (preset: 'pomodoro' | 'long' | 'flow' | number) => () => {
      const intention = draft.trim()
      draft = ''
      void f.start(intention, preset)
    }

    // Every group sits on a card the colour of the drawings, so the pane reads
    // as one stack of cards, each named by a title and a line on what it's for.
    // A plain function, not a component: the engine's JSX takes only its own elements.
    const card = (title: string, hint: string | undefined, ...body: (RenderElement | null)[]) => (
      <Box flexDirection="column" gap={1} backgroundColor={CARD} borderStyle="round" borderColor={EDGE} paddingX={1} paddingY={1}>
        <Box flexDirection="column">
          <Text weight="semibold" wrap="truncate-end">
            {title}
          </Text>
          {hint !== undefined && (
            <Text dimColor wrap="truncate-end">
              {hint}
            </Text>
          )}
        </Box>
        {body.filter((child): child is RenderElement => child !== null)}
      </Box>
    )

    // A row of choices in equal columns, each button stretched to fill its own.
    const even = (...buttons: (RenderElement | false)[]) => (
      <Box flexDirection="row" columnGap={1}>
        {buttons
          .filter((button): button is RenderElement => button !== false)
          .map((button, i) => (
            <Box key={`col-${i}`} flexDirection="column" flexGrow={1} alignItems="stretch">
              {button}
            </Box>
          ))}
      </Box>
    )

    // What to do now: start a block, run it, or rest.
    const now = d.isIdle
      ? card(
          'Start a block',
          'Say what it is for, then pick a length',
          <Input
            key="intention"
            placeholder="What will you work on?"
            submitLabel={`start ${blockMinutes} min`}
            onInput={value => {
              draft = value
            }}
            onSubmit={value => {
              draft = value
              startWith('pomodoro')()
            }}
          />,
          even(
            <Button key="start-15" label="15 min" onPress={startWith(15)} />,
            <Button key="start" label={`${blockMinutes} min`} variant="primary" onPress={startWith('pomodoro')} />,
            <Button key="start-50" label="50 min" onPress={startWith('long')} />,
            <Button key="start-flow" label="Flow" onPress={startWith('flow')} />,
          ),
        )
      : d.isFocus
        ? card(
            d.intention !== '' ? d.intention : d.isFlow ? 'Flow block' : 'Focus block',
            d.isPaused
              ? 'Paused. The clock waits until you resume'
              : d.isFlow
                ? 'No end time. Stop when you are done and the break scales to match'
                : `Block ${round} of ${s.longEvery}. The timer keeps running if you switch windows`,
            even(
              d.isPaused && <Button key="resume" label="Resume" variant="primary" onPress={() => void f.resume()} />,
              !d.isPaused && d.isFlow && <Button key="done" label="Done" variant="primary" onPress={() => void f.finish()} />,
              !d.isPaused && <Button key="pause" label="Pause" onPress={() => void f.pause()} />,
              !d.isPaused && !d.isFlow && <Button key="more" label="+5 min" onPress={() => void f.addFive()} />,
              <Button key="stop" label="Give up" dimColor onPress={() => void f.stop()} />,
            ),
          )
        : card(
            v.checkIn !== null ? 'How did that block go?' : d.name,
            v.checkIn !== null ? 'One tap, it shows in your on-task share' : 'Stand up and look at something far away',
            v.checkIn === null
              ? null
              : even(
                  <Button key="check-did" label="Did it" onPress={() => void f.answerCheckIn('did')} />,
                  <Button key="check-partly" label="Partly" onPress={() => void f.answerCheckIn('partly')} />,
                  <Button key="check-distracted" label="Got distracted" onPress={() => void f.answerCheckIn('distracted')} />,
                ),
            even(
              d.isPaused && <Button key="resume" label="Resume" variant="primary" onPress={() => void f.resume()} />,
              <Button key="skip" label="Skip break" dimColor onPress={() => void f.skip()} />,
            ),
          )

    // Stray thoughts: a field to park one while focusing, and the list to deal
    // with at the break. Mid-block the list only shows the thought landed.
    const isHeadsDown = d.isFocus && !d.isPaused
    const parkField = (
      <Input
        key={`park-${parkSeq}`}
        placeholder="Type it and press Enter"
        submitLabel="park"
        autoFocus
        onSubmit={value => {
          // A new field next draw, empty, whatever came of this one.
          parkSeq += 1
          void f.park(value).finally(() => $.ui.invalidate('ui.render'))
        }}
      />
    )
    const parkedRows = v.parked.map(p =>
      isHeadsDown ? (
        <Text key={`parked-${p.id}`} dimColor wrap="truncate-end">
          {p.text}
        </Text>
      ) : (
        <Box key={`parked-${p.id}`} flexDirection="row" columnGap={1} alignItems="center">
          <Button key={`park-done-${p.id}`} label="✓" plain dimColor onPress={() => void f.clearParked(p.id)} />
          <Button key={`park-ask-${p.id}`} label="Ask" plain dimColor onPress={() => void f.askParked(p.id)} />
          <Text wrap="truncate-end">{p.text}</Text>
        </Box>
      ),
    )
    const parked = d.isFocus
      ? card(
          v.parked.length > 0 ? `Parked for your break (${v.parked.length})` : 'Park a stray thought',
          'Get it out of your head and back to the block',
          parkField,
          ...parkedRows,
        )
      : v.parked.length > 0
        ? card(`Parked (${v.parked.length})`, 'Tick it off, or hand it to Claude', ...parkedRows)
        : null

    const [did, partly, distracted] = v.quality
    const answered = did + partly + distracted
    const stats =
      Svg !== undefined ? (
        <Svg
          source={daySvg({
            today: v.today,
            goal: s.goal,
            minutes: v.todayMinutes,
            streak: v.streak,
            onTask: answered === 0 ? undefined : (did + partly / 2) / answered,
            isFocusing: d.isFocus,
            week: v.week,
          })}
          alt={`Today ${goal}, ${v.todayMinutes} minutes, streak ${v.streak}. ${v.week.map(day => `${day.label} ${day.count}`).join(', ')}`}
        />
      ) : (
        <Box flexDirection="column">
          <Text>
            <Text weight="semibold">Today </Text>
            {v.today}
            {s.goal > 0 ? `/${s.goal}` : ''}, {v.todayMinutes} min, streak {v.streak}
            <Text dimColor> {dots(v.cycleDone, s.longEvery)}</Text>
          </Text>
          <Text dimColor>Week {v.week.map(day => `${day.label.slice(0, 2)} ${day.count}`).join('  ')}</Text>
        </Box>
      )

    const noise = even(
      ...NOISES.map(kind => (
        <Button
          key={`noise-${kind}`}
          label={kind === 'off' ? 'Off' : `${kind[0]?.toUpperCase()}${kind.slice(1)}`}
          variant={v.noise === kind ? 'primary' : 'secondary'}
          dimColor={v.noise !== kind}
          onPress={() => void f.setNoise(kind)}
        />
      )),
    )

    // Where blocks go: connected, or a field to connect it, instead of pointing at a settings screen.
    const vault = v.needsVault ? (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Paste your Obsidian vault's folder to add each block and parked thought to your daily note.</Text>
        <Input key="vault" placeholder="~/Documents/My Vault" submitLabel="connect" onSubmit={value => void f.setVaultPath(value)} />
      </Box>
    ) : (
      <Text dimColor>{[v.vaultName === '' ? v.logLine : `Connected to your ${v.vaultName} vault`, v.switchLine].filter(line => line !== '').join('. ')}</Text>
    )

    return (
      <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        {hero}
        {now}
        {parked}
        {stats}
        {card('Background noise', 'A steady bed of sound, quiet during breaks', noise, vault)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)

    if (e.props.hasSurvey || v === null || focus === undefined) {
      return next(e)
    }

    const f = focus
    const d = describe({ ...v, now: await $.clock.now() })

    if (d.isIdle && !s.showWhenIdle) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const goal = s.goal > 0 ? `${v.today}/${s.goal} today` : `${v.today} today`
    const openPane = () => void $.ui.open({ id: PANE, title: TITLE, focus: true }).catch(() => undefined)

    if (d.isIdle) {
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
          <Text dimColor>Ready to focus, {goal}</Text>
          <Button key="start" label="Start focus" dimColor onPress={() => void f.start('')} />
          <Button key="open" label="Dashboard" dimColor onPress={openPane} />
        </Box>
      )
    }

    const time = d.isFlow && d.isFocus ? `${Math.floor(d.done / 60_000)} min in` : `${formatLeft(d.left, s.showSeconds)} left`

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        <Text wrap="truncate-end">
          <Text color={d.color} weight="semibold">
            {d.isPaused ? `Paused ${d.name.toLowerCase()}` : d.name}
          </Text>
          <Text tabular> {time}</Text>
          <Text dimColor>{d.intention !== '' ? ` · ${d.intention}` : ''}</Text>
        </Text>
        <Text dimColor>
          {dots(v.cycleDone, s.longEvery)} · {goal}
        </Text>
        {d.isPaused && <Button key="resume" label="Resume" onPress={() => void f.resume()} />}
        {!d.isPaused && d.isFocus && d.isFlow && <Button key="done" label="Done" dimColor onPress={() => void f.finish()} />}
        {!d.isPaused && d.isFocus && !d.isFlow && <Button key="pause" label="Pause" dimColor onPress={() => void f.pause()} />}
        {!d.isPaused && !d.isFocus && <Button key="skip" label="Skip break" dimColor onPress={() => void f.skip()} />}
        <Button key="open" label="Dashboard" dimColor onPress={openPane} />
      </Box>
    )
  })
}
