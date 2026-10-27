import {useMemo} from 'react'
import {Stack, Card, Text, Flex, Badge, Heading, Spinner, Box, Button} from '@sanity/ui'
import {AddIcon} from '@sanity/icons'
import {useDocumentStore} from 'sanity'
import {useObservable} from 'react-rx'

interface SessionListEntry {
  _id: string
  title: string
  status: 'open' | 'closed'
  description?: string
  createdAt?: string
  voteCount: number
}

interface Props {
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
}

const SESSIONS_QUERY = `*[_type == "proseTestSession"] | order(coalesce(createdAt, _createdAt) desc) {
  _id,
  title,
  description,
  status,
  createdAt,
  "voteCount": count(*[_type == "proseVote" && sessionId == ^._id])
}`

export function SessionList({selectedSessionId, onSelectSession}: Props) {
  const documentStore = useDocumentStore()

  const sessions$ = useMemo(
    () => documentStore.listenQuery(SESSIONS_QUERY, {}, {perspective: 'published'}),
    [documentStore],
  )
  const sessions = useObservable(sessions$, null) as SessionListEntry[] | null

  return (
    <Box padding={3} style={{overflowY: 'auto', height: '100%'}}>
      <Stack space={3}>
        <Flex justify="space-between" align="center" gap={2}>
          <Heading size={1}>Sessions</Heading>
          <Button
            as="a"
            href="/structure/proseTestSessions"
            fontSize={1}
            padding={2}
            mode="ghost"
            icon={AddIcon}
            text="New"
            title="Create a new prose test session"
          />
        </Flex>

        {sessions === null && (
          <Flex justify="center" padding={4}>
            <Spinner muted />
          </Flex>
        )}

        {sessions !== null && sessions.length === 0 && (
          <Card padding={3} tone="transparent" radius={2} border>
            <Stack space={3}>
              <Text size={1} muted>
                No sessions yet.
              </Text>
              <Text size={1} muted>
                Click <strong>New</strong> above to create your first prose test session, or
                open <strong>Skills &rarr; Prose test sessions</strong> in the structure pane.
              </Text>
            </Stack>
          </Card>
        )}

        {sessions?.map((s) => {
          const isSelected = s._id === selectedSessionId
          return (
            <Card
              key={s._id}
              padding={3}
              radius={2}
              tone={isSelected ? 'primary' : 'default'}
              shadow={isSelected ? 2 : 1}
              onClick={() => onSelectSession(s._id)}
              style={{cursor: 'pointer'}}
            >
              <Stack space={2}>
                <Flex align="center" justify="space-between" gap={2}>
                  <Text size={1} weight="semibold">
                    {s.title || 'Untitled session'}
                  </Text>
                  <Badge tone={s.status === 'open' ? 'positive' : 'default'} fontSize={0}>
                    {s.status}
                  </Badge>
                </Flex>
                {s.description && (
                  <Text size={0} muted>
                    {s.description.length > 100
                      ? s.description.slice(0, 100) + '…'
                      : s.description}
                  </Text>
                )}
                <Text size={0} muted>
                  {s.voteCount} {s.voteCount === 1 ? 'voter' : 'voters'}
                </Text>
              </Stack>
            </Card>
          )
        })}
      </Stack>
    </Box>
  )
}
