/**
 * Architecture gate: runtime UI code must use CSS modules, not Tailwind-style
 * utility class strings left over from the MVP implementation.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { extname, join, relative } from 'path'

const SRC_ROOT = join(import.meta.dir, '../../')
const SCAN_DIRS = [
  join(SRC_ROOT, 'app'),
  join(SRC_ROOT, 'editor'),
  join(SRC_ROOT, 'modules'),
  join(SRC_ROOT, 'ui'),
]

const UTILITY_CLASS_RE = /\b(?:sr-only|not-sr-only|container|static|fixed|absolute|relative|sticky|isolate|flex|inline-flex|grid|inline-grid|block|inline-block|hidden|contents|flow-root|h-screen|min-h-screen|w-screen|min-w-screen|inset-\d+|inset-\[[^\]]+\]|z-\d+|z-\[[^\]]+\]|items-[a-z-]+|justify-[a-z-]+|content-[a-z-]+|self-[a-z-]+|gap-\d+|p[trblxy]?-\d+|m[trblxy]?-\d+|w-\d+|h-\d+|min-w-\d+|min-h-\d+|max-w-\d+|max-h-\d+|rounded(?:-[a-z0-9]+)?|border(?:-[a-z0-9]+)?|bg-[a-z]+-\d{2,3}|text-[a-z]+-\d{2,3}|font-[a-z0-9]+|leading-[a-z0-9]+|tracking-[a-z0-9]+|shadow(?:-[a-z0-9]+)?|overflow-[a-z]+|animate-[a-z0-9-]+|backdrop-[a-z0-9-]+)\b/
const CLASS_ATTR_RE = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{`([^`]+)`\}|\{\s*["']([^"']+)["']\s*\})/g
const CLASS_EXPR_RE = /className\s*=\s*\{([\s\S]*?)\}/g
const RAW_CLASS_CONCAT_RE = /className\s*=\s*\{\s*["']([^"']+)["']\s*\+/g
const STRING_LITERAL_RE = /["']([^"']+)["']/g

function collectFiles(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const info = statSync(fullPath)

    if (info.isDirectory()) {
      results.push(...collectFiles(fullPath))
      continue
    }

    if (['.ts', '.tsx'].includes(extname(entry))) {
      results.push(fullPath)
    }
  }

  return results
}

function findLineNumber(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

function isComparisonString(expression: string, stringIndex: number): boolean {
  return /[=!]==?\s*$/.test(expression.slice(0, stringIndex))
}

describe('No Tailwind-style utility class strings in runtime UI code', () => {
  it('uses CSS modules instead of raw utility classes in className attributes', () => {
    const violations: string[] = []

    for (const dir of SCAN_DIRS) {
      for (const filePath of collectFiles(dir)) {
        const source = readFileSync(filePath, 'utf8')
        const relPath = `src/${relative(SRC_ROOT, filePath)}`

        for (const match of source.matchAll(CLASS_ATTR_RE)) {
          const classValue = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
          const utilityMatch = classValue.match(UTILITY_CLASS_RE)

          if (utilityMatch) {
            violations.push(`${relPath}:${findLineNumber(source, match.index ?? 0)} -> ${utilityMatch[0]}`)
          }
        }

        for (const match of source.matchAll(CLASS_EXPR_RE)) {
          const expression = match[1] ?? ''

          for (const stringMatch of expression.matchAll(STRING_LITERAL_RE)) {
            const classValue = stringMatch[1] ?? ''
            if (isComparisonString(expression, stringMatch.index ?? 0)) continue

            const utilityMatch = classValue.match(UTILITY_CLASS_RE)

            if (utilityMatch) {
              violations.push(`${relPath}:${findLineNumber(source, match.index ?? 0)} -> ${utilityMatch[0]}`)
            }
          }
        }

        for (const match of source.matchAll(RAW_CLASS_CONCAT_RE)) {
          const classValue = match[1] ?? ''
          const utilityMatch = classValue.match(UTILITY_CLASS_RE)

          if (utilityMatch) {
            violations.push(`${relPath}:${findLineNumber(source, match.index ?? 0)} -> ${utilityMatch[0]}`)
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        'Tailwind-style utility class strings found in runtime UI code.\n' +
          'Use CSS module classes instead.\n' +
          violations.map((violation) => `  ${violation}`).join('\n'),
      )
    }

    expect(violations).toHaveLength(0)
  })
})
