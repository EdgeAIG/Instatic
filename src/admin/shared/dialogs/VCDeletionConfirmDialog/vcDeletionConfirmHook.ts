/**
 * Hook + types backing <VCDeletionConfirmProvider/>.
 *
 * Lives in its own (non-component) file so the provider component module can
 * keep Fast Refresh-friendly "components-only" exports. Same split-file layout
 * as `frameworkChangeConfirmHook.ts`.
 */

import { createContext, useContext } from 'react'
import type { VCDeletionImpact } from '@core/visualComponents/deletionImpact'

export interface ConfirmVCDeletionRequest {
  /** ID of the visual component to delete. */
  vcId: string
  /**
   * Executes the actual deletion (deleteVisualComponent + any post-delete cleanup
   * such as clearing activeDocument). Called only when the user confirms the dialog
   * or when there are no usages and confirmBeforeDelete is off.
   */
  commit: () => void
}

export interface VCDeletionConfirmContextValue {
  confirm: (request: ConfirmVCDeletionRequest) => void
}

export interface PendingVCDeletionState {
  request: ConfirmVCDeletionRequest
  /** Captured at preview time so the dialog renders stable data. */
  impact: VCDeletionImpact
}

export const VCDeletionConfirmContext =
  createContext<VCDeletionConfirmContextValue | null>(null)

/**
 * Returns `confirmVCDeletion(request)` from the nearest
 * <VCDeletionConfirmProvider/>. The caller passes a `vcId` and a `commit`
 * callback that performs the actual store action; the hook handles the
 * preview / dialog / confirm dance.
 *
 * Falls back to immediate commit when no provider is mounted (test isolation).
 */
export function useVCDeletionConfirm(): (request: ConfirmVCDeletionRequest) => void {
  const ctx = useContext(VCDeletionConfirmContext)
  if (ctx) return ctx.confirm
  return (request) => request.commit()
}
