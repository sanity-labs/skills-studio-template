import {useCallback, useEffect, useState} from 'react'
import {Box, Card, Flex, Text, Heading, Stack, Button, Inline} from '@sanity/ui'
import {SplitVerticalIcon, AddIcon, EditIcon} from '@sanity/icons'
import {SessionList} from './prose-pick/SessionList'
import {SessionVoting} from './prose-pick/SessionVoting'

function getSessionIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('session') || null
}

function setSessionIdInUrl(sessionId: string | null) {
  const url = new URL(window.location.href)
  if (sessionId) {
    url.searchParams.set('session', sessionId)
  } else {
    url.searchParams.delete('session')
  }
  window.history.replaceState({}, '', url.toString())
}

export function ProsePickTool() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(getSessionIdFromUrl)

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
    setSessionIdInUrl(sessionId)
  }, [])

  useEffect(() => {
    const handler = () => setSelectedSessionId(getSessionIdFromUrl())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  return (
    <Flex height="fill">
      <Box flex={1} style={{borderRight: '1px solid var(--card-border-color)', minWidth: 280, maxWidth: 360}}>
        <SessionList
          selectedSessionId={selectedSessionId}
          onSelectSession={handleSelectSession}
        />
      </Box>
      <Box flex={3} style={{overflowY: 'auto'}}>
        {selectedSessionId ? (
          <SessionVoting sessionId={selectedSessionId} />
        ) : (
          <ProsePickIntro />
        )}
      </Box>
    </Flex>
  )
}

function ProsePickIntro() {
  return (
    <Box padding={5} style={{maxWidth: 720, margin: '0 auto'}}>
      <Stack space={5}>
        <Stack space={3}>
          <Flex align="center" gap={3}>
            <Text size={4}>
              <SplitVerticalIcon />
            </Text>
            <Heading size={3}>Prose Pick</Heading>
          </Flex>
          <Text size={2} muted>
            Blind A/B voting to compare prose outputs from different models, prompts, or skill
            versions.
          </Text>
        </Stack>

        <Card padding={4} radius={2} tone="transparent" border>
          <Stack space={4}>
            <Stack space={2}>
              <Heading size={1}>How it works</Heading>
              <Text size={1} muted>
                A <strong>session</strong> bundles up a set of writing prompts and the prose
                each condition (e.g. Claude vs GPT, skill v2 vs v2.1) generated for them.
                Voters open the session, see the two outputs labelled only as <em>A</em> and{' '}
                <em>B</em>, and pick the one they prefer (or <em>Roughly equivalent</em>).
                Results stay hidden until they submit, then the personal score and team
                aggregate reveal.
              </Text>
            </Stack>
            <Stack space={2}>
              <Heading size={1}>When to use it</Heading>
              <Text size={1} muted>
                Anytime you&rsquo;ve generated more than one candidate piece of copy and want a
                low-noise way to compare. Examples: shipping a skill update, picking between
                model versions for a launch post, settling a voice argument with data.
              </Text>
            </Stack>
            <Stack space={2}>
              <Heading size={1}>Getting started</Heading>
              <Stack space={2}>
                <Text size={1} muted>
                  1. Create a session: open <strong>Skills &rarr; Prose test sessions</strong>{' '}
                  in the structure pane and click <em>Create</em>. Fill in two conditions
                  (each with a model + optional skill stack) and the prompts you want to
                  compare.
                </Text>
                <Text size={1} muted>
                  2. <strong>Generate pairs</strong>: in the document action menu, click{' '}
                  <em>Generate pairs</em>. Every prompt runs through both conditions in
                  parallel and the A/B sides are randomized per prompt.
                </Text>
                <Text size={1} muted>
                  3. <strong>Publish the session</strong> when it&rsquo;s ready &mdash; only
                  published sessions appear in this tool. Drafts stay in the structure pane
                  while you&rsquo;re still editing.
                </Text>
                <Text size={1} muted>
                  4. Share the session: pick it from the list on the left and send teammates
                  the URL. Each voter sees the same A/B layout.
                </Text>
                <Text size={1} muted>
                  5. Read the results: once voters submit, the reveal shows per-prompt
                  agreement broken down by model family (Claude, GPT, Gemini).
                </Text>
              </Stack>
            </Stack>
          </Stack>
        </Card>

        <Inline space={2}>
          <Button
            as="a"
            href="/structure/proseTestSessions"
            mode="default"
            tone="primary"
            icon={AddIcon}
            text="New session"
          />
          <Button
            as="a"
            href="/structure/proseTestSessions"
            mode="ghost"
            icon={EditIcon}
            text="Manage sessions"
          />
        </Inline>

        <Text size={1} muted>
          Or pick an existing session from the list on the left to vote.
        </Text>
      </Stack>
    </Box>
  )
}
