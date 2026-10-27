import {useMemo} from 'react'
import {useDocumentStore} from 'sanity'
import {useObservable} from 'react-rx'
import {defineQuery} from 'groq'
import {Box, Card, Stack, Text, Heading, Spinner, Badge, Flex} from '@sanity/ui'
import {usePerspectiveQueryOptions} from '../../utils/perspective'

// Perspective-scoped (see utils/perspective.ts): one row per skill, showing
// the copy the selected perspective resolves to — no `versions.**` duplicates.
const SKILLS_FOR_EVAL_QUERY = defineQuery(
  `*[_type == "skill"] | order(skillName asc) {
    _id,
    skillName,
    title,
    "evalCount": count(*[_type == "skillEval" && skill._ref == ^._id])
  }`,
)

type SkillListItem = {
  _id: string
  skillName: string | null
  title: string | null
  evalCount: number
}

export function SkillList({
  selectedSkillId,
  onSelectSkill,
}: {
  selectedSkillId: string | null
  onSelectSkill: (id: string) => void
}) {
  const documentStore = useDocumentStore()
  const queryOptions = usePerspectiveQueryOptions()

  const skills$ = useMemo(
    () => documentStore.listenQuery(SKILLS_FOR_EVAL_QUERY, {}, queryOptions),
    [documentStore, queryOptions],
  )
  const skills = useObservable(skills$, null) as SkillListItem[] | null

  return (
    <Card borderRight padding={3} overflow="auto">
      <Stack space={3}>
        <Box paddingX={2} paddingY={3}>
          <Heading size={1}>Skills</Heading>
        </Box>
        {skills === null ? (
          <Flex align="center" justify="center" padding={4}>
            <Spinner muted />
          </Flex>
        ) : skills.length === 0 ? (
          <Card padding={3}>
            <Text size={1} muted>
              No skills found
            </Text>
          </Card>
        ) : (
          <Stack space={1}>
            {skills.map((skill) => (
              <Card
                key={skill._id}
                padding={3}
                radius={2}
                tone={selectedSkillId === skill._id ? 'primary' : 'default'}
                pressed={selectedSkillId === skill._id}
                as="button"
                onClick={() => onSelectSkill(skill._id)}
              >
                <Flex align="center" justify="space-between">
                  <Stack space={2}>
                    <Text size={1} weight="semibold">
                      {skill.skillName || 'Untitled'}
                    </Text>
                    {skill.title ? (
                      <Text size={0} muted>
                        {skill.title}
                      </Text>
                    ) : null}
                  </Stack>
                  {skill.evalCount > 0 ? (
                    <Badge tone="primary" fontSize={0}>
                      {skill.evalCount}
                    </Badge>
                  ) : null}
                </Flex>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}
