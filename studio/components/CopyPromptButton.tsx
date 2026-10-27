import {useCallback} from 'react'
import {CopyIcon} from '@sanity/icons'
import {Button, useToast} from '@sanity/ui'

/**
 * Copies a prompt for an AI assistant connected to Sanity (the Sanity MCP),
 * so an author can hand an edit to an agent instead of making it by hand.
 */
export function CopyPromptButton({prompt}: {prompt: string}) {
  const toast = useToast()
  const copy = useCallback(() => {
    navigator.clipboard
      .writeText(prompt)
      .then(() =>
        toast.push({
          status: 'success',
          title: 'Prompt copied',
          description: 'Paste it into an AI assistant connected to Sanity, such as Claude with the Sanity MCP.',
        }),
      )
      .catch(() =>
        toast.push({
          status: 'error',
          title: 'Couldn’t copy the prompt',
          description: 'Allow this site to use the clipboard in your browser settings, then try again.',
        }),
      )
  }, [prompt, toast])

  return <Button icon={CopyIcon} text="Copy prompt" mode="ghost" fontSize={1} padding={2} onClick={copy} />
}

/** One line explaining "Copy prompt", for the bottom of any list that offers it. */
export const COPY_PROMPT_HELP =
  '“Copy prompt” copies instructions you can paste into an AI assistant that’s connected to Sanity, such as Claude with the Sanity MCP. It makes the change in a draft for you to review. Nothing is published.'
