import {useState, useCallback} from 'react'
import {useClient} from 'sanity'
import {Box, Button, Flex, Text, Spinner, Badge, Card, Stack} from '@sanity/ui'
import {PlayIcon, BulbOutlineIcon} from '@sanity/icons'
import {generateText} from '../../utils/aiProviders'
import type {AISecrets} from '../../utils/aiProviders'

type EvalItem = {
  _id: string
  prompt: string | null
  expectedOutput: string | null
  expectations: string[] | null
  inputContext: string | null
  tags: string[] | null
}

type SkillContent = {
  skillName: string | null
  description: string | null
  content: string | null
  references: Array<{filename: string | null; content: string | null}> | null
}

type EvalResult = {
  evalId: string
  prompt: string
  response: string
  expectations: Array<{text: string; passed: boolean; evidence: string}>
  passRate: number
  durationMs: number
}

function parseGradingResponse(raw: unknown): {
  expectations: Array<{text: string; passed: boolean; evidence: string}>
  summary: {passed: number; failed: number; total: number; passRate: number}
} | null {
  try {
    if (typeof raw === 'object' && raw !== null && 'expectations' in raw) {
      return raw as any
    }
    let text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    // Strip markdown fences
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function RunAllButton({
  evals,
  skillId,
  skillContent,
  onRunComplete,
  secrets,
  model,
}: {
  evals: EvalItem[]
  skillId: string
  skillContent: SkillContent | null
  onRunComplete: () => void
  secrets: AISecrets
  model: string
}) {
  const client = useClient({apiVersion: '2024-01-01'})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<EvalResult[]>([])
  const [suggestions, setSuggestions] = useState<string | null>(null)

  const handleRunAll = useCallback(async () => {
    if (!skillContent || evals.length === 0) return

    setRunning(true)
    setResults([])
    setSuggestions(null)
    const allResults: EvalResult[] = []

    // Build skill instruction from content
    const refContent =
      skillContent.references
        ?.map((r) => `\n--- ${r.filename} ---\n${r.content}`)
        .join('\n') || ''
    const skillInstruction = `${skillContent.content || ''}${refContent}`

    for (let i = 0; i < evals.length; i++) {
      const evalItem = evals[i]
      setProgress(`Running eval ${i + 1}/${evals.length}...`)

      const startTime = Date.now()

      try {
        // Step 1: Run the skill with the eval prompt
        const userMessage = evalItem.inputContext
          ? `${evalItem.prompt || ''}\n\n---\nContext:\n${evalItem.inputContext}`
          : evalItem.prompt || ''
        const response = await generateText({
          model,
          system: skillInstruction,
          user: userMessage,
          maxTokens: 8192,
          secrets,
        })

        const responseText = typeof response === 'string' ? response : JSON.stringify(response)
        const durationMs = Date.now() - startTime

        // Step 2: Grade the response
        if (evalItem.expectations && evalItem.expectations.length > 0) {
          setProgress(`Grading eval ${i + 1}/${evals.length}...`)

          const gradingRaw = await generateText({
            model,
            maxTokens: 8192,
            secrets,
            system: `You are an eval grader. Evaluate whether the response meets each expectation.

For each expectation, determine:
- PASS: Clear evidence the expectation is met with genuine substance
- FAIL: No evidence, contradicted, or only superficial compliance

Cite specific evidence from the response.

Expectations:
${JSON.stringify(evalItem.expectations)}

Expected output description:
${evalItem.expectedOutput || '(not specified)'}

Respond with JSON only (no markdown fences):
{
  "expectations": [
    { "text": "...", "passed": true/false, "evidence": "..." }
  ],
  "summary": { "passed": N, "failed": N, "total": N, "passRate": 0.XX }
}`,
            user: `Grade this response:\n\n${responseText}`,
          })

          const grading = parseGradingResponse(gradingRaw)
          const totalDurationMs = Date.now() - startTime

          if (grading) {
            allResults.push({
              evalId: evalItem._id,
              prompt: evalItem.prompt || '',
              response: responseText,
              expectations: grading.expectations,
              passRate: grading.summary.passRate,
              durationMs: totalDurationMs,
            })
          } else {
            // Grading failed to parse — mark all as failed
            allResults.push({
              evalId: evalItem._id,
              prompt: evalItem.prompt || '',
              response: responseText,
              expectations: (evalItem.expectations || []).map((e) => ({
                text: e,
                passed: false,
                evidence: 'Grading response could not be parsed',
              })),
              passRate: 0,
              durationMs: totalDurationMs,
            })
          }
        } else {
          // No expectations — just record the response
          allResults.push({
            evalId: evalItem._id,
            prompt: evalItem.prompt || '',
            response: responseText,
            expectations: [],
            passRate: 1,
            durationMs,
          })
        }
      } catch (err) {
        allResults.push({
          evalId: evalItem._id,
          prompt: evalItem.prompt || '',
          response: `Error: ${err instanceof Error ? err.message : String(err)}`,
          expectations: (evalItem.expectations || []).map((e) => ({
            text: e,
            passed: false,
            evidence: 'Eval failed with an error',
          })),
          passRate: 0,
          durationMs: Date.now() - startTime,
        })
      }

      setResults([...allResults])

      // Pace requests to avoid rate limiting (skip after the last eval)
      if (i < evals.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }

    // Save the run as a skillEvalRun document
    setProgress('Saving results...')

    const totalPassed = allResults.filter((r) => r.passRate >= 1).length
    const totalFailed = allResults.filter((r) => r.passRate < 1).length
    const avgDuration =
      allResults.length > 0
        ? allResults.reduce((sum, r) => sum + r.durationMs, 0) / allResults.length
        : 0
    const overallPassRate = allResults.length > 0 ? totalPassed / allResults.length : 0

    let savedRunId: string | null = null
    try {
      const created = await client.create({
        _type: 'skillEvalRun',
        skill: {_type: 'reference', _ref: skillId},
        runType: 'benchmark',
        trigger: 'manual',
        model,
        results: allResults.map((r) => ({
          _key: crypto.randomUUID().slice(0, 8),
          eval: {_type: 'reference', _ref: r.evalId},
          prompt: r.prompt,
          response: r.response,
          expectations: r.expectations.map((e) => ({
            _key: crypto.randomUUID().slice(0, 8),
            text: e.text,
            passed: e.passed,
            evidence: e.evidence,
          })),
          passRate: r.passRate,
          durationMs: r.durationMs,
        })),
        summary: {
          totalEvals: allResults.length,
          passed: totalPassed,
          failed: totalFailed,
          passRate: overallPassRate,
          avgDurationMs: Math.round(avgDuration),
        },
      })
      savedRunId = created._id
    } catch (err) {
      console.error('Failed to save eval run:', err)
    }

    // Step 3: Generate improvement suggestions if any evals failed
    const failedEvals = allResults.filter((r) => r.passRate < 1)
    if (failedEvals.length > 0 && savedRunId) {
      setProgress('Generating improvement suggestions...')
      try {
        const suggestionsRaw = await generateText({
          model,
          secrets,
          system: `You are a skill improvement advisor. Based on the eval results below, provide specific, actionable suggestions to improve the skill.

For each failed expectation, suggest a concrete change to the skill's SKILL.md content or reference files that would help the skill pass that expectation next time.

Be specific — reference exact sections, phrases, or patterns that should be added or changed.

Format as a numbered list of suggestions. Keep each suggestion to 1-2 sentences.`,
          user: JSON.stringify(failedEvals),
        })

        const suggestionsText =
          typeof suggestionsRaw === 'string' ? suggestionsRaw : JSON.stringify(suggestionsRaw)
        setSuggestions(suggestionsText)

        // Save suggestions to the run document
        try {
          await client.patch(savedRunId).set({suggestions: suggestionsText}).commit()
        } catch (patchErr) {
          console.error('Failed to save suggestions:', patchErr)
        }
      } catch (err) {
        console.error('Failed to generate suggestions:', err)
      }
    }

    setProgress('')
    setRunning(false)
    onRunComplete()
  }, [client, evals, skillId, skillContent, onRunComplete, secrets, model])

  return (
    <Stack space={3}>
      <Flex align="center" gap={3}>
        <Button
          icon={PlayIcon}
          text={running ? 'Running...' : `Run All (${evals.length})`}
          tone="primary"
          onClick={handleRunAll}
          disabled={running || evals.length === 0 || !skillContent}
        />
        {running ? (
          <Flex align="center" gap={2}>
            <Spinner muted />
            <Text size={1} muted>
              {progress}
            </Text>
          </Flex>
        ) : null}
      </Flex>

      {results.length > 0 ? (
        <Card padding={3} radius={2} tone="transparent" border>
          <Stack space={3}>
            <Text size={1} weight="semibold">
              Run Results
            </Text>
            {results.map((result, idx) => {
              const passedCount = result.expectations.filter((e) => e.passed).length
              const totalCount = result.expectations.length
              const tone =
                totalCount === 0
                  ? 'default'
                  : passedCount === totalCount
                    ? 'positive'
                    : passedCount > 0
                      ? 'caution'
                      : 'critical'
              return (
                <Card key={result.evalId} padding={3} radius={2} border>
                  <Stack space={2}>
                    <Flex align="center" gap={2}>
                      <Badge tone={tone} fontSize={0}>
                        {totalCount > 0 ? `${passedCount}/${totalCount}` : 'N/A'}
                      </Badge>
                      <Text size={1} textOverflow="ellipsis">
                        {result.prompt.length > 80
                          ? result.prompt.slice(0, 80) + '\u2026'
                          : result.prompt}
                      </Text>
                    </Flex>
                    <Text size={0} muted>
                      {Math.round(result.durationMs / 1000 * 10) / 10}s
                    </Text>
                  </Stack>
                </Card>
              )
            })}
          </Stack>
        </Card>
      ) : null}

      {suggestions ? (
        <Card padding={3} radius={2} border tone="caution">
          <Stack space={3}>
            <Flex align="center" gap={2}>
              <Text size={1}>
                <BulbOutlineIcon />
              </Text>
              <Text size={1} weight="semibold">
                Improvement Suggestions
              </Text>
            </Flex>
            <Text size={1} muted style={{whiteSpace: 'pre-wrap'}}>
              {suggestions}
            </Text>
          </Stack>
        </Card>
      ) : null}
    </Stack>
  )
}
