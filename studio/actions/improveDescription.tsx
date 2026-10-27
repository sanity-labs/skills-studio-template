import {useState, useCallback, useEffect} from 'react'
import {useClient, type DocumentActionProps} from 'sanity'
import {SparklesIcon} from '@sanity/icons'
import {Box, Stack, Text, Button, Card, Flex, Label, Spinner} from '@sanity/ui'
import {defineQuery} from 'groq'
import {resolveWriteTarget} from '../utils/documentIds'

const SKILL_FOR_ANALYSIS_QUERY = defineQuery(`*[_type == "skill" && _id == $id][0]{
  skillName, description, content,
  references[]->{filename, content}
}`)

type AnalysisResult = {
  currentAnalysis: string
  suggestedDescription: string
  triggerPhrases: string[]
  reasoning: string
}

/**
 * Dialog component that owns all analysis/result state.
 * Extracted from the action return object so React can reconcile
 * the tree properly and avoid remount issues.
 */
function ImproveDescriptionDialog({
  documentId,
  currentDescription,
  onClose,
}: {
  documentId: string
  currentDescription: string
  onClose: () => void
}) {
  const client = useClient({apiVersion: '2024-01-01'})
  const vxClient = client.withConfig({apiVersion: 'vX'})

  const [isAnalyzing, setIsAnalyzing] = useState(true)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  // Run analysis on mount
  useEffect(() => {
    let cancelled = false

    async function analyze() {
      try {
        // Inside a release, analyze the version the editor is looking at;
        // otherwise the published skill, as before.
        const target = resolveWriteTarget(documentId)
        const skill = await client.fetch(SKILL_FOR_ANALYSIS_QUERY, {
          id: target.kind === 'version' ? target.id : target.publishedId,
        })

        if (cancelled) return
        if (!skill) throw new Error('Skill not found')

        const refSummary = (skill.references || [])
          .map(
            (r: any) =>
              `- ${r.filename}: ${(r.content || '').slice(0, 200)}...`,
          )
          .join('\n')

        const response = await vxClient.agent.action.prompt({
          instruction: `You are a skill description optimizer. A skill's description determines when AI agents activate it — it's the primary trigger mechanism.

Analyze this skill and suggest an improved description that:
- Is written in third person, never "I" or "you"
- States what the skill does, then "Use when ..." with the concrete requests,
  phrases and file types that should reach it
- Names what it is NOT for when a sibling skill handles a neighbouring
  request, and names that sibling
- Uses plain wording: no "make sure to", no "always use", no urgency. Trigger
  accuracy is measured by eval rows, not asserted in the text
- Stays well under 1024 characters (the specification limit; documentation
  examples run 141-163)

Current description:
$description

Skill content (first 3000 chars):
$content

Reference files:
$references

Respond with JSON only (no markdown fences):
{
  "currentAnalysis": "Brief analysis of current description's strengths and weaknesses",
  "suggestedDescription": "The improved description text",
  "triggerPhrases": ["list", "of", "phrases", "that", "should", "activate", "this", "skill"],
  "reasoning": "Why these changes improve trigger accuracy"
}`,
          instructionParams: {
            description: currentDescription || '(none)',
            content: (skill.content || '').substring(0, 3000),
            references: refSummary || '(none)',
          },
          userMessage:
            'Optimize this skill description for trigger accuracy.',
        })

        if (cancelled) return

        const text =
          typeof response === 'string'
            ? response
            : (response as any)?.text || JSON.stringify(response)
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('Could not parse response as JSON')
        const parsed = JSON.parse(jsonMatch[0])
        setResult(parsed)
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) {
          setIsAnalyzing(false)
        }
      }
    }

    analyze()

    return () => {
      cancelled = true
    }
  }, [documentId, currentDescription, client, vxClient])

  const handleAccept = useCallback(async () => {
    if (!result) return
    setIsApplying(true)
    try {
      const target = resolveWriteTarget(documentId)
      if (target.kind === 'version') {
        // A release version is a real document and already exists — patch it
        // directly. The document.edit action would have written to
        // `drafts.versions.<releaseId>.<id>`: a document nothing reads.
        await client
          .patch(target.id)
          .set({description: result.suggestedDescription})
          .commit()
      } else {
        await vxClient.action({
          actionType: 'sanity.action.document.edit',
          publishedId: target.publishedId,
          draftId: target.id,
          patch: {
            set: {description: result.suggestedDescription},
          },
        })
      }
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsApplying(false)
    }
  }, [result, documentId, client, vxClient, onClose])

  // Analyzing state
  if (isAnalyzing) {
    return (
      <Box padding={4}>
        <Flex align="center" justify="center" padding={5}>
          <Spinner muted />
        </Flex>
        <Text align="center" muted size={1}>
          Using Agent Actions to analyze your skill and suggest
          improvements…
        </Text>
      </Box>
    )
  }

  // Error state
  if (error) {
    return (
      <Box padding={4}>
        <Card padding={3} radius={2} tone="critical">
          <Text size={1}>{error}</Text>
        </Card>
      </Box>
    )
  }

  // Result state
  if (result) {
    return (
      <Box padding={4}>
        <Stack space={4}>
          <Stack space={2}>
            <Label size={0} muted>
              Analysis
            </Label>
            <Text size={1}>{result.currentAnalysis}</Text>
          </Stack>

          <Card padding={3} radius={2} tone="caution">
            <Stack space={2}>
              <Label size={0} muted>
                Current Description
              </Label>
              <Text size={1}>{currentDescription || '(none)'}</Text>
            </Stack>
          </Card>

          <Card padding={3} radius={2} tone="positive">
            <Stack space={2}>
              <Label size={0} muted>
                Suggested Description
              </Label>
              <Text size={1}>{result.suggestedDescription}</Text>
            </Stack>
          </Card>

          <Stack space={2}>
            <Label size={0} muted>
              Trigger Phrases
            </Label>
            <Text size={1} muted>
              {result.triggerPhrases.join(', ')}
            </Text>
          </Stack>

          <Stack space={2}>
            <Label size={0} muted>
              Reasoning
            </Label>
            <Text size={1} muted>
              {result.reasoning}
            </Text>
          </Stack>

          <Flex gap={2} justify="flex-end">
            <Button text="Dismiss" mode="ghost" onClick={onClose} />
            <Button
              text={isApplying ? 'Applying…' : 'Accept Suggestion'}
              tone="positive"
              disabled={isApplying}
              onClick={handleAccept}
            />
          </Flex>
        </Stack>
      </Box>
    )
  }

  return null
}

/**
 * Document action — manages open/close state and renders the dialog component.
 */
export function ImproveDescriptionAction(props: DocumentActionProps) {
  const {id, published, onComplete} = props

  const [dialogOpen, setDialogOpen] = useState(false)

  const handleClose = useCallback(() => {
    setDialogOpen(false)
    if (onComplete) onComplete()
  }, [onComplete])

  // ALL hooks above — conditional return below
  if (!published) return null

  return {
    label: 'Improve Description',
    icon: SparklesIcon,
    tone: 'primary' as const,
    disabled: dialogOpen,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? {
          type: 'dialog' as const,
          header: 'Improve Description',
          onClose: handleClose,
          content: (
            <ImproveDescriptionDialog
              documentId={id}
              currentDescription={(published?.description as string) || ''}
              onClose={handleClose}
            />
          ),
        }
      : null,
  }
}
