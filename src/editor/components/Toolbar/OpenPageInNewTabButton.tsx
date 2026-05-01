import { selectActivePage, useEditorStore } from '@core/editor-store/store'
import { pagePublicPath } from '@core/page-tree/slugs'
import { ExternalLinkIcon } from '@ui/icons/icons/external-link'
import { Button } from '@ui/components/Button'

export function OpenPageInNewTabButton() {
  const activePage = useEditorStore(selectActivePage)
  const disabled = !activePage

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      aria-label="Open page in new tab"
      title="Open page in new tab"
      disabled={disabled}
      onClick={() => {
        if (!activePage) return
        window.open(pagePublicPath(activePage.slug), '_blank', 'noopener,noreferrer')
      }}
      data-testid="toolbar-open-page-new-tab-btn"
    >
      <ExternalLinkIcon size={16} aria-hidden="true" />
    </Button>
  )
}
