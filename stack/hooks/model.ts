import type { StackAgent, StackLimit, StackTask } from '../types'

// Claude's orange: the dither and the dots in its light clay, the pill in its deeper crail.
export const ORANGE = '#D97757'
export const PILL_BG = '#B5532F'
export const PILL_FG = '#FFF4EC'
// A limit close to running out shows its percentage in amber, then red.
export const TONES = { accent: ORANGE, warn: '#E0A84E', danger: '#E5534B' } as const
export const MARK = '✻'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 24 * 60 * 60 * 1000

export type Tone = keyof typeof TONES

export type RowSpec = {
  id: string
  label: string
  // null: no known total (a subagent), drawn as a dither run that moves with each tool call.
  percent: number | null
  pill: string
  // The right-hand column: a percentage, or a subagent's call count.
  right: string
  // What the collapsed one-line summary says for this row; '' for none.
  summary: string
  steps: number
  tone: Tone
  phase: number
}

export type StackData = {
  tasks: StackTask[]
  agents: Record<string, StackAgent>
  limits: StackLimit[]
  tracked: Record<string, number>
  backfill: Record<string, number>
}

export const monthKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const previousMonthKey = (ms: number): string => {
  const d = new Date(ms)
  return monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime())
}

const monthIndex = (key: string): number => Number(key.slice(5, 7)) - 1

// The mod's own ledger starts the month it was installed; ccusage knows what came before.
// Both count the same local Claude Code spend, so the larger figure is the more complete one.
export const monthTotal = (data: Pick<StackData, 'tracked' | 'backfill'>, key: string): number =>
  Math.max(data.tracked[key] ?? 0, data.backfill[key] ?? 0)

export const usd = (value: number): string => {
  const [whole = '0', cents = '00'] = value.toFixed(2).split('.')
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
}

export const formatReset = (iso: string | undefined, now: number): string => {
  const at = iso === undefined ? NaN : Date.parse(iso)
  if (Number.isNaN(at)) return 'no reset time'
  const d = new Date(at)
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const clock = `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${hours < 12 ? 'AM' : 'PM'}`
  return at - now < DAY_MS ? clock : `${DAYS[d.getDay()]} ${clock}`
}

const LIMIT_ROWS: Record<string, { id: string; label: string; short: string }> = {
  five_hour: { id: 'session', label: 'Session limit', short: '5h' },
  seven_day: { id: 'weekly', label: 'Weekly limit', short: 'week' },
  spend_limit: { id: 'spend', label: 'Spend limit', short: 'spend' },
}

const limitRow = (kind: string) => LIMIT_ROWS[kind] ?? { id: kind, label: kind, short: kind }

const limitTone = (percent: number): Tone => (percent >= 90 ? 'danger' : percent >= 75 ? 'warn' : 'accent')

const shortTool = (tool: string): string => tool.replace(/^mcp__.+?__/, '')

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

const oneLine = (text: string, length: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat
}

// What a subagent's tool call is about, in a few words: the file it reads, the pattern it
// searches, the command it runs.
export const toolDetail = (tool: string, args: Record<string, unknown>): string => {
  const pick = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  const path = pick('file_path') ?? pick('notebook_path') ?? pick('path')
  const subject = (path && baseName(path)) ?? pick('pattern') ?? pick('command') ?? pick('url') ?? pick('query') ?? pick('description')
  return oneLine(subject ? `${shortTool(tool)} ${subject}` : shortTool(tool), 48)
}

const percentRight = (percent: number): string => `${Math.round(percent)}%`

export const buildRows = (data: StackData, now: number): RowSpec[] => {
  const rows: RowSpec[] = []
  const base = { steps: 0, tone: 'accent' as Tone, phase: 0 }

  if (data.tasks.length > 0) {
    const done = data.tasks.filter(task => task.status === 'completed').length
    const percent = (done / data.tasks.length) * 100
    const pill = `Tasks ${done}/${data.tasks.length}`
    rows.push({ ...base, id: 'tasks', label: 'Tasks', percent, pill, right: percentRight(percent), summary: pill, steps: data.tasks.length })
  }

  for (const [id, agent] of Object.entries(data.agents)) {
    rows.push({
      ...base,
      id: `agent:${id}`,
      label: agent.label,
      percent: null,
      pill: agent.detail ?? shortTool(agent.tool),
      right: `${agent.calls} ${agent.calls === 1 ? 'call' : 'calls'}`,
      summary: '',
      phase: agent.calls,
    })
  }

  for (const limit of data.limits) {
    const meta = limitRow(limit.kind)
    rows.push({
      ...base,
      id: meta.id,
      label: meta.label,
      percent: limit.percentUsed,
      pill: formatReset(limit.resetsAt, now),
      right: percentRight(limit.percentUsed),
      summary: `${meta.short} ${percentRight(limit.percentUsed)}`,
      tone: limitTone(limit.percentUsed),
    })
  }

  const thisKey = monthKey(now)
  const lastKey = previousMonthKey(now)
  const thisMonth = monthTotal(data, thisKey)
  const lastMonth = monthTotal(data, lastKey)
  if (thisMonth > 0 || lastMonth > 0) {
    const percent = lastMonth > 0 ? (thisMonth / lastMonth) * 100 : 100
    rows.push({
      ...base,
      id: 'costs',
      label: `${MONTHS_LONG[monthIndex(thisKey)]} so far`,
      percent,
      pill: lastMonth > 0 ? `${usd(thisMonth)} / ${MONTHS[monthIndex(lastKey)]} ${usd(lastMonth)}` : usd(thisMonth),
      right: percentRight(percent),
      summary: `${MONTHS[monthIndex(thisKey)]} ${usd(thisMonth)}`,
      tone: percent > 100 ? 'warn' : 'accent',
    })
  }

  return rows
}

export const summaryParts = (rows: RowSpec[]): string[] => {
  const agents = rows.filter(row => row.id.startsWith('agent:')).length
  const parts = rows.filter(row => row.summary !== '').map(row => row.summary)
  if (agents > 0) parts.splice(rows[0]?.id === 'tasks' ? 1 : 0, 0, `${agents} ${agents === 1 ? 'agent' : 'agents'}`)
  return parts
}

export const ROW_NAMES: Record<string, string[]> = {
  tasks: ['tasks'],
  task: ['tasks'],
  subagents: ['subagents'],
  agents: ['subagents'],
  session: ['session'],
  '5h': ['session'],
  weekly: ['weekly'],
  week: ['weekly'],
  spend: ['spend'],
  limits: ['session', 'weekly', 'spend'],
  costs: ['costs'],
  cost: ['costs'],
}

export const isHidden = (id: string, hidden: readonly string[]): boolean =>
  hidden.includes(id) || (id.startsWith('agent:') && hidden.includes('subagents'))

export const fit = (text: string, cells: number): string =>
  text.length > cells ? `${text.slice(0, Math.max(0, cells - 1))}…` : text.padEnd(cells)

// The row grid ----------------------------------------------------------------

// ● label  ⣿⣷⡿ pill ····│····  40% ×, in character cells. Both surfaces draw this grid:
// the terminal as text, the desktop as an image in a monospaced font.
export type RowGrid = { labelCells: number; trackCells: number; rightCells: number }

export const rowGrid = (rows: RowSpec[], cells: number): RowGrid => {
  const labelCells = Math.min(22, Math.max(0, ...rows.map(row => row.label.length)))
  const rightCells = Math.max(4, ...rows.map(row => row.right.length))
  // 2 for the dot, 2 after the label, 1 before and 1 after the right column.
  return { labelCells, rightCells, trackCells: Math.max(10, cells - 2 - labelCells - 2 - 1 - rightCells - 1) }
}

export type SegmentKind = 'fill' | 'pill' | 'empty' | 'tickFill' | 'tickEmpty'
export type Segment = { kind: SegmentKind; text: string; start: number }

// Mostly full cells, with a dot missing here and there: the texture of the reference.
const BRAILLE = ['⣿', '⣿', '⣿', '⣷', '⡿', '⣿', '⡷', '⣾']

const hash = (text: string): number =>
  [...text].reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619), 2166136261)

// The top bits of a multiplicative hash: the low ones of cell × odd repeat every few cells.
const dither = (cell: number, seed: number): string =>
  BRAILLE[(Math.imul(cell + 1, 2654435761) ^ seed) >>> 29] ?? '⣿'

// The braille dither up to the progress point, the pill ending at it (or just after it, while
// the fill is too short to show around the pill), a tick at each step boundary and a dim dot
// for every empty cell. With no known total, a short dither run moves along with the pill.
export const terminalTrack = (row: RowSpec, cells: number): Segment[] => {
  const text = row.pill.length > cells - 4 ? `${row.pill.slice(0, Math.max(1, cells - 5))}…` : row.pill
  const pill = ` ${text} `
  let fillStart = 0
  let fillEnd = 0
  if (row.percent === null) {
    const run = Math.max(3, Math.round(cells / 10))
    const room = Math.max(1, cells - run - pill.length + 1)
    fillStart = (row.phase * 3) % room
    fillEnd = fillStart + run
  } else if (row.percent > 0) {
    fillEnd = Math.max(1, Math.round((cells * Math.min(100, row.percent)) / 100))
  }
  const isPillInside = fillEnd - fillStart >= pill.length + 2
  const pillStart = Math.min(isPillInside ? fillEnd - pill.length : fillEnd, cells - pill.length)
  const ticks = new Set<number>()
  for (let i = 1; i < row.steps; i++) ticks.add(Math.round((cells * i) / row.steps))
  const seed = hash(row.id)

  const segments: Segment[] = []
  const push = (kind: SegmentKind, char: string, cell: number) => {
    const last = segments[segments.length - 1]
    if (last?.kind === kind) last.text += char
    else segments.push({ kind, text: char, start: cell })
  }
  for (let cell = 0; cell < cells; cell++) {
    const isFill = cell >= fillStart && cell < fillEnd
    if (cell >= pillStart && cell < pillStart + pill.length) push('pill', pill[cell - pillStart] ?? ' ', cell)
    else if (ticks.has(cell)) push(isFill ? 'tickFill' : 'tickEmpty', '│', cell)
    else if (isFill) push('fill', dither(cell, seed), cell)
    else push('empty', '·', cell)
  }
  return segments
}

// Desktop row -----------------------------------------------------------------

export const CELL_PX = 8.4
export const ROW_PX = 26
const FONT_PX = 14

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One braille character as its dots: the low byte of its code point is one bit per dot,
// dots 1-3 and 7 down the left column, 4-6 and 8 down the right.
const BRAILLE_DOTS: Array<[number, number]> = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]]

const brailleSymbol = (char: string): string => {
  const bits = (char.codePointAt(0) ?? 0x2800) - 0x2800
  const dots = BRAILLE_DOTS.filter((_, bit) => bits & (1 << bit)).map(
    ([column, row]) => `<rect x="${(1.6 + column * 3.4).toFixed(1)}" y="${(-7 + row * 4).toFixed(1)}" width="2" height="2" rx="0.5"/>`,
  )
  return `<g id="b${char.codePointAt(0)}" class="fill">${dots.join('')}</g>`
}

// The terminal's grid as an image: each run of characters is pinned to its cells with
// textLength, so the braille, the dots and the pill line up as they do in a terminal.
export const desktopRowSvg = (row: RowSpec, grid: RowGrid): string => {
  const cells = 2 + grid.labelCells + 2 + grid.trackCells + 1 + grid.rightCells
  const width = Math.ceil(cells * CELL_PX)
  const mid = ROW_PX / 2
  const trackX = (2 + grid.labelCells + 2) * CELL_PX
  const run = (x: number, text: string, cls: string) =>
    `<text class="${cls}" x="${x.toFixed(1)}" y="${mid}" textLength="${(text.length * CELL_PX).toFixed(1)}" lengthAdjust="spacingAndGlyphs" dominant-baseline="central" xml:space="preserve">${escapeXml(text)}</text>`

  const track = terminalTrack(row, grid.trackCells).map(segment => {
    const x = trackX + segment.start * CELL_PX
    if (segment.kind === 'fill') {
      return [...segment.text].map((char, i) => `<use href="#b${char.codePointAt(0)}" x="${(x + i * CELL_PX).toFixed(1)}" y="${mid}"/>`).join('')
    }
    if (segment.kind !== 'pill') return run(x, segment.text, segment.kind)
    const w = segment.text.length * CELL_PX
    return `<rect x="${x.toFixed(1)}" y="${mid - 9}" width="${w.toFixed(1)}" height="18" rx="2" fill="${PILL_BG}"/>${run(x, segment.text, 'pill')}`
  })
  const label = row.label.length > grid.labelCells ? `${row.label.slice(0, grid.labelCells - 1)}…` : row.label
  const right = row.right.padStart(grid.rightCells)
  const rightClass = row.tone === 'accent' ? 'right' : `right ${row.tone}`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_PX}" viewBox="0 0 ${width} ${ROW_PX}"`,
    ` font-family="'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, ui-monospace, monospace" font-size="${FONT_PX}">`,
    '<style>',
    `.label{fill:#ECE9E2}.right{fill:#C9C5BD}.fill,.tickFill{fill:${ORANGE}}.pill{fill:${PILL_FG};font-weight:600}`,
    `.empty{fill:#6E6A64}.tickEmpty{fill:#8A6A58}.right.warn{fill:${TONES.warn}}.right.danger{fill:${TONES.danger}}`,
    '@media (prefers-color-scheme: light){.label{fill:#2A2925}.right{fill:#4A4740}.empty{fill:#B3AEA5}.tickEmpty{fill:#B98A70}',
    '.right.warn{fill:#B7791F}.right.danger{fill:#C93C37}}',
    '</style>',
    `<defs>${[...new Set(BRAILLE)].map(brailleSymbol).join('')}</defs>`,
    `<circle cx="${(CELL_PX * 0.6).toFixed(1)}" cy="${mid}" r="3.5" fill="${ORANGE}"/>`,
    run(2 * CELL_PX, label, 'label'),
    ...track,
    run((cells - grid.rightCells) * CELL_PX, right, rightClass),
    '</svg>',
  ].join('')
}

// ccusage -------------------------------------------------------------------

// `ccusage claude monthly --json` answers { monthly: [{ period | month: "YYYY-MM", totalCost }] }.
export const parseCcusage = (stdout: string): Record<string, number> => {
  const parsed: unknown = JSON.parse(stdout.slice(stdout.indexOf('{')))
  const monthly = (parsed as { monthly?: unknown }).monthly
  if (!Array.isArray(monthly)) throw new Error('ccusage JSON has no "monthly" array')
  const months: Record<string, number> = {}
  for (const entry of monthly as Array<Record<string, unknown>>) {
    const key = entry.period ?? entry.month
    if (typeof key === 'string' && /^\d{4}-\d{2}$/.test(key) && typeof entry.totalCost === 'number') {
      months[key] = entry.totalCost
    }
  }
  return months
}
