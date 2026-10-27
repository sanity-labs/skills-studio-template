import {Badge, Card, Flex, Stack, Text} from '@sanity/ui'
import type {GateFinding} from '../utils/skillGate'
import {CopyPromptButton} from './CopyPromptButton'

const TONE = {hold: 'critical', warn: 'caution', tip: 'default'} as const

/** A finding from the skill comparison: what, why it matters, what to do. */
export function FindingCard({finding}: {finding: GateFinding}) {
  return (
    <Card padding={3} radius={2} border tone={TONE[finding.level]}>
      <Stack space={3}>
        <Flex gap={2} align="flex-start" justify="space-between">
          <Text size={1} weight="semibold">
            {finding.message}
          </Text>
          {finding.level === 'hold' && (
            <Badge tone="critical" fontSize={0}>
              Pauses publishing
            </Badge>
          )}
          {finding.level === 'tip' && (
            <Badge tone="primary" fontSize={0}>
              Tip
            </Badge>
          )}
        </Flex>
        {finding.why && (
          <Text size={1} muted>
            {finding.why}
          </Text>
        )}
        {finding.todo && <Text size={1}>{finding.todo}</Text>}
        {finding.fixPrompt && (
          <Flex>
            <CopyPromptButton prompt={finding.fixPrompt} />
          </Flex>
        )}
      </Stack>
    </Card>
  )
}
