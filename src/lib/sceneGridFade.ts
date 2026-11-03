/** Keep every padded scene corner inside the fully visible grid. The soft
 * outer band is decoration; it must not cut through a distant model. */
export const getSceneGridFade = (bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const start = Math.max(21, Math.hypot(bounds.maxX - centerX, bounds.maxZ - centerZ))
  return { centerX, centerZ, start, end: start + Math.max(9, start * .35) }
}
