import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { View } from '../types'
import { ringSvg, weekSvg } from './art'
import { NOISES, createFocus, settingsFrom } from './focus'
import type { Focus, Io } from './focus'
import { dots, formatLeft, remaining } from './timer'

const view = atom({ plugin: 'pomo', key: 'view' } as const, null, { shape: 'view-3' })

const PANE = 'focus'
const TITLE = 'Focus'

/** What the timer is doing, in the words and colors every drawing uses. */
function describe(v: View) {
  const t = v.timer
  const isIdle = t.phase === 'idle'
  const isPaused = t.phase === 'paused'
  const isFocus = t.phase === 'focus' || (t.phase === 'paused' && t.of === 'focus')
  const isLong = t.phase !== 'idle' && t.isLong
  const name = isIdle ? 'Ready' : isFocus ? 'Focus' : isLong ? 'Long break' : 'Break'
  const color = isIdle || isPaused ? 'inactive' : isFocus ? 'claude' : 'success'
  const left = remaining(t, v.now)
  const length = t.phase === 'idle' ? 0 : t.lengthMs
  const intention = t.phase !== 'idle' && isFocus ? t.intention : ''
  const ringPhase: 'idle' | 'focus' | 'break' | 'paused' = isIdle ? 'idle' : isPaused ? 'paused' : isFocus ? 'focus' : 'break'

  return { t, isIdle, isPaused, isFocus, name, color, left, length, intention, ringPhase }
}

export const register: Register = (on, options) => {
  const s = settingsFrom(options)
  const openOnStart = options.openOnStart !== false
  let focus: Focus | undefined
  // What's typed in the dashboard's field, so the Start button can use it.
  let draft = ''

  on('session.start', async ($, e, next) => {
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
      isCloud: async () => (await $.env.get('CLAUDE_CODE_REMOTE')) === 'true',
      toast: (text, timeoutMs) => $.ui.toast(text, { timeoutMs }),
      notify: text => {
        void $.ui.notify(text, { title: 'Focus' }).catch(() => undefined)
      },
      play: (asset, gain) => {
        void $.audio.play({ asset }, { gain }).catch(() => undefined)
      },
      loop: (asset, gain) => {
        const playing = new AbortController()
        void $.audio.play({ asset }, { shouldLoop: true, gain, signal: playing.signal }).catch(() => undefined)

        return () => playing.abort()
      },
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
      publish: async snapshot => {
        await update($, view, () => snapshot)
      },
    }

    focus?.end()
    focus = createFocus(io, s, e.cwd)
    await $.command.register({
      name: 'pomo',
      description: 'Focus dashboard and pomodoro timer: open it, start a block, pause, stop, noise, or see the week',
      argumentHint: '[start | <what you are working on> | pause | resume | stop | skip | noise | stats | help]',
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

  on('command.run', { command: 'pomo' }, async ($, e) => {
    if (focus === undefined) {
      return { text: 'The focus timer is still starting. Try again in a moment.' }
    }

    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const seat = opened.isPlaced ? '' : `\nThe dashboard is open but not drawn here: ${opened.reason}`

    if (e.args.trim() === '') {
      return { text: opened.isPlaced ? 'Focus dashboard open.' : seat.trim() }
    }

    return { text: (await focus.command(e.args)) + seat }
  }).catch(() => ({ text: 'The focus timer hit an error. Run /pomo again, or restart the session.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = await read($, view)
    const f = focus
    const els = $.ui.resolve(e)
    const { Box, Button, Input, Progress, Text } = els

    if (v === null || f === undefined) {
      return <Text dimColor>Starting the focus timer…</Text>
    }

    const d = describe(v)
    const clock = formatLeft(d.isIdle ? s.focusMs : d.left, true)
    const round = (v.cycleDone % s.longEvery) + (d.isFocus ? 1 : 0)
    const sub = d.isIdle
      ? `${v.today} of ${s.goal || '-'} today`
      : d.isFocus
        ? `round ${Math.min(round, s.longEvery)} of ${s.longEvery}`
        : 'stand up · look away'
    const drawsSvg = e.surface !== 'terminal' && 'Svg' in els
    const Svg = 'Svg' in els ? els.Svg : undefined

    // The small form of a minimized pane on the desktop: a glance, no form.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text color={d.color} weight="semibold" size="caption">
            {d.isPaused ? `${d.name} · paused` : d.name}
          </Text>
          <Text size="title" weight="bold" tabular>
            {clock}
          </Text>
          <Text dimColor size="caption">
            {v.today}/{s.goal || '-'} today
          </Text>
        </Box>
      )
    }

    const fraction = d.length > 0 ? (d.length - d.left) / d.length : 0
    const hero =
      drawsSvg && Svg !== undefined ? (
        <Box flexDirection="column" alignItems="center">
          <Svg
            source={ringSvg({ fraction, phase: d.ringPhase, label: d.isPaused ? `${d.name} · paused` : d.name, clock, sub })}
            alt={`${d.name}, ${clock} left`}
            width={240}
            height={240}
          />
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={d.color} weight="semibold">
            {(d.isPaused ? `${d.name} · paused` : d.name).toUpperCase()}
            <Text dimColor> {sub}</Text>
          </Text>
          <Text weight="bold" tabular>
            {clock}
          </Text>
          {!d.isIdle && (
            <Progress
              label={`${d.name} progress`}
              value={d.length - d.left}
              max={d.length}
              valueText={`${Math.floor((d.length - d.left) / 60_000)} of ${Math.round(d.length / 60_000)} min`}
              color={d.isFocus ? 'claude' : 'success'}
            />
          )}
        </Box>
      )

    const controls = d.isIdle ? (
      <Box flexDirection="column" gap={1}>
        <Input
          key="intention"
          placeholder="The one thing"
          submitLabel="start"
          onInput={value => {
            draft = value
          }}
          onSubmit={value => {
            draft = ''
            void f.start(value.trim())
          }}
        />
        <Button
          key="start"
          label={`Start ${Math.round(s.focusMs / 60_000)} min focus`}
          variant="primary"
          onPress={() => {
            const intention = draft.trim()
            draft = ''
            void f.start(intention)
          }}
        />
      </Box>
    ) : (
      <Box flexDirection="column" gap={1}>
        {d.intention !== '' && <Text weight="medium">{d.intention}</Text>}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {d.isPaused && <Button key="resume" label="Resume" variant="primary" onPress={() => void f.resume()} />}
          {!d.isPaused && <Button key="pause" label="Pause" onPress={() => void f.pause()} />}
          {!d.isFocus && <Button key="skip" label="Skip break" onPress={() => void f.skip()} />}
          <Button key="stop" label={d.isFocus ? 'Give up' : 'End break'} dimColor onPress={() => void f.stop()} />
        </Box>
      </Box>
    )

    const noise = (
      <Box flexDirection="column">
        <Text dimColor size="caption">
          NOISE
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
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
      </Box>
    )

    const today = (
      <Box flexDirection="column">
        <Text>
          <Text weight="semibold">Today </Text>
          <Text tabular>
            {v.today}
            {s.goal > 0 ? ` of ${s.goal}` : ''}
          </Text>
          <Text dimColor>
            {'  '}
            {dots(v.cycleDone, s.longEvery)}
          </Text>
        </Text>
        {s.goal > 0 && (
          <Progress label="Daily goal" value={Math.min(v.today, s.goal)} max={s.goal} valueText={`${v.today} of ${s.goal}`} color="claude" />
        )}
      </Box>
    )

    const week =
      drawsSvg && Svg !== undefined ? (
        <Box flexDirection="column">
          <Text dimColor size="caption">
            THIS WEEK · {v.week.reduce((n, day) => n + day.count, 0)} BLOCKS
          </Text>
          <Svg source={weekSvg(v.week, s.goal)} alt={v.week.map(day => `${day.label} ${day.count}`).join(', ')} width={280} height={112} />
        </Box>
      ) : (
        <Text dimColor>
          Week{' '}
          {v.week.map(day => `${day.label.slice(0, 2)} ${day.count}`).join('  ')}
        </Text>
      )

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {hero}
        {controls}
        {today}
        {week}
        {noise}
        <Text dimColor size="footnote">
          {v.logLine}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)

    if (e.props.hasSurvey || v === null || focus === undefined) {
      return next(e)
    }

    const f = focus
    const d = describe(v)

    if (d.isIdle && !s.showWhenIdle) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const goal = s.goal > 0 ? `${v.today}/${s.goal} today` : `${v.today} today`
    const openPane = () => void $.ui.open({ id: PANE, title: TITLE, focus: true }).catch(() => undefined)

    if (d.isIdle) {
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
          <Text dimColor>Ready to focus · {goal}</Text>
          <Button key="start" label="Start focus" dimColor onPress={() => void f.start('')} />
          <Button key="open" label="Dashboard" dimColor onPress={openPane} />
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        <Text wrap="truncate-end">
          <Text color={d.color} weight="semibold">
            {d.isPaused ? `Paused ${d.name.toLowerCase()}` : d.name}
          </Text>
          <Text tabular> {formatLeft(d.left, s.showSeconds)} left</Text>
          <Text dimColor>{d.intention !== '' ? ` · ${d.intention}` : ''}</Text>
        </Text>
        <Text dimColor>
          {dots(v.cycleDone, s.longEvery)} · {goal}
        </Text>
        {d.isPaused && <Button key="resume" label="Resume" onPress={() => void f.resume()} />}
        {!d.isPaused && d.isFocus && <Button key="pause" label="Pause" dimColor onPress={() => void f.pause()} />}
        {!d.isPaused && !d.isFocus && <Button key="skip" label="Skip break" dimColor onPress={() => void f.skip()} />}
        <Button key="open" label="Dashboard" dimColor onPress={openPane} />
      </Box>
    )
  })
}
