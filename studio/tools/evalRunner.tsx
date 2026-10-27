import {useCallback, useEffect, useState} from 'react'
import {Box, Card, Flex, Text, Heading, Stack} from '@sanity/ui'
import {ClipboardIcon} from '@sanity/icons'
import {SkillList} from './eval/SkillList'
import {EvalSuite} from './eval/EvalSuite'
import {getPublishedId} from '../utils/documentIds'

function getSkillIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const skillId = params.get('skill')
  // Normalized because links into this tool are built elsewhere (the eval
  // status banner on a skill form, a pasted URL) and can carry a `drafts.` or
  // `versions.<releaseId>.` ID. Eval rows reference the published ID, so
  // querying with anything else finds nothing.
  return skillId ? getPublishedId(skillId) : null
}

function setSkillIdInUrl(skillId: string | null) {
  const url = new URL(window.location.href)
  if (skillId) {
    url.searchParams.set('skill', skillId)
  } else {
    url.searchParams.delete('skill')
  }
  window.history.replaceState({}, '', url.toString())
}

export function EvalRunnerTool() {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(getSkillIdFromUrl)

  const handleSelectSkill = useCallback((skillId: string) => {
    setSelectedSkillId(skillId)
    setSkillIdInUrl(skillId)
  }, [])

  // Sync from URL on popstate (browser back/forward)
  useEffect(() => {
    const handler = () => setSelectedSkillId(getSkillIdFromUrl())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  return (
    <Flex height="fill">
      <Box flex={1}>
        <SkillList selectedSkillId={selectedSkillId} onSelectSkill={handleSelectSkill} />
      </Box>
      <Box flex={3}>
        {selectedSkillId ? (
          <EvalSuite skillId={selectedSkillId} />
        ) : (
          <Flex align="center" justify="center" height="fill" padding={5}>
            <Card padding={5} radius={3} tone="transparent">
              <Stack space={4} padding={4}>
                <Flex justify="center">
                  <Text size={4}>
                    <ClipboardIcon />
                  </Text>
                </Flex>
                <Heading size={2} align="center">
                  Skill Lab
                </Heading>
                <Text size={2} muted align="center">
                  Select a skill to view and run its eval suite
                </Text>
              </Stack>
            </Card>
          </Flex>
        )}
      </Box>
    </Flex>
  )
}
