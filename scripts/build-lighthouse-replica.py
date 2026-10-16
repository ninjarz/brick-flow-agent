#!/usr/bin/env python3
"""Hand-transcribed LEGO 30023, official leaflet 4650618, steps 1–9.
No community assembled model is used. Units: 20 LDU/stud, 8 LDU/plate.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
I = (1,0,0,0,1,0,0,0,1)
R = ((1,0,0,0,1,0,0,0,1),(0,0,1,0,1,0,-1,0,0),(-1,0,0,0,1,0,0,0,-1),(0,0,-1,0,1,0,1,0,0))

def part(color,x,y,z,name,rotation=0):
    return f"1 {color} {x} {y} {z} {' '.join(map(str,R[rotation]))} {name}.dat"

def red_ring(y):
    return [part(4,x,y,z,'85080',r) for r,(x,z) in enumerate(((10,-10),(-10,-10),(-10,10),(10,10)))]

steps = [
    dict(title='底板与带孔砖', page=1, check='绿色 4×4 底板；深灰带孔砖位于后侧，两个凸点与底板对齐，圆孔所在的长面可见。', parts=[part(2,0,0,0,'3031'),part(72,-30,-24,0,'3700',1)]),
    dict(title='底座与棕色小屋', page=1, check='棕色 2×4 砖向前伸出一格；左右各一块浅灰 2×2 斜坡，低边朝外。',parts=[part(70,20,-24,0,'3001'),part(71,0,-24,-30,'3039'),part(71,0,-24,30,'3039',2)]),
    dict(title='第一圈白色塔身与屋顶', page=1,check='白色 4×4 圆砖居中；棕色砖前端的两块黑色小斜坡相向形成屋脊。',parts=[part(15,0,-48,0,'87081'),part(0,50,-24,-10,'54200'),part(0,50,-24,10,'54200',2)]),
    dict(title='第一圈红色条纹', page=1,check='4 块红色弧砖组成完整圆环，圆环顶面保持红色；此步从下往上只有白—红两层。',parts=red_ring(-72)),
    dict(title='第二圈红白条纹', page=1,check='先加白色圆砖，再加 4 块红色弧砖，最后盖白色圆砖；共五层白—红—白—红—白。',parts=[part(15,0,-96,0,'87081')]+red_ring(-120)+[part(15,0,-144,0,'87081')]),
    dict(title='平台第一半块', page=1,check='第一块浅灰 3×6 切角板覆盖半个塔顶，直边经过塔心，两个切角朝外。',parts=[part(71,-30,-152,0,'2419',1)]),
    dict(title='完整八边平台', page=1,check='第二块切角板旋转 180° 与第一块拼合；两块等高、直边贴合，组成对称八边平台。',parts=[part(71,30,-152,0,'2419',3)]),
    dict(title='黑色灯座与透明灯室', page=2,check='黑色 4×4 圆砖居中，两块透明黄色 2×2 圆砖上下叠放，四周露出黑色凸点。',parts=[part(0,0,-176,0,'87081'),part(46,0,-200,0,'3941'),part(46,0,-224,0,'3941')]),
    dict(title='灯罩与隐藏连接板', page=2,check='白色 1×1 圆板装在黑色 3×3 碟形灯罩下面，再一起装上灯室；最终使用 25 件。',parts=[part(15,0,-232,0,'6141'),part(0,0,-240,0,'43898')]),
]
lines=['0 FILE 30023-1.ldr','0 Lighthouse — manual reconstruction from official LEGO 4650618','0 Name: 30023-1.ldr','0 Author: brick-flow-agent','0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt','0 !LDRAW_ORG Model','0 // Source: https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4650618.pdf','0 // Assembly coordinates independently transcribed; not an OMR model.']
for i,step in enumerate(steps):
    if i:lines.append('0 STEP')
    lines.append(f'0 // Official step {i+1}: {step["title"]}')
    lines.extend(step['parts'])
raw=('\n'.join(lines)+'\n').encode()
(ROOT/'public/lego-replicas/models/30023-1.mpd').write_bytes(raw)
path=ROOT/'src/data/legoReplicaManifest.json'
manifest=json.loads(path.read_text())
item=dict(number='30023',title='Lighthouse · 灯塔',modelAuthor='brick-flow-agent（按官方手册逐步重建）',officialPieceCount=25,modelPieceCount=25,primitiveInstances=0,stepMarkers=8,distinctPieces=11,modelSha256=hashlib.sha256(raw).hexdigest(),modelUrl='lego-replicas/models/30023-1.mpd',officialInstructionsUrl='https://www.lego.com/en-us/service/building-instructions/30023',modelSourceUrl='lego-replicas/models/30023-1.mpd',instructionsPdfUrl='https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4650618.pdf',manualSteps=[])
count=0
for step in steps:
 count+=len(step['parts'])
 item['manualSteps'].append({k:v for k,v in step.items() if k!='parts'}|dict(addedPieces=len(step['parts']),totalPieces=count))
manifest=[x for x in manifest if x['number']!='30023']+[item]
path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'LEGO 30023: {count} pieces, {len(steps)} official steps')
