import type { WzCard, WzDeck, WzSignals } from '../types'
import { cardId } from './game'
import { genderOf } from './nouns'

// Signals -----------------------------------------------------------------------

const STOP = new Set(
  `the and for with this that from into onto make makes please can could would should will you your
  me my our we they them their it its is are was were be been have has had not but also just then
  than when what where which while why how all any some more most very much many few each every
  here there about after before again need needs want wants like using use used get got set let lets
  add adds fix fixes change changes update updates new old file files code line lines thing things
  way still even only really maybe sure okay ok yes now today help work works working done do does
  did one two three first last next same other another something anything everything
  src lib dist build index main app apps test tests spec specs hooks utils util common core types
  node_modules json yaml yml tsx jsx mjs cjs md txt users home tmp temp appdata local roaming`
    .split(/\s+/)
    .filter(Boolean),
)

const words = (text: string): string[] =>
  text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-zäöüß]+/)
    .filter(word => word.length >= 4 && !STOP.has(word))

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

const pathWords = (path: string): string[] => {
  const parts = path.split(/[\\/]/).filter(Boolean).slice(-3)
  return parts.flatMap(part => words(part.replace(/\.[a-z0-9]+$/i, '')))
}

const commandName = (command: string): string => {
  const [program = '', sub = ''] = command.trim().split(/\s+/)
  const name = baseName(program).replace(/\.(exe|cmd|bat)$/i, '')
  return /^[a-z][\w-]*$/i.test(sub) && ['git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'docker', 'kubectl', 'cargo', 'go', 'gh'].includes(name)
    ? `${name} ${sub}`
    : name
}

export const addSignal = (signals: WzSignals, kind: keyof WzSignals, value: string): WzSignals => {
  const clean = kind === 'commands' ? commandName(value) : value.trim()
  if (!clean || signals[kind].includes(clean)) return signals
  return { ...signals, [kind]: [...signals[kind], clean].slice(-40) }
}

// A topic needs a prompt with some words in it and a couple of files or commands, or a good
// run of files and commands alone.
export const hasEnoughSignals = (signals: WzSignals): boolean => {
  const tools = signals.files.length + signals.commands.length
  const promptWords = signals.prompts.reduce((count, prompt) => count + words(prompt).length, 0)
  return (promptWords >= 3 && tools >= 2) || tools >= 6
}

// The three strongest words across the signals, in alphabetical order: the same work in a
// later session lands on the same key, and its cached deck, without asking a model.
export const topicKey = (signals: WzSignals): string => {
  const scores = new Map<string, number>()
  const add = (word: string, weight: number) => scores.set(word, (scores.get(word) ?? 0) + weight)
  for (const prompt of signals.prompts) for (const word of words(prompt)) add(word, 2)
  for (const file of signals.files) for (const word of pathWords(file)) add(word, 1)
  for (const command of signals.commands) for (const word of words(command)) add(word, 1)
  const top = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([word]) => word)
  return top.length > 0 ? top.sort().join('-') : 'general'
}

const clip = (text: string, length: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat
}

const listed = (items: string[], max: number): string =>
  items.length > max ? `${items.slice(0, max).join(', ')} +${items.length - max}` : items.join(', ')

// The line under the header naming what the topic was read from.
export const sourceLine = (signals: WzSignals): string => {
  const parts: string[] = []
  const prompt = signals.prompts[signals.prompts.length - 1]
  if (prompt) parts.push(`prompt "${clip(prompt, 32)}"`)
  if (signals.files.length > 0) parts.push(`files ${listed([...new Set(signals.files.map(baseName))].reverse(), 3)}`)
  if (signals.commands.length > 0) parts.push(`commands ${listed([...signals.commands].reverse(), 3)}`)
  return parts.join(' · ')
}

// The model call ------------------------------------------------------------------

export const SYSTEM_PROMPT =
  'You write German vocabulary decks for an English-speaking software developer learning German at A1 to B1 level. ' +
  'Answer only through the structured output tool, in valid German with correct grammatical gender.'

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    type: { enum: ['noun', 'verb', 'adjective'] },
    de: { type: 'string' },
    article: { enum: ['der', 'die', 'das'] },
    en: { type: 'string' },
    example_de: { type: 'string' },
    example_en: { type: 'string' },
    cloze: { type: 'string' },
  },
  required: ['type', 'de', 'en', 'example_de', 'example_en', 'cloze'],
} as const

export const DECK_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    cards: { type: 'array', items: CARD_SCHEMA },
  },
  required: ['topic', 'cards'],
} as const

export const deckPrompt = (signals: WzSignals): string =>
  [
    'Here is what a developer is working on right now:',
    ...signals.prompts.slice(-3).map(prompt => `- request: ${clip(prompt, 300)}`),
    signals.files.length > 0 ? `- files: ${[...new Set(signals.files.map(baseName))].slice(-15).join(', ')}` : '',
    signals.commands.length > 0 ? `- commands: ${signals.commands.slice(-8).join(', ')}` : '',
    '',
    'Make a German vocabulary deck about this topic:',
    '- topic: a short English label for the topic, at most 24 characters, like "Login & sessions".',
    '- About 14 domain words of the topic and about 8 everyday words around it (verbs, adjectives, common nouns), A1 to B1.',
    '- de is the dictionary form: a noun in the singular without its article (put the article in "article"), a verb in the infinitive, an adjective in its base form.',
    '- example_de is a short German sentence (at most 9 words) that contains de exactly as written; example_en translates it.',
    '- cloze is example_de with de replaced by ___ . For a noun, keep its article in the sentence right before the gap and make the noun the subject in the singular. For a verb, put the infinitive after a modal verb. For an adjective, use it after "ist" or "sind".',
  ]
    .filter(line => line !== '')
    .join('\n')

// Sonnet 5.5 over Haiku: on the same session it wrote a deck in 25 s for $0.04 with one card
// dropped, where Haiku took 109 s and $0.07 and lost four to the gender check.
export const DECK_MODEL = 'claude-sonnet-5-5'

export const claudeArgv = (signals: WzSignals): string[] => [
  'claude',
  '-p',
  '--model',
  DECK_MODEL,
  '--output-format',
  'json',
  '--tools',
  '',
  '--no-session-persistence',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--system-prompt',
  SYSTEM_PROMPT,
  '--json-schema',
  JSON.stringify(DECK_SCHEMA),
  deckPrompt(signals),
]

type RawDeck = { topic?: unknown; cards?: unknown }

// `claude -p --output-format json` prints the run's messages, the last being the result,
// with `--json-schema`'s answer as `structured_output` (an older build printed the result
// object alone, its answer as JSON text in `result`).
export const parseClaudeOutput = (stdout: string): RawDeck => {
  const parsed: unknown = JSON.parse(stdout)
  const messages = Array.isArray(parsed) ? parsed : [parsed]
  const result = messages.find(message => (message as { type?: unknown })?.type === 'result') as
    | { is_error?: boolean; result?: unknown; structured_output?: unknown }
    | undefined
  if (!result) throw new Error('no result message in the claude output')
  if (result.is_error) throw new Error(`claude reported an error: ${String(result.result).slice(0, 200)}`)
  if (result.structured_output && typeof result.structured_output === 'object') return result.structured_output as RawDeck
  if (typeof result.result === 'string') return JSON.parse(result.result.slice(result.result.indexOf('{'))) as RawDeck
  throw new Error('the claude result has no deck')
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export type Validation = { cards: WzCard[]; dropped: string[] }

// Every card the model wrote, kept only when it is whole: a noun's article must agree with
// the bundled gender list, and a cloze must be its example with exactly the word cut out
// (else the card stays, without a sentence question).
export const validateCards = (raw: unknown): Validation => {
  const cards: WzCard[] = []
  const dropped: string[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(raw) ? raw : []) {
    const item = entry as Record<string, unknown>
    const type = item.type
    const de = text(item.de)
    const en = text(item.en)
    const example_de = text(item.example_de)
    const example_en = text(item.example_en)
    if ((type !== 'noun' && type !== 'verb' && type !== 'adjective') || !de || !en || !example_de || !example_en) {
      dropped.push(`${de || '?'}: incomplete`)
      continue
    }
    const card: WzCard = { type, de, en, example_de, example_en }
    if (type === 'noun') {
      const article = text(item.article)
      const listed = genderOf(de)
      if (de.includes(' ') || (article !== 'der' && article !== 'die' && article !== 'das')) {
        dropped.push(`${de}: no article`)
        continue
      }
      if (listed !== article) {
        dropped.push(listed ? `${article} ${de}: the list says ${listed}` : `${article} ${de}: not in the gender list`)
        continue
      }
      card.article = article
    }
    const cloze = text(item.cloze)
    if (cloze.split('___').length === 2 && cloze.replace('___', de) === example_de) card.cloze = cloze
    if (seen.has(cardId(card))) continue
    seen.add(cardId(card))
    cards.push(card)
  }
  return { cards, dropped }
}

// A deck needs enough words for a game; fewer and the session keeps the general deck.
export const MIN_DECK = 8

export const deckFrom = (raw: RawDeck, key: string): { deck: WzDeck | null; dropped: string[] } => {
  const { cards, dropped } = validateCards(raw.cards)
  const topic = clip(text(raw.topic) || key.replace(/-/g, ' '), 24)
  return { deck: cards.length >= MIN_DECK ? { key, topic, cards } : null, dropped }
}
