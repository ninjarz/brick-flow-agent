type Vector = readonly [number, number, number]
export type CellAxes = readonly [Vector, Vector, Vector]
export type OrientedCell = { axes: CellAxes; halfSize: Vector }
export type CellBounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; oriented?: OrientedCell }
const worldAxes: CellAxes = [[1,0,0],[0,1,0],[0,0,1]]
const dot = (a: Vector,b: Vector) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const relationCache = new WeakMap<CellAxes,WeakMap<CellAxes,{r:number[][];abs:number[][]}>>()
const relation = (a: CellAxes,b: CellAxes) => {
  let cache=relationCache.get(a)
  if(!cache){cache=new WeakMap();relationCache.set(a,cache)}
  let value=cache.get(b)
  if(!value){const r=a.map(axis=>b.map(other=>dot(axis,other)));value={r,abs:r.map(row=>row.map(Math.abs))};cache.set(b,value)}
  return value
}
// Separating-axis test on the actual rotated voxel boxes. Their axis-aligned
// envelopes remain useful for candidate lookup, but are not solid geometry.
export const orientedCellsOverlap = (a: CellBounds,b: CellBounds,tolerance:number) => {
  if(!a.oriented&&!b.oriented)return true
  const axesA=a.oriented?.axes??worldAxes, axesB=b.oriented?.axes??worldAxes
  const halfA=a.oriented?.halfSize??[(a.maxX-a.minX)/2,(a.maxY-a.minY)/2,(a.maxZ-a.minZ)/2]
  const halfB=b.oriented?.halfSize??[(b.maxX-b.minX)/2,(b.maxY-b.minY)/2,(b.maxZ-b.minZ)/2]
  const delta:Vector=[(b.minX+b.maxX-a.minX-a.maxX)/2,(b.minY+b.maxY-a.minY-a.maxY)/2,(b.minZ+b.maxZ-a.minZ-a.maxZ)/2]
  const t=axesA.map(axis=>dot(delta,axis)),{r,abs}=relation(axesA,axesB)
  for(let i=0;i<3;i++){
    const radius=halfA[i]+halfB.reduce((s,h,j)=>s+h*abs[i][j],0)
    if(Math.abs(t[i])>=radius-tolerance)return false
  }
  for(let j=0;j<3;j++){
    const radius=halfB[j]+halfA.reduce((s,h,i)=>s+h*abs[i][j],0)
    if(Math.abs(t.reduce((s,n,i)=>s+n*r[i][j],0))>=radius-tolerance)return false
  }
  for(let i=0;i<3;i++)for(let j=0;j<3;j++){
    const length=Math.sqrt(Math.max(0,1-r[i][j]*r[i][j]))
    if(length<1e-6)continue
    const i1=(i+1)%3,i2=(i+2)%3,j1=(j+1)%3,j2=(j+2)%3
    const distance=Math.abs(t[i2]*r[i1][j]-t[i1]*r[i2][j])
    const radius=halfA[i1]*abs[i2][j]+halfA[i2]*abs[i1][j]+halfB[j1]*abs[i][j2]+halfB[j2]*abs[i][j1]
    if(distance>=radius-tolerance*length)return false
  }
  return true
}
