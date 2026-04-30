import { useCallback, type SyntheticEvent } from 'react'
import { registry } from '@core/module-engine/registry'
import { useInsertModule } from '../../hooks/useInsertModule'
import { ModulePickerDropdown } from '../Toolbar/ModulePickerDropdown'
import { Icon } from '../../../ui/icons/Icon'
import { Button } from '@ui/components/Button'
import styles from './CanvasNotch.module.css'

const QUICK_ACTIONS = [
  { moduleId: 'base.container', label: 'Container', icon: 'checkbox-sharp' },
  { moduleId: 'base.text', label: 'Text', icon: 'type' },
  { moduleId: 'base.image', label: 'Image', icon: 'image' },
  { moduleId: 'base.button', label: 'Button', icon: 'box' },
] as const

const ADD_TRIGGER_TEST_ID = 'canvas-notch-add-btn'

export function CanvasNotch() {
  const insertModule = useInsertModule()

  const stopCanvasInteraction = useCallback((event: SyntheticEvent) => {
    event.stopPropagation()
  }, [])

  const handleQuickInsert = useCallback(
    (moduleId: (typeof QUICK_ACTIONS)[number]['moduleId']) => {
      const mod = registry.get(moduleId)
      if (!mod) return
      insertModule(mod)
    },
    [insertModule],
  )

  return (
    <div
      className={styles.shell}
      aria-label="Insert modules"
      data-testid="canvas-notch"
      onClick={stopCanvasInteraction}
    >
      <div className={styles.notch}>
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.moduleId}
            variant="ghost"
            size="sm"
            iconOnly
            className={styles.quickButton}
            onClick={() => handleQuickInsert(action.moduleId)}
            aria-label={`Add ${action.label}`}
            title={`Add ${action.label}`}
            data-testid={`canvas-notch-${action.label.toLowerCase()}-btn`}
          >
            <Icon name={action.icon} size={14} aria-hidden="true" />
          </Button>
        ))}

        <span className={styles.divider} aria-hidden="true" />

        <ModulePickerDropdown
          triggerClassName={styles.addButton}
          triggerTestId={ADD_TRIGGER_TEST_ID}
        />
      </div>
    </div>
  )
}
