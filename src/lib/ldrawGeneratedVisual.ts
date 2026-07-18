import type { MeshTriangle } from './structuralVoxelizer'

export type LDrawGeneratedVisualChunk = {
  getLDrawGeneratedVisualTriangles: (partNumber: string) => MeshTriangle[] | undefined
}

const loadVisualChunk0 = () => import('./ldrawGeneratedVisualChunks/chunk-00')
const loadVisualChunk1 = () => import('./ldrawGeneratedVisualChunks/chunk-01')
const loadVisualChunk2 = () => import('./ldrawGeneratedVisualChunks/chunk-02')
const loadVisualChunk3 = () => import('./ldrawGeneratedVisualChunks/chunk-03')
const loadVisualChunk4 = () => import('./ldrawGeneratedVisualChunks/chunk-04')
const loadVisualChunk5 = () => import('./ldrawGeneratedVisualChunks/chunk-05')
const loadVisualChunk6 = () => import('./ldrawGeneratedVisualChunks/chunk-06')
const loadVisualChunk7 = () => import('./ldrawGeneratedVisualChunks/chunk-07')
const loadVisualChunk8 = () => import('./ldrawGeneratedVisualChunks/chunk-08')
const loadVisualChunk9 = () => import('./ldrawGeneratedVisualChunks/chunk-09')
const loadVisualChunk10 = () => import('./ldrawGeneratedVisualChunks/chunk-10')
const loadVisualChunk11 = () => import('./ldrawGeneratedVisualChunks/chunk-11')
const loadVisualChunk12 = () => import('./ldrawGeneratedVisualChunks/chunk-12')
const loadVisualChunk13 = () => import('./ldrawGeneratedVisualChunks/chunk-13')
const loadVisualChunk14 = () => import('./ldrawGeneratedVisualChunks/chunk-14')
const loadVisualChunk15 = () => import('./ldrawGeneratedVisualChunks/chunk-15')

export const ldrawGeneratedVisualChunkLoaders: Record<
  string,
  () => Promise<LDrawGeneratedVisualChunk>
> = {
  "11477": loadVisualChunk0,
  "13971": loadVisualChunk0,
  "15397": loadVisualChunk0,
  "15573": loadVisualChunk0,
  "2412": loadVisualChunk0,
  "2431": loadVisualChunk0,
  "2479": loadVisualChunk0,
  "2926": loadVisualChunk0,
  "30000": loadVisualChunk1,
  "3001": loadVisualChunk1,
  "3002": loadVisualChunk1,
  "3003": loadVisualChunk1,
  "3004": loadVisualChunk1,
  "30044": loadVisualChunk1,
  "3005": loadVisualChunk1,
  "3007": loadVisualChunk1,
  "3009": loadVisualChunk2,
  "3010": loadVisualChunk2,
  "3020": loadVisualChunk2,
  "3021": loadVisualChunk2,
  "3022": loadVisualChunk2,
  "3023": loadVisualChunk2,
  "30236": loadVisualChunk2,
  "3024": loadVisualChunk2,
  "3031": loadVisualChunk2,
  "3032": loadVisualChunk3,
  "3034": loadVisualChunk3,
  "3035": loadVisualChunk4,
  "3036": loadVisualChunk5,
  "3037": loadVisualChunk6,
  "3039": loadVisualChunk6,
  "3040": loadVisualChunk6,
  "30414": loadVisualChunk6,
  "3062": loadVisualChunk6,
  "3065": loadVisualChunk6,
  "3069": loadVisualChunk6,
  "3070": loadVisualChunk6,
  "3184": loadVisualChunk6,
  "34337": loadVisualChunk6,
  "3622": loadVisualChunk6,
  "3623": loadVisualChunk6,
  "3659": loadVisualChunk6,
  "3660": loadVisualChunk6,
  "3665": loadVisualChunk6,
  "3666": loadVisualChunk7,
  "3679": loadVisualChunk7,
  "3680": loadVisualChunk7,
  "3684": loadVisualChunk7,
  "3710": loadVisualChunk7,
  "3747": loadVisualChunk7,
  "3795": loadVisualChunk7,
  "3941": loadVisualChunk7,
  "3942": loadVisualChunk7,
  "4032": loadVisualChunk8,
  "4070": loadVisualChunk8,
  "4073": loadVisualChunk8,
  "4286": loadVisualChunk8,
  "4460": loadVisualChunk8,
  "44728": loadVisualChunk8,
  "4589": loadVisualChunk8,
  "4600": loadVisualChunk8,
  "4624": loadVisualChunk8,
  "49668": loadVisualChunk8,
  "50950": loadVisualChunk8,
  "54200": loadVisualChunk8,
  "60032": loadVisualChunk8,
  "6014": loadVisualChunk9,
  "60478": loadVisualChunk9,
  "60481": loadVisualChunk9,
  "6091": loadVisualChunk9,
  "61252": loadVisualChunk9,
  "61254": loadVisualChunk9,
  "61678": loadVisualChunk9,
  "6215": loadVisualChunk9,
  "6232": loadVisualChunk9,
  "63868": loadVisualChunk9,
  "64799": loadVisualChunk10,
  "67737": loadVisualChunk10,
  "75937": loadVisualChunk10,
  "85984": loadVisualChunk10,
  "87079": loadVisualChunk10,
  "87087": loadVisualChunk10,
  "87414": loadVisualChunk11,
  "87580": loadVisualChunk11,
  "87697": loadVisualChunk11,
  "88292": loadVisualChunk11,
  "88930": loadVisualChunk11,
  "92438": loadVisualChunk12,
  "92947": loadVisualChunk13,
  "93273": loadVisualChunk13,
  "94161": loadVisualChunk13,
  "96874": loadVisualChunk14,
  "98100": loadVisualChunk14,
  "98138": loadVisualChunk14,
  "98263": loadVisualChunk15,
}

export const ldrawGeneratedVisualPartNumbers = Object.keys(ldrawGeneratedVisualChunkLoaders)
