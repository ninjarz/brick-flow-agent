import interfacePoints from '../data/lddInterfacePoints.json' with { type: 'json' }
import frames from '../data/ldrawSourceFrames.json' with { type: 'json' }
import type {BrickDefinition,BrickConnector} from '../types/bricks'
type Point = {kind:'stud'|'tube'|'bar'|'pin'|'axle';gender:'male'|'female';point:number[];direction:number[];interfaceType?:string}
const pointsByPart = interfacePoints as Record<string,Point[]>
const framesByPart = frames as Record<string,{origin:number[];swapped:boolean}>
// Interface positions come from the source part's connection fields, so offsets
// on rails, angled plates and jumpers do not depend on its exterior bounding box.
export const getLDDInterfaceConnectors = (definition:Pick<BrickDefinition,'id'|'partNumber'|'footprint'>):BrickConnector[] => {
  if(!definition.id.startsWith('hogwarts-ldraw-')&&!['75937','61252','63868','59900','92947','2458','4070','85080','49668','44728','3957b','6541','47905','4733','4477','11477','60478','3666','6141','85861','3941'].includes(definition.partNumber))return []
  const part=definition.partNumber.replace(/\.dat$/,''),points=pointsByPart[part],frame=framesByPart[part]
  if(!points||!frame)return []
  return points.map((p,index)=>{
    const v=[(p.point[0]-frame.origin[0])/20,(frame.origin[1]-p.point[1])/20,(p.point[2]-frame.origin[2])/20]
    const n=[p.direction[0],-p.direction[1],p.direction[2]]
    if(frame.swapped){[v[0],v[2]]=[v[2],v[0]];[n[0],n[2]]=[n[2],n[0]]}
    const length=Math.hypot(...n),direction={x:n[0]/length,y:n[1]/length,z:n[2]/length}
    const axis=Math.abs(direction.y)>=Math.max(Math.abs(direction.x),Math.abs(direction.z))?'y':Math.abs(direction.x)>=Math.abs(direction.z)?'x':'z'
    const pose=['bar','pin','axle'].includes(p.kind)?{xStud:v[0],yStud:v[1],zStud:v[2]}:axis==='y'?{xStud:v[0]-.5,yStud:v[1],zStud:v[2]-.5}:axis==='x'?{xStud:v[0]-(direction.x>0?definition.footprint.widthStuds:0),yStud:v[1],zStud:v[2]-.5}:{xStud:v[0]-.5,yStud:v[1],zStud:v[2]-(direction.z>0?definition.footprint.depthStuds:0)}
    return {id:`${definition.id}-source-${index}`,kind:p.kind,gender:p.gender,axis,direction,pose,...(p.interfaceType?{interfaceType:p.interfaceType}:{})}
  })
}
