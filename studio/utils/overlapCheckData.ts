/**
 * Reading and writing for the overlap check, shared by the Studio action and
 * `scripts/check-overlap.ts`. Takes any client, so the same queries run from
 * the browser and the CLI.
 */
import type {SanityClient} from 'sanity'
import {defineQuery} from 'groq'
import {getPublishedId} from './documentIds'
import type {CheckResult, LibrarySkill, TriggerRow} from './overlapCheck'
import {comparisonSnapshot, evaluateGate, loadGateDocs, type ComparisonSnapshot, type GateResult} from './skillGate'
import {JEV_MODEL, qualityId} from './skillSignals'

const EMBEDDING_CANDIDATES = 6

const LIBRARY_QUERY = defineQuery(`*[_type == "skill"]{
  _id, skillName, title, description, content, "audiences": audiences[]->title
}`)

// Same similarity query SimilarSkillsField runs, over the draft's description.
const EMBEDDING_NEIGHBOURS_QUERY = defineQuery(`*[_type == "skill" && _id != $id]
  | score(text::semanticSimilarity($text))
  | order(_score desc)[0...${EMBEDDING_CANDIDATES}]._id`)

// Pairs already flagged by an earlier check or the spike backfill.
const FLAGGED_RELATIONS_QUERY = defineQuery(`*[_type == "skillRelation" && references($id) && (
  description.competing >= 0.2
  || body.recommendedAction in ["merge", "extract_shared", "clarify_boundary"]
  || routing.confusedRows > 0
)]{"other": select(skillA._ref == $id => skillB._ref, skillA._ref)}.other`)

const TRIGGER_ROWS_QUERY = defineQuery(`*[_type == "skillEval" && kind == "trigger"
  && (skill._ref == $id || expectedSkill._ref == $id)]{
  prompt,
  "owner": skill->skillName,
  "expected": select(expectNone == true => "none", expectedSkill->skillName),
  "acceptable": coalesce(acceptableSkills[]->skillName, [])
}`)

/** The skill as the editor has it open: draft, release version or published. */
export type CheckedSkill = {_id: string; skillName?: string; title?: string; description?: string; content?: string}

export async function loadCheckInput(client: SanityClient, current: CheckedSkill) {
  const id = getPublishedId(current._id)
  const published = client.withConfig({perspective: 'published'})
  // Rows are authoring material: include ones still in draft.
  const drafts = client.withConfig({perspective: 'drafts'})

  const [library, flagged, rows, embedding] = await Promise.all([
    published.fetch<LibrarySkill[]>(LIBRARY_QUERY),
    client.fetch<string[]>(FLAGGED_RELATIONS_QUERY, {id}),
    drafts.fetch<Array<Partial<TriggerRow>>>(TRIGGER_ROWS_QUERY, {id}),
    published
      .fetch<string[]>(EMBEDDING_NEIGHBOURS_QUERY, {id, text: (current.description ?? '').slice(0, 2000)})
      .then((ids) => ({ids, error: null as string | null}))
      .catch((err: Error) => ({ids: [] as string[], error: err.message})),
  ])

  return {
    input: {
      skill: {
        _id: current._id,
        skillName: current.skillName!,
        title: current.title,
        description: current.description!,
        content: current.content,
        audiences: library.find((s) => s._id === id)?.audiences,
      },
      library,
      candidates: [...embedding.ids, ...flagged],
      rows: rows.filter((r): r is TriggerRow => Boolean(r.prompt && r.owner && r.expected)),
    },
    embeddingError: embedding.error,
  }
}

export async function writeCheckResult(client: SanityClient, result: CheckResult) {
  const tx = client.transaction()
  // `set` on top of what is there: an acknowledgement on a relation is a
  // person's and survives a re-check.
  for (const {_id, _type, ...fields} of [...result.relations, result.quality]) {
    tx.createIfNotExists({_id, _type}).patch(_id, (p) => p.set(fields))
  }
  // Default (sync) visibility: the results are read straight back.
  await tx.commit()
}

/**
 * Store the snapshot on every copy of the skill that exists: the published
 * document and its draft. Patching only the published copy would lose the
 * snapshot when an open draft is published over it. Never creates a copy, so
 * running a comparison doesn't leave an unpublished draft behind.
 * `metadata` is outside the GitHub sync's filter, so this doesn't sync.
 */
export async function writeComparisonSnapshot(client: SanityClient, skillId: string, snapshot: ComparisonSnapshot) {
  const id = getPublishedId(skillId)
  const copies = (await client.getDocuments([id, `drafts.${id}`])).filter(Boolean)
  if (copies.length === 0) return
  const tx = client.transaction()
  for (const copy of copies) {
    tx.patch(copy!._id, (p) => p.setIfMissing({metadata: {}}).set({'metadata.comparison': snapshot}))
  }
  await tx.commit()
}

/**
 * Recompute the snapshot from what is stored, the way publishing reads it:
 * through the gate, so acknowledgements and "allow publishing" reasons count.
 */
export async function refreshComparisonSnapshot(
  client: SanityClient,
  skill: {id: string; name: string},
  checked: {descriptionHash: string; bodyHash: string},
): Promise<GateResult> {
  const stored = await loadGateDocs(client, skill.id)
  const gate = evaluateGate({skillId: skill.id, skillName: skill.name, ...checked, ...stored})
  await writeComparisonSnapshot(
    client,
    skill.id,
    comparisonSnapshot(gate, {
      ...checked,
      checkedAt: stored.quality?.lint?.checkedAt ?? new Date().toISOString(),
      model: JEV_MODEL,
    }),
  )
  return gate
}

/** Save a comparison, then the snapshot on the skill. */
export async function saveCheckResult(client: SanityClient, result: CheckResult, skillName: string): Promise<GateResult> {
  await writeCheckResult(client, result)
  return refreshComparisonSnapshot(
    client,
    {id: result.self._id, name: skillName},
    {descriptionHash: result.self.descriptionHash, bodyHash: result.self.bodyHash ?? ''},
  )
}

/**
 * Record why someone allowed publishing past a pause, on the skill's
 * comparison results, and refresh the snapshot so the validation error clears.
 * It covers only this description: editing it asks again.
 */
export async function allowPublishing(
  client: SanityClient,
  skill: {id: string; name: string},
  checked: {descriptionHash: string; bodyHash: string},
  {reason, by, findings}: {reason: string; by?: string; findings: string[]},
): Promise<void> {
  const id = getPublishedId(skill.id)
  await client
    .transaction()
    .createIfNotExists({_id: qualityId(id), _type: 'skillQuality', skill: {_type: 'reference', _ref: id, _weak: true}})
    .patch(qualityId(id), (p) =>
      p.setIfMissing({overrides: []}).append('overrides', [
        {
          _key: Math.random().toString(36).slice(2, 12),
          _type: 'gateOverride',
          reason,
          descriptionHash: checked.descriptionHash,
          findings,
          by,
          at: new Date().toISOString(),
        },
      ]),
    )
    .commit()
  await refreshComparisonSnapshot(client, {id, name: skill.name}, checked)
}
