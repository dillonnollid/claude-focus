import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { hearthSvg } from './scene'

// Ember: dark only, and no blue anywhere. It follows the Hearth design system
// (DESIGN.md at the repository root): every surface is the red-black of the
// dark around a fire rather than a neutral charcoal, text is the colour of bone, and the accents
// are the heat of a fire, from gold through ember to garnet. Code highlighting
// is built from the same roles. pomo's drawings hold the same values.
const SOOT = '#150b0d'

const { theme, problems } = makeColors({
  label: 'Ember',
  only: 'dark',
  roles: {
    accent: '#ff6a1a', // ember: links, focus rings, code keywords
    danger: '#ff4d5e', // still a red, a step cooler than ember so the two never blur
    success: '#b6d65a', // moss: strings, "added", and a break in pomo
    warning: '#ffc640', // gold
    pro: '#ff7aa8', // rose, in place of the usual purple
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': SOOT, // soot: the page
        'surface-1': '#1e1013', // char: cards
        'surface-2': '#271519', // bark: panels
        'surface-3': '#28161a', // menus, kept close to bark so muted text stays readable
        'text-primary': '#fbeee4', // bone
        'text-secondary': '#e8cdbf',
        'text-muted': '#bd9c93', // ash
      },
    },
    git: {
      added: '#b6d65a',
      removed: '#ff4d5e',
      modified: '#ffc640',
      merged: '#ff7aa8',
      closed: '#f06a5c',
      conflicting: '#ff6a1a',
      draft: '#bd9c93',
    },
  },
})

const SCENE = 'hearth'
const FLAT: ThemeSetArgs = { colors: theme, overrideColorScheme: 'dark' }
// The app frosts its panels over the hearth, tinted soot so text keeps its contrast.
const HEARTH: ThemeSetArgs = { ...FLAT, backdrop: { scene: SCENE, glass: { blur: 26, tint: SOOT, opacity: 0.7 } } }

export const register: Register = (on, options) => {
  const look = options.glow === false ? FLAT : HEARTH
  const scene = hearthSvg(options.sparks !== false)
  let lastResult = 'not set yet'

  on('session.start', async ($, e, next) => {
    const blocking = problems.find(line => line.startsWith("Desktop won't paint"))

    if (blocking !== undefined) {
      $.ui.toast(`ember-theme: ${blocking}`)
    }

    const set = await $.theme.set(look)
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
      const set = await $.theme.set(look)
      lastResult = set.isDrawn ? 'drawn' : `not drawn (${set.reason})`
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== 'ember-theme' || e.props.scene !== SCENE) {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={scene} alt="A bed of coals glowing at the foot of the window, with a few sparks drifting up" isInteractive />
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
