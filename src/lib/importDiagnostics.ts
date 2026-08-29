import { repositoryUrl } from './appDiagnostics'

const storageKey = 'brick-flow-agent:import-diagnostics:v1'
const maxEntries = 10

export type ImportDiagnostic = {
  id: string
  createdAt: string
  fileName: string
  format: 'JSON' | 'LDR' | 'MPD' | 'OBJ'
  status: 'success' | 'warning' | 'error'
  importedPartCount: number
  ignoredPartCount: number
  unsupportedParts: Array<{ partNumber: string; count: number }>
  unsupportedColorCodes: number[]
  unsupportedPoseCount: number
  validationMessages: string[]
  repairs: string[]
  objMetrics?: {
    resolution: number
    voxelIoU: number
    frontSilhouetteIoU: number
    sideSilhouetteIoU: number
    topSilhouetteIoU: number
    structuralChangePercent: number
    addedSupportVoxels: number
    addedConnectivityVoxels: number
    brickCount: number
  }
}

const isDiagnostic = (value: unknown): value is ImportDiagnostic => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ImportDiagnostic>
  return typeof item.id === 'string' && typeof item.fileName === 'string' &&
    typeof item.createdAt === 'string' && typeof item.importedPartCount === 'number' &&
    typeof item.ignoredPartCount === 'number' && typeof item.unsupportedPoseCount === 'number' &&
    (item.format === 'JSON' || item.format === 'LDR' || item.format === 'MPD' || item.format === 'OBJ') &&
    (item.status === 'success' || item.status === 'warning' || item.status === 'error') &&
    Array.isArray(item.unsupportedParts) && Array.isArray(item.unsupportedColorCodes) &&
    Array.isArray(item.validationMessages) && Array.isArray(item.repairs)
}

export const loadImportDiagnostics = (): ImportDiagnostic[] => {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter(isDiagnostic).slice(0, maxEntries) : []
  } catch {
    return []
  }
}

export const saveImportDiagnostic = (diagnostic: ImportDiagnostic) => {
  const next = [diagnostic, ...loadImportDiagnostics()].slice(0, maxEntries)
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // Compatibility history is optional when browser storage is unavailable.
  }
  return next
}

export const deleteImportDiagnostic = (id: string) => {
  const next = loadImportDiagnostics().filter((item) => item.id !== id)
  try {
    if (next.length === 0) window.localStorage.removeItem(storageKey)
    else window.localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // Optional browser history.
  }
  return next
}

export const formatImportDiagnosticMarkdown = (diagnostic: ImportDiagnostic) => [
  `# Brick Flow import compatibility report`,
  '',
  `- File: ${diagnostic.fileName}`,
  `- Format: ${diagnostic.format}`,
  `- Status: ${diagnostic.status}`,
  `- Imported parts: ${diagnostic.importedPartCount}`,
  `- Ignored entries: ${diagnostic.ignoredPartCount}`,
  `- Unsupported poses: ${diagnostic.unsupportedPoseCount}`,
  `- Unsupported color codes: ${diagnostic.unsupportedColorCodes.join(', ') || 'none'}`,
  '',
  '## Unsupported parts',
  '',
  ...(diagnostic.unsupportedParts.length ? diagnostic.unsupportedParts.map((item) => `- ${item.partNumber}: ${item.count}`) : ['- None']),
  '',
  '## Validation messages',
  '',
  ...(diagnostic.validationMessages.length ? diagnostic.validationMessages.map((message) => `- ${message}`) : ['- None']),
  ...(diagnostic.objMetrics ? [
    '', '## OBJ conversion', '',
    `- Resolution: ${diagnostic.objMetrics.resolution}`,
    `- Voxel IoU: ${(diagnostic.objMetrics.voxelIoU * 100).toFixed(1)}%`,
    `- Front/side/top silhouette IoU: ${(diagnostic.objMetrics.frontSilhouetteIoU * 100).toFixed(1)}% / ${(diagnostic.objMetrics.sideSilhouetteIoU * 100).toFixed(1)}% / ${(diagnostic.objMetrics.topSilhouetteIoU * 100).toFixed(1)}%`,
    `- Structural change: ${diagnostic.objMetrics.structuralChangePercent.toFixed(1)}%`,
    `- Support/connectivity voxels added: ${diagnostic.objMetrics.addedSupportVoxels} / ${diagnostic.objMetrics.addedConnectivityVoxels}`,
  ] : []),
].join('\n')

export const createImportDiagnosticIssueUrl = (diagnostic: ImportDiagnostic) => {
  const query = new URLSearchParams({
    title: `[Import] ${diagnostic.format} compatibility: ${diagnostic.fileName}`,
    body: formatImportDiagnosticMarkdown(diagnostic),
    labels: 'compatibility',
  })
  return `${repositoryUrl}/issues/new?${query.toString()}`
}
