import type { StackAgent, StackLimit, StackTask } from '../types'

export const FILL = '#a99cf5'
export const TICK_ON_FILL = '#2c2c2c'
export const PILL_BG = '#5b4dd6'
export const PILL_FG = '#ffffff'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 24 * 60 * 60 * 1000

export type RowSpec = {
  id: string
  label: string
  percent: number
  pill: string
  steps: number
  // Shown in the percentage column instead of the percent (a subagent has no total).
  caption?: string
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

const shortTool = (tool: string): string => tool.replace(/^mcp__.+?__/, '')

// A subagent has no known total, so its bar fills toward, never reaching, the end as it works.
const activity = (calls: number): number => (calls / (calls + 8)) * 100

export const buildRows = (data: StackData, now: number): RowSpec[] => {
  const rows: RowSpec[] = []

  if (data.tasks.length > 0) {
    const done = data.tasks.filter(task => task.status === 'completed').length
    rows.push({
      id: 'tasks',
      label: 'Tasks',
      percent: (done / data.tasks.length) * 100,
      pill: `Tasks ${done}/${data.tasks.length}`,
      steps: data.tasks.length,
    })
  }

  for (const [id, agent] of Object.entries(data.agents)) {
    rows.push({
      id: `agent:${id}`,
      label: agent.label,
      percent: activity(agent.calls),
      pill: shortTool(agent.tool),
      steps: 0,
      caption: `${agent.calls} ${agent.calls === 1 ? 'call' : 'calls'}`,
    })
  }

  for (const limit of data.limits) {
    const meta = limitRow(limit.kind)
    rows.push({
      id: meta.id,
      label: meta.label,
      percent: limit.percentUsed,
      pill: formatReset(limit.resetsAt, now),
      steps: 0,
    })
  }

  const thisKey = monthKey(now)
  const lastKey = previousMonthKey(now)
  const thisMonth = monthTotal(data, thisKey)
  const lastMonth = monthTotal(data, lastKey)
  if (thisMonth > 0 || lastMonth > 0) {
    rows.push({
      id: 'costs',
      label: `${MONTHS_LONG[monthIndex(thisKey)]} so far`,
      percent: lastMonth > 0 ? (thisMonth / lastMonth) * 100 : 100,
      pill: lastMonth > 0 ? `${usd(thisMonth)} · ${MONTHS[monthIndex(lastKey)]} ${usd(lastMonth)}` : usd(thisMonth),
      steps: 0,
    })
  }

  return rows
}

export const summaryParts = (rows: RowSpec[], data: StackData, now: number): string[] => {
  const parts: string[] = []
  const agents = rows.filter(row => row.id.startsWith('agent:')).length
  for (const row of rows) {
    const limit = Object.values(LIMIT_ROWS).find(meta => meta.id === row.id)
    if (row.id === 'tasks') parts.push(row.pill)
    else if (row.id.startsWith('agent:')) {
      if (!parts.some(part => part.endsWith('agent') || part.endsWith('agents'))) {
        parts.push(`${agents} ${agents === 1 ? 'agent' : 'agents'}`)
      }
    } else if (limit) parts.push(`${limit.short} ${Math.round(row.percent)}%`)
    else if (row.id === 'costs') {
      const key = monthKey(now)
      parts.push(`${MONTHS[monthIndex(key)]} ${usd(monthTotal(data, key))} (${Math.round(row.percent)}%)`)
    }
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

export const rightLabel = (row: RowSpec): string => row.caption ?? `${Math.round(row.percent)}%`

// Terminal track ------------------------------------------------------------

export type SegmentKind = 'fill' | 'pill' | 'empty' | 'tickFill' | 'tickEmpty'
export type Segment = { kind: SegmentKind; text: string }

const tickCells = (cells: number, steps: number): Set<number> => {
  const ticks = new Set<number>()
  for (let i = 1; i < steps; i++) ticks.add(Math.round((cells * i) / steps))
  return ticks
}

// One cell per character: a solid block up to the progress point, the pill ending at it,
// a tick at each step boundary and a dim dot for every empty cell.
export const terminalTrack = (row: RowSpec, cells: number): Segment[] => {
  const pill = ` ${row.pill} `.slice(0, cells)
  const exact = (cells * Math.min(100, Math.max(0, row.percent))) / 100
  const fillEnd = row.percent > 0 ? Math.max(1, Math.round(exact)) : 0
  // The pill ends at the fill's edge only while the fill is long enough to show around it;
  // a shorter fill stays visible and the pill follows it.
  const isPillInside = fillEnd >= pill.length + 2
  const pillStart = Math.min(isPillInside ? fillEnd - pill.length : fillEnd, cells - pill.length)
  const ticks = tickCells(cells, row.steps)
  const segments: Segment[] = []

  const push = (kind: SegmentKind, char: string) => {
    const last = segments[segments.length - 1]
    if (last?.kind === kind) last.text += char
    else segments.push({ kind, text: char })
  }

  for (let cell = 0; cell < cells; cell++) {
    const isFill = cell < fillEnd
    if (cell >= pillStart && cell < pillStart + pill.length) push('pill', pill[cell - pillStart] ?? ' ')
    else if (ticks.has(cell)) push(isFill ? 'tickFill' : 'tickEmpty', '│')
    else if (isFill) push('fill', '█')
    else push('empty', '·')
  }
  return segments
}

// Desktop row ---------------------------------------------------------------

export const ROW_PX = 36

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const textPx = (text: string, size: number): number => text.length * size * 0.6

// The whole row as one image: dot, label, rounded track with a solid fill up to the
// progress point, ticks over the empty track, the pill at the fill's edge and the percentage.
export const desktopRowSvg = (row: RowSpec, widthPx: number, labelPx: number): string => {
  const h = ROW_PX
  const trackX = labelPx
  const trackW = Math.max(60, widthPx - labelPx - 64)
  const trackY = 3
  const trackH = h - 6
  const exactW = (trackW * Math.min(100, Math.max(0, row.percent))) / 100
  const fillW = row.percent > 0 ? Math.max(8, exactW) : 0
  const pillW = Math.min(trackW, textPx(row.pill, 13) + 24)
  const isPillInside = fillW >= pillW + 16
  const pillH = trackH - 4
  const pillX = Math.min(trackX + (isPillInside ? fillW - pillW : fillW + 6), trackX + trackW - pillW)
  const ticks: string[] = []
  for (let i = 1; i < row.steps; i++) {
    const x = trackX + (trackW * i) / row.steps
    if (x > pillX - 2 && x < pillX + pillW + 2) continue
    ticks.push(`<line class="tick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${h / 2 - 6}" y2="${h / 2 + 6}"/>`)
  }
  const label = row.label.length * 8.6 > labelPx - 36 ? `${row.label.slice(0, Math.floor((labelPx - 36) / 8.6) - 1)}…` : row.label

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${h}" viewBox="0 0 ${widthPx} ${h}" font-family="Segoe UI, system-ui, -apple-system, sans-serif">`,
    '<style>',
    `.label{fill:#ececec}.pct{fill:#b8b8b8}.track{fill:#2c2c2c}.tick{stroke:#8a8a8a;stroke-width:1.2}`,
    `@media (prefers-color-scheme: light){.label{fill:#1f1f1f}.pct{fill:#555}.track{fill:#e7e5ef}.tick{stroke:#9a97a8}}`,
    '</style>',
    '<defs>',
    `<clipPath id="track"><rect x="${trackX}" y="${trackY}" width="${trackW}" height="${trackH}" rx="8"/></clipPath>`,
    '</defs>',
    `<circle cx="7" cy="${h / 2}" r="4" fill="${FILL}"/>`,
    `<text class="label" x="26" y="${h / 2}" dominant-baseline="central" font-size="15">${escapeXml(label)}</text>`,
    `<rect class="track" x="${trackX}" y="${trackY}" width="${trackW}" height="${trackH}" rx="8"/>`,
    `<g clip-path="url(#track)"><rect x="${trackX}" y="${trackY}" width="${fillW.toFixed(1)}" height="${trackH}" fill="${FILL}"/></g>`,
    ...ticks,
    `<rect x="${pillX.toFixed(1)}" y="${trackY + 2}" width="${pillW.toFixed(1)}" height="${pillH}" rx="${pillH / 2}" fill="${PILL_BG}"/>`,
    `<text x="${(pillX + pillW / 2).toFixed(1)}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" font-size="13" fill="${PILL_FG}">${escapeXml(row.pill)}</text>`,
    `<text class="pct" x="${widthPx - 4}" y="${h / 2}" text-anchor="end" dominant-baseline="central" font-size="15">${escapeXml(rightLabel(row))}</text>`,
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
