import { useEffect, useState } from 'react'

const NARROW_EDITOR_CHROME_QUERY = '(max-width: 900px)'

export function isNarrowEditorChromeViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_EDITOR_CHROME_QUERY).matches
}

export function useNarrowEditorChrome(): boolean {
  const [matches, setMatches] = useState(isNarrowEditorChromeViewport)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const media = window.matchMedia(NARROW_EDITOR_CHROME_QUERY)
    const update = () => setMatches(media.matches)

    update()
    media.addEventListener('change', update)

    return () => media.removeEventListener('change', update)
  }, [])

  return matches
}
