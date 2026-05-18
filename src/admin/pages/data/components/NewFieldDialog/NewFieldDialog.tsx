import { memo, useState, type FormEvent } from 'react'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { Input, Textarea } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { Switch } from '@ui/components/Switch'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import { DataFieldSchema, type DataField, type DataFieldType, type DataSelectOption, type DataTable } from '@core/data/schemas'
import { buildPostTypeDefaultFields } from '@core/data/fields'
import { safeParseValue, formatValueErrors } from '@core/utils/typeboxHelpers'
import styles from './NewFieldDialog.module.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_TYPE_OPTIONS: ReadonlyArray<{ value: DataFieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'longText', label: 'Long text' },
  { value: 'richText', label: 'Rich text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'dateTime', label: 'Date & time' },
  { value: 'select', label: 'Select' },
  { value: 'multiSelect', label: 'Multi-select' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
  { value: 'media', label: 'Media' },
  { value: 'relation', label: 'Relation' },
]

const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]*$/

const RICH_TEXT_FORMAT_OPTIONS = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
]

const NUMBER_FORMAT_OPTIONS = [
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
]

const MEDIA_KIND_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
]

// ---------------------------------------------------------------------------
// Draft option type (pre-uuid assignment)
// ---------------------------------------------------------------------------

interface DraftOption {
  id: string
  label: string
  value: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugifyOptionValue(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function makeOption(label: string): DraftOption {
  return { id: crypto.randomUUID(), label, value: slugifyOptionValue(label) }
}

function fieldIdError(id: string, existingIds: string[]): string | null {
  if (!id) return null
  if (!FIELD_ID_PATTERN.test(id)) return 'Must start with a lowercase letter; use letters, numbers, underscores only.'
  if (existingIds.includes(id)) return 'This ID is already in use.'
  return null
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NewFieldDialogProps {
  open: boolean
  onClose: () => void
  existingFieldIds: string[]
  tables: DataTable[]
  /**
   * Optional built-in field IDs that are missing from a postType table.
   * When provided, a "Re-add built-in fields" section appears at the top
   * of the dialog with quick-add buttons — clicking one inserts the
   * canonical built-in field shape without needing to fill the form.
   */
  missingOptionalBuiltInIds?: readonly string[]
  onCreate: (field: DataField) => Promise<void>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const NewFieldDialog = memo(function NewFieldDialog({
  open,
  onClose,
  existingFieldIds,
  tables,
  missingOptionalBuiltInIds,
  onCreate,
}: NewFieldDialogProps) {
  // Common fields
  const [type, setType] = useState<DataFieldType>('text')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(false)
  const [description, setDescription] = useState('')

  // text-specific
  const [textMaxLength, setTextMaxLength] = useState('')
  const [textPlaceholder, setTextPlaceholder] = useState('')

  // richText-specific
  const [richTextFormat, setRichTextFormat] = useState<'markdown' | 'html'>('markdown')

  // number-specific
  const [numberMin, setNumberMin] = useState('')
  const [numberMax, setNumberMax] = useState('')
  const [numberStep, setNumberStep] = useState('')
  const [numberInteger, setNumberInteger] = useState(false)
  const [numberFormat, setNumberFormat] = useState<'number' | 'currency' | 'percent'>('number')
  const [numberCurrency, setNumberCurrency] = useState('')

  // boolean-specific
  const [booleanDefault, setBooleanDefault] = useState(false)

  // select/multiSelect
  const [selectOptions, setSelectOptions] = useState<DraftOption[]>([makeOption('')])

  // media-specific
  const [mediaKind, setMediaKind] = useState<'image' | 'video' | 'any'>('any')
  const [mediaAllowMultiple, setMediaAllowMultiple] = useState(false)

  // relation-specific
  const [relationTargetTableId, setRelationTargetTableId] = useState('')
  const [relationAllowMultiple, setRelationAllowMultiple] = useState(false)

  // Submit state
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const trimmedId = id.trim()
  const trimmedLabel = label.trim()
  const idErr = idTouched ? fieldIdError(trimmedId, existingFieldIds) : null
  const needsSelectOption = (type === 'select' || type === 'multiSelect') && selectOptions.every((o) => !o.label.trim())

  const needsRelationTarget = type === 'relation' && !relationTargetTableId

  const canCreate = Boolean(
    trimmedId &&
    trimmedLabel &&
    !fieldIdError(trimmedId, existingFieldIds) &&
    !needsSelectOption &&
    !needsRelationTarget &&
    !saving,
  )

  function resetForm() {
    setType('text')
    setId('')
    setIdTouched(false)
    setLabel('')
    setRequired(false)
    setDescription('')
    setTextMaxLength('')
    setTextPlaceholder('')
    setRichTextFormat('markdown')
    setNumberMin('')
    setNumberMax('')
    setNumberStep('')
    setNumberInteger(false)
    setNumberFormat('number')
    setNumberCurrency('')
    setBooleanDefault(false)
    setSelectOptions([makeOption('')])
    setMediaKind('any')
    setMediaAllowMultiple(false)
    setRelationTargetTableId('')
    setRelationAllowMultiple(false)
    setSaving(false)
    setSubmitError(null)
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  function updateSelectOption(index: number, patch: Partial<DraftOption>) {
    setSelectOptions((prev) =>
      prev.map((opt, i) => {
        if (i !== index) return opt
        const next = { ...opt, ...patch }
        // Auto-derive value from label unless value was manually set
        if ('label' in patch && !('value' in patch)) {
          next.value = slugifyOptionValue(next.label)
        }
        return next
      }),
    )
  }

  function removeSelectOption(index: number) {
    setSelectOptions((prev) => prev.filter((_, i) => i !== index))
  }

  function addSelectOption() {
    setSelectOptions((prev) => [...prev, makeOption('')])
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canCreate) return

    // Build common props
    const common = {
      id: trimmedId,
      label: trimmedLabel,
      ...(required ? { required: true } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    }

    // Build type-specific field object
    let fieldShape: unknown

    switch (type) {
      case 'text': {
        fieldShape = {
          type: 'text',
          ...common,
          ...(textMaxLength ? { maxLength: Number(textMaxLength) } : {}),
          ...(textPlaceholder.trim() ? { placeholder: textPlaceholder.trim() } : {}),
        }
        break
      }
      case 'longText': {
        fieldShape = { type: 'longText', ...common }
        break
      }
      case 'richText': {
        fieldShape = { type: 'richText', ...common, format: richTextFormat }
        break
      }
      case 'number': {
        fieldShape = {
          type: 'number',
          ...common,
          ...(numberMin !== '' ? { min: Number(numberMin) } : {}),
          ...(numberMax !== '' ? { max: Number(numberMax) } : {}),
          ...(numberStep !== '' ? { step: Number(numberStep) } : {}),
          ...(numberInteger ? { integer: true } : {}),
          ...(numberFormat !== 'number' ? { format: numberFormat } : {}),
          ...(numberFormat === 'currency' && numberCurrency.trim() ? { currency: numberCurrency.trim() } : {}),
        }
        break
      }
      case 'boolean': {
        fieldShape = {
          type: 'boolean',
          ...common,
          ...(booleanDefault ? { defaultValue: true } : {}),
        }
        break
      }
      case 'date': {
        fieldShape = { type: 'date', ...common }
        break
      }
      case 'dateTime': {
        fieldShape = { type: 'dateTime', ...common }
        break
      }
      case 'select': {
        const options: DataSelectOption[] = selectOptions
          .filter((o) => o.label.trim())
          .map((o) => ({ id: o.id, label: o.label.trim(), value: o.value || slugifyOptionValue(o.label) }))
        fieldShape = { type: 'select', ...common, options }
        break
      }
      case 'multiSelect': {
        const options: DataSelectOption[] = selectOptions
          .filter((o) => o.label.trim())
          .map((o) => ({ id: o.id, label: o.label.trim(), value: o.value || slugifyOptionValue(o.label) }))
        fieldShape = { type: 'multiSelect', ...common, options }
        break
      }
      case 'url': {
        fieldShape = { type: 'url', ...common }
        break
      }
      case 'email': {
        fieldShape = { type: 'email', ...common }
        break
      }
      case 'media': {
        fieldShape = {
          type: 'media',
          ...common,
          ...(mediaKind !== 'any' ? { mediaKind } : {}),
          ...(mediaAllowMultiple ? { allowMultiple: true } : {}),
        }
        break
      }
      case 'relation': {
        fieldShape = {
          type: 'relation',
          ...common,
          targetTableId: relationTargetTableId,
          ...(relationAllowMultiple ? { allowMultiple: true } : {}),
        }
        break
      }
    }

    // Validate against DataFieldSchema
    const result = safeParseValue(DataFieldSchema, fieldShape)
    if (!result.ok) {
      setSubmitError(formatValueErrors(DataFieldSchema, fieldShape))
      return
    }

    setSaving(true)
    setSubmitError(null)
    try {
      await onCreate(result.value)
      resetForm()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message.replace(/^\[[^\]]+\]\s*/, '') : 'Could not create field')
      setSaving(false)
    }
  }

  const tableOptions = tables.map((t) => ({ value: t.id, label: t.name }))

  // Compute quick-add built-in shapes from the canonical default field set.
  const builtInDefaults = buildPostTypeDefaultFields()
  const quickAddFields = (missingOptionalBuiltInIds ?? [])
    .map((id) => builtInDefaults.find((f) => f.id === id))
    .filter((f): f is DataField => f !== undefined)

  async function handleQuickAddBuiltIn(field: DataField) {
    setSaving(true)
    setSubmitError(null)
    try {
      await onCreate(field)
      handleClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message.replace(/^\[[^\]]+\]\s*/, '') : 'Could not add field')
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="New field"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="new-field-dialog-form"
            disabled={!canCreate}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      {/* Quick-add section for missing optional built-ins (postType tables only) */}
      {quickAddFields.length > 0 && (
        <div className={styles.builtInSection}>
          <span className={styles.builtInHeading}>Re-add built-in fields</span>
          <div className={styles.builtInList}>
            {quickAddFields.map((field) => (
              <Button
                key={field.id}
                variant="secondary"
                size="sm"
                type="button"
                disabled={saving}
                onClick={() => void handleQuickAddBuiltIn(field)}
              >
                <PlusIcon size={11} aria-hidden="true" />
                {field.label}
              </Button>
            ))}
          </div>
          <div className={styles.builtInDivider} />
        </div>
      )}

      <form id="new-field-dialog-form" className={styles.form} onSubmit={handleSubmit}>
        {/* Type */}
        <div className={styles.field}>
          <span className={styles.label}>Type</span>
          <Select
            fieldSize="sm"
            value={type}
            options={[...FIELD_TYPE_OPTIONS]}
            onChange={(event) => {
              setType(event.target.value as DataFieldType)
              setSubmitError(null)
            }}
          />
        </div>

        {/* ID */}
        <label className={styles.field}>
          <span className={styles.label}>ID</span>
          <Input
            fieldSize="sm"
            value={id}
            invalid={Boolean(idErr)}
            onChange={(event) => {
              setIdTouched(true)
              setId(event.target.value)
              setSubmitError(null)
            }}
            onBlur={() => setIdTouched(true)}
            placeholder="product_name"
            autoComplete="off"
            spellCheck={false}
            monospace
          />
          {idErr && (
            <span className={styles.fieldError} role="alert">{idErr}</span>
          )}
          {!idErr && (
            <span className={styles.caption}>Machine name: lowercase letters, numbers, underscores.</span>
          )}
        </label>

        {/* Label */}
        <label className={styles.field}>
          <span className={styles.label}>Label</span>
          <Input
            fieldSize="sm"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value)
              setSubmitError(null)
            }}
            placeholder="Product name"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {/* Required */}
        <div className={styles.switchRow}>
          <span className={styles.switchLabel}>Required</span>
          <Switch checked={required} onCheckedChange={setRequired} />
        </div>

        {/* Description */}
        <label className={styles.field}>
          <span className={styles.label}>Description <span className={styles.optional}>(optional)</span></span>
          <Textarea
            fieldSize="sm"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Shown next to the field in the editor"
            rows={2}
          />
        </label>

        {/* ── Type-specific fields ── */}

        {type === 'text' && (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Max length <span className={styles.optional}>(optional)</span></span>
              <Input
                fieldSize="sm"
                type="number"
                value={textMaxLength}
                onChange={(event) => setTextMaxLength(event.target.value)}
                placeholder="255"
                min={1}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Placeholder <span className={styles.optional}>(optional)</span></span>
              <Input
                fieldSize="sm"
                value={textPlaceholder}
                onChange={(event) => setTextPlaceholder(event.target.value)}
                placeholder="Enter a value…"
              />
            </label>
          </>
        )}

        {type === 'richText' && (
          <div className={styles.field}>
            <span className={styles.label}>Format</span>
            <Select
              fieldSize="sm"
              value={richTextFormat}
              options={RICH_TEXT_FORMAT_OPTIONS}
              onChange={(event) => setRichTextFormat(event.target.value as 'markdown' | 'html')}
            />
          </div>
        )}

        {type === 'number' && (
          <>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span className={styles.label}>Min <span className={styles.optional}>(optional)</span></span>
                <Input fieldSize="sm" type="number" value={numberMin} onChange={(event) => setNumberMin(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Max <span className={styles.optional}>(optional)</span></span>
                <Input fieldSize="sm" type="number" value={numberMax} onChange={(event) => setNumberMax(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Step <span className={styles.optional}>(optional)</span></span>
                <Input fieldSize="sm" type="number" value={numberStep} onChange={(event) => setNumberStep(event.target.value)} />
              </label>
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchLabel}>Integer only</span>
              <Switch checked={numberInteger} onCheckedChange={setNumberInteger} />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Format</span>
              <Select
                fieldSize="sm"
                value={numberFormat}
                options={NUMBER_FORMAT_OPTIONS}
                onChange={(event) => setNumberFormat(event.target.value as 'number' | 'currency' | 'percent')}
              />
            </div>
            {numberFormat === 'currency' && (
              <label className={styles.field}>
                <span className={styles.label}>Currency code <span className={styles.optional}>(e.g. USD)</span></span>
                <Input
                  fieldSize="sm"
                  value={numberCurrency}
                  onChange={(event) => setNumberCurrency(event.target.value)}
                  placeholder="USD"
                  maxLength={10}
                />
              </label>
            )}
          </>
        )}

        {type === 'boolean' && (
          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>Default value</span>
            <Switch checked={booleanDefault} onCheckedChange={setBooleanDefault} />
          </div>
        )}

        {(type === 'select' || type === 'multiSelect') && (
          <div className={styles.field}>
            <span className={styles.label}>Options</span>
            <div className={styles.optionList}>
              {selectOptions.map((opt, index) => (
                <div key={opt.id} className={styles.optionRow}>
                  <Input
                    fieldSize="sm"
                    value={opt.label}
                    onChange={(event) => updateSelectOption(index, { label: event.target.value })}
                    placeholder="Label"
                    autoComplete="off"
                  />
                  <Input
                    fieldSize="sm"
                    value={opt.value}
                    onChange={(event) => updateSelectOption(index, { value: event.target.value })}
                    placeholder="value"
                    autoComplete="off"
                    monospace
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    iconOnly
                    type="button"
                    aria-label="Remove option"
                    onClick={() => removeSelectOption(index)}
                    disabled={selectOptions.length <= 1}
                  >
                    <TrashSolidIcon size={12} aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            {needsSelectOption && (
              <span className={styles.fieldError} role="alert">At least one option is required.</span>
            )}
            <Button
              variant="ghost"
              size="xs"
              type="button"
              align="start"
              onClick={addSelectOption}
            >
              <PlusIcon size={11} aria-hidden="true" />
              Add option
            </Button>
          </div>
        )}

        {type === 'media' && (
          <>
            <div className={styles.field}>
              <span className={styles.label}>Media kind</span>
              <Select
                fieldSize="sm"
                value={mediaKind}
                options={MEDIA_KIND_OPTIONS}
                onChange={(event) => setMediaKind(event.target.value as 'image' | 'video' | 'any')}
              />
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchLabel}>Allow multiple</span>
              <Switch checked={mediaAllowMultiple} onCheckedChange={setMediaAllowMultiple} />
            </div>
          </>
        )}

        {type === 'relation' && (
          <>
            <div className={styles.field}>
              <span className={styles.label}>Target table</span>
              {tableOptions.length > 0 ? (
                <Select
                  fieldSize="sm"
                  value={relationTargetTableId}
                  options={tableOptions}
                  placeholder="Select a table…"
                  onChange={(event) => {
                    setRelationTargetTableId(event.target.value)
                    setSubmitError(null)
                  }}
                />
              ) : (
                <span className={styles.caption}>No other tables available yet.</span>
              )}
              {needsRelationTarget && tableOptions.length > 0 && (
                <span className={styles.fieldError} role="alert">A target table is required.</span>
              )}
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchLabel}>Allow multiple</span>
              <Switch checked={relationAllowMultiple} onCheckedChange={setRelationAllowMultiple} />
            </div>
          </>
        )}

        {submitError && (
          <p role="alert" className={styles.errorText}>
            {submitError}
          </p>
        )}
      </form>
    </Dialog>
  )
})
