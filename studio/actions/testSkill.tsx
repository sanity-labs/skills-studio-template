import React, {useState, useCallback, Suspense} from 'react'
import {useClient, type DocumentActionProps} from 'sanity'
import {PlayIcon, ThumbsUpIcon, ThumbsDownIcon} from '@sanity/icons'
import {
  Box,
  Stack,
  Card,
  Text,
  TextArea,
  Button,
  Flex,
  Label,
  Spinner,
} from '@sanity/ui'
import {defineQuery} from 'groq'
import {getPublishedId, isVersionId} from '../utils/documentIds'
import {useStreamdownStyles} from '../components/streamdownStyles'

// Lazy-load streamdown (ESM-only, breaks Sanity CLI in Node.js)
const LazyStreamdown = React.lazy(() =>
  import('streamdown').then((mod) => ({default: mod.Streamdown})),
)

const SKILL_FOR_TEST_QUERY = defineQuery(`*[_type == "skill" && _id == $id][0]{
  skillName, description, content,
  references[]->{filename, content}
}`)

/**
 * Dialog component that owns all test/grade state.
 * Extracted from the action return object so React can reconcile
 * the tree properly and preserve cursor position in TextAreas.
 */
function TestSkillDialog({
  documentId,
  onClose,
}: {
  documentId: string
  onClose: () => void
}) {
  const client = useClient({apiVersion: '2024-01-01'})
  const vxClient = client.withConfig({apiVersion: 'vX'})

  const [testPrompt, setTestPrompt] = useState('')
  const [responseText, setResponseText] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [grade, setGrade] = useState<'pass' | 'fail' | null>(null)
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useStreamdownStyles()

  const handleRun = useCallback(async () => {
    if (!testPrompt.trim()) return
    setIsRunning(true)
    setError(null)
    setResponseText('')
    setGrade(null)
    setNotes('')
    setSaved(false)

    try {
      // The copy on screen: the release version when the editor is inside a
      // release, the published skill otherwise.
      const readId = isVersionId(documentId) ? documentId : getPublishedId(documentId)
      const skill = await client.fetch(SKILL_FOR_TEST_QUERY, {id: readId})
      if (!skill) throw new Error('Skill not found')

      // Build full content: skill content + all references
      let fullContent = skill.content || ''
      if (skill.references) {
        for (const ref of skill.references) {
          if (ref) fullContent += `\n\n---\n## ${ref.filename}\n${ref.content}`
        }
      }

      const response = await vxClient.agent.action.prompt({
        instruction: `You have access to this skill:

---
name: $skillName
description: $description
---

$content

Use this skill to respond to the user's message. Follow the skill's instructions precisely.`,
        instructionParams: {
          skillName: skill.skillName,
          description: skill.description,
          content: fullContent,
        },
        userMessage: testPrompt,
      })

      const text =
        typeof response === 'string'
          ? response
          : (response as any)?.text || JSON.stringify(response)
      setResponseText(text)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRunning(false)
    }
  }, [testPrompt, documentId, client, vxClient])

  const handleSaveGrade = useCallback(async () => {
    if (!grade) return
    setIsSaving(true)
    try {
      // A reference always points at the published ID — a `versions.` _ref
      // would dangle the moment the release publishes.
      const publishedId = getPublishedId(documentId)
      await client.create({
        _type: 'skillEvalRun',
        skill: {_type: 'reference', _ref: publishedId},
        runType: 'single',
        trigger: 'manual',
        results: [
          {
            _key: 'result0',
            prompt: testPrompt,
            response: responseText,
            passRate: grade === 'pass' ? 1.0 : 0.0,
          },
        ],
        summary: {
          totalEvals: 1,
          passed: grade === 'pass' ? 1 : 0,
          failed: grade === 'pass' ? 0 : 1,
          passRate: grade === 'pass' ? 1.0 : 0.0,
        },
      })
      setSaved(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }, [grade, documentId, client, testPrompt, responseText])

  return (
    <Box padding={4}>
      <Stack space={4}>
        {/* Prompt input */}
        <Stack space={2}>
          <Label size={1}>Test Prompt</Label>
          <TextArea
            placeholder="Write a status update about..."
            value={testPrompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setTestPrompt(e.currentTarget.value)
            }
            rows={3}
            disabled={isRunning}
          />
        </Stack>

        <Flex justify="flex-end">
          <Button
            text={isRunning ? 'Running…' : 'Run Test'}
            icon={isRunning ? Spinner : PlayIcon}
            tone="primary"
            onClick={handleRun}
            disabled={!testPrompt.trim() || isRunning}
          />
        </Flex>

        {/* Error display */}
        {error && (
          <Card padding={3} radius={2} tone="critical">
            <Text size={1}>{error}</Text>
          </Card>
        )}

        {/* Loading indicator */}
        {isRunning && (
          <Flex align="center" justify="center" padding={4}>
            <Spinner muted />
          </Flex>
        )}

        {/* Response area */}
        {responseText && (
          <Stack space={2}>
            <Label size={1}>Response</Label>
            <Card padding={3} radius={2} border overflow="auto">
              <Box data-streamdown="">
                <Suspense fallback={<Spinner muted />}>
                  {/* Same reason as the preview view: Streamdown's controls
                      are laid out with Tailwind classes we don't load. */}
                  <LazyStreamdown controls={false}>{responseText}</LazyStreamdown>
                </Suspense>
              </Box>
            </Card>
          </Stack>
        )}

        {/* Grading section — only after response */}
        {responseText && !saved && (
          <Stack space={3}>
            <Label size={1}>Grade this response</Label>
            <Flex gap={2}>
              <Button
                text="Pass"
                icon={ThumbsUpIcon}
                tone={grade === 'pass' ? 'positive' : 'default'}
                mode={grade === 'pass' ? 'default' : 'ghost'}
                onClick={() => setGrade('pass')}
              />
              <Button
                text="Fail"
                icon={ThumbsDownIcon}
                tone={grade === 'fail' ? 'critical' : 'default'}
                mode={grade === 'fail' ? 'default' : 'ghost'}
                onClick={() => setGrade('fail')}
              />
            </Flex>

            <Stack space={2}>
              <Label size={0} muted>
                Notes (optional)
              </Label>
              <TextArea
                placeholder="Any observations about this response..."
                value={notes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setNotes(e.currentTarget.value)
                }
                rows={2}
              />
            </Stack>

            <Flex gap={2} justify="flex-end">
              <Button text="Close" mode="ghost" onClick={onClose} />
              <Button
                text={isSaving ? 'Saving…' : 'Save Grade'}
                tone="positive"
                disabled={!grade || isSaving}
                onClick={handleSaveGrade}
              />
            </Flex>
          </Stack>
        )}

        {/* Saved confirmation */}
        {saved && (
          <Card padding={3} radius={2} tone="positive">
            <Stack space={2}>
              <Text size={1} weight="bold">
                Grade saved!
              </Text>
              <Text size={1} muted>
                Result recorded as a {grade === 'pass' ? 'pass' : 'fail'}.
              </Text>
            </Stack>
          </Card>
        )}

        {/* Close button when no grading or after save */}
        {responseText && saved && (
          <Flex justify="flex-end">
            <Button text="Close" mode="ghost" onClick={onClose} />
          </Flex>
        )}
      </Stack>
    </Box>
  )
}

/**
 * Document action — just manages open/close state and renders the dialog component.
 */
export function TestSkillAction(props: DocumentActionProps) {
  const {id, published, onComplete} = props

  const [dialogOpen, setDialogOpen] = useState(false)

  const handleClose = useCallback(() => {
    setDialogOpen(false)
    if (onComplete) onComplete()
  }, [onComplete])

  // ALL hooks above — conditional return below
  if (!published) return null

  return {
    label: 'Test Skill',
    icon: PlayIcon,
    tone: 'primary' as const,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? {
          type: 'dialog' as const,
          header: 'Test Skill',
          onClose: handleClose,
          content: <TestSkillDialog documentId={id} onClose={handleClose} />,
        }
      : null,
  }
}
