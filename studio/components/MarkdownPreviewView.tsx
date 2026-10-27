import React, {Suspense, useEffect, useState} from 'react'
import {Box, Card, Container, Flex, Label, Spinner, Stack, Text} from '@sanity/ui'
import {useClient} from 'sanity'
import type {UserViewComponent} from 'sanity/structure'
import {defineQuery} from 'groq'
import {PROSE_CLASS, useStreamdownStyles} from './streamdownStyles'

// Streamdown is ESM-only and breaks the Sanity CLI under Node, so it is only
// ever pulled in at render time in the browser — same as `actions/testSkill`.
const LazyStreamdown = React.lazy(() =>
  import('streamdown').then((mod) => ({default: mod.Streamdown})),
)

const REFERENCES_QUERY = defineQuery(
  `*[_type == "skillReference" && _id in $ids]{_id, filename, title, content}`,
)

type Reference = {_id: string; filename?: string; title?: string; content?: string}

function Markdown({value}: {value: string}) {
  return (
    <div className={PROSE_CLASS}>
      <Suspense fallback={<Spinner muted />}>
        {/*
          `controls` off: the copy/download/fullscreen buttons are laid out
          with Tailwind classes this Studio doesn't load, so they render as
          loose stacked icons above every table and code block.
          `tableMaxHeight` off: the 300px default puts a long table in its own
          scroll box, which is the opposite of what a reading pane is for.
        */}
        <LazyStreamdown controls={false} tableMaxHeight={0}>
          {value}
        </LazyStreamdown>
      </Suspense>
    </div>
  )
}

function Section({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <Stack space={3}>
      <Label size={0} muted>
        {label}
      </Label>
      <Card padding={4} radius={2} border>
        {children}
      </Card>
    </Stack>
  )
}

/**
 * Reads a skill or reference file as rendered Markdown rather than as editor
 * source. For a skill it also pulls in the reference files it ships with, so
 * the tab shows the whole thing an agent would load, in one scroll.
 *
 * Renders `displayed`, the document as it currently is in the form, so
 * unsaved edits show up without publishing first.
 */
export const MarkdownPreviewView: UserViewComponent = ({document, schemaType}) => {
  const client = useClient({apiVersion: '2025-02-19'})
  const displayed = document.displayed as Record<string, any> | undefined
  const [references, setReferences] = useState<Reference[]>([])

  // Reference IDs in document order; the query returns them unordered.
  const referenceIds: string[] = Array.isArray(displayed?.references)
    ? displayed!.references.map((ref: any) => ref?._ref).filter(Boolean)
    : []
  const referenceKey = referenceIds.join(',')

  useEffect(() => {
    if (!referenceIds.length) {
      setReferences([])
      return
    }
    let cancelled = false
    client
      .fetch<Reference[]>(REFERENCES_QUERY, {ids: referenceIds})
      .then((rows) => {
        if (cancelled) return
        const byId = new Map(rows.map((row) => [row._id, row]))
        setReferences(referenceIds.map((id) => byId.get(id)).filter(Boolean) as Reference[])
      })
      .catch((err) => {
        // Fail soft, like the other Studio banners: a preview that can't load
        // its references still shows the skill body.
        // eslint-disable-next-line no-console
        console.warn('MarkdownPreviewView: reference query failed', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, referenceKey])

  useStreamdownStyles()

  const content: string = typeof displayed?.content === 'string' ? displayed.content : ''
  const isSkill = schemaType.name === 'skill'
  const heading = isSkill
    ? displayed?.title || displayed?.skillName
    : displayed?.title || displayed?.filename

  if (!content && !references.length) {
    return (
      <Flex align="center" justify="center" padding={5}>
        <Text muted size={1}>
          Nothing to preview yet — write some content first.
        </Text>
      </Flex>
    )
  }

  return (
    <Box padding={4} overflow="auto">
      <Container width={1}>
        <Stack space={5}>
          {heading ? (
            <Stack space={3}>
              <Text size={3} weight="semibold">
                {heading}
              </Text>
              {displayed?.description ? (
                <Text muted size={1}>
                  {displayed.description}
                </Text>
              ) : null}
            </Stack>
          ) : null}

          {content ? (
            <Section label={isSkill ? 'SKILL.md' : displayed?.filename || 'Content'}>
              <Markdown value={content} />
            </Section>
          ) : null}

          {references.map((reference) => (
            <Section
              key={reference._id}
              label={`references/${reference.filename || reference._id}`}
            >
              <Markdown value={reference.content || ''} />
            </Section>
          ))}
        </Stack>
      </Container>
    </Box>
  )
}
