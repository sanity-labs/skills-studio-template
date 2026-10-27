/**
 * Prompts an author can copy into an AI agent connected to the Sanity MCP, to
 * make a change the overlap check suggests.
 *
 * Every prompt names the project, dataset and document ids, so the agent edits
 * the right documents without searching, and every prompt keeps the change in
 * a draft for the author to review — the agent never publishes, and a merge is
 * only ever proposed, never carried out.
 */
import {SANITY_PROJECT_ID, SANITY_DATASET} from './constants'
import {RULES_BY_ID} from './descriptionRules'

export type SkillRef = {id: string; name: string}

export type PairFix = 'merge' | 'contradict' | 'extract' | 'clarify'

const PREAMBLE = `Use the Sanity MCP with project ${SANITY_PROJECT_ID} and dataset ${SANITY_DATASET}. Read the schema first (get_schema) so you use the right field names.`

const SAFETY = `Make the change as a draft. Do not publish. Show me the change before you save it, and keep everything else in the documents as it is.`

const doc = (s: SkillRef) => `the skill "${s.name}" (document id ${s.id})`

const join = (...parts: string[]) => parts.join('\n\n')

/** Rewrite one skill's description so the AI knows when to pick it. */
export function descriptionFixPrompt({
  skill,
  failedRules,
  losesTo,
}: {
  skill: SkillRef
  /** Ids of the description rules it fails. */
  failedRules: string[]
  losesTo: string[]
}): string {
  const problems = [
    ...failedRules.map((id) => RULES_BY_ID.get(id)?.problem).filter(Boolean).map((p) => `- ${p}`),
    losesTo.length > 0 && `- Requests meant for this skill were picked up by: ${losesTo.join(', ')}.`,
  ].filter(Boolean)
  return join(
    PREAMBLE,
    `Improve the description of ${doc(skill)}. AI agents choose which skill to use from the description alone.`,
    problems.length ? `What's wrong:\n${problems.join('\n')}` : '',
    `Rewrite it so it:\n- says in the first sentence what problem the skill solves, in the words of someone who needs it\n- says when to use it: situations people are in, or a few things they would actually type\n- leaves out how the skill works (steps, tools, data sources); that belongs in the content field\n- says what it is not for${losesTo.length ? `, naming ${losesTo.join(', ')} as where those requests should go` : ''}\n- stays under 1024 characters and is written in the third person`,
    `Read the skill's instructions (the content field) so the description matches what the skill really does.`,
    SAFETY,
  ).replace(/\n{3,}/g, '\n\n')
}

const PAIR_TASK: Record<PairFix, (a: SkillRef, b: SkillRef) => string> = {
  clarify: (a, b) =>
    `AI agents mix up ${doc(a)} and ${doc(b)}. Read both descriptions and both sets of instructions, then edit both descriptions so each one says what that skill is for and adds one sentence pointing to the other for the requests that belong there. Keep each description under 1024 characters.`,
  extract: (a, b) =>
    `${doc(a)} and ${doc(b)} repeat some of the same instructions. Find the shared part. Create one new reference document (type skillReference) with it, add that reference to the References of both skills, and replace the copied text in each skill with a short line pointing to the reference. List what you moved.`,
  contradict: (a, b) =>
    `The instructions in ${doc(a)} and ${doc(b)} may disagree. Find each place where they give different definitions, rules or steps for the same thing, and quote both versions side by side. Ask me which is right before changing anything. If the difference is intended, add a sentence to each skill saying when its version applies.`,
  merge: (a, b) =>
    `${doc(a)} and ${doc(b)} look like the same skill. Compare them and propose a single merged version: which skill to keep, and what to move into it from the other. Write the merged description and instructions into a draft of the skill to keep. Do not delete or unpublish either skill — I'll do that after I've reviewed the merge.`,
}

/** Fix for a pair of skills, as suggested by `relationFix`. */
export function pairFixPrompt(fix: PairFix, self: SkillRef, other: SkillRef): string {
  return join(PREAMBLE, PAIR_TASK[fix](self, other), SAFETY)
}

/** Draft the first test requests for a skill that has none. */
export function testRequestsPrompt(skill: SkillRef): string {
  return join(
    PREAMBLE,
    `Write test requests for ${doc(skill)}. A test request is something a person might type, plus the skill that should handle it. They check that the AI picks the right skill.`,
    `Read the skill's description and instructions, and the descriptions of the skills most similar to it. Then create six skillEval documents with kind "trigger" and skill set to ${skill.id}:\n- three requests this skill should handle (expectedSkill: this skill)\n- two that sound similar but belong to another skill (expectedSkill: that skill)\n- one that could reasonably go either way (expectedSkill: the better fit, acceptableSkills: the other)\nWrite them the way people actually type: short, specific, with made-up company and person names.`,
    SAFETY,
  )
}

type RelationLike = {
  description?: {relationship?: string; competing?: number; sameTrigger?: number}
  body?: {contradicts?: number; recommendedAction?: string}
  routing?: {confusedRows?: number}
}

/** The one edit to suggest for a pair, most serious first; null when nothing needs doing. */
export function relationFix(rel: RelationLike): PairFix | null {
  const d = rel.description ?? {}
  const b = rel.body ?? {}
  if (d.relationship === 'duplicate' || b.recommendedAction === 'merge') return 'merge'
  if ((b.contradicts ?? 0) >= 0.5) return 'contradict'
  if (b.recommendedAction === 'extract_shared') return 'extract'
  if (
    b.recommendedAction === 'clarify_boundary' ||
    (d.competing ?? 0) >= 0.2 ||
    (d.sameTrigger ?? 0) >= 0.5 ||
    (rel.routing?.confusedRows ?? 0) > 0
  ) {
    return 'clarify'
  }
  return null
}
