/**
 * ConversationHistory — popover triggered by the chat-history button in
 * the AgentPanel header. Lists this user's site-scope conversations and
 * exposes load, delete, and "+ New" actions.
 *
 * Built on the shared `ContextMenu` primitive so positioning, dismiss
 * handling, and styling match the rest of the admin.
 */

import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from '@admin/ai/useAgentStore'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@ui/components/ContextMenu'
import { BulletlistSolidIcon } from 'pixel-art-icons/icons/bulletlist-solid'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import styles from './AgentPanel.module.css'

export function ConversationHistory() {
  const conversations = useAgentStore((s) => s.agentConversations)
  const activeId = useAgentStore((s) => s.agentConversationId)
  const loadAgentConversations = useAgentStore((s) => s.loadAgentConversations)
  const loadAgentConversation = useAgentStore((s) => s.loadAgentConversation)
  const startNewAgentConversation = useAgentStore((s) => s.startNewAgentConversation)
  const deleteAgentConversation = useAgentStore((s) => s.deleteAgentConversation)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  // Refresh the list every time the popover opens. Cheap query.
  useEffect(() => {
    if (!open) return
    void loadAgentConversations()
  }, [open, loadAgentConversations])

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="xs"
        iconOnly
        onClick={() => setOpen((v) => !v)}
        tooltip="Chat history"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation history"
      >
        <BulletlistSolidIcon size={14} />
      </Button>
      {open && (
        <ContextMenu
          anchorRef={triggerRef}
          triggerRef={triggerRef}
          align="start"
          side="auto"
          offset={6}
          minWidth={260}
          maxHeight={360}
          ariaLabel="Conversation history"
          onClose={() => setOpen(false)}
        >
          <ContextMenuItem
            onClick={() => {
              startNewAgentConversation()
              setOpen(false)
            }}
          >
            <PlusIcon size={12} aria-hidden="true" />
            <span>New chat</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          {conversations.length === 0 ? (
            <ContextMenuItem disabled>
              <span>No chats yet.</span>
            </ContextMenuItem>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeId
              return (
                <ContextMenuItem
                  key={conv.id}
                  role="menuitemradio"
                  aria-checked={isActive}
                  active={isActive}
                  onClick={() => {
                    if (!isActive) void loadAgentConversation(conv.id)
                    setOpen(false)
                  }}
                >
                  <span className={styles.historyItemTitle}>{conv.title}</span>
                  <span className={styles.historyItemMeta}>
                    <span className={styles.historyItemTime}>
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                    {/* Span (not a native button) so it doesn't nest inside the
                        ContextMenuItem's Button — nested interactive
                        elements are invalid HTML + would trip BTN-3. */}
                    <span
                      role="button"
                      tabIndex={0}
                      className={styles.historyItemDelete}
                      aria-label={`Delete chat "${conv.title}"`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteAgentConversation(conv.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          void deleteAgentConversation(conv.id)
                        }
                      }}
                    >
                      <TrashSolidIcon size={12} aria-hidden="true" />
                    </span>
                  </span>
                </ContextMenuItem>
              )
            })
          )}
        </ContextMenu>
      )}
    </>
  )
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString()
}
