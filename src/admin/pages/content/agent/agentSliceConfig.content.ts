/**
 * Content-workspace agent-slice config — supplied to `createAgentSlice`
 * when the content workspace's standalone Zustand store is composed.
 *
 * Mirrors `agentSliceConfig.site.ts` for the site editor:
 *   - declares `scope: 'content'` for URL + JSON wiring,
 *   - snapshots the live workspace (active doc + collections) via the
 *     registered ContentBridgeHandle,
 *   - dispatches write tools through `executeContentTool`,
 *   - uses the content-scope wording in the no-provider error so the
 *     user is pointed at /admin/ai/defaults for the content default.
 *
 * The current-user identity is captured at config-creation time. That
 * means the snapshot reflects whoever loaded the ContentPage; if the user
 * is swapped mid-session the page reloads anyway (AuthenticatedAdmin
 * tears the tree down on logout), so the closure can't go stale here.
 */

import type { AgentSliceConfig } from '@site/agent/agentSlice'
import { executeContentTool } from './contentBridge'
import { getContentBridgeHandle } from './contentBridgeHandle'

/**
 * The content-scope config is a static singleton — currentUser, workspace,
 * and draft state are all owned by the ContentBridgeHandle (which keeps
 * refs pointing at the live ContentPage state). The config layer just
 * forwards to the handle.
 */
export const contentAgentSliceConfig: AgentSliceConfig = {
  scope: 'content',
  buildSnapshot: () => getContentBridgeHandle().buildSnapshot(),
  dispatchTool: executeContentTool,
  noProviderMessage:
    'No AI provider configured for the content workspace. Open /admin/ai/providers to add a credential, then /admin/ai/defaults to pick one for the "content" scope.',
}
