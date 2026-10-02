import type { WzArticle, WzCard, WzDeck, WzKind, WzMode, WzQuestion, WzSource } from '../types'

export const DAILY_GOAL = 20
export const XP_PER_CORRECT = 10
const DAY_MS = 24 * 60 * 60 * 1000
const ARTICLES: WzArticle[] = ['der', 'die', 'das']

export type Rng = () => number

// A small seeded generator, so a test can replay the choices a session made.
export const seededRng = (seed: number): Rng => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffle = <T>(items: readonly T[], rng: Rng): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

const pickSome = <T>(items: readonly T[], count: number, rng: Rng): T[] => shuffle(items, rng).slice(0, count)

export const cardId = (card: WzCard): string => `${card.type}:${card.de}`

export const withArticle = (card: WzCard): string => (card.type === 'noun' && card.article ? `${card.article} ${card.de}` : card.de)

// Cards -----------------------------------------------------------------------

// The other words a sentence gap could be confused with. A noun's distractors all have a
// different gender, so with the article the sentence keeps, only the answer is grammatical.
export const sentenceDistractors = (card: WzCard, pool: readonly WzCard[]): WzCard[] =>
  pool.filter(
    other =>
      other.type === card.type &&
      other.de !== card.de &&
      (card.type !== 'noun' || (other.article !== undefined && other.article !== card.article)),
  )

export const kindsFor = (card: WzCard, pool: readonly WzCard[]): WzKind[] => {
  const kinds: WzKind[] = ['vocab', 'meaning']
  if (card.type === 'noun' && card.article) kinds.push('article')
  if (card.cloze && sentenceDistractors(card, pool).length >= 2) kinds.push('sentence')
  return kinds
}

const supports = (card: WzCard, mode: WzMode, pool: readonly WzCard[]): boolean =>
  mode === 'mixed' || kindsFor(card, pool).includes(mode)

const LABELS: Record<WzKind, string> = {
  vocab: 'Translate into German',
  meaning: 'What does this mean?',
  article: 'der, die or das?',
  sentence: 'Fill the gap',
}

// One question about `card`: its options shuffled, the correct one's index kept. `pool` is
// where the other options come from (the session deck, then the general one).
export const buildQuestion = (
  card: WzCard,
  kind: WzKind,
  pool: readonly WzCard[],
  rng: Rng,
  meta: { isNew: boolean; source: WzSource },
): WzQuestion => {
  const resolved: WzKind = (kind === 'sentence' && !card.cloze) || (kind === 'article' && card.type !== 'noun') ? 'vocab' : kind
  return questionOf(card, resolved, pool, rng, meta)
}

const questionOf = (
  card: WzCard,
  kind: WzKind,
  pool: readonly WzCard[],
  rng: Rng,
  meta: { isNew: boolean; source: WzSource },
): WzQuestion => {
  const others = pool.filter(other => cardId(other) !== cardId(card))
  let correct: string
  let options: string[]
  let prompt: string

  if (kind === 'article') {
    prompt = card.de
    correct = card.article ?? 'der'
    options = [...ARTICLES]
  } else if (kind === 'meaning') {
    prompt = withArticle(card)
    correct = card.en
    options = [correct, ...pickSome([...new Set(others.map(other => other.en))].filter(en => en !== card.en), 3, rng)]
  } else if (kind === 'sentence' && card.cloze) {
    prompt = card.cloze
    correct = card.de
    options = [correct, ...pickSome(sentenceDistractors(card, pool).map(other => other.de), 3, rng)]
  } else {
    prompt = card.en
    correct = withArticle(card)
    // A noun's tile set always holds the same noun with a wrong article: the trap to learn from.
    const wrongArticle = card.type === 'noun' && card.article ? [`${pickSome(ARTICLES.filter(a => a !== card.article), 1, rng)[0]} ${card.de}`] : []
    const fill = pickSome(others.map(withArticle).filter(text => text !== correct), 3 - wrongArticle.length, rng)
    options = [correct, ...wrongArticle, ...fill]
  }

  const tiles = kind === 'article' ? options : shuffle(options, rng)
  return {
    card,
    kind,
    label: LABELS[kind],
    prompt,
    options: tiles,
    correct: tiles.indexOf(correct),
    isNew: meta.isNew,
    source: meta.source,
  }
}

export const chooseKind = (card: WzCard, mode: WzMode, pool: readonly WzCard[], rng: Rng): WzKind => {
  const kinds = kindsFor(card, pool)
  if (mode !== 'mixed' && kinds.includes(mode)) return mode
  return kinds[Math.floor(rng() * kinds.length)] ?? 'vocab'
}

// Spaced repetition --------------------------------------------------------------

export type Progress = {
  card: WzCard
  topic: string
  session: string
  box: number
  due: number
  right: number
  wrong: number
  lastSeen: number
}

// Leitner boxes 1–5: a right answer moves a card up a box, a wrong one back to the first.
// Days until a card in each box is due again.
export const BOX_DAYS = [0, 0, 1, 3, 7, 16] as const

export const leitner = (
  before: Progress | undefined,
  card: WzCard,
  isCorrect: boolean,
  context: { now: number; topic: string; session: string },
): Progress => {
  const box = isCorrect ? Math.min(5, (before?.box ?? 1) + 1) : 1
  return {
    card,
    topic: before?.topic ?? context.topic,
    session: before?.session ?? context.session,
    box,
    due: context.now + (BOX_DAYS[box] ?? 0) * DAY_MS,
    right: (before?.right ?? 0) + (isCorrect ? 1 : 0),
    wrong: (before?.wrong ?? 0) + (isCorrect ? 0 : 1),
    lastSeen: context.now,
  }
}

// Two of every five questions are review slots: 60% new words, 40% due reviews.
export const isReviewSlot = (index: number): boolean => index % 5 === 1 || index % 5 === 3

export type Pick = { card: WzCard; source: WzSource }

// The next card: in a review slot, the most overdue card from an earlier session; otherwise
// a word of this session's deck not seen before. Each falls back to the other, and with
// neither left, the deck's card seen longest ago.
export const pickNext = (input: {
  deck: WzDeck
  pool: readonly WzCard[]
  progress: Readonly<Record<string, Progress>>
  session: string
  now: number
  index: number
  mode: WzMode
  rng: Rng
}): Pick | null => {
  const { deck, pool, progress, session, now, index, mode, rng } = input
  const inDeck = deck.cards.filter(card => supports(card, mode, pool))
  const fresh = inDeck.filter(card => progress[cardId(card)] === undefined)
  const reviews = Object.values(progress)
    .filter(entry => entry.session !== session && entry.due <= now && supports(entry.card, mode, pool))
    .sort((a, b) => a.due - b.due)

  const review = reviews[0]
  const newCard = fresh.length > 0 ? fresh[Math.floor(rng() * fresh.length)] : undefined
  if (isReviewSlot(index) && review) return { card: review.card, source: 'review' }
  if (newCard) return { card: newCard, source: 'new' }
  if (review) return { card: review.card, source: 'review' }

  const practice = [...inDeck].sort((a, b) => (progress[cardId(a)]?.lastSeen ?? 0) - (progress[cardId(b)]?.lastSeen ?? 0))[0]
  return practice ? { card: practice, source: 'practice' } : null
}

// Days, streaks and stats ---------------------------------------------------------

export type Day = { correct: number; answered: number }
export type KindStats = Record<WzKind, { right: number; wrong: number }>

export const dayKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Days in a row with at least one right answer, ending today, or yesterday while today has
// none yet: the streak is not broken until the day is over.
export const streakOf = (days: Readonly<Record<string, Day>>, now: number): number => {
  const practised = (ms: number) => (days[dayKey(ms)]?.correct ?? 0) > 0
  let at = practised(now) ? now : now - DAY_MS
  let streak = 0
  while (practised(at)) {
    streak++
    at -= DAY_MS
  }
  return streak
}

export const emptyKindStats = (): KindStats => ({
  vocab: { right: 0, wrong: 0 },
  meaning: { right: 0, wrong: 0 },
  article: { right: 0, wrong: 0 },
  sentence: { right: 0, wrong: 0 },
})

const percent = (right: number, wrong: number): string =>
  right + wrong === 0 ? '–' : `${Math.round((100 * right) / (right + wrong))}%`

// A card counts as learned from the third box on: answered right at least twice in a row.
const LEARNED_BOX = 3

export const statsReport = (input: {
  progress: Readonly<Record<string, Progress>>
  days: Readonly<Record<string, Day>>
  kinds: KindStats
  xp: number
  now: number
}): string => {
  const { progress, days, kinds, xp, now } = input
  const entries = Object.values(progress)
  const today = days[dayKey(now)]?.correct ?? 0
  const lines = [
    `Streak: ${streakOf(days, now)} days · today ${today}/${DAILY_GOAL} · ${xp} XP · ${entries.length} words seen`,
    '',
    'Accuracy by card type:',
    ...(Object.keys(kinds) as WzKind[]).map(kind => {
      const { right, wrong } = kinds[kind]
      return `  ${kind.padEnd(9)} ${percent(right, wrong).padStart(4)}  (${right} of ${right + wrong})`
    }),
  ]

  const weakest = entries
    .filter(entry => entry.wrong > 0)
    .sort((a, b) => a.right / (a.right + a.wrong) - b.right / (b.right + b.wrong) || b.wrong - a.wrong)
    .slice(0, 10)
  lines.push('', 'Weakest words:')
  if (weakest.length === 0) lines.push('  none yet')
  for (const entry of weakest) {
    lines.push(`  ${withArticle(entry.card).padEnd(26)} ${percent(entry.right, entry.wrong).padStart(4)}  ${entry.card.en}`)
  }

  const topics = new Map<string, { learned: number; seen: number }>()
  for (const entry of entries) {
    const topic = topics.get(entry.topic) ?? { learned: 0, seen: 0 }
    topic.seen++
    if (entry.box >= LEARNED_BOX) topic.learned++
    topics.set(entry.topic, topic)
  }
  lines.push('', 'Words learned per topic:')
  if (topics.size === 0) lines.push('  none yet')
  for (const [topic, { learned, seen }] of [...topics].sort((a, b) => b[1].learned - a[1].learned)) {
    lines.push(`  ${topic.padEnd(26)} ${learned} learned of ${seen} seen`)
  }
  return lines.join('\n')
}
