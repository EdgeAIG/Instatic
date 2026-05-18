/**
 * useMediaAssetMap — resolves a list of media asset IDs to their full
 * `CmsMediaAsset` objects with a module-level cache.
 *
 * Returns a `Map<id, CmsMediaAsset | null>` where:
 *   - A present key with a `CmsMediaAsset` value  → asset found.
 *   - A present key with `null`                   → asset confirmed missing.
 *   - An absent key                               → still loading.
 *
 * The cache is module-scoped so it persists across re-renders and component
 * mounts. A single in-flight `listCmsMediaAssets()` request is shared across
 * all concurrent callers — no N+1 fetches for a grid full of cells.
 */
import { useEffect, useReducer } from 'react'
import { listCmsMediaAssets } from '@core/persistence'
import type { CmsMediaAsset } from '@core/persistence'

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

/** Resolved assets: null = confirmed missing, CmsMediaAsset = found. */
const assetCache = new Map<string, CmsMediaAsset | null>()

/**
 * A shared in-flight fetch promise. When any cell requests uncached IDs,
 * we fire a single `listCmsMediaAssets()` and share the result with all
 * concurrent callers (multiple grid cells request the same batch).
 */
let globalFetchPromise: Promise<void> | null = null

async function ensureAssetsCached(ids: readonly string[]): Promise<void> {
  // If everything is already cached, skip the network call.
  if (ids.every((id) => assetCache.has(id))) return

  // Share an in-flight fetch so concurrent callers don't fan-out.
  if (!globalFetchPromise) {
    globalFetchPromise = listCmsMediaAssets()
      .then((assets) => {
        for (const asset of assets) {
          assetCache.set(asset.id, asset)
        }
      })
      .catch(() => {
        // Network errors are non-fatal — callers will see "loading" briefly
        // then fall through to the missing-asset state on next render.
      })
      .finally(() => {
        globalFetchPromise = null
      })
  }

  await globalFetchPromise

  // Mark any IDs that the list response didn't include as confirmed missing.
  for (const id of ids) {
    if (!assetCache.has(id)) assetCache.set(id, null)
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMediaAssetMap(ids: readonly string[]): Map<string, CmsMediaAsset | null> {
  // Stable cache-key: sort so order doesn't matter.
  const idsKey = ids.slice().sort().join('\0')

  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    if (ids.length === 0) return
    const missing = ids.filter((id) => !assetCache.has(id))
    if (missing.length === 0) return

    void ensureAssetsCached(ids).then(() => forceUpdate())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  // Build result from cache; absent keys mean "still loading".
  const result = new Map<string, CmsMediaAsset | null>()
  for (const id of ids) {
    if (assetCache.has(id)) {
      result.set(id, assetCache.get(id) ?? null)
    }
  }
  return result
}
