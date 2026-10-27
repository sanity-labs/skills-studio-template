import {useEffect, useMemo, useState, useCallback} from 'react'
import {
  Autocomplete,
  Button,
  Card,
  Flex,
  Stack,
  Text,
} from '@sanity/ui'
import {SearchIcon, CloseIcon} from '@sanity/icons'
import {
  type ArrayOfObjectsInputProps,
  PatchEvent,
  setIfMissing,
  insert,
  unset,
  useClient,
} from 'sanity'

/**
 * Owner picker backed by the `orgPerson` (People) documents in this project.
 * Selections store a {name, email, slackId} snapshot, which the GitHub sync
 * writes to frontmatter and the freshness digest uses for mentions.
 * If the directory is empty or unreadable, falls back to the default array
 * input so owners can still be entered manually.
 */

type DirectoryEntry = {
  _id: string
  name: string
  email: string
  slackId?: string | null
  avatarUrl?: string | null
  jobTitle?: string | null
}

const DIRECTORY_QUERY = `*[_type == "orgPerson" && defined(email) && !(_id in path("drafts.**"))] | order(name asc) {
  _id, name, email, slackId, avatarUrl, jobTitle
}`

/** Array keys must be stable and URL-safe; derive one from the person's id. */
const ownerKey = (entry: DirectoryEntry) => entry._id.replace(/[^a-zA-Z0-9_-]/g, '-')

let directoryCache: DirectoryEntry[] | null = null

const PICKER_VERSION = 'v6'

export function OwnersInput(props: ArrayOfObjectsInputProps) {
  const {value, onChange, renderDefault} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Remount the Autocomplete after each selection to clear its input
  const [pickerKey, setPickerKey] = useState(0)

  useEffect(() => {
    console.info(`[OwnersInput ${PICKER_VERSION}] mounted`)
    let mounted = true
    const load = directoryCache
      ? Promise.resolve(directoryCache)
      : client.fetch(DIRECTORY_QUERY).then((entries: DirectoryEntry[]) => {
          // Don't cache an empty directory: on a fresh Studio, People added
          // after the first form load would stay invisible until a reload.
          if (entries.length) directoryCache = entries
          console.info(`[OwnersInput ${PICKER_VERSION}] directory loaded: ${entries.length} people`)
          return entries
        })
    load
      .then((entries) => {
        if (!mounted) return
        if (entries.length === 0) {
          console.warn('OwnersInput: People directory is empty — add People in the Studio; using manual entry')
          setFailed(true)
        } else {
          setDirectory(entries)
        }
      })
      .catch((err) => {
        console.warn('OwnersInput: org directory unavailable, using manual entry', err)
        if (mounted) setFailed(true)
      })
    return () => {
      mounted = false
    }
  }, [client])

  const currentEmails = useMemo(
    () => new Set((value || []).map((item: any) => item.email).filter(Boolean)),
    [value],
  )

  const options = useMemo(
    () =>
      (directory || [])
        .filter((entry) => !currentEmails.has(entry.email))
        .map((entry) => ({value: entry._id, payload: entry})),
    [directory, currentEmails],
  )

  const handleSelect = useCallback(
    (id: string) => {
      const entry = directory?.find((e) => e._id === id)
      if (!entry) return
      onChange(
        PatchEvent.from([
          setIfMissing([]),
          insert(
            [
              {
                _type: 'skillOwner',
                _key: ownerKey(entry),
                name: entry.name,
                email: entry.email,
                ...(entry.slackId ? {slackId: entry.slackId} : {}),
              },
            ],
            'after',
            [-1],
          ),
        ]),
      )
      setPickerKey((k) => k + 1)
    },
    [directory, onChange],
  )

  const handleRemove = useCallback(
    (key: string) => {
      onChange(PatchEvent.from(unset([{_key: key}])))
    },
    [onChange],
  )

  // Directory unreachable → default array UI (manual name/email entry)
  if (failed) {
    return (
      <Stack space={2}>
        <Card padding={2} radius={2} tone="caution">
          <Text size={0}>
            No People in the directory yet — add owners manually (name + email), or add People in the Studio.
          </Text>
        </Card>
        {renderDefault(props)}
      </Stack>
    )
  }

  return (
    <Stack space={3}>
      {(value || []).length > 0 && (
        <Flex gap={2} wrap="wrap">
          {(value || []).map((item: any) => (
            <Card key={item._key} padding={2} radius={2} tone="primary" border>
              <Flex align="center" gap={2}>
                <Text size={1}>{item.name || item.email}</Text>
                <Button
                  icon={CloseIcon}
                  mode="bleed"
                  padding={1}
                  fontSize={0}
                  onClick={() => handleRemove(item._key)}
                />
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
      <Autocomplete
        key={pickerKey}
        id={`skill-owners-autocomplete-${pickerKey}`}
        icon={SearchIcon}
        openButton
        placeholder={directory ? 'Add an owner…' : 'Loading People directory…'}
        disabled={!directory}
        options={options}
        filterOption={(query: string, option: {payload: DirectoryEntry}) => {
          const q = query.toLowerCase()
          return (
            option.payload.name?.toLowerCase().includes(q) ||
            option.payload.email?.toLowerCase().includes(q)
          )
        }}
        renderOption={(option: any) => (
          <Card as="button" padding={2}>
            <Flex align="center" gap={3}>
              {option.payload.avatarUrl && (
                <img
                  src={option.payload.avatarUrl}
                  alt=""
                  width={24}
                  height={24}
                  style={{borderRadius: '50%'}}
                />
              )}
              <Stack space={2}>
                <Text size={1}>{option.payload.name}</Text>
                {option.payload.jobTitle && (
                  <Text size={0} muted>
                    {option.payload.jobTitle}
                  </Text>
                )}
              </Stack>
            </Flex>
          </Card>
        )}
        onSelect={handleSelect}
      />
    </Stack>
  )
}
