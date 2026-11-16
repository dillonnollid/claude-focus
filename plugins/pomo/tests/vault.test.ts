import { expect, mock, test } from 'claude-code/testing'

import { addToProperty, addUnderHeading, notePath, parseDailyNotes } from '../hooks/vault'

const NOTE = [
  '---',
  'type: daily-note',
  'deep_work_mins:',
  'fog:',
  '---',
  '# 2026-11-16',
  '',
  'deep_work_mins: this line is body text and stays as it is',
].join('\n')

test('adds to the property and touches nothing else', () => {
  const once = addToProperty(NOTE, 'deep_work_mins', 25)
  expect(once).toBe(NOTE.replace('deep_work_mins:\n', 'deep_work_mins: 25\n'))
  expect(addToProperty(once ?? '', 'deep_work_mins', 25)).toContain('deep_work_mins: 50\nfog:')
  expect(addToProperty(NOTE, 'pomodoros', 1)).toContain('fog:\npomodoros: 1\n---')
  expect(addToProperty(NOTE.replace('\n', '\r\n'), 'x', 1)).toBeUndefined()
  expect(addToProperty(NOTE.replaceAll('\n', '\r\n'), 'deep_work_mins', 5)).toContain('deep_work_mins: 5\r\nfog:')
  expect(addToProperty('# no frontmatter', 'deep_work_mins', 25)).toBeUndefined()
  expect(addToProperty('---\ndeep_work_mins: lots\n---\n', 'deep_work_mins', 25)).toBeUndefined()
})

test('finds the daily note the way Obsidian names it', () => {
  const day = { y: 2026, m: 11, d: 6 }
  const mine = parseDailyNotes('{"folder": "00 Inbox/Daily", "format": "YYYY-MM-DD"}')
  expect(notePath(mine, day)).toBe('00 Inbox/Daily/2026-11-06.md')
  expect(notePath(parseDailyNotes(undefined), day)).toBe('2026-11-06.md')
  expect(notePath(parseDailyNotes('{"folder": "/Journal/", "format": "[Day] D-M-YY"}'), day)).toBe('Journal/Day 6-11-26.md')
  expect(notePath(parseDailyNotes('{"format": "dddd YYYY"}'), day)).toBeUndefined()
})

test(
  'a finished block lands in the daily note, and waits when the note is missing',
  { options: { focusMinutes: 1, shortBreakMinutes: 1, timeZone: 'UTC' } },
  async ($, on) => {
    const files = new Map<string, string>([
      ['/vault/.obsidian', ''],
      ['/vault/.obsidian/daily-notes.json', '{"folder": "00 Inbox/Daily", "format": "YYYY-MM-DD"}'],
      ['/vault/00 Inbox/Daily/2026-11-16.md', NOTE],
    ])
    const clock = mock.clock(on, { now: Date.UTC(2026, 10, 16, 23, 50, 0) })
    mock.store(on)
    mock.env(on, { HOME: '/home/me' })
    on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
    on('fs.read', (_, e) => {
      const text = files.get(e.path)

      if (text === undefined) {
        throw new Error(`ENOENT ${e.path}`)
      }

      return { value: text }
    })
    on('fs.write', (_, e) => {
      files.set(e.path, e.text)

      return { value: undefined }
    })
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
    on('audio.play', () => ({ value: undefined }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))

    const run = (args: string) =>
      $.command.run({ command: 'pomo', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

    await $.session.start({ cwd: '/vault/10 Projects', surface: 'desktop', isInteractive: true })
    await run('start')
    await $.command.run({ command: 'park', args: 'book the dentist', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    await clock.advance(61_000)
    const today = files.get('/vault/00 Inbox/Daily/2026-11-16.md') ?? ''
    expect(today).toContain('deep_work_mins: 1\nfog:')
    expect(today).toContain('this line is body text and stays as it is')
    expect(today.endsWith('## Parked\n\n- book the dentist\n')).toBe(true)

    // Tomorrow's note doesn't exist yet: the minute waits for it.
    await clock.set(Date.UTC(2026, 10, 17, 0, 5, 0))
    await run('start')
    await clock.advance(61_000)
    expect(files.has('/vault/00 Inbox/Daily/2026-11-17.md')).toBe(false)
    expect((await run('stats')).text).toContain('1 day(s) wait for their daily note')

    files.set('/vault/00 Inbox/Daily/2026-11-17.md', NOTE.replace('2026-11-16', '2026-11-17'))
    await run('start')
    await clock.advance(61_000)
    expect(files.get('/vault/00 Inbox/Daily/2026-11-17.md')).toContain('deep_work_mins: 2\nfog:')
  },
)

test('parks under an existing heading, before the next section', () => {
  const note = '---\na: 1\n---\n# Day\n\n## Parked\n\n- first\n\n## Tasks\n\n- [ ] x\n'
  expect(addUnderHeading(note, 'Parked', 'second')).toBe('---\na: 1\n---\n# Day\n\n## Parked\n\n- first\n- second\n\n## Tasks\n\n- [ ] x\n')
  expect(addUnderHeading('# Day\n', 'Parked', 'only\nline')).toBe('# Day\n\n## Parked\n\n- only line\n')
})
