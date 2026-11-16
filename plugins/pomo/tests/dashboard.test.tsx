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

type Found = { text: string; props: Record<string, unknown> }
type Mounted = {
  find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<Found | undefined>
  findAll: (q: { type?: string }) => Promise<Found[]>
}

/** The ring's SVG text on a surface that draws it: its title says what it was drawn as. */
async function ring(pane: Mounted): Promise<string> {
  const svg = (await pane.findAll({ type: 'Svg' })).find(found => !String(found.props.alt).startsWith('Cinder'))

  return String(svg?.props.source ?? '')
}

/** What the ring says now, in words: the drawing itself animates between redraws. */
async function ringNow(pane: Mounted): Promise<string> {
  const svg = (await pane.findAll({ type: 'Svg' })).find(found => !String(found.props.alt).startsWith('Cinder'))

  return String(svg?.props.alt ?? '')
}

/** The engine beneath the plugin. `ran` collects every command it runs. */
function engine(on: On, opts: { isCloud?: boolean; tools?: string[]; isPlaced?: boolean } = {}) {
  const clock = mock.clock(on, { now: START })
  const ran: string[] = []
  const toasts: string[] = []
  const filled: string[] = []
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
  on('ui.open', () =>
    opts.isPlaced === false ? { value: { isPlaced: false, reason: 'no-surface: no surface is attached' } } : { value: { isPlaced: true } },
  )
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return { clock, ran, toasts, filled }
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
  expect((await term.find({ type: 'Text', text: /^Ready/ }))?.text).toContain('0 of 8 today')
  expect((await term.find({ key: 'start' }))?.text).toBe('▶ 25 min')
  await term.unmount()

  for (const surface of ['desktop', 'mobile'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await ring(pane)).toContain('<title>Ready 25:00</title>')
    expect((await pane.find({ key: 'start-50' }))?.text).toBe('▶▶ 50 min')
    expect((await pane.find({ key: 'start-flow' }))?.text).toBe('∞ Flow')
    expect((await pane.find({ key: 'noise-brown' }))?.text).toBe('▁ Brown')
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
  const drawnAtStart = await ring(pane)
  expect(drawnAtStart).toContain('<title>Focus 50:00</title>')
  const cinder = (await pane.findAll({ type: 'Svg' })).find(found => String(found.props.alt).startsWith('Cinder'))
  expect(String(cinder?.props.source)).toContain('typing away')
  await clock.advance(90_000)
  // One drawing serves the whole block: it runs its own clock, so nothing
  // swaps it mid-block. That swap is what made the clock blink.
  expect(await ring(pane)).toBe(drawnAtStart)
  expect(await ringNow(pane)).toBe('Focus, 49 min left')

  await pane.press({ key: 'pause' })
  await clock.advance(60_000)
  expect(await ring(pane)).toContain('<title>Focus, paused 48:30</title>')
  await pane.press({ key: 'resume' })
  await pane.press({ key: 'more' })
  expect(await ring(pane)).toContain('<title>Focus 53:30</title>')
  await clock.advance(30_000)
  expect(await ringNow(pane)).toBe('Focus, 53 min left')

  await pane.press({ key: 'noise-brown' })
  expect((await pane.find({ key: 'noise-brown' }))?.props.variant).toBe('primary')
  await pane.unmount()
})

test(
  'a finished block counts once, asks how it went, and shows what was parked',
  { options: { focusMinutes: 2, shortBreakMinutes: 1 } },
  async ($, on) => {
    const { clock, toasts, filled } = engine(on)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.press({ key: 'start' })

    // Parking answers at once: a toast, the thought in the list, and an empty box for the next.
    expect(await pane.find({ key: 'park-0' })).toBeDefined()
    await $.ui.input({ plugin: 'pomo', key: 'park-0', text: 'reply to Sam about Friday' })
    expect(toasts.at(-1)).toContain('Parked')
    expect(await pane.find({ key: 'park-0' })).toBeUndefined()
    expect(await pane.find({ key: 'park-1' })).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /reply to Sam/ }))?.text).toBe('· reply to Sam about Friday')
    expect((await run($, 'park', 'look up flights')).text).toContain('Parked')

    // The same thought twice is parked once.
    await $.ui.input({ plugin: 'pomo', key: 'park-1', text: 'look up flights' })
    expect(toasts.at(-1)).toBe('Already parked.')
    expect(await pane.find({ key: 'park-2' })).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /Parked for your break/ }))?.text).toContain('(2)')

    // Mid-block the list has nothing to press; the actions come with the break.
    expect(await pane.find({ type: 'Button', text: 'Ask' })).toBeUndefined()

    await clock.advance(2 * 60_000 + 1000)
    expect(await ring(pane)).toContain('<title>Break 01:00</title>')
    expect((await pane.find({ type: 'Text', text: /How did that block go/ }))?.text).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /^Parked \(2\)/ }))?.text).toBe('Parked (2)')
    expect((await pane.find({ type: 'Text', text: /hand it to Claude/ }))?.text).toBeDefined()

    // "Ask" puts the thought in the prompt box and ticks it off.
    const ask = await pane.find({ type: 'Button', text: 'Ask' })
    await pane.press({ key: String(ask?.props.key) })
    expect(filled.at(-1)).toBe('reply to Sam about Friday')
    expect((await pane.find({ type: 'Text', text: /^Parked \(1\)/ }))?.text).toBeDefined()

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
    expect(await ring(after)).toContain('<title>Ready 02:00</title>')
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
  expect(await ring(pane)).toContain('<title>Flow 40:00</title>')
  await pane.press({ key: 'done' })
  expect(await ring(pane)).toContain('<title>Break 08:00</title>')
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

test('a leading number sets the length, and /pomo answers in text where no dashboard is drawn', async ($, on) => {
  engine(on, { isPlaced: false })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: true })

  expect((await run($, 'pomo', '')).text).toContain('Ready. Today 0 of 8 blocks')
  const started = (await run($, 'pomo', '25 learn excel basics')).text ?? ''
  expect(started).toContain('Focus on learn excel basics for 25 min.')
  expect(started).toContain('No dashboard is drawn in this session yet')
  expect((await run($, 'pomo', '')).text).toContain('Focus on learn excel basics, 25 min left.')

  await run($, 'pomo', 'stop')
  expect((await run($, 'pomo', '40 min deck')).text).toContain('Focus on deck for 40 min.')
  await run($, 'pomo', 'stop')
  expect((await run($, 'pomo', '500 nope')).text).toContain('5 to 180 minutes')
})
