import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Page, PageTemplateConfig } from '@core/page-tree'
import {
  normalizePageSlug,
  pageSlugDuplicateError,
  pageSlugError,
} from '@core/page-tree/slugs'
import { listCmsContentCollections } from '@core/persistence/cmsContent'
import type { ContentCollection } from '../../../content/types'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { CloseIcon } from '@ui/icons/icons/close'
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

const FALLBACK_COLLECTIONS: ContentCollection[] = [{
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  routeBase: '/posts',
  singularLabel: 'Post',
  pluralLabel: 'Posts',
  createdAt: '',
  updatedAt: '',
}]

export const TemplateSettingsDialog = memo(function TemplateSettingsDialog({
  page,
  pages,
  onCancel,
  onSave,
}: TemplateSettingsDialogProps) {
  const [title, setTitle] = useState(page.title)
  const [slug, setSlug] = useState(page.slug)
  const [collectionId, setCollectionId] = useState(page.template?.collectionId ?? 'posts')
  const [priority, setPriority] = useState(String(page.template?.priority ?? 100))
  const [collections, setCollections] = useState<ContentCollection[]>(FALLBACK_COLLECTIONS)
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
    listCmsContentCollections()
      .then((nextCollections) => {
        if (!cancelled && nextCollections.length > 0) setCollections(nextCollections)
      })
      .catch(() => {
        if (!cancelled) setCollections(FALLBACK_COLLECTIONS)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmedTitle || slugValidation || priorityInvalid) return

    onSave({
      title: trimmedTitle,
      slug: normalizedSlug,
      template: {
        enabled: true,
        context: 'entry',
        collectionId,
        priority: priorityNumber,
        conditions: page.template?.conditions ?? [],
      },
    })
  }

  return createPortal(
    <div
      className={dialogStyles.backdrop}
      data-testid="template-settings-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-settings-dialog-title"
        className={dialogStyles.dialog}
        data-testid="template-settings-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={dialogStyles.header}>
          <h2 id="template-settings-dialog-title" className={dialogStyles.title}>
            Template settings
          </h2>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Close dialog"
            onClick={onCancel}
          >
            <CloseIcon size={12} color="currentColor" aria-hidden="true" />
          </Button>
        </div>

        <form className={dialogStyles.form} onSubmit={handleSubmit}>
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
            <span className={dialogStyles.label}>Collection</span>
            <Select
              aria-label="Collection"
              fieldSize="sm"
              value={collectionId}
              onChange={(event) => setCollectionId(event.target.value)}
              options={collections.map((collection) => ({
                value: collection.id,
                label: collection.pluralLabel || collection.name,
              }))}
            />
          </div>

          <label className={dialogStyles.field}>
            <span className={dialogStyles.label}>Priority</span>
            <Input
              fieldSize="sm"
              type="number"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              invalid={priorityInvalid}
            />
          </label>

          <div className={dialogStyles.actions}>
            <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={!trimmedTitle || Boolean(slugValidation) || priorityInvalid}
            >
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
})
