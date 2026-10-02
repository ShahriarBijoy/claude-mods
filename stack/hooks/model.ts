import type { StackAgent, StackLimit, StackTask } from '../types'

// Claude's clay, with warm warning colours for limits running out.
export const TONES = { accent: '#D97757', warn: '#E0A84E', danger: '#E5534B' } as const
export const MARK = '✻'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 24 * 60 * 60 * 1000

export type Tone = keyof typeof TONES

export type RowSpec = {
  id: string
  label: string
  // null: no known total (a subagent), drawn as a marker that moves with each tool call.
  percent: number | null
  value: string
  detail: string
  tone: Tone
  // A bar of `steps` segments with `done` filled, the next one half-lit while `isStepActive`.
  steps: number
  done: number
  isStepActive: boolean
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

const blank = { steps: 0, done: 0, isStepActive: false, phase: 0, tone: 'accent' as Tone }

export const buildRows = (data: StackData, now: number): RowSpec[] => {
  const rows: RowSpec[] = []

  if (data.tasks.length > 0) {
    const done = data.tasks.filter(task => task.status === 'completed').length
    const active = data.tasks.find(task => task.status === 'in_progress')
    const next = data.tasks.find(task => task.status === 'pending')
    rows.push({
      ...blank,
      id: 'tasks',
      label: 'Tasks',
      percent: (done / data.tasks.length) * 100,
      value: `${done}/${data.tasks.length}`,
      detail: active ? active.activeForm || active.subject : next ? `Next: ${next.subject}` : 'All done',
      steps: data.tasks.length,
      done,
      isStepActive: active !== undefined,
    })
  }

  for (const [id, agent] of Object.entries(data.agents)) {
    rows.push({
      ...blank,
      id: `agent:${id}`,
      label: agent.label,
      percent: null,
      value: `${agent.calls} ${agent.calls === 1 ? 'call' : 'calls'}`,
      detail: agent.detail ?? shortTool(agent.tool),
      phase: agent.calls,
    })
  }

  for (const limit of data.limits) {
    const meta = limitRow(limit.kind)
    rows.push({
      ...blank,
      id: meta.id,
      label: meta.label,
      percent: limit.percentUsed,
      value: `${Math.round(limit.percentUsed)}%`,
      detail: `resets ${formatReset(limit.resetsAt, now)}`,
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
      ...blank,
      id: 'costs',
      label: `${MONTHS_LONG[monthIndex(thisKey)]} so far`,
      percent,
      value: usd(thisMonth),
      detail: lastMonth > 0 ? `${Math.round(percent)}% of ${MONTHS[monthIndex(lastKey)]} · ${usd(lastMonth)}` : 'no spend last month',
      tone: percent > 100 ? 'warn' : 'accent',
    })
  }

  return rows
}

export const summaryParts = (rows: RowSpec[]): string[] => {
  const parts: string[] = []
  const agents = rows.filter(row => row.id.startsWith('agent:')).length
  if (agents > 0) parts.push(`${agents} ${agents === 1 ? 'agent' : 'agents'}`)
  for (const row of rows) {
    const limit = Object.values(LIMIT_ROWS).find(meta => meta.id === row.id)
    if (row.id === 'tasks') parts.unshift(`Tasks ${row.value}`)
    else if (limit) parts.push(`${limit.short} ${row.value}`)
    else if (row.id === 'costs') parts.push(`${row.label.split(' ')[0]?.slice(0, 3)} ${row.value}`)
  }
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

// Terminal bar --------------------------------------------------------------

export type SegmentKind = 'fill' | 'active' | 'track' | 'gap'
export type Segment = { kind: SegmentKind; text: string }

const FILLED = '━'
const EMPTY = '─'

const percentCells = (percent: number, cells: number): number =>
  percent > 0 ? Math.max(1, Math.round((cells * Math.min(100, percent)) / 100)) : 0

// A thin line: heavy where it is filled, light where it is not. Steps split it into segments
// with a gap between; no known total draws a short heavy marker that moves on each tool call.
export const terminalBar = (row: RowSpec, cells: number): Segment[] => {
  const kinds: SegmentKind[] = new Array(cells).fill('track')
  const gap = 1
  const segmentCells = row.steps > 1 ? (cells - gap * (row.steps - 1)) / row.steps : 0

  if (row.percent === null) {
    const block = Math.max(3, Math.round(cells / 6))
    const start = ((row.phase * 3) % (cells + block)) - block
    for (let cell = Math.max(0, start); cell < Math.min(cells, start + block); cell++) kinds[cell] = 'fill'
  } else if (segmentCells >= 2) {
    for (let step = 0; step < row.steps; step++) {
      const from = Math.round(step * (segmentCells + gap))
      const to = Math.round(step * (segmentCells + gap) + segmentCells)
      const kind: SegmentKind = step < row.done ? 'fill' : step === row.done && row.isStepActive ? 'active' : 'track'
      for (let cell = from; cell < to && cell < cells; cell++) kinds[cell] = kind
      if (step < row.steps - 1 && to < cells) kinds[to] = 'gap'
    }
  } else {
    for (let cell = 0; cell < percentCells(row.percent, cells); cell++) kinds[cell] = 'fill'
  }

  const segments: Segment[] = []
  for (const kind of kinds) {
    const char = kind === 'gap' ? ' ' : kind === 'track' ? EMPTY : FILLED
    const last = segments[segments.length - 1]
    if (last?.kind === kind) last.text += char
    else segments.push({ kind, text: char })
  }
  return segments
}

// Desktop row ---------------------------------------------------------------

export const ROW_PX = 30
const BAR_PX = 6

export type DesktopColumns = { widthPx: number; labelPx: number; barPx: number; valuePx: number; detailPx: number }

const LABEL_CH = 7.6
const VALUE_CH = 7.2
const DETAIL_CH = 6.8
const GUTTER = 16

export const desktopColumns = (rows: RowSpec[], widthPx: number): DesktopColumns => {
  const longest = (pick: (row: RowSpec) => string) => Math.max(0, ...rows.map(row => pick(row).length))
  const labelPx = Math.min(240, Math.max(96, Math.round(longest(row => row.label) * LABEL_CH) + GUTTER))
  const valuePx = Math.round(longest(row => row.value) * VALUE_CH) + 4
  let detailPx = Math.min(280, Math.round(longest(row => row.detail) * DETAIL_CH))
  let barPx = widthPx - labelPx - GUTTER - valuePx - GUTTER - detailPx
  if (barPx < 140) {
    detailPx = 0
    barPx = widthPx - labelPx - GUTTER - valuePx
  }
  return { widthPx, labelPx, barPx: Math.max(60, barPx), valuePx, detailPx }
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clip = (text: string, px: number, ch: number): string => {
  const fitsChars = Math.floor(px / ch)
  return text.length > fitsChars ? `${text.slice(0, Math.max(0, fitsChars - 1))}…` : text
}

const desktopBar = (row: RowSpec, x: number, width: number, y: number): string[] => {
  const color = TONES[row.tone]
  const pill = (px: number, w: number, fill: string, extra = '') =>
    `<rect x="${px.toFixed(1)}" y="${y}" width="${Math.max(0, w).toFixed(1)}" height="${BAR_PX}" rx="${BAR_PX / 2}" fill="${fill}"${extra}/>`

  const track = `<rect class="track" x="${x}" y="${y}" width="${width}" height="${BAR_PX}" rx="${BAR_PX / 2}"/>`

  // No known total: a soft marker sweeps the track. Where the surface does not animate the
  // image, it rests where the tool-call count puts it, so it still moves as the agent works.
  if (row.percent === null) {
    const block = Math.max(28, width * 0.18)
    const start = x + ((row.phase * 37) % Math.max(1, width - block))
    return [
      track,
      `<clipPath id="bar"><rect x="${x}" y="${y}" width="${width}" height="${BAR_PX}" rx="${BAR_PX / 2}"/></clipPath>`,
      `<g clip-path="url(#bar)"><rect x="${start.toFixed(1)}" y="${y}" width="${block.toFixed(1)}" height="${BAR_PX}" rx="${BAR_PX / 2}" fill="url(#sweep)">`,
      `<animate attributeName="x" values="${(x - block).toFixed(1)};${(x + width).toFixed(1)}" dur="1.8s" repeatCount="indefinite"/></rect></g>`,
    ]
  }

  if (row.steps > 1 && width / row.steps >= 8) {
    const gap = 3
    const segment = (width - gap * (row.steps - 1)) / row.steps
    return Array.from({ length: row.steps }, (_, step) => {
      const sx = x + step * (segment + gap)
      if (step < row.done) return pill(sx, segment, color)
      if (step === row.done && row.isStepActive) return pill(sx, segment, color, ' opacity="0.42"')
      return `<rect class="track" x="${sx.toFixed(1)}" y="${y}" width="${segment.toFixed(1)}" height="${BAR_PX}" rx="${BAR_PX / 2}"/>`
    })
  }

  const filled = row.percent > 0 ? Math.max(BAR_PX, (width * Math.min(100, row.percent)) / 100) : 0
  return [track, filled > 0 ? pill(x, filled, color) : '']
}

// One row as one image, in four columns: label, a thin bar, the value in tabular figures,
// and a muted detail. Every row of the band shares the columns, so the bars line up.
export const desktopRowSvg = (row: RowSpec, columns: DesktopColumns): string => {
  const h = ROW_PX
  const mid = h / 2
  const barX = columns.labelPx
  const valueEnd = barX + columns.barPx + GUTTER + columns.valuePx
  const detailX = valueEnd + GUTTER
  const valueClass = row.tone === 'accent' ? 'value' : `value ${row.tone}`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${columns.widthPx}" height="${h}" viewBox="0 0 ${columns.widthPx} ${h}"`,
    ` font-family="ui-sans-serif, 'Segoe UI', system-ui, -apple-system, sans-serif">`,
    '<style>',
    '.label{fill:#F0EDE6}.value{fill:#D6D2CA;font-variant-numeric:tabular-nums}',
    `.detail{fill:#9A968E}.track{fill:#3A3835}.value.warn{fill:${TONES.warn}}.value.danger{fill:${TONES.danger}}`,
    '@media (prefers-color-scheme: light){.label{fill:#2A2925}.value{fill:#3D3B36}.detail{fill:#7A766E}.track{fill:#E6E2DA}.value.warn{fill:#B7791F}.value.danger{fill:#C93C37}}',
    '</style>',
    '<defs><linearGradient id="sweep" x1="0" x2="1">',
    `<stop offset="0" stop-color="${TONES.accent}" stop-opacity="0"/><stop offset="0.5" stop-color="${TONES.accent}"/>`,
    `<stop offset="1" stop-color="${TONES.accent}" stop-opacity="0"/></linearGradient></defs>`,
    `<text class="label" x="0" y="${mid}" dominant-baseline="central" font-size="13.5">${escapeXml(clip(row.label, columns.labelPx - GUTTER, LABEL_CH))}</text>`,
    ...desktopBar(row, barX, columns.barPx, mid - BAR_PX / 2),
    `<text class="${valueClass}" x="${valueEnd}" y="${mid}" text-anchor="end" dominant-baseline="central" font-size="13">${escapeXml(row.value)}</text>`,
    columns.detailPx > 0
      ? `<text class="detail" x="${detailX}" y="${mid}" dominant-baseline="central" font-size="12.5">${escapeXml(clip(row.detail, columns.detailPx, DETAIL_CH))}</text>`
      : '',
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
