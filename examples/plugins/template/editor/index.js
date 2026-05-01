export function activate(api) {
  api.editor.commands.register({
    id: 'template.createItem',
    label: 'Create Template Item',
    async run() {
      await api.cms.storage.collection('items').create({
        title: 'Created from editor',
        status: 'draft',
      })
      return { message: 'Template item created' }
    },
  })

  api.editor.toolbar.addButton({
    id: 'template.createItem',
    label: 'Template',
    command: 'template.createItem',
  })
}
