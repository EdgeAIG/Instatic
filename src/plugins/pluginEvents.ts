export const CMS_PLUGINS_CHANGED_EVENT = 'cms-plugins-changed'

export function notifyCmsPluginsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CMS_PLUGINS_CHANGED_EVENT))
}
