/**
 * `@pagebuilder/host-ui` — the named-export host UI surface plugins import.
 *
 *   import { Button, Stack, Card, Text } from '@pagebuilder/host-ui'
 *
 *   export default function MyPanel() {
 *     return <Stack gap={12}><Button variant="primary">Hi</Button></Stack>
 *   }
 *
 * Plugins compile against these named exports as a stable contract. The
 * runtime resolution at editor mount time is handled by the host's import
 * map (see `public/runtime/host-ui.js`) — the plugin's bundle treats this
 * package as an external. That means:
 *
 *   • Plugin bundles never ship the host's design system code.
 *   • The host can refactor its primitives freely; this file's named
 *     exports are the contract.
 *   • One copy of every component runs in the editor: identical theming,
 *     identical accessibility wiring, identical event semantics.
 *
 * The components are the wrappers from `PluginAdminUiComponents.tsx` —
 * already battle-tested by the existing plugin admin pages. Re-exporting
 * them here under stable names is the migration path from the curated
 * `ui` namespace to a proper React component package.
 */
export {
  PluginAlert as Alert,
  PluginButton as Button,
  PluginCard as Card,
  PluginCheckbox as Checkbox,
  PluginCode as Code,
  PluginEmptyState as EmptyState,
  PluginHeading as Heading,
  PluginInput as Input,
  PluginSearchBar as SearchBar,
  PluginSelect as Select,
  PluginSeparator as Separator,
  PluginStack as Stack,
  PluginSwitch as Switch,
  PluginText as Text,
  PluginTextarea as Textarea,
} from '@plugins/components/PluginAdminUi/PluginAdminUiComponents'

/**
 * Chart primitives — Sparkline, Bars, StackedBar, StatValue, Delta.
 *
 * Re-exported here so plugins building dashboard widgets can render the
 * same chart shapes as first-party widgets without bundling their own
 * chart code. Stay achromatic by default; tint colors come from the
 * widget chrome via the standard `--rail-tint-*` tokens.
 */
export {
  Sparkline,
  Bars,
  StackedBar,
  StatValue,
  Delta,
} from '@ui/components/charts'

export type {
  PluginUiAlertProps as AlertProps,
  PluginUiButtonProps as ButtonProps,
  PluginUiCardProps as CardProps,
  PluginUiCheckboxProps as CheckboxProps,
  PluginUiCodeProps as CodeProps,
  PluginUiEmptyStateProps as EmptyStateProps,
  PluginUiHeadingProps as HeadingProps,
  PluginUiInputProps as InputProps,
  PluginUiSearchBarProps as SearchBarProps,
  PluginUiSelectProps as SelectProps,
  PluginUiSeparatorProps as SeparatorProps,
  PluginUiStackProps as StackProps,
  PluginUiSwitchProps as SwitchProps,
  PluginUiTextProps as TextProps,
  PluginUiTextareaProps as TextareaProps,
} from '@core/plugin-sdk'

export type {
  SparklineProps,
  BarsProps,
  StackedBarProps,
  StackedBarSegment,
  StatValueProps,
  DeltaProps,
} from '@ui/components/charts'
