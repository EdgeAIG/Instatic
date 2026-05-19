/**
 * useOnboardingState — fetch the five onboarding-step facts the
 * DashboardPage needs in one place.
 *
 *   • Site identity — done when `site.name` differs from the default
 *     ("Untitled Site") OR the favicon has been set.
 *   • Framework import — derived from `site.settings.framework` being
 *     populated. Defaults to `'choose'` (active) so the user is nudged
 *     to make a deliberate decision; once they pick a mode the step
 *     flips to done.
 *   • First page — done when ≥ 2 pages exist (the seed Home page
 *     doesn't count).
 *   • First plugin — done when any plugin is installed.
 *   • Team — done when more than the owner is in the users table.
 *
 * Reads concurrently in `Promise.all` so the dashboard renders the
 * first paint of the panel after a single round trip's worth of
 * latency. Soft-fails on any individual error so a broken endpoint
 * doesn't brick the dashboard — the step just shows as "not started".
 */
import { useEffect, useState } from 'react'
import { cmsAdapter } from '@core/persistence/cms'
import { listCmsPlugins } from '@core/persistence/cmsPlugins'
import { listCmsUsers } from '@core/persistence/cmsUsers'

export type OnboardingStepState = 'done' | 'active' | 'todo'

export interface OnboardingFacts {
  loading: boolean
  identity: OnboardingStepState
  framework: OnboardingStepState
  firstPage: OnboardingStepState
  plugin: OnboardingStepState
  team: OnboardingStepState
}

const INITIAL: OnboardingFacts = {
  loading: true,
  identity: 'todo',
  framework: 'active',
  firstPage: 'todo',
  plugin: 'todo',
  team: 'todo',
}

export function useOnboardingState(): OnboardingFacts {
  const [facts, setFacts] = useState<OnboardingFacts>(INITIAL)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [siteResult, pluginsResult, usersResult] = await Promise.allSettled([
        cmsAdapter.loadSite('default'),
        listCmsPlugins(),
        listCmsUsers(),
      ])

      if (cancelled) return

      const site = siteResult.status === 'fulfilled' ? siteResult.value : undefined
      const plugins = pluginsResult.status === 'fulfilled' ? pluginsResult.value.plugins : []
      const users = usersResult.status === 'fulfilled' ? usersResult.value : []

      const hasIdentity = Boolean(
        site && site.name && site.name !== 'Untitled Site',
      )
      const hasFavicon = Boolean(site?.settings?.faviconUrl)
      const hasFramework = Boolean(site?.settings?.framework)
      const pageCount = Array.isArray(site?.pages) ? site.pages.length : 0
      const pluginCount = plugins.length
      const userCount = users.length

      setFacts({
        loading: false,
        identity: hasIdentity || hasFavicon ? 'done' : 'active',
        framework: hasFramework ? 'done' : 'active',
        firstPage: pageCount >= 2 ? 'done' : 'todo',
        plugin: pluginCount > 0 ? 'done' : 'todo',
        team: userCount > 1 ? 'done' : 'todo',
      })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return facts
}
