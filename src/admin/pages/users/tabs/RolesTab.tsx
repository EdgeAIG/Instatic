/**
 * Users → Roles tab.
 *
 * Lists every CMS role (system + custom) with capability count, type and an
 * action menu. System roles are immutable from the UI: only the View action
 * is available; Edit and Delete are hidden.
 *
 * Capability picking is grouped (`CAPABILITY_GROUPS`) with per-group
 * "All" / "Clear" shortcuts. The role form supports a `'view'` mode that
 * renders every input as `disabled` so admins can audit a role's
 * capabilities without entering edit mode.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { consumePendingAction } from '@admin/spotlight/pendingAction'
import { Button } from '@ui/components/Button'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@ui/components/DataTable'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import { EditSolidIcon } from 'pixel-art-icons/icons/edit-solid'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import {
  createCmsRole,
  deleteCmsRole,
  updateCmsRole,
  type CmsRole,
} from '@core/persistence'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import { Badge } from '../components/Badge'
import { RowActionMenu } from '../components/RowActionMenu'
import { RoleDialog } from '../components/RoleDialog'
import { formatCapabilitySummary } from '../utils/format'
import {
  emptyRoleForm,
  type CapabilityGroup,
  type RoleDialogMode,
  type RoleFormState,
  type RowActionMenuItem,
} from '../types'
import type { UsersPageData } from '../hooks/useUsersPageData'
import styles from '../UsersPage.module.css'

interface RolesTabProps {
  data: UsersPageData
  canManageRoles: boolean
}

export function RolesTab({ data, canManageRoles }: RolesTabProps) {
  const { roles, setRoles, setError, refresh, error } = data
  const { runStepUp } = useStepUp()
  const [busy, setBusy] = useState(false)
  const [roleForm, setRoleForm] = useState<RoleFormState>(emptyRoleForm)
  const [dialogMode, setDialogMode] = useState<RoleDialogMode | null>(null)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)

  function closeDialog() {
    setDialogMode(null)
    setEditingRoleId(null)
    setRoleForm(emptyRoleForm)
  }

  function openCreate() {
    if (!canManageRoles) return
    setRoleForm(emptyRoleForm)
    setEditingRoleId(null)
    setDialogMode('create')
    setError(null)
  }

  // Auto-open the create-role dialog when the spotlight queued a
  // `users.newRole` action while the user was on a different workspace.
  // Guard on canManageRoles so we don't swallow the queued action on the
  // first render before capabilities are known. See UsersTab for why we
  // use queueMicrotask rather than setTimeout(0).
  useEffect(() => {
    if (!canManageRoles) return
    const pending = consumePendingAction('users.newRole')
    if (!pending) return
    queueMicrotask(() => openCreate())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageRoles])

  function openView(role: CmsRole) {
    if (!canManageRoles) return
    setEditingRoleId(role.id)
    setRoleForm({
      name: role.name,
      slug: role.slug,
      description: role.description,
      capabilities: role.capabilities,
    })
    setDialogMode('view')
    setError(null)
  }

  function openEdit(role: CmsRole) {
    // Owner is the only role whose capabilities are managed by the server
    // (synced from `CORE_CAPABILITIES` at boot). Every other role — including
    // the built-in `admin`, `client`, `member` — is editable by anyone with
    // `roles.manage`. System roles still can't be *deleted* (see `remove`).
    if (!canManageRoles || role.slug === 'owner') return
    setEditingRoleId(role.id)
    setRoleForm({
      name: role.name,
      slug: role.slug,
      description: role.description,
      capabilities: role.capabilities,
    })
    setDialogMode('edit')
    setError(null)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageRoles || !dialogMode) return
    setBusy(true)
    setError(null)
    try {
      const role = dialogMode === 'edit' && editingRoleId
        ? await runStepUp(() => updateCmsRole(editingRoleId, roleForm))
        : await runStepUp(() => createCmsRole(roleForm))
      setRoles((current) => {
        const exists = current.some((candidate) => candidate.id === role.id)
        return exists
          ? current.map((candidate) => candidate.id === role.id ? role : candidate)
          : [...current, role]
      })
      closeDialog()
      void refresh()
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      setError(err instanceof Error ? err.message : 'Could not save role')
    } finally {
      setBusy(false)
    }
  }

  async function remove(role: CmsRole) {
    // System roles are never deletable — only their content (name, caps) can
    // be edited. Custom roles can be deleted when no users reference them
    // (server-side enforced).
    if (!canManageRoles || role.isSystem) return
    setBusy(true)
    setError(null)
    try {
      await runStepUp(() => deleteCmsRole(role.id))
      setRoles((current) => current.filter((candidate) => candidate.id !== role.id))
      void refresh()
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      setError(err instanceof Error ? err.message : 'Could not delete role')
    } finally {
      setBusy(false)
    }
  }

  function toggleCapability(capability: string, checked: boolean) {
    setRoleForm((current) => ({
      ...current,
      capabilities: checked
        ? [...new Set([...current.capabilities, capability])]
        : current.capabilities.filter((item) => item !== capability),
    }))
  }

  function setCapabilityGroup(group: CapabilityGroup, checked: boolean) {
    setRoleForm((current) => {
      const next = new Set(current.capabilities)
      for (const capability of group.capabilities) {
        if (checked) next.add(capability)
        else next.delete(capability)
      }
      return { ...current, capabilities: [...next] }
    })
  }

  return (
    <section className={styles.section} aria-labelledby="roles-list-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="roles-list-title">Roles</h2>
          <p>System roles are fixed. Custom roles can be edited.</p>
        </div>
        {canManageRoles && (
          <Button type="button" variant="primary" size="sm" onClick={openCreate}>
            <PlusIcon size={14} aria-hidden="true" />
            <span>Create Role</span>
          </Button>
        )}
      </div>
      {roles.length > 0 ? (
        <DataTable aria-label="Roles" density="compact">
          <DataTableHead>
            <DataTableRow>
              <DataTableHeader scope="col">Role</DataTableHeader>
              <DataTableHeader scope="col">Description</DataTableHeader>
              <DataTableHeader scope="col">Capabilities</DataTableHeader>
              <DataTableHeader scope="col">Type</DataTableHeader>
              <DataTableHeader scope="col" className={styles.actionsHeader}>Actions</DataTableHeader>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {roles.map((role) => (
              <DataTableRow key={role.id} aria-label={`Role ${role.name}`}>
                <DataTableCell>
                  <strong className={styles.tableTitle}>{role.name}</strong>
                </DataTableCell>
                <DataTableCell>
                  <span className={styles.secondaryText}>{role.description || 'No description'}</span>
                </DataTableCell>
                <DataTableCell>
                  {role.capabilities.length > 0 ? (
                    <span className={styles.secondaryText}>{formatCapabilitySummary(role.capabilities)}</span>
                  ) : (
                    <Badge label="No admin capabilities" muted />
                  )}
                </DataTableCell>
                <DataTableCell>
                  <div className={styles.badges}>
                    <Badge label={role.isSystem ? 'System role' : 'Custom role'} muted={role.isSystem} />
                  </div>
                </DataTableCell>
                <DataTableCell className={styles.actionsCell}>
                  {canManageRoles && (
                    <RowActionMenu
                      triggerLabel={`Actions for ${role.name}`}
                      menuLabel={`Role actions for ${role.name}`}
                      disabled={busy}
                      items={[
                        {
                          label: 'View',
                          icon: <EyeSolidIcon size={12} aria-hidden="true" />,
                          onSelect: () => openView(role),
                        },
                        // Owner is locked entirely (capabilities are managed
                        // by the server). Other system roles can be edited
                        // but not deleted — they're part of the installation's
                        // expected role registry. Custom roles can be edited
                        // and deleted.
                        ...(role.slug !== 'owner'
                          ? [
                              {
                                label: 'Edit',
                                icon: <EditSolidIcon size={12} aria-hidden="true" />,
                                onSelect: () => openEdit(role),
                              },
                              ...(!role.isSystem
                                ? [{
                                    label: 'Delete',
                                    icon: <TrashSolidIcon size={12} aria-hidden="true" />,
                                    danger: true,
                                    onSelect: () => void remove(role),
                                  }] satisfies RowActionMenuItem[]
                                : []),
                            ] satisfies RowActionMenuItem[]
                          : []),
                      ]}
                    />
                  )}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      ) : (
        <p className={styles.emptyState}>No roles configured.</p>
      )}

      {canManageRoles && dialogMode && (
        <RoleDialog
          mode={dialogMode}
          form={roleForm}
          busy={busy}
          error={error}
          onChange={setRoleForm}
          onClose={closeDialog}
          onSubmit={handleSave}
          onToggleCapability={toggleCapability}
          onSetCapabilityGroup={setCapabilityGroup}
        />
      )}
    </section>
  )
}
