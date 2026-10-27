import {useMemo, useState, useCallback} from 'react'
import {useDocumentStore} from 'sanity'
import {useObservable} from 'react-rx'
import {defineQuery} from 'groq'
import {
  Box,
  Card,
  Stack,
  Text,
  Heading,
  Flex,
  Badge,
  Button,
  Spinner,
  Select,
  Label,
} from '@sanity/ui'
import {AddIcon, ChevronDownIcon, ChevronRightIcon, EditIcon} from '@sanity/icons'
import {useIntentLink} from 'sanity/router'
import {usePerspectiveQueryOptions} from '../../utils/perspective'
import {RunAllButton} from './RunAllButton'
import {RunSelectionButton} from './RunSelectionButton'
import {RunHistory} from './RunHistory'
import {MODELS, DEFAULT_MODEL_ID, type ModelId, findModel} from '../../utils/aiProviders'
import {
  useAISecrets,
  AIProvidersSettingsButton,
  AIProvidersEmptyState,
} from '../../utils/aiSecrets'

const EVALS_FOR_SKILL_QUERY = defineQuery(
  `*[_type == "skillEval" && skill._ref == $skillId] | order(_createdAt asc) {
    _id,
    prompt,
    expectedOutput,
    expectations,
    inputContext,
    tags,
    kind,
    expectNone,
    needsExpectation,
    requiresConnectors,
    "expectedSkill": expectedSkill->skillName,
    "acceptableSkills": acceptableSkills[]->skillName
  }`,
)

const SKILL_CONTENT_QUERY = defineQuery(
  `*[_type == "skill" && _id == $id][0]{
    skillName,
    description,
    content,
    references[]->{filename, content}
  }`,
)

type EvalItem = {
  _id: string
  prompt: string | null
  expectedOutput: string | null
  expectations: string[] | null
  inputContext: string | null
  tags: string[] | null
  kind: 'trigger' | 'behavior' | null
  expectNone: boolean | null
  needsExpectation: boolean | null
  requiresConnectors: string[] | null
  expectedSkill: string | null
  acceptableSkills: string[] | null
}

type SkillContent = {
  skillName: string | null
  description: string | null
  content: string | null
  references: Array<{filename: string | null; content: string | null}> | null
}

function TestCaseCard({evalItem}: {evalItem: EvalItem}) {
  const [expanded, setExpanded] = useState(false)
  // Router-resolved: a hand-built `/intent/edit/...` href misses the Studio's
  // base path and drops the sticky `perspective` param, so a row opened from
  // inside a release lost the release on the way over.
  const editLink = useIntentLink({
    intent: 'edit',
    params: {id: evalItem._id, type: 'skillEval'},
  })

  return (
    <Card padding={3} radius={2} border>
      <Stack space={2}>
        <Card
          as="button"
          onClick={() => setExpanded(!expanded)}
          padding={0}
          tone="default"
        >
          <Flex align="center" gap={2}>
            {expanded ? (
              <Text size={1}>
                <ChevronDownIcon />
              </Text>
            ) : (
              <Text size={1}>
                <ChevronRightIcon />
              </Text>
            )}
            <Box flex={1}>
              <Text size={1} textOverflow="ellipsis">
                {evalItem.prompt
                  ? evalItem.prompt.length > 80
                    ? evalItem.prompt.slice(0, 80) + '\u2026'
                    : evalItem.prompt
                  : 'No prompt'}
              </Text>
            </Box>
            {evalItem.expectations && evalItem.expectations.length > 0 ? (
              <Badge tone="default" fontSize={0}>
                {evalItem.expectations.length} expectation
                {evalItem.expectations.length !== 1 ? 's' : ''}
              </Badge>
            ) : (
              <Badge tone="caution" fontSize={0}>
                No expectations
              </Badge>
            )}
            <Button
              as="a"
              href={editLink.href}
              onClick={editLink.onClick}
              icon={EditIcon}
              mode="bleed"
              tone="default"
              fontSize={0}
              padding={2}
            />
          </Flex>
        </Card>

        {expanded ? (
          <Card padding={3} radius={2} tone="transparent">
            <Stack space={3}>
              <Stack space={2}>
                <Text size={0} weight="semibold" muted>
                  Full Prompt
                </Text>
                <Text size={1}>{evalItem.prompt || 'No prompt'}</Text>
              </Stack>

              {evalItem.expectedOutput ? (
                <Stack space={2}>
                  <Text size={0} weight="semibold" muted>
                    Expected Output
                  </Text>
                  <Text size={1}>{evalItem.expectedOutput}</Text>
                </Stack>
              ) : null}

              {evalItem.inputContext ? (
                <Stack space={2}>
                  <Text size={0} weight="semibold" muted>
                    Input Context
                  </Text>
                  <Text size={1}>
                    {evalItem.inputContext.length > 300
                      ? evalItem.inputContext.slice(0, 300) + '\u2026'
                      : evalItem.inputContext}
                  </Text>
                </Stack>
              ) : null}

              {evalItem.expectations && evalItem.expectations.length > 0 ? (
                <Stack space={2}>
                  <Text size={0} weight="semibold" muted>
                    Expectations
                  </Text>
                  {evalItem.expectations.map((exp, idx) => (
                    <Flex key={`${evalItem._id}-exp-${idx}`} align="flex-start" gap={2}>
                      <Text size={0} muted>
                        {idx + 1}.
                      </Text>
                      <Text size={1}>{exp}</Text>
                    </Flex>
                  ))}
                </Stack>
              ) : null}

              {evalItem.tags && evalItem.tags.length > 0 ? (
                <Flex gap={2} wrap="wrap">
                  {evalItem.tags.map((tag) => (
                    <Badge key={tag} fontSize={0} tone="default">
                      {tag}
                    </Badge>
                  ))}
                </Flex>
              ) : null}

              <Button
                as="a"
                href={editLink.href}
                onClick={editLink.onClick}
                icon={EditIcon}
                text="Edit Test Case"
                mode="ghost"
                tone="primary"
                fontSize={1}
              />
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </Card>
  )
}

export function EvalSuite({skillId}: {skillId: string}) {
  const documentStore = useDocumentStore()
  const queryOptions = usePerspectiveQueryOptions()
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL_ID)
  const {secrets, loading: secretsLoading, hasAnyKey} = useAISecrets()

  const evals$ = useMemo(
    () => documentStore.listenQuery(EVALS_FOR_SKILL_QUERY, {skillId}, queryOptions),
    [documentStore, skillId, queryOptions],
  )
  const evals = useObservable(evals$, null) as EvalItem[] | null

  const skillContent$ = useMemo(
    () => documentStore.listenQuery(SKILL_CONTENT_QUERY, {id: skillId}, queryOptions),
    [documentStore, skillId, queryOptions],
  )
  const skillContentRaw = useObservable(skillContent$, null) as SkillContent | null

  // Rows authored before `kind` existed are behaviour cases — they grade a
  // response, they never say which skill should fire.
  const behaviorEvals = useMemo(
    () => (evals ?? []).filter((e) => e.kind !== 'trigger'),
    [evals],
  )

  // Only connector-free rows can run here; the rest need a real harness.
  const triggerCases = useMemo(
    () =>
      (evals ?? [])
        .filter(
          (e) =>
            e.kind === 'trigger' &&
            e.prompt &&
            (e.expectedSkill || e.expectNone) &&
            (e.requiresConnectors ?? []).length === 0,
        )
        .map((e) => ({
          _id: e._id,
          prompt: e.prompt as string,
          expectedSkill: e.expectedSkill ?? undefined,
          expectNone: e.expectNone ?? undefined,
          acceptableSkills: e.acceptableSkills ?? undefined,
        })),
    [evals],
  )

  const blockedTriggerCases = useMemo(
    () =>
      (evals ?? []).filter((e) => e.kind === 'trigger' && (e.requiresConnectors ?? []).length > 0)
        .length,
    [evals],
  )

  const needsExpectationCount = useMemo(
    () => (evals ?? []).filter((e) => e.kind === 'trigger' && e.needsExpectation).length,
    [evals],
  )

  const handleRunComplete = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.currentTarget.value as ModelId)
  }, [])

  // Same reason as the edit links above: let the router resolve it.
  const addTestCaseLink = useIntentLink({
    intent: 'create',
    params: {type: 'skillEval', skill: skillId},
  })

  if (secretsLoading) {
    return (
      <Flex align="center" justify="center" padding={5}>
        <Spinner muted />
      </Flex>
    )
  }

  if (!hasAnyKey) {
    return (
      <Box padding={4}>
        <Stack space={4}>
          <Heading size={2}>AI provider key required</Heading>
          <Text size={1} muted>
            At least one provider key (Anthropic, OpenAI, or Google) is needed
            to run evals. The model picker below will only show providers you
            have a key for.
          </Text>
          <AIProvidersEmptyState message="No keys configured yet. Add at least one to start running evals." />
        </Stack>
      </Box>
    )
  }

  if (evals === null) {
    return (
      <Flex align="center" justify="center" padding={5}>
        <Spinner muted />
      </Flex>
    )
  }

  return (
    <Box padding={4} overflow="auto">
      <Stack space={5}>
        <Flex align="center" justify="space-between" gap={3}>
          <Heading size={2}>
            Eval Suite{skillContentRaw?.skillName ? `: ${skillContentRaw.skillName}` : ''}
          </Heading>
          <AIProvidersSettingsButton />
        </Flex>

        {/* Test Cases */}
        <Stack space={3}>
          <Flex align="center" justify="space-between">
            <Heading size={1}>Test Cases ({evals.length})</Heading>
            <Button
              as="a"
              href={addTestCaseLink.href}
              onClick={addTestCaseLink.onClick}
              icon={AddIcon}
              text="Add Test Case"
              mode="ghost"
              tone="primary"
              fontSize={1}
            />
          </Flex>

          {evals.length === 0 ? (
            <Card padding={4} radius={2} border>
              <Text size={1} muted>
                No test cases yet. Add one to get started.
              </Text>
            </Card>
          ) : (
            <Stack space={2}>
              {evals.map((evalItem) => (
                <TestCaseCard key={evalItem._id} evalItem={evalItem} />
              ))}
            </Stack>
          )}
        </Stack>

        {/* Model Selector + runners */}
        <Stack space={3}>
          <Stack space={2}>
            <Label size={1}>Model</Label>
            <Select
              fontSize={1}
              value={selectedModel}
              onChange={handleModelChange}
            >
              {MODELS.filter((m) => {
                if (m.provider === 'anthropic') return Boolean(secrets.anthropicKey)
                if (m.provider === 'openai') return Boolean(secrets.openaiKey)
                if (m.provider === 'google') return Boolean(secrets.geminiKey)
                return false
              }).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Stack>
          {/* Which skill fires. Needs no connectors, so it is always runnable. */}
          <Card padding={3} radius={2} border>
            <Stack space={3}>
              <Stack space={2}>
                <Label size={1}>Which skill gets picked</Label>
                <Text size={1} muted>
                  Shows the AI the name and description of every skill in this audience — what it
                  sees before choosing — and checks which skill it picks for each test request.
                </Text>
              </Stack>
              {triggerCases.length === 0 ? (
                <Text size={1} muted>
                  No test requests yet. Add one and set “Skill that should fire.” The most useful
                  ones sound like this skill but belong to another.
                </Text>
              ) : (
                <RunSelectionButton
                  skillId={skillId}
                  cases={triggerCases}
                  model={selectedModel}
                  secrets={secrets}
                />
              )}
              {blockedTriggerCases > 0 && (
                <Text size={0} muted>
                  {blockedTriggerCases} trigger case
                  {blockedTriggerCases === 1 ? '' : 's'} skipped — they need connectors, so they run
                  outside the Studio.
                </Text>
              )}
              {needsExpectationCount > 0 && (
                <Text size={0} style={{color: 'var(--card-badge-caution-fg-color)'}}>
                  {needsExpectationCount} imported case
                  {needsExpectationCount === 1 ? '' : 's'} still need the skill that should fire
                  naming.
                </Text>
              )}
            </Stack>
          </Card>

          {/* How the skill behaves once loaded. */}
          <Card padding={3} radius={2} border>
            <Stack space={3}>
              <Stack space={2}>
                <Label size={1}>Behaviour — the answer once loaded</Label>
                <Text size={1} muted>
                  Sends this skill’s body as the system prompt and grades the response against its
                  expectations. Cannot tell you which skill would have fired.
                </Text>
              </Stack>
              <RunAllButton
                evals={behaviorEvals}
                skillId={skillId}
                skillContent={skillContentRaw}
                onRunComplete={handleRunComplete}
                secrets={secrets}
                model={selectedModel}
              />
            </Stack>
          </Card>
        </Stack>

        {/* Run History */}
        <RunHistory skillId={skillId} refreshKey={refreshKey} />
      </Stack>
    </Box>
  )
}
