import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

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
  test('tasks from the todo tool: summary when collapsed, a row with ticks when expanded', async ($, on) => {
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
        expect((await ui.find({ type: 'Text', text: ' Tasks 2/4 ' }))?.props).toMatchObject({ backgroundColor: expect.any(String) })
        const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
        expect(texts.filter(text => text === '│')).toHaveLength(3)
        expect(await ui.find({ type: 'Text', text: '50%' })).toBeDefined()
      } else {
        const svg = await ui.find({ type: 'Svg' })
        expect(svg?.props.alt).toBe('Tasks: Tasks 2/4, 50%')
        // The tick at 2/4 is where the fill ends: the pill's rounded end covers it, as in the design.
        expect(String(svg?.props.source).match(/class="tick"/g)).toHaveLength(2)
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
        expect(await ui.find({ type: 'Text', text: ' 3:40 PM ' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: ' Wed 7 AM ' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: '16%' })).toBeDefined()
      } else {
        expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual([
          'Session limit: 3:40 PM, 23%',
          'Weekly limit: Wed 7 AM, 16%',
        ])
      }
      await ui.unmount()
    }

    const ui = await $.ui.mount(band('terminal'))
    await ui.press({ key: 'hide:weekly' })
    expect(await ui.find({ type: 'Text', text: 'Weekly limit' })).toBeUndefined()
    expect(store['hidden']).toEqual(['weekly'])
  })

  test('a fill shorter than its pill stays visible, the pill following it', async ($, on) => {
    mock.clock(on, { now: OCT_2 })
    memoryStore(on)
    world(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 5, resetsAt: new Date(2026, 9, 2, 22).toISOString() }] })
    await start($)
    await command($, 'expand')

    const terminal = await $.ui.mount(band('terminal'))
    const texts = (await terminal.findAll({ type: 'Text' })).map(text => text.text)
    expect(texts[texts.indexOf(' 10 PM ') - 1]).toMatch(/^█+$/)
    await terminal.unmount()

    const desktop = await $.ui.mount(band('desktop'))
    const source = String((await desktop.find({ type: 'Svg' }))?.props.source)
    const [, fillX = '', fillW = ''] = /<rect x="([\d.]+)" y="\d+" width="([\d.]+)" height="\d+" fill="#a99cf5"/.exec(source) ?? []
    const [, pillX = ''] = /<rect x="([\d.]+)" y="\d+" width="[\d.]+" height="\d+" rx="[\d.]+" fill="#5b4dd6"/.exec(source) ?? []
    expect(Number(fillW)).toBeGreaterThan(0)
    expect(Number(pillX)).toBeGreaterThanOrEqual(Number(fillX) + Number(fillW))
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
    expect(await ui.find({ type: 'Text', text: ' $2.25 · Sep $4.50 ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '50%' })).toBeDefined()
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
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('October so far: $38.20 · Sep $62.40, 61%')
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
