import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { View } from '../types'
import { daySvg, ringSvg } from './art'
import { mascotSvg } from './mascot'
import type { MascotState } from './mascot'
import { NOISES, createFocus, settingsFrom } from './focus'
import type { Focus, Io, RunResult } from './focus'
import { dots, elapsed, formatLeft, remaining } from './timer'

const view = atom({ plugin: 'pomo', key: 'view' } as const, null, { shape: 'view-5' })

const PANE = 'focus'
const TITLE = 'Focus'
// The ring keeps its own time, so it is only drawn again when the timer
// changes; this is the longest one drawing is trusted before a fresh one.
const RING_TRUST_MS = 5 * 60_000

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
  let ring: { key: string; at: number; source: string } | undefined
  let mascot: { key: string; source: string } | undefined
  // Bumped when the app connects, so a fresh window gets a fresh ring.
  let mounts = 0

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
    mounts += 1

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
    // The header says what is happening and what for; the ring keeps to the time.
    const headline = d.isIdle ? 'Ready when you are' : d.isPaused ? 'Paused' : d.isFocus ? (d.isFlow ? 'In flow' : 'Focusing') : d.name === 'Long break' ? 'Long break' : 'On a break'
    const detail = d.isIdle
      ? goal
      : d.isFocus
        ? d.intention !== ''
          ? d.intention
          : d.isFlow
            ? 'no clock to beat, stop when you are done'
            : `block ${round} of ${s.longEvery}`
        : 'stand up, look far away'
    const sub = d.isFlow && d.isFocus ? 'end it when you are done' : ''
    const pose: MascotState = d.isIdle ? 'idle' : d.isPaused ? 'paused' : d.isFocus ? (d.isFlow ? 'flow' : 'focus') : 'break'
    // A break that has only just begun gets a little celebration first.
    const isFresh = pose === 'break' && d.done < 10_000

    // One drawing per pose, kept between redraws so the animation never restarts.
    const mascotKey = JSON.stringify([mounts, pose, isFresh])

    if (mascot === undefined || mascot.key !== mascotKey) {
      mascot = { key: mascotKey, source: mascotSvg(pose, isFresh) }
    }

    const cinder = mascot.source

    // The small form of a minimized pane on the desktop: a glance, no form.
    if (e.props.placement === 'widget') {
      const glance = (
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

      return Svg === undefined ? (
        glance
      ) : (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Svg source={cinder} alt={`Cinder the ember, ${headline.toLowerCase()}`} width={56} height={43} isInteractive />
          {glance}
        </Box>
      )
    }

    let hero
    let header

    if (Svg !== undefined) {
      header = (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Svg source={cinder} alt={`Cinder the ember, ${headline.toLowerCase()}`} width={96} height={74} isInteractive />
          <Box flexDirection="column" flexShrink={1}>
            <Text color={d.color} weight="semibold">
              {headline}
            </Text>
            <Text dimColor wrap="truncate-end">
              {detail}
            </Text>
          </Box>
        </Box>
      )

      // One drawing per state of the timer. It animates itself from there, so
      // redrawing the dashboard around it never restarts or blinks the clock.
      const key = JSON.stringify([mounts, v.epoch, e.props.placement, d.t, label, sub, round, s.longEvery, d.isIdle ? s.focusMs : 0])

      if (ring === undefined || ring.key !== key || v.now - ring.at > RING_TRUST_MS) {
        ring = {
          key,
          at: v.now,
          source: ringSvg({
            phase: d.ringPhase,
            label,
            sub,
            elapsedMs: d.isIdle ? 0 : d.done,
            lengthMs: d.isIdle ? s.focusMs : d.isFlow && d.isFocus ? 25 * 60_000 : d.length,
            isCountUp: d.isFlow && d.isFocus,
            isLive: !d.isIdle && !d.isPaused,
            round: d.isIdle || !d.isFocus || d.isFlow ? 0 : round,
            rounds: d.isIdle || !d.isFocus || d.isFlow ? 0 : s.longEvery,
          }),
        }
      }

      hero = <Svg source={ring.source} alt={`${label}, ${formatLeft(d.isIdle ? s.focusMs : d.left, false)}${d.isIdle ? '' : ' left'}`} width={280} height={264} isInteractive />
    } else {
      header = null
      hero = (
        <Box flexDirection="column">
          <Text color={d.color} weight="semibold">
            {label}
            <Text dimColor> {detail}</Text>
          </Text>
          <Text weight="bold" tabular>
            {d.isFlow && d.isFocus ? `${Math.floor(d.done / 60_000)} min in` : `${formatLeft(d.isIdle ? s.focusMs : d.left, false)}${d.isIdle ? '' : ' left'}`}
          </Text>
        </Box>
      )
    }

    const startWith = (preset: 'pomodoro' | 'long' | 'flow') => () => {
      const intention = draft.trim()
      draft = ''
      void f.start(intention, preset)
    }

    const controls = d.isIdle ? (
      <Box flexDirection="column" gap={1}>
        <Input
          key="intention"
          placeholder="The one thing this block is for"
          submitLabel="start"
          onInput={value => {
            draft = value
          }}
          onSubmit={value => {
            draft = value
            startWith('pomodoro')()
          }}
        />
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          <Button key="start" label={`${Math.round(s.focusMs / 60_000)} min`} variant="primary" onPress={startWith('pomodoro')} />
          <Button key="start-50" label="50 min" onPress={startWith('long')} />
          <Button key="start-flow" label="Flow" onPress={startWith('flow')} />
        </Box>
      </Box>
    ) : d.isFocus ? (
      <Box flexDirection="column" gap={1}>
        <Input
          key={`park-${parkSeq}`}
          placeholder="Stray thought? Park it for the break"
          submitLabel="park"
          autoFocus
          onSubmit={value => {
            // A new field next draw, empty, whatever came of this one.
            parkSeq += 1
            void f.park(value).finally(() => $.ui.invalidate('ui.render'))
          }}
        />
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {d.isPaused && <Button key="resume" label="Resume" variant="primary" onPress={() => void f.resume()} />}
          {!d.isPaused && d.isFlow && <Button key="done" label="Done, take a break" variant="primary" onPress={() => void f.finish()} />}
          {!d.isPaused && <Button key="pause" label="Pause" onPress={() => void f.pause()} />}
          {!d.isPaused && !d.isFlow && <Button key="more" label="+5 min" onPress={() => void f.addFive()} />}
          <Button key="stop" label="Give up" dimColor onPress={() => void f.stop()} />
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column" gap={1}>
        {v.checkIn !== null && (
          <Box flexDirection="column">
            <Text weight="medium">How did that block go?</Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
              <Button key="check-did" label="Did it" onPress={() => void f.answerCheckIn('did')} />
              <Button key="check-partly" label="Partly" onPress={() => void f.answerCheckIn('partly')} />
              <Button key="check-distracted" label="Got distracted" onPress={() => void f.answerCheckIn('distracted')} />
            </Box>
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {d.isPaused && <Button key="resume" label="Resume" variant="primary" onPress={() => void f.resume()} />}
          <Button key="skip" label="Skip break" dimColor onPress={() => void f.skip()} />
        </Box>
      </Box>
    )

    // Mid-block the list only shows the thought landed; it is dealt with at the break.
    const isHeadsDown = d.isFocus && !d.isPaused
    const parked =
      v.parked.length > 0 ? (
        <Box flexDirection="column">
          <Text dimColor size="caption">
            {isHeadsDown ? `Parked for your break (${v.parked.length})` : `Parked (${v.parked.length}). Tick it off, or hand it to Claude`}
          </Text>
          {v.parked.map(p =>
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
          )}
        </Box>
      ) : null

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
            isFresh: v.checkIn !== null,
            week: v.week,
          })}
          alt={`Today ${goal}, ${v.todayMinutes} minutes, streak ${v.streak}. ${v.week.map(day => `${day.label} ${day.count}`).join(', ')}`}
          width={280}
          height={200}
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

    const noise = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} alignItems="center">
        <Text dimColor size="caption">
          Noise
        </Text>
        {NOISES.map(kind => (
          <Button
            key={`noise-${kind}`}
            label={kind === 'off' ? 'Off' : `${kind[0]?.toUpperCase()}${kind.slice(1)}`}
            variant={v.noise === kind ? 'primary' : 'secondary'}
            dimColor={v.noise !== kind}
            onPress={() => void f.setNoise(kind)}
          />
        ))}
      </Box>
    )

    // No vault found: ask for it here, once, instead of pointing at a settings screen.
    const vault = v.needsVault ? (
      <Box flexDirection="column">
        <Text dimColor size="caption">
          Blocks and parked thoughts can go in your Obsidian daily note. Paste your vault's folder to turn that on.
        </Text>
        <Input key="vault" placeholder="~/Documents/My Vault" submitLabel="save" onSubmit={value => void f.setVaultPath(value)} />
      </Box>
    ) : (
      <Text dimColor size="footnote">
        {[v.switchLine, v.vaultName === '' ? v.logLine : `Logging to your ${v.vaultName} vault`].filter(line => line !== '').join('. ')}
      </Text>
    )

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {header}
        {hero}
        {controls}
        {parked}
        {stats}
        {noise}
        {vault}
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
