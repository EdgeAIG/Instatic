/**
 * Curated UI surface exposed to plugin admin apps.
 *
 * Each export is a thin adapter around a host design-system primitive
 * (`Button`, `Input`, `Switch`, `Select`, `Stack`, `Card`, …). Plugins
 * receive this surface by importing named exports from
 * `@instatic/host-ui` (resolved at runtime by the editor's import map).
 *
 * Two reasons for the wrapper layer:
 *   1. The plugin SDK contract (`PluginUi*Props`) stays stable even as the
 *      host primitives evolve. A plugin written today against `ui.Button`
 *      keeps working when we refactor `Button.tsx` internally.
 *   2. We expose only the props that make sense for plugin admin UI; the
 *      host's complex internal options (`pressed`, `tone`, `numeric`, etc.)
 *      stay private.
 *
 * **There are no styles, CSS modules, or local layout helpers in this
 * folder.** Every visual primitive — including the label/description form
 * shell — lives in `src/ui/components/` as a real shared component. If a
 * plugin needs something the host doesn't already ship, plugin authors
 * compose host primitives or supply their own.
 */
import { type FormEvent, useId } from 'react'
import { Alert } from '@ui/components/Alert'
import { Button } from '@ui/components/Button'
import { Card } from '@ui/components/Card'
import { Checkbox } from '@ui/components/Checkbox'
import { Code } from '@ui/components/Code'
import { EmptyState } from '@ui/components/EmptyState'
import { FormField } from '@ui/components/FormField'
import { Heading } from '@ui/components/Heading'
import { Input, Textarea } from '@ui/components/Input'
import { SearchBar } from '@ui/components/SearchBar'
import { Select } from '@ui/components/Select'
import { Separator } from '@ui/components/Separator'
import { Stack } from '@ui/components/Stack'
import { Switch } from '@ui/components/Switch'
import { Text } from '@ui/components/Text'
import type {
  PluginUiAlertProps,
  PluginUiButtonProps,
  PluginUiCardProps,
  PluginUiCheckboxProps,
  PluginUiCodeProps,
  PluginUiEmptyStateProps,
  PluginUiHeadingProps,
  PluginUiInputProps,
  PluginUiSearchBarProps,
  PluginUiSelectProps,
  PluginUiSeparatorProps,
  PluginUiStackProps,
  PluginUiSwitchProps,
  PluginUiTextProps,
  PluginUiTextareaProps,
} from '@core/plugin-sdk'

// ---------------------------------------------------------------------------
// Action primitives
// ---------------------------------------------------------------------------

export function PluginButton(props: PluginUiButtonProps) {
  return (
    <Button
      variant={props.variant}
      size={props.size ?? 'sm'}
      disabled={props.disabled}
      fullWidth={props.fullWidth}
      type={props.type ?? 'button'}
      onClick={props.onClick}
      aria-label={props.ariaLabel}
    >
      {props.children}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function PluginInput(props: PluginUiInputProps) {
  const inputId = useId()
  return (
    <FormField label={props.label} description={props.description} htmlFor={inputId}>
      <Input
        id={inputId}
        type={props.type ?? 'text'}
        value={props.value}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        invalid={props.invalid}
        disabled={props.disabled}
        required={props.required}
        prefix={props.prefix}
        unit={props.unit}
        onChange={(event: FormEvent<HTMLInputElement>) => {
          props.onChange?.((event.currentTarget as HTMLInputElement).value)
        }}
        onBlur={props.onBlur}
      />
    </FormField>
  )
}

export function PluginTextarea(props: PluginUiTextareaProps) {
  const textareaId = useId()
  return (
    <FormField label={props.label} description={props.description} htmlFor={textareaId}>
      <Textarea
        id={textareaId}
        value={props.value}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        disabled={props.disabled}
        required={props.required}
        invalid={props.invalid}
        onChange={(event) => props.onChange?.(event.currentTarget.value)}
      />
    </FormField>
  )
}

export function PluginSelect<T extends string>(props: PluginUiSelectProps<T>) {
  const selectId = useId()
  return (
    <FormField label={props.label} description={props.description} htmlFor={selectId}>
      <Select
        id={selectId}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange?.((event.target as HTMLSelectElement).value as T)
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </Select>
    </FormField>
  )
}

export function PluginSwitch(props: PluginUiSwitchProps) {
  return (
    <FormField
      label={props.label}
      description={props.description}
      layout="inline-end"
    >
      <Switch
        checked={Boolean(props.checked)}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
    </FormField>
  )
}

export function PluginCheckbox(props: PluginUiCheckboxProps) {
  return (
    <FormField
      label={props.label}
      description={props.description}
      layout="inline-start"
    >
      <Checkbox
        checked={Boolean(props.checked)}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
    </FormField>
  )
}

export function PluginSearchBar(props: PluginUiSearchBarProps) {
  return (
    <SearchBar
      placeholder={props.placeholder}
      value={props.value ?? ''}
      onValueChange={props.onChange ?? (() => {})}
    />
  )
}

// ---------------------------------------------------------------------------
// Layout / typography / surface primitives — pure adapters over @ui/components.
// ---------------------------------------------------------------------------

export function PluginStack(props: PluginUiStackProps) {
  return (
    <Stack
      direction={props.direction}
      gap={props.gap}
      align={props.align}
      justify={props.justify}
      wrap={props.wrap}
      height={props.height}
    >
      {props.children}
    </Stack>
  )
}

export function PluginCard(props: PluginUiCardProps) {
  return (
    <Card padding={props.padding} bordered={props.bordered}>
      {props.children}
    </Card>
  )
}

export function PluginHeading(props: PluginUiHeadingProps) {
  return <Heading level={props.level}>{props.children}</Heading>
}

export function PluginText(props: PluginUiTextProps) {
  return (
    <Text variant={props.variant} size={props.size}>
      {props.children}
    </Text>
  )
}

export function PluginSeparator(props: PluginUiSeparatorProps) {
  return <Separator orientation={props.orientation ?? 'horizontal'} />
}

export function PluginEmptyState(props: PluginUiEmptyStateProps) {
  return (
    <EmptyState
      title={props.title}
      description={props.body}
      action={props.action}
    />
  )
}

export function PluginAlert(props: PluginUiAlertProps) {
  return (
    <Alert tone={props.tone} title={props.title}>
      {props.children}
    </Alert>
  )
}

export function PluginCode(props: PluginUiCodeProps) {
  return <Code>{props.children}</Code>
}
