import { useEffect, useSyncExternalStore } from 'react'
import { useEditorStore } from '@site/store/store'
import type { LeftSidebarPanelId } from '@site/store/slices/uiSlice'
import type { IconComponent } from 'pixel-art-icons/types'
import { Bulletlist2SharpIcon } from 'pixel-art-icons/icons/bulletlist-2-sharp'
import { AiSettingsSolidIcon } from 'pixel-art-icons/icons/ai-settings-solid'
import { FilesStack2SolidIcon } from 'pixel-art-icons/icons/files-stack-2-solid'
import { ImagesSolidIcon } from 'pixel-art-icons/icons/images-solid'
import { BoxStackSolidIcon } from 'pixel-art-icons/icons/box-stack-solid'
import { PaintBucketSolidIcon } from 'pixel-art-icons/icons/paint-bucket-solid'
import { ColorsSwatchSolidIcon } from 'pixel-art-icons/icons/colors-swatch-solid'
import { TextStartTIcon } from 'pixel-art-icons/icons/text-start-t'
import { RulerDimensionSolidIcon } from 'pixel-art-icons/icons/ruler-dimension-solid'
import { Button } from '@ui/components/Button'
import { pluginRuntime } from '@core/plugins/runtime'
import { getKeybindingForCommand, formatShortcut } from '@admin/spotlight/keybindings'
import { resolvePluginPanelIcon } from './pluginPanelIcons'
import styles from './PanelRail.module.css'

const ACCENT_CYCLE: ReadonlyArray<RailAccent> = ['mint', 'lilac', 'sky', 'peach']

type RailAccent = 'mint' | 'lilac' | 'sky' | 'peach'

interface PrimaryRailItem {
  id: LeftSidebarPanelId
  label: string
  icon: IconComponent
  iconName: string
  accent: RailAccent
  /**
   * commandId links this panel button to a keybinding in the registry.
   * The ariaKeyshortcuts and shortcutLabel tooltip are derived from it
   * at runtime — do NOT hardcode shortcut strings here.
   */
  commandId?: string
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
    // No keyboard shortcut registered for the Layers panel.
  },
  {
    id: 'agent',
    label: 'AI assistant',
    icon: AiSettingsSolidIcon,
    iconName: 'ai-settings-solid',
    accent: 'lilac',
    commandId: 'panels.toggleAgent',
  },
  {
    id: 'site',
    label: 'Site',
    icon: FilesStack2SolidIcon,
    iconName: 'files-stack-2',
    accent: 'sky',
    commandId: 'panels.toggleSiteExplorer',
  },
  {
    id: 'selectors',
    label: 'Selectors',
    icon: PaintBucketSolidIcon,
    iconName: 'paint-bucket',
    accent: 'peach',
  },
  {
    id: 'colors',
    label: 'Colors',
    icon: ColorsSwatchSolidIcon,
    iconName: 'colors-swatch',
    accent: 'peach',
  },
  {
    id: 'typography',
    label: 'Typography',
    icon: TextStartTIcon,
    iconName: 'text-start-t',
    accent: 'mint',
  },
  {
    id: 'spacing',
    label: 'Spacing',
    icon: RulerDimensionSolidIcon,
    iconName: 'ruler-dimension',
    accent: 'lilac',
  },
  {
    id: 'media',
    label: 'Media',
    icon: ImagesSolidIcon,
    iconName: 'images',
    accent: 'sky',
    commandId: 'panels.toggleMedia',
  },
  {
    id: 'dependencies',
    label: 'Dependencies',
    icon: BoxStackSolidIcon,
    iconName: 'box-stack',
    accent: 'peach',
  },
]

interface PanelRailProps {
  workspace?: 'site' | 'content' | 'media'
  editable?: boolean
}

const subscribePluginRuntime = (cb: () => void) => pluginRuntime.subscribe(cb)
const getPluginPanelsSnapshot = () => pluginRuntime.getPanels()
// Reuse the same empty array on the server so useSyncExternalStore doesn't
// detect a snapshot mismatch.
const SERVER_PLUGIN_PANELS_SNAPSHOT: ReturnType<typeof getPluginPanelsSnapshot> = []

export function PanelRail({ workspace = 'site', editable = true }: PanelRailProps) {
  const domOpen = useEditorStore((s) => !s.domTreePanel.collapsed)
  const siteOpen = useEditorStore((s) => s.siteExplorerPanelOpen)
  const selectorsOpen = useEditorStore((s) => s.selectorsPanelOpen)
  const colorsOpen = useEditorStore((s) => s.colorsPanelOpen)
  const typographyOpen = useEditorStore((s) => s.typographyPanelOpen)
  const spacingOpen = useEditorStore((s) => s.spacingPanelOpen)
  const mediaOpen = useEditorStore((s) => s.mediaExplorerPanelOpen)
  const dependenciesOpen = useEditorStore((s) => s.dependenciesPanelOpen)
  const agentOpen = useEditorStore((s) => s.isAgentOpen)
  const activePluginPanelId = useEditorStore((s) => s.activePluginPanelId)

  const toggleLeftSidebarPanel = useEditorStore((s) => s.toggleLeftSidebarPanel)
  const toggleActivePluginPanel = useEditorStore((s) => s.toggleActivePluginPanel)

  // Subscribe to the plugin runtime so newly-registered panels appear in the
  // rail without a manual refresh. The runtime emits on every register/reset
  // — same channel toolbar buttons and commands already use.
  const pluginPanels = useSyncExternalStore(
    subscribePluginRuntime,
    getPluginPanelsSnapshot,
    () => SERVER_PLUGIN_PANELS_SNAPSHOT,
  )

  useEffect(() => {
    // Keyboard shortcuts for switching panels are wired up for every caller.
    // Read-only viewers should still be able to press the shortcut to flip
    // to Layers / Site Explorer / Media. The toggle handler in the store is
    // a no-op when nothing is actually written, so this is safe; the gating
    // of *content* (and the AI assistant) happens in the panels themselves.
    // Agent shortcut is opt-in below — only registered for editors since the
    // agent panel itself is editor-only.

    // All match predicates come from the keybindings registry — single source of truth.
    const kbSiteExplorer = getKeybindingForCommand('panels.toggleSiteExplorer')
    const kbMedia        = getKeybindingForCommand('panels.toggleMedia')
    const kbProperties   = getKeybindingForCommand('panels.toggleProperties')
    const kbAgent        = editable ? getKeybindingForCommand('panels.toggleAgent') : null

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

      if (kbSiteExplorer?.match(e)) {
        e.preventDefault()
        useEditorStore.getState().toggleLeftSidebarPanel('site')
      } else if (kbMedia?.match(e)) {
        e.preventDefault()
        useEditorStore.getState().toggleLeftSidebarPanel('media')
      } else if (kbProperties?.match(e)) {
        e.preventDefault()
        useEditorStore.getState().togglePropertiesPanel()
      } else if (kbAgent?.match(e)) {
        e.preventDefault()
        useEditorStore.getState().toggleLeftSidebarPanel('agent')
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editable])

  const panelOpenById = {
    layers: domOpen,
    agent: agentOpen,
    site: siteOpen,
    selectors: selectorsOpen,
    colors: colorsOpen,
    typography: typographyOpen,
    spacing: spacingOpen,
    media: mediaOpen,
    dependencies: dependenciesOpen,
  } satisfies Record<LeftSidebarPanelId, boolean>

  // Read-only callers (Viewer / Client) see only the navigation/inspection
  // panels — Layers, Site Explorer, Media. Style/runtime editing panels and
  // the AI assistant only appear when the user can edit structure.
  const READ_ONLY_RAIL_IDS = new Set<LeftSidebarPanelId>(['layers', 'site', 'media'])
  const visiblePrimaryItems = editable
    ? PRIMARY_RAIL_ITEMS
    : PRIMARY_RAIL_ITEMS.filter((item) => READ_ONLY_RAIL_IDS.has(item.id))

  const primaryItems: RailItem[] = visiblePrimaryItems.map((item) => {
    const label = workspace === 'content' && item.id === 'site' ? 'Content' : item.label
    // Shortcut labels and ARIA keyshortcuts come from the keybindings registry.
    const kb = item.commandId ? getKeybindingForCommand(item.commandId) : undefined
    const shortcutLabel = kb ? formatShortcut(kb.shortcut) : undefined
    const ariaKeyshortcuts = kb?.ariaKeyshortcuts
    return {
      ...item,
      label,
      open: panelOpenById[item.id],
      onToggle: () => toggleLeftSidebarPanel(item.id),
      shortcutLabel,
      ariaKeyshortcuts,
    }
  })

  // Plugin panels show up after the primary group when editing. They cycle
  // through the four accent colors so plugins that don't pick one still get
  // visual differentiation; the order is stable across renders because
  // `getPanels()` returns insertion order.
  const pluginItems: RailItem[] = editable
    ? pluginPanels.map((panel, index) => ({
        id: `plugin:${panel.id}`,
        label: panel.label,
        icon: resolvePluginPanelIcon(panel.iconName),
        iconName: panel.iconName,
        accent: panel.accent ?? ACCENT_CYCLE[index % ACCENT_CYCLE.length],
        open: activePluginPanelId === panel.id,
        onToggle: () => toggleActivePluginPanel(panel.id),
        shortcutLabel: panel.shortcutLabel,
      }))
    : []

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
      {pluginItems.length > 0 && (
        <div className={styles.itemGroup} data-testid="panel-rail-plugins">
          {pluginItems.map((item) => (
            <RailButton key={item.id} item={item} />
          ))}
        </div>
      )}
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
      tooltip={title}
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
