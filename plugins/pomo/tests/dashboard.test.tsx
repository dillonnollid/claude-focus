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

type Mounted = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }

/** The ring's SVG text on a surface that draws it. */
async function ring(pane: Mounted): Promise<string> {
  const svg = await pane.find({ type: 'Svg' })

  return String(svg?.props.source ?? '')
}

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

  // The terminal draws text; the apps draw the ring and the week as SVG.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^READY/ }))?.text).toContain('READY')
  expect((await term.find({ type: 'Text', text: /^25:00$/ }))?.text).toBe('25:00')
  await term.unmount()

  for (const surface of ['desktop', 'mobile'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await ring(pane)).toContain('>READY<')
    expect(await ring(pane)).toContain('>25:00<')
    expect((await pane.find({ key: 'start' }))?.text).toContain('Start 25 min focus')
    expect((await pane.find({ key: 'noise-brown' }))?.text).toBe('Brown')
    await pane.unmount()
  }

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /Ready to focus/ }))?.text).toContain('0/8 today')
    await band.unmount()
  }

  // Type the one thing, press Start: the ring counts down with it.
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.ui.input({ plugin: 'pomo', key: 'intention', text: 'CV intro', kind: 'change' })
  await pane.press({ key: 'start' })
  await clock.advance(90_000)
  expect(await ring(pane)).toContain('>FOCUS<')
  expect(await ring(pane)).toContain('>23:30<')
  expect((await pane.find({ type: 'Text', text: /CV intro/ }))?.text).toBe('CV intro')

  await pane.press({ key: 'pause' })
  await clock.advance(60_000)
  expect(await ring(pane)).toContain('>23:30<')
  expect(await ring(pane)).toContain('PAUSED')
  await pane.press({ key: 'resume' })
  await clock.advance(30_000)
  expect(await ring(pane)).toContain('>23:00<')

  await pane.press({ key: 'noise-brown' })
  expect((await pane.find({ key: 'noise-brown' }))?.props.variant).toBe('primary')
  await pane.unmount()
})

test('a finished block counts once and the break starts', { options: { focusMinutes: 2, shortBreakMinutes: 1 } }, async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'start' })
  await clock.advance(2 * 60_000 + 1000)
  expect(await ring(pane)).toContain('>BREAK<')
  expect((await pane.find({ type: 'Text', text: /^Today/ }))?.text).toContain('Today 1 of 8')
  await pane.unmount()

  for (const surface of ['terminal', 'mobile'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /left/ }))?.text).toContain('Break')
    await band.unmount()
  }

  // The break ends and the next block waits to be started.
  await clock.advance(60_000 + 1000)
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ring(after)).toContain('>READY<')
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
