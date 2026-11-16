import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pomo',
  component: 'Pane',
  requestId: 'focus',
  props: {
    title: 'Focus',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'pomo',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 60, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const START = Date.UTC(2026, 10, 16, 1, 0, 0)

function engine(on: On) {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  mock.env(on, { CLAUDE_CODE_REMOTE: 'true', HOME: '/home/me' })
  on('command.register', () => ({ value: { command: 'pomo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return clock
}

test('the dashboard and band draw, count down, pause and resume on every surface', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Text', text: /READY/ }))?.text).toBe('READY')
    expect((await pane.find({ type: 'Text', text: /^25:00$/ }))?.text).toBe('25:00')
    await pane.unmount()

    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /Ready to focus/ }))?.text).toContain('0/8 today')
    await band.unmount()
  }

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'start' })
  await clock.advance(90_000)
  expect((await pane.find({ type: 'Text', text: /^FOCUS$/ }))?.text).toBe('FOCUS')
  expect((await pane.find({ type: 'Text', text: /^23:30$/ }))?.text).toBe('23:30')

  await pane.press({ key: 'pause' })
  await clock.advance(60_000)
  expect((await pane.find({ type: 'Text', text: /^23:30$/ }))?.text).toBe('23:30')
  await pane.press({ key: 'resume' })
  await clock.advance(30_000)
  expect((await pane.find({ type: 'Text', text: /^23:00$/ }))?.text).toBe('23:00')
  await pane.unmount()
})

test('a finished block counts once and the break starts', { options: { focusMinutes: 2, shortBreakMinutes: 1 } }, async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'start' })
  await clock.advance(2 * 60_000 + 1000)
  expect((await pane.find({ type: 'Text', text: /^BREAK$/ }))?.text).toBe('BREAK')
  expect((await pane.find({ type: 'Text', text: /blocks/ }))?.text).toContain('1 of 8 blocks')
  await pane.unmount()

  for (const surface of ['terminal', 'mobile'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /left/ }))?.text).toContain('Break')
    await band.unmount()
  }

  // The break ends and the next block waits to be started.
  await clock.advance(60_000 + 1000)
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await after.find({ type: 'Text', text: /READY/ }))?.text).toBe('READY')
  await after.unmount()

  const { text } = await $.command.run({
    command: 'pomo',
    args: 'stats',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(text).toContain('This week 1 blocks')
  expect(text).toContain('cloud session')
})
