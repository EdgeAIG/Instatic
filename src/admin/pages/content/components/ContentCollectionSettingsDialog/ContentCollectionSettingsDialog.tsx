import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import { buildPostTypeDefaultFields, dataTableHasField } from '@core/data/fields'
import {
  POST_TYPE_FIELD_BODY,
  POST_TYPE_FIELD_FEATURED_MEDIA,
  POST_TYPE_FIELD_SEO_TITLE,
  POST_TYPE_FIELD_SEO_DESCRIPTION,
  type DataTable,
  type UpdateDataTableInput,
} from '@core/data/schemas'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import dialogStyles from '../../../../shared/dialogs/SiteCreateDialog/SiteCreateDialog.module.css'
import styles from '../../ContentPage.module.css'
import { slugFromTitle } from '@core/utils/slug'

interface ContentCollectionSettingsDialogProps {
  collection: DataTable
  onCancel: () => void
  onSave: (input: UpdateDataTableInput) => void | Promise<void>
}

function normalizeRouteBase(value: string): string {
  const slug = slugFromTitle(value)
  return `/${slug}`
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message.replace(/^\[[^\]]+\]\s*/, '') : 'Could not update collection'
}

const FORM_ID = 'content-collection-settings-form'

export const ContentCollectionSettingsDialog = memo(function ContentCollectionSettingsDialog({
  collection,
  onCancel,
  onSave,
}: ContentCollectionSettingsDialogProps) {
  const [name, setName] = useState(collection.name)
  const [slug, setSlug] = useState(collection.slug)
  const [routeBase, setRouteBase] = useState(collection.routeBase)
  const [singularLabel, setSingularLabel] = useState(collection.singularLabel)
  const [pluralLabel, setPluralLabel] = useState(collection.pluralLabel)
  const [bodyField, setBodyField] = useState(dataTableHasField(collection, POST_TYPE_FIELD_BODY))
  const [featuredMediaField, setFeaturedMediaField] = useState(dataTableHasField(collection, POST_TYPE_FIELD_FEATURED_MEDIA))
  const [seoField, setSeoField] = useState(dataTableHasField(collection, POST_TYPE_FIELD_SEO_TITLE))
  const [submitError, setSubmitError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmedName = name.trim()
  const trimmedSingular = singularLabel.trim()
  const trimmedPlural = pluralLabel.trim()
  const normalizedSlug = slugFromTitle(slug || trimmedName)
  const normalizedRouteBase = normalizeRouteBase(routeBase || normalizedSlug)
  const canSave = Boolean(trimmedName && trimmedSingular && trimmedPlural)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return

    try {
      // Preserve custom (non-built-in) fields from the collection so they
      // are not silently dropped when saving built-in field toggles.
      const customFields = collection.fields.filter((f) => !f.builtIn)
      const nextFields = buildPostTypeDefaultFields().filter((field) => {
        if (field.id === POST_TYPE_FIELD_BODY) return bodyField
        if (field.id === POST_TYPE_FIELD_FEATURED_MEDIA) return featuredMediaField
        if (field.id === POST_TYPE_FIELD_SEO_TITLE || field.id === POST_TYPE_FIELD_SEO_DESCRIPTION) return seoField
        return true
      })
      await onSave({
        name: trimmedName,
        slug: normalizedSlug,
        routeBase: normalizedRouteBase,
        singularLabel: trimmedSingular,
        pluralLabel: trimmedPlural,
        fields: [...nextFields, ...customFields],
      })
    } catch (err) {
      setSubmitError(errorMessage(err))
    }
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Collection settings"
      size="sm"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form={FORM_ID}
            disabled={!canSave}
          >
            Save
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className={dialogStyles.form} onSubmit={handleSubmit}>
        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Name</span>
          <Input
            ref={inputRef}
            fieldSize="sm"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSubmitError(null)
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Slug</span>
          <Input
            fieldSize="sm"
            value={slug}
            onChange={(event) => {
              setSlug(slugFromTitle(event.target.value))
              setSubmitError(null)
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>URL path</span>
          <Input
            fieldSize="sm"
            value={routeBase}
            onChange={(event) => {
              setRouteBase(event.target.value)
              setSubmitError(null)
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Singular label</span>
          <Input
            fieldSize="sm"
            value={singularLabel}
            onChange={(event) => {
              setSingularLabel(event.target.value)
              setSubmitError(null)
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Plural label</span>
          <Input
            fieldSize="sm"
            value={pluralLabel}
            onChange={(event) => {
              setPluralLabel(event.target.value)
              setSubmitError(null)
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <fieldset className={styles.collectionFields}>
          <legend>Fields</legend>
          <label>
            <Checkbox
              checked={bodyField}
              onCheckedChange={setBodyField}
            />
            <span>Body</span>
          </label>
          <label>
            <Checkbox
              checked={featuredMediaField}
              onCheckedChange={setFeaturedMediaField}
            />
            <span>Featured media</span>
          </label>
          <label>
            <Checkbox
              checked={seoField}
              onCheckedChange={setSeoField}
            />
            <span>SEO fields</span>
          </label>
        </fieldset>

        {submitError && (
          <p role="alert" className={dialogStyles.errorText}>
            {submitError}
          </p>
        )}
      </form>
    </Dialog>
  )
})
