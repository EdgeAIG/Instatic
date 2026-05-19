/**
 * First-party dashboard widget bootstrap.
 *
 * Importing this file registers every built-in dashboard widget against
 * `dashboardWidgetRegistry`. The DashboardPage imports it once on mount
 * — subsequent navigations are cheap because the registrations stick.
 *
 * Plugin-registered widgets land separately via
 * `api.dashboard.widgets.register(...)` and don't need to be re-listed
 * here.
 */
import { ActivityWidget } from './ActivityWidget'
import { DomainWidget } from './DomainWidget'
import { MediaWidget } from './MediaWidget'
import { PagesWidget } from './PagesWidget'
import { PluginsWidget } from './PluginsWidget'
import { PostsWidget } from './PostsWidget'
import { PublishQueueWidget } from './PublishQueueWidget'
import { StatusWidget } from './StatusWidget'
import { StorageWidget } from './StorageWidget'
import { TopPagesWidget } from './TopPagesWidget'
import { VisitorsWidget } from './VisitorsWidget'

import { dashboardWidgetRegistry } from '@core/dashboard'

import { DashboardSolidIcon } from 'pixel-art-icons/icons/dashboard-solid'
import { CloudUploadSolidIcon } from 'pixel-art-icons/icons/cloud-upload-solid'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { GlobeSolidIcon } from 'pixel-art-icons/icons/globe-solid'
import { ImageSolidIcon } from 'pixel-art-icons/icons/image-solid'
import { PenSquareSolidIcon } from 'pixel-art-icons/icons/pen-square-solid'
import { PlugSolidIcon } from 'pixel-art-icons/icons/plug-solid'
import { StarSolidIcon } from 'pixel-art-icons/icons/star-solid'
import { ZapSolidIcon } from 'pixel-art-icons/icons/zap-solid'

/**
 * One-shot guard so re-importing this module (HMR, tests, lazy mounts)
 * doesn't double-register. The registry's `register` would replace the
 * existing definition by id anyway, but skipping the work shortens the
 * dev-reload tick noticeably.
 */
let registered = false

export function registerFirstPartyDashboardWidgets(): void {
  if (registered) return
  registered = true

  dashboardWidgetRegistry.register({
    id: 'visitors',
    ownerId: 'core',
    name: 'Visitors',
    description: 'Pageview sparkline',
    icon: EyeSolidIcon,
    defaultSize: 6,
    tint: 'mint',
    render: VisitorsWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'pages',
    ownerId: 'core',
    name: 'Pages',
    description: 'Published + drafts',
    icon: FileTextSolidIcon,
    defaultSize: 3,
    tint: 'lilac',
    render: PagesWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'posts',
    ownerId: 'core',
    name: 'Posts',
    description: 'Posts by category',
    icon: PenSquareSolidIcon,
    defaultSize: 3,
    tint: 'peach',
    render: PostsWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'storage',
    ownerId: 'core',
    name: 'Storage',
    description: 'Disk usage breakdown',
    icon: DatabaseSolidIcon,
    defaultSize: 6,
    tint: 'sky',
    render: StorageWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'topPages',
    ownerId: 'core',
    name: 'Top pages',
    description: 'Most-viewed URLs',
    icon: StarSolidIcon,
    defaultSize: 4,
    tint: 'lilac',
    render: TopPagesWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'activity',
    ownerId: 'core',
    name: 'Activity',
    description: 'Recent edits & publishes',
    icon: DashboardSolidIcon,
    defaultSize: 4,
    tint: 'peach',
    render: ActivityWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'publish',
    ownerId: 'core',
    name: 'Publish queue',
    description: 'Builds & scheduled posts',
    icon: CloudUploadSolidIcon,
    defaultSize: 4,
    tint: 'sky',
    render: PublishQueueWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'plugins',
    ownerId: 'core',
    name: 'Plugins',
    description: 'Installed & updates',
    icon: PlugSolidIcon,
    defaultSize: 4,
    tint: 'mint',
    render: PluginsWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'media',
    ownerId: 'core',
    name: 'Media',
    description: 'Files & thumbnails',
    icon: ImageSolidIcon,
    defaultSize: 3,
    tint: 'peach',
    render: MediaWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'status',
    ownerId: 'core',
    name: 'Site status',
    description: 'Uptime, builds, backups',
    icon: ZapSolidIcon,
    defaultSize: 3,
    tint: 'mint',
    render: StatusWidget,
  })

  dashboardWidgetRegistry.register({
    id: 'domain',
    ownerId: 'core',
    name: 'Domain',
    description: 'DNS + SSL status',
    icon: GlobeSolidIcon,
    defaultSize: 3,
    tint: 'sky',
    render: DomainWidget,
  })
}
