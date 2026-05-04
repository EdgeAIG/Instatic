import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import '../styles/globals.css'

// Base module registration is deferred to AdminEntry (the lazy admin chunk)
// so the publisher / page-tree / sanitize stack stays out of the eager entry
// bundle. See src/modules/base/index.ts.

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
