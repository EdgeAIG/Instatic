import { type ReactNode, type SyntheticEvent } from "react";
import { registry } from "@core/module-engine";
import type { VisualComponent } from "@core/visualComponents";
import { useInsertModule } from "@site/hooks/useInsertModule";
import { useInsertPreset } from "@site/hooks/useInsertPreset";
import {
  DEFAULT_MODULE_INSERTER_FAVORITES,
  buildModuleInserterItems,
  resolveInserterRefs,
  type ModuleInserterItem,
} from "@site/module-picker/moduleInserterModel";
import { LAYOUT_PRESETS } from "@site/module-picker";
import { useModuleInserterPreference } from "@site/module-picker/useModuleInserterPreference";
import { resolveInsertLocation } from "@site/store/insertLocation";
import { selectActiveCanvasPage, useEditorStore } from "@site/store/store";
import { ModulePickerDropdown } from "@site/toolbar/ModulePickerDropdown";
import { ModuleIcon } from "@site/ui/ModuleIcon";
import type { IconComponent } from "pixel-art-icons/types";
import { BracesIcon } from "pixel-art-icons/icons/braces";
import { LayoutSolidIcon } from "pixel-art-icons/icons/layout-solid";
import { Button } from "@ui/components/Button";
import { UndoRedoButtons } from "./UndoRedoButtons";
import styles from "./CanvasNotch.module.css";

const ADD_TRIGGER_TEST_ID = "canvas-notch-add-btn";
const EMPTY_COMPONENTS: VisualComponent[] = [];

/**
 * Notch action — supplies either a `moduleId` (icon resolved through the
 * module registry via `ModuleIcon`) or a literal `icon` component. Module
 * actions should always pass `moduleId` so the icon stays in sync with the
 * module declaration; ad-hoc actions (e.g. content-document blocks) supply
 * `icon` directly.
 */
export type CanvasNotchAction = {
  id: string;
  label: string;
  onClick: () => void;
} & (
  | { moduleId: string; icon?: never }
  | { icon: IconComponent; moduleId?: never }
);

interface CanvasNotchProps {
  actions?: CanvasNotchAction[];
  addControl?: ReactNode;
  floatingControl?: ReactNode;
  /**
   * Show the Undo/Redo group on the left side of the notch.
   * Defaults to true. Disable for canvases that don't drive the editor
   * page tree (e.g. the content document canvas, which has its own
   * draft-management lifecycle).
   */
  showHistoryControls?: boolean;
}

export function CanvasNotch({
  actions,
  addControl,
  floatingControl,
  showHistoryControls = true,
}: CanvasNotchProps = {}) {
  return (
    <div
      className={styles.shell}
      aria-label="Insert modules"
      data-testid="canvas-notch"
      onClick={stopCanvasInteraction}
    >
      <div className={styles.notch}>
        {showHistoryControls && (
          <>
            <UndoRedoButtons />
            <div aria-hidden="true" className={styles.divider} />
          </>
        )}

        {actions
          ? actions.map((action) => renderActionButton(action))
          : <FavoriteNotchActions />}

        {addControl ?? (
          <ModulePickerDropdown
            triggerClassName={styles.addButton}
            triggerTestId={ADD_TRIGGER_TEST_ID}
          />
        )}
      </div>
      {floatingControl && (
        <div className={styles.floatingControl}>
          {floatingControl}
        </div>
      )}
    </div>
  );
}

function stopCanvasInteraction(event: SyntheticEvent) {
  event.stopPropagation();
}

function FavoriteNotchActions() {
  const insertModule = useInsertModule();
  const insertPreset = useInsertPreset();
  const favorites = useModuleInserterPreference().favorites;
  const activeDocument = useEditorStore((s) => s.activeDocument);
  const visualComponents = useEditorStore((s) => s.site?.visualComponents ?? EMPTY_COMPONENTS);
  const canvasPage = useEditorStore(selectActiveCanvasPage);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const insertComponentRef = useEditorStore((s) => s.insertComponentRef);

  const isVCMode = activeDocument?.kind === "visualComponent";
  const { allInsertableItems } = buildModuleInserterItems({
    modules: registry.list(),
    isVCMode,
    layoutPresets: LAYOUT_PRESETS,
    visualComponents,
  });
  const resolvedFavorites = resolveInserterRefs(favorites, allInsertableItems);
  const favoriteItems =
    favorites.length > 0 && resolvedFavorites.length === 0
      ? resolveInserterRefs(DEFAULT_MODULE_INSERTER_FAVORITES, allInsertableItems)
      : resolvedFavorites;

  function insertComponent(componentId: string) {
    if (!canvasPage) return;
    const location = resolveInsertLocation(
      canvasPage,
      selectedNodeId ?? canvasPage.rootNodeId,
    );
    if (!location) return;
    insertComponentRef(location.parentId, componentId, location.index);
  }

  return (
    <>
      {favoriteItems.map((item) => {
        const action = actionForItem(item, {
          insertModule,
          insertPreset,
          insertComponent,
        });
        if (!action) return null;
        return renderActionButton(action);
      })}
    </>
  );
}

function actionForItem(
  item: ModuleInserterItem,
  handlers: {
    insertModule: ReturnType<typeof useInsertModule>;
    insertPreset: ReturnType<typeof useInsertPreset>;
    insertComponent: (componentId: string) => void;
  },
): CanvasNotchAction | null {
  if (item.kind === "module") {
    return {
      id: item.key,
      label: item.name,
      moduleId: item.id,
      onClick: () => handlers.insertModule(item.module),
    };
  }
  if (item.kind === "layout") {
    return {
      id: item.key,
      label: item.name,
      icon: LayoutSolidIcon,
      onClick: () => handlers.insertPreset(item.preset),
    };
  }
  if (item.kind === "component") {
    return {
      id: item.key,
      label: item.name,
      icon: BracesIcon,
      onClick: () => handlers.insertComponent(item.id),
    };
  }
  return null;
}

function renderActionButton(action: CanvasNotchAction) {
  const ActionIcon = action.icon;
  return (
    <Button
      key={action.id}
      variant="ghost"
      size="sm"
      iconOnly
      className={styles.quickButton}
      onClick={action.onClick}
      aria-label={`Add ${action.label}`}
      tooltip={`Add ${action.label}`}
      data-testid={`canvas-notch-${testIdPart(action.label)}-btn`}
    >
      {ActionIcon ? (
        <ActionIcon size={14} aria-hidden="true" />
      ) : (
        <ModuleIcon
          moduleId={action.moduleId}
          size={14}
          aria-hidden="true"
        />
      )}
    </Button>
  );
}

function testIdPart(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
