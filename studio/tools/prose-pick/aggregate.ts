import type {ProseTestSession, ProseCondition, ProseVote, ModelFamily} from './types'
import {modelFamily} from '../../utils/aiProviders'

/**
 * Per-prompt tally. Tracks A/B wins (regardless of model) plus a wins-
 * by-model-family breakdown for sessions where condition.modelId is set.
 *
 * Back-compat: for sessions with no modelId on conditions but with the
 * legacy `pair.aIsClaude` boolean, we fall back to a claude/gpt tally
 * to preserve historical reporting.
 */
export interface PromptTally {
  voters: number
  aWins: number
  bWins: number
  eq: number
  /** Wins per family — only populated when condition.modelId is present. */
  byFamily: Partial<Record<ModelFamily | 'other', number>>
  /** Legacy claude/gpt counts from aIsClaude fallback. Empty when modelId is used. */
  claude: number
  gpt: number
}

export interface SessionAggregate {
  totalVoters: number
  perPrompt: Record<string, PromptTally>
}

function familyForCondition(conditions: ProseCondition[], conditionId: string): ModelFamily | 'other' | null {
  const cond = conditions.find((c) => c.conditionId === conditionId)
  if (!cond || !cond.modelId) return null
  return modelFamily(cond.modelId) ?? 'other'
}

function emptyTally(): PromptTally {
  return {voters: 0, aWins: 0, bWins: 0, eq: 0, byFamily: {}, claude: 0, gpt: 0}
}

export function aggregateVotes(
  session: ProseTestSession,
  votes: ProseVote[],
): SessionAggregate {
  const perPrompt: Record<string, PromptTally> = {}
  const pairs = session.pairs ?? []
  const conditions = session.conditions ?? []

  for (const pair of pairs) {
    perPrompt[pair.promptId] = emptyTally()
  }

  for (const vote of votes) {
    const picks = vote.picks ?? []
    for (const pick of picks) {
      const pair = pairs.find((p) => p.promptId === pick.promptId)
      if (!pair) continue
      const tally = perPrompt[pair.promptId]
      tally.voters++

      if (pick.pick === 'EQ') {
        tally.eq++
        continue
      }

      const wonSide = pick.pick === 'A' ? pair.A : pair.B
      if (pick.pick === 'A') tally.aWins++
      else tally.bWins++

      // New path: tally by model family if condition.modelId is set
      const fam = familyForCondition(conditions, wonSide.conditionId)
      if (fam) {
        tally.byFamily[fam] = (tally.byFamily[fam] ?? 0) + 1
        continue
      }

      // Legacy fallback: aIsClaude boolean on the pair
      if (typeof pair.aIsClaude === 'boolean') {
        const aIsClaude = pair.aIsClaude
        if (pick.pick === 'A') {
          if (aIsClaude) tally.claude++
          else tally.gpt++
        } else {
          if (aIsClaude) tally.gpt++
          else tally.claude++
        }
      }
    }
  }

  return {totalVoters: votes.length, perPrompt}
}

/** For the personal-reveal table: which condition did this voter pick per prompt? */
export function resolveVoterReveal(
  session: ProseTestSession,
  vote: ProseVote,
): Array<{promptId: string; promptName: string; pick: 'A' | 'B' | 'EQ'; conditionLabel: string}> {
  const prompts = session.prompts ?? []
  const pairs = session.pairs ?? []
  const conditions = session.conditions ?? []
  const picks = vote.picks ?? []
  const promptNameById = new Map(prompts.map((p) => [p.id, p.name]))
  return picks.map((pickRow) => {
    const pair = pairs.find((p) => p.promptId === pickRow.promptId)
    let conditionLabel = '—'
    if (pair && pickRow.pick !== 'EQ') {
      const sideKey = pickRow.pick === 'A' ? 'A' : 'B'
      const cId = pair[sideKey].conditionId
      const cond = conditions.find((c) => c.conditionId === cId)
      conditionLabel = cond?.label || cId
    } else if (pickRow.pick === 'EQ') {
      conditionLabel = 'Roughly equivalent'
    }
    return {
      promptId: pickRow.promptId,
      promptName: promptNameById.get(pickRow.promptId) || pickRow.promptId,
      pick: pickRow.pick,
      conditionLabel,
    }
  })
}
