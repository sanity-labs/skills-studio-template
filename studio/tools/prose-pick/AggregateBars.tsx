import {Stack, Flex, Text, Box} from '@sanity/ui'
import type {ProseTestSession, ModelFamily} from './types'
import type {PromptTally, SessionAggregate} from './aggregate'

interface Props {
  session: ProseTestSession
  aggregate: SessionAggregate
  /** Legacy labels — used only for old sessions with aIsClaude tally. */
  claudeLabel?: string
  gptLabel?: string
}

/** Theme colour per family — falls back to a neutral hue. */
const FAMILY_COLOR: Record<ModelFamily | 'other' | 'eq', string> = {
  claude: 'var(--card-badge-positive-bg-color, #2196f3)',
  gpt: 'var(--card-badge-caution-bg-color, #ff9800)',
  gemini: 'var(--card-badge-primary-bg-color, #8e44ad)',
  other: 'var(--card-muted-fg-color, #999)',
  eq: 'var(--card-muted-fg-color, #999)',
}

const FAMILY_LABEL: Record<ModelFamily | 'other', string> = {
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
  other: 'Other',
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

/**
 * Returns the rendered "segments" for one prompt — preferring the new
 * byFamily tally (any session with condition.modelId set) and falling
 * back to the legacy claude/gpt tally for old sessions.
 */
function segmentsFor(
  tally: PromptTally,
  legacyLabels: {claudeLabel: string; gptLabel: string},
): Array<{key: string; label: string; value: number; color: string}> {
  const byFamilyEntries = Object.entries(tally.byFamily).filter(([, v]) => (v ?? 0) > 0)
  if (byFamilyEntries.length > 0) {
    return byFamilyEntries.map(([family, value]) => ({
      key: family,
      label: FAMILY_LABEL[family as ModelFamily | 'other'] || family,
      value: value ?? 0,
      color: FAMILY_COLOR[family as ModelFamily | 'other'] || FAMILY_COLOR.other,
    }))
  }
  // Legacy fallback
  const seg = []
  if (tally.claude > 0) {
    seg.push({key: 'claude', label: legacyLabels.claudeLabel, value: tally.claude, color: FAMILY_COLOR.claude})
  }
  if (tally.gpt > 0) {
    seg.push({key: 'gpt', label: legacyLabels.gptLabel, value: tally.gpt, color: FAMILY_COLOR.gpt})
  }
  return seg
}

export function AggregateBars({
  session,
  aggregate,
  claudeLabel = 'Claude',
  gptLabel = 'GPT',
}: Props) {
  const pairs = session.pairs ?? []
  return (
    <Stack space={4}>
      {pairs.map((pair) => {
        const tally = aggregate.perPrompt[pair.promptId]
        if (!tally) return null
        const total = tally.voters
        const prompt = (session.prompts ?? []).find((p) => p.id === pair.promptId)
        const segs = segmentsFor(tally, {claudeLabel, gptLabel})
        return (
          <Stack key={pair.promptId} space={2}>
            <Flex justify="space-between" gap={3}>
              <Text size={1} weight="semibold">
                {prompt?.name || pair.promptId}
              </Text>
              <Text size={0} muted>
                n={total}
              </Text>
            </Flex>
            <Flex
              style={{
                height: 18,
                borderRadius: 4,
                overflow: 'hidden',
                background: 'var(--card-muted-bg-color, #f1f1f1)',
              }}
            >
              {segs.map((s) => (
                <Box
                  key={s.key}
                  style={{
                    width: `${pct(s.value, total)}%`,
                    background: s.color,
                  }}
                  title={`${s.label}: ${s.value}`}
                />
              ))}
              {tally.eq > 0 && (
                <Box
                  style={{
                    width: `${pct(tally.eq, total)}%`,
                    background: FAMILY_COLOR.eq,
                  }}
                  title={`Equivalent: ${tally.eq}`}
                />
              )}
            </Flex>
            <Flex gap={3} wrap="wrap">
              {segs.map((s) => (
                <Text key={s.key} size={0}>
                  <span style={{color: s.color}}>●</span> {s.label}: {s.value} (
                  {pct(s.value, total)}%)
                </Text>
              ))}
              {tally.eq > 0 && (
                <Text size={0} muted>
                  Equivalent: {tally.eq} ({pct(tally.eq, total)}%)
                </Text>
              )}
            </Flex>
          </Stack>
        )
      })}
    </Stack>
  )
}
