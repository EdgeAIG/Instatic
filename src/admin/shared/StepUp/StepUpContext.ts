/**
 * StepUp context — exposed via `useStepUp()` so any component in the
 * authenticated admin tree can wrap a sensitive action with the password
 * re-entry flow.
 *
 * The provider component lives next door in `StepUpProvider.tsx` (the
 * .ts/.tsx split keeps Fast Refresh working for the provider — see
 * `routerHooks.ts` for the same pattern).
 *
 * Typical use:
 *
 *   const { runStepUp } = useStepUp()
 *   const handleDelete = async () => {
 *     try {
 *       await runStepUp(() => deleteCmsUser(id))
 *     } catch (err) {
 *       if ((err as Error).message === 'step_up_cancelled') return
 *       // surface other errors normally
 *     }
 *   }
 *
 * `runStepUp` runs `fn` directly. If the server rejects with
 * `step_up_required`, the dialog opens; on a successful password re-entry
 * the runner re-invokes `fn` and returns its result. On cancel it rejects
 * with `Error('step_up_cancelled')` so the caller can swallow that
 * specific failure without conflating it with "the action errored".
 */
import { createContext, useContext } from 'react'

export interface StepUpContextValue {
  runStepUp: <T>(action: () => Promise<T>) => Promise<T>
}

export const StepUpCancelledMessage = 'step_up_cancelled'

export const StepUpContext = createContext<StepUpContextValue | null>(null)

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext)
  if (!ctx) {
    throw new Error('useStepUp must be called inside <StepUpProvider>')
  }
  return ctx
}
