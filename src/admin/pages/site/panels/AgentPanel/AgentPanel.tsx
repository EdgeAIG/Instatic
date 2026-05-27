/**
 * AgentPanel — self-contained floating AI assistant panel (Guideline #410).
 *
 * This component renders its own floating overlay container — positioned at
 * bottom-right of the canvas area. Visibility is controlled by `isAgentOpen`
 * in the agentSlice. Always-mounted (CSS display:none when closed) to preserve
 * Zustand conversation state across open/close cycles.
 *
 * Auth model (standalone editor):
 * - Agent calls `/admin/api/agent` which Vite proxies to the local Bun server.
 * - The Bun server runs the Claude Agent SDK with ambient Claude Code credentials.
 * - No API key, no configuration, no endpoint required (Constraint #385).
 *
 * Accessibility (WCAG 2.1 AA):
 * - role="complementary" + aria-label="AI Assistant" on the panel landmark
 * - role="log" + aria-live="polite" on the message thread
 * - role="alert" for error messages
 * - role="status" for tool call status badges
 * - keyboard: Escape closes the panel
 *
 * @see Guideline #410 — 3 Self-Contained Independent Panels
 * @see Constraint #385 — Standalone Editor: ambient Claude Code credentials
 */

import { useRef, useEffect, useCallback, memo, useMemo } from 'react'
import { useAgentStore } from '@admin/ai/useAgentStore'
import { renderMarkdownToHtml } from '@site/agent/markdown'
import type { AgentMessage, AgentToolCall } from '@site/agent/types'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import { SquareSolidIcon } from 'pixel-art-icons/icons/square-solid'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import { CheckIcon } from 'pixel-art-icons/icons/check'
import { CircleAlertSolidIcon } from 'pixel-art-icons/icons/circle-alert-solid'
import { AiBoxSolidIcon } from 'pixel-art-icons/icons/ai-box-solid'
import { PanelHeader } from '@admin/shared/PanelHeader'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import { Textarea } from '@ui/components/Input'
import { useDraggablePanel } from '@site/hooks/useDraggablePanel'
import { cn } from '@ui/cn'
import { NoCredentialBanner } from './NoCredentialBanner'
import { ModelPicker } from './ModelPicker'
import { ConversationHistory } from './ConversationHistory'
import styles from './AgentPanel.module.css'

const PANEL_WIDTH = 320
const PANEL_HEIGHT = 480
type PanelVariant = 'floating' | 'docked'

// ---------------------------------------------------------------------------
// AgentPanel
// ---------------------------------------------------------------------------

/**
 * AgentPanel — all store subscriptions, refs, effects, and render logic.
 *
 * Always-mounted by EditorLayout — visibility is controlled via CSS display:none
 * (`.floatPanelClosed`) to preserve Zustand conversation state across open/close cycles.
 * Agent routes via Vite proxy `/admin/api/agent` → local Bun server → Claude SDK.
 */
export const AgentPanel = memo(function AgentPanel({ variant = 'floating' }: { variant?: PanelVariant }) {
  const isOpen = useAgentStore((s) => s.isAgentOpen)
  const isStreaming = useAgentStore((s) => s.isAgentStreaming)
  const messages = useAgentStore((s) => s.agentMessages)
  const agentError = useAgentStore((s) => s.agentError)
  const closeAgent = useAgentStore((s) => s.closeAgent)
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage)
  const abortAgent = useAgentStore((s) => s.abortAgent)
  const clearAgentMessages = useAgentStore((s) => s.clearAgentMessages)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  // ── Draggable panel position ───────────────────────────────────────────────
  // Default to bottom-right corner.
  const { panelRef, headerDragProps, panelPositionStyle } = useDraggablePanel(
    'agent',
    () => ({
      x: typeof window !== 'undefined' ? window.innerWidth - PANEL_WIDTH - 16 : 16,
      y: typeof window !== 'undefined'
        ? window.innerHeight - PANEL_HEIGHT - 16
        : 200,
    }),
  )

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Focus input when panel becomes active (isOpen transitions to true).
  // The 50ms delay lets the panel's open transition settle before we steal
  // focus; cleanup cancels the pending focus if the panel closes again
  // (or the component unmounts) before the timer fires.
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  // Escape key — close the AI panel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault()
        closeAgent()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, closeAgent])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const input = inputRef.current
      if (!input) return
      const content = input.value.trim()
      if (!content || isStreaming) return
      input.value = ''
      input.style.height = 'auto'
      await sendAgentMessage(content)
    },
    [isStreaming, sendAgentMessage],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit(e as unknown as React.FormEvent)
      }
    },
    [handleSubmit],
  )

  // Always-mounted: CSS display:none when closed (via .floatPanelClosed) preserves
  // Zustand state across open/close cycles without conditional rendering.
  return (
    <aside
      ref={panelRef as React.RefObject<HTMLElement>}
      role="complementary"
      aria-label="AI Assistant"
      data-panel=""
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      // Panel position is drag-driven — CSS var injection from useDraggablePanel
      style={variant === 'floating' ? panelPositionStyle : undefined}
      className={cn(
        styles.floatPanel,
        variant === 'docked' && styles.floatPanelDocked,
        !isOpen && styles.floatPanelClosed,
      )}
    >
    <div
      data-testid="agent-panel"
      className={styles.panel}
    >
      {/* ── Shared Panel Header — drag handle + close + clear actions ──────── */}
      <PanelHeader
        panelId="agent"
        title="AI Assistant"
        onClose={closeAgent}
        dragHandleProps={variant === 'floating' ? headerDragProps : undefined}
      >
        {/* History popover — list past chats, start a new one, delete. */}
        <ConversationHistory />
        {/* "Clear conversation" — shown when there are messages */}
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            onClick={clearAgentMessages}
            tooltip="Clear conversation"
            aria-label="Clear conversation"
          >
            <TrashSolidIcon size={14} />
          </Button>
        )}
        {isStreaming && (
          <span className={styles.streamingBadge}>
            <span className={styles.streamingDot} aria-hidden="true" />
            Working…
          </span>
        )}
      </PanelHeader>

      {/* ── Message thread ──────────────────────────────────────────────────── */}
      <div
        ref={threadRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions text"
        aria-label="Conversation"
        aria-busy={isStreaming}
        className={styles.thread}
      >
        {/* No-provider banner with deep-link to /admin/ai (shown above the
            thread so the user always sees how to fix it). */}
        {agentError?.startsWith('No AI provider configured') && (
          <NoCredentialBanner message={agentError} />
        )}

        {messages.length === 0 ? (
          <AgentEmptyState />
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}

        {/* Generic error banner — only show when it's NOT the dedicated
            no-credential message (which renders via NoCredentialBanner above). */}
        {agentError && !agentError.startsWith('No AI provider configured') && (
          <div role="alert" className={styles.errorBanner}>
            {agentError}
          </div>
        )}
      </div>

      {/* ── Input bar ───────────────────────────────────────────────────────── */}
      <div className={styles.inputBar}>
        {/* Model picker lives here (instead of the header) so it stays
            close to the message input — the typical "what should I send
            this with" decision point. */}
        <div className={styles.inputBarMeta}>
          <ModelPicker />
        </div>
        {isStreaming ? (
          <Button
            variant="destructive"
            size="md"
            onClick={abortAgent}
            fullWidth
          >
            <SquareSolidIcon size={12} /> Stop
          </Button>
        ) : (
          <form onSubmit={handleSubmit} className={styles.inputForm}>
            <Textarea
              ref={inputRef}
              placeholder="Tell me what to build… (Enter to send)"
              aria-label="Message to AI assistant"
              rows={2}
              resize="none"
              onKeyDown={handleKeyDown}
              onChange={(e) => {
                // Auto-grow textarea
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
              }}
            />
            <Button variant="primary" size="sm" type="submit">
              Send
            </Button>
          </form>
        )}
      </div>
    </div>
    </aside>
  )
})

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  msg: AgentMessage
}

const MessageBubble = memo(function MessageBubble({ msg }: MessageBubbleProps) {
  const isUser = msg.role === 'user'

  return (
    <div className={cn(styles.messageBubble, isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant)}>
      {/* Role label */}
      <div className={styles.roleLabel}>
        {isUser ? 'You' : 'Assistant'}
      </div>

      {/* Chronological blocks — text and tool calls render in the order
          Claude actually emitted them, so a "text → tool → text" sequence
          shows two separate text bubbles around the tool badges. Text is
          rendered as markdown (bold, lists, inline code, links, …) via a
          DOMPurify-sanitised HTML pipeline. */}
      {msg.blocks.map((block, index) =>
        block.kind === 'text' ? (
          <MarkdownTextBubble
            // Stable key per text block: text deltas append in place, so each
            // run of text gets its position-based key.
            key={`text-${index}`}
            text={block.text}
            isUser={isUser}
          />
        ) : (
          <div key={block.toolCall.id} className={styles.toolCallsContainer}>
            <ToolCallBadge toolCall={block.toolCall} />
          </div>
        ),
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// MarkdownTextBubble — parses + sanitises the block text and injects it via
// dangerouslySetInnerHTML. Memoised render so streaming deltas don't re-parse
// markdown for unchanged blocks.
// ---------------------------------------------------------------------------

interface MarkdownTextBubbleProps {
  text: string
  isUser: boolean
}

const MarkdownTextBubble = memo(function MarkdownTextBubble({
  text,
  isUser,
}: MarkdownTextBubbleProps) {
  const html = useMemo(() => renderMarkdownToHtml(text), [text])
  // Empty/whitespace-only blocks don't render at all (avoids stray bubbles
  // around stripped-out tool blocks during streaming).
  if (!html) return null
  return (
    <div
      className={cn(
        styles.contentBubble,
        isUser ? styles.contentBubbleUser : styles.contentBubbleAssistant,
        styles.markdownBubble,
      )}
      // Safe: sanitised by DOMPurify (via sanitizeRichtext) before reaching here.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

// ---------------------------------------------------------------------------
// ToolCallBadge
// ---------------------------------------------------------------------------

function ToolCallBadge({ toolCall }: { toolCall: AgentToolCall }) {
  const isPending = toolCall.status === 'pending'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error'

  const iconClass = isPending
    ? styles.toolCallIconPending
    : isSuccess
    ? styles.toolCallIconSuccess
    : styles.toolCallIconFailed
  const displayType = formatToolCallType(toolCall.actionType)
  const label = formatActionLabel(toolCall.actionType, toolCall.params)
  const statusLabel = isPending
    ? `Running ${displayType}${label ? ` — ${label}` : ''}`
    : isSuccess
    ? `Completed ${displayType}${label ? ` — ${label}` : ''}`
    : `Failed ${displayType}${label ? ` — ${label}` : ''}`

  // Surface the tool's error message directly in the badge stream so the
  // user sees WHY a tool failed without having to dig through devtools. The
  // toolResult handler in agentSlice.ts already populates `result.error`.
  const errorMessage = isError ? toolCall.result?.error ?? 'Tool call failed.' : null

  return (
    <>
      <div
        role="status"
        aria-label={statusLabel}
        className={styles.toolCallBadge}
      >
        <span className={iconClass} aria-hidden="true">
          {isPending ? (
            <LoaderIcon size={10} />
          ) : isSuccess ? (
            <CheckIcon size={10} />
          ) : (
            <CircleAlertSolidIcon size={10} />
          )}
        </span>
        <span className={styles.toolCallType} aria-hidden="true">
          {displayType}
        </span>
        <span aria-hidden="true">{label}</span>
      </div>
      {errorMessage && (
        <p
          role="alert"
          // Tone-aligned with `.errorBanner` (red text on muted background)
          // but inline + compact so a string of failed tool calls stays
          // readable.
          className={styles.toolCallError}
        >
          {errorMessage}
        </p>
      )}
    </>
  )
}

function formatToolCallType(actionType: string): string {
  return actionType.replace(/^mcp__page_builder__/, '')
}

function formatActionLabel(actionType: string, params: unknown): string {
  const p = params as Record<string, unknown>
  switch (actionType) {
    case 'insertNode': return `${String(p.moduleId ?? '')}`
    case 'deleteNode': return `node ${String(p.nodeId ?? '').slice(0, 6)}…`
    case 'updateNodeProps': return `node ${String(p.nodeId ?? '').slice(0, 6)}…`
    case 'moveNode': return `→ ${String(p.newParentId ?? '').slice(0, 6)}…`
    case 'renameNode': return `"${String(p.label ?? '')}"`
    case 'createClass': return `"${String(p.name ?? '')}"`
    case 'updateClassStyles': return `class ${String(p.classId ?? '').slice(0, 6)}…`
    case 'assignClass': return `${String(p.classId ?? '').slice(0, 6)}… → node`
    case 'removeClass': return `${String(p.classId ?? '').slice(0, 6)}… from node`
    case 'addPage': return `"${String(p.title ?? '')}"`
    default: return ''
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function AgentEmptyState() {
  return (
    <EmptyState
      variant="centered"
      icon={<AiBoxSolidIcon size={28} color="var(--editor-text-subtle)" />}
      title="Describe what you want to build and I'll do it for you."
      description={'Try: "Add a hero section with a heading and button"'}
    />
  )
}
