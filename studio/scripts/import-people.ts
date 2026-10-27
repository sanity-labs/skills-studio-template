/**
 * Bulk-load the People directory (used by the skill owner picker) from a CSV.
 * Upserts by email; never deletes.
 *
 * CSV header row (name and email required, the rest optional):
 *   name,email,slackId,jobTitle,avatarUrl
 *
 * Dry run (default) prints the plan. APPLY=1 writes.
 *
 *   cd studio
 *   npx sanity exec scripts/import-people.ts --with-user-token -- people.csv
 *   APPLY=1 npx sanity exec scripts/import-people.ts --with-user-token -- people.csv
 */
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {getCliClient} from 'sanity/cli'

const apply = process.env.APPLY === '1'
const file = process.argv.slice(2).filter((arg) => !arg.startsWith('-')).pop()
if (!file) {
  console.error('Pass a CSV file, e.g. -- people.csv')
  process.exit(1)
}

const client = getCliClient({apiVersion: '2025-02-19'})
const FIELDS = ['name', 'email', 'slackId', 'jobTitle', 'avatarUrl'] as const

/** Minimal CSV parser: handles quoted fields with commas and escaped quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field), rows.push(row), (row = []), (field = '')
    } else field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((cell) => cell.trim()))
}

/** Stable document ID from the email, so re-imports update in place. */
const personId = (email: string) =>
  `orgPerson-${createHash('sha1').update(email.toLowerCase()).digest('hex').slice(0, 16)}`

async function main() {
  const [header, ...rows] = parseCsv(readFileSync(file!, 'utf8'))
  const cols = header.map((h) => h.trim())
  for (const required of ['name', 'email']) {
    if (!cols.includes(required)) throw new Error(`CSV is missing a "${required}" column`)
  }

  const people = rows.map((cells) => {
    const doc: Record<string, string> = {}
    for (const f of FIELDS) {
      const value = cells[cols.indexOf(f)]?.trim()
      if (cols.includes(f) && value) doc[f] = value
    }
    return doc
  })
  const valid = people.filter((p) => p.name && p.email?.includes('@'))
  const skipped = people.length - valid.length

  const tx = client.transaction()
  for (const p of valid) {
    tx.createOrReplace({_id: personId(p.email), _type: 'orgPerson', ...p})
  }

  console.log(`${valid.length} people to upsert${skipped ? `, ${skipped} rows skipped (missing name or email)` : ''}`)
  for (const p of valid.slice(0, 10)) console.log(`  ${p.name} <${p.email}>`)
  if (valid.length > 10) console.log(`  …and ${valid.length - 10} more`)
  if (!apply) return console.log('\nDry run. Re-run with APPLY=1 to write.')
  await tx.commit()
  console.log('\nImported.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
