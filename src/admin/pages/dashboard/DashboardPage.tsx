/**
 * DashboardPage — `/admin/dashboard`.
 *
 * The admin home. Renders:
 *   • A page header with a personal greeting + Publish / Customize / New
 *     page actions.
 *   • The setup onboarding panel (wired to live CMS state via
 *     `useOnboardingState`). Per-user dismissed / collapsed in
 *     localStorage.
 *   • A configurable widget grid (12 columns). Customize mode shows drag
 *     handles + resize handles per widget + a block picker.
 *
 * Widgets come from `dashboardWidgetRegistry` — first-party widgets are
 * registered on mount via `registerFirstPartyDashboardWidgets`; plugins
 * that hold the `dashboard.widgets.register` permission contribute
 * additional widgets through the SDK.
 *
 * Routes into the editor through the existing soft-nav helpers so the
 * Site editor's heavy bundle doesn't load on the dashboard.
 */
import { useEffect, useMemo, useState } from 'react'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { ZapSolidIcon } from 'pixel-art-icons/icons/zap-solid'
import { ChevronRightIcon } from 'pixel-art-icons/icons/chevron-right'
import { AdminPageLayout } from '@admin/layouts/AdminPageLayout'
import { useAuthenticatedAdminUser } from '@admin/sessionContext'
import { useAdminNavigate } from '@admin/lib/useAdminNavigate'
import { Button } from '@ui/components/Button'
import { bindDashboardWidgetIconResolver } from '@core/plugins/runtime'
import { useDashboardWidgets } from './hooks/useDashboardWidgets'
import { useOnboardingState } from './hooks/useOnboardingState'
import { useDashboardLayout } from './hooks/useDashboardLayout'
import { registerFirstPartyDashboardWidgets } from './widgets'
import { resolveDashboardWidgetIcon } from './widgetIcons'
import { OnboardingPanel } from './components/OnboardingPanel'
import { BlockPicker } from './components/BlockPicker'
import { DashboardGrid } from './components/DashboardGrid'
import { RangeTabs } from './components/RangeTabs'
import styles from './DashboardPage.module.css'

// Register first-party widgets + the plugin icon resolver eagerly at
// module import. Both are idempotent and side-effect-free past the first
// call, so successive imports during fast-refresh / lazy reloads are
// cheap. Doing this at module scope (not inside the component) means
// plugin code that activates concurrently can already see the resolver.
registerFirstPartyDashboardWidgets()
bindDashboardWidgetIconResolver(resolveDashboardWidgetIcon)

type RangeKey = 'today' | '7d' | '30d' | 'all'

function greetingFor(displayName: string | null | undefined): string {
  const hour = new Date().getHours()
  const time = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const name = displayName?.split(' ')[0] ?? 'there'
  return `Good ${time}, ${name}.`
}

export function DashboardPage() {
  const currentUser = useAuthenticatedAdminUser()
  const navigate = useAdminNavigate()
  const widgets = useDashboardWidgets()
  const facts = useOnboardingState()
  const layoutApi = useDashboardLayout()
  const {
    layout,
    addWidget,
    reorder,
    resize,
    resizeRows,
    dismissOnboarding,
  } = layoutApi

  const [editing, setEditing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [range, setRange] = useState<RangeKey>('today')

  // Bridge the registry array into a stable Map keyed by id for O(1)
  // lookups inside the grid + picker.
  const definitionsById = useMemo(() => {
    const map = new Map<string, typeof widgets[number]>()
    for (const w of widgets) map.set(w.id, w)
    return map
  }, [widgets])

  // Drop layout entries whose widget was unregistered (plugin disabled,
  // first-party widget removed in a host update, etc.) — keeps the grid
  // from rendering empty cells.
  const visibleItems = useMemo(() => {
    return layout.items.filter((item) => definitionsById.has(item.id))
  }, [layout.items, definitionsById])

  useEffect(() => {
    // Reconcile dropped items back into the persisted layout exactly
    // once when widgets are removed from the registry. We could do this
    // inside the filter above, but a separate reconciliation effect
    // keeps render pure.
    if (visibleItems.length !== layout.items.length) {
      reorder(visibleItems)
    }
  }, [visibleItems, layout.items, reorder])

  const activeKeys = visibleItems.map((i) => i.id)
  const showOnboarding = !layout.onboardingDismissed && !facts.loading

  return (
    <AdminPageLayout
      workspace="dashboard"
      title={greetingFor(currentUser.displayName)}
      description="Your site at a glance — visitors, content and plugins. Configure the grid to surface exactly what you watch."
      actions={(
        <>
          <Button variant="ghost" size="sm">
            <ZapSolidIcon size={11} aria-hidden="true" /> Publish all
          </Button>
          <Button variant="primary" onClick={() => navigate('/admin/site')}>
            <PlusIcon size={12} aria-hidden="true" /> New page
          </Button>
        </>
      )}
    >
      <div className={styles.crumbs}>
        <span>Admin</span>
        <ChevronRightIcon size={9} aria-hidden="true" />
        <span className={styles.crumbsCurrent}>Dashboard</span>
      </div>

      {showOnboarding && (
        <OnboardingPanel facts={facts} onDismiss={dismissOnboarding} />
      )}

      {editing && (
        <div className={styles.editBanner}>
          <span>
            <b>Customize mode.</b> Drag tiles to reorder, drag the right edge to resize, or open the
            block library to add new widgets.
          </span>
          <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
            <PlusIcon size={11} aria-hidden="true" /> Add block
          </Button>
        </div>
      )}

      <div className={styles.gridHeader}>
        <div className={styles.gridHeaderLeft}>
          <h2>Overview</h2>
          <span className={styles.gridCount}>
            {String(visibleItems.length).padStart(2, '0')} blocks
          </span>
        </div>
        <div className={styles.gridHeaderRight}>
          <RangeTabs<RangeKey>
            value={range}
            options={[
              { value: 'today', label: 'Today' },
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d' },
              { value: 'all', label: 'All' },
            ]}
            onChange={setRange}
            ariaLabel="Time range"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            pressed={editing}
          >
            <LayoutSolidIcon size={11} aria-hidden="true" />
            {editing ? 'Done' : 'Customize'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
            <PlusIcon size={11} aria-hidden="true" /> Add block
          </Button>
        </div>
      </div>

      <DashboardGrid
        items={visibleItems}
        definitions={definitionsById}
        editing={editing}
        onReorder={reorder}
        onResize={resize}
        onResizeRows={resizeRows}
        onAddBlock={() => setPickerOpen(true)}
      />

      {pickerOpen && (
        <BlockPicker
          widgets={widgets}
          activeKeys={activeKeys}
          onAdd={(id, defaultSize) => addWidget(id, defaultSize)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </AdminPageLayout>
  )
}
