/**
 * Generate-pairs document action.
 *
 * Runs each prompt through each condition's (model + skill stack) setup,
 * randomizes A/B per prompt, and populates the session's `pairs[]`.
 *
 * Constraints:
 * - Only on `proseTestSession` docs
 * - Session must have ≥ 1 prompt
 * - Session must have exactly 2 conditions (the typical A/B comparison).
 *   Sessions with 3+ conditions are skipped with a clear error — those
 *   need a "generate all combinations" UI which is out of scope.
 * - Each condition must have modelId set
 * - The selected models' provider keys must be configured
 *
 * Behavior:
 * - Loads the skill content for each condition's skills[] (concatenates
 *   SKILL.md + each reference file, mirrors RunAllButton's
 *   skillInstruction shape)
 * - Calls generateText() per (prompt × condition) — that's
 *   prompts.length × 2 API calls per session
 * - Tracks progress as it goes
 * - For each prompt: randomly assigns conditions to A/B sides
 * - Writes the new pairs[] via sanity.action.document.edit (lands on
 *   the draft; publishes are still manual)
 * - If pairs[] already exists, asks for confirmation before replacing
 */

import {useCallback, useEffect, useMemo, useState} from 'react'
import {useClient, type DocumentActionProps} from 'sanity'
import {defineQuery} from 'groq'
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Spinner,
  Stack,
  Text,
} from '@sanity/ui'
import {SparklesIcon, WarningOutlineIcon} from '@sanity/icons'
import {generateText, findModel} from '../utils/aiProviders'
import type {AISecrets} from '../utils/aiProviders'
import {useAISecrets, AIProvidersSettingsButton} from '../utils/aiSecrets'
import {resolveWriteTarget} from '../utils/documentIds'
import type {
  ProseCondition,
  ProsePair,
  ProsePrompt,
  ProseTestSession,
} from '../tools/prose-pick/types'

// We fetch the session via client.fetch (not GROQ projection) so we get
// every field including the skills[] references which we'll resolve
// separately.
const SESSION_FOR_GENERATE_QUERY = defineQuery(`
  *[_type == "proseTestSession" && _id == $id][0]{
    _id,
    title,
    prompts,
    conditions[]{
      _key,
      conditionId,
      label,
      modelId,
      "skills": skills[]->{ _id, skillName, content, references[]->{filename, content} },
      notes,
    },
    pairs,
  }
`)

type ConditionWithSkills = Omit<ProseCondition, 'skills'> & {
  skills?: Array<{
    _id: string
    skillName: string | null
    content: string | null
    references: Array<{filename: string | null; content: string | null}> | null
  }>
}

// `_type` and `status` are omitted because the projection above doesn't select
// them — nothing in this dialog reads them, and claiming them made the cast
// from the query result a lie.
type SessionForGenerate = Omit<ProseTestSession, 'conditions' | '_type' | 'status'> & {
  conditions: ConditionWithSkills[]
}

/**
 * Concatenate the skill stack into a single system prompt — mirrors
 * RunAllButton's skillInstruction shape so generated prose matches what
 * users see in Skill Lab.
 */
function buildSystemPrompt(condition: ConditionWithSkills): string | undefined {
  const skills = condition.skills ?? []
  if (skills.length === 0 && !condition.notes) return undefined
  const skillBlocks = skills.map((s) => {
    const refs = (s.references ?? [])
      .map((r) => `\n--- ${r.filename} ---\n${r.content ?? ''}`)
      .join('\n')
    return `### Skill: ${s.skillName ?? '(unnamed)'}\n\n${s.content ?? ''}${refs}`
  })
  const stackBlock = skillBlocks.join('\n\n')
  const notesBlock = condition.notes ? `\n\n### Notes\n${condition.notes}` : ''
  return `${stackBlock}${notesBlock}` || undefined
}

function secretForProvider(secrets: AISecrets, modelId: string): boolean {
  const model = findModel(modelId)
  if (!model) return false
  if (model.provider === 'anthropic') return Boolean(secrets.anthropicKey)
  if (model.provider === 'openai') return Boolean(secrets.openaiKey)
  if (model.provider === 'google') return Boolean(secrets.geminiKey)
  return false
}

function shuffleAB(): 'AB' | 'BA' {
  return Math.random() < 0.5 ? 'AB' : 'BA'
}

function shortKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

function GenerateDialog({
  documentId,
  onClose,
}: {
  documentId: string
  onClose: () => void
}) {
  const client = useClient({apiVersion: '2024-01-01'})
  const vxClient = client.withConfig({apiVersion: 'vX'})
  const {secrets, hasAnyKey} = useAISecrets()

  const [session, setSession] = useState<SessionForGenerate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState('')
  const [confirmedReplace, setConfirmedReplace] = useState(false)
  const [done, setDone] = useState(false)

  // Load session
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // Read the copy the editor is on — the release version inside a
        // release, otherwise the draft where authoring happens, falling back
        // to the published session.
        const target = resolveWriteTarget(documentId)
        const open = await client.fetch(SESSION_FOR_GENERATE_QUERY, {id: target.id})
        const data =
          open ?? (await client.fetch(SESSION_FOR_GENERATE_QUERY, {id: target.publishedId}))
        if (cancelled) return
        if (!data) throw new Error('Session not found')
        setSession(data as SessionForGenerate)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [documentId, client])

  // Validate before we let the user click generate
  const validation = useMemo(() => {
    if (!session) return null
    const errors: string[] = []
    const prompts = session.prompts ?? []
    const conditions = session.conditions ?? []
    if (prompts.length === 0) errors.push('Add at least one prompt before generating.')
    if (conditions.length < 2)
      errors.push('Add exactly two conditions (e.g. one per model or skill variant).')
    if (conditions.length > 2)
      errors.push(
        'Generate-pairs only handles 2-condition sessions. For 3+ conditions, populate pairs[] manually for now.',
      )
    for (const cond of conditions) {
      if (!cond.modelId) {
        errors.push(`Condition "${cond.label || cond.conditionId}" is missing a model — pick one in the condition editor.`)
      } else if (!findModel(cond.modelId)) {
        errors.push(`Condition "${cond.label || cond.conditionId}" references unknown model ${cond.modelId}.`)
      } else if (!secretForProvider(secrets, cond.modelId)) {
        const m = findModel(cond.modelId)
        errors.push(`No API key configured for ${m?.label ?? cond.modelId}'s provider (${m?.provider ?? '?'}). Add one in API Keys.`)
      }
    }
    return errors
  }, [session, secrets])

  const hasExistingPairs = (session?.pairs?.length ?? 0) > 0
  const blocked = validation && validation.length > 0
  const needsConfirm = hasExistingPairs && !confirmedReplace

  const handleGenerate = useCallback(async () => {
    if (!session || blocked) return
    setGenerating(true)
    setError(null)
    setProgress('')

    try {
      const prompts: ProsePrompt[] = session.prompts ?? []
      const conditions = session.conditions ?? []
      const condA = conditions[0]
      const condB = conditions[1]

      const systemA = buildSystemPrompt(condA)
      const systemB = buildSystemPrompt(condB)

      const newPairs: ProsePair[] = []

      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i]
        setProgress(`Generating prompt ${i + 1}/${prompts.length}: ${prompt.name}`)

        // Run both conditions in parallel — they hit different providers
        // most of the time, and even when they share one, the existing
        // retry-with-backoff handles rate limits.
        const [textCondA, textCondB] = await Promise.all([
          generateText({
            model: condA.modelId!,
            system: systemA,
            user: prompt.text,
            secrets,
          }),
          generateText({
            model: condB.modelId!,
            system: systemB,
            user: prompt.text,
            secrets,
          }),
        ])

        const order = shuffleAB()
        const aSide = order === 'AB'
          ? {conditionId: condA.conditionId, text: textCondA}
          : {conditionId: condB.conditionId, text: textCondB}
        const bSide = order === 'AB'
          ? {conditionId: condB.conditionId, text: textCondB}
          : {conditionId: condA.conditionId, text: textCondA}

        newPairs.push({
          _key: shortKey(),
          promptId: prompt.id,
          A: aSide,
          B: bSide,
        })
      }

      const target = resolveWriteTarget(documentId)
      setProgress(
        target.kind === 'version' ? 'Saving pairs to the release…' : 'Saving pairs to draft…',
      )

      if (target.kind === 'version') {
        // The version document already exists; patch it in place rather than
        // routing the write through a draft that would never be read.
        await client.patch(target.id).set({pairs: newPairs}).commit()
      } else {
        await vxClient.action({
          actionType: 'sanity.action.document.edit',
          publishedId: target.publishedId,
          draftId: target.id,
          patch: {
            set: {pairs: newPairs},
          },
        })
      }

      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
      setProgress('')
    }
  }, [session, secrets, blocked, documentId, client, vxClient])

  if (loading) {
    return (
      <Box padding={4}>
        <Flex justify="center" align="center" padding={5}>
          <Spinner muted />
        </Flex>
      </Box>
    )
  }

  if (error && !generating) {
    return (
      <Box padding={4}>
        <Card padding={3} radius={2} tone="critical">
          <Text size={1}>{error}</Text>
        </Card>
        <Flex justify="flex-end" gap={2} marginTop={3}>
          <Button text="Close" mode="ghost" onClick={onClose} />
        </Flex>
      </Box>
    )
  }

  if (done) {
    return (
      <Box padding={4}>
        <Stack space={4}>
          <Card padding={3} radius={2} tone="positive">
            <Stack space={2}>
              <Heading size={1}>Generated</Heading>
              <Text size={1}>
                Pairs are saved to the draft. Review them in the document
                editor, then publish to make the session available in the
                Prose Pick tool.
              </Text>
            </Stack>
          </Card>
          <Flex justify="flex-end">
            <Button text="Close" tone="primary" onClick={onClose} />
          </Flex>
        </Stack>
      </Box>
    )
  }

  return (
    <Box padding={4}>
      <Stack space={4}>
        {!hasAnyKey && (
          <Card padding={3} radius={2} tone="caution">
            <Stack space={2}>
              <Text size={1}>No API keys configured yet.</Text>
              <AIProvidersSettingsButton tone="primary" mode="default" />
            </Stack>
          </Card>
        )}

        {validation && validation.length > 0 && (
          <Card padding={3} radius={2} tone="caution">
            <Stack space={2}>
              <Flex align="center" gap={2}>
                <Text size={1} weight="semibold">
                  <WarningOutlineIcon /> Fix before generating
                </Text>
              </Flex>
              {validation.map((msg, i) => (
                <Text key={i} size={1}>
                  &bull; {msg}
                </Text>
              ))}
            </Stack>
          </Card>
        )}

        {session && validation && validation.length === 0 && (
          <Card padding={3} radius={2} tone="transparent" border>
            <Stack space={3}>
              <Heading size={1}>Ready to generate</Heading>
              <Text size={1} muted>
                Will run {session.prompts?.length ?? 0} prompts &times;{' '}
                {session.conditions?.length ?? 0} conditions ={' '}
                <strong>
                  {(session.prompts?.length ?? 0) * (session.conditions?.length ?? 0)} API calls
                </strong>
                .
              </Text>
              <Stack space={1}>
                {(session.conditions ?? []).map((c) => {
                  const m = c.modelId ? findModel(c.modelId) : null
                  const skillCount = c.skills?.length ?? 0
                  return (
                    <Text size={1} muted key={c.conditionId}>
                      &bull; <strong>{c.label}</strong> &mdash; {m?.label ?? c.modelId} (
                      {skillCount === 0
                        ? 'no skills'
                        : skillCount === 1
                          ? '1 skill'
                          : `${skillCount} skills`}
                      )
                    </Text>
                  )
                })}
              </Stack>
            </Stack>
          </Card>
        )}

        {hasExistingPairs && !confirmedReplace && !blocked && (
          <Card padding={3} radius={2} tone="caution">
            <Stack space={2}>
              <Text size={1}>
                This session already has {session?.pairs?.length} pair
                {session?.pairs?.length === 1 ? '' : 's'}. Generating will
                replace them.
              </Text>
              <Flex gap={2}>
                <Button
                  text="Replace existing pairs"
                  tone="caution"
                  onClick={() => setConfirmedReplace(true)}
                />
                <Button text="Cancel" mode="ghost" onClick={onClose} />
              </Flex>
            </Stack>
          </Card>
        )}

        {generating && (
          <Card padding={3} radius={2} tone="transparent" border>
            <Flex align="center" gap={3}>
              <Spinner muted />
              <Text size={1}>{progress || 'Working…'}</Text>
            </Flex>
          </Card>
        )}

        <Flex justify="flex-end" gap={2}>
          <Button text="Cancel" mode="ghost" onClick={onClose} disabled={generating} />
          <Button
            text={generating ? 'Generating…' : 'Generate pairs'}
            icon={SparklesIcon}
            tone="primary"
            disabled={Boolean(blocked) || generating || needsConfirm}
            onClick={handleGenerate}
          />
        </Flex>
      </Stack>
    </Box>
  )
}

export function GeneratePairsAction(props: DocumentActionProps) {
  const {id, onComplete} = props
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleClose = useCallback(() => {
    setDialogOpen(false)
    if (onComplete) onComplete()
  }, [onComplete])

  return {
    label: 'Generate pairs',
    icon: SparklesIcon,
    tone: 'primary' as const,
    disabled: dialogOpen,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? {
          type: 'dialog' as const,
          header: 'Generate pairs',
          width: 'medium' as const,
          onClose: handleClose,
          content: <GenerateDialog documentId={id} onClose={handleClose} />,
        }
      : null,
  }
}
