export function install(api) {
  api.plugin.log('Template plugin installed')
}

export function activate(api) {
  api.plugin.log('Template plugin activated')
  const items = api.cms.storage.collection('items')

  api.cms.routes.get('/status', async () => {
    const records = await items.list()
    return {
      ok: true,
      total: records.length,
      plugin: api.plugin.id,
    }
  })
}

export function deactivate(api) {
  api.plugin.log('Template plugin deactivated')
}

export async function uninstall(api) {
  const items = api.cms.storage.collection('items')
  const records = await items.list()
  await Promise.all(records.map((record) => items.delete(record.id)))
  api.plugin.log(`Template plugin removed ${records.length} records`)
}
