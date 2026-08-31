/**
 * Recovering JSON from model output.
 *
 * Models are asked for bare JSON and usually comply, but they also wrap it in a
 * fenced code block or add a sentence before it. Rejecting those responses would
 * throw away a good answer, so the text is progressively narrowed: parse as-is,
 * then strip fences, then take the outermost balanced object or array. Every
 * step is a parse attempt, never a rewrite of the model's content.
 */

/** Strip one surrounding Markdown code fence, if present. */
function unfence(text: string): string {
  const fenced = /^\s*```(?:json|JSON)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text)
  return fenced?.[1] ?? text
}

/**
 * Slice the outermost balanced `{...}` or `[...]`, ignoring braces inside
 * strings so an escaped quote or a brace in prose cannot end the scan early.
 * @param text - the candidate text.
 * @returns the balanced slice, or undefined when there is none.
 */
function balancedSlice(text: string): string | undefined {
  const openIndex = text.search(/[{[]/)
  if (openIndex === -1) return undefined
  const open = text[openIndex]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === open) { depth += 1; continue }
    if (char === close) {
      depth -= 1
      if (depth === 0) return text.slice(openIndex, index + 1)
    }
  }
  return undefined
}

/**
 * Parse JSON out of model output.
 * @param text - the raw model response.
 * @returns the parsed value, or undefined when no attempt succeeds.
 */
export function parseJsonLoose(text: string): unknown {
  const candidates = [text, unfence(text)]
  const sliced = balancedSlice(unfence(text))
  if (sliced !== undefined) candidates.push(sliced)
  for (const candidate of candidates) {
    if (candidate.trim() === '') continue
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next, narrower candidate; exhausting them all returns undefined.
    }
  }
  return undefined
}

/**
 * Read one object field as a plain record.
 * @param value - any parsed value.
 * @returns the record, or an empty one.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Read one value as trimmed text.
 * @param value - any parsed value.
 * @param fallback - used when the value is neither string nor number.
 * @returns the text.
 */
export function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

/**
 * Read one value as a 0-100 integer score.
 * @param value - any parsed value.
 * @returns the clamped score, or 0 when unusable.
 */
export function asScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

/**
 * Read one value as an array of trimmed strings.
 * @param value - any parsed value.
 * @param limit - maximum entries kept.
 * @returns the string list.
 */
export function asTextList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => asText(item)).filter(item => item !== '').slice(0, limit)
}
