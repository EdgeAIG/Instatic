import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const INDEX_HTML_PATH = join(import.meta.dir, '../../../index.html')

describe('initial HTML loading shell', () => {
  it('renders the loading spinner before the React bundle executes', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf8')
    const styleIndex = html.indexOf('<style data-initial-loader>')
    const rootIndex = html.indexOf('<div id="root">')
    const scriptIndex = html.indexOf('<script type="module" src="/src/app/main.tsx">')

    expect(styleIndex).toBeGreaterThan(-1)
    expect(rootIndex).toBeGreaterThan(-1)
    expect(scriptIndex).toBeGreaterThan(rootIndex)
    expect(styleIndex).toBeLessThan(rootIndex)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading Page Builder"')
    expect(html).toContain('data-initial-loader-spinner="true"')
    expect(html).not.toContain('<div id="root"></div>')
  })
})
