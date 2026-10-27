import {useEffect, useState} from 'react'
import {Badge, Box, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {PlayIcon} from '@sanity/icons'
import {useClient, useFormValue} from 'sanity'
import {getPublishedId} from '../utils/documentIds'
import {testRequestsPrompt} from '../utils/fixPrompts'
import {CopyPromptButton} from './CopyPromptButton'

/**
 * Eval status for the skill being edited: how many rows of each kind it has,
 * and when it last ran.
 *
 * The state worth surfacing is "no trigger rows" — most skills have none, and
 * nothing in the Studio says so today. Once publish is gated on a passing
 * selection run, an author needs to see why a publish would be blocked
 * *before* they hit publish, not after.
 *
 * Counts only; grading lives in the Eval Runner tool. Fail-soft like the other
 * banners — a query error hides it rather than blocking authoring.
 */

const STATUS_QUERY = `{
  "trigger": count(*[_type == "skillEval" && skill._ref == $id && kind == "trigger"]),
  "triggerRunnable": count(*[_type == "skillEval" && skill._ref == $id && kind == "trigger"
    && count(requiresConnectors) == 0 && (defined(expectedSkill) || expectNone == true)]),
  "needsExpectation": count(*[_type == "skillEval" && skill._ref == $id && kind == "trigger" && needsExpectation == true]),
  "behavior": count(*[_type == "skillEval" && skill._ref == $id && kind != "trigger"]),
  "lastRun": *[_type == "skillEvalRun" && skill._ref == $id] | order(_createdAt desc)[0]{
    _createdAt, model, "passRate": summary.passRate, "total": summary.totalEvals
  }
}`

type Status = {
  trigger: number
  triggerRunnable: number
  needsExpectation: number
  behavior: number
  lastRun: {_createdAt: string; model?: string; passRate?: number; total?: number} | null
}

export function EvalStatusField() {
  const client = useClient({apiVersion: '2025-02-19'})
  // Eval rows and runs reference the published skill ID, so a `drafts.` or
  // `versions.<releaseId>.` ID has to be normalized or every count reads 0.
  const formId = useFormValue(['_id']) as string | undefined
  const id = formId ? getPublishedId(formId) : undefined
  const skillName = useFormValue(['skillName']) as string | undefined
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    client
      .fetch<Status>(STATUS_QUERY, {id})
      .then((res) => {
        if (!cancelled) setStatus(res)
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('EvalStatusField: query failed, hiding banner', err)
      })
    return () => {
      cancelled = true
    }
  }, [client, id])

  if (!status) return null

  const {trigger, triggerRunnable, needsExpectation, behavior, lastRun} = status
  const noTriggers = trigger === 0
  const runUrl = `/eval-runner?skill=${id}`

  return (
    <Stack space={3}>
      <Card padding={3} radius={2} border tone={noTriggers ? 'caution' : 'default'}>
        <Stack space={3}>
          <Flex align="center" gap={2} wrap="wrap">
            <Badge tone={noTriggers ? 'caution' : 'positive'} fontSize={0}>
              {trigger} test {trigger === 1 ? 'request' : 'requests'}
            </Badge>
            <Badge tone="default" fontSize={0}>
              {behavior} answer {behavior === 1 ? 'test' : 'tests'}
            </Badge>
            {needsExpectation > 0 && (
              <Badge tone="caution" fontSize={0}>
                {needsExpectation} unfinished
              </Badge>
            )}
            <Box flex={1} />
            <Button
              as="a"
              href={runUrl}
              icon={PlayIcon}
              text="Eval Runner"
              mode="ghost"
              fontSize={1}
              padding={2}
            />
          </Flex>

          {noTriggers ? (
            <Stack space={3}>
              <Text size={1} weight="semibold">
                This skill has no test requests yet.
              </Text>
              <Text size={1} muted>
                A test request is something a person might ask, plus the skill that should handle
                it. Without them, nothing checks that people’s requests reach this skill rather than
                a similar one — the most common problem people report.
              </Text>
              <Text size={1}>
                Add about six: three requests this skill should handle, two that sound similar but
                belong to another skill, and one that could go either way.
              </Text>
              {skillName && id && (
                <Flex>
                  <CopyPromptButton prompt={testRequestsPrompt({id, name: skillName})} />
                </Flex>
              )}
            </Stack>
          ) : (
            <Text size={1} muted>
              {triggerRunnable} of {trigger} test {trigger === 1 ? 'request runs' : 'requests run'}{' '}
              automatically
              {triggerRunnable < trigger ? '; the rest need connected tools, like Slack.' : '.'}
              {needsExpectation > 0 &&
                ` ${needsExpectation} imported test ${needsExpectation === 1 ? 'request still needs' : 'requests still need'} “Skill that should fire” filled in.`}
            </Text>
          )}

          {lastRun && (
            <Text size={0} muted>
              Last run {new Date(lastRun._createdAt).toLocaleDateString()}
              {lastRun.model ? ` · ${lastRun.model}` : ''}
              {typeof lastRun.passRate === 'number'
                ? ` · ${Math.round(lastRun.passRate * 100)}% of ${lastRun.total ?? '?'}`
                : ''}
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  )
}
