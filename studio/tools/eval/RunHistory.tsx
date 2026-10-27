import {useMemo, useState, useCallback} from 'react'
import {useDocumentStore, useClient} from 'sanity'
import {useObservable} from 'react-rx'
import {defineQuery} from 'groq'
import {Box, Card, Stack, Text, Heading, Flex, Badge, Button, useToast} from '@sanity/ui'
import {TrashIcon, BulbOutlineIcon, ChevronDownIcon, ChevronRightIcon, EditIcon} from '@sanity/icons'
import {useIntentLink} from 'sanity/router'
import {usePerspectiveQueryOptions} from '../../utils/perspective'

const RUNS_FOR_SKILL_QUERY = defineQuery(
  `*[_type == "skillEvalRun" && skill._ref == $skillId] | order(_createdAt desc) [0...10] {
    _id,
    _createdAt,
    runType,
    trigger,
    model,
    summary,
    suggestions,
    results[] {
      prompt,
      response,
      passRate,
      durationMs,
      expectations[] {
        text,
        passed,
        evidence
      }
    }
  }`,
)

type ExpectationResult = {
  text: string | null
  passed: boolean | null
  evidence: string | null
}

type ResultItem = {
  prompt: string | null
  response: string | null
  passRate: number | null
  durationMs: number | null
  expectations: ExpectationResult[] | null
}

type RunItem = {
  _id: string
  _createdAt: string
  runType: string | null
  trigger: string | null
  model: string | null
  suggestions: string | null
  summary: {
    totalEvals: number | null
    passed: number | null
    failed: number | null
    passRate: number | null
    avgDurationMs: number | null
  } | null
  results: ResultItem[] | null
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function TruncatedText({text, limit = 500}: {text: string; limit?: number}) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = text.length > limit

  return (
    <Stack space={2}>
      <Text size={1} muted>
        {expanded || !needsTruncation ? text : text.slice(0, limit) + '\u2026'}
      </Text>
      {needsTruncation ? (
        <Button
          mode="bleed"
          fontSize={0}
          text={expanded ? 'Show less' : 'Show more'}
          onClick={() => setExpanded(!expanded)}
        />
      ) : null}
    </Stack>
  )
}

function RunDetails({run}: {run: RunItem}) {
  return (
    <Card padding={3} radius={2} tone="transparent">
      <Stack space={4}>
        {run.results && run.results.length > 0
          ? run.results.map((result, idx) => {
              const expectations = result.expectations || []
              const passedCount = expectations.filter((e) => e.passed).length
              const totalCount = expectations.length
              return (
                <Card key={idx} padding={3} radius={2} border>
                  <Stack space={3}>
                    <Flex align="center" gap={2}>
                      <Badge
                        tone={
                          totalCount === 0
                            ? 'default'
                            : passedCount === totalCount
                              ? 'positive'
                              : passedCount > 0
                                ? 'caution'
                                : 'critical'
                        }
                        fontSize={0}
                      >
                        {totalCount > 0 ? `${passedCount}/${totalCount}` : 'N/A'}
                      </Badge>
                      <Text size={1} weight="semibold">
                        {result.prompt
                          ? result.prompt.length > 100
                            ? result.prompt.slice(0, 100) + '\u2026'
                            : result.prompt
                          : 'No prompt'}
                      </Text>
                    </Flex>

                    {result.durationMs != null ? (
                      <Text size={0} muted>
                        {Math.round((result.durationMs / 1000) * 10) / 10}s
                      </Text>
                    ) : null}

                    {result.response ? (
                      <Stack space={2}>
                        <Text size={0} weight="semibold" muted>
                          Response
                        </Text>
                        <TruncatedText text={result.response} />
                      </Stack>
                    ) : null}

                    {expectations.length > 0 ? (
                      <Stack space={2}>
                        <Text size={0} weight="semibold" muted>
                          Expectations
                        </Text>
                        {expectations.map((exp, expIdx) => (
                          <Card key={expIdx} padding={2} radius={2} tone="transparent">
                            <Stack space={2}>
                              <Flex align="center" gap={2}>
                                <Badge tone={exp.passed ? 'positive' : 'critical'} fontSize={0}>
                                  {exp.passed ? '\u2705' : '\u274C'}
                                </Badge>
                                <Text size={1}>{exp.text || 'Unknown expectation'}</Text>
                              </Flex>
                              {exp.evidence ? (
                                <Box paddingLeft={4}>
                                  <Text size={0} muted>
                                    {exp.evidence}
                                  </Text>
                                </Box>
                              ) : null}
                            </Stack>
                          </Card>
                        ))}
                      </Stack>
                    ) : null}
                  </Stack>
                </Card>
              )
            })
          : null}

        {run.suggestions ? (
          <Card padding={3} radius={2} border tone="caution">
            <Stack space={3}>
              <Flex align="center" gap={2}>
                <Text size={1}>
                  <BulbOutlineIcon />
                </Text>
                <Text size={1} weight="semibold">
                  Improvement Suggestions
                </Text>
              </Flex>
              <Text size={1} muted style={{whiteSpace: 'pre-wrap'}}>
                {run.suggestions}
              </Text>
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </Card>
  )
}

function RunCard({
  run,
  isExpanded,
  onToggle,
  onDelete,
  isLatest,
}: {
  run: RunItem
  isExpanded: boolean
  onToggle: () => void
  onDelete: (runId: string) => void
  isLatest: boolean
}) {
  // Router-resolved so the link keeps the Studio base path and the sticky
  // `perspective` param (see SkillCard for the same reasoning).
  const editLink = useIntentLink({
    intent: 'edit',
    params: {id: run._id, type: 'skillEvalRun'},
  })

  return (
    <Card padding={3} radius={2} border>
      <Stack space={3}>
        <Flex align="center" gap={2}>
          <Button
            mode="bleed"
            icon={isExpanded ? ChevronDownIcon : ChevronRightIcon}
            onClick={onToggle}
            fontSize={1}
          />
          <Flex align="center" gap={3} flex={1}>
            {isLatest ? (
              <Text size={1} weight="semibold">
                Latest Run
              </Text>
            ) : null}
            <Badge
              tone={
                (run.summary?.passRate ?? 0) >= 1
                  ? 'positive'
                  : (run.summary?.passRate ?? 0) > 0
                    ? 'caution'
                    : 'critical'
              }
            >
              {run.summary?.passRate != null
                ? `${Math.round(run.summary.passRate * 100)}%`
                : '\u2014'}
            </Badge>
            <Text size={1}>
              {run.summary?.passed ?? 0}/{run.summary?.totalEvals ?? 0} evals passed
            </Text>
            {run.summary?.avgDurationMs != null ? (
              <Text size={0} muted>
                {Math.round(run.summary.avgDurationMs / 100) / 10}s avg
              </Text>
            ) : null}
          </Flex>
          <Text size={0} muted>
            {formatDate(run._createdAt)} &middot; {run.trigger || 'manual'}
          </Text>
          {run.model ? (
            <Badge tone="default" fontSize={0}>{run.model}</Badge>
          ) : null}
          <Flex gap={1}>
            <Button
              as="a"
              href={editLink.href}
              mode="bleed"
              icon={EditIcon}
              tone="default"
              fontSize={0}
              onClick={(e: React.MouseEvent<HTMLElement>) => {
                e.stopPropagation()
                editLink.onClick(e)
              }}
            />
            <Button
              mode="bleed"
              icon={TrashIcon}
              tone="critical"
              fontSize={0}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                onDelete(run._id)
              }}
            />
          </Flex>
        </Flex>
        {isExpanded ? <RunDetails run={run} /> : null}
      </Stack>
    </Card>
  )
}

export function RunHistory({
  skillId,
  refreshKey,
}: {
  skillId: string
  refreshKey: number
}) {
  const documentStore = useDocumentStore()
  const queryOptions = usePerspectiveQueryOptions()
  const client = useClient({apiVersion: '2024-01-01'})
  const toast = useToast()
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [autoExpandedLatest, setAutoExpandedLatest] = useState(false)

  const runs$ = useMemo(
    () => documentStore.listenQuery(RUNS_FOR_SKILL_QUERY, {skillId}, queryOptions),
    [documentStore, skillId, queryOptions],
  )
  const runs = useObservable(runs$, null) as RunItem[] | null

  const handleToggle = useCallback(
    (runId: string) => {
      setExpandedRunId((prev) => (prev === runId ? null : runId))
    },
    [],
  )

  const handleDelete = useCallback(
    async (runId: string) => {
      try {
        await client.delete(runId)
        toast.push({
          status: 'success',
          title: 'Run deleted',
        })
        if (expandedRunId === runId) {
          setExpandedRunId(null)
        }
      } catch (err) {
        toast.push({
          status: 'error',
          title: 'Failed to delete run',
          description: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [client, toast, expandedRunId],
  )

  if (runs === null) {
    return null
  }

  // Auto-expand the latest run on first load
  if (runs.length > 0 && !autoExpandedLatest) {
    setExpandedRunId(runs[0]._id)
    setAutoExpandedLatest(true)
  }

  if (runs.length === 0) {
    return (
      <Card padding={4} radius={2} border>
        <Text size={1} muted>
          No eval runs yet. Click &ldquo;Run All&rdquo; to start.
        </Text>
      </Card>
    )
  }

  return (
    <Stack space={3}>
      <Heading size={1}>Run History</Heading>
      {runs.map((run, idx) => (
        <RunCard
          key={run._id}
          run={run}
          isExpanded={expandedRunId === run._id}
          onToggle={() => handleToggle(run._id)}
          onDelete={handleDelete}
          isLatest={idx === 0}
        />
      ))}
    </Stack>
  )
}
