/**
 * StepUpProvider — verifies the dialog only opens when a sensitive action
 * fails with `step_up_required`, that successful re-auth retries the
 * action, and that cancel rejects with the documented sentinel.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { StepUpCancelledMessage, StepUpProvider, useStepUp } from '@admin/shared/StepUp'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Test harness — exposes the runStepUp result via a callback prop and
 * fires the action on first render. Each test sets up its own action so
 * we can vary success / step-up-required / cancel behaviour.
 */
function Harness({
  action,
  onResult,
  onError,
}: {
  action: () => Promise<unknown>
  onResult?: (value: unknown) => void
  onError?: (error: unknown) => void
}) {
  const { runStepUp } = useStepUp()
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    runStepUp(action).then(onResult).catch(onError)
  }, [runStepUp, action, onResult, onError])
  return null
}

describe('StepUpProvider', () => {
  beforeEach(() => {
    globalThis.fetch = mock(async () => jsonResponse({ ok: true, stepUpExpiresAt: new Date().toISOString() })) as typeof fetch
  })

  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
  })

  it('runs the action directly and never shows the dialog when no step-up is required', async () => {
    let resolved: unknown = null
    const action = mock(async () => 'ok')

    render(
      <StepUpProvider>
        <Harness action={action} onResult={(value) => { resolved = value }} />
      </StepUpProvider>,
    )

    await waitFor(() => {
      expect(resolved).toBe('ok')
    })
    expect(screen.queryByTestId('step-up-dialog')).toBeNull()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('opens the dialog on step_up_required, retries the action after a successful re-auth, and resolves with the retry result', async () => {
    let attempt = 0
    const action = mock(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('step_up_required')
      return 'retried'
    })
    let resolved: unknown = null

    render(
      <StepUpProvider>
        <Harness action={action} onResult={(value) => { resolved = value }} />
      </StepUpProvider>,
    )

    // Dialog appears after the first failure.
    await waitFor(() => {
      expect(screen.getByTestId('step-up-dialog')).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId('step-up-password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByTestId('step-up-confirm'))

    await waitFor(() => {
      expect(resolved).toBe('retried')
    })
    expect(screen.queryByTestId('step-up-dialog')).toBeNull()
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('rejects with step_up_cancelled when the user cancels', async () => {
    const action = mock(async () => { throw new Error('step_up_required') })
    let rejected: unknown = null

    render(
      <StepUpProvider>
        <Harness action={action} onError={(err) => { rejected = err }} />
      </StepUpProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('step-up-dialog')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('step-up-cancel'))

    await waitFor(() => {
      expect(rejected).toBeInstanceOf(Error)
    })
    expect((rejected as Error).message).toBe(StepUpCancelledMessage)
    expect(screen.queryByTestId('step-up-dialog')).toBeNull()
    // Action only ran once — never retried after cancel.
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('shows an inline error and keeps the dialog open when the password is wrong', async () => {
    const action = mock(async () => { throw new Error('step_up_required') })
    globalThis.fetch = mock(async () => jsonResponse({ error: 'Invalid password' }, 401)) as typeof fetch

    render(
      <StepUpProvider>
        <Harness action={action} />
      </StepUpProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('step-up-dialog')).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId('step-up-password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByTestId('step-up-confirm'))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Invalid password')
    })
    // Dialog stays open so the user can try again.
    expect(screen.getByTestId('step-up-dialog')).toBeTruthy()
    // Action was NOT retried because step-up itself failed.
    expect(action).toHaveBeenCalledTimes(1)
  })
})
