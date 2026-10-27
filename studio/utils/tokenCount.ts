import {encode} from 'gpt-tokenizer'

/**
 * Count tokens using cl100k_base encoding (GPT-4).
 * Skills are consumed by Claude, GPT, Gemini etc. — exact tokenizer
 * doesn't matter as much as getting a reasonable count.
 */
export function countTokens(text: string): number {
  if (!text) return 0
  return encode(text).length
}
