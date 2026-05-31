/**
 * RuntimeScriptInjector — runs the site's bundled runtime scripts inside an
 * editable canvas iframe.
 *
 * The canvas frames are same-origin, React-rendered iframes (see
 * `IframeFrameSurface`). To make authored behaviour run in-place without
 * leaving the editor, we append the bundled entry scripts (from
 * `useRuntimeScriptBuild`) as inline `<script type="module">` elements into
 * the iframe document. Module scripts appended after load execute against the
 * already-rendered DOM — exactly what we want, since React mounted the node
 * tree first.
 *
 * Why imperative DOM, not JSX:
 * Browsers do not execute `<script>` elements that React inserts as part of
 * its tree, so we create the elements with `document.createElement('script')`
 * and `appendChild` them — that path does run them. Head-placed scripts go in
 * `<head>`, everything else at `<body>` end (publisher placement parity).
 *
 * Re-run semantics:
 * The effect depends on the `scripts` array. `useRuntimeScriptBuild` returns a
 * stable array reference between builds (and a stable empty sentinel while
 * idle/building), so this effect re-runs exactly when a new build lands —
 * which only happens on a script edit, a dependency change, or an explicit
 * Refresh, never on an ordinary node-tree edit. When it does re-run, the old
 * `<script>` elements are removed and the new ones appended, re-executing the
 * scripts. Removing a `<script>` element does not undo side effects it already
 * caused (listeners, injected nodes) — re-running is the "refresh", which is
 * why the toggle UI surfaces a manual Refresh too.
 */

import { useEffect } from 'react'
import type { InjectableRuntimeScript } from './useRuntimeScriptBuild'

interface RuntimeScriptInjectorProps {
  /** The iframe document to inject into. `null` until the iframe has loaded. */
  targetDocument: Document | null
  scripts: InjectableRuntimeScript[]
}

const RUNTIME_SCRIPT_MARKER = 'data-pb-canvas-runtime-script'

export function RuntimeScriptInjector({ targetDocument, scripts }: RuntimeScriptInjectorProps) {
  useEffect(() => {
    if (!targetDocument) return
    const head = targetDocument.head
    const body = targetDocument.body
    if (!head || !body) return

    const elements = scripts.map((script) => {
      const el = targetDocument.createElement('script')
      el.type = 'module'
      el.setAttribute(RUNTIME_SCRIPT_MARKER, script.id)
      el.textContent = script.content
      const parent = script.placement === 'head' ? head : body
      parent.appendChild(el)
      return el
    })

    return () => {
      for (const el of elements) el.remove()
    }
  }, [targetDocument, scripts])

  return null
}
