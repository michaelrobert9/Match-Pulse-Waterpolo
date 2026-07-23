// Build the Support Centre content layer from markdown.
//
// Reads src/support/content/** (00-index.md + the article tree), converts each
// article's markdown to HTML, rewrites internal .md cross-links to /support
// routes, and writes a single generated JSON consumed by BOTH:
//   • the frontend  → src/support/content.generated.json
//   • the bot renderer + sitemap → functions/support-content.json
//
// The markdown is the source of truth. Re-run after editing content:
//   node scripts/build-support-content.mjs
//
// Dependency-free: the articles use a small, fixed markdown subset
// (#/##, paragraphs, -/1. lists, **bold**, [links], --- rules, > quotes).

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_DIR = join(ROOT, 'src', 'support', 'content')

// ── helpers ───────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const categoryOf = folder => folder.replace(/^\d+-/, '')   // 03-competitions → competitions

// Resolve a relative .md link from a file in `currentFolder` to a /support route.
function resolveLink(href, currentFolder) {
  if (/^https?:\/\//i.test(href)) return { href, external: true }
  if (!href.endsWith('.md')) return { href, external: false }
  const parts = `${currentFolder}/${href}`.split('/')
  const stack = []
  for (const p of parts) {
    if (p === '..') stack.pop()
    else if (p !== '.' && p !== '') stack.push(p)
  }
  const file = stack[stack.length - 1]
  if (file === '00-index.md') return { href: '/support', external: false }
  const folder = stack[stack.length - 2] ?? ''
  const slug = file.replace(/\.md$/, '')
  return { href: `/support/${categoryOf(folder)}/${slug}`, external: false }
}

// Inline markdown → HTML (links, bold, code). Text is HTML-escaped first.
function inline(text, currentFolder) {
  let out = esc(text)
  // [label](href)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const { href: url, external } = resolveLink(href.trim(), currentFolder)
    const attrs = external ? ' rel="noopener"' : ''
    return `<a href="${url}"${attrs}>${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  return out
}

// Block markdown → HTML. Returns { title, descriptionPlain, html }.
function renderMarkdown(md, currentFolder) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let title = ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    if (/^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').trim(); i++; continue }
    if (/^##\s+/.test(line)) { blocks.push({ t: 'h2', text: line.replace(/^##\s+/, '').trim() }); i++; continue }
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
    // paragraph: gather consecutive non-blank, non-structural lines
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
      case 'h2': return `<h2>${inline(b.text, currentFolder)}</h2>`
      case 'h3': return `<h3>${inline(b.text, currentFolder)}</h3>`
      case 'hr': return '<hr />'
      case 'quote': return `<blockquote>${inline(b.text, currentFolder)}</blockquote>`
      case 'ul': return `<ul>${b.items.map(x => `<li>${inline(x, currentFolder)}</li>`).join('')}</ul>`
      case 'ol': return `<ol>${b.items.map(x => `<li>${inline(x, currentFolder)}</li>`).join('')}</ol>`
      case 'p':
        if (!descriptionPlain) descriptionPlain = b.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '')
        return `<p>${inline(b.text, currentFolder)}</p>`
      default: return ''
    }
  }).join('\n')

  return { title, descriptionPlain: descriptionPlain.trim(), html }
}

// ── parse 00-index.md for ordered sections + article order + intro ─────────────
const indexMd = readFileSync(join(CONTENT_DIR, '00-index.md'), 'utf8').replace(/\r\n/g, '\n')
const indexLines = indexMd.split('\n')
let indexTitle = ''
const introParas = []
const sections = []
let cur = null
let seenSection = false
for (const raw of indexLines) {
  const line = raw.trimEnd()
  if (/^#\s+/.test(line)) { indexTitle = line.replace(/^#\s+/, '').trim(); continue }
  if (/^##\s+/.test(line)) {
    const title = line.replace(/^##\s+/, '').replace(/^\d+\.\s*/, '').trim()
    cur = { title, slug: null, articles: [] }
    sections.push(cur); seenSection = true; continue
  }
  const m = line.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)/)
  if (m && cur) {
    const [, label, href] = m
    const parts = href.split('/')
    const folder = parts.length > 1 ? parts[0] : ''
    const slug = parts[parts.length - 1].replace(/\.md$/, '')
    const category = categoryOf(folder)
    if (!cur.slug) cur.slug = category
    cur.articles.push({ category, slug, label: label.trim() })
    continue
  }
  if (!seenSection && line.trim() && !/^-{3,}$/.test(line)) introParas.push(line.trim())
}

// ── load each referenced article, render, assemble ────────────────────────────
const articles = {}
for (const section of sections) {
  for (const a of section.articles) {
    const folder = readdirSync(CONTENT_DIR).find(d => categoryOf(d) === a.category)
    if (!folder) { console.warn('No folder for category', a.category); continue }
    const md = readFileSync(join(CONTENT_DIR, folder, `${a.slug}.md`), 'utf8')
    const { title, descriptionPlain, html } = renderMarkdown(md, folder)
    const key = `${a.category}/${a.slug}`
    const description = (descriptionPlain || title).slice(0, 155).trim()
    articles[key] = {
      category: a.category, slug: a.slug, key,
      title: title || a.label,
      sectionTitle: section.title, sectionSlug: section.slug,
      description, html,
    }
    a.title = title || a.label   // canonical H1 title in the section listing
    delete a.label
  }
}

const introHtml = introParas.map(p => `<p>${inline(p, '')}</p>`).join('\n')
const out = {
  generatedAt: null,
  index: { title: indexTitle || 'Support Centre', introHtml, introPlain: introParas.join(' ') },
  sections: sections.map(s => ({ title: s.title, slug: s.slug, articles: s.articles })),
  articles,
}

writeFileSync(join(ROOT, 'src', 'support', 'content.generated.json'), JSON.stringify(out, null, 2))
writeFileSync(join(ROOT, 'functions', 'support-content.json'), JSON.stringify(out))
console.log(`Support content built: ${Object.keys(articles).length} articles across ${sections.length} sections.`)
