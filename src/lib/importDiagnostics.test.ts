import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImportDiagnosticIssueUrl, deleteImportDiagnostic, formatImportDiagnosticMarkdown, loadImportDiagnostics, saveImportDiagnostic, type ImportDiagnostic } from './importDiagnostics'

const createStorage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
}

const diagnostic: ImportDiagnostic = {
  id: 'import-1', createdAt: '2026-08-30', fileName: 'bridge.mpd', format: 'MPD', status: 'warning',
  importedPartCount: 12, ignoredPartCount: 2, unsupportedParts: [{ partNumber: '99999', count: 2 }],
  unsupportedColorCodes: [], unsupportedPoseCount: 0, validationMessages: [], repairs: [],
}

describe('import diagnostics', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('persists, formats, links, and deletes reports', () => {
    vi.stubGlobal('window', { localStorage: createStorage() })
    saveImportDiagnostic(diagnostic)
    expect(loadImportDiagnostics()).toHaveLength(1)
    expect(formatImportDiagnosticMarkdown(diagnostic)).toContain('99999: 2')
    expect(createImportDiagnosticIssueUrl(diagnostic)).toContain('/issues/new?')
    expect(deleteImportDiagnostic(diagnostic.id)).toHaveLength(0)
  })
})
