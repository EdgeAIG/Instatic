import { describe, expect, it } from 'bun:test'
import {
  getMissingModuleDependencies,
  getProjectDependencyVersion,
  getProjectModuleDependencyUsage,
  normalizeModuleDependencies,
} from '../../core/module-engine/dependencies'
import type { PageNode } from '../../core/page-tree/types'
import type { AnyModuleDefinition, IModuleRegistry } from '../../core/module-engine/types'

function makeModule(dependencies: AnyModuleDefinition['dependencies']): AnyModuleDefinition {
  return {
    id: 'test.dependency-module',
    name: 'Dependency module',
    category: 'Test',
    version: '1.0.0',
    trusted: true,
    canHaveChildren: false,
    schema: {},
    defaults: {},
    dependencies,
    component: () => null,
    render: () => ({ html: '<div></div>' }),
  }
}

describe('module dependency metadata', () => {
  it('normalizes runtime and dev dependency specs', () => {
    expect(
      normalizeModuleDependencies({
        three: '^0.184.0',
        vite: { version: '^5.1.0', dev: true },
      }),
    ).toEqual([
      { name: 'three', version: '^0.184.0', dev: false },
      { name: 'vite', version: '^5.1.0', dev: true },
    ])
  })

  it('rejects unsafe package names before they reach the project manifest', () => {
    expect(() =>
      normalizeModuleDependencies({
        'three; rm -rf /': '^0.184.0',
      }),
    ).toThrow('Invalid package name')
  })

  it('returns only dependencies missing from the project manifest', () => {
    const mod = makeModule({
      three: '^0.184.0',
      '@types/react': { version: '^18.2.0', dev: true },
    })

    expect(
      getMissingModuleDependencies(mod, {
        dependencies: { three: '^0.183.0' },
        devDependencies: {},
      }),
    ).toEqual([{ name: '@types/react', version: '^18.2.0', dev: true }])
  })

  it('requires module dependencies to be present in the correct manifest bucket', () => {
    const dependency = { name: 'three', version: '^0.184.0', dev: false }
    const packageJson = {
      dependencies: {},
      devDependencies: { three: '^0.184.0' },
    }

    expect(getProjectDependencyVersion(packageJson, dependency)).toBeNull()
    expect(getMissingModuleDependencies(makeModule({ three: '^0.184.0' }), packageJson)).toEqual([
      dependency,
    ])
  })

  it('collects dependency usage from placed project modules', () => {
    const mod = makeModule({ three: '^0.184.0' })
    const fakeRegistry = {
      get: (id: string) => (id === mod.id ? mod : undefined),
    } as IModuleRegistry

    const usage = getProjectModuleDependencyUsage(
      {
        pages: [
          {
            nodes: {
              a: { moduleId: mod.id } as PageNode,
              b: { moduleId: mod.id } as PageNode,
            },
          },
        ],
        visualComponents: [],
      },
      fakeRegistry,
    )

    expect(usage.get('three')).toMatchObject({
      name: 'three',
      version: '^0.184.0',
      dev: false,
      modules: ['Dependency module'],
      moduleIds: [mod.id],
      placements: 2,
    })
  })

})
