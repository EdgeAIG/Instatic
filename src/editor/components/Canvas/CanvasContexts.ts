import { createContext, type MouseEvent } from 'react'
import type { TemplateRenderDataContext } from '../../../core/templates/dynamicBindings'

export interface CanvasSelectionContextValue {
  onNodeClick: (nodeId: string, e: MouseEvent) => void
  onNodeHover: (nodeId: string | null) => void
  onNodeContextMenu: (nodeId: string, e: MouseEvent) => void
  onNodeDoubleClick: (nodeId: string, e: MouseEvent) => void
}

export const CanvasSelectionContext = createContext<CanvasSelectionContextValue>({
  onNodeClick: () => {},
  onNodeHover: () => {},
  onNodeContextMenu: () => {},
  onNodeDoubleClick: () => {},
})

export const CanvasBreakpointContext = createContext<string | undefined>(undefined)
export const CanvasTemplateContext = createContext<TemplateRenderDataContext | undefined>(undefined)
