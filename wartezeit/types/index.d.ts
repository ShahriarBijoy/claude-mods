export type WzArticle = 'der' | 'die' | 'das'

export type WzCardType = 'noun' | 'verb' | 'adjective'

// `de` is the dictionary form: a noun without its article, a verb's infinitive, an
// adjective's base form. `cloze` is `example_de` with `de` replaced by "___".
export type WzCard = {
  type: WzCardType
  de: string
  article?: WzArticle
  en: string
  example_de: string
  example_en: string
  cloze?: string
}

export type WzDeck = { key: string; topic: string; cards: WzCard[] }

export type WzKind = 'vocab' | 'meaning' | 'article' | 'sentence'

export type WzMode = 'mixed' | WzKind

export type WzSource = 'new' | 'review' | 'practice'

export type WzQuestion = {
  card: WzCard
  kind: WzKind
  label: string
  prompt: string
  options: string[]
  correct: number
  isNew: boolean
  source: WzSource
}

export type WzAnswer = { picked: number; isCorrect: boolean }

export type WzSignals = { prompts: string[]; files: string[]; commands: string[] }

// What the band shows of the learner's record, kept in step with the store.
export type WzSummary = { today: number; streak: number; xp: number; seen: string[] }

declare module 'claude-code' {
  interface PluginState {
    wartezeit: {
      deck: WzDeck
      deckStatus: string
      signals: WzSignals
      question: WzQuestion | null
      answer: WzAnswer | null
      activity: string
      frame: number
      index: number
      mode: WzMode
      summary: WzSummary
      answeredThisTurn: number
    }
  }
}
