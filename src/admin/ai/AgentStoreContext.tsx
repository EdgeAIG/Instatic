/**
 * AgentStoreContext — host store injection for the AgentPanel components.
 *
 * AgentPanel + ModelPicker + ConversationHistory all need to read agent
 * state and call agent actions. Pre-Phase-4 they hard-coded
 * `useEditorStore` (the site editor's combined Zustand store). To reuse
 * the same components across the content workspace (and later data +
 * plugin), each host wraps its panel mount in `<AgentStoreProvider>` with
 * its own Zustand store API.
 *
 * The provided API must be a Zustand store (from `create()` or
 * `createStore()`) whose state extends `AgentSlice`. The site editor
 * passes `useEditorStore` directly (Zustand's hook IS the store API);
 * the content workspace passes its own standalone agent-store API
 * (built in Slice 3C).
 *
 * Why a context (not an explicit prop): the panel has nested children
 * (ConversationHistory, ModelPicker) that would otherwise need their own
 * prop drilling for the store. Context keeps the existing render shape
 * intact.
 *
 * Hook + type live in `./useAgentStore.ts` (separate file so React-Fast-
 * Refresh's "components-only" rule is satisfied — this file exports a
 * component, the sibling file exports the hook).
 */
import { type ReactNode } from 'react'
import { AgentStoreContext, type AgentStoreApi } from './useAgentStore'

interface AgentStoreProviderProps {
  /**
   * Zustand store API (the value returned by `create<T>()` or
   * `createStore<T>()`). Must include `AgentSlice` in its state shape;
   * the panel only reads through `useAgentStore(selector)` projections.
   */
  store: AgentStoreApi
  children: ReactNode
}

export function AgentStoreProvider({ store, children }: AgentStoreProviderProps) {
  return (
    <AgentStoreContext.Provider value={store}>
      {children}
    </AgentStoreContext.Provider>
  )
}
