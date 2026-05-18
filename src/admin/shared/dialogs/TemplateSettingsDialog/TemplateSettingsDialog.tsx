import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Page, PageTemplateConfig } from '@core/page-tree'
import {
  normalizePageSlug,
  pageSlugDuplicateError,
  pageSlugError,
} from '@core/page-tree/slugs'
import { listCmsDataTables } from '@core/persistence/cmsData'
import type { DataTable } from '@core/data/schemas'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import dialogStyles from '../SiteCreateDialog/SiteCreateDialog.module.css'

export interface TemplateSettingsPayload {
  title: string
  slug: string
  template: PageTemplateConfig
}

interface TemplateSettingsDialogProps {
  page: Page
  pages: Page[]
  onCancel: () => void
  onSave: (payload: TemplateSettingsPayload) => void
}

const FALLBACK_COLLECTIONS: DataTable[] = [{
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  kind: 'postType',
  routeBase: '/posts',
  singularLabel: 'Post',
  pluralLabel: 'Posts',
  primaryFieldId: 'title',
  fields: [],
  createdByUserId: null,
  updatedByUserId: null,
  createdAt: '',
  updatedAt: '',
}]

const FORM_ID = 'template-settings-form'

export const TemplateSettingsDialog = memo(function TemplateSettingsDialog({
  page,
  pages,
  onCancel,
  onSave,
}: TemplateSettingsDialogProps) {
  const [title, setTitle] = useState(page.title)
  const [slug, setSlug] = useState(page.slug)
  const [tableSlug, setTableSlug] = useState(page.template?.tableSlug ?? 'posts')
  const [priority, setPriority] = useState(String(page.template?.priority ?? 100))
  const [collections, setCollections] = useState<DataTable[]>(FALLBACK_COLLECTIONS)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmedTitle = title.trim()
  const normalizedSlug = normalizePageSlug(slug)
  const priorityNumber = Number(priority)
  const slugValidation = pageSlugError(normalizedSlug) || pageSlugDuplicateError(normalizedSlug, pages, page.id)
  const priorityInvalid = !Number.isFinite(priorityNumber)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  useEffect(() => {
    let cancelled = false
    listCmsDataTables()
      .then((allTables) => {
        const nextCollections = allTables.filter((t) => t.kind === 'postType')
        if (!cancelled && nextCollections.length > 0) setCollections(nextCollections)
      })
      .catch(() => {
        if (!cancelled) setCollections(FALLBACK_COLLECTIONS)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmedTitle || slugValidation || priorityInvalid) return

    onSave({
      title: trimmedTitle,
      slug: normalizedSlug,
      template: {
        enabled: true,
        context: 'entry',
        tableSlug,
        priority: priorityNumber,
        conditions: page.template?.conditions ?? [],
      },
    })
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Template settings"
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
            disabled={!trimmedTitle || Boolean(slugValidation) || priorityInvalid}
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
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Slug</span>
          <Input
            fieldSize="sm"
            value={slug}
            onChange={(event) => setSlug(normalizePageSlug(event.target.value))}
            autoComplete="off"
            spellCheck={false}
            invalid={Boolean(slugValidation)}
          />
          {slugValidation && (
            <p role="alert" className={dialogStyles.errorText}>{slugValidation}</p>
          )}
        </label>

        <div className={dialogStyles.field}>
          <span className={dialogStyles.label}>Table</span>
          <Select
            aria-label="Table"
            fieldSize="sm"
            value={tableSlug}
            onChange={(event) => setTableSlug(event.target.value)}
            options={collections.map((collection) => ({
              value: collection.slug,
              label: collection.pluralLabel || collection.name,
            }))}
          />
        </div>

        <div className={dialogStyles.field}>
          <span className={dialogStyles.label}>Priority</span>
          <Input
            aria-label="Priority"
            fieldSize="sm"
            type="number"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            invalid={priorityInvalid}
          />
        </div>
      </form>
    </Dialog>
  )
})
