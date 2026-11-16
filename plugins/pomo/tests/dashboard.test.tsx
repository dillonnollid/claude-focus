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
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'pomo',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 60, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const START = Date.UTC(2026, 10, 16, 1, 0, 0)
const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

type Mounted = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }

/** The ring's SVG text on a surface that draws it. */
async function ring(pane: Mounted): Promise<string> {
  const svg = await pane.find({ type: 'Svg' })

  return String(svg?.props.source ?? '')
}

/** The engine beneath the plugin. `ran` collects every command it runs. */
function engine(on: On, opts: { isCloud?: boolean; tools?: string[] } = {}) {
  const clock = mock.clock(on, { now: START })
  const ran: string[] = []
  mock.store(on)
  mock.env(on, opts.isCloud === false ? { HOME: '/home/me' } : { CLAUDE_CODE_REMOTE: 'true', HOME: '/home/me' })
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    ran.push(line)
    const tool = /^sh -c command -v (\S+)$/.exec(line)?.[1]
    const isThere = tool !== undefined && (opts.tools ?? []).includes(tool)

    return { value: { exitCode: tool === undefined || isThere ? 0 : 1, stdout: '', ...RAN } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return { clock, ran }
}

type Runs = {
  command: {
    run: (a: {
      command: string
      args: string
      origin: { kind: 'composer' }
      presentation: { isFullscreen: boolean; columns: number }
    }) => Promise<{ text?: string }>
  }
}

const run = ($: Runs, command: string, args: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('the dashboard draws on every surface, starts from a preset, counts down, pauses and resumes', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  // The terminal draws text; the apps draw the ring and the stats as SVG.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^READY/ }))?.text).toContain('READY')
  expect((await term.find({ key: 'start' }))?.text).toBe('25 min')
  await term.unmount()

  for (const surface of ['desktop', 'mobile'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await ring(pane)).toContain('>READY<')
    expect(await ring(pane)).toContain('>25:00<')
    expect((await pane.find({ key: 'start-50' }))?.text).toBe('50 min')
    expect((await pane.find({ key: 'start-flow' }))?.text).toBe('Flow')
    expect((await pane.find({ key: 'noise-brown' }))?.text).toBe('Brown')
    await pane.unmount()
  }

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /Ready to focus/ }))?.text).toContain('0/8 today')
    await band.unmount()
  }

  // Type the one thing, press 50 min: the ring counts down with it.
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.ui.input({ plugin: 'pomo', key: 'intention', text: 'CV intro', kind: 'change' })
  await pane.press({ key: 'start-50' })
  await clock.advance(90_000)
  expect(await ring(pane)).toContain('>FOCUS<')
  expect(await ring(pane)).toContain('>48:30<')
  expect((await pane.find({ type: 'Text', text: /CV intro/ }))?.text).toBe('CV intro')

  await pane.press({ key: 'pause' })
  await clock.advance(60_000)
  expect(await ring(pane)).toContain('PAUSED')
  expect(await ring(pane)).toContain('>48:30<')
  await pane.press({ key: 'resume' })
  await pane.press({ key: 'more' })
  await clock.advance(30_000)
  expect(await ring(pane)).toContain('>53:00<')

  await pane.press({ key: 'noise-brown' })
  expect((await pane.find({ key: 'noise-brown' }))?.props.variant).toBe('primary')
  await pane.unmount()
})

test(
  'a finished block counts once, asks how it went, and shows what was parked',
  { options: { focusMinutes: 2, shortBreakMinutes: 1 } },
  async ($, on) => {
    const { clock } = engine(on)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.press({ key: 'start' })
    await $.ui.input({ plugin: 'pomo', key: 'park', text: 'reply to Sam about Friday' })
    expect((await run($, 'park', 'look up flights')).text).toContain('Parked')

    // While focusing, parked thoughts stay out of sight.
    expect(await pane.find({ type: 'Text', text: /reply to Sam/ })).toBeUndefined()

    await clock.advance(2 * 60_000 + 1000)
    expect(await ring(pane)).toContain('>BREAK<')
    expect((await pane.find({ type: 'Text', text: /How did that block go/ }))?.text).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /reply to Sam/ }))?.text).toBe('reply to Sam about Friday')
    expect((await pane.find({ type: 'Text', text: /PARKED/ }))?.text).toContain('2')

    await pane.press({ key: 'check-did' })
    expect(await pane.find({ type: 'Text', text: /How did that block go/ })).toBeUndefined()
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

    const text = (await run($, 'pomo', 'stats')).text ?? ''
    expect(text).toContain('This week 1 blocks, 0 h 2 min')
    expect(text).toContain('1 did it')
    expect(text).toContain('cloud session')
  },
)

test('flow counts up, ends when you say, and earns a break of a fifth', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  expect((await run($, 'pomo', 'flow write the essay')).text).toContain('flow mode')
  await clock.advance(40 * 60_000)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ring(pane)).toContain('>FLOW<')
  expect(await ring(pane)).toContain('>40:00<')
  await pane.press({ key: 'done' })
  expect(await ring(pane)).toContain('>BREAK<')
  expect(await ring(pane)).toContain('>8:00<')
  await pane.unmount()

  expect((await run($, 'pomo', 'stats')).text).toContain('0 h 40 min')
})

test('the focus switch silences notifications for the block and brings them back', async ($, on) => {
  const { clock, ran } = engine(on, { isCloud: false, tools: ['makoctl'] })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  await run($, 'pomo', 'start')
  expect(ran).toContain('makoctl mode -a do-not-disturb')
  expect(ran).not.toContain('makoctl mode -r do-not-disturb')

  await run($, 'pomo', 'pause')
  expect(ran).toContain('makoctl mode -r do-not-disturb')

  await run($, 'pomo', 'resume')
  await clock.advance(25 * 60_000 + 1000)
  expect(ran.filter(line => line === 'makoctl mode -a do-not-disturb')).toHaveLength(2)
  expect(ran.filter(line => line === 'makoctl mode -r do-not-disturb')).toHaveLength(2)
})

test('Claude is told the block and its purpose while it runs, and nothing otherwise', async ($, on) => {
  engine(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  const ask = () => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })

  expect((await ask()).sections).toHaveLength(1)
  await run($, 'pomo', 'interview prep for civmec')
  const during = await ask()
  expect(during.sections.at(-1)?.id).toBe('pomo:focus')
  expect(during.sections.at(-1)?.text).toContain('interview prep for civmec')
  await run($, 'pomo', 'stop')
  expect((await ask()).sections).toHaveLength(1)
})
