/**
 * Hand-rolled parser for `body_content`. Deliberately not a full markdown
 * parser (per the page spec) — it recognises exactly five patterns:
 *
 *   ## heading            -> heading2 (collected for the "On this page" TOC)
 *   ### heading           -> heading3
 *   > INFO: text          -> info callout
 *   > WARNING: text       -> warning callout
 *   > TIP: text           -> tip callout
 *   ```lang / ```         -> code block (lang label, defaults to "Example")
 *   anything else         -> paragraph
 *
 * Blank lines separate blocks; consecutive non-blank lines belong to the
 * same block (so a callout or paragraph can wrap onto a second line).
 */

export type ContentBlock =
  | { type: 'heading2'; id: string; text: string }
  | { type: 'heading3'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'callout'; variant: 'info' | 'warning' | 'tip'; text: string }
  | { type: 'code'; code: string; label: string }

const CALLOUT_PATTERN = /^>\s*(INFO|WARNING|TIP):\s*(.*)$/

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Strip the common leading whitespace shared by every non-blank line, and trim outer blank lines. */
function dedent(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')

  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  const indents = lines.filter((line) => line.trim() !== '').map((line) => line.match(/^ */)?.[0].length ?? 0)
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0

  return lines.map((line) => line.slice(minIndent))
}

/** Does this line start a new block, even without a preceding blank line? */
function startsNewBlock(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('##') || trimmed.startsWith('```') || CALLOUT_PATTERN.test(trimmed)
}

export function parseLessonContent(raw: string | null | undefined): ContentBlock[] {
  if (!raw) return []

  const lines = dedent(raw)
  const blocks: ContentBlock[] = []
  const usedIds = new Set<string>()

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      i++
      continue
    }

    if (trimmed.startsWith('```')) {
      const label = trimmed.slice(3).trim() || 'Example'
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing fence
      blocks.push({ type: 'code', code: codeLines.join('\n'), label })
      continue
    }

    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'heading3', text: trimmed.slice(4).trim() })
      i++
      continue
    }

    if (trimmed.startsWith('## ')) {
      const text = trimmed.slice(3).trim()
      let id = slugify(text)
      let suffix = 2
      while (usedIds.has(id)) {
        id = `${slugify(text)}-${suffix}`
        suffix++
      }
      usedIds.add(id)
      blocks.push({ type: 'heading2', id, text })
      i++
      continue
    }

    const calloutMatch = trimmed.match(CALLOUT_PATTERN)
    if (calloutMatch) {
      const variant = calloutMatch[1].toLowerCase() as 'info' | 'warning' | 'tip'
      const textParts = [calloutMatch[2].trim()]
      i++
      while (i < lines.length && lines[i].trim() !== '' && !startsNewBlock(lines[i])) {
        textParts.push(lines[i].trim())
        i++
      }
      blocks.push({ type: 'callout', variant, text: textParts.join(' ').trim() })
      continue
    }

    const textParts = [trimmed]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !startsNewBlock(lines[i])) {
      textParts.push(lines[i].trim())
      i++
    }
    blocks.push({ type: 'paragraph', text: textParts.join(' ').trim() })
  }

  return blocks
}
