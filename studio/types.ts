// Thin re-export layer over TypeGen-generated types.
// Run `pnpm typegen` after changing the schema or GROQ queries.

import type {SKILLS_QUERY_RESULT, STATS_QUERY_RESULT} from './sanity.types'

/** A skill as returned by the Skills Explorer GROQ projection. */
export type Skill = SKILLS_QUERY_RESULT[number]

/** A stats row as returned by the Stats GROQ projection. */
export type SkillStats = STATS_QUERY_RESULT[number]

// Schema-level types (full documents, not query projections)
export type {
  Skill as SkillDocument,
  SkillReference,
  SkillStats as SkillStatsDocument,
} from './sanity.types'
