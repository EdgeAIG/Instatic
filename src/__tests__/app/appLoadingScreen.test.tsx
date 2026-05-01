import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { AppLoadingScreen } from '../../app/AppLoadingScreen'

afterEach(cleanup)

describe('AppLoadingScreen', () => {
  it('renders one accessible centered loader without visible raw loading text or skeleton chrome', () => {
    render(<AppLoadingScreen />)

    const status = screen.getByRole('status', { name: /loading page builder/i })
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.querySelector('[data-loader-spinner="true"]')).not.toBeNull()
    expect(status.querySelector('[data-editor-skeleton="true"]')).toBeNull()
    expect(screen.queryByText(/^Loading\.\.\.$/)).toBeNull()
  })
})
