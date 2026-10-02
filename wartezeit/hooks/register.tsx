import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, Timer } from 'claude-code'

import type { WzCard, WzDeck, WzKind, WzMode, WzSignals, WzSummary } from '../types'
import { addSignal, claudeArgv, deckFrom, hasEnoughSignals, parseClaudeOutput, topicKey } from './deck'
import {
  DAILY_GOAL,
  XP_PER_CORRECT,
  buildQuestion,
  cardId,
  chooseKind,
  dayKey,
  emptyKindStats,
  leitner,
  pickNext,
  statsReport,
  streakOf,
} from './game'
import type { Day, KindStats, Progress } from './game'
import { GENERAL_DECK } from './general'
import {
  AMBER,
  ORANGE,
  PURPLE,
  PURPLE_BG,
  WHITE,
  cardSvg,
  feedbackOf,
  feedbackSvg,
  fit,
  goalBar,
  headerSvg,
  seenOf,
  sourceText,
  tileTone,
} from './view'
import type { View } from './view'

const deck = atom({ plugin: 'wartezeit', key: 'deck' } as const, GENERAL_DECK)
const deckStatus = atom({ plugin: 'wartezeit', key: 'deckStatus' } as const, 'general')
const signals = atom({ plugin: 'wartezeit', key: 'signals' } as const, { prompts: [], files: [], commands: [] })
const question = atom({ plugin: 'wartezeit', key: 'question' } as const, null)
const answer = atom({ plugin: 'wartezeit', key: 'answer' } as const, null)
const activity = atom({ plugin: 'wartezeit', key: 'activity' } as const, 'Thinking')
const frame = atom({ plugin: 'wartezeit', key: 'frame' } as const, 0)
const index = atom({ plugin: 'wartezeit', key: 'index' } as const, 0)
const mode = atom({ plugin: 'wartezeit', key: 'mode' } as const, 'mixed')
const summary = atom({ plugin: 'wartezeit', key: 'summary' } as const, { today: 0, streak: 0, xp: 0, seen: [] })
const answeredThisTurn = atom({ plugin: 'wartezeit', key: 'answeredThisTurn' } as const, 0)

type $ = EngineInterface

const MODES: WzMode[] = ['mixed', 'vocab', 'meaning', 'article', 'sentence']
const ADVANCE_MS = 2000
const SPINNER_MS = 150
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const GENERATE_TIMEOUT_MS = 180_000

// The store: what the learner has done, across sessions.
const PROGRESS = 'progress'
const DAYS = 'days'
const KINDS = 'kinds'
const XP = 'xp'
const MODE = 'mode'
const deckKey = (key: string) => `deck:${key}`

// The deck's own `claude -p` runs this module too; there it stays out of the way, or every
// deck it generates would start another.
let childCheck: Promise<boolean> | undefined
const isChild = ($: $): Promise<boolean> => (childCheck ??= $.env.get('WARTEZEIT_CHILD').then(value => value === '1'))

let sessionId: string | undefined
let spinner: Timer | undefined
let advance: Timer | undefined

const sessionOf = async ($: $): Promise<string> => (sessionId ??= await $.session.id())

const storeRecord = async <T,>($: $, key: string): Promise<Record<string, T>> => {
  const value = await $.store.get(key)
  return value && typeof value === 'object' ? (value as Record<string, T>) : {}
}

// Learning ------------------------------------------------------------------------

const refreshSummary = async ($: $) => {
  const now = await $.clock.now()
  const progress = await storeRecord<Progress>($, PROGRESS)
  const days = await storeRecord<Day>($, DAYS)
  const xp = Number(await $.store.get(XP)) || 0
  const next: WzSummary = { today: days[dayKey(now)]?.correct ?? 0, streak: streakOf(days, now), xp, seen: Object.keys(progress) }
  await update($, summary, () => next)
}

const poolOf = (current: WzDeck): WzCard[] => {
  const byId = new Map<string, WzCard>()
  for (const card of [...current.cards, ...GENERAL_DECK.cards]) if (!byId.has(cardId(card))) byId.set(cardId(card), card)
  return [...byId.values()]
}

const nextQuestion = async ($: $) => {
  advance?.cancel()
  advance = undefined
  const current = await read($, deck)
  const pool = poolOf(current)
  const progress = await storeRecord<Progress>($, PROGRESS)
  const at = await read($, index)
  const chosenMode = await read($, mode)
  const picked = pickNext({
    deck: current,
    pool,
    progress,
    session: await sessionOf($),
    now: await $.clock.now(),
    index: at,
    mode: chosenMode,
    rng: Math.random,
  })
  if (!picked) return
  const kind = chooseKind(picked.card, chosenMode, pool, Math.random)
  const next = buildQuestion(picked.card, kind, pool, Math.random, {
    isNew: progress[cardId(picked.card)] === undefined,
    source: picked.source,
  })
  await update($, question, () => next)
  await update($, answer, () => null)
  await update($, index, n => n + 1)
}

const answerQuestion = async ($: $, picked: number) => {
  const asked = await read($, question)
  if (!asked || (await read($, answer)) !== null) return
  const isCorrect = picked === asked.correct
  await update($, answer, () => ({ picked, isCorrect }))
  await update($, answeredThisTurn, n => n + 1)

  const now = await $.clock.now()
  const id = cardId(asked.card)
  const progress = await storeRecord<Progress>($, PROGRESS)
  const topic = (await read($, deck)).topic
  progress[id] = leitner(progress[id], asked.card, isCorrect, { now, topic, session: await sessionOf($) })
  await $.store.set(PROGRESS, progress)

  const days = await storeRecord<Day>($, DAYS)
  const today = days[dayKey(now)] ?? { correct: 0, answered: 0 }
  days[dayKey(now)] = { correct: today.correct + (isCorrect ? 1 : 0), answered: today.answered + 1 }
  await $.store.set(DAYS, days)

  const kinds = { ...emptyKindStats(), ...(await storeRecord<KindStats[WzKind]>($, KINDS)) } as KindStats
  kinds[asked.kind] = { right: kinds[asked.kind].right + (isCorrect ? 1 : 0), wrong: kinds[asked.kind].wrong + (isCorrect ? 0 : 1) }
  await $.store.set(KINDS, kinds)
  if (isCorrect) await $.store.set(XP, (Number(await $.store.get(XP)) || 0) + XP_PER_CORRECT)

  await refreshSummary($)
  advance?.cancel()
  advance = $.clock.after(ADVANCE_MS, () => void nextQuestion($))
}

// Topic and deck ------------------------------------------------------------------

const generateDeck = async ($: $) => {
  const gathered = await read($, signals)
  const key = topicKey(gathered)
  const cached = (await $.store.get(deckKey(key))) as WzDeck | undefined
  if (cached?.cards?.length) {
    await update($, deck, () => cached)
    await update($, deckStatus, () => 'cached')
    return
  }
  try {
    const ran = await $.process.run(claudeArgv(gathered), { env: { WARTEZEIT_CHILD: '1' }, timeoutMs: GENERATE_TIMEOUT_MS })
    if (ran.exitCode !== 0) throw new Error(`claude exited ${ran.exitCode}: ${ran.stderr.trim().split('\n').pop() ?? ''}`)
    const { deck: made, dropped } = deckFrom(parseClaudeOutput(ran.stdout), key)
    if (dropped.length > 0) $.ui.log(`wartezeit: dropped ${dropped.length} cards: ${dropped.join('; ')}`, { to: 'debug' })
    if (!made) throw new Error(`too few valid cards (${dropped.length} dropped)`)
    await $.store.set(deckKey(key), made)
    await update($, deck, () => made)
    await update($, deckStatus, () => 'ready')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`wartezeit: deck generation failed: ${reason}`, { to: 'debug' })
    await update($, deckStatus, () => `failed: ${reason.slice(0, 120)}`)
  }
}

const noteSignal = async ($: $, kind: keyof WzSignals, value: string) => {
  await update($, signals, current => addSignal(current, kind, value))
  if ((await read($, deckStatus)) !== 'general' || !hasEnoughSignals(await read($, signals))) return
  await update($, deckStatus, () => 'generating')
  $.clock.after(0, () => void generateDeck($))
}

// What Claude is doing, for the footer.
const describeTool = (tool: string, args: Record<string, unknown>): string => {
  const pick = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')
  const file = (pick('file_path') || pick('notebook_path') || pick('path')).split(/[\\/]/).pop() ?? ''
  const short = (text: string) => (text.length > 40 ? `${text.slice(0, 39)}…` : text)
  if (tool === 'Read') return `Reading ${file}`
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return `Editing ${file}`
  if (tool === 'Write') return `Writing ${file}`
  if (tool === 'Bash' || tool === 'PowerShell') return `Running ${short(pick('command').split('\n')[0] ?? '')}`
  if (tool === 'Grep') return `Searching for ${short(pick('pattern'))}`
  if (tool === 'Glob') return `Finding ${short(pick('pattern'))}`
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Reading the web'
  if (tool === 'Agent' || tool === 'Task') return 'Working with a subagent'
  return `Using ${tool.replace(/^mcp__.+?__/, '')}`
}

// Drawing ---------------------------------------------------------------------------

type AnyElements = Elements['terminal'] | Elements['desktop']

const press = ($: $, option: number) => () => answerQuestion($, option)

const drawTerminal = ($: $, elements: Elements['terminal'], view: View) => {
  const { Box, Text, Button } = elements
  const feedback = feedbackOf(view)
  const width = view.columns - 4
  const bar = goalBar(view.stats.today, 12)

  const header = (
    <Box key="header" flexDirection="row" gap={2}>
      <Text color={WHITE} backgroundColor={PURPLE_BG} bold>{` ${fit(view.current.topic, 24)} `}</Text>
      <Text>
        <Text color={PURPLE}>{bar.filled}</Text>
        <Text dimColor>{bar.empty}</Text>
        <Text>{` ${view.stats.today}/${DAILY_GOAL}`}</Text>
      </Text>
      <Text color={AMBER} bold>{`▲ ${view.stats.streak}`}</Text>
      <Text color={PURPLE} bold>{`✦ ${view.stats.xp} XP`}</Text>
    </Box>
  )
  const source = <Text key="source" dimColor wrap="truncate">{fit(sourceText(view), width)}</Text>
  const label = (
    <Box key="label" flexDirection="row" gap={1}>
      <Text dimColor>{view.asked.label}</Text>
      {view.asked.isNew && <Text color={WHITE} backgroundColor={PURPLE} bold> new </Text>}
    </Box>
  )
  const prompt = <Text key="prompt" bold wrap="truncate">{fit(view.asked.prompt, width)}</Text>
  const tiles = (
    <Box key="tiles" flexDirection="row" flexWrap="wrap" columnGap={1}>
      {view.asked.options.map((option, i) => {
        const tone = tileTone(view, i)
        return (
          <Box key={`tile:${i}`} backgroundColor={tone.bg} paddingX={1}>
            {view.given ? (
              <Text color={tone.fg} backgroundColor={tone.bg}>{`${i + 1}: ${option}`}</Text>
            ) : (
              <Button key={`answer:${i}`} hotkey={String(i + 1)} plain label={option} onPress={press($, i)} />
            )}
          </Box>
        )
      })}
    </Box>
  )
  const headline = feedback && <Text key="feedback" color={feedback.tone} bold>{feedback.headline}</Text>
  const example = feedback && (
    <Text key="example" dimColor wrap="truncate">
      {fit(`${view.asked.card.example_de} — ${view.asked.card.example_en}`, width)}
    </Text>
  )
  const seen = seenOf(view)
  const footer = (
    <Box key="footer" flexDirection="row" justifyContent="space-between" width={width}>
      <Text>
        <Text color={ORANGE}>{view.spin} </Text>
        <Text dimColor>{fit(view.doing, Math.max(8, width - seen.length - 4))}</Text>
      </Text>
      <Text dimColor>{seen}</Text>
    </Box>
  )

  // The card and its answers always show; the rest joins while the band has rows for it.
  const tileRows = Math.ceil(view.asked.options.reduce((cells, option) => cells + option.length + 6, 0) / Math.max(20, width))
  let room = view.maxRows - 2 - tileRows
  const take = (rows: number) => (room >= rows ? ((room -= rows), true) : false)
  const showFooter = take(1)
  const showHeadline = !!headline && take(1)
  const showHeader = take(1)
  const showExample = !!example && take(1)
  const showSource = take(1)

  return (
    <Box flexDirection="column">
      {showHeader && header}
      {showSource && source}
      {label}
      {prompt}
      {tiles}
      {showHeadline && headline}
      {showExample && example}
      {showFooter && footer}
    </Box>
  )
}

const drawDesktop = ($: $, elements: Elements['desktop'], view: View) => {
  const { Box, Text, Button, Svg } = elements
  const width = Math.min(860, Math.max(360, Math.round(view.columns * 7.6) - 60))
  const feedback = feedbackSvg(view, width)
  return (
    <Box flexDirection="column" gap={1}>
      <Svg key="header" source={headerSvg(view, width)} alt={`${view.current.topic} · ${view.stats.today}/${DAILY_GOAL} today · streak ${view.stats.streak} · ${view.stats.xp} XP`} width={width} height={30} />
      <Text key="source" dimColor wrap="truncate">{sourceText(view)}</Text>
      <Svg key="card" source={cardSvg(view, width)} alt={`${view.asked.label}: ${view.asked.prompt}${view.asked.isNew ? ' (new)' : ''}`} width={width} height={58} />
      <Box key="tiles" flexDirection="row" flexWrap="wrap" gap={1}>
        {view.asked.options.map((option, i) => {
          const tone = tileTone(view, i)
          return (
            <Box key={`tile:${i}`} backgroundColor={tone.bg} paddingX={1}>
              {view.given ? (
                <Text color={tone.fg}>{`${i + 1}  ${option}`}</Text>
              ) : (
                <Button key={`answer:${i}`} hotkey={String(i + 1)} label={`${i + 1}  ${option}`} onPress={press($, i)} />
              )}
            </Box>
          )
        })}
      </Box>
      {feedback && <Svg key="feedback" source={feedback} alt={`${feedbackOf(view)?.headline}. ${view.asked.card.example_de}`} width={width} height={50} />}
      <Text key="footer" dimColor>{`${view.spin} ${view.doing} · ${seenOf(view)}`}</Text>
    </Box>
  )
}

// Hooks -----------------------------------------------------------------------------

const stopSpinner = () => {
  spinner?.cancel()
  spinner = undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (await isChild($)) return started
    await $.command.register({
      name: 'wartezeit',
      description: 'German vocabulary while Claude works: stats, or mode <mixed|vocab|meaning|article|sentence>',
      argumentHint: '[stats | mode <mixed|vocab|meaning|article|sentence>]',
    })
    const saved = await $.store.get(MODE)
    if (typeof saved === 'string' && (MODES as string[]).includes(saved)) await update($, mode, () => saved as WzMode)
    await refreshSummary($)
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    if ((await isChild($)) || e.text.trimStart().startsWith('/')) return next(e)
    await update($, answeredThisTurn, () => 0)
    await update($, activity, () => 'Thinking')
    await noteSignal($, 'prompts', e.text)
    if ((await read($, question)) === null || (await read($, answer)) !== null) await nextQuestion($)
    stopSpinner()
    spinner = $.clock.every(SPINNER_MS, () => void update($, frame, n => (n + 1) % SPINNER.length))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (await isChild($)) return next(e)
    const tool: string = e.tool
    const args = e as unknown as Record<string, unknown>
    const path = [args.file_path, args.notebook_path, args.path].find(value => typeof value === 'string') as string | undefined
    if (path) await noteSignal($, 'files', path)
    if ((tool === 'Bash' || tool === 'PowerShell') && typeof args.command === 'string') await noteSignal($, 'commands', args.command)
    if (e.agentId) return next(e)
    await update($, activity, () => describeTool(tool, args))
    const ran = await next(e)
    await update($, activity, () => 'Thinking')
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if ((await isChild($)) || e.agentId) return done
    stopSpinner()
    const answered = await read($, answeredThisTurn)
    if (answered > 0 || e.durationMs >= 5000) {
      const { today, streak } = await read($, summary)
      $.ui.toast(`Claude is done · ${today}/${DAILY_GOAL} today · streak ${streak}`)
    }
    return done
  })

  on('command.run', { command: 'wartezeit' }, async ($, e) => {
    const [verb = '', choice = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (verb === 'mode') {
      if (!(MODES as string[]).includes(choice)) return { text: `Modes: ${MODES.join(', ')}. Now: ${await read($, mode)}.` }
      await update($, mode, () => choice as WzMode)
      await $.store.set(MODE, choice)
      if ((await read($, answer)) === null) await nextQuestion($)
      return { text: `wartezeit mode: ${choice}.` }
    }
    if (verb === 'stats') {
      const report = statsReport({
        progress: await storeRecord<Progress>($, PROGRESS),
        days: await storeRecord<Day>($, DAYS),
        kinds: { ...emptyKindStats(), ...(await storeRecord<KindStats[WzKind]>($, KINDS)) } as KindStats,
        xp: Number(await $.store.get(XP)) || 0,
        now: await $.clock.now(),
      })
      return { text: report }
    }
    const current = await read($, deck)
    return {
      text: `wartezeit: ${current.topic} (${current.cards.length} words, ${await read($, deckStatus)}) · mode ${await read($, mode)}. Commands: /wartezeit stats, /wartezeit mode <${MODES.join('|')}>.`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if ((await isChild($)) || e.props.hasSurvey || !e.props.isWorking) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const asked = await read($, question)
    if (!asked) return next(e)

    const view: View = {
      current: await read($, deck),
      status: await read($, deckStatus),
      gathered: await read($, signals),
      stats: await read($, summary),
      asked,
      given: await read($, answer),
      doing: await read($, activity),
      spin: SPINNER[(await read($, frame)) % SPINNER.length] ?? '✻',
      columns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
    }
    const elements: AnyElements = $.ui.resolve(e)
    return e.surface === 'desktop'
      ? drawDesktop($, elements as Elements['desktop'], view)
      : drawTerminal($, elements as Elements['terminal'], view)
  })
}
