/**
 * List item IDs have to be unique within their list, and slugifying free-text
 * values collides: the tags "buying committee" and "buying-committee" both
 * become `buying-committee`, which throws "List items with same ID found" and
 * takes the whole pane down — including any edit intent that resolves through
 * it.
 *
 * Each list builds its own slugger and calls it once per item, in the order
 * the items are rendered. A repeat of an already-used slug gets a numeric
 * suffix, so IDs stay stable as long as the list's order does.
 */
export function createSlugger(): (value: string) => string {
  const seen = new Map<string, number>()
  return (value: string) => {
    const slug = value.replace(/[^a-zA-Z0-9_-]/g, '-')
    const count = (seen.get(slug) ?? 0) + 1
    seen.set(slug, count)
    return count === 1 ? slug : `${slug}-${count}`
  }
}
