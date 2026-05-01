import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { AnyModuleDefinition } from '../../../core/module-engine/types'
import { createModuleImportMap } from '../../../core/module-engine/runtimeResolver'
import type { SiteDocument } from '../../../core/page-tree/types'
import { useEditorStore } from '../../../core/editor-store/store'
import { cn } from '../../../ui/cn'
import { generateClassCSS } from '../../../core/publisher/classCss'
import {
  createSandboxSrcDoc,
  HOST_MESSAGE_SOURCE,
  SANDBOX_MESSAGE_SOURCE,
  type SandboxContext,
} from './moduleSandboxSrcDoc'
import styles from './ModuleSandboxFrame.module.css'

interface ModuleSandboxFrameProps {
  moduleDefinition: AnyModuleDefinition
  props: Record<string, unknown>
  nodeId: string
  isSelected: boolean
  mcClassName?: string
  classIds?: string[]
}

interface SandboxUpdatePayload {
  context: SandboxContext
  classCSS: string
}

function getNodeClassCSS(site: SiteDocument | null, classIds: string[] | undefined): string {
  if (!site || !classIds?.length) return ''

  const classes: SiteDocument['classes'] = {}
  for (const id of classIds) {
    const cls = site.classes[id]
    if (cls) classes[id] = cls
  }

  if (Object.keys(classes).length === 0) return ''
  return generateClassCSS(classes, site.breakpoints)
}

export function ModuleSandboxFrame({
  moduleDefinition,
  props,
  nodeId,
  isSelected,
  mcClassName,
  classIds,
}: ModuleSandboxFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const updateFrameRef = useRef<number | null>(null)
  const pendingUpdateRef = useRef<SandboxUpdatePayload | null>(null)
  const site = useEditorStore((s) => s.site)
  const packageJson = useEditorStore((s) => s.packageJson)
  const selectNode = useEditorStore((s) => s.selectNode)
  const setFocusedPanel = useEditorStore((s) => s.setFocusedPanel)
  const runtime = moduleDefinition.editorRuntime?.sandbox

  const classCSS = useMemo(
    () => getNodeClassCSS(site, classIds),
    [site, classIds],
  )

  const importMap = useMemo(
    () => createModuleImportMap(moduleDefinition, { packageJson, strictSiteManifest: true }),
    [moduleDefinition, packageJson],
  )

  const sandboxContext = useMemo<SandboxContext>(
    () => ({
      props,
      nodeId,
      isSelected,
      className: mcClassName ?? '',
      dependencies: importMap.imports,
      apiVersion: 1,
    }),
    [props, nodeId, isSelected, mcClassName, importMap],
  )

  const srcDoc = useMemo(() => {
    if (!runtime) return ''

    return createSandboxSrcDoc({
      title: `${moduleDefinition.name} preview`,
      source: runtime.source,
      importMap,
      context: sandboxContext,
      classCSS,
    })
    // The iframe document must stay mounted while props/class styles change.
    // Those values are delivered by postMessage below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, moduleDefinition.name, importMap, sandboxContext.nodeId])

  const flushUpdate = useCallback(() => {
    const payload = pendingUpdateRef.current
    if (!payload) return

    pendingUpdateRef.current = null
    iframeRef.current?.contentWindow?.postMessage({
      source: HOST_MESSAGE_SOURCE,
      type: 'update',
      context: payload.context,
      classCSS: payload.classCSS,
    }, '*')
  }, [])

  const scheduleUpdate = useCallback(() => {
    pendingUpdateRef.current = { context: sandboxContext, classCSS }
    if (updateFrameRef.current !== null) return

    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null
      flushUpdate()
    })
  }, [sandboxContext, classCSS, flushUpdate])

  const postUpdate = useCallback(() => {
    pendingUpdateRef.current = { context: sandboxContext, classCSS }
    if (updateFrameRef.current !== null) {
      window.cancelAnimationFrame(updateFrameRef.current)
      updateFrameRef.current = null
    }
    flushUpdate()
  }, [sandboxContext, classCSS, flushUpdate])

  useEffect(() => {
    scheduleUpdate()
  }, [scheduleUpdate])

  useEffect(() => () => {
    if (updateFrameRef.current !== null) {
      window.cancelAnimationFrame(updateFrameRef.current)
      updateFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return

      const message = event.data as { source?: string; type?: string; nodeId?: string } | null
      if (!message || message.source !== SANDBOX_MESSAGE_SOURCE || message.nodeId !== nodeId) return

      if (message.type === 'pointerdown' || message.type === 'dblclick') {
        selectNode(nodeId)
        setFocusedPanel('canvas')
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [nodeId, selectNode, setFocusedPanel])

  if (!runtime) {
    return (
      <div className={styles.fallback}>
        Missing sandbox runtime for {moduleDefinition.name}
      </div>
    )
  }

  return (
    <div
      className={cn(styles.frame, mcClassName)}
      style={{ '--module-sandbox-min-height': `${runtime.minHeight ?? 360}px` } as CSSProperties}
    >
      <iframe
        ref={iframeRef}
        title={`${moduleDefinition.name} sandbox preview`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={postUpdate}
        className={styles.iframe}
      />
    </div>
  )
}
