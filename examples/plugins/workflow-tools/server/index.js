export function install(api) {
  api.plugin.log('Workflow Tools installed')
}

export function activate(api) {
  api.plugin.log('Workflow Tools activated')
  const approvals = api.cms.storage.collection('approvals')

  api.cms.routes.get('/status', async () => {
    const records = await approvals.list()
    const counts = records.reduce((summary, record) => {
      const status = String(record.data.status || 'unknown')
      summary[status] = (summary[status] || 0) + 1
      return summary
    }, {})

    return {
      ok: true,
      total: records.length,
      counts,
      generatedAt: new Date().toISOString(),
    }
  })

  api.cms.routes.post('/seed', async () => {
    const record = await approvals.create({
      'page-title': 'Homepage',
      'page-id': 'page_home',
      status: 'pending',
      reviewer: 'Editorial Lead',
      notes: 'Seeded by the Workflow Tools backend route.',
      urgent: true,
      'requested-at': new Date().toISOString().slice(0, 10),
    })

    return { record }
  })
}

export function deactivate(api) {
  api.plugin.log('Workflow Tools deactivated')
}

export async function uninstall(api) {
  const approvals = api.cms.storage.collection('approvals')
  const records = await approvals.list()
  await Promise.all(records.map((record) => approvals.delete(record.id)))
  api.plugin.log(`Workflow Tools uninstalled and removed ${records.length} approval records`)
}
