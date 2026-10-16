/// <reference lib="webworker" />

import {
  importObjToBrickPlan,
  type ObjImportWorkerRequest,
  type ObjImportWorkerResponse,
} from '../lib/objImport'

import { validateObjImportFiles } from '../lib/objImportFiles'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = async (event: MessageEvent<ObjImportWorkerRequest>) => {
  if (event.data.type !== 'import') return

  try {
    const invalid = validateObjImportFiles(event.data.file, event.data.materialFiles)
    if (invalid) throw new Error(invalid)
    let text: string
    try {
      text = await event.data.file.text()
    } catch {
      workerScope.postMessage({ type: 'error', code: 'OBJ_READ_FAILED' } satisfies ObjImportWorkerResponse)
      return
    }
    const materialText = event.data.materialFiles?.length
      ? (await Promise.all(event.data.materialFiles.map((file) => file.text()))).join('\n')
      : event.data.options.materialText
    const result = importObjToBrickPlan(text, { ...event.data.options, materialText }, (progress) => {
      workerScope.postMessage({ type: 'progress', progress } satisfies ObjImportWorkerResponse)
    })
    workerScope.postMessage({ type: 'result', result } satisfies ObjImportWorkerResponse)
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      code: error instanceof Error ? error.message : 'OBJ_IMPORT_FAILED',
    } satisfies ObjImportWorkerResponse)
  }
}

export {}
