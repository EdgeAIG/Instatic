/**
 * Module-level DataMeta cache for DynamicBindingControl.
 *
 * Lives in a separate `.ts` file so `DynamicBindingControl.tsx` can remain a
 * pure component file (required for React Fast Refresh to work correctly).
 *
 * `clearDataMetaCache` is exported for test isolation; import it from this
 * module directly — do not re-export it from the `.tsx` component file.
 */

import type { DataMeta } from '@core/data/schemas'
import { getDataMeta } from '@core/persistence/cmsData'

export let _cachedMeta: DataMeta | null = null
let _metaPromise: Promise<DataMeta> | null = null

/** @internal - for test use only */
export function clearDataMetaCache(): void {
  _cachedMeta = null
  _metaPromise = null
}

export function loadDataMeta(): Promise<DataMeta> {
  if (_cachedMeta) return Promise.resolve(_cachedMeta)
  if (_metaPromise) return _metaPromise
  _metaPromise = getDataMeta()
    .then((m) => {
      _cachedMeta = m
      _metaPromise = null
      return m
    })
    .catch((err) => {
      // Clear so a retry is possible after an error.
      _metaPromise = null
      throw err
    })
  return _metaPromise
}
