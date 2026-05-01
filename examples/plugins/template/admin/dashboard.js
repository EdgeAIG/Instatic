export async function render({ root, api }) {
  root.replaceChildren()

  const shell = document.createElement('section')
  shell.style.display = 'grid'
  shell.style.gap = '12px'

  const title = document.createElement('h2')
  title.textContent = 'Template Plugin'
  shell.appendChild(title)

  const status = document.createElement('p')
  status.textContent = 'Loading status...'
  shell.appendChild(status)

  const records = document.createElement('ul')
  shell.appendChild(records)

  root.appendChild(shell)

  const items = api.cms.storage.collection('items')
  const [statusPayload, list] = await Promise.all([
    api.cms.routes.json('status').catch(() => ({ total: 0 })),
    items.list(),
  ])

  status.textContent = `Backend route reports ${statusPayload.total ?? 0} records.`
  records.replaceChildren(...list.map((record) => {
    const item = document.createElement('li')
    item.textContent = String(record.data.title ?? record.id)
    return item
  }))
}
