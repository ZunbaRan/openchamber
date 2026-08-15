/**
 * Generates the SVG icon sprite file from @remixicon/react bundle.
 *
 * Usage: bun run scripts/generate-icon-sprite.mjs
 *
 * Reads the minified @remixicon/react bundle, extracts SVG path data
 * for all Ri* icons used in packages/ui/src, and writes
 * packages/ui/src/components/icon/sprite.ts.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const remixPath = resolve(repoRoot, "node_modules/@remixicon/react/index.mjs")
const outPath = resolve(repoRoot, "packages/ui/src/components/icon/sprite.ts")

const roundedStrokeIcon = (content) =>
  `<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${content}</g>`

// OpenLoop owns the high-visibility navigation glyphs below. Their semantic
// names stay identical to the Remixicon-backed contract, so components and
// upstream additions keep using <Icon name="..."> while the generator swaps
// in the softer rounded geometry. Unlisted icons continue to use Remixicon.
const customIconData = new Map([
  [
    "openchamber",
      `<polygon points="12 2.5 3.5 7.4 3.5 17.2 12 22.1 20.5 17.2 20.5 7.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="3.5 7.4 12 12.3 20.5 7.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="12.3" x2="12" y2="22.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m12 5.5 3.7 2.1L12 9.7 8.3 7.6 12 5.5Zm0 1.5-1 .6 1 .6 1-.6-1-.6Z" fill="currentColor" fill-rule="evenodd"/>`,
  ],
  [
    "apps-2-ai",
    roundedStrokeIcon(`<circle cx="7" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/><path d="m16.5 3 .6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/>`),
  ],
  [
    "archive",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5v9.8A1.7 1.7 0 0 0 6.7 20h10.6a1.7 1.7 0 0 0 1.7-1.7V8.5M9.5 13h5"/>`),
  ],
  [
    "arrows-merge",
    roundedStrokeIcon(`<circle cx="6" cy="4.5" r="1.5"/><circle cx="18" cy="4.5" r="1.5"/><circle cx="12" cy="19.5" r="1.5"/><path d="M6 6v3.5c0 3.3 2.7 6 6 6v2.5M18 6v3.5c0 3.3-2.7 6-6 6"/>`),
  ],
  [
    "calendar-schedule",
    roundedStrokeIcon(`<path d="M4 8h16M7 3v3M17 3v3M6 5h12a2 2 0 0 1 2 2v5.5M10.5 20H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2"/><circle cx="16.5" cy="16.5" r="4.5"/><path d="M16.5 14.2v2.6l1.8 1"/>`),
  ],
  [
    "chat-4",
    roundedStrokeIcon(`<path d="M6.5 18.5 3.5 21v-4.6A7.5 7.5 0 0 1 2.5 12c0-4.7 4.2-8.5 9.5-8.5s9.5 3.8 9.5 8.5-4.2 8.5-9.5 8.5c-2 0-3.9-.6-5.5-2Z"/>`),
  ],
  [
    "chat-new",
    roundedStrokeIcon(`<path d="M6.5 18.5 3.5 21v-4.6A7.5 7.5 0 0 1 2.5 12c0-4.7 4.2-8.5 9.5-8.5s9.5 3.8 9.5 8.5-4.2 8.5-9.5 8.5c-2 0-3.9-.6-5.5-2Z"/><path d="M12 8v8M8 12h8"/>`),
  ],
  [
    "checkbox-multiple",
    roundedStrokeIcon(`<rect x="7" y="4" width="13" height="13" rx="2.5"/><path d="M7 8H5.5A2.5 2.5 0 0 0 3 10.5v7A2.5 2.5 0 0 0 5.5 20h7a2.5 2.5 0 0 0 2.5-2.5V17M10.5 10.5l2 2 4-4"/>`),
  ],
  [
    "donut-chart-fill",
    roundedStrokeIcon(`<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>`),
  ],
  [
    "equalizer-2",
    roundedStrokeIcon(`<path d="M4 6h5M15 6h5M4 12h9M19 12h1M4 18h2M12 18h8"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>`),
  ],
  [
    "file-text",
    roundedStrokeIcon(`<path d="M6 3.5h7l5 5v12H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M13 3.5v5h5M8 13h6M8 17h4"/>`),
  ],
  [
    "folder-3",
    roundedStrokeIcon(`<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2H19a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>`),
  ],
  [
    "folder-add",
    roundedStrokeIcon(`<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2H19a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><path d="M15.5 11v6M12.5 14h6"/>`),
  ],
  [
    "git-branch",
    roundedStrokeIcon(`<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 7v2a4 4 0 0 1-4 4h-4a4 4 0 0 0-4 4"/>`),
  ],
  [
    "git-pull-request",
    roundedStrokeIcon(`<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M14 5h2a2 2 0 0 1 2 2v10M14 8l-3-3 3-3"/>`),
  ],
  [
    "global",
    roundedStrokeIcon(`<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z"/>`),
  ],
  [
    "layout-left",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>`),
  ],
  [
    "layout-right",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/>`),
  ],
  [
    "route",
    roundedStrokeIcon(`<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H13a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3h-2a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h4.5"/>`),
  ],
  [
    "search",
    roundedStrokeIcon(`<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.2 15.2 4.8 4.8"/>`),
  ],
  [
    "server",
    roundedStrokeIcon(`<rect x="4" y="3.5" width="16" height="7" rx="2"/><rect x="4" y="13.5" width="16" height="7" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/>`),
  ],
  [
    "sticky-note",
    roundedStrokeIcon(`<path d="M6 3.5h12A2.5 2.5 0 0 1 20.5 6v9.5L16 20H6a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 6 3.5Z"/><path d="M15.5 20v-3a1.5 1.5 0 0 1 1.5-1.5h3.5M8 8h8M8 12h5"/>`),
  ],
  [
    "terminal-box",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7 9 3 3-3 3M13 15h4"/>`),
  ],
  // Second pass: settings navigation, desktop header, and project tree glyphs
  // that use different Remixicon semantic names from the first rounded batch.
  [
    "ai-generate-2",
    roundedStrokeIcon(`<rect x="3.5" y="5" width="13" height="15.5" rx="2.5"/><path d="m18.5 2 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z"/><path d="m11.5 10 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z"/>`),
  ],
  [
    "bar-chart-2",
    roundedStrokeIcon(`<path d="M4 20V11M9.3 20V6M14.7 20v-8M20 20V3.5"/>`),
  ],
  [
    "book",
    roundedStrokeIcon(`<path d="M5.5 3.5h13A2.5 2.5 0 0 1 21 6v14.5H6a3 3 0 0 1-3-3V6a2.5 2.5 0 0 1 2.5-2.5Z"/><path d="M6 16.5h15M7.5 7.5h8"/>`),
  ],
  [
    "book-open",
    roundedStrokeIcon(`<path d="M12 6.5c-1.7-1.8-4.4-2.7-8-2.5v14.5c3.6-.2 6.3.7 8 2.5M12 6.5c1.7-1.8 4.4-2.7 8-2.5v14.5c-3.6-.2-6.3.7-8 2.5M12 6.5V21"/>`),
  ],
  [
    "chat-ai-3",
    roundedStrokeIcon(`<path d="M6.5 18.5 3.5 21v-4.6A7.5 7.5 0 0 1 2.5 12c0-4.7 4.2-8.5 9.5-8.5 1.2 0 2.4.2 3.4.6M8 11.5h4"/><path d="m18.5 4 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z"/>`),
  ],
  [
    "chat-history",
    roundedStrokeIcon(`<path d="M6.5 18.5 3.5 21v-4.6A7.5 7.5 0 0 1 2.5 12c0-4.7 4.2-8.5 9.5-8.5 5.1 0 9.2 3.5 9.5 8"/><circle cx="16.5" cy="16.5" r="4.5"/><path d="M16.5 14v2.8l1.8 1"/>`),
  ],
  [
    "chat-thread",
    roundedStrokeIcon(`<path d="M7 15.5 3.5 18v-4.2A6.8 6.8 0 0 1 3 11.2C3 7.2 6.6 4 11 4s8 3.2 8 7.2c0 .4 0 .8-.1 1.2"/><path d="M13.5 18.5 16 21v-3.4a5.2 5.2 0 0 0 1.3-3.4c0-2.8-2.4-5.1-5.5-5.1"/>`),
  ],
  [
    "command",
    roundedStrokeIcon(`<path d="M9 8V5.5A2.5 2.5 0 1 0 6.5 8H9Zm0 0h6m0 0V5.5A2.5 2.5 0 1 1 17.5 8H15Zm0 0v8m0 0h2.5a2.5 2.5 0 1 1-2.5 2.5V16Zm0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 16H9Zm0 0V8"/>`),
  ],
  [
    "computer",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M9 21h6M12 17v4"/>`),
  ],
  [
    "folder",
    roundedStrokeIcon(`<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2H19a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>`),
  ],
  [
    "folder-6",
    roundedStrokeIcon(`<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2H19a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><path d="M3.5 10h17"/>`),
  ],
  [
    "folder-open",
    roundedStrokeIcon(`<path d="M3.5 10V7.5A2.5 2.5 0 0 1 6 5h3.5l2 2H18a2 2 0 0 1 2 2v1"/><path d="M4 10h17l-2.2 8.2a2.4 2.4 0 0 1-2.3 1.8h-11a2.4 2.4 0 0 1-2.3-3Z"/>`),
  ],
  [
    "folders",
    roundedStrokeIcon(`<path d="M6.5 6V5A2 2 0 0 1 8.5 3h3l2 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1"/><path d="M2.5 10A2.5 2.5 0 0 1 5 7.5h3.5l2 2H17a2 2 0 0 1 2 2v7A2.5 2.5 0 0 1 16.5 21H5A2.5 2.5 0 0 1 2.5 18.5Z"/>`),
  ],
  [
    "history",
    roundedStrokeIcon(`<path d="M4 7.5V3.5M4 7.5h4"/><path d="M4.7 7.1A9 9 0 1 1 3 12"/><path d="M12 7.5V12l3 2"/>`),
  ],
  [
    "home-office",
    roundedStrokeIcon(`<path d="m3 10 9-7 9 7M5 9v11h14V9"/><path d="M8 20v-6h8v6M9 9h6"/>`),
  ],
  [
    "layout-column",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>`),
  ],
  [
    "list-indefinite",
    roundedStrokeIcon(`<path d="M13 5h8M13 12h8M13 19h8"/><rect x="3" y="3.5" width="6" height="6" rx="2"/><circle cx="6" cy="18" r="3"/>`),
  ],
  [
    "mic",
    roundedStrokeIcon(`<rect x="8" y="3" width="8" height="13" rx="4"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7"/>`),
  ],
  [
    "notification-3",
    roundedStrokeIcon(`<path d="M5 17.5h14l-1.5-2.3V10a5.5 5.5 0 0 0-11 0v5.2ZM9.5 20a2.7 2.7 0 0 0 5 0"/>`),
  ],
  [
    "palette",
    roundedStrokeIcon(`<path d="M12 3a9 9 0 0 0 0 18h1a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4h1.7A3.5 3.5 0 0 0 21 10.7C21 6.4 17 3 12 3Z"/><circle cx="7.5" cy="11.5" r=".7"/><circle cx="10" cy="7" r=".7"/><circle cx="15" cy="7.5" r=".7"/>`),
  ],
  [
    "picture-in-picture-2",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="16" rx="3"/><rect x="12.5" y="11.5" width="6" height="5" rx="1.5"/><path d="m7 12 4-4M7 8h4v4"/>`),
  ],
  [
    "plug-2",
    roundedStrokeIcon(`<path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-5 5.9V21h-2v-5.1A6 6 0 0 1 6 10Z"/>`),
  ],
  [
    "window",
    roundedStrokeIcon(`<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>`),
  ],
])

const source = readFileSync(remixPath, "utf-8")

// --- Step 1: extract variable → path mapping ---
// Pattern: const VARNAME=({color:...})=>...createElement("path",{d:"PATH_DATA"})...,
// Each icon is defined as `const X=...` where X is 1-4 chars.
const varPathMap = new Map()
const varRegex = /(?:[,;]const |\),)([A-Za-z0-9_$]{1,4})=\([{]color:/g
// Find all variable definitions and their boundaries
const varPositions = []
let m
while ((m = varRegex.exec(source)) !== null) {
  varPositions.push({
    varName: m[1],
    start: m.index + m[0].length - 1, // first `{` after `=({color:`
  })
}

for (let i = 0; i < varPositions.length; i++) {
  const current = varPositions[i]
  const next = varPositions[i + 1]
  // End at the )), just before the next variable definition
  const end = next
    ? source.indexOf("))," + next.varName + "=(", current.start)
    : source.length
  if (end < 0 || end < current.start) continue
  const segment = source.slice(current.start, end)
  const pathRegex = /\w+\.createElement\("path",[{]d:"([^"]*)"/g
  let pm
  const paths = []
  while ((pm = pathRegex.exec(segment)) !== null) {
    paths.push(pm[1])
  }
  if (paths.length > 0) {
    varPathMap.set(current.varName, paths)
  }
}

// --- Step 2: extract export mapping ---
// The export map is near the end of the file:
// export{V1 as Ri...Z2 as RiLast};
const exportRegex = /export[{]([^}]+)[}]/
const exportMatch = exportRegex.exec(source)
if (!exportMatch) {
  console.error("Could not find export mapping in remixicon bundle")
  process.exit(1)
}

const nameToVar = new Map()
const entries = exportMatch[1].split(",")
for (const entry of entries) {
  // Pattern: VAR as RiIconName
  const parts = entry.trim().split(" as ")
  if (parts.length === 2) {
    nameToVar.set(parts[1].trim(), parts[0].trim())
  }
}

const remixToSpriteName = (name) => {
  // RiArrowDownSLine → arrow-down-s
  // RiGithubFill → github-fill (keep Fill for fill variants)
  return name
    .replace(/^Ri/, "")
    .replace(/Line$/, "")
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
}

const spriteNameToRi = new Map()
const hasRemixVariantSuffix = (name) => name.endsWith("Line") || name.endsWith("Fill")
const shouldPreferSpriteCandidate = (current, candidate) => {
  if (!current) return true
  if (!hasRemixVariantSuffix(candidate) && hasRemixVariantSuffix(current)) return true
  if (!hasRemixVariantSuffix(current)) return false
  if (candidate.endsWith("Line") && !current.endsWith("Line")) return true
  return false
}

for (const iconName of nameToVar.keys()) {
  const spriteName = remixToSpriteName(iconName)
  const current = spriteNameToRi.get(spriteName)
  if (shouldPreferSpriteCandidate(current, iconName)) {
    spriteNameToRi.set(spriteName, iconName)
  }
}

// --- Step 3: find which icons we actually use ---
const srcDir = resolve(repoRoot, "packages/ui/src")

// Helper: convert kebab-case name back to RiName
function nameToRi(kebab) {
  // "arrow-down-sline" → RiArrowDownSline
  const parts = kebab.split("-")
  let result = "Ri"
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i > 0 && /^\d/.test(part)) {
      result += part[0].toUpperCase() + part.slice(1)
    } else {
      result += part.charAt(0).toUpperCase() + part.slice(1)
    }
  }
  return result
}

// Finish step 3 synchronously with simpler approach
function findAllSourceFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    try {
      const st = statSync(full)
      if (st.isDirectory()) {
        if (entry === "node_modules") continue
        results.push(...findAllSourceFiles(full))
      } else if (/\.(tsx?)$/.test(entry) && full !== outPath) {
        results.push(full)
      }
    } catch { /* skip */ }
  }
  return results
}

const allSrcFiles = findAllSourceFiles(srcDir)
const usedIcons = new Set()
const usedCustomIcons = new Set()
const addKebabIcon = (kebab) => {
  if (customIconData.has(kebab)) {
    usedCustomIcons.add(kebab)
    return true
  }

  const exactRiName = spriteNameToRi.get(kebab)
  if (exactRiName && !hasRemixVariantSuffix(exactRiName)) {
    usedIcons.add(exactRiName)
    return true
  }

  for (const suffix of ["Line", "Fill", ""]) {
    const riName = nameToRi(kebab) + suffix
    if (nameToVar.has(riName)) {
      usedIcons.add(riName)
      return true
    }
  }

  if (exactRiName) {
    usedIcons.add(exactRiName)
    return true
  }

  return false
}

const addIconLiterals = (content) => {
  const iconLiteralRegex = /["']([a-z][a-z0-9-]*)["']/g
  let literal
  while ((literal = iconLiteralRegex.exec(content)) !== null) {
    addKebabIcon(literal[1])
  }
}

function findMatchingBrace(content, openBraceIndex) {
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = openBraceIndex; i < content.length; i++) {
    const char = content[i]
    const next = content[i + 1]

    if (lineComment) {
      if (char === "\n") lineComment = false
      continue
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false
        i++
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "/" && next === "/") {
      lineComment = true
      i++
      continue
    }

    if (char === "/" && next === "*") {
      blockComment = true
      i++
      continue
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char
      continue
    }

    if (char === "{") {
      depth++
    } else if (char === "}") {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

const findJsxTagEnd = (content, start) => {
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = start; i < content.length; i++) {
    const char = content[i]
    const next = content[i + 1]

    if (lineComment) {
      if (char === "\n") lineComment = false
      continue
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false
        i++
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "/" && next === "/") {
      lineComment = true
      i++
      continue
    }

    if (char === "/" && next === "*") {
      blockComment = true
      i++
      continue
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char
      continue
    }

    if (char === "{") {
      depth++
    } else if (char === "}") {
      if (depth === 0) return -1 // stray close before tag end: fail closed
      depth--
    } else if (char === ">" && depth === 0) {
      return i
    }
  }

  return -1
}

// Retains kebab-case literals selected through balanced JSX
// <Icon name={EXPRESSION}> props, e.g. nested ternaries such as
// name={cond ? (x ? 'a' : 'b') : 'sort-desc'}. Only the balanced expression
// body of the name prop contributes; malformed/unbalanced tags or
// expressions fail closed and arbitrary source strings are never scanned.
const addIconNameExpressionProps = (content) => {
  const iconTagRegex = /<Icon\b/g
  let tagMatch
  while ((tagMatch = iconTagRegex.exec(content)) !== null) {
    const tagEnd = findJsxTagEnd(content, tagMatch.index)
    if (tagEnd === -1) continue

    const tag = content.slice(tagMatch.index, tagEnd + 1)
    const nameAttrRegex = /\bname\s*=\s*{/g
    let nameMatch
    while ((nameMatch = nameAttrRegex.exec(tag)) !== null) {
      const openBraceIndex = tagMatch.index + nameMatch.index + nameMatch[0].lastIndexOf("{")
      const closeBraceIndex = findMatchingBrace(content, openBraceIndex)
      if (closeBraceIndex === -1 || closeBraceIndex > tagEnd) continue
      addIconLiterals(content.slice(openBraceIndex + 1, closeBraceIndex))
      nameAttrRegex.lastIndex = closeBraceIndex - tagMatch.index + 1
    }
  }
}

const addIconNameFunctionReturns = (content) => {
  const functionRegex = /function\s+\w+\s*\([^)]*\)\s*:\s*IconName(?:\s*\|\s*null)?\s*{/g
  let match
  while ((match = functionRegex.exec(content)) !== null) {
    const openBraceIndex = content.indexOf("{", match.index)
    if (openBraceIndex === -1) continue

    const closeBraceIndex = findMatchingBrace(content, openBraceIndex)
    if (closeBraceIndex === -1) continue

    const body = content.slice(openBraceIndex + 1, closeBraceIndex)
    const returnRegex = /\breturn\s+["']([a-z][a-z0-9-]*)["']/g
    let returnMatch
    while ((returnMatch = returnRegex.exec(body)) !== null) {
      addKebabIcon(returnMatch[1])
    }
    functionRegex.lastIndex = closeBraceIndex + 1
  }
}

const addTypedIconNameRecords = (content) => {
  const recordRegex = /:\s*Record<[^>]*IconName[^>]*>\s*=\s*{/g
  let match
  while ((match = recordRegex.exec(content)) !== null) {
    const openBraceIndex = content.indexOf("{", match.index)
    if (openBraceIndex === -1) continue

    const closeBraceIndex = findMatchingBrace(content, openBraceIndex)
    if (closeBraceIndex === -1) continue

    addIconLiterals(content.slice(openBraceIndex + 1, closeBraceIndex))
    recordRegex.lastIndex = closeBraceIndex + 1
  }
}

const addIconNameVariableAssignments = (content) => {
  if (!/<Icon\b/.test(content)) return

  const variableRegex = /\b(?:const|let|var)\s+\w*IconName\b[^=]*=\s*([\s\S]*?);/g
  let match
  while ((match = variableRegex.exec(content)) !== null) {
    const initializer = match[1]
    const directLiteral = /^\s*["']([a-z][a-z0-9-]*)["']/.exec(initializer)
    if (directLiteral) {
      addKebabIcon(directLiteral[1])
    }

    const branchLiteralRegex = /(?:\?\?|[?:])\s*["']([a-z][a-z0-9-]*)["']/g
    let branchLiteral
    while ((branchLiteral = branchLiteralRegex.exec(initializer)) !== null) {
      addKebabIcon(branchLiteral[1])
    }
  }
}

for (const file of allSrcFiles) {
  const content = readFileSync(file, "utf-8")
  // Match RiIcons from @remixicon/react imports
  const iconRegex = /Ri[A-Z][A-Za-z0-9]+/g
  let im
  while ((im = iconRegex.exec(content)) !== null) {
    if (nameToVar.has(im[0])) {
      usedIcons.add(im[0])
    }
  }

  // Also scan for <Icon name="..." /> patterns (already-migrated icons)
  const iconNameRegex = /<Icon\b[^>]*\bname=(?:["']([^"']+)["']|{\s*["']([^"']+)["']\s*})/g
  let nm
  while ((nm = iconNameRegex.exec(content)) !== null) {
    addKebabIcon(nm[1] || nm[2])
  }

  // Also retain literals from balanced <Icon name={...}> expression props
  // (nested ternaries and multiple branches) without scanning arbitrary
  // source strings; malformed/unbalanced expressions fail closed.
  addIconNameExpressionProps(content)

  // Also scan for icon: 'kebab-name' / Icon: 'kebab-name' in object literals.
  const iconPropRegex = /\b[Ii]con:\s*["']([a-z][a-z0-9-]*)["']/g
  let ip
  while ((ip = iconPropRegex.exec(content)) !== null) {
    addKebabIcon(ip[1])
  }

  // Also scan JSX props named icon/Icon with a string literal value.
  const iconJsxPropRegex = /\b[Ii]con=(?:["']([^"']+)["']|{\s*["']([^"']+)["']\s*})/g
  let jp
  while ((jp = iconJsxPropRegex.exec(content)) !== null) {
    addKebabIcon(jp[1] || jp[2])
  }

  addIconNameFunctionReturns(content)
  addTypedIconNameRecords(content)
  addIconNameVariableAssignments(content)
}

console.log(`Found ${usedIcons.size} unique remixicon names used in source`)

// --- Step 4: build sprite data ---
const iconEntries = []
for (const iconName of [...usedIcons].sort()) {
  const spriteName = remixToSpriteName(iconName)
  if (customIconData.has(spriteName)) {
    continue
  }

  const varName = nameToVar.get(iconName)
  if (!varName) {
    console.warn(`  ⚠ Unknown icon: ${iconName}`)
    continue
  }
  const paths = varPathMap.get(varName)
  if (!paths || paths.length === 0) {
    console.warn(`  ⚠ No path data for: ${iconName} (var: ${varName})`)
    continue
  }

  // Build SVG content from paths
  const svgContent = paths
    .map((d) => `<path d="${d}" fill="currentColor"/>`)
    .join("")

  iconEntries.push({ name: iconName, content: svgContent })
}

for (const iconName of [...usedCustomIcons].sort()) {
  iconEntries.push({ name: iconName, content: customIconData.get(iconName) })
}

// --- Step 5: write sprite.ts ---
const spriteLines = iconEntries
  .map(({ name, content }) => ({
    name: name.startsWith("Ri") ? remixToSpriteName(name) : name,
    content,
  }))
  .sort((left, right) => left.name.localeCompare(right.name))
  .map(({ name, content }) => `  "${name}": \`${content}\`,`)

const spriteContent = `// This file is auto-generated by scripts/generate-icon-sprite.mjs
// Do not edit manually. Run the script to update.

export const iconSpriteData = {
${spriteLines.join("\n")}
} as const satisfies Record<string, string>;
`

writeFileSync(outPath, spriteContent, "utf-8")
console.log(`\n✅ Generated sprite data for ${iconEntries.length} icons → ${outPath}`)
console.log(`   Total sprite size: ${Buffer.byteLength(spriteContent).toLocaleString()} bytes`)
