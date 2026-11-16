import { expect, mock, test } from 'claude-code/testing'

import { ashSvg } from '../hooks/scene'

const BACKDROP = {
  plugin: 'ember-theme',
  component: 'Backdrop',
  surface: 'desktop',
  props: { scene: 'ash', plugin: 'ember-theme', glass: { blur: 12, tint: '#161513', opacity: 0.85 }, overrideColorScheme: 'dark' },
} as const

test('the field is plain ash at rest, embers in focus, moss on a break, and still when paused', () => {
  expect(ashSvg('idle')).not.toContain('#ff7a1f')
  expect(ashSvg('focus')).toContain('#ff7a1f')
  expect(ashSvg('break')).toContain('#b3c95a')
  expect(ashSvg('break')).not.toContain('#ff7a1f')
  expect(ashSvg('paused')).not.toContain('class="b"')
  expect(ashSvg('focus').length).toBeLessThan(131_072)
})

test('the backdrop draws the field, and leaves any other scene alone', async ($, on) => {
  mock.store(on)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  const field = await $.ui.mount(BACKDROP)
  expect(String((await field.find({ type: 'Svg' }))?.props.source)).toBe(ashSvg('idle'))
  await field.unmount()

  const other = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, plugin: 'someone-else' } })
  expect(await other.find({ type: 'Svg' })).toBeUndefined()
  await other.unmount()
})
