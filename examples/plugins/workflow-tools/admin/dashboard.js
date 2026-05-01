const APPROVALS_CHANGED_EVENT = 'acme.workflow.approvals-changed'
const cleanups = new WeakMap()

const styles = `
  .workflowPlugin {
    display: grid;
    gap: 16px;
    color: var(--editor-text, #f7f7f5);
  }
  .workflowPlugin__summary,
  .workflowPlugin__stat,
  .workflowPlugin__panel {
    border: 1px solid var(--panel-border, rgba(255,255,255,0.14));
    border-radius: 8px;
    background: var(--editor-surface, #191b1f);
  }
  .workflowPlugin__summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 14px;
  }
  .workflowPlugin__summary span,
  .workflowPlugin__stat span,
  .workflowPlugin__panel label,
  .workflowPlugin__record small,
  .workflowPlugin__meta {
    color: var(--editor-text-muted, #a1a1aa);
    font-size: 11px;
    font-weight: 750;
    text-transform: uppercase;
  }
  .workflowPlugin__summary strong {
    display: block;
    margin-top: 4px;
    font-size: 18px;
    line-height: 1.2;
  }
  .workflowPlugin__summary p {
    margin: 6px 0 0;
    color: var(--editor-text-muted, #a1a1aa);
    font-size: 12px;
    line-height: 1.45;
  }
  .workflowPlugin__capabilities,
  .workflowPlugin__panelToolbar,
  .workflowPlugin__recordActions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .workflowPlugin__capabilities span {
    border: 1px solid var(--panel-border, rgba(255,255,255,0.14));
    border-radius: 999px;
    padding: 4px 8px;
    background: var(--editor-surface-2, #22252b);
    color: var(--editor-text, #f7f7f5);
    white-space: nowrap;
  }
  .workflowPlugin__grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .workflowPlugin__stat {
    padding: 14px;
  }
  .workflowPlugin__stat strong {
    display: block;
    margin-top: 6px;
    font-size: 28px;
    line-height: 1;
  }
  .workflowPlugin__panel {
    display: grid;
    gap: 12px;
    padding: 14px;
  }
  .workflowPlugin__panelHeader {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
  }
  .workflowPlugin__panel h2 {
    margin: 0;
    font-size: 15px;
    line-height: 1.25;
    letter-spacing: 0;
  }
  .workflowPlugin__form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(150px, 220px) auto;
    gap: 10px;
    align-items: end;
  }
  .workflowPlugin__field {
    display: grid;
    gap: 6px;
  }
  .workflowPlugin input {
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid var(--panel-border, rgba(255,255,255,0.14));
    border-radius: 7px;
    background: var(--editor-surface-2, #22252b);
    color: inherit;
    font: inherit;
    font-size: 13px;
  }
  .workflowPlugin button {
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid var(--editor-accent, #78b7ff);
    border-radius: 7px;
    background: var(--editor-accent, #78b7ff);
    color: #071017;
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }
  .workflowPlugin button.secondary {
    border-color: var(--panel-border, rgba(255,255,255,0.14));
    background: var(--editor-surface-2, #22252b);
    color: inherit;
  }
  .workflowPlugin__records {
    display: grid;
    gap: 8px;
  }
  .workflowPlugin__record {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border: 1px solid var(--panel-border, rgba(255,255,255,0.14));
    border-radius: 8px;
    background: var(--editor-surface-2, #22252b);
  }
  .workflowPlugin__record strong {
    display: block;
    overflow-wrap: anywhere;
    font-size: 13px;
  }
  .workflowPlugin__status {
    border-radius: 999px;
    padding: 4px 8px;
    background: rgba(120, 183, 255, 0.14);
    color: var(--editor-accent, #78b7ff);
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
  }
  .workflowPlugin__status[data-status="approved"] {
    background: rgba(52, 211, 153, 0.14);
    color: var(--editor-success-green, #34d399);
  }
  .workflowPlugin__message {
    margin: 0;
    color: var(--editor-success-green, #34d399);
    font-size: 12px;
  }
  .workflowPlugin__error {
    margin: 0;
    color: var(--editor-danger, #ff6b6b);
    font-size: 12px;
  }
  @media (max-width: 720px) {
    .workflowPlugin__summary,
    .workflowPlugin__grid,
    .workflowPlugin__form,
    .workflowPlugin__record {
      grid-template-columns: 1fr;
    }
  }
`

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function count(records, status) {
  return records.filter((record) => record.data.status === status).length
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export async function render({ root, api }) {
  const approvals = api.cms.storage.collection('approvals')
  let message = ''

  const style = document.createElement('style')
  style.textContent = styles
  root.appendChild(style)

  const shell = document.createElement('div')
  shell.className = 'workflowPlugin'
  root.appendChild(shell)

  async function loadRecords(nextMessage = message) {
    message = nextMessage
    try {
      const [records, status] = await Promise.all([
        approvals.list(),
        api.cms.routes.json('status').catch(() => null),
      ])
      renderDashboard(records, status)
    } catch (error) {
      shell.innerHTML = `<p class="workflowPlugin__error">${escapeHtml(error.message || error)}</p>`
    }
  }

  function renderDashboard(records, status) {
    shell.innerHTML = `
      <section class="workflowPlugin__summary" aria-label="Workflow summary">
        <div>
          <span>Workflow plugin</span>
          <strong>Approval requests for pages</strong>
          <p>Requests submitted from the editor toolbar or this dashboard are stored as plugin-owned CMS records.</p>
        </div>
        <div class="workflowPlugin__capabilities" aria-label="Plugin capabilities">
          <span>Editor command</span>
          <span>CMS storage</span>
          <span>Backend route</span>
        </div>
      </section>

      <div class="workflowPlugin__grid">
        <div class="workflowPlugin__stat"><span>Total</span><strong>${records.length}</strong></div>
        <div class="workflowPlugin__stat"><span>Pending</span><strong>${count(records, 'pending')}</strong></div>
        <div class="workflowPlugin__stat"><span>Approved</span><strong>${count(records, 'approved')}</strong></div>
      </div>

      ${message ? `<p class="workflowPlugin__message" role="status">${escapeHtml(message)}</p>` : ''}

      <section class="workflowPlugin__panel" aria-label="Create approval request">
        <h2>New request</h2>
        <form class="workflowPlugin__form">
          <label class="workflowPlugin__field">
            <span>Page title</span>
            <input name="pageTitle" value="Landing Page" required />
          </label>
          <label class="workflowPlugin__field">
            <span>Reviewer</span>
            <input name="reviewer" value="Editorial Lead" />
          </label>
          <button type="submit">Request approval</button>
        </form>
      </section>

      <section class="workflowPlugin__panel" aria-label="Approval queue">
        <div class="workflowPlugin__panelHeader">
          <div>
            <h2>Approval queue</h2>
            ${status ? `<span class="workflowPlugin__meta">Backend route: ${escapeHtml(status.total)} tracked</span>` : ''}
          </div>
          <div class="workflowPlugin__panelToolbar">
            <button class="secondary" data-refresh type="button">Refresh</button>
            <button class="secondary" data-seed type="button">Seed via backend route</button>
          </div>
        </div>
        <div class="workflowPlugin__records">
          ${records.map((record) => {
            const recordId = escapeHtml(record.id)
            const statusValue = String(record.data.status || 'pending')
            return `
              <article class="workflowPlugin__record">
                <div>
                  <strong>${escapeHtml(record.data['page-title'])}</strong>
                  <small>${escapeHtml(record.data.reviewer || 'Unassigned')} - ${escapeHtml(record.data.notes || 'No notes')}</small>
                </div>
                <span class="workflowPlugin__status" data-status="${escapeHtml(statusValue)}">${escapeHtml(statusValue)}</span>
                <div class="workflowPlugin__recordActions">
                  <button class="secondary" data-approve="${recordId}" type="button">Approve</button>
                  <button class="secondary" data-reset="${recordId}" type="button">Reset</button>
                </div>
              </article>
            `
          }).join('') || '<small>No approval requests yet.</small>'}
        </div>
      </section>
    `

    bindActions(records)
  }

  function bindActions(records) {
    shell.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      try {
        await approvals.create({
          'page-title': String(form.get('pageTitle') || 'Untitled page'),
          'page-id': '',
          status: 'pending',
          reviewer: String(form.get('reviewer') || 'Unassigned'),
          notes: 'Created from the Workflow Tools dashboard.',
          urgent: false,
          'requested-at': today(),
        })
        await loadRecords('Approval request created')
      } catch (error) {
        shell.insertAdjacentHTML('afterbegin', `<p class="workflowPlugin__error">${escapeHtml(error.message || error)}</p>`)
      }
    })

    shell.querySelector('[data-refresh]')?.addEventListener('click', async () => {
      await loadRecords('Approval queue refreshed')
    })

    shell.querySelector('[data-seed]')?.addEventListener('click', async () => {
      try {
        await api.cms.routes.json('seed', { method: 'POST' })
        await loadRecords('Backend route created a request')
      } catch (error) {
        shell.insertAdjacentHTML('afterbegin', `<p class="workflowPlugin__error">${escapeHtml(error.message || error)}</p>`)
      }
    })

    for (const button of shell.querySelectorAll('[data-approve]')) {
      button.addEventListener('click', async () => {
        const record = records.find((candidate) => candidate.id === button.getAttribute('data-approve'))
        if (!record) return
        await approvals.update(record.id, {
          ...record.data,
          status: 'approved',
        })
        await loadRecords('Approval marked approved')
      })
    }

    for (const button of shell.querySelectorAll('[data-reset]')) {
      button.addEventListener('click', async () => {
        const record = records.find((candidate) => candidate.id === button.getAttribute('data-reset'))
        if (!record) return
        await approvals.update(record.id, {
          ...record.data,
          status: 'pending',
        })
        await loadRecords('Approval reset to pending')
      })
    }
  }

  const onApprovalsChanged = () => {
    void loadRecords('Approval queue updated')
  }
  window.addEventListener(APPROVALS_CHANGED_EVENT, onApprovalsChanged)
  cleanups.set(root, () => {
    window.removeEventListener(APPROVALS_CHANGED_EVENT, onApprovalsChanged)
  })

  await loadRecords('')
}

export function cleanup({ root }) {
  cleanups.get(root)?.()
  cleanups.delete(root)
}
