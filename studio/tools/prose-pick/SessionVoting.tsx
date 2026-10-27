import {useCallback, useMemo, useState} from 'react'
import {
  Box,
  Card,
  Stack,
  Flex,
  Text,
  Heading,
  Badge,
  Button,
  Spinner,
  TextArea,
  Grid,
  useToast,
} from '@sanity/ui'
import {useClient, useCurrentUser, useDocumentStore} from 'sanity'
import {useObservable} from 'react-rx'
import type {ProseTestSession, ProseVote, ProseVotePick} from './types'
import {aggregateVotes, resolveVoterReveal} from './aggregate'
import {OutputCard} from './OutputCard'
import {AggregateBars} from './AggregateBars'

interface Props {
  sessionId: string
}

const SESSION_QUERY = `*[_type == "proseTestSession" && _id == $sessionId][0]`
const VOTES_QUERY = `*[_type == "proseVote" && sessionId == $sessionId] | order(submittedAt asc)`

export function SessionVoting({sessionId}: Props) {
  const documentStore = useDocumentStore()
  const client = useClient({apiVersion: '2024-01-01'})
  const currentUser = useCurrentUser()
  const toast = useToast()

  const voter = currentUser?.name || currentUser?.email || 'anonymous'
  const voterId = currentUser?.id || 'anon'
  const voteDocId = `vote.${sessionId}.${voterId}`

  const session$ = useMemo(
    () => documentStore.listenQuery(SESSION_QUERY, {sessionId}, {perspective: 'published'}),
    [documentStore, sessionId],
  )
  const session = useObservable(session$, null) as ProseTestSession | null

  const votes$ = useMemo(
    () => documentStore.listenQuery(VOTES_QUERY, {sessionId}, {perspective: 'published'}),
    [documentStore, sessionId],
  )
  const votes = useObservable(votes$, null) as ProseVote[] | null

  const [picks, setPicks] = useState<Record<string, ProseVotePick>>({})
  const [submitting, setSubmitting] = useState(false)
  const [forceReVote, setForceReVote] = useState(false)

  const setPick = useCallback((promptId: string, pick: 'A' | 'B' | 'EQ') => {
    setPicks((prev) => ({
      ...prev,
      [promptId]: {...(prev[promptId] || {promptId, pick}), promptId, pick},
    }))
  }, [])

  const setNote = useCallback((promptId: string, note: string) => {
    setPicks((prev) => ({
      ...prev,
      [promptId]: {
        ...(prev[promptId] || {promptId, pick: 'EQ' as const}),
        promptId,
        note,
      },
    }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!session) return
    const pairs = session.pairs ?? []
    const missing = pairs.filter((p) => !picks[p.promptId]?.pick)
    if (missing.length > 0) {
      toast.push({
        status: 'warning',
        title: `${missing.length} pair${missing.length === 1 ? '' : 's'} not voted on`,
        description: 'Pick A, B, or "Roughly equivalent" for every pair before submitting.',
      })
      return
    }

    setSubmitting(true)
    try {
      const picksArray: ProseVotePick[] = pairs.map((pair) => {
        const p = picks[pair.promptId]
        return {
          _key: pair.promptId,
          promptId: pair.promptId,
          pick: p.pick,
          ...(p.note ? {note: p.note} : {}),
        }
      })
      await client.createOrReplace({
        _id: voteDocId,
        _type: 'proseVote',
        sessionId,
        voter,
        voterId,
        submittedAt: new Date().toISOString(),
        picks: picksArray,
      })
      toast.push({status: 'success', title: 'Vote recorded'})
      setForceReVote(false)
    } catch (err) {
      console.error('vote submit failed', err)
      toast.push({
        status: 'error',
        title: 'Could not submit vote',
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSubmitting(false)
    }
  }, [session, picks, client, voteDocId, sessionId, voter, voterId, toast])

  if (session === null || votes === null) {
    return (
      <Flex align="center" justify="center" padding={5} height="fill">
        <Spinner muted />
      </Flex>
    )
  }

  if (!session) {
    return (
      <Flex align="center" justify="center" padding={5} height="fill">
        <Card padding={4} radius={2} tone="critical">
          <Text>Session not found.</Text>
        </Card>
      </Flex>
    )
  }

  const pairs = session.pairs ?? []
  const prompts = session.prompts ?? []
  const conditions = session.conditions ?? []

  const myVote = votes.find((v) => v.voterId === voterId) || null
  const aggregate = aggregateVotes(session, votes)
  const showReveal = !!myVote && !forceReVote
  const isClosed = session.status === 'closed'
  const isEmpty = pairs.length === 0

  return (
    <Box padding={4} style={{maxWidth: 980, margin: '0 auto'}}>
      <Stack space={5}>
        <Stack space={3}>
          <Heading size={2}>{session.title}</Heading>
          {session.description && (
            <Text size={1} muted>
              {session.description}
            </Text>
          )}
          <Flex gap={2} wrap="wrap" align="center">
            <Badge tone="primary" fontSize={0}>
              n={votes.length} {votes.length === 1 ? 'voter' : 'voters'}
            </Badge>
            {myVote && (
              <Badge tone="positive" fontSize={0}>
                You voted
              </Badge>
            )}
            {isClosed && (
              <Badge tone="caution" fontSize={0}>
                Session closed
              </Badge>
            )}
            {isEmpty && (
              <Badge tone="caution" fontSize={0}>
                No pairs yet
              </Badge>
            )}
          </Flex>
        </Stack>

        {isEmpty ? (
          <Card padding={4} radius={2} tone="transparent" border>
            <Stack space={3}>
              <Heading size={1}>Session has no pairs yet</Heading>
              <Text size={1} muted>
                This session document doesn&rsquo;t have any prompts or pairs to vote on. Open the document
                in the structure pane and add at least one prompt and one pair to start collecting votes.
              </Text>
            </Stack>
          </Card>
        ) : showReveal ? (
          <RevealPanel
            session={session}
            myVote={myVote!}
            aggregate={aggregate}
            onReVote={() => {
              setForceReVote(true)
              const existing: Record<string, ProseVotePick> = {}
              for (const p of myVote!.picks ?? []) {
                existing[p.promptId] = {promptId: p.promptId, pick: p.pick, note: p.note}
              }
              setPicks(existing)
            }}
            allowReVote={!isClosed}
          />
        ) : (
          <>
            {forceReVote && (
              <Card padding={3} radius={2} tone="caution">
                <Text size={1}>
                  You previously submitted a vote for this session. Submitting again will overwrite your prior picks.
                </Text>
              </Card>
            )}
            {isClosed && !myVote && (
              <Card padding={3} radius={2} tone="caution">
                <Text size={1}>This session is closed. New votes can&apos;t be submitted.</Text>
              </Card>
            )}
            <Stack space={4}>
              {pairs.map((pair, idx) => {
                const prompt = prompts.find((p) => p.id === pair.promptId)
                const currentPick = picks[pair.promptId]?.pick
                const currentNote = picks[pair.promptId]?.note || ''
                return (
                  <Card key={pair._key || pair.promptId} padding={4} radius={2} shadow={1}>
                    <Stack space={4}>
                      <Stack space={2}>
                        <Heading size={1}>
                          {idx + 1}. {prompt?.name || pair.promptId}
                        </Heading>
                        {prompt && (
                          <Card padding={3} radius={2} tone="transparent">
                            <Text size={1} muted>
                              {prompt.text}
                            </Text>
                          </Card>
                        )}
                      </Stack>

                      <Grid columns={[1, 1, 2]} gap={2}>
                        <OutputCard
                          label="Output A"
                          text={pair.A.text}
                          selected={currentPick === 'A'}
                          onSelect={() => setPick(pair.promptId, 'A')}
                          disabled={isClosed && !forceReVote}
                        />
                        <OutputCard
                          label="Output B"
                          text={pair.B.text}
                          selected={currentPick === 'B'}
                          onSelect={() => setPick(pair.promptId, 'B')}
                          disabled={isClosed && !forceReVote}
                        />
                      </Grid>

                      <Flex justify="center">
                        <Button
                          mode={currentPick === 'EQ' ? 'default' : 'ghost'}
                          tone={currentPick === 'EQ' ? 'primary' : 'default'}
                          text="Roughly equivalent"
                          onClick={() => setPick(pair.promptId, 'EQ')}
                          disabled={isClosed && !forceReVote}
                        />
                      </Flex>

                      <TextArea
                        rows={2}
                        placeholder="Why? (optional)"
                        value={currentNote}
                        onChange={(e) => setNote(pair.promptId, (e.target as HTMLTextAreaElement).value)}
                        disabled={isClosed && !forceReVote}
                      />
                    </Stack>
                  </Card>
                )
              })}
            </Stack>

            <Card padding={3} radius={2} tone="transparent">
              <Flex justify="space-between" align="center" gap={3} wrap="wrap">
                <Text size={1} muted>
                  Voting as <strong>{voter}</strong>. Outputs are blinded — labels (A/B) randomize which model produced which.
                </Text>
                <Flex gap={2}>
                  {forceReVote && (
                    <Button
                      mode="ghost"
                      text="Cancel"
                      onClick={() => {
                        setForceReVote(false)
                        setPicks({})
                      }}
                    />
                  )}
                  <Button
                    text={submitting ? 'Submitting…' : forceReVote ? 'Update vote' : 'Submit vote'}
                    tone="primary"
                    onClick={handleSubmit}
                    disabled={submitting || (isClosed && !forceReVote)}
                  />
                </Flex>
              </Flex>
            </Card>
          </>
        )}
      </Stack>
    </Box>
  )
}

interface RevealPanelProps {
  session: ProseTestSession
  myVote: ProseVote
  aggregate: ReturnType<typeof aggregateVotes>
  onReVote: () => void
  allowReVote: boolean
}

function RevealPanel({session, myVote, aggregate, onReVote, allowReVote}: RevealPanelProps) {
  const myReveal = resolveVoterReveal(session, myVote)
  const conditions = session.conditions ?? []
  const pairs = session.pairs ?? []

  // Tally this voter's picks per condition (works for any N conditions,
  // including same-family comparisons like Claude-v2 vs Claude-v2.1).
  // Falls back to the legacy aIsClaude path if conditions don't exist
  // yet on an old session.
  let myEq = 0
  const myByCondition: Record<string, number> = {}
  for (const cond of conditions) myByCondition[cond.conditionId] = 0
  for (const r of myReveal) {
    if (r.pick === 'EQ') {
      myEq++
      continue
    }
    const pair = pairs.find((p) => p.promptId === r.promptId)
    if (!pair) continue
    const wonSide = r.pick === 'A' ? pair.A : pair.B
    const cId = wonSide.conditionId
    if (cId in myByCondition) {
      myByCondition[cId] += 1
    } else {
      // Pair references a conditionId not declared on the session — still
      // count it under that id so the badge appears.
      myByCondition[cId] = 1
    }
  }

  // Build display rows from conditions (preserves session author's order).
  // Conditions not declared but referenced in pairs are appended at the end.
  const myConditionBadges: Array<{conditionId: string; label: string; count: number}> = []
  for (const cond of conditions) {
    myConditionBadges.push({
      conditionId: cond.conditionId,
      label: cond.label || cond.conditionId,
      count: myByCondition[cond.conditionId] ?? 0,
    })
  }
  for (const cId of Object.keys(myByCondition)) {
    if (!conditions.find((c) => c.conditionId === cId)) {
      myConditionBadges.push({conditionId: cId, label: cId, count: myByCondition[cId]})
    }
  }

  return (
    <Stack space={4}>
      <Card padding={4} radius={2} shadow={1}>
        <Stack space={3}>
          <Flex justify="space-between" align="center" wrap="wrap" gap={2}>
            <Heading size={1}>Your results</Heading>
            {allowReVote && (
              <Button mode="ghost" fontSize={1} text="Re-vote" onClick={onReVote} />
            )}
          </Flex>
          <Flex gap={2} wrap="wrap">
            {myConditionBadges.map((b) => (
              <Badge key={b.conditionId} tone="primary" fontSize={1}>
                {b.label}: {b.count}
              </Badge>
            ))}
            {myEq > 0 && (
              <Badge tone="default" fontSize={1}>
                Equivalent: {myEq}
              </Badge>
            )}
          </Flex>
          <Stack space={2}>
            {myReveal.map((r) => (
              <Flex
                key={r.promptId}
                justify="space-between"
                gap={3}
                padding={2}
                style={{borderBottom: '1px solid var(--card-border-color)'}}
              >
                <Text size={1}>{r.promptName}</Text>
                <Text size={1} muted>
                  {r.pick} — {r.conditionLabel}
                </Text>
              </Flex>
            ))}
          </Stack>
        </Stack>
      </Card>

      <Card padding={4} radius={2} shadow={1}>
        <Stack space={4}>
          <Heading size={1}>Team aggregate ({aggregate.totalVoters} {aggregate.totalVoters === 1 ? 'voter' : 'voters'})</Heading>
          <AggregateBars session={session} aggregate={aggregate} />
        </Stack>
      </Card>
    </Stack>
  )
}
