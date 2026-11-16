// Obsidian daily notes, as text: where today's note lives and how to add to
// one number in its frontmatter without touching anything else in the file.

export type DailyNotes = { folder: string; format: string }

export type Day = { y: number; m: number; d: number }

/** A calendar day as `YYYY-MM-DD`, the store's key for it. */
export function dayKey(day: Day): string {
  const p = (n: number) => n.toString().padStart(2, '0')

  return `${day.y}-${p(day.m)}-${p(day.d)}`
}

export function parseDayKey(key: string): Day {
  const [y, m, d] = key.split('-').map(Number)

  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 }
}

/**
 * The calendar day a moment falls on: in `timeZone` when one is given and
 * the runtime knows it, else in the machine's own zone.
 */
export function dayOf(ms: number, timeZone: string): Day {
  if (timeZone !== '') {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(ms))
      const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
      const day = { y: get('year'), m: get('month'), d: get('day') }

      if (Number.isFinite(day.y) && Number.isFinite(day.m) && Number.isFinite(day.d)) {
        return day
      }
    } catch {
      // An unknown zone falls through to the machine's own.
    }
  }

  const date = new Date(ms)

  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }
}

/**
 * Formats a day with the Moment.js tokens Obsidian's Daily Notes setting
 * uses. Only the numeric date tokens are supported (YYYY, YY, MM, M, DD, D,
 * and [literal] text); any other token, such as a weekday name, answers
 * undefined so a note is never written under a guessed name.
 */
export function formatDay(format: string, day: Day): string | undefined {
  const p = (n: number) => n.toString().padStart(2, '0')
  const tokens = format.match(/\[[^\]]*\]|YYYY|YY|MM|M|DD|D|[A-Za-z]+|[^A-Za-z[]+/g) ?? []
  let out = ''

  for (const token of tokens) {
    if (token.startsWith('[')) {
      out += token.slice(1, -1)
    } else if (token === 'YYYY') {
      out += day.y.toString()
    } else if (token === 'YY') {
      out += p(day.y % 100)
    } else if (token === 'MM') {
      out += p(day.m)
    } else if (token === 'M') {
      out += day.m.toString()
    } else if (token === 'DD') {
      out += p(day.d)
    } else if (token === 'D') {
      out += day.d.toString()
    } else if (/[A-Za-z]/.test(token)) {
      return undefined
    } else {
      out += token
    }
  }

  return out
}

/** Reads `.obsidian/daily-notes.json`'s text; Obsidian's defaults when absent. */
export function parseDailyNotes(json: string | undefined): DailyNotes {
  try {
    const raw: unknown = json === undefined ? {} : JSON.parse(json)
    const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const folder = typeof o.folder === 'string' ? o.folder.replace(/^\/+|\/+$/g, '') : ''
    const format = typeof o.format === 'string' && o.format.trim() !== '' ? o.format : 'YYYY-MM-DD'

    return { folder, format }
  } catch {
    return { folder: '', format: 'YYYY-MM-DD' }
  }
}

/** The note's path inside the vault, or undefined for a format we can't follow. */
export function notePath(settings: DailyNotes, day: Day): string | undefined {
  const name = formatDay(settings.format, day)

  if (name === undefined || name === '') {
    return undefined
  }

  return settings.folder === '' ? `${name}.md` : `${settings.folder}/${name}.md`
}

/**
 * Adds `amount` to the number under `property` in the note's frontmatter
 * and returns the whole new text; every other byte stays as it was. An empty
 * value counts as 0, and a missing property is added at the end of the
 * frontmatter. Answers undefined, so nothing is written, when the note has
 * no frontmatter or the property holds something that isn't a number.
 */
export function addToProperty(text: string, property: string, amount: number): string | undefined {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)

  if (lines[0]?.trim() !== '---') {
    return undefined
  }

  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---')

  if (close === -1) {
    return undefined
  }

  const key = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`)

  for (let i = 1; i < close; i += 1) {
    const found = pattern.exec(lines[i] ?? '')

    if (found === null) {
      continue
    }

    const value = found[1] ?? ''
    const isEmpty = value === '' || value === 'null' || value === '~'

    if (!isEmpty && !/^-?\d+(\.\d+)?$/.test(value)) {
      return undefined
    }

    const next = (isEmpty ? 0 : Number(value)) + amount
    lines[i] = `${property}: ${round(next)}`

    return lines.join(eol)
  }

  lines.splice(close, 0, `${property}: ${round(amount)}`)

  return lines.join(eol)
}

function round(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1)
}

/**
 * Adds `- line` at the end of the `## heading` section, making the section at
 * the end of the note when it isn't there. Only that spot changes.
 */
export function addUnderHeading(text: string, heading: string, line: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const bullet = `- ${line.replace(/\r?\n/g, ' ').trim()}`
  const at = lines.findIndex(l => l.trim().toLowerCase() === `## ${heading}`.toLowerCase())

  if (at === -1) {
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
      lines.pop()
    }

    return [...lines, '', `## ${heading}`, '', bullet, ''].join(eol)
  }

  // The section runs to the next heading of the same or a higher level.
  let end = lines.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l))
  end = end === -1 ? lines.length : end
  let insert = end

  while (insert > at + 1 && lines[insert - 1]?.trim() === '') {
    insert -= 1
  }

  lines.splice(insert, 0, bullet)

  return lines.join(eol)
}

/**
 * The vault folders in Obsidian's own list (its `obsidian.json`), the one
 * open now first, then the most recently opened. Empty for anything else.
 */
export function obsidianVaults(json: string | undefined): string[] {
  try {
    const raw: unknown = json === undefined ? {} : JSON.parse(json)
    const vaults = raw !== null && typeof raw === 'object' ? (raw as { vaults?: unknown }).vaults : undefined
    const rows = vaults !== null && typeof vaults === 'object' ? Object.values(vaults as Record<string, unknown>) : []

    return rows
      .filter((v): v is { path: string; ts?: number; open?: boolean } => v !== null && typeof v === 'object' && typeof (v as { path?: unknown }).path === 'string')
      .sort((a, b) => Number(b.open === true) - Number(a.open === true) || (b.ts ?? 0) - (a.ts ?? 0))
      .map(v => v.path)
  } catch {
    return []
  }
}
