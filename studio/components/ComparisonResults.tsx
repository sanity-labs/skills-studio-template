import {useState} from 'react'
import {Button, Card, Flex, Stack, Text} from '@sanity/ui'
import type {GateResult} from '../utils/skillGate'
import {testRequestsPrompt} from '../utils/fixPrompts'
import {FindingCard} from './FindingCard'
import {CopyPromptButton, COPY_PROMPT_HELP} from './CopyPromptButton'

/** How many findings show before "Show all", in the compact (form) layout. */
const COMPACT_LIMIT = 3

/**
 * What the comparison found, grouped into the skill itself and similar
 * skills. Out-of-date notices are left to the caller, which knows whether the
 * results are current.
 */
export function ComparisonResults({
  gate,
  skill,
  hasTestRequests,
  fine = [],
  partial = false,
  compact = false,
}: {
  gate: GateResult
  skill: {id: string; name: string}
  hasTestRequests: boolean
  /** Similar skills that need no changes. */
  fine?: string[]
  /** The similarity search failed and only known pairs were compared. */
  partial?: boolean
  /** Fewer findings at first, for the form. */
  compact?: boolean
}) {
  const [showAll, setShowAll] = useState(!compact)
  const findings = gate.findings.filter((f) => f.about !== 'freshness')
  const aboutSkill = findings.filter((f) => f.about === 'skill')
  const aboutPairs = findings.filter((f) => f.about === 'pair')
  const ordered = [...findings].sort((a, b) => (a.level === b.level ? 0 : a.level === 'hold' ? -1 : 1))
  const visible = showAll ? null : ordered.slice(0, COMPACT_LIMIT)
  const offersPrompts = !hasTestRequests || findings.some((f) => f.fixPrompt)

  const noTestRequests = !hasTestRequests && (
    <Card padding={3} radius={2} border>
      <Stack space={3}>
        <Text size={1} weight="semibold">
          This skill has no test requests yet.
        </Text>
        <Text size={1} muted>
          A test request is something a person might ask, plus the skill that should handle it. Without them, nothing
          checks that people’s requests reach this skill rather than a similar one.
        </Text>
        <Text size={1}>
          Add about six: three requests this skill should handle, two that sound similar but belong to another skill,
          and one that could go either way.
        </Text>
        <Flex>
          <CopyPromptButton prompt={testRequestsPrompt(skill)} />
        </Flex>
      </Stack>
    </Card>
  )

  if (visible) {
    return (
      <Stack space={3}>
        {findings.length === 0 && <Text size={1}>No problems found.</Text>}
        {visible.map((finding, i) => (
          <FindingCard key={i} finding={finding} />
        ))}
        {findings.length > visible.length && (
          <Flex>
            <Button
              text={`Show all ${findings.length}`}
              mode="bleed"
              fontSize={1}
              padding={2}
              onClick={() => setShowAll(true)}
            />
          </Flex>
        )}
        {noTestRequests}
        {offersPrompts && (
          <Text size={0} muted>
            {COPY_PROMPT_HELP}
          </Text>
        )}
      </Stack>
    )
  }

  return (
    <Stack space={5}>
      <Stack space={3}>
        <Text size={2} weight="semibold">
          This skill
        </Text>
        {aboutSkill.map((finding, i) => (
          <FindingCard key={i} finding={finding} />
        ))}
        {aboutSkill.length === 0 && <Text size={1}>No problems found with the description or test requests.</Text>}
        {noTestRequests}
      </Stack>

      <Stack space={3}>
        <Text size={2} weight="semibold">
          Similar skills
        </Text>
        <Text size={1} muted>
          Skills that do related work. Some overlap is normal; these are the ones worth a look.
        </Text>
        {aboutPairs.map((finding, i) => (
          <FindingCard key={i} finding={finding} />
        ))}
        {aboutPairs.length === 0 && <Text size={1}>None of the similar skills need changes.</Text>}
        {fine.length > 0 && (
          <Text size={1} muted>
            Also compared, nothing to change: {fine.join(', ')}.
          </Text>
        )}
        {partial && (
          <Text size={1} muted>
            Couldn’t search for similar skills this time, so this only compared skills already known to be similar.
            Compare again later for a full check.
          </Text>
        )}
      </Stack>

      {offersPrompts && (
        <Text size={0} muted>
          {COPY_PROMPT_HELP}
        </Text>
      )}
    </Stack>
  )
}
