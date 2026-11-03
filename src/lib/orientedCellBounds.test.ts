import {describe,it,expect} from 'vitest'
import {orientedCellsOverlap,getVerticalCellContactDistance,type CellAxes,type CellBounds} from './orientedCellBounds'
const c=Math.SQRT1_2
const yaw:CellAxes=[[c,0,c],[0,1,0],[-c,0,c]]
const box=(offset:number,axes=yaw):CellBounds=>{
 const x=-c*offset,z=c*offset,r=c*1.6
 return {minX:x-r,maxX:x+r,minY:0,maxY:.2,minZ:z-r,maxZ:z+r,oriented:{axes,halfSize:[1.5,.1,.1]}}
}
describe('oriented structural cells',()=>{
 it('does not turn the empty space in diagonal cell envelopes into collisions',()=>{
  const a=box(0),b=box(.4)
  expect(a.minX).toBeLessThan(b.maxX)
  expect(a.maxX).toBeGreaterThan(b.minX)
  expect(orientedCellsOverlap(a,b,1e-6)).toBe(false)
  expect(orientedCellsOverlap(b,a,1e-6)).toBe(false)
 })
 it('retains collisions with penetration and rejects face contact',()=>{
  expect(orientedCellsOverlap(box(0),box(.15),1e-6)).toBe(true)
  expect(orientedCellsOverlap(box(0),box(.2),1e-6)).toBe(false)
 })
 it('treats reflected source axes as the same occupied box',()=>{
  const reflected:CellAxes=[[-c,0,-c],[0,1,0],[-c,0,c]]
  expect(orientedCellsOverlap(box(0),box(.4,reflected),1e-6)).toBe(false)
  expect(orientedCellsOverlap(box(0),box(.1,reflected),1e-6)).toBe(true)
 })
 it('checks a rotated cell against an axis aligned cell',()=>{
  const ordinary:CellBounds={minX:-.05,maxX:.05,minY:.05,maxY:.15,minZ:-.05,maxZ:.05}
  expect(orientedCellsOverlap(box(0),ordinary,1e-6)).toBe(true)
  expect(orientedCellsOverlap(box(2),ordinary,1e-6)).toBe(false)
 })
 it('solves vertical SAT entry without skipping contact between sampled poses',()=>{
  const orientations:CellAxes[]=[yaw,[[1,0,0],[0,c,c],[0,-c,c]],[[-c,0,-c],[0,1,0],[-c,0,c]]]
  for(const axes of orientations)for(const offset of [-.4,0,.15,.4]){
   const original=box(offset,axes)
   const a={...original,minY:original.minY+3,maxY:original.maxY+3}
   const b=box(0)
   const distance=getVerticalCellContactDistance(a,b,1e-6)
   let first:number|undefined
   for(let i=0;i<=600;i++){
    const d=i*.01,shifted={...a,minY:a.minY-d,maxY:a.maxY-d}
    const overlapping=shifted.minX<b.maxX-1e-6&&shifted.maxX>b.minX+1e-6&&shifted.minY<b.maxY-1e-6&&shifted.maxY>b.minY+1e-6&&shifted.minZ<b.maxZ-1e-6&&shifted.maxZ>b.minZ+1e-6&&orientedCellsOverlap(shifted,b,1e-6)
    if(overlapping){first??=d;expect(distance).toBeLessThanOrEqual(d+1e-10)}
   }
   if(first!==undefined)expect(distance).toBeGreaterThanOrEqual(first-.010001)
   else expect(distance).toBe(Infinity)
  }
 })

})
