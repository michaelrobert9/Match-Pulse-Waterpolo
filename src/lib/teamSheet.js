// Bulk team sheet parsing — water polo rules (bulk team sheets brief §5).
//
// Pure functions, no Firebase. The parser NEVER refuses a line: anything it
// cannot read becomes a row with the raw text in the name field, flagged for
// review in the grid. Tab-delimited paste (Excel / Sheets) is the reliable
// path; free text is best effort.
//
// Water polo caps run 1–13 in a standard squad, occasionally to 15. Cap 1 is
// the goalkeeper, cap 13 the reserve goalkeeper. A sheet numbered 1..13 in
// order is genuinely ambiguous (numbered list vs real caps) — the water polo
// heuristic therefore differs from hockey/netball ON PURPOSE (§0, §5):
//   • 1..N sequential, N 11–15, row count matches N  → cap numbers
//   • 1..N sequential, N outside that range and long (e.g. 1..20) → list ordinals
//   • gapped or out of order                          → cap numbers
//   • default                                         → cap numbers

// Surname particles — the shared implementation, copied VERBATIM from rugby's
// src/lib/teamSheet.js (closing round item 5). Must stay byte-identical with
// splitName below so all four sports split names the same way.
const SURNAME_PARTICLES = new Set([
  'van', 'von', 'der', 'den', 'de', 'du', 'da', 'ter', 'ten', 'le', 'la', 'el',
])

// Title-case one word, preserving internal capitals (McDonald, O'Brien) when
// the word already carries mixed case. ALL-CAPS and all-lower words are
// normalised; Mc/Mac/O' prefixes re-capitalise the letter that follows.
// Body ported from hockey's src/lib/teamSheet.js titleWord() — keep the
// casing behaviour identical across all four sports.
function titleCaseWord(w) {
  if (!w) return w
  const lower = w.toLowerCase()
  if (SURNAME_PARTICLES.has(lower)) return lower
  // Mixed case already (McDonald, O'Brien, du Plessis handled above) — keep.
  if (w !== w.toUpperCase() && w !== lower) return w
  let out = lower.charAt(0).toUpperCase() + lower.slice(1)
  out = out.replace(/^Mc(\w)/, (_, c) => 'Mc' + c.toUpperCase())
  out = out.replace(/^Mac(\w{2,})/, (m, rest) => 'Mac' + rest.charAt(0).toUpperCase() + rest.slice(1))
  out = out.replace(/^O'(\w)/, (_, c) => "O'" + c.toUpperCase())
  out = out.replace(/-(\w)/g, (_, c) => '-' + c.toUpperCase())
  return out
}

// Normalise a name to title case word by word, preserving McDonald /
// van der Merwe / O'Brien / du Plessis. A word already carrying mixed case is
// someone's deliberate spelling and is left alone; ALL-CAPS and all-lower
// words are normalised.
export function normaliseName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').split(' ').map(titleCaseWord).join(' ')
}

// Split a display name into first name(s) + surname. Splits on the last space,
// then pulls surname particles back in ("Jan van der Merwe" → "Jan" +
// "van der Merwe"). Single token → surname only.
// Copied VERBATIM from rugby's src/lib/teamSheet.js (closing round item 5) —
// returns { firstName, lastName }; keep byte-identical across all four sports.
export function splitName(fullName) {
  const tokens = fullName.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  if (tokens.length === 0) return { firstName: '', lastName: '' }
  if (tokens.length === 1) return { firstName: '', lastName: tokens[0] }
  let split = tokens.length - 1
  while (split > 1 && SURNAME_PARTICLES.has(tokens[split - 1].toLowerCase())) split--
  return {
    firstName: tokens.slice(0, split).join(' '),
    lastName:  tokens.slice(split).join(' '),
  }
}

// Parse ONE line into { parsedNumber, name, isCaptain, unreadable, raw }.
// parsedNumber is the number as written — whether it is a cap number or a
// list ordinal is decided later, over the whole sheet (guessNumbersAreCaps).
export function parseLine(raw) {
  const out = { parsedNumber: null, name: '', isCaptain: false, unreadable: false, raw }
  let line = (raw ?? '').replace(/\u00A0/g, ' ').trim()
  if (!line) return null // caller drops empty lines

  // Strip a leading bullet / list marker so it never lands in the name and does
  // not hide a following number.
  line = line.replace(/^\s*(?:[•·▪▫◦‣⁃*]+|[-–—])\s+/, '').trim()
  if (!line) return null

  // Trailing captain marker: "(C)", "(c)" or "©"
  const capMatch = line.match(/\s*(\(c\)|©)\s*$/i)
  if (capMatch) {
    out.isCaptain = true
    line = line.slice(0, capMatch.index).trim()
  }

  const numToken = s => {
    // A cell/token that IS a number, allowing a leading "Cap " or "#".
    const m = String(s).trim().match(/^(?:cap\s*|#)?(\d{1,3})$/i)
    return m ? parseInt(m[1], 10) : null
  }

  // 1. Tab-delimited (spreadsheet paste) — the reliable path. Number cell may
  //    be in any column; the remaining cells joined are the name.
  if (line.includes('\t')) {
    const cells = line.split('\t').map(c => c.trim()).filter(Boolean)
    const nameCells = []
    for (const cell of cells) {
      const n = numToken(cell)
      if (n != null && out.parsedNumber == null) out.parsedNumber = n
      else nameCells.push(cell)
    }
    out.name = normaliseName(nameCells.join(' '))
    if (!out.name) out.unreadable = true
    if (out.unreadable) out.name = raw.trim()
    return out
  }

  // 2. Leading number: "1. John", "1) John", "1 John", "Cap 4 John", "#4 John"
  let m = line.match(/^(?:cap\s+|#)?(\d{1,3})[.)]?\s+(.+)$/i)
  if (m) {
    out.parsedNumber = parseInt(m[1], 10)
    out.name = normaliseName(m[2])
    return out
  }

  // 3. Trailing number: "John Smith, 7", "John Smith 4", "John Smith #4"
  m = line.match(/^(.+?)[,\s]\s*(?:cap\s*|#)?(\d{1,3})$/i)
  if (m && /[A-Za-z]/.test(m[1])) {
    out.parsedNumber = parseInt(m[2], 10)
    out.name = normaliseName(m[1].replace(/[,\s]+$/, ''))
    // "Smith, John 7" — reversed name AND trailing number; reverse below.
  } else if (/[A-Za-z]/.test(line)) {
    // 4. No number — the whole line is the name.
    out.name = normaliseName(line)
  } else {
    // Nothing readable (no letters). Raw text into the name field, flagged.
    out.unreadable = true
    out.name = raw.trim()
    return out
  }

  // "Smith, John" → "John Smith" (comma with a non-numeric tail)
  const comma = out.name.match(/^([^,]+),\s*(.+)$/)
  if (comma && !/^\d+$/.test(comma[2].trim())) {
    out.name = `${comma[2].trim()} ${comma[1].trim()}`
  }
  return out
}

// Water polo interpretation rule (§5). Given the parsed rows, decide whether
// the numbers are cap numbers (true) or list ordinals (false).
export function guessNumbersAreCaps(rows) {
  const numbered = rows.filter(r => r.parsedNumber != null)
  if (numbered.length === 0) return true // nothing to interpret — default caps
  const nums = numbered.map(r => r.parsedNumber)
  const isSequentialFromOne = nums.every((n, i) => n === i + 1)
  if (!isSequentialFromOne) return true // gapped or out of order → caps
  const N = nums[nums.length - 1]
  if (N >= 11 && N <= 15 && numbered.length === N) return true // real cap range
  if (N > 15) return false // 1..20 in order → someone numbered a list
  return true // short sequential runs: default for water polo is caps
}

// Parse a whole pasted sheet. Returns { rows, numbersAreCaps } where each row
// is { key, parsedNumber, capNumber, firstName, surname, isCaptain,
// unreadable, raw }. capNumber respects the caps/list interpretation;
// flipping the interpretation later should call applyNumbersMode on the SAME
// rows (never re-parse from raw text) so name edits made in the grid survive.
export function parseTeamSheet(text) {
  const rows = (text ?? '')
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean)
    .map((r, i) => ({ key: `row-${i}-${Date.now()}`, ...r }))
  const numbersAreCaps = guessNumbersAreCaps(rows)
  return { rows: rows.map(r => decorateRow(r, numbersAreCaps)), numbersAreCaps }
}

function decorateRow(row, numbersAreCaps) {
  // splitName (rugby's) returns { firstName, lastName }; the grid's second name
  // column is `surname`, so map lastName → surname here.
  const { firstName, lastName } = splitName(row.name)
  return { ...row, capNumber: numbersAreCaps ? row.parsedNumber : null, firstName, surname: lastName }
}

// Re-apply a caps/list interpretation to existing rows without touching the
// (possibly user-edited) name fields. Only capNumber changes — and only for
// rows the user has not manually overridden (capEdited).
export function applyNumbersMode(rows, numbersAreCaps) {
  return rows.map(r => r.capEdited ? r : { ...r, capNumber: numbersAreCaps ? r.parsedNumber : null })
}

// Duplicate warnings for the grid (§7): duplicate cap numbers and duplicate
// names each get a warning chip, never a block.
export function duplicateCapNumbers(rows) {
  const seen = new Map()
  for (const r of rows) {
    if (r.capNumber == null) continue
    seen.set(r.capNumber, (seen.get(r.capNumber) ?? 0) + 1)
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([cap]) => cap))
}

export function duplicateNames(rows) {
  const seen = new Map()
  for (const r of rows) {
    const key = `${r.firstName} ${r.surname}`.trim().toLowerCase()
    if (!key) continue
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name))
}

// Next unused cap number for the "Add row" default (§7).
export function nextUnusedCap(rows) {
  const used = new Set(rows.map(r => r.capNumber).filter(n => n != null))
  let n = 1
  while (used.has(n)) n++
  return n
}

// ── §6 profile matching ──────────────────────────────────────────────────────
// Match a parsed row against existing player profiles. Biased towards
// linking: a duplicate profile is worse than a wrong link, because a wrong
// link is visible and fixable and a duplicate is silent.
//   • exactly one exact full-name match       → 'linked' (no prompt)
//   • several exact matches, or fuzzy matches → 'ambiguous' (chooser)
//   • nothing plausible                       → 'new'
// Fuzzy = same surname + same first initial (catches "J Smith" vs "John
// Smith" and minor first-name variants).
export function matchRowToPeople(row, people) {
  const fullName = `${row.firstName} ${row.surname}`.trim().toLowerCase()
  if (!fullName || row.unreadable) return { status: 'new', personId: null, candidates: [] }
  const exact = people.filter(p => (p.fullName ?? '').trim().toLowerCase() === fullName)
  if (exact.length === 1) return { status: 'linked', personId: exact[0].id, candidates: exact }
  if (exact.length > 1) return { status: 'ambiguous', personId: null, candidates: exact }
  const surname = row.surname.trim().toLowerCase()
  const initial = row.firstName.trim().toLowerCase()[0] ?? ''
  const fuzzy = surname
    ? people.filter(p => {
        const parts = (p.fullName ?? '').trim().toLowerCase().split(/\s+/)
        const pSurname = parts[parts.length - 1] ?? ''
        const pInitial = parts[0]?.[0] ?? ''
        return pSurname === surname && pInitial === initial && parts.length > 1
      })
    : []
  if (fuzzy.length > 0) return { status: 'ambiguous', personId: null, candidates: fuzzy }
  return { status: 'new', personId: null, candidates: [] }
}
