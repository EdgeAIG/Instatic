import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { dismissToast, pushToast, ToastProvider } from '@ui/components/Toast'

const publishedToastIds: string[] = []

afterEach(() => {
  act(() => {
    for (const id of publishedToastIds.splice(0)) dismissToast(id)
  })
  cleanup()
  document.getElementById('toast-root')?.remove()
})

function publishToast(input: Parameters<typeof pushToast>[0]): string {
  let toastId = ''
  act(() => {
    toastId = pushToast(input)
  })
  publishedToastIds.push(toastId)
  return toastId
}

function findToastByText(toasts: HTMLElement[], text: string): HTMLElement {
  const toast = toasts.find((item) => item.textContent?.includes(text))
  expect(toast).toBeDefined()
  return toast as HTMLElement
}

describe('ToastProvider', () => {
  it('announces error and warning toasts as alerts and success and info toasts as statuses', async () => {
    render(<ToastProvider />)

    publishToast({
      kind: 'error',
      title: 'Save failed',
      body: 'Disk is full.',
      location: 'admin-test',
      durationMs: null,
    })
    publishToast({
      kind: 'warning',
      title: 'Draft conflict',
      body: 'Reload before saving.',
      durationMs: null,
    })
    publishToast({
      kind: 'success',
      title: 'Saved',
      body: 'Draft persisted.',
      durationMs: null,
    })
    publishToast({
      kind: 'info',
      title: 'Panel restored',
      durationMs: null,
    })

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(2)
    const error = findToastByText(alerts, 'Save failed')
    expect(error.textContent).toContain('Disk is full.')
    expect(error.textContent).toContain('admin-test')
    expect(error.getAttribute('aria-live')).toBe('assertive')
    expect(error.getAttribute('data-toast-kind')).toBe('error')
    const warning = findToastByText(alerts, 'Draft conflict')
    expect(warning.getAttribute('aria-live')).toBe('assertive')
    expect(warning.getAttribute('data-toast-kind')).toBe('warning')

    const statuses = await screen.findAllByRole('status')
    expect(statuses).toHaveLength(2)
    const success = findToastByText(statuses, 'Saved')
    expect(success.textContent).toContain('Draft persisted.')
    expect(success.getAttribute('aria-live')).toBe('polite')
    expect(success.getAttribute('data-toast-kind')).toBe('success')
    const info = findToastByText(statuses, 'Panel restored')
    expect(info.getAttribute('aria-live')).toBe('polite')
    expect(info.getAttribute('data-toast-kind')).toBe('info')
  })

  it('dismisses a visible toast from the close affordance', async () => {
    render(<ToastProvider />)

    publishToast({
      kind: 'info',
      title: 'Panel restored',
      durationMs: null,
    })

    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
  })
})
