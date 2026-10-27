import {useCallback, useState} from 'react'
import {Box, Button, Card, Flex, Stack, Text, Badge} from '@sanity/ui'
import {PlayIcon} from '@sanity/icons'
import {usePerspectiveClient} from '../../utils/perspective'
import {generateText, type AISecrets, type ModelId} from '../../utils/aiProviders'
import {
  runSelectionEval,
  type SelectionCase,
  type SelectionResult,
  type SkillListingEntry,
} from '../../utils/runSelectionEval'

/**
 * Runs the trigger-kind rows for one skill and reports which skill actually
 * fires — the test the behaviour runner structurally cannot do, because it
 * sends one skill's body as the system prompt and never its siblings.
 *
 * Nothing here loads a skill body or touches a connector: the model sees only
 * the listing a user of these audiences would see.
 */

type TriggerCase = SelectionCase & {filedUnder?: string}

type Props = {
  skillId: string
  cases: TriggerCase[]
  model: ModelId
  secrets: AISecrets
  runs?: number
}

// Perspective-scoped: the listing is "what an agent would see" for whichever
// perspective the editor is in, with one entry per skill. Under raw it also
// listed every release version of a skill as a separate candidate, which the
// selection eval would then score against itself.
const LISTING_QUERY = `
*[_type == "skill" && defined(description)
  && count((audiences[]->slug.current)[@ in $audiences]) > 0]
| order(skillName asc){skillName, description}`

const AUDIENCES_QUERY = `array::unique(*[_type == "skill" && _id == $skillId].audiences[]->slug.current)`

export function RunSelectionButton({skillId, cases, model, secrets, runs = 3}: Props) {
  const client = usePerspectiveClient('2025-02-19')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<SelectionResult[] | null>(null)
  const [summary, setSummary] = useState<{
    passed: number
    total: number
    passedRuns: number
    totalRuns: number
    unanimousCases: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [listingInfo, setListingInfo] = useState<{count: number; chars: number} | null>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      const audiences: string[] = await client.fetch(AUDIENCES_QUERY, {skillId})
      const listing: SkillListingEntry[] = await client.fetch(LISTING_QUERY, {audiences})

      if (listing.length === 0) {
        throw new Error('This skill has no audiences, so there is no listing to select from.')
      }
      setListingInfo({
        count: listing.length,
        chars: listing.reduce((n, e) => n + e.skillName.length + e.description.length + 4, 0),
      })

      const out = await runSelectionEval({
        cases,
        listing,
        runs,
        // maxTokens has headroom on purpose: reasoning models spend budget
        // before emitting text, and an empty reply would score as a miss.
        generate: ({system, user}) => generateText({model, system, user, maxTokens: 2048, secrets}),
      })
      setResults(out.results)
      setSummary(out.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }, [client, skillId, cases, model, secrets, runs])

  return (
    <Stack space={3}>
      <Flex align="center" gap={3}>
        <Button
          icon={PlayIcon}
          text={running ? 'Running…' : `Run ${cases.length} trigger case${cases.length === 1 ? '' : 's'}`}
          tone="primary"
          disabled={running || cases.length === 0}
          onClick={run}
        />
        <Text size={1} muted>
          {cases.length * runs} calls · {model}
        </Text>
      </Flex>

      {listingInfo && (
        <Text size={1} muted>
          Listing: {listingInfo.count} skills, {listingInfo.chars.toLocaleString()} characters
        </Text>
      )}

      {error && (
        <Card padding={3} radius={2} tone="critical" border>
          <Text size={1}>{error}</Text>
        </Card>
      )}

      {summary && (
        <Card padding={3} radius={2} tone={summary.passed === summary.total ? 'positive' : 'caution'} border>
          <Text size={1} weight="medium">
            {summary.passed}/{summary.total} cases · {summary.passedRuns}/{summary.totalRuns} runs ·{' '}
            {summary.unanimousCases}/{summary.total} unanimous
          </Text>
        </Card>
      )}

      {results?.map((r) => (
        <Card key={r.caseId} padding={3} radius={2} border tone={r.passed ? 'default' : 'critical'}>
          <Stack space={2}>
            <Flex align="center" gap={2}>
              <Badge tone={r.passed ? 'positive' : 'critical'} fontSize={0}>
                {r.passedRuns}/{r.runs}
              </Badge>
              {!r.unanimous && (
                <Badge tone="caution" fontSize={0}>
                  split
                </Badge>
              )}
              <Text size={1} muted>
                want <code>{r.expected}</code> · got <code>{r.answer ?? '—'}</code>
              </Text>
            </Flex>
            <Text size={1}>{r.prompt}</Text>
            {!r.unanimous && (
              <Text size={0} muted>
                runs: {r.answers.map((a) => a ?? '—').join(', ')}
              </Text>
            )}
            {r.unrecognized.length > 0 && (
              <Text size={0} style={{color: 'var(--card-badge-caution-fg-color)'}}>
                Not in the listing: {r.unrecognized.join(', ')}
              </Text>
            )}
            {r.errors.length > 0 && (
              <Text size={0} style={{color: 'var(--card-badge-critical-fg-color)'}}>
                {r.errors.join('; ')}
              </Text>
            )}
          </Stack>
        </Card>
      ))}

      {results && results.length > 0 && (
        <Box>
          <Text size={0} muted>
            Measures selection from names and descriptions — the property every harness shares. It is
            not any particular agent, and a result holds only for {model}.
          </Text>
        </Box>
      )}
    </Stack>
  )
}
