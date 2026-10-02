import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

import { buildRows, terminalBar, toolDetail } from '../hooks/model'

const SURFACES = ['terminal', 'desktop'] as const
const OCT_2 = new Date(2026, 9, 2, 12).getTime()
const WEEKLY_RESET = new Date(2026, 9, 7, 7).toISOString()

const band = <S extends (typeof SURFACES)[number]>(surface: S, maxRows = 12) => ({
  plugin: 'stack',
  surface,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: 110, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
})

type World = { usd?: number; rateLimits?: SessionRateLimit[]; ccusage?: string | Error }

// The plugin's $.store, kept in a record the test can read back.
const memoryStore = (on: On, entries: Record<string, unknown> = {}) => {
  const store: Record<string, unknown> = { ...entries }
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => ((store[e.key] = JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', (_$, e) => (delete store[e.key], { value: undefined }))
  on('store.keys', () => ({ value: Object.keys(store) }))
  return store
}

// Stands in for the engine beneath the plugin: usage figures, ccusage, subagents, tools.
const world = (on: On, state: World = {}) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // What the engine draws when the plugin passes: nothing.
  on('ui.render', () => null as never)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000 },
      rateLimits: state.rateLimits ?? [],
      ...(state.usd === undefined ? {} : { cost: { usd: state.usd } }),
    },
  }))
  on('process.run', () => {
    if (state.ccusage instanceof Error) return { deny: state.ccusage.message }
    return {
      value: { exitCode: 0, stdout: state.ccusage ?? '{"monthly":[]}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_$, e) => {
    const args = e as unknown as Record<string, unknown>
    if (args.tool === 'TaskCreate') return { result: { task: { id: String(String(args.subject).length) } } } as never
    return { result: {} } as never
  })
  return state
}

const start = ($: Engine) =>
  $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

const turn = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

const command = ($: Engine, args: string) =>
  $.command.run({ command: 'stack', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 110 } })

const todos = (...statuses: string[]) =>
  statuses.map((status, index) => ({ content: `task ${index}`, activeForm: `doing ${index}`, status }))

describe('stack', () => {
  test('tasks: a summary when collapsed, one bar segment per task and the active task when expanded', async ($, on) => {
    mock.clock(on, { now: OCT_2 })
    memoryStore(on)
    world(on)
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: todos('completed', 'completed', 'in_progress', 'pending') } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface))
      expect((await ui.find({ type: 'Text', text: 'Tasks 2/4' }))?.text).toContain('Tasks 2/4')
      await ui.press({ key: 'toggle' })

      if (surface === 'terminal') {
        const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
        // Each segment is its own run of line characters, split from the next by a gap.
        expect(texts.filter(text => /^[━─]+$/.test(text))).toHaveLength(4)
        expect(texts.some(text => text.trim() === '2/4')).toBe(true)
        expect(texts.some(text => text.trim() === 'doing 2')).toBe(true)
      } else {
        const svg = await ui.find({ type: 'Svg' })
        expect(svg?.props.alt).toBe('Tasks: 2/4, doing 2')
        expect(String(svg?.props.source).match(/<rect[^>]*height="6"/g)).toHaveLength(4)
        expect(String(svg?.props.source)).toContain('opacity="0.42"')
      }
      await ui.press({ key: 'toggle' })
      await ui.unmount()
    }
  })

  test('TaskCreate and TaskUpdate build the list incrementally', async ($, on) => {
    mock.clock(on, { now: OCT_2 })
    memoryStore(on)
    world(on)
    await start($)
    await $.tool.call({ tool: 'TaskCreate', subject: 'a', description: '' } as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'bb', description: '' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)

    const ui = await $.ui.mount(band('terminal'))
    expect(await ui.find({ type: 'Text', text: 'Tasks 1/2' })).toBeDefined()
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' } as never)
    expect(await ui.find({ type: 'Text', text: 'Tasks 1/1' })).toBeDefined()
  })

  test('rate limits show reset times and × hides a row for good', async ($, on) => {
    mock.clock(on, { now: OCT_2 })
    const store = memoryStore(on)
    world(on, {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(2026, 9, 2, 15, 40).toISOString() },
        { kind: 'seven_day', percentUsed: 16, resetsAt: WEEKLY_RESET },
      ],
    })
    await start($)
    await command($, 'expand')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface))
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: 'resets 3:40 PM' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'resets Wed 7 AM' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: '16%' })).toBeDefined()
      } else {
        expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual([
          'Session limit: 23%, resets 3:40 PM',
          'Weekly limit: 16%, resets Wed 7 AM',
        ])
      }
      await ui.unmount()
    }

    const ui = await $.ui.mount(band('terminal'))
    await ui.press({ key: 'hide:weekly' })
    expect(await ui.find({ type: 'Text', text: 'Weekly limit' })).toBeUndefined()
    expect(store['hidden']).toEqual(['weekly'])
  })

  test('a limit close to running out turns amber, then red', async ($, on) => {
    mock.clock(on, { now: OCT_2 })
    memoryStore(on)
    world(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 80 }, { kind: 'seven_day', percentUsed: 93 }] })
    await start($)
    await command($, 'expand')

    const terminal = await $.ui.mount(band('terminal'))
    expect((await terminal.find({ type: 'Text', text: '80%' }))?.props.color).toBe('#E0A84E')
    expect((await terminal.find({ type: 'Text', text: '93%' }))?.props.color).toBe('#E5534B')
    await terminal.unmount()

    const desktop = await $.ui.mount(band('desktop'))
    const [session, weekly] = await desktop.findAll({ type: 'Svg' })
    expect(String(session?.props.source)).toContain('class="value warn"')
    expect(String(weekly?.props.source)).toContain('class="value danger"')
  })

  test('each turn adds the cost delta to this month and the bar compares it to last month', async ($, on) => {
    mock.clock(on, { now: OCT_2 })
    const store = memoryStore(on, { 'costs.2026-09': 4.5 })
    const state = world(on, { usd: 0.25 })
    await start($)
    state.usd = 1.5
    await turn($)
    state.usd = 2.5
    await turn($)

    expect(store['costs.2026-10']).toBe(2.25)
    await command($, 'expand')
    const ui = await $.ui.mount(band('terminal'))
    expect(await ui.find({ type: 'Text', text: 'October so far' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '$2.25' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '50% of Sep · $4.50' })).toBeDefined()
  })

  test('ccusage backfills earlier months and the result is cached', async ($, on) => {
    const clock = mock.clock(on, { now: OCT_2 })
    const store = memoryStore(on)
    world(on, { ccusage: JSON.stringify({ monthly: [{ period: '2026-09', totalCost: 62.4 }, { month: '2026-10', totalCost: 38.2 }] }) })
    await start($)
    await clock.advance(1000)

    expect(store['ccusage']).toEqual({ fetchedAt: OCT_2 + 1000, months: { '2026-09': 62.4, '2026-10': 38.2 } })
    await command($, 'expand')
    const ui = await $.ui.mount(band('desktop'))
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('October so far: $38.20, 61% of Sep · $62.40')
  })

  test('a blocked ccusage run is reported by /stack', async ($, on) => {
    const clock = mock.clock(on, { now: OCT_2 })
    const store = memoryStore(on)
    world(on, { ccusage: new Error('process.run blocked') })
    await start($)
    await clock.advance(1000)

    expect((await command($, ''))?.text).toContain('ccusage failed')
    expect(store['ccusage']).toBeUndefined()
  })

  test('/stack hide and show, and maxRows bounds the expanded band', async ($, on) => {
    mock.clock(on, { now: OCT_2 })
    memoryStore(on, { 'costs.2026-10': 3 })
    world(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 10 }] })
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: todos('pending') } as never)
    await command($, 'expand')

    const tight = await $.ui.mount(band('terminal', 3))
    expect(await tight.find({ type: 'Text', text: '+2 more' })).toBeDefined()
    await tight.unmount()

    expect((await command($, 'hide limits'))?.text).toBe('Hid limits.')
    const ui = await $.ui.mount(band('terminal'))
    expect(await ui.find({ type: 'Text', text: 'Session limit' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Tasks' })).toBeDefined()
    expect((await command($, 'hide nonsense'))?.text).toContain('Unknown row')
    await command($, 'show all')
    expect(await ui.find({ type: 'Text', text: 'Session limit' })).toBeDefined()
  })
})

// A subagent's loop cannot be raised from a test (the kit drops `agentId`), so its row's
// parts are checked where they are made.
describe('subagent rows', () => {
  test('the detail names what the current tool call is about', () => {
    expect(toolDetail('Read', { file_path: String.raw`C:\code\stack\hooks\register.tsx` })).toBe('Read register.tsx')
    expect(toolDetail('Read', { file_path: '/home/me/notes.md' })).toBe('Read notes.md')
    expect(toolDetail('Grep', { pattern: 'update\\(' })).toBe('Grep update\\(')
    expect(toolDetail('mcp__github__search_code', { query: 'stack' })).toBe('search_code stack')
    expect(toolDetail('Bash', { command: 'npm   run\n test' })).toBe('Bash npm run test')
  })

  test('with no known total, the marker moves along the bar as tool calls land', () => {
    const rows = buildRows(
      { tasks: [], limits: [], tracked: {}, backfill: {}, agents: { a: { label: 'Explore', tool: 'Read', calls: 2 } } },
      OCT_2,
    )
    const row = rows[0]!
    const markerAt = (phase: number) => {
      const segments = terminalBar({ ...row, phase }, 40)
      const before = segments.slice(0, segments.findIndex(segment => segment.kind === 'fill'))
      return before.reduce((cells, segment) => cells + segment.text.length, 0)
    }
    expect(row.value).toBe('2 calls')
    expect(markerAt(3)).not.toBe(markerAt(4))
  })
})
