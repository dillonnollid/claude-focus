import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { View } from '../types'
import { createFocus, settingsFrom } from './focus'
import type { Focus, Io } from './focus'
import { dots, formatLeft, remaining } from './timer'

const view = atom({ plugin: 'pomo', key: 'view' } as const, null, { shape: 'view-2' })

const PANE = 'focus'
const TITLE = 'Focus'

/** What the timer is doing, in the words and colors both drawings use. */
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

  return { t, isIdle, isPaused, isFocus, name, color, left, length, intention }
}

export const register: Register = (on, options) => {
  const s = settingsFrom(options)
  const openOnStart = options.openOnStart !== false
  let focus: Focus | undefined

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
      description: 'Focus dashboard and pomodoro timer: open it, start a block, pause, stop, or see the week',
      argumentHint: '[start | <what you are working on> | pause | resume | stop | skip | stats | help]',
    })
    await focus.begin()

    if (openOnStart) {
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
    const { Box, Button, Input, Progress, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const f = focus

    if (v === null || f === undefined) {
      return <Text dimColor>Starting the focus timer…</Text>
    }

    const d = describe(v)
    const clock = d.isIdle ? formatLeft(s.focusMs, true) : formatLeft(d.left, true)
    const goalMax = Math.max(s.goal, v.today, 1)

    const controls = d.isIdle ? (
      <Box flexDirection="column" gap={1}>
        <Input
          key="intention"
          placeholder="What are you working on?"
          submitLabel="start"
          onSubmit={value => void f.start(value.trim())}
        />
        <Button key="start" label={`Start ${Math.round(s.focusMs / 60_000)} min focus`} variant="primary" onPress={() => void f.start('')} />
      </Box>
    ) : (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {d.isPaused && <Button key="resume" label="Resume" variant="primary" onPress={() => void f.resume()} />}
        {!d.isPaused && <Button key="pause" label="Pause" onPress={() => void f.pause()} />}
        {!d.isFocus && <Button key="skip" label="Skip break" onPress={() => void f.skip()} />}
        <Button key="stop" label={d.isFocus ? 'Stop (not counted)' : 'End break'} dimColor onPress={() => void f.stop()} />
      </Box>
    )

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

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column">
          <Text color={d.color} weight="semibold" size="caption">
            {(d.isPaused ? `${d.name} · paused` : d.name).toUpperCase()}
          </Text>
          <Text size="title" weight="bold" tabular color={d.isIdle ? 'inactive' : undefined}>
            {clock}
          </Text>
          {d.intention !== '' && <Text dimColor>{d.intention}</Text>}
          {!d.isIdle && !d.isFocus && <Text dimColor>Stand up, drink some water, look at something far away.</Text>}
        </Box>

        {!d.isIdle && (
          <Progress
            label={`${d.name} progress`}
            value={d.length - d.left}
            max={d.length}
            valueText={`${Math.floor((d.length - d.left) / 60_000)} of ${Math.round(d.length / 60_000)} min`}
            color={d.isFocus ? 'claude' : 'success'}
          />
        )}

        {controls}

        <Box flexDirection="column">
          <Text weight="semibold">Today</Text>
          <Text>
            <Text tabular>
              {v.today}
              {s.goal > 0 ? ` of ${s.goal}` : ''} blocks
            </Text>
            <Text dimColor>
              {'  '}
              {dots(v.cycleDone, s.longEvery)} long break after {s.longEvery}
            </Text>
          </Text>
          {s.goal > 0 && <Progress label="Daily goal" value={v.today} max={goalMax} valueText={`${v.today} of ${s.goal}`} color="claude" />}
        </Box>

        <Box flexDirection="column">
          <Text weight="semibold">This week</Text>
          {v.week.map(day => (
            <Text>
              <Text tabular dimColor={!day.isToday} weight={day.isToday ? 'semibold' : undefined}>
                {day.label.padEnd(10)} {day.count.toString().padStart(2)}{'  '}
              </Text>
              <Text color="claude">{'●'.repeat(Math.min(day.count, 16))}</Text>
            </Text>
          ))}
        </Box>

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
