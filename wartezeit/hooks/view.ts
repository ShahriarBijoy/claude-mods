import type { WzAnswer, WzDeck, WzQuestion, WzSignals, WzSummary } from '../types'
import { sourceLine } from './deck'
import { DAILY_GOAL, cardId, withArticle } from './game'

export const PURPLE = '#8B7CF6'
export const PURPLE_BG = '#3B3466'
export const AMBER = '#F5B841'
export const GREEN = '#3FB950'
export const GREEN_BG = '#2EA043'
export const ORANGE = '#F0883E'
export const ORANGE_BG = '#D9732B'
export const TILE_BG = '#2F2C42'
export const TILE_FG = '#ECEAF5'
export const WHITE = '#FFFFFF'

export type View = {
  current: WzDeck
  status: string
  gathered: WzSignals
  stats: WzSummary
  asked: WzQuestion
  given: WzAnswer | null
  doing: string
  spin: string
  columns: number
  maxRows: number
}

export const seenOf = (view: View) => {
  const seen = new Set(view.stats.seen)
  return `${view.current.cards.filter(card => seen.has(cardId(card))).length} of ${view.current.cards.length} words seen`
}

export const sourceText = (view: View): string => {
  const from = sourceLine(view.gathered)
  if (view.status === 'generating') return `Finding words for this session${from ? ` · from ${from}` : ''}`
  if (view.status.startsWith('failed')) return `Everyday words · session words failed (${view.status.slice(8)})`
  if (view.status === 'general') return 'Everyday words · session words arrive once the topic is clear'
  return `From ${from || 'this session'}`
}

export const feedbackOf = (view: View) => {
  if (!view.given) return null
  const right = view.asked.options[view.asked.correct] ?? ''
  const full = view.asked.kind === 'article' || view.asked.kind === 'sentence' ? withArticle(view.asked.card) : right
  return view.given.isCorrect ? { tone: GREEN, headline: `✓ Richtig! ${full}` } : { tone: ORANGE, headline: `✗ Fast! It's ${full}` }
}

export const tileTone = (view: View, option: number) => {
  if (!view.given) return { bg: TILE_BG, fg: TILE_FG }
  if (option === view.asked.correct) return { bg: GREEN_BG, fg: WHITE }
  if (option === view.given.picked) return { bg: ORANGE_BG, fg: WHITE }
  return { bg: TILE_BG, fg: TILE_FG }
}

export const fit = (text: string, cells: number) => (text.length > cells ? `${text.slice(0, Math.max(0, cells - 1))}…` : text)

export const goalBar = (today: number, cells: number) => {
  const filled = Math.round((Math.min(today, DAILY_GOAL) / DAILY_GOAL) * cells)
  return { filled: '━'.repeat(filled), empty: '─'.repeat(cells - filled) }
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const FONT = "font-family=\"ui-sans-serif, 'Segoe UI', system-ui, -apple-system, sans-serif\""

export const headerSvg = (view: View, width: number) => {
  const chip = fit(view.current.topic, 26)
  const chipW = Math.round(chip.length * 7.4 + 24)
  const barX = chipW + 18
  const barW = Math.max(80, Math.min(220, width - barX - 230))
  const fill = (Math.min(view.stats.today, DAILY_GOAL) / DAILY_GOAL) * barW
  const after = barX + barW + 12
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30" viewBox="0 0 ${width} 30" ${FONT}>`,
    `<style>.t{fill:#ECE9E2}.m{fill:#9A968E}.track{fill:#3A3835}@media (prefers-color-scheme: light){.t{fill:#2A2925}.m{fill:#77736B}.track{fill:#E6E2DA}}</style>`,
    `<rect x="0" y="3" width="${chipW}" height="24" rx="12" fill="${PURPLE}" fill-opacity="0.2"/>`,
    `<text x="${chipW / 2}" y="15" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="${PURPLE}">${escapeXml(chip)}</text>`,
    `<rect class="track" x="${barX}" y="12" width="${barW}" height="6" rx="3"/>`,
    fill > 0 ? `<rect x="${barX}" y="12" width="${Math.max(6, fill).toFixed(1)}" height="6" rx="3" fill="${PURPLE}"/>` : '',
    `<text class="m" x="${after}" y="15" dominant-baseline="central" font-size="12.5">${view.stats.today}/${DAILY_GOAL} today</text>`,
    `<text x="${after + 96}" y="15" dominant-baseline="central" font-size="13" font-weight="600" fill="${AMBER}">▲ ${view.stats.streak}</text>`,
    `<text x="${after + 140}" y="15" dominant-baseline="central" font-size="13" font-weight="600" fill="${PURPLE}">✦ ${view.stats.xp} XP</text>`,
    '</svg>',
  ].join('')
}

export const cardSvg = (view: View, width: number) => {
  const prompt = fit(view.asked.prompt, Math.floor(width / 12))
  const badgeX = view.asked.label.length * 5.9 + 8
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="58" viewBox="0 0 ${width} 58" ${FONT}>`,
    `<style>.t{fill:#F0EDE6}.m{fill:#9A968E}@media (prefers-color-scheme: light){.t{fill:#2A2925}.m{fill:#77736B}}</style>`,
    `<text class="m" x="0" y="11" dominant-baseline="central" font-size="12">${escapeXml(view.asked.label)}</text>`,
    view.asked.isNew
      ? `<rect x="${badgeX}" y="3" width="34" height="16" rx="8" fill="${PURPLE}"/><text x="${badgeX + 17}" y="11" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="${WHITE}">new</text>`
      : '',
    `<text class="t" x="0" y="40" dominant-baseline="central" font-size="22" font-weight="600">${escapeXml(prompt)}</text>`,
    '</svg>',
  ].join('')
}

export const feedbackSvg = (view: View, width: number) => {
  const feedback = feedbackOf(view)
  if (!feedback) return null
  const example = fit(`${view.asked.card.example_de} — ${view.asked.card.example_en}`, Math.floor((width - 28) / 6.6))
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="50" viewBox="0 0 ${width} 50" ${FONT}>`,
    `<style>.m{fill:#B8B4AC}@media (prefers-color-scheme: light){.m{fill:#5A5650}}</style>`,
    `<rect x="0" y="0" width="${width}" height="50" rx="10" fill="${feedback.tone}" fill-opacity="0.14"/>`,
    `<rect x="0" y="0" width="4" height="50" rx="2" fill="${feedback.tone}"/>`,
    `<text x="14" y="16" dominant-baseline="central" font-size="14" font-weight="700" fill="${feedback.tone}">${escapeXml(feedback.headline)}</text>`,
    `<text class="m" x="14" y="35" dominant-baseline="central" font-size="12.5">${escapeXml(example)}</text>`,
    '</svg>',
  ].join('')
}

