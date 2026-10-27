import {useCallback, useState} from 'react'
import {Badge, Box, Button, Card, Flex, Spinner, Stack, Text, TextArea, useToast} from '@sanity/ui'
import {LinkIcon} from '@sanity/icons'
import {useClient, useCurrentUser, useFormValue} from 'sanity'
import {getPublishedId} from '../utils/documentIds'
import {formatRelativeTime} from '../utils/formatRelativeTime'
import {AIProvidersSettingsButton} from '../utils/aiSecrets'
import {allowPublishing} from '../utils/overlapCheckData'
import type {GateFinding} from '../utils/skillGate'
import {ComparisonResults} from './ComparisonResults'
import {useCompareSkill, useSkillGate} from './useSkillComparison'

/**
 * Lets someone publish past a pause by saying why. The reason is saved on the
 * skill's comparison results; the snapshot is refreshed, which clears the
 * validation error that disables Publish.
 */
function AllowPublishing({
  skill,
  checked,
  holds,
}: {
  skill: {id: string; name: string}
  checked: {descriptionHash: string; bodyHash: string}
  holds: GateFinding[]
}) {
  const client = useClient({apiVersion: 'v2025-02-19'})
  const user = useCurrentUser()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await allowPublishing(client, skill, checked, {
        reason: reason.trim(),
        by: user?.name ?? user?.email ?? user?.id,
        findings: holds.map((f) => f.message),
      })
      toast.push({status: 'success', title: 'Publishing allowed', description: 'Your reason is saved with the skill.'})
      setOpen(false)
    } catch (err) {
      toast.push({
        status: 'error',
        title: 'Couldn’t save your reason',
        description: `${err instanceof Error ? err.message : String(err)} Try again.`,
      })
    } finally {
      setSaving(false)
    }
  }, [client, skill, checked, reason, user, holds, toast])

  if (!open) {
    return (
      <Flex gap={2} align="center" wrap="wrap">
        <Text size={1}>Publishing is paused until this is sorted out.</Text>
        <Button text="Allow publishing…" mode="ghost" tone="critical" fontSize={1} padding={2} onClick={() => setOpen(true)} />
      </Flex>
    )
  }
  return (
    <Stack space={2}>
      <Text size={1} weight="semibold">
        Why should this be published anyway?
      </Text>
      <TextArea
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
        placeholder="For example: This skill and fpl-feature-request-triage are for different teams. Both descriptions say which one to use."
      />
      <Text size={1} muted>
        Your reason is saved with the skill so others can see it. It applies to this description only.
      </Text>
      <Flex gap={2}>
        <Button text="Allow publishing" tone="critical" disabled={!reason.trim() || saving} loading={saving} onClick={save} />
        <Button text="Cancel" mode="ghost" onClick={() => setOpen(false)} />
      </Flex>
    </Stack>
  )
}

/**
 * The last comparison with other skills, at the top of the form, with a
 * button to run it again. Same results and same check as the "Compare with
 * other skills" action; this is where authors see them without looking for it.
 *
 * Fail-soft like the other banners: if the results can't be read it hides.
 */
export function ComparisonPanelField() {
  const formId = useFormValue(['_id']) as string | undefined
  const skillName = useFormValue(['skillName']) as string | undefined
  const title = useFormValue(['title']) as string | undefined
  const description = useFormValue(['description']) as string | undefined
  const content = useFormValue(['content']) as string | undefined

  const id = formId ?? ''
  const gate = useSkillGate({id, skillName, description, content})
  const compare = useCompareSkill({_id: id, skillName, title, description, content})

  if (!formId || !skillName || !description) return null
  if (gate.loading && !gate.result) return null
  if (!gate.result && compare.phase !== 'running') return null

  const running = compare.phase === 'running'
  const checkedAt = gate.quality?.lint?.checkedAt
  const stale = gate.freshness === 'stale'
  const never = gate.freshness === 'never'
  const findings = gate.result?.findings.filter((f) => f.about !== 'freshness') ?? []
  const holds = findings.filter((f) => f.level === 'hold')
  const warnings = findings.filter((f) => f.level === 'warn').length
  const tips = findings.filter((f) => f.level === 'tip').length
  const tone = never || stale ? 'caution' : holds.length ? 'critical' : warnings ? 'caution' : 'positive'
  const badge = holds.length
    ? {tone: 'critical' as const, text: 'Publishing paused'}
    : warnings
      ? {tone: 'caution' as const, text: `${warnings} to look at`}
      : {tone: 'positive' as const, text: tips ? `No problems · ${tips} ${tips === 1 ? 'tip' : 'tips'}` : 'No problems'}

  const action = compare.keysLoading ? null : compare.hasKey ? (
    <Button
      icon={LinkIcon}
      text={never ? 'Compare now' : 'Compare again'}
      tone={never || stale ? 'primary' : 'default'}
      mode={never || stale ? 'default' : 'ghost'}
      fontSize={1}
      padding={2}
      disabled={running}
      onClick={compare.run}
    />
  ) : (
    <AIProvidersSettingsButton text="Add OpenRouter key to compare" />
  )

  return (
    <Card padding={3} radius={2} border tone={tone}>
      <Stack space={3}>
        <Flex align="center" gap={2} wrap="wrap">
          <Text size={1} weight="semibold">
            Compared with other skills
          </Text>
          {checkedAt && !never && (
            <Text size={1} muted>
              {formatRelativeTime(checkedAt)}
            </Text>
          )}
          {!never && !stale && (
            <Badge tone={badge.tone} fontSize={0}>
              {badge.text}
            </Badge>
          )}
          {stale && (
            <Badge tone="caution" fontSize={0}>
              Out of date
            </Badge>
          )}
          <Box flex={1} />
          {action}
        </Flex>

        {running && (
          <Flex gap={2} align="center">
            <Spinner />
            <Text size={1}>{compare.progress}…</Text>
          </Flex>
        )}
        {compare.phase === 'error' && (
          <Card padding={2} radius={2} tone="critical">
            <Text size={1}>{compare.error}</Text>
          </Card>
        )}

        {!running && never && (
          <Text size={1} muted>
            This skill hasn’t been compared with other skills yet. Comparing checks that the AI picks this skill for the
            right requests, and that it doesn’t repeat or contradict similar skills. It takes about half a minute.
          </Text>
        )}

        {!running && stale && (
          <Text size={1}>
            You’ve changed the {gate.quality?.lint?.descriptionHash !== gate.descriptionHash ? 'description' : 'content'}{' '}
            since this skill was last compared. Compare again to update the results; until then, the results below are
            from before your changes.
          </Text>
        )}

        {!running && !never && holds.length > 0 && gate.descriptionHash && gate.bodyHash !== null && (
          <AllowPublishing
            skill={{id: getPublishedId(id), name: skillName}}
            checked={{descriptionHash: gate.descriptionHash, bodyHash: gate.bodyHash}}
            holds={holds}
          />
        )}

        {!running && !never && gate.result && (
          <Box style={stale ? {opacity: 0.6} : undefined}>
            <ComparisonResults
              gate={gate.result}
              skill={{id: getPublishedId(id), name: skillName}}
              hasTestRequests={Boolean(gate.quality?.routing)}
              compact
            />
          </Box>
        )}
      </Stack>
    </Card>
  )
}
