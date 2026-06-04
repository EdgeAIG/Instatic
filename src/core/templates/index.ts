/**
 * @core/templates — template resolution, composition, and validation.
 *
 * A template is a page-tree carrying a `target` (everywhere | postTypes) plus a
 * `priority`. The resolver collects every template matching a route, ordered
 * broadest → narrowest; the composer splices each inner tree into the outer
 * template's single `base.outlet`, producing one merged tree for `publishPage`.
 */

export {
  normalizeRouteBase,
  isTemplatePage,
  resolveTemplateChain,
  type RouteResolutionContext,
} from './templateMatching'
export { findOutletIds, assertSingleOutlet, TemplateOutletError } from './templateValidation'
export { composeTemplateChain, type TerminalContent } from './templateCompose'
