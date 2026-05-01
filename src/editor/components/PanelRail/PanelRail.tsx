import { useEffect } from 'react'
import { useEditorStore } from '@core/editor-store/store'
import type { LeftSidebarPanelId } from '@core/editor-store/slices/uiSlice'
import type { IconComponent } from '@ui/icons/types'
import { Bulletlist2SharpIcon } from '@ui/icons/icons/bulletlist-2-sharp'
import { AiSettingsSolidIcon } from '@ui/icons/icons/ai-settings-solid'
import { FilesStack2Icon } from '@ui/icons/icons/files-stack-2'
import { ImagesIcon } from '@ui/icons/icons/images'
import { BoxStackIcon } from '@ui/icons/icons/box-stack'
import { PaintBucketIcon } from '@ui/icons/icons/paint-bucket'
import { Button } from '@ui/components/Button'
import styles from './PanelRail.module.css'

type RailAccent = 'mint' | 'lilac' | 'sky' | 'peach'

interface PrimaryRailItem {
  id: LeftSidebarPanelId
  label: string
  icon: IconComponent
  iconName: string
  accent: RailAccent
  ariaKeyshortcuts?: string
  shortcutLabel?: string
}

interface RailItem {
  id: string
  label: string
  icon: IconComponent
  iconName: string
  accent: RailAccent
  open: boolean
  disabled?: boolean
  onToggle: () => void
  disabledTitle?: string
  ariaKeyshortcuts?: string
  shortcutLabel?: string
}

const PRIMARY_RAIL_ITEMS: PrimaryRailItem[] = [
  {
    id: 'layers',
    label: 'Layers',
    icon: Bulletlist2SharpIcon,
    iconName: 'bulletlist-2-sharp',
    accent: 'mint',
  },
  {
    id: 'agent',
    label: 'AI assistant',
    icon: AiSettingsSolidIcon,
    iconName: 'ai-settings-solid',
    accent: 'lilac',
    ariaKeyshortcuts: 'Meta+I',
    shortcutLabel: 'Cmd+I',
  },
  {
    id: 'site',
    label: 'Site',
    icon: FilesStack2Icon,
    iconName: 'files-stack-2',
    accent: 'sky',
    ariaKeyshortcuts: 'Control+Shift+E',
    shortcutLabel: 'Ctrl+Shift+E',
  },
  {
    id: 'selectors',
    label: 'Selectors',
    icon: PaintBucketIcon,
    iconName: 'paint-bucket',
    accent: 'peach',
  },
  {
    id: 'media',
    label: 'Media',
    icon: ImagesIcon,
    iconName: 'images',
    accent: 'sky',
  },
  {
    id: 'dependencies',
    label: 'Dependencies',
    icon: BoxStackIcon,
    iconName: 'box-stack',
    accent: 'peach',
  },
]

interface PanelRailProps {
  workspace?: 'site' | 'content'
}

export function PanelRail({ workspace = 'site' }: PanelRailProps) {
  const domOpen = useEditorStore((s) => !s.domTreePanel.collapsed)
  const siteOpen = useEditorStore((s) => s.siteExplorerPanelOpen)
  const selectorsOpen = useEditorStore((s) => s.selectorsPanelOpen)
  const mediaOpen = useEditorStore((s) => s.mediaExplorerPanelOpen)
  const dependenciesOpen = useEditorStore((s) => s.dependenciesPanelOpen)
  const agentOpen = useEditorStore((s) => s.isAgentOpen)

  const toggleLeftSidebarPanel = useEditorStore((s) => s.toggleLeftSidebarPanel)

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null
      return Boolean(element && (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.isContentEditable
      ))
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return

      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        useEditorStore.getState().toggleLeftSidebarPanel('site')
      } else if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault()
        useEditorStore.getState().toggleLeftSidebarPanel('media')
      } else if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        useEditorStore.getState().togglePropertiesPanel()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        useEditorStore.getState().toggleLeftSidebarPanel('agent')
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const panelOpenById = {
    layers: domOpen,
    agent: agentOpen,
    site: siteOpen,
    selectors: selectorsOpen,
    media: mediaOpen,
    dependencies: dependenciesOpen,
  } satisfies Record<LeftSidebarPanelId, boolean>

  const primaryItems: RailItem[] = PRIMARY_RAIL_ITEMS.map((item) => {
    const label = workspace === 'content' && item.id === 'site' ? 'Content' : item.label
    return {
      ...item,
      label,
      open: panelOpenById[item.id],
      onToggle: () => toggleLeftSidebarPanel(item.id),
    }
  })

  return (
    <nav
      aria-label="Panel dock"
      className={styles.rail}
      data-testid="panel-rail"
    >
      <div className={styles.itemGroup}>
        {primaryItems.map((item) => (
          <RailButton key={item.id} item={item} />
        ))}
      </div>
    </nav>
  )
}

function RailButton({ item }: { item: RailItem }) {
  const RailIcon = item.icon
  const action = item.open ? 'Close' : 'Open'
  const title = item.disabled
    ? item.disabledTitle
    : item.shortcutLabel
      ? `${item.label} panel (${item.shortcutLabel})`
      : `${item.label} panel`

  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      pressed={item.open}
      aria-label={`${action} ${item.label} panel`}
      aria-keyshortcuts={item.ariaKeyshortcuts}
      disabled={item.disabled}
      title={title}
      data-testid={`panel-rail-${item.id}`}
      data-icon={item.iconName}
      data-accent={item.accent}
      onClick={item.onToggle}
      className={styles.railButton}
    >
      <span className={styles.activeIndicator} aria-hidden="true" />
      <RailIcon size={16} className={styles.railIcon} />
    </Button>
  )
}
