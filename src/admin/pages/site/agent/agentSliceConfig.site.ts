/**
 * Site-editor agent-slice config — supplied to `createAgentSlice` when the
 * site editor's store is composed.
 *
 * Splits the scope-specific bits out of agentSlice.ts so the slice itself
 * stays generic across surfaces (Phase 4 introduced the content workspace
 * which uses the same factory with its own config). The site config:
 *
 *   - declares `scope: 'site'` for URL/JSON wiring,
 *   - snapshots the live page tree via buildCurrentPageContext,
 *   - dispatches write tools through the existing executor.ts,
 *   - keeps the original "no AI provider configured" copy with the site-
 *     editor wording the panel's NoCredentialBanner depends on.
 *
 * Lives in this folder (next to the legacy site-editor agent code) so the
 * site editor's store has a stable import path; doesn't escape into the
 * generic `@site/agent/agentSlice` module.
 */

import type { AgentSliceConfig } from './agentSlice'
import { buildCurrentPageContext } from './agentSlice'
import { executeAgentTool } from './executor'
import { getAgentStoreApi } from './storeRef'
import type { EditorStore } from '@site/store/types'

export const siteAgentSliceConfig: AgentSliceConfig = {
  scope: 'site',
  buildSnapshot: () => buildCurrentPageContext(
    () => getAgentStoreApi<EditorStore>().getState(),
  ),
  dispatchTool: executeAgentTool,
  // Keep the site-editor wording — `NoCredentialBanner` recognises this
  // string prefix and renders the deep-link CTA.
  noProviderMessage:
    'No AI provider configured for the site editor. Open /admin/ai/providers to add a credential, then /admin/ai/defaults to pick one for the "site" scope.',
}
