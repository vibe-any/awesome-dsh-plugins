/**
 * Tiny dependency-free Markdown → HTML renderer for article detail reading.
 *
 * Security model: every raw piece is HTML-escaped FIRST; links only pass
 * through when their href is http(s)/relative/root-relative, so no script or
 * javascript: URL can survive rendering. Good enough for reading published
 * hub articles elegantly; not a general-purpose Markdown engine.
 */

/** Escape HTML specials so nothing raw reaches innerHTML. */
function esc(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Allow-list an href: http(s), root-relative, or same-page anchors only. */
function safeHref(raw) {
  const href = String(raw ?? '').trim()
  if (/^(https?:\/\/|\/|#)/i.test(href)) return href
  return null
}

/** Inline-level transforms (applied to already-escaped text). */
function inline(text) {
  let out = esc(text)
  // images: ![alt](src)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    const href = safeHref(src)
    return href === null
      ? alt
      : `<img class="pwa-md-img" src="${href}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" />`
  })
  // links: [text](href)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safe = safeHref(href)
    return safe === null ? label : `<a class="pwa-md-link" href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })
  out = out.replace(/`([^`]+)`/g, '<code class="pwa-md-code">$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  return out
}

/** Split one table row into trimmed cell texts (unescaping \| separators). */
function splitTableRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  // drop the trailing boundary pipe unless it is escaped
  if (/[^\\]\|?$/.test(s) && s.endsWith('|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/g).map(cell => cell.trim().replace(/\\\|/g, '|'))
}

/** Delimiter-row cell → CSS text-align value ('' when default left). */
function delimiterAlign(cell) {
  const s = cell.trim()
  const left = s.startsWith(':')
  const right = s.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return ''
}

const isTableDelimiter = line => {
  const s = line.trim()
  // only | - : and whitespace, must contain both a pipe and a dash run
  return /^[\s|:-]+$/.test(s) && s.includes('|') && /-/.test(s)
}

/**
 * Render a Markdown string to an HTML fragment.
 *
 * Fenced code blocks are extracted into placeholders before line processing,
 * so their content is never interpreted as markup. GFM tables (header +
 * `| --- |` delimiter row) are parsed with per-column alignment support.
 * @param md - raw markdown text (untrusted).
 */
export function renderMarkdown(md) {
  const source = String(md ?? '').replace(/\r\n/g, '\n')

  // Pass 1: hoist ``` fenced blocks into \u0000<n>\u0000 placeholders.
  const fences = []
  const hoisted = source.replace(/^```[^\n]*\n([\s\S]*?)^```\s*$/gm, (_m, body) => {
    fences.push(`<pre class="pwa-md-pre"><code>${esc(body.replace(/\n$/, ''))}</code></pre>`)
    return `\u0000${fences.length - 1}\u0000`
  })

  // Pass 2: block-level line walk.
  const html = []
  let list = null // currently open list kind: 'ul' | 'ol' | null
  let paragraph = []

  const closeList = () => {
    if (list !== null) {
      html.push(`</${list}>`)
      list = null
    }
  }
  const openList = kind => {
    if (list !== kind) {
      closeList()
      html.push(`<${kind} class="pwa-md-list">`)
      list = kind
    }
  }
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p class="pwa-md-p">${paragraph.map(inline).join('<br class="pwa-md-br" />')}</p>`)
      paragraph = []
    }
  }

  const lines = hoisted.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const trimmed = rawLine.trim()

    if (trimmed === '') {
      flushParagraph()
      closeList()
      continue
    }
    // restored fenced block placeholder
    const fence = trimmed.match(/^\u0000(\d+)\u0000$/)
    if (fence) {
      flushParagraph()
      closeList()
      html.push(fences[Number(fence[1])])
      continue
    }
    // horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      closeList()
      html.push('<hr class="pwa-md-hr" />')
      continue
    }
    // GFM table: header row + delimiter row (`| --- | :---: |`)
    if (
      trimmed.startsWith('|') &&
      trimmed.includes('|', 1) &&
      index + 1 < lines.length &&
      isTableDelimiter(lines[index + 1])
    ) {
      flushParagraph()
      closeList()
      const head = splitTableRow(trimmed)
      const aligns = splitTableRow(lines[index + 1]).map(delimiterAlign)
      const alignAttr = column =>
        aligns[column] ? ` style="text-align:${aligns[column]}"` : ''
      const bodyRows = []
      let cursor = index + 2
      while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
        bodyRows.push(splitTableRow(lines[cursor]))
        cursor += 1
      }
      const ths = head.map((cell, column) => `<th${alignAttr(column)}>${inline(cell)}</th>`).join('')
      const trs = bodyRows
        .map(row => `<tr>${row.map((cell, column) => `<td${alignAttr(column)}>${inline(cell)}</td>`).join('')}</tr>`)
        .join('')
      html.push(
        `<div class="pwa-md-twrap"><table class="pwa-md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`,
      )
      index = cursor - 1
      continue
    }
    // headings (# .. ###### → h2..h6 visually capped)
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      closeList()
      const level = Math.min(heading[1].length + 1, 6)
      html.push(`<h${level} class="pwa-md-h">${inline(heading[2])}</h${level}>`)
      continue
    }
    // blockquote (single-line granularity keeps the renderer tiny)
    const quote = trimmed.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      closeList()
      html.push(`<blockquote class="pwa-md-quote">${inline(quote[1])}</blockquote>`)
      continue
    }
    // lists
    const ul = trimmed.match(/^[-*+]\s+(.*)$/)
    if (ul) {
      flushParagraph()
      openList('ul')
      html.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/)
    if (ol) {
      flushParagraph()
      openList('ol')
      html.push(`<li>${inline(ol[1])}</li>`)
      continue
    }

    paragraph.push(trimmed)
  }
  flushParagraph()
  closeList()
  return html.join('\n')
}
