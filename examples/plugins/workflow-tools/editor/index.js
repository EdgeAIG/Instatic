const APPROVALS_CHANGED_EVENT = 'acme.workflow.approvals-changed'

function notifyApprovalsChanged(record) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(APPROVALS_CHANGED_EVENT, {
    detail: { recordId: record?.id },
  }))
}

export function activate(api) {
  api.editor.commands.register({
    id: 'workflow.requestApproval',
    label: 'Request Approval',
    async run() {
      const state = api.editor.store.read()
      const activePageId = state.activePageId || ''
      const activePage = state.site?.pages?.find((page) => page.id === activePageId)
      const pageTitle = activePage?.title || 'Untitled page'
      const today = new Date().toISOString().slice(0, 10)

      const record = await api.cms.storage.collection('approvals').create({
        'page-title': pageTitle,
        'page-id': activePageId,
        status: 'pending',
        reviewer: 'Unassigned',
        notes: 'Created from the editor toolbar.',
        urgent: false,
        'requested-at': today,
      })
      notifyApprovalsChanged(record)

      return {
        message: `Approval request created for ${pageTitle}`,
      }
    },
  })

  api.editor.toolbar.addButton({
    id: 'workflow.requestApprovalButton',
    label: 'Request Approval',
    command: 'workflow.requestApproval',
  })
}
