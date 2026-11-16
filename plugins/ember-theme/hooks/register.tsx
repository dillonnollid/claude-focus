import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { ashSvg } from './scene'
import type { Phase } from './scene'

// Ember: dark only, and no blue anywhere. It follows DESIGN.md at the
// repository root: warm, near-black surfaces you can look at for hours, one
// accent, the orange of an ember, and a faint field of ASCII ash at the
// window's edges that follows the pomo timer. The other roles
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
        'surface-0': '#1a1310', // the page: warm, near black
        'surface-1': '#211814', // cards
        'surface-2': '#291e19', // panels and fields
        'surface-3': '#2a1f19', // menus, kept close so muted text stays readable
        'text-primary': '#f4e8d6',
        'text-secondary': '#cdb9a2',
        'text-muted': '#ab9784',
      },
    },
    git: {
      added: '#b3c95a',
      removed: '#ef5b5e',
      modified: '#f5b43c',
      merged: '#ee8aa8',
      closed: '#e0685c',
      conflicting: '#ff7a1f',
      draft: '#ab9784',
    },
  },
})

const SCENE = 'ash'
const FLAT: ThemeSetArgs = { colors: theme, overrideColorScheme: 'dark' }
// The app frosts its panels over the field, tinted to the page, so text keeps its contrast.
const ASH: ThemeSetArgs = { ...FLAT, backdrop: { scene: SCENE, glass: { blur: 12, tint: '#1a1310', opacity: 0.85 } } }

/** What pomo's timer is doing, read from the value pomo writes; undefined for anything else. */
function phaseOf(written: unknown): Phase | undefined {
  const view = (written as { value?: { timer?: { phase?: unknown } } } | null)?.value
  const phase = view?.timer?.phase

  return phase === 'idle' || phase === 'focus' || phase === 'break' || phase === 'paused' ? phase : undefined
}

export const register: Register = (on, options) => {
  const LOOK = options.backdrop === false ? FLAT : ASH
  let lastResult = 'not set yet'
  // The timer's phase, as last seen. Idle until pomo says otherwise, or for good without it.
  let phase: Phase = 'idle'
  const scenes = new Map<Phase, string>()

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

  // pomo publishes its timer as a state value; watching the writes keeps the
  // field in step with it, and needs nothing from pomo when it isn't installed.
  on('state.set', { plugin: 'pomo', key: 'view' }, async ($, e, next) => {
    const result = await next(e)
    const seen = phaseOf(e.value)

    if (seen !== undefined && seen !== phase) {
      phase = seen

      try {
        $.ui.invalidate('ui.render')
      } catch {
        // The field catches up at its next redraw; pomo's write has landed either way.
      }
    }

    return result
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== 'ember-theme' || e.props.scene !== SCENE) {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)
    const source = scenes.get(phase) ?? ashSvg(phase)
    scenes.set(phase, source)

    return <Svg source={source} alt="A faint scatter of ASCII ash along the edges of the window" isInteractive />
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
