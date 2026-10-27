import {useCallback, useState} from 'react'
import type {DocumentActionProps} from 'sanity'
import {LinkIcon} from '@sanity/icons'
import {Box, Button, Card, Flex, Spinner, Stack, Text} from '@sanity/ui'
import type {CheckedSkill} from '../utils/overlapCheckData'
import {AIProvidersEmptyState} from '../utils/aiSecrets'
import {COMPARE_ACTION_LABEL} from '../utils/skillGate'
import {relationFix} from '../utils/fixPrompts'
import {useCompareSkill} from '../components/useSkillComparison'
import {ComparisonResults} from '../components/ComparisonResults'

function CompareDialog({current, onClose}: {current: CheckedSkill; onClose: () => void}) {
  const compare = useCompareSkill(current)
  const {phase, progress, error, outcome, run} = compare

  if (compare.keysLoading) return <Spinner />
  if (!compare.hasKey) {
    return <AIProvidersEmptyState message="Comparing skills needs an OpenRouter API key. Add one to continue." />
  }

  return (
    <Box padding={4}>
      <Stack space={4}>
        {phase === 'idle' && (
          <>
            <Text size={1}>
              AI assistants decide which skill to use by reading skill descriptions. This compares{' '}
              {current.skillName} with the skills most like it, to check that:
            </Text>
            <Stack space={2} paddingLeft={2}>
              <Text size={1}>• the AI picks this skill for the right requests</Text>
              <Text size={1}>• it doesn’t repeat or contradict similar skills</Text>
            </Stack>
            <Text size={1} muted>
              It uses the skill as it is now, including changes you haven’t published. Takes about half a minute.
            </Text>
            <Flex gap={2}>
              <Button text="Compare" tone="primary" onClick={run} />
              <Button text="Cancel" mode="ghost" onClick={onClose} />
            </Flex>
          </>
        )}
        {phase === 'running' && (
          <Flex gap={3} align="center">
            <Spinner />
            <Text size={1}>{progress}…</Text>
          </Flex>
        )}
        {phase === 'error' && (
          <Card padding={3} tone="critical" radius={2}>
            <Stack space={3}>
              <Text size={1}>{error}</Text>
              <Flex>
                <Button text="Try again" onClick={run} />
              </Flex>
            </Stack>
          </Card>
        )}
        {phase === 'done' && outcome && (
          <ComparisonResults
            gate={outcome.gate}
            skill={{id: outcome.result.self._id, name: outcome.result.self.name}}
            hasTestRequests={Boolean(outcome.result.quality.routing)}
            fine={outcome.result.relations
              .filter((r) => !relationFix(r))
              .map((r) => outcome.result.names[r.skillA._ref === outcome.result.self._id ? r.skillB._ref : r.skillA._ref])
              .filter(Boolean)}
            partial={outcome.partial}
          />
        )}
      </Stack>
    </Box>
  )
}

export function CheckOverlapAction(props: DocumentActionProps) {
  const {onComplete} = props
  const current = (props.version ?? props.draft ?? props.published) as CheckedSkill | null
  const [open, setOpen] = useState(false)

  const handleClose = useCallback(() => {
    setOpen(false)
    onComplete()
  }, [onComplete])

  // ALL hooks above — conditional return below
  if (!current?.skillName || !current.description) return null

  return {
    label: COMPARE_ACTION_LABEL,
    icon: LinkIcon,
    onHandle: () => setOpen(true),
    dialog: open
      ? {
          type: 'dialog' as const,
          header: `Compare ${current.skillName} with other skills`,
          onClose: handleClose,
          width: 'medium' as const,
          content: <CompareDialog current={current} onClose={handleClose} />,
        }
      : null,
  }
}
