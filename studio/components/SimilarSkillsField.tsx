import {useEffect, useMemo, useState} from 'react'
import {Badge, Card, Flex, Stack, Text} from '@sanity/ui'
import {WarningOutlineIcon} from '@sanity/icons'
import {useClient, useFormValue} from 'sanity'
import {getPublishedId} from '../utils/documentIds'
import {useRouter} from 'sanity/router'

/**
 * Authoring-time duplicate detection (governance: overlapping skills with
 * conflicting instructions). Renders a banner listing existing documents
 * that look semantically similar to the one being edited.
 *
 * Uses text::semanticSimilarity over the description (dataset embeddings).
 * documents::semanticSimilarity would be better for published docs but is
 * preview and currently 500s (traceIds reported 2026-07-22) — swap in when
 * fixed. Embeddings projections cannot follow references, so overlap living
 * in reference files is checked by mounting this same banner on the
 * skillReference form too.
 *
 * Scores are opaque and not comparable across queries (calibration
 * 2026-07-22: unrelated docs floor ~8, true duplicate 9.4), so hits are
 * flagged by RELATIVE elevation: at least ELEVATION above the mean of the
 * query's own lower-ranked results. On the calibration set this flags the
 * real duplicate (+19%) and the overlapping families (+12–15%) while the
 * unrelated control (+9%) stays quiet.
 *
 * Fail-soft by design: any query error (embeddings disabled/updating) hides
 * the banner and logs a console warning. Never blocks authoring.
 */

const ELEVATION = 1.1 // flag when score >= baseline * 1.1
const MAX_HITS = 3
const POOL = 12 // top-N fetched; ranks 6..12 form the baseline
const API_VERSION = 'v2025-02-19'

type Hit = {_id: string; title: string; _score: number}

export function SimilarSkillsField() {
  const client = useClient({apiVersion: API_VERSION})
  const router = useRouter()
  const docId = useFormValue(['_id']) as string | undefined
  const docType = useFormValue(['_type']) as string | undefined
  const description = useFormValue(
    docType === 'skillReference' ? ['content'] : ['description'],
  ) as string | undefined
  const [hits, setHits] = useState<Hit[]>([])

  // `getPublishedId`, so the document being edited is excluded from its own
  // similarity results — a `versions.<releaseId>.` ID matched nothing in the
  // `_id != $id` guard and the skill scored as a near-duplicate of itself.
  const publishedId = docId ? getPublishedId(docId) : undefined

  // Debounce the text used for the draft fallback
  const [debouncedText, setDebouncedText] = useState(description)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedText(description), 1500)
    return () => clearTimeout(t)
  }, [description])

  const titleField = docType === 'skillReference' ? 'filename' : 'skillName'

  useEffect(() => {
    if (!docType || !publishedId) return
    if (!debouncedText || debouncedText.length < 40) {
      setHits([])
      return
    }
    let cancelled = false

    const run = async () => {
      try {
        const pool: Hit[] = await client.fetch(
          `*[_type == $type && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
            && _id != $id && !(${titleField} match "*-overview")]
            | score(text::semanticSimilarity($text))
            | order(_score desc)[0...${POOL}]{_id, "title": ${titleField}, _score}`,
          {type: docType, id: publishedId, text: debouncedText.slice(0, 2000)},
        )
        const baselinePool = pool.slice(MAX_HITS + 2)
        if (!baselinePool.length) {
          if (!cancelled) setHits([])
          return
        }
        const baseline =
          baselinePool.reduce((sum, hit) => sum + hit._score, 0) / baselinePool.length
        const flagged = pool
          .slice(0, MAX_HITS)
          .filter((hit) => hit._score >= baseline * ELEVATION)
        if (!cancelled) setHits(flagged)
      } catch (err) {
        // Embeddings disabled/updating — stay silent
        console.warn('[SimilarSkillsField] similarity check unavailable:', err)
        if (!cancelled) setHits([])
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [client, docType, publishedId, debouncedText, titleField])

  const intent = useMemo(
    () => (id: string) =>
      router.resolveIntentLink('edit', {id, type: docType}),
    [router, docType],
  )

  if (hits.length === 0) return null

  return (
    <Card padding={3} radius={2} tone="caution" border>
      <Flex gap={3} align="flex-start">
        <Text size={1}>
          <WarningOutlineIcon />
        </Text>
        <Stack space={3} flex={1}>
          <Text size={1} weight="bold">
            Similar {docType === 'skillReference' ? 'reference files' : 'skills'} already exist
          </Text>
          <Text size={1} muted>
            Check these before publishing — overlapping instructions confuse
            agents. Consider extending one of them, or adding an audience,
            instead of creating a near-duplicate.
          </Text>
          <Stack space={2}>
            {hits.map((hit) => (
              <Flex key={hit._id} gap={2} align="center">
                <Badge tone="caution" fontSize={0}>
                  {hit._score.toFixed(2)}
                </Badge>
                <Text size={1}>
                  <a href={intent(hit._id)}>{hit.title}</a>
                </Text>
              </Flex>
            ))}
          </Stack>
        </Stack>
      </Flex>
    </Card>
  )
}
