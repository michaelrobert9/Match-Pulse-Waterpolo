// Build the legal-document content layer from markdown.
//
// Reads src/legal/content/*.md, converts each to HTML with the SAME
// dependency-free markdown subset used by the Support Centre build, resolves the
// "[insert …]" placeholders from the single config file src/legal/legal-config.json,
// and writes one generated JSON consumed by BOTH:
//   • the frontend    → src/legal/content.generated.json
//   • the bot renderer → functions/legal-content.json
//
// The markdown is the source of truth. Re-run after editing content OR after
// setting the contact / regulator emails in legal-config.json:
//   node scripts/build-legal-content.mjs
//
// Dependency-free (same fixed markdown subset as build-support-content.mjs:
// #/##/###, paragraphs, -/1. lists, **bold**, `code`, [links], --- rules, > quotes).

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_DIR = join(ROOT, 'src', 'legal', 'content')

// The four documents, in the order they appear in the footer / index.
const DOCS = [
  { slug: 'terms',           file: 'terms.md' },
  { slug: 'privacy',         file: 'privacy.md' },
  { slug: 'cookies',         file: 'cookies.md' },
  { slug: 'acceptable-use',  file: 'acceptable-use.md' },
]

// ── markdown → HTML (mirrors scripts/build-support-content.mjs) ─────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function resolveLink(href) {
  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) return { href, external: true }
  return { href, external: false }   // internal app links like /plans, /legal/privacy
}

function inline(text) {
  let out = esc(text)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const { href: url, external } = resolveLink(href.trim())
    const attrs = external ? ' rel="noopener"' : ''
    return `<a href="${url}"${attrs}>${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  return out
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let title = ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (/^#\s+/.test(line))   { title = line.replace(/^#\s+/, '').trim(); i++; continue }
    if (/^##\s+/.test(line))  { blocks.push({ t: 'h2', text: line.replace(/^##\s+/, '').trim() }); i++; continue }
    if (/^###\s+/.test(line)) { blocks.push({ t: 'h3', text: line.replace(/^###\s+/, '').trim() }); i++; continue }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue }
    if (/^>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push({ t: 'quote', text: buf.join(' ') }); continue
    }
    if (/^[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++ }
      blocks.push({ t: 'ul', items }); continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++ }
      blocks.push({ t: 'ol', items }); continue
    }
    const buf = []
    while (i < lines.length && lines[i].trim()
      && !/^(#{1,3}\s|>\s?|[-*]\s|\d+\.\s|-{3,}\s*$|\*{3,}\s*$)/.test(lines[i])) {
      buf.push(lines[i]); i++
    }
    blocks.push({ t: 'p', text: buf.join(' ') })
  }

  let descriptionPlain = ''
  const html = blocks.map(b => {
    switch (b.t) {
      case 'h2': return `<h2>${inline(b.text)}</h2>`
      case 'h3': return `<h3>${inline(b.text)}</h3>`
      case 'hr': return '<hr />'
      case 'quote': return `<blockquote>${inline(b.text)}</blockquote>`
      case 'ul': return `<ul>${b.items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`
      case 'ol': return `<ol>${b.items.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`
      case 'p':
        if (!descriptionPlain) descriptionPlain = b.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '')
        return `<p>${inline(b.text)}</p>`
      default: return ''
    }
  }).join('\n')

  return { title, descriptionPlain: descriptionPlain.trim(), html }
}

// ── placeholder resolution (single source: legal-config.json) ──────────────────
const cfg = JSON.parse(readFileSync(join(ROOT, 'src', 'legal', 'legal-config.json'), 'utf8'))

function mailto(addr) { return `<a href="mailto:${esc(addr)}">${esc(addr)}</a>` }

function fillPlaceholders(html) {
  let out = html
  // Contact enquiries go through the on-site contact form (/contact), linked
  // directly from the markdown — there is no contact-email placeholder anymore.
  // The Information Regulator complaints email is still config-driven: set →
  // mailto link; unset → leave the visible placeholder so it is obviously unfilled.
  if (cfg.infoRegulatorEmail) {
    out = out.split('[insert current Information Regulator complaints email]').join(mailto(cfg.infoRegulatorEmail))
  }
  return out
}

// ── build each doc ─────────────────────────────────────────────────────────────
const docs = {}
for (const d of DOCS) {
  let md = readFileSync(join(CONTENT_DIR, d.file), 'utf8')
  // Pull the "Last updated" line out for the page meta, then strip it from the body.
  const luMatch = md.match(/^\*\*Last updated:\s*([^*]+)\*\*\s*$/m)
  const lastUpdated = luMatch ? luMatch[1].trim() : null
  if (luMatch) md = md.replace(luMatch[0], '')
  const { title, descriptionPlain, html } = renderMarkdown(md)
  docs[d.slug] = {
    slug: d.slug,
    title,
    lastUpdated,
    description: (descriptionPlain || title).slice(0, 155).trim(),
    html: fillPlaceholders(html),
  }
}

const out = { generatedAt: null, order: DOCS.map(d => d.slug), docs }
writeFileSync(join(ROOT, 'src', 'legal', 'content.generated.json'), JSON.stringify(out, null, 2))
writeFileSync(join(ROOT, 'functions', 'legal-content.json'), JSON.stringify(out))
console.log(`Legal content built: ${Object.keys(docs).length} documents.`)
