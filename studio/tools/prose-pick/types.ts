import type {ModelFamily} from '../../utils/aiProviders'

export interface ProseCondition {
  _key?: string
  conditionId: string
  label: string
  /** Stable model id from the shared MODELS registry. Optional for old sessions. */
  modelId?: string
  /** References to skill docs loaded for this condition. Optional. */
  skills?: Array<{_ref: string; _type: 'reference'}>
  /** Freeform notes (temperature, system overrides, etc.). */
  notes?: string
}

export interface ProsePrompt {
  _key?: string
  id: string
  name: string
  text: string
}

export interface ProsePairSide {
  conditionId: string
  text: string
}

export interface ProsePair {
  _key?: string
  promptId: string
  A: ProsePairSide
  B: ProsePairSide
  /** @deprecated Use condition.modelId to derive family. Kept for old sessions. */
  aIsClaude?: boolean
}

export interface ProseTestSession {
  _id: string
  _type: 'proseTestSession'
  title: string
  description?: string
  status: 'open' | 'closed'
  createdAt?: string
  createdBy?: string
  conditions: ProseCondition[]
  prompts: ProsePrompt[]
  pairs: ProsePair[]
}

export interface ProseVotePick {
  _key?: string
  promptId: string
  pick: 'A' | 'B' | 'EQ'
  note?: string
}

export interface ProseVote {
  _id: string
  _type: 'proseVote'
  sessionId: string
  voter: string
  voterId?: string
  submittedAt?: string
  picks: ProseVotePick[]
}

/** Re-export so callers don't have to import from utils. */
export type {ModelFamily}
