import { describe, expect, it } from 'bun:test'
import { createSandboxSrcDoc } from '../../editor/components/Canvas/moduleSandboxSrcDoc'

describe('ModuleSandboxFrame srcDoc', () => {
  it('builds an isolated iframe document with import map, encoded module source, and host bridge', () => {
    const srcDoc = createSandboxSrcDoc({
      title: 'Runtime preview',
      source: `import * as THREE from 'three'\nexport function mount() {}`,
      importMap: {
        imports: {
          three: 'https://esm.sh/three@0.184.0?bundle',
          'three/': 'https://esm.sh/three@0.184.0/',
        },
      },
      context: {
        props: { sceneLabel: 'Scene' },
        nodeId: 'node-1',
        isSelected: false,
        className: 'class-1',
        dependencies: { three: 'https://esm.sh/three@0.184.0?bundle' },
        apiVersion: 1,
      },
      classCSS: '.class-1 {\\n  height: 360px;\\n}',
    })

    expect(srcDoc).toContain('<script type="importmap">')
    expect(srcDoc).toContain('"three":"https://esm.sh/three@0.184.0?bundle"')
    expect(srcDoc).toContain('data:text/javascript;base64,')
    expect(srcDoc).not.toContain(`import * as THREE from 'three'`)
    expect(srcDoc).toContain('page-builder-module-sandbox')
    expect(srcDoc).toContain('page-builder-module-host')
    expect(srcDoc).toContain("message.type !== 'update'")
    expect(srcDoc).toContain('.class-1')
  })
})
