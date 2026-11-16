import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// Ember: dark only, and no blue anywhere. It follows DESIGN.md at the
// repository root: quiet warm-neutral surfaces you can look at for hours, and
// one accent, the orange of an ember, kept for what matters. The other roles
// keep their meaning and lean warm. Code highlighting is built from them.
// pomo's drawings hold the same values.
const { theme, problems } = makeColors({
  label: 'Ember',
  only: 'dark',
  roles: {
    accent: '#ff7a1f', // ember: links, focus rings, the selection, code keywords
    danger: '#ef5b5e',
    success: '#b3c95a', // moss: strings, "added", and a break in pomo
    warning: '#f5b43c', // amber
    pro: '#ee8aa8', // rose, in place of the usual purple
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#161513', // the page
        'surface-1': '#1c1a18', // cards
        'surface-2': '#232120', // panels and fields
        'surface-3': '#252320', // menus, kept close so muted text stays readable
        'text-primary': '#efe9de',
        'text-secondary': '#aaa398',
        'text-muted': '#9a9387',
      },
    },
    git: {
      added: '#b3c95a',
      removed: '#ef5b5e',
      modified: '#f5b43c',
      merged: '#ee8aa8',
      closed: '#e0685c',
      conflicting: '#ff7a1f',
      draft: '#9a9387',
    },
  },
})

const LOOK: ThemeSetArgs = { colors: theme, overrideColorScheme: 'dark' }

export const register: Register = on => {
  let lastResult = 'not set yet'

  on('session.start', async ($, e, next) => {
    const blocking = problems.find(line => line.startsWith("Desktop won't paint"))

    if (blocking !== undefined) {
      $.ui.toast(`ember-theme: ${blocking}`)
    }

    const set = await $.theme.set(LOOK)
    lastResult = set.isDrawn ? 'drawn' : `not drawn (${set.reason})`

    await $.command.register({
      name: 'ember',
      description: 'Ember theme: apply it again and say whether this app draws it, or "off" to clear it',
      argumentHint: '[off]',
    })

    return next(e)
  })

  // The desktop app connects after the session starts: set the look again
  // then, so it paints the moment there is something to paint.
  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const set = await $.theme.set(LOOK)
      lastResult = set.isDrawn ? 'drawn' : `not drawn (${set.reason})`
    }

    return next(e)
  })

  on('command.run', { command: 'ember' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'off') {
      await $.theme.clear()

      return { text: 'Ember theme cleared for this session. Run /ember to bring it back.' }
    }

    const before = lastResult
    const set = await $.theme.set(LOOK)
    lastResult = set.isDrawn ? 'drawn' : `not drawn (${set.reason})`

    return {
      text: [
        `Ember theme applied. The app answered ${lastResult}.`,
        `At session start it answered ${before}.`,
        set.isDrawn
          ? 'Drawn means an app that paints themes is attached. If it still looks unchanged, the app may not paint themes for this kind of session.'
          : 'The reason above comes straight from the app.',
      ].join('\n'),
    }
  }).catch(() => ({ text: 'The Ember theme hit an error while applying.' }))
}
