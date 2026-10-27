import {useState, useCallback} from 'react'
import {useFormValue, useClient} from 'sanity'
import {Card, Flex, Text, Button, Spinner} from '@sanity/ui'
import {DownloadIcon} from '@sanity/icons'
import {GitHubSyncBanner} from './GitHubSyncBanner'
import {ORG_NAME} from '../utils/constants'
import {generateSkillZip, triggerDownload} from '../utils/generateSkillZip'
import type {SkillInvocation} from '../utils/assemble'

export function GitHubSyncBannerField() {
  const skillName = useFormValue(['skillName']) as string | undefined
  const description = useFormValue(['description']) as string | undefined
  const content = useFormValue(['content']) as string | undefined
  const references = useFormValue(['references']) as Array<{_ref: string}> | undefined
  const visibility = useFormValue(['metadata', 'visibility']) as string | undefined
  const invocation = useFormValue(['invocation']) as SkillInvocation | undefined
  const client = useClient({apiVersion: '2024-01-01'})

  const [downloading, setDownloading] = useState(false)

  const handleDownload = useCallback(async () => {
    if (!skillName || !content) return
    setDownloading(true)
    try {
      // Fetch referenced documents
      let refs: Array<{filename: string; content: string}> = []
      if (references?.length) {
        const refIds = references.map((r) => r._ref).filter(Boolean)
        if (refIds.length > 0) {
          refs = await client.fetch(
            `*[_id in $ids]{filename, content}`,
            {ids: refIds},
          )
        }
      }

      const blob = await generateSkillZip({
        skillName,
        description: description || '',
        content,
        references: refs,
        invocation,
      })
      triggerDownload(blob, `${skillName}.zip`)
    } catch (err) {
      console.error('Download failed:', err)
    } finally {
      setDownloading(false)
    }
  }, [skillName, description, content, references, invocation, client])

  return (
    <Flex direction="column" gap={3}>
      {visibility === 'confidential' && (
        <Card padding={3} radius={2} tone="caution" border>
          <Flex align="center" gap={2}>
            <Text size={1} weight="semibold">
              ⚠️ This skill is Confidential — do not share outside of {ORG_NAME}.
            </Text>
          </Flex>
        </Card>
      )}
      <GitHubSyncBanner />
      <Flex>
        <Button
          icon={downloading ? Spinner : DownloadIcon}
          text="Download ZIP"
          mode="ghost"
          tone="default"
          fontSize={1}
          disabled={downloading || !skillName || !content}
          onClick={handleDownload}
        />
      </Flex>
    </Flex>
  )
}
