import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { WzCard, WzDeck } from '../types'
import { addSignal, deckFrom, hasEnoughSignals, parseClaudeOutput, topicKey, validateCards } from '../hooks/deck'
import { buildQuestion, cardId, isReviewSlot, leitner, pickNext, seededRng, streakOf, dayKey } from '../hooks/game'
import type { Progress } from '../hooks/game'
import { GENERAL_DECK } from '../hooks/general'
import { genderOf } from '../hooks/nouns'

const NOW = new Date(2026, 9, 2, 12).getTime()
const DAY = 24 * 60 * 60 * 1000

const noun = (article: 'der' | 'die' | 'das', de: string, en: string, example_de: string): Record<string, string> => ({
  type: 'noun',
  article,
  de,
  en,
  example_de,
  example_en: `(${en})`,
  cloze: example_de.replace(de, '___'),
})

// What Haiku answers for a login session: nine good cards, a noun with the wrong article and
// one the gender list cannot place.
const LOGIN_CARDS = [
  noun('die', 'Sitzung', 'session', 'Die Sitzung läuft gleich ab.'),
  noun('das', 'Passwort', 'password', 'Das Passwort ist zu kurz.'),
  noun('der', 'Benutzer', 'user', 'Der Benutzer meldet sich an.'),
  noun('die', 'Anmeldung', 'login', 'Die Anmeldung hat geklappt.'),
  noun('der', 'Schlüssel', 'key', 'Der Schlüssel ist geheim.'),
  noun('der', 'Server', 'server', 'Der Server antwortet nicht.'),
  noun('die', 'Datenbank', 'database', 'Die Datenbank ist voll.'),
  noun('die', 'Datenbankverbindung', 'database connection', 'Die Datenbankverbindung steht.'),
  { type: 'verb', de: 'anmelden', en: 'to log in', example_de: 'Ich möchte mich jetzt anmelden.', example_en: 'I want to log in now.', cloze: 'Ich möchte mich jetzt ___.' },
  noun('der', 'Datei', 'file', 'Der Datei fehlt.'),
  noun('die', 'Blorp', 'blorp', 'Die Blorp ist da.'),
]

const claudeOutput = (cards: unknown[] = LOGIN_CARDS) =>
  JSON.stringify([
    { type: 'system', subtype: 'init' },
    { type: 'result', is_error: false, result: '', structured_output: { topic: 'Login & sessions', cards } },
  ])

describe('gender list and decks', () => {
  test('every noun of the bundled deck agrees with the gender list, and every cloze is its example', () => {
    for (const card of GENERAL_DECK.cards) {
      if (card.type === 'noun') expect(genderOf(card.de), card.de).toBe(card.article)
      expect(card.cloze?.replace('___', card.de), card.de).toBe(card.example_de)
    }
  })

  test('a compound takes the gender of its last noun', () => {
    expect(genderOf('Datenbankverbindung')).toBe('die')
    expect(genderOf('Sitzungsschlüssel')).toBe('der')
    expect(genderOf('Benutzerkonto')).toBe('das')
    expect(genderOf('Blorp')).toBeUndefined()
  })

  test('a noun whose article disagrees with the list, or that the list cannot place, is dropped', () => {
    const { cards, dropped } = validateCards(LOGIN_CARDS)
    expect(cards.map(card => card.de)).not.toContain('Datei')
    expect(cards.map(card => card.de)).not.toContain('Blorp')
    expect(dropped).toEqual(['der Datei: the list says die', 'die Blorp: not in the gender list'])
    expect(cards).toHaveLength(9)
  })

  test('a cloze that is not its example with the word cut out is left off the card', () => {
    const { cards } = validateCards([{ ...noun('die', 'Sitzung', 'session', 'Die Sitzung endet.'), cloze: 'Die ___ endet bald.' }])
    expect(cards[0]?.cloze).toBeUndefined()
  })

  test('the claude output is read as a message list or as a lone result', () => {
    expect(parseClaudeOutput(claudeOutput()).topic).toBe('Login & sessions')
    expect(parseClaudeOutput(JSON.stringify({ type: 'result', result: '{"topic":"x","cards":[]}' })).topic).toBe('x')
    expect(() => parseClaudeOutput(JSON.stringify([{ type: 'result', is_error: true, result: 'boom' }]))).toThrow('boom')
  })

  test('a deck with too few valid cards is refused', () => {
    expect(deckFrom({ topic: 'x', cards: LOGIN_CARDS.slice(0, 3) }, 'k').deck).toBeNull()
  })
})

describe('topic signals', () => {
  test('the same signals in another order land on the same key', () => {
    let a = { prompts: [], files: [], commands: [] } as { prompts: string[]; files: string[]; commands: string[] }
    let b = a
    a = addSignal(a, 'prompts', 'Refactor the login session handling')
    a = addSignal(a, 'files', 'src/auth/session.ts')
    a = addSignal(a, 'files', 'src/auth/login.ts')
    b = addSignal(b, 'files', 'src/auth/login.ts')
    b = addSignal(b, 'files', 'src/auth/session.ts')
    b = addSignal(b, 'prompts', 'Refactor the login session handling')
    expect(topicKey(a)).toBe(topicKey(b))
    expect(topicKey(a)).toContain('session')
    expect(hasEnoughSignals(a)).toBe(true)
    expect(hasEnoughSignals(addSignal({ prompts: [], files: [], commands: [] }, 'prompts', 'hi there'))).toBe(false)
  })

  test('a command is kept as its program, and its subcommand for the common tools', () => {
    const signals = addSignal(addSignal({ prompts: [], files: [], commands: [] }, 'commands', 'git status --short'), 'commands', 'C:\\bin\\latexmk.exe -pdf main.tex')
    expect(signals.commands).toEqual(['git status', 'latexmk'])
  })
})

describe('questions', () => {
  const sessionDeck = deckFrom({ topic: 'Login & sessions', cards: LOGIN_CARDS }, 'login').deck as WzDeck
  const pool = [...sessionDeck.cards, ...GENERAL_DECK.cards]
  const nouns = pool.filter(card => card.type === 'noun')

  test('a sentence gap for a noun offers only nouns of another gender, so one option is grammatical', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const card of nouns) {
        const q = buildQuestion(card, 'sentence', pool, seededRng(seed), { isNew: true, source: 'new' })
        expect(q.kind).toBe('sentence')
        expect(q.options[q.correct]).toBe(card.de)
        const articles = q.options.map(option => pool.find(other => other.type === 'noun' && other.de === option)?.article)
        expect(articles.filter(article => article === card.article), `${card.de}: ${q.options.join(', ')}`).toHaveLength(1)
        expect(articles.every(article => article !== undefined)).toBe(true)
      }
    }
  })

  test('a noun vocab question offers the same noun with a wrong article', () => {
    const card = nouns[0] as WzCard
    const q = buildQuestion(card, 'vocab', pool, seededRng(3), { isNew: false, source: 'new' })
    expect(q.options[q.correct]).toBe(`${card.article} ${card.de}`)
    expect(q.options.filter(option => option.endsWith(` ${card.de}`))).toHaveLength(2)
    expect(q.options).toHaveLength(4)
  })

  test('an article question asks der, die or das, and never about a verb', () => {
    const card = nouns[1] as WzCard
    expect(buildQuestion(card, 'article', pool, seededRng(1), { isNew: false, source: 'new' }).options).toEqual(['der', 'die', 'das'])
    const verb = pool.find(other => other.type === 'verb') as WzCard
    expect(buildQuestion(verb, 'article', pool, seededRng(1), { isNew: false, source: 'new' }).kind).toBe('vocab')
  })
})

describe('the question mix', () => {
  const many = (prefix: string, count: number): WzCard[] =>
    Array.from({ length: count }, (_, i) => ({ type: 'adjective', de: `${prefix}${i}`, en: `${prefix} ${i}`, example_de: '-', example_en: '-' }))

  const run = (deck: WzDeck, progress: Record<string, Progress>, picks: number) => {
    const sources: string[] = []
    for (let index = 0; index < picks; index++) {
      const picked = pickNext({ deck, pool: deck.cards, progress, session: 'now', now: NOW, index, mode: 'mixed', rng: seededRng(index + 1) })
      if (!picked) break
      sources.push(picked.source)
      progress[cardId(picked.card)] = leitner(progress[cardId(picked.card)], picked.card, true, { now: NOW, topic: 't', session: 'now' })
    }
    return sources
  }

  test('60% new words of this session, 40% due reviews from earlier ones', () => {
    const deck: WzDeck = { key: 'k', topic: 't', cards: many('neu', 80) }
    const progress: Record<string, Progress> = {}
    for (const card of many('alt', 60)) {
      progress[cardId(card)] = { card, topic: 'old', session: 'earlier', box: 2, due: NOW - DAY, right: 1, wrong: 0, lastSeen: NOW - 2 * DAY }
    }
    const sources = run(deck, progress, 100)
    expect(sources.filter(source => source === 'new')).toHaveLength(60)
    expect(sources.filter(source => source === 'review')).toHaveLength(40)
    expect(sources.slice(0, 5)).toEqual(['new', 'review', 'new', 'review', 'new'])
  })

  test('with no reviews due, the review slots fill with new words', () => {
    const deck: WzDeck = { key: 'k', topic: 't', cards: many('neu', 20) }
    const notDue = many('alt', 5)
    const progress: Record<string, Progress> = {}
    for (const card of notDue) progress[cardId(card)] = { card, topic: 'old', session: 'earlier', box: 4, due: NOW + 3 * DAY, right: 3, wrong: 0, lastSeen: NOW }
    expect(run(deck, progress, 10)).toEqual(Array(10).fill('new'))
  })

  test("this session's own cards are never served as reviews", () => {
    expect(isReviewSlot(1) && isReviewSlot(3) && !isReviewSlot(0) && !isReviewSlot(2) && !isReviewSlot(4)).toBe(true)
    const card = many('neu', 1)[0] as WzCard
    const progress = { [cardId(card)]: { card, topic: 't', session: 'now', box: 1, due: NOW - DAY, right: 0, wrong: 1, lastSeen: NOW } }
    expect(pickNext({ deck: { key: 'k', topic: 't', cards: [card] }, pool: [card], progress, session: 'now', now: NOW, index: 1, mode: 'mixed', rng: seededRng(1) })?.source).toBe('practice')
  })

  test('Leitner: right moves a card up a box and pushes it out, wrong sends it back to the first', () => {
    const card = many('w', 1)[0] as WzCard
    const ctx = { now: NOW, topic: 't', session: 's' }
    const once = leitner(undefined, card, true, ctx)
    const twice = leitner(once, card, true, ctx)
    expect([once.box, twice.box]).toEqual([2, 3])
    expect(twice.due).toBe(NOW + 3 * DAY)
    expect(leitner(twice, card, false, ctx)).toMatchObject({ box: 1, due: NOW, right: 2, wrong: 1 })
  })

  test('a streak counts days with a right answer, and survives until today is over', () => {
    const days = { [dayKey(NOW - DAY)]: { correct: 3, answered: 4 }, [dayKey(NOW - 2 * DAY)]: { correct: 1, answered: 1 } }
    expect(streakOf(days, NOW)).toBe(2)
    expect(streakOf({ ...days, [dayKey(NOW)]: { correct: 1, answered: 1 } }, NOW)).toBe(3)
    expect(streakOf({ [dayKey(NOW - 3 * DAY)]: { correct: 1, answered: 1 } }, NOW)).toBe(0)
  })
})

// The engine, beneath the plugin ----------------------------------------------------

const BAND = (surface: 'terminal' | 'desktop', props: { isWorking?: boolean; maxRows?: number } = {}) => ({
  plugin: 'wartezeit',
  surface,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: props.isWorking ?? true,
    maxRows: props.maxRows ?? 12,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: props.maxRows ?? 12 },
    view: {},
  },
})

type World = { runs: Array<{ argv: readonly string[]; env?: Record<string, string> }>; toasts: string[]; commands: string[]; store: Record<string, unknown> }

const world = (on: On, options: { output?: string; store?: Record<string, unknown> } = {}): World => {
  const state: World = { runs: [], toasts: [], commands: [], store: { ...options.store } }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-now' }))
  on('command.register', (_$, e) => (state.commands.push(e.name), { value: { command: e.name } }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }) as never)
  // What the engine draws when the plugin passes: an empty box.
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => (state.toasts.push(e.text), { value: undefined }))
  on('store.get', (_$, e) => ({ value: state.store[e.key] }))
  on('store.set', (_$, e) => ((state.store[e.key] = JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.keys', () => ({ value: Object.keys(state.store) }))
  on('process.run', (_$, e) => {
    state.runs.push({ argv: e.argv, env: e.init?.env })
    return { value: { exitCode: 0, stdout: options.output ?? claudeOutput(), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return state
}

const start = ($: Engine) => $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
const prompt = ($: Engine, text: string) => $.prompt.submit({ text, wait: false } as never)
const turn = ($: Engine, durationMs = 8000) =>
  $.turn.complete({ answer: '', durationMs, isAborted: false, turnId: 't', reason: 'answer' })
const command = ($: Engine, args: string) =>
  $.command.run({ command: 'wartezeit', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
// In article mode the prompt is the noun, so the gender list says which tile is right.
const ARTICLES = ['der', 'die', 'das']
const NOUNS = new Set(GENERAL_DECK.cards.filter(card => card.type === 'noun').map(card => card.de))
const articleTiles = async (ui: { findAll: (query: { type: string }) => Promise<Array<{ text: string }>> }) => {
  const noun = (await ui.findAll({ type: 'Text' })).map(text => text.text.trim()).find(text => NOUNS.has(text)) ?? ''
  const correct = ARTICLES.indexOf(genderOf(noun) ?? '')
  return { noun, correct, wrong: (correct + 1) % 3 }
}

describe('wartezeit in a session', () => {
  test('the game shows only while Claude works, colours the answer and moves on after two seconds', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, {})
    const state = world(on)
    await start($)
    await command($, 'mode article')
    await prompt($, 'hello')

    for (const surface of ['terminal', 'desktop'] as const) {
      const idle = await $.ui.mount(BAND(surface, { isWorking: false }))
      expect(await idle.find({ key: 'answer:0' })).toBeUndefined()
      await idle.unmount()
    }

    const ui = await $.ui.mount(BAND('terminal'))
    const first = await articleTiles(ui)
    expect(first.correct).toBeGreaterThanOrEqual(0)
    await ui.press({ key: `answer:${first.wrong}` })
    expect((await ui.find({ type: 'Text', text: /Fast! It's/ }))?.props.color).toBe('#F0883E')
    expect((await ui.find({ key: `tile:${first.correct}` }))?.props.backgroundColor).toBe('#2EA043')
    expect((await ui.find({ key: `tile:${first.wrong}` }))?.props.backgroundColor).toBe('#D9732B')
    const card = GENERAL_DECK.cards.find(one => one.de === first.noun) as WzCard
    expect(await ui.find({ type: 'Text', text: card.example_de })).toBeDefined()
    expect(await ui.find({ key: 'answer:0' })).toBeUndefined()

    await clock.advance(2000)
    const second = await articleTiles(ui)
    expect(second.noun).not.toBe(first.noun)
    await ui.press({ key: `answer:${second.correct}` })
    expect(await ui.find({ type: 'Text', text: /Richtig!/ })).toBeDefined()
    expect(state.store['xp']).toBe(10)
    expect(Object.keys(state.store['progress'] as object)).toHaveLength(2)

    await turn($)
    expect(state.toasts).toEqual(['Claude is done · 1/20 today · streak 1'])
  })

  test('enough signals generate a session deck with claude -p once, and a repeated topic uses the cache', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, {})
    const state = world(on)
    await start($)
    await prompt($, 'Refactor the login session handling')
    await $.tool.call({ tool: 'Read', file_path: 'src/auth/session.ts' } as never)
    await $.tool.call({ tool: 'Read', file_path: 'src/auth/login.ts' } as never)
    await clock.advance(10)

    expect(state.runs).toHaveLength(1)
    const [run] = state.runs
    expect(run?.argv.slice(0, 6)).toEqual(['claude', '-p', '--model', 'claude-sonnet-5-5', '--output-format', 'json'])
    expect(run?.env).toEqual({ WARTEZEIT_CHILD: '1' })
    const cached = Object.keys(state.store).filter(key => key.startsWith('deck:'))
    expect(cached).toHaveLength(1)
    expect((state.store[cached[0] as string] as WzDeck).cards.map(card => card.de)).not.toContain('Datei')

    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await clock.advance(10)
    expect(state.runs).toHaveLength(1)

    const ui = await $.ui.mount(BAND('desktop'))
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Login & sessions')
  })

  test('a later session with the same topic takes the cached deck without calling claude', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, {})
    const signals = addSignal(addSignal(addSignal({ prompts: [], files: [], commands: [] }, 'prompts', 'Refactor the login session handling'), 'files', 'src/auth/session.ts'), 'files', 'src/auth/login.ts')
    const deck = deckFrom({ topic: 'Login & sessions', cards: LOGIN_CARDS }, topicKey(signals)).deck as WzDeck
    const state = world(on, { store: { [`deck:${deck.key}`]: deck } })
    await start($)
    await prompt($, 'Refactor the login session handling')
    await $.tool.call({ tool: 'Read', file_path: 'src/auth/session.ts' } as never)
    await $.tool.call({ tool: 'Read', file_path: 'src/auth/login.ts' } as never)
    await clock.advance(10)
    expect(state.runs).toHaveLength(0)
    const ui = await $.ui.mount(BAND('desktop'))
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Login & sessions')
  })

  test('inside its own claude -p run the mod does nothing', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, { WARTEZEIT_CHILD: '1' })
    const state = world(on)
    await start($)
    await prompt($, 'Refactor the login session handling')
    await $.tool.call({ tool: 'Read', file_path: 'src/auth/session.ts' } as never)
    await $.tool.call({ tool: 'Read', file_path: 'src/auth/login.ts' } as never)
    await clock.advance(10)
    await turn($)
    expect(state.commands).toEqual([])
    expect(state.runs).toEqual([])
    expect(state.toasts).toEqual([])
    const ui = await $.ui.mount(BAND('terminal'))
    expect(await ui.find({ key: 'answer:0' })).toBeUndefined()
  })

  test('/wartezeit mode article asks articles, and /wartezeit stats reports the record', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.env(on, {})
    const state = world(on)
    await start($)
    expect(state.commands).toEqual(['wartezeit'])
    expect((await command($, 'mode article'))?.text).toBe('wartezeit mode: article.')
    expect(state.store['mode']).toBe('article')
    await prompt($, 'hello')
    const ui = await $.ui.mount(BAND('terminal'))
    expect(await ui.find({ type: 'Text', text: 'der, die or das?' })).toBeDefined()
    await ui.press({ key: `answer:${(await articleTiles(ui)).correct}` })
    const stats = String((await command($, 'stats'))?.text)
    expect(stats).toContain('Streak: 1 days · today 1/20 · 10 XP')
    expect(stats).toMatch(/article\s+100%/)
    expect((await command($, 'mode nonsense'))?.text).toContain('Modes: mixed, vocab, meaning, article, sentence')
  })

  test('a short band keeps the card and its answers, dropping the header and the source line', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.env(on, {})
    world(on)
    await start($)
    await prompt($, 'hello')
    const roomy = await $.ui.mount(BAND('terminal'))
    expect(await roomy.find({ type: 'Text', text: /XP/ })).toBeDefined()
    await roomy.unmount()
    const tight = await $.ui.mount(BAND('terminal', { maxRows: 4 }))
    expect(await tight.find({ type: 'Text', text: /XP/ })).toBeUndefined()
    expect(await tight.find({ key: 'answer:0' })).toBeDefined()
  })
})
