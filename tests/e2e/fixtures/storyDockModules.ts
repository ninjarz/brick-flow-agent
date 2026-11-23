// Resolve the dock and its context through the same Vite module graph.
export { default as React } from 'react'
export { createRoot } from 'react-dom/client'
export { WorldStoryDock } from '../../../src/components/WorldStoryDock'
export { I18nProvider } from '../../../src/lib/i18n'
export { createDefaultWorldScenarios } from '../../../src/data/worldScenarios'
