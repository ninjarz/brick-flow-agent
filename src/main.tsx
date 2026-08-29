import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './lib/i18n.tsx'
import { getCanonicalAppPath } from './lib/appUrl.ts'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'

const canonicalPath = getCanonicalAppPath(window.location.pathname, import.meta.env.BASE_URL)
if (canonicalPath) {
  window.history.replaceState(
    window.history.state,
    '',
    `${canonicalPath}${window.location.search}${window.location.hash}`,
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </I18nProvider>
  </StrictMode>,
)
