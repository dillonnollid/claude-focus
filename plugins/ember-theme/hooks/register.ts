import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// Ember: dark only. Near-black warm charcoal surfaces, cream text instead of
// white, and every role pulled to the warm side of the wheel so nothing on
// screen is blue. Code highlighting is built from these roles too.
const { theme, problems } = makeColors({
  label: 'Ember',
  only: 'dark',
  roles: {
    accent: '#ff7a1a', // ember orange: links, focus rings, code keywords
    danger: '#e5484d', // still a red
    success: '#9acb55', // a warm green, for strings and "added"
    warning: '#f5b43c', // amber
    pro: '#e8789a', // dusty rose, in place of the usual purple
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#141210',
        'surface-1': '#1b1815',
        'surface-2': '#221e1a',
        'surface-3': '#25211d',
        'text-primary': '#f3e6cf', // cream
        'text-secondary': '#dccbae', // beige
        'text-muted': '#ad9c84',
      },
    },
    git: {
      added: '#9acb55',
      removed: '#e5484d',
      modified: '#f5b43c',
      merged: '#e8789a',
      closed: '#e0685c',
      conflicting: '#ff7a1a',
      draft: '#b8a68c',
    },
  },
})

const FLAT: ThemeSetArgs = { colors: theme, overrideColorScheme: 'dark' }

const GLOW: ThemeSetArgs = {
  ...FLAT,
  backdrop: {
    gradient: {
      stops: [
        { at: 0, color: '#141210' },
        { at: 0.62, color: '#141210' },
        { at: 1, color: '#2a160a' },
      ],
    },
  },
}

export const register: Register = (on, options) => {
  const look = options.glow === false ? FLAT : GLOW
  let lastResult = 'not set yet'

  on('session.start', async ($, e, next) => {
    const blocking = problems.find(line => line.startsWith("Desktop won't paint"))

    if (blocking !== undefined) {
      $.ui.toast(`ember-theme: ${blocking}`)
    }

    const set = await $.theme.set(look)
    lastResult = set.isDrawn ? 'drawn' : `not drawn (${set.reason})`

    if (!set.isDrawn) {
      $.ui.status(`Ember theme not drawn: ${set.reason}`)
    }

    await $.command.register({
      name: 'ember',
      description: 'Ember theme: apply it again and say whether this app draws it, or "off" to clear it',
      argumentHint: '[off]',
    })

    return next(e)
  })

  on('command.run', { command: 'ember' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'off') {
      await $.theme.clear()

      return { text: 'Ember theme cleared for this session. Run /ember to bring it back.' }
    }

    const before = lastResult
    const set = await $.theme.set(look)
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
