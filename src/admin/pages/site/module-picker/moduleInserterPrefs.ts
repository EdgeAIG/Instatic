import { Type, type Static } from '@sinclair/typebox'
import { parseJsonWithFallback } from '@core/utils/jsonValidate'
import {
  recentKey,
  type ModuleInserterItemKind,
  type ModuleInserterItemRef,
} from './moduleInserterModel'

export const MODULE_INSERTER_STORAGE_KEY = 'instatic-module-inserter-v1'

const MAX_RECENT_INSERTIONS = 8

const InserterViewSchema = Type.Union([
  Type.Literal('grid'),
  Type.Literal('list'),
])

const RecentKindSchema = Type.Union([
  Type.Literal('module'),
  Type.Literal('layout'),
  Type.Literal('component'),
  Type.Literal('community'),
])

const RecentRefSchema = Type.Object({
  kind: RecentKindSchema,
  id: Type.String(),
})

const ModuleInserterPrefsSchema = Type.Object({
  view: InserterViewSchema,
  recent: Type.Array(RecentRefSchema, { maxItems: 32 }),
  installedCommunity: Type.Array(Type.String(), { maxItems: 256 }),
})

type ModuleInserterView = Static<typeof InserterViewSchema>
export type ModuleInserterPrefs = Static<typeof ModuleInserterPrefsSchema>
export type ModuleInserterRecentRef = ModuleInserterItemRef

const DEFAULT_PREFS: ModuleInserterPrefs = {
  view: 'grid',
  recent: [],
  installedCommunity: [],
}

export function readModuleInserterPrefs(): ModuleInserterPrefs {
  try {
    return parseJsonWithFallback(
      localStorage.getItem(MODULE_INSERTER_STORAGE_KEY),
      ModuleInserterPrefsSchema,
      DEFAULT_PREFS,
    )
  } catch {
    return DEFAULT_PREFS
  }
}

export function writeModuleInserterView(view: ModuleInserterView): void {
  writeModuleInserterPrefs({ ...readModuleInserterPrefs(), view })
}

export function trackModuleInserterRecent(ref: ModuleInserterRecentRef): void {
  const prefs = readModuleInserterPrefs()
  const key = recentKey(ref)
  const recent = [
    ref,
    ...prefs.recent.filter((existing) => recentKey(existing) !== key),
  ].slice(0, MAX_RECENT_INSERTIONS)

  writeModuleInserterPrefs({ ...prefs, recent })
}

export function writeModuleInserterCommunityInstalled(
  id: string,
  installed: boolean,
): void {
  const prefs = readModuleInserterPrefs()
  const existing = new Set(prefs.installedCommunity)
  if (installed) existing.add(id)
  else existing.delete(id)
  writeModuleInserterPrefs({
    ...prefs,
    installedCommunity: Array.from(existing),
  })
}

function writeModuleInserterPrefs(prefs: ModuleInserterPrefs): void {
  try {
    localStorage.setItem(MODULE_INSERTER_STORAGE_KEY, JSON.stringify(prefs))
  } catch (err) {
    console.warn('[module-inserter] Failed to persist preferences:', err)
  }
}

export type { ModuleInserterItemKind }
