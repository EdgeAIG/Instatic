import '../../src/modules/base'
import { registry } from '../../src/core/module-engine/registry'
import { publishPage } from '../../src/core/publisher/render'
import { selectEntryTemplate } from '../../src/core/templates/templateMatching'
import type { PublishedContentEntry } from './contentRepository'
import type { PublishedPageSnapshot } from './publishRepository'

export function renderPublishedSnapshot(snapshot: PublishedPageSnapshot): string {
  const page = snapshot.site.pages.find((candidate) => candidate.id === snapshot.pageId)
  if (!page) throw new Error(`Published page "${snapshot.pageId}" not found in snapshot`)
  return publishPage(page, snapshot.site, registry).html
}

export function renderPublishedContentTemplate(
  snapshot: PublishedPageSnapshot,
  entry: PublishedContentEntry,
): string | null {
  const template = selectEntryTemplate(snapshot.site, entry.collectionId)
  if (!template) return null

  return publishPage(template, snapshot.site, registry, undefined, {
    currentEntry: entry,
  }).html
}
