import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { StackAgent, StackLimit, StackTask, StackTaskStatus } from '../types'
import {
  MARK,
  ROW_NAMES,
  ROW_PX,
  TONES,
  buildRows,
  desktopColumns,
  desktopRowSvg,
  fit,
  isHidden,
  monthKey,
  parseCcusage,
  summaryParts,
  terminalBar,
  toolDetail,
} from './model'
import type { DesktopColumns, RowSpec, Segment, StackData } from './model'

const tasks = atom({ plugin: 'stack', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'stack', key: 'agents' } as const, {})
const limits = atom({ plugin: 'stack', key: 'limits' } as const, [])
const tracked = atom({ plugin: 'stack', key: 'tracked' } as const, {})
const backfill = atom({ plugin: 'stack', key: 'backfill' } as const, {})
const backfillStatus = atom({ plugin: 'stack', key: 'backfillStatus' } as const, 'not run')
const lastCostUsd = atom({ plugin: 'stack', key: 'lastCostUsd' } as const, null)
const isExpanded = atom({ plugin: 'stack', key: 'isExpanded' } as const, false)
const hidden = atom({ plugin: 'stack', key: 'hidden' } as const, [])

const COST_PREFIX = 'costs.'
const CCUSAGE_KEY = 'ccusage'
const HIDDEN_KEY = 'hidden'
const CCUSAGE_MAX_AGE_MS = 12 * 60 * 60 * 1000
const CCUSAGE_ARGS = ['--yes', 'ccusage', 'claude', 'monthly', '--json']
// No shell: on Windows `npx` is a .cmd shim that only cmd.exe can start.
const CCUSAGE_COMMANDS: string[][] = [
  ['npx', ...CCUSAGE_ARGS],
  ['cmd', '/d', '/s', '/c', ['npx', ...CCUSAGE_ARGS].join(' ')],
]

type $ = EngineInterface
type CcusageCache = { fetchedAt: number; months: Record<string, number> }

// Data ----------------------------------------------------------------------

const setTasks = ($: $, fn: (list: StackTask[]) => StackTask[]) => update($, tasks, fn)

const asStatus = (value: unknown): StackTaskStatus =>
  value === 'completed' || value === 'in_progress' ? value : 'pending'

const createdTaskId = (ran: ToolCallResult): string | undefined => {
  const record = ran.result as { task?: { id?: unknown }; id?: unknown } | undefined
  const id = record?.task?.id ?? record?.id ?? /#(\d+)/.exec(ran.text ?? '')?.[1]
  return id === undefined ? undefined : String(id)
}

const noteAgentTool = async ($: $, agentId: string, tool: string, args: Record<string, unknown>) => {
  const known = (await read($, agents))[agentId]
  const info = known ? undefined : (await $.agent.list()).find(agent => agent.id === agentId)
  const label = known?.label ?? info?.description ?? info?.type ?? 'Subagent'
  const detail = toolDetail(tool, args)
  await update($, agents, all => {
    const before: StackAgent = all[agentId] ?? { label, tool, calls: 0 }
    return { ...all, [agentId]: { ...before, tool, detail, calls: before.calls + 1 } }
  })
}

const dropAgents = ($: $, isGone: (id: string) => boolean) =>
  update($, agents, all => Object.fromEntries(Object.entries(all).filter(([id]) => !isGone(id))))

const refreshLimits = async ($: $, readings?: readonly StackLimit[]) => {
  const list = readings ?? (await $.session.usage()).rateLimits
  await update($, limits, () => list.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })))
}

// The session's cost only grows, so each reading's growth since the last one is new spend.
const recordCost = async ($: $) => {
  const cost = (await $.session.usage()).cost?.usd
  if (cost === undefined) return
  let delta = 0
  await update($, lastCostUsd, last => {
    delta = last === null ? 0 : cost >= last ? cost - last : cost
    return cost
  })
  if (delta <= 0) return
  const key = `${COST_PREFIX}${monthKey(await $.clock.now())}`
  const total = Number((await $.store.get(key)) ?? 0) + delta
  await $.store.set(key, total)
  await update($, tracked, months => ({ ...months, [key.slice(COST_PREFIX.length)]: total }))
}

const loadStore = async ($: $) => {
  const months: Record<string, number> = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith(COST_PREFIX)) months[key.slice(COST_PREFIX.length)] = Number(await $.store.get(key)) || 0
  }
  await update($, tracked, () => months)
  const cache = (await $.store.get(CCUSAGE_KEY)) as CcusageCache | undefined
  if (cache?.months) await update($, backfill, () => cache.months)
  const saved = await $.store.get(HIDDEN_KEY)
  if (Array.isArray(saved)) await update($, hidden, () => saved.filter((id): id is string => typeof id === 'string'))
}

const runCcusage = async ($: $): Promise<string> => {
  const failures: string[] = []
  for (const argv of CCUSAGE_COMMANDS) {
    try {
      const ran = await $.process.run(argv, { timeoutMs: 180_000 })
      if (ran.exitCode === 0) return ran.stdout
      failures.push(`${argv[0]} exited ${ran.exitCode}: ${ran.stderr.trim().split('\n').pop() ?? ''}`)
    } catch (error) {
      failures.push(`${argv[0]}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(failures.join('; '))
}

// Merges by month, keeping the larger figure: Claude Code prunes old transcripts, so a later
// ccusage run can know less about an old month than an earlier one did.
const backfillFromCcusage = async ($: $) => {
  const cache = (await $.store.get(CCUSAGE_KEY)) as CcusageCache | undefined
  const now = await $.clock.now()
  if (cache && now - cache.fetchedAt < CCUSAGE_MAX_AGE_MS) {
    await update($, backfillStatus, () => `cached ${Object.keys(cache.months).length} months`)
    return
  }
  try {
    const fresh = parseCcusage(await runCcusage($))
    const months = { ...cache?.months }
    for (const [key, value] of Object.entries(fresh)) months[key] = Math.max(months[key] ?? 0, value)
    await $.store.set(CCUSAGE_KEY, { fetchedAt: now, months } satisfies CcusageCache)
    await update($, backfill, () => months)
    await update($, backfillStatus, () => `loaded ${Object.keys(fresh).length} months from ccusage`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await update($, backfillStatus, () => `ccusage failed: ${reason}`)
    $.ui.log(`stack: ccusage backfill failed: ${reason}`, { to: 'debug' })
  }
}

const setHidden = async ($: $, fn: (ids: string[]) => string[]) => {
  await update($, hidden, ids => [...new Set(fn(ids))])
  await $.store.set(HIDDEN_KEY, await read($, hidden))
}

// Drawing -------------------------------------------------------------------

type AnyElements = Elements['terminal'] | Elements['desktop']

type Layout =
  | { surface: 'terminal'; labelCells: number; barCells: number; valueCells: number; detailCells: number }
  | { surface: 'desktop'; columns: DesktopColumns }

type ProgressRow = RowSpec & { onHide: () => void }

const longestOf = (rows: RowSpec[], pick: (row: RowSpec) => string): number =>
  Math.max(0, ...rows.map(row => pick(row).length))

// label  ━━━━━━━━──────  value  detail  ×, two cells between columns; the detail column
// goes first when the band is too narrow for a useful bar.
const terminalLayout = (rows: RowSpec[], columns: number): Layout => {
  const labelCells = Math.min(18, longestOf(rows, row => row.label))
  const valueCells = longestOf(rows, row => row.value)
  const fixed = labelCells + 2 + 2 + valueCells + 2 + 1 + 1
  const detailCells = Math.min(30, longestOf(rows, row => row.detail))
  const withDetail = columns - fixed - detailCells - 2
  return withDetail >= 16
    ? { surface: 'terminal', labelCells, barCells: withDetail, valueCells, detailCells }
    : { surface: 'terminal', labelCells, barCells: Math.max(8, columns - fixed), valueCells, detailCells: 0 }
}

const segmentStyle = (kind: Segment['kind'], row: RowSpec) =>
  kind === 'fill' ? { color: TONES[row.tone] } : kind === 'active' ? { color: TONES[row.tone], dimColor: true } : { dimColor: true }

const progressRow = (elements: AnyElements, row: ProgressRow, layout: Layout) => {
  const { Box, Text, Button } = elements
  const hide = <Button key={`hide:${row.id}`} label="×" plain dimColor onPress={row.onHide} />

  if (layout.surface === 'desktop') {
    const { Svg } = elements as Elements['desktop']
    return (
      <Box key={`row:${row.id}`} flexDirection="row" alignItems="center" gap={1}>
        <Svg
          source={desktopRowSvg(row, layout.columns)}
          alt={`${row.label}: ${row.value}, ${row.detail}`}
          width={layout.columns.widthPx}
          height={ROW_PX}
        />
        {hide}
      </Box>
    )
  }

  return (
    <Box key={`row:${row.id}`} flexDirection="row">
      <Text>{fit(row.label, layout.labelCells)}  </Text>
      {terminalBar(row, layout.barCells).map(segment => (
        <Text {...segmentStyle(segment.kind, row)}>{segment.text}</Text>
      ))}
      <Text {...(row.tone === 'accent' ? {} : { color: TONES[row.tone] })}>{`  ${row.value.padStart(layout.valueCells)}`}</Text>
      {layout.detailCells > 0 && <Text dimColor>{`  ${fit(row.detail, layout.detailCells)}`}</Text>}
      <Text> </Text>
      {hide}
    </Box>
  )
}

const readData = async ($: $): Promise<StackData> => ({
  tasks: await read($, tasks),
  agents: await read($, agents),
  limits: await read($, limits),
  tracked: await read($, tracked),
  backfill: await read($, backfill),
})

const toggleExpanded = ($: $) => update($, isExpanded, open => !open)

// Hooks ---------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'stack',
      description: 'Progress band: toggle, expand, collapse, hide <row>, show <row|all>',
      argumentHint: '[expand|collapse|hide <row>|show <row|all>]',
    })
    await loadStore($)
    const usage = await $.session.usage()
    if ((await read($, lastCostUsd)) === null) await update($, lastCostUsd, () => usage.cost?.usd ?? 0)
    await refreshLimits($, usage.rateLimits)
    $.clock.after(1000, () => void backfillFromCcusage($))
    return started
  })

  on('tool.call', async ($, e, next) => {
    const tool: string = e.tool
    const args = e as unknown as Record<string, unknown>
    if (e.agentId) {
      await noteAgentTool($, e.agentId, tool, args)
      return next(e)
    }

    if (tool === 'TodoWrite' && Array.isArray(args.todos)) {
      const todos = args.todos as Array<Record<string, unknown>>
      await setTasks($, () =>
        todos.map((todo, index) => ({
          id: String(index),
          subject: String(todo.content ?? ''),
          status: asStatus(todo.status),
          ...(typeof todo.activeForm === 'string' ? { activeForm: todo.activeForm } : {}),
        })),
      )
      return next(e)
    }

    if (tool === 'TaskCreate') {
      const ran = await next(e)
      const id = createdTaskId(ran)
      if (!ran.isError && !ran.deny && id !== undefined) {
        const task: StackTask = {
          id,
          subject: String(args.subject ?? ''),
          status: 'pending',
          ...(typeof args.activeForm === 'string' ? { activeForm: args.activeForm } : {}),
        }
        await setTasks($, list => [...list.filter(one => one.id !== id), task])
      }
      return ran
    }

    if (tool === 'TaskUpdate' && args.taskId !== undefined) {
      const ran = await next(e)
      const id = String(args.taskId)
      if (!ran.isError && !ran.deny && args.status !== undefined) {
        await setTasks($, list =>
          args.status === 'deleted'
            ? list.filter(task => task.id !== id)
            : list.map(task => (task.id === id ? { ...task, status: asStatus(args.status) } : task)),
        )
      }
      return ran
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await refreshLimits($, e.rateLimits)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await recordCost($)
    if (e.agentId) {
      const finished = e.agentId
      await dropAgents($, id => id === finished)
    } else {
      const running = new Set((await $.agent.list()).filter(agent => agent.status === 'running').map(agent => agent.id))
      await dropAgents($, id => !running.has(id))
      await refreshLimits($)
    }
    return done
  })

  on('command.run', { command: 'stack' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const target = rest.join(' ').toLowerCase()

    if (verb === '') {
      await toggleExpanded($)
      return { text: `stack ${(await read($, isExpanded)) ? 'expanded' : 'collapsed'}. Backfill: ${await read($, backfillStatus)}.` }
    }
    if (verb === 'expand' || verb === 'collapse') {
      await update($, isExpanded, () => verb === 'expand')
      return { text: `stack ${verb === 'expand' ? 'expanded' : 'collapsed'}.` }
    }
    if (verb === 'hide' || verb === 'show') {
      const ids = target === 'all' && verb === 'show' ? null : ROW_NAMES[target]
      if (ids === undefined) return { text: `Unknown row "${target}". Rows: ${Object.keys(ROW_NAMES).join(', ')}${verb === 'show' ? ', all' : ''}.` }
      await setHidden($, list => (verb === 'hide' ? [...list, ...(ids ?? [])] : ids === null ? [] : list.filter(id => !ids.includes(id))))
      return { text: `${verb === 'hide' ? 'Hid' : 'Showing'} ${target}.` }
    }
    return { text: 'Usage: /stack [expand|collapse|hide <row>|show <row|all>]' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)

    const now = await $.clock.now()
    const data = await readData($)
    const hiddenIds = await read($, hidden)
    const rows = buildRows(data, now).filter(row => !isHidden(row.id, hiddenIds))
    if (rows.length === 0) return next(e)

    const elements: AnyElements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const { bodyColumns, maxRows } = e.props
    const toggle = (label: string) => (
      <Button key="toggle" hotkey="e" plain dimColor label={label} onPress={() => toggleExpanded($)} />
    )

    if (!(await read($, isExpanded)) || maxRows < 2) {
      const parts = summaryParts(rows)
      return (
        <Box flexDirection="row" gap={1}>
          <Text color={TONES.accent}>{MARK}</Text>
          <Text wrap="truncate">
            {parts.flatMap((part, index) => (index === 0 ? [part] : [<Text dimColor> · </Text>, part]))}
          </Text>
          {toggle('expand')}
        </Box>
      )
    }

    const shown = rows.slice(0, maxRows - 1)
    const layout: Layout =
      e.surface === 'desktop'
        ? { surface: 'desktop', columns: desktopColumns(shown, Math.min(1200, Math.max(360, Math.round(bodyColumns * 7.6) - 48))) }
        : terminalLayout(shown, bodyColumns)

    const more = rows.length - shown.length
    const hideRow = (id: string) => () => setHidden($, list => [...list, id])

    return (
      <Box flexDirection="column">
        {shown.map(row => progressRow(elements, { ...row, onHide: hideRow(row.id) }, layout))}
        <Box flexDirection="row" gap={1}>
          {more > 0 && <Text dimColor>+{more} more</Text>}
          {toggle('collapse')}
        </Box>
      </Box>
    )
  })
}
