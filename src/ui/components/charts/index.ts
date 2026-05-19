/**
 * Chart primitives used by dashboard widgets — and re-exported through
 * the plugin SDK so plugins can render the same chart shapes inside
 * their own registered widgets.
 *
 * Stay achromatic by default; callers (or design tokens) supply the
 * accent colour via `tint` props.
 */
export { Sparkline } from './Sparkline'
export type { SparklineProps } from './Sparkline'
export { Bars } from './Bars'
export type { BarsProps } from './Bars'
export { StackedBar } from './StackedBar'
export type { StackedBarProps, StackedBarSegment } from './StackedBar'
export { StatValue, Delta } from './StatValue'
export type { StatValueProps, DeltaProps } from './StatValue'
