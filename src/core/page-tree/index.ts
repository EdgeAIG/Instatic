// ---------------------------------------------------------------------------
// Barrel — the canonical public API for the page-tree module.
//
// Everything outside `src/core/page-tree/` MUST import from `@core/page-tree`.
// Direct deep imports (`@core/page-tree/<file>`) are reserved for internal
// cross-references within the module itself — they exist so internal files
// don't go through the barrel and create import cycles. CLAUDE.md documents
// this pattern.
// ---------------------------------------------------------------------------

// Schemas — exported as both runtime constants (for `parseValue` / `Value.Check`)
// and types (via Static<typeof X>).
export { PageNodeSchema } from './pageNode'
export { PageSchema } from './page'
export { StyleRuleSchema, StyleRuleKindSchema, classKindSelector } from './styleRule'
export { ConditionSchema, ConditionDefSchema } from './condition'
export { SiteShellSchema } from './siteDocument'

// Types — derived from schemas. Schemas are the source of truth.
export type { Breakpoint } from './breakpoint'
export type { DynamicPropBinding } from './dynamicBinding'
export type { PageTemplateConfig } from './pageTemplate'
export type { PageNode } from './pageNode'
export type { Page } from './page'
export type { CSSPropertyBag } from './cssPropertyBag'
export type { StyleRule, StyleRuleKind } from './styleRule'
export type { Condition, ConditionDef } from './condition'
export type { SiteSettings } from './siteSettings'
export type { SiteShell, SiteDocument } from './siteDocument'

// Defaults
export { DEFAULT_BREAKPOINTS } from './breakpoint'
export { DEFAULT_SITE_SETTINGS } from './siteSettings'

// Condition helpers
export { conditionId, conditionLabel, sameCondition, makeConditionDef, parseConditions } from './condition'

// Tolerant parsers — boundary helpers for persisted data.
export { parsePage } from './page'
export { parseSiteDocument } from './siteDocument'

// Re-export visualComponent parser for the persistence layer.
// (Single canonical location: `@core/visualComponents/schemas`.)
export { parseVisualComponent } from '@core/visualComponents/schemas'

// Other re-exports unrelated to the schemas split
export type { FontEntry } from '@core/fonts/schemas'

export type { BaseNode } from './baseNode'

export type { NodeTree } from './treeSchema'

export type {
  FrameworkColorToken,
  FrameworkColorUtilityType,
  FrameworkPreferencesSettings,
  FrameworkScaleManualSize,
  FrameworkScaleMode,
  FrameworkSpacingClassGenerator,
  FrameworkSpacingGroup,
  FrameworkTypographyClassGenerator,
  FrameworkTypographyGroup,
} from '@core/framework/schemas'

export {
  createNode,
  insertNode,
  deleteNode,
  updateNodeProps,
  setBreakpointOverride,
  clearBreakpointOverride,
  renameNode,
  toggleNodeLocked,
  toggleNodeHidden,
  moveNode,
  moveNodes,
  duplicateNode,
  buildSubtreeNodeIdMap,
  pasteSubtree,
  wrapNode,
  wrapNodes,
  addPage,
  deletePage,
  renamePage,
  reorderPages,
  duplicatePage,
  applyTreeOperation,
} from './mutations'

export type { TreeOperation, ApplyTreeOperationResult } from './mutations'

export { cloneScopedClassesForNodeMap } from './scopedClassClone'

export { getParent } from './selectors'

export {
  selectPageById,
  selectPagesById,
  selectVisualComponentById,
  selectVisualComponentsById,
} from './siteSelectors'
