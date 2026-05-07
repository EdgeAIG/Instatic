/**
 * PublishingSection — self-hosted CMS publishing details.
 */
import { useEditorStore } from '@core/editor-store/store'
import { resolveFrameworkPreferences } from '@core/framework/preferences'
import { Switch } from '@ui/components/Switch'
import s from '../Settings.module.css'

export function PublishingSection() {
  const site = useEditorStore((state) => state.site)
  const updateFrameworkPreferences = useEditorStore((state) => state.updateFrameworkPreferences)

  if (!site) {
    return <div className={s.noSite}>Loading site...</div>
  }

  const frameworkPreferences = resolveFrameworkPreferences(site.settings.framework?.preferences)
  const treeShakeId = 'publishing-tree-shake-framework-utilities'

  return (
    <div>
      <h3 className={s.sectionHeading}>Publishing</h3>
      <p className={s.sectionDescription}>
        Published pages are served by this self-hosted CMS.
      </p>

      <section aria-labelledby="pub-runtime-heading" className={s.sectionBlock}>
        <h4 id="pub-runtime-heading" className={s.subHeading}>
          Runtime
        </h4>

        <dl className={s.pubRuntimeList}>
          <div>
            <dt>Site</dt>
            <dd>/</dd>
          </div>
          <div>
            <dt>Admin</dt>
            <dd>/admin</dd>
          </div>
          <div>
            <dt>Draft source</dt>
            <dd>Database</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="pub-framework-heading" className={s.sectionBlock}>
        <h4 id="pub-framework-heading" className={s.subHeading}>
          Framework CSS
        </h4>

        <div className={s.toggleRow}>
          <div className={s.toggleRowContent}>
            <label htmlFor={treeShakeId} className={s.toggleRowLabel}>
              Tree-shake generated framework utilities
            </label>
            <p className={s.toggleRowDesc}>
              Emit only generated color, typography, and spacing utility classes used in the page
              and component trees. Turn this off when custom runtime code references generated
              utilities outside the editor tree.
            </p>
          </div>
          <Switch
            id={treeShakeId}
            checked={frameworkPreferences.treeShakeGeneratedFrameworkUtilities}
            onCheckedChange={(value) =>
              updateFrameworkPreferences({ treeShakeGeneratedFrameworkUtilities: value })
            }
          />
        </div>
      </section>
    </div>
  )
}
