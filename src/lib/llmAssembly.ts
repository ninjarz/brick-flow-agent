import { createSculptureLayers, tileSculptureLayers } from './llmSculpture'
import { LlmOutputLimitError } from './llmOutputLimit'
import { LlmServiceError } from './llmServiceError'
import { brickById } from '../data/basicBricks'
import type { BrickColor, BuildPlan, PlacedBrick } from '../types/bricks'
import { createId, createSingleBrickSteps, makeBrick, summarizeBuildPlanIssues, validateBuildPlan } from './planUtils'

export const assemblyLimits = { modules: 8, commands: 128, moduleBricks: 512, sculptureBricks: 2048, bricks: 4096 }

type Point = [number, number, number]
type Module = { name: string; description: string; origin: Point; tool?: 'building' | 'parts' | 'sculpture'; program?: unknown; requiredColors?: string[] }
type AssemblyLayout = { title: string; modules: Module[] }
type RequestModule = (prompt: string, tool?: Module['tool'], onProgram?: (program: unknown) => void) => Promise<unknown>

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const point = (value: unknown): Point => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1024)) {
    throw new Error('Assembly coordinates must contain three finite numbers within ±1024 studs.')
  }
  return value as Point
}

export const parseAssemblyLayout = (value: unknown): AssemblyLayout => {
  if (!record(value) || typeof value.title !== 'string' || !Array.isArray(value.modules) || !value.modules.length || value.modules.length > assemblyLimits.modules) {
    throw new Error('Assembly layout must contain a title and 1–8 ordered modules.')
  }
  const names = new Set<string>()
  const modules = value.modules.map(item => {
    if (!record(item) || typeof item.name !== 'string' || !item.name.trim() || names.has(item.name) || typeof item.description !== 'string') {
      throw new Error('Every assembly module requires a unique name and a construction description.')
    }
    names.add(item.name)
    if (item.tool !== undefined && item.tool !== 'building' && item.tool !== 'parts' && item.tool !== 'sculpture') throw new Error('Unknown module tool.')
    if (item.requiredColors !== undefined && (!Array.isArray(item.requiredColors) || item.requiredColors.length > 16
      || !item.requiredColors.every(color => typeof color === 'string' && color.length > 0 && color.length <= 64))) {
      throw new Error('Required colours must be an array of at most 16 colour ids.')
    }
    return { name: item.name, description: item.description, origin: point(item.origin), ...(item.tool ? { tool: item.tool as Module['tool'] } : {}), ...(item.program !== undefined ? { program: item.program } : {}), ...(item.requiredColors ? { requiredColors: item.requiredColors as string[] } : {}) }
  })
  return { title: value.title, modules }
}

export const assemblyProgramInstructions = `Return JSON {"commands":[{"brickId":"available id","color":"allowed color","at":[0,0,0],"rotationQuarterTurns":0,"verticalQuarterTurns":0,"repeat":{"count":[1,1,1],"step":[0,0,0]}}]}.
Coordinates and repeat steps are in studs on the 0.1-stud grid. One plate is 0.4 studs tall. at is local to this module's origin.
at is the minimum X/Z corner and bottom Y of the rotated footprint, not the centre. A brick-1x4 at [0,0,0] occupies X=0..4, Z=0..1, Y=0..1.2. Quarter turns 1 or 3 swap X/Z dimensions. Each command places a real part. Optional repeat expands a rectangular array along world X/Y/Z. For example count [8,1,1], step [2,0,0] places eight copies at two-stud intervals.
For a substantial architectural hall, prefer {"kind":"building","at":[0,0,0],"width":16,"wallCourses":8,"wallColor":"tan","roofColor":"gray","windowColor":"black","trimColor":"white","baseColor":"gray"}.
This deterministic tool builds a fully connected two-course foundation, an 8-stud-deep hall, dark glazed brick window bays, front buttresses, a studded ceiling and a four-course gabled roof from real editable parts. width is 8 or 16; wallCourses is 6–10. The outer base is (width+4) x 12 studs. The hall starts at at+[2,0.8,2]; roof ridge reaches Y=at.y+1.2+wallCourses*1.2+4.8. Use this in the FIRST module, at ground level. Reserve later modules for supported towers, a porch or attached details. Never overlay raw walls or floors on its occupied volume.
For roofs, prefer the deterministic recipe {"kind":"stepped-roof","at":[0,12,0],"size":[8,8],"tiers":4,"style":"pyramid","color":"gray"}.
This creates solid, supported stepped masonry roof courses using real brick-1x2 and brick-1x1 parts. Each tier is 1.2 studs high and shrinks by one stud on each side. style "gable" shrinks only Z, leaving X unchanged. Place it on a studded ceiling covering its full base, and do not add raw bricks inside the recipe volume. Use legal colour ids such as gray or lego-72 where listed, never invented dark-gray.
Use at most 128 commands and 512 expanded parts per module. Quarter turns must be integers from 0 to 3.
Ground-level neighbours do not connect through side contact. Build a connected foundation using overlapping staggered plate layers before adding walls. Build bottom-up, using real stud or side connector positions and exact part dimensions. Raised parts must connect to this module or the accepted assembly.
Keep the planned proportions, openings, roof profile and colour palette. Use repeated details to express windows, buttresses and masonry efficiently.
For characters and animals, preserve the planned head/body silhouette, facial markings, belly, feet and other identifying features. Vary course widths to make rounded or tapered outlines. Use coloured upright bricks as front-surface inlays, replacing the corresponding body bricks instead of overlapping decorations with a filled volume. Front inlays must be visible on the exterior and supported from below. Avoid complicated side attachments when an upright inlay expresses the same feature. Do not simplify the subject to a plain rectangular tower during validation repairs. Repair supports or placement while retaining the requested visible colours and recognizable features.
Use only listed part/color combinations. Output the entire replacement program for this module only.`

const buildingToolInstructions = `This module uses the building tool. Return exactly:
{"commands":[{"kind":"building","at":[0,0,0],"width":16,"wallCourses":8,"wallColor":"tan","roofColor":"gray","windowColor":"black","trimColor":"white","baseColor":"gray"}]}.
Choose width 8 or 16 and wallCourses 6–10 based on the design. Colour parameters may use tan, gray, black, white, brown, red, blue, yellow or green. Use exact colour ids.
The tool itself creates every real part of the connected foundation, walls, glazing, buttresses, ceiling and roof. Do not expand it into individual brick commands. Output exactly ONE building command and no additional commands. at is relative to the module origin. The base footprint is (width+4) x 12 studs. A width16/eight-course hall expands to approximately 430 pieces. Your responsibility here is choosing parameters, not calculating brick positions.`

const sculptureToolInstructions = `This module uses the sculpture tool. Return ONE sculpture-shapes command in a commands array. Describe a real three-dimensional sculpture using intersecting ellipsoids and boxes, then paint visible features onto its curved front surface. The compiler samples curved solids with thin plates (0.4 studs tall), tiles them with real LEGO parts and checks their support.
Format example (adapt every dimension, colour and feature to the actual requested subject):
{"commands":[{"kind":"sculpture-shapes","at":[0,0,0],"size":[16,21,12],"solids":[{"name":"body","shape":"ellipsoid","center":[8,7,6],"size":[10,10,9],"color":"yellow"},{"name":"head","shape":"ellipsoid","center":[8,14,6],"size":[14,12,10],"color":"yellow"},{"name":"feet","shape":"box","center":[8,1,7],"size":[10,2,8],"color":"brown"}],"features":[{"name":"left pupil","on":"head","shape":"ellipse","center":[5.5,16],"size":[1.5,1.5],"color":"black"},{"name":"right pupil","on":"head","shape":"ellipse","center":[10.5,16],"size":[1.5,1.5],"color":"black"}]}]}.
All sizes and coordinates are in studs, with Y up. size is the complete [width,height,depth] bounding box, at most 24x32x24. Solids use their geometric CENTRES and full [width,height,depth] dimensions. Keep them inside the bounds. Use 1–32 named solids, each ellipsoid or box. Later solids replace earlier material where they intersect. Use separate overlapping volumes for the head, torso, arms/hands, feet and protruding details. For paired feet, leave at least a 2-stud visible ground-level gap and connect them through the torso above. Ground-touching feet should have flat box bottoms at Y=0. Overlap feet/legs, legs/body, neck/head and arms/body generously so layers can bond. Do not leave gaps between volumes or use tiny point contacts. Avoid a long thin neck unless the subject has one.
Choose proportions from the requested subject. Preserve its wide/narrow head, short/long body, projecting hands, separate feet and rounded silhouette. Include the recognizable anatomy and clothing. Do not turn the figure into an upright rectangular plaque. A typical detailed figure uses width 16–20, depth 10–14 and height 20–26 studs, with at most 2048 real parts. Keep enough depth to show three-dimensional form from the side.
features is an ordered array of up to 48 visible front-surface markings. Each requires a unique name, on (the named solid), shape ellipse/rectangle, center [X,Y], full size [width,height] and colour. Front is maximum Z. Markings project onto the front of their named solid, following its curvature. Later markings paint over earlier ones. The compiler REJECTS markings that are entirely hidden, too small to produce a visible cell, or overpainted by later markings. Use large face/belly inlays first, then eye whites, pupils, nose/mouth/whiskers and small accents. Eye pupils need at least 1–1.5 studs width to survive sampling. Paired pupils must retain at least ONE WHITE STUD COLUMN between their black pixels: keep their centres at least 3 studs apart for 1–1.5-stud pupils. Avoid a single connected black bar across both eyes. Thin mouth/whisker strokes are snapped to the 1-stud horizontal and 0.4-stud vertical plate resolution. Distinct eye whites need separate outlines or contrast against a white face. Use thin rectangles for mouth lines and whiskers. Put the head's face near the middle/upper head, and the collar/bell on the torso directly below it. Named features must be visible on their target solid, not covered by another solid.
List ALL requested identifying features and required colours in the program. A colour hidden inside the model does not satisfy a visible feature. Keep the same anatomy and face when repairing a structural issue. Return only the complete JSON program, with no raw brick enumeration or voxel-layer grids.`

const compileVoxelLayers = (command: Record<string, unknown>) => {
  const at = point(command.at)
  if (!record(command.palette) || !Array.isArray(command.layers) || !command.layers.length || command.layers.length > 32) {
    throw new Error('Voxel layers require a palette and 1–32 layers.')
  }
  const palette = command.palette
  for (const [symbol, color] of Object.entries(palette)) {
    if (symbol.length !== 1 || symbol === '.' || !brickById.get('brick-1x1')!.colors.includes(color as BrickColor)) {
      throw new Error('Voxel palette symbols must be single characters mapped to legal brick colours. A dot means empty.')
    }
  }
  const result: Record<string, unknown>[] = []
  let course = 0
  for (const layer of command.layers) {
    if (!record(layer) || !Array.isArray(layer.rows) || !layer.rows.length || layer.rows.length > 32
      || !layer.rows.every(row => typeof row === 'string' && row.length > 0 && row.length <= 32 && row.length === layer.rows[0].length)) {
      throw new Error('Each voxel layer requires equal-width rows of at most 32 cells, ordered from back to front.')
    }
    const rows = layer.rows as string[]
    const repeat = layer.repeat ?? 1
    if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1 || repeat > 16 || course + repeat > 64) {
      throw new Error('Voxel layer repetition must be 1–16, with at most 64 courses.')
    }
    for (const row of rows) {
      if ([...row].some(symbol => symbol !== '.' && palette[symbol] === undefined)) throw new Error('Unknown voxel palette symbol.')
    }
    for (let copy = 0; copy < repeat; copy++, course++) {
      // Alternate brick directions to bond neighbouring rows across courses.
      const alongZ = course % 2 === 1
      const lineCount = alongZ ? rows[0].length : rows.length
      const lineLength = alongZ ? rows.length : rows[0].length
      for (let line = 0; line < lineCount; line++) {
        const cell = (index: number) => alongZ ? rows[index][line] : rows[line][index]
        for (let index = 0; index < lineLength;) {
          const symbol = cell(index)
          if (symbol === '.') { index++; continue }
          const runStarts = index === 0 || cell(index - 1) !== symbol
          const maxLength = course % 4 >= 2 && runStarts ? 2 : 4
          let length = 1
          while (length < maxLength && index + length < lineLength && cell(index + length) === symbol) length++
          const x = alongZ ? line : index
          const z = alongZ ? index : line
          result.push({ brickId: `brick-1x${length}`, color: palette[symbol],
            at: [at[0] + x, at[1] + course * 1.2, at[2] + z], rotationQuarterTurns: alongZ ? 1 : 0 })
          if (result.length > assemblyLimits.moduleBricks) throw new Error('Assembly part budget exceeded.')
          index += length
        }
      }
    }
  }
  if (!result.length) throw new Error('Voxel layers must contain at least one occupied cell.')
  return result
}

const compileRoof = (command: Record<string, unknown>) => {
  const at = point(command.at)
  const size = command.size
  const tiers = command.tiers
  if (!Array.isArray(size) || size.length !== 2 || !size.every(n => Number.isInteger(n) && n >= 1 && n <= 32)
    || typeof tiers !== 'number' || !Number.isInteger(tiers) || tiers < 1 || tiers > 16
    || !['gable', 'pyramid'].includes(String(command.style))) throw new Error('Invalid stepped roof dimensions or style.')
  const result: Record<string, unknown>[] = []
  for (let tier = 0; tier < tiers; tier++) {
    const insetX = command.style === 'pyramid' ? tier : 0
    const width = size[0] - insetX * 2
    const depth = size[1] - tier * 2
    if (width < 1 || depth < 1) throw new Error('Roof tiers exceed the available footprint.')
    const position = [at[0] + insetX, at[1] + tier * 1.2, at[2] + tier]
    if (width >= 2) result.push({ brickId: 'brick-1x2', color: command.color, at: position,
      repeat: { count: [Math.floor(width / 2), 1, depth], step: [2, 0, 1] } })
    if (width % 2) result.push({ brickId: 'brick-1x1', color: command.color, at: [position[0] + width - 1, position[1], position[2]],
      repeat: { count: [1, 1, depth], step: [0, 0, 1] } })
  }
  return result
}

const compileBuilding = (command: Record<string, unknown>) => {
  const at = point(command.at)
  const width = command.width
  const courses = command.wallCourses
  if ((width !== 8 && width !== 16) || typeof courses !== 'number' || !Number.isInteger(courses) || courses < 6 || courses > 10) {
    throw new Error('Building width must be 8 or 16 studs and wallCourses must be 6–10. Its hall depth is 8 studs, with a two-stud base margin.')
  }
  const result: Record<string, unknown>[] = []
  const add = (brickId: string, color: unknown, x: number, y: number, z: number, rotation = 0) => {
    result.push({ brickId, color, at: [at[0] + x, at[1] + y, at[2] + z], rotationQuarterTurns: rotation })
  }
  // Stagger seams in both axes so the two plate courses form one connected base.
  for (let layer = 0; layer < 2; layer++) {
    for (let z = 0; z < 12;) {
      const depth = layer === 1 && (z === 0 || z === 11) ? 1 : 2
      for (let x = 0; x < width + 4;) {
        const length = layer === 1 && (x === 0 || x === width + 2) ? 2 : 4
        const id = depth === 2 ? (length === 4 ? 'plate-2x4' : 'plate-2x2') : (length === 4 ? 'plate-1x4' : 'plate-1x2')
        add(id, command.baseColor, x, layer * 0.4, z)
        x += length
      }
      z += depth
    }
  }
  for (let course = 0; course < courses; course++) {
    const y = 0.8 + course * 1.2
    for (const z of [2, 9]) {
      // Centre the doorway and window bays instead of offsetting them by a brick.
      if (width === 16 && (course >= 3 && course <= 5 || z === 2 && course < 3)) {
        const doorway = z === 2 && course < 3
        const lengths = doorway ? [2, 4, 4, 4, 2] : [2, 2, 3, 2, 3, 2, 2]
        let x = 2
        for (const [index, length] of lengths.entries()) {
          const glazed = doorway ? index === 2 : index === 1 || index === 3 || index === 5
          add(`brick-1x${length}`, glazed ? command.windowColor : command.wallColor, x, y, z)
          x += length
        }
      } else {
        for (let x = 0; x < width; x += 2) {
          const door = z === 2 && x === width / 2 && course < 3
          const window = course >= 2 && course <= 4 && x % 4 === 2
          add('brick-1x2', door || window ? command.windowColor : command.wallColor, x + 2, y, z)
        }
      }
    }
    for (const x of [2, width + 1]) {
      for (let z = 3; z < 9; z += 2) {
        const window = course >= 2 && course <= 4 && z === 5
        add('brick-1x2', window ? command.windowColor : command.wallColor, x, y, z, 1)
      }
    }
    const pilasters = width === 16 ? [2, 6, 13, 17] : [2, 9]
    for (const x of pilasters) add('brick-1x1', command.trimColor, x, y, 1)
  }
  const ceilingY = 0.8 + courses * 1.2
  for (let x = 0; x < width; x += 8) {
    add('plate-4x8', command.trimColor, x + 2, ceilingY, 2)
    add('plate-4x8', command.trimColor, x + 2, ceilingY, 6)
  }
  const roof = compileRoof({ kind: 'stepped-roof', at: [at[0] + 2, at[1] + ceilingY + 0.4, at[2] + 2], size: [width, 8], tiers: 4, style: 'gable', color: command.roofColor })
  return [...result, ...roof]
}

export const expandAssemblyProgram = (value: unknown, origin: Point, inventory: Record<string, number> = {}, accepted: PlacedBrick[] = []): PlacedBrick[] => {
  if (!record(value) || !Array.isArray(value.commands) || !value.commands.length || value.commands.length > assemblyLimits.commands) {
    throw new Error('Module program must contain 1–128 commands.')
  }
  const moduleLimit = value.commands.some(command => record(command) && command.kind === 'sculpture-shapes')
    ? assemblyLimits.sculptureBricks : assemblyLimits.moduleBricks
  const placed: PlacedBrick[] = []
  const used = new Map<string, number>()
  for (const brick of accepted) used.set(brick.brickId, (used.get(brick.brickId) ?? 0) + 1)
  const commands = value.commands.flatMap(command => {
    if (!record(command)) return [command]
    if (command.kind === 'stepped-roof') return compileRoof(command)
    if (command.kind === 'building') return compileBuilding(command)
    if (command.kind === 'sculpture-shapes') return tileSculptureLayers(createSculptureLayers(command), moduleLimit)
    if (command.kind === 'voxel-layers') return compileVoxelLayers(command)
    return [command]
  })
  for (const command of commands) {
    if (!record(command) || typeof command.brickId !== 'string') throw new Error('Invalid part command.')
    const definition = brickById.get(command.brickId)
    if (!definition || definition.pack !== 'lego') throw new Error(`Unknown part id: ${command.brickId}. Select an exact id from Available parts.`)
    if (!definition.colors.includes(command.color as BrickColor)) throw new Error(`Part ${command.brickId} does not support colour ${String(command.color)}. Allowed colours: ${definition.colors.join(', ')}.`)
    const at = point(command.at)
    const rotation = command.rotationQuarterTurns ?? 0
    const vertical = command.verticalQuarterTurns ?? 0
    if (![rotation, vertical].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 3)) throw new Error('Invalid quarter turn.')
    let count: Point = [1, 1, 1]
    let step: Point = [0, 0, 0]
    if (command.repeat !== undefined) {
      if (!record(command.repeat)) throw new Error('Invalid repetition.')
      count = point(command.repeat.count)
      step = point(command.repeat.step)
      if (!count.every((n, axis) => Number.isInteger(n) && n >= 1 && n <= assemblyLimits.moduleBricks && (n === 1 || step[axis] !== 0))) throw new Error('Invalid repeat count or spacing.')
    }
    const amount = count[0] * count[1] * count[2]
    if (placed.length + amount > moduleLimit || accepted.length + placed.length + amount > assemblyLimits.bricks) throw new Error('Assembly part budget exceeded.')
    const total = (used.get(definition.id) ?? 0) + amount
    if (total > (inventory[definition.id] ?? definition.inventory)) throw new Error(`Inventory exceeded: ${definition.id}`)
    used.set(definition.id, total)
    for (let x = 0; x < count[0]; x++) {
      for (let y = 0; y < count[1]; y++) {
        for (let z = 0; z < count[2]; z++) {
          const index = [x, y, z]
          const position = at.map((n, axis) => n + origin[axis] + index[axis] * step[axis]) as Point
          if (position[1] < 0 || !position.every(n => Number.isFinite(n) && Math.abs(n) <= 1024)) {
            throw new Error('Part position is outside the assembly bounds.')
          }
          const brick = makeBrick(definition.id, command.color as BrickColor, ...position, rotation as number, vertical as number)
          const actual = [brick.pose.xStud, brick.pose.yStud, brick.pose.zStud]
          if (actual.some((n, axis) => Math.abs(n - position[axis]) > 0.000001)) {
            throw new Error('Part coordinates must use the 0.1-stud grid.')
          }
          placed.push(brick)
        }
      }
    }
  }
  return placed
}

const hasSculptureShapes = (program: unknown) => record(program) && Array.isArray(program.commands)
  && program.commands.some(command => record(command) && command.kind === 'sculpture-shapes')

const expandModuleProgram = async (program: unknown, origin: Point, inventory: Record<string, number> | undefined, accepted: PlacedBrick[], signal?: AbortSignal): Promise<PlacedBrick[]> => {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined' || !hasSculptureShapes(program)) return expandAssemblyProgram(program, origin, inventory, accepted)
  const worker = new Worker(new URL('../workers/llmAssemblyWorker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Generation canceled', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<{ bricks?: PlacedBrick[]; error?: string }>) => {
      cleanup()
      if (data.bricks) resolve(data.bricks)
      else reject(new Error(data.error ?? 'Sculpture compilation failed'))
    }
    worker.onerror = () => { cleanup(); reject(new Error('Sculpture worker failed')) }
    worker.onmessageerror = () => { cleanup(); reject(new Error('Sculpture worker response failed')) }
    worker.postMessage({ args: [program, origin, inventory, accepted] })
  })
}

export const generateAssembly = async (
  layout: AssemblyLayout,
  base: Pick<BuildPlan, 'prompt' | 'imageName'>,
  request: RequestModule,
  signal: AbortSignal | undefined,
  inventory: Record<string, number> | undefined,
  retries: number,
  locale: 'zh-CN' | 'en-US',
  checkpoint?: { programs: unknown[]; save: (programs: unknown[]) => void; onProgress?: (plan: BuildPlan) => void | Promise<void>; onDraft?: (plan: BuildPlan) => void },
): Promise<BuildPlan> => {
  const plan: BuildPlan = { ...base, id: createId('plan'), title: layout.title, source: 'llm', bricks: [], steps: [], structures: [] }
  const acceptedPrograms: Array<{ module: Module; program: unknown }> = []
  for (const [moduleIndex, module] of layout.modules.entries()) {
    const context = `Design: ${JSON.stringify(layout)}\nCurrent module: ${JSON.stringify(module)}\nAccepted programs (expand using each module origin): ${JSON.stringify(acceptedPrograms)}\n${module.tool === 'building' ? buildingToolInstructions : module.tool === 'sculpture' ? sculptureToolInstructions : assemblyProgramInstructions}`
    const publishDraft = (program: unknown) => {
      signal?.throwIfAborted()
      if (!checkpoint?.onDraft) return
      if (hasSculptureShapes(program)) return
      try {
        const bricks = expandAssemblyProgram(program, module.origin, inventory, plan.bricks)
        bricks.forEach((brick, index) => { brick.id = `draft-${plan.id}-${moduleIndex}-${index}` })
        checkpoint.onDraft({ ...plan, bricks: [...plan.bricks, ...bricks], structures: [...plan.structures!], steps: [] })
      } catch { /* Incomplete or invalid commands cannot become preview geometry. */ }
    }
    let feedback = ''
    let previous: unknown
    const initialProgram = checkpoint && moduleIndex < checkpoint.programs.length ? checkpoint.programs[moduleIndex] : module.program
    for (let attempt = initialProgram !== undefined ? -1 : 0; ; attempt++) {
      signal?.throwIfAborted()
      let program: unknown
      try {
        program = attempt < 0
          ? initialProgram
          : await request(`${context}${feedback ? `\nPrevious module program: ${JSON.stringify(previous)}\nFix these issues while preserving its intended design: ${feedback}` : ''}`, module.tool, publishDraft)
        signal?.throwIfAborted()
        if (module.tool === 'building' && (!record(program) || !Array.isArray(program.commands) || program.commands.length !== 1 || !record(program.commands[0]) || program.commands[0].kind !== 'building')) {
          throw new Error('Use exactly one kind:"building" tool command. Do not expand the tool into raw bricks.')
        }
        if (module.tool === 'sculpture' && (!record(program) || !Array.isArray(program.commands) || program.commands.length !== 1 || !record(program.commands[0]) || !['sculpture-shapes', 'voxel-layers'].includes(String(program.commands[0].kind)))) {
          throw new Error('Use exactly one sculpture-shapes command wrapped in {"commands":[...]}. Describe colour grids, not individual bricks.')
        }
        const bricks = await expandModuleProgram(program, module.origin, inventory, plan.bricks, signal)
        const usedColors = new Set<string>(bricks.map(brick => brick.color))
        const missingColors = module.requiredColors?.filter(color => !usedColors.has(color)) ?? []
        if (missingColors.length) throw new Error(`Missing required visible colours: ${missingColors.join(', ')}. Restore the identifying features described for this module using these colours as exterior inlays. Do not remove them during structural repairs.`)
        const candidate = { ...plan, bricks: [...plan.bricks, ...bricks], steps: createSingleBrickSteps([...plan.bricks, ...bricks]) }
        const issues = validateBuildPlan(candidate)
        if (issues.length) {
          const byId = new Map(candidate.bricks.map(brick => [brick.id, brick]))
          const detail = (id: string) => {
            const brick = byId.get(id)
            return brick ? { part: brick.brickId, at: [brick.pose.xStud, brick.pose.yStud, brick.pose.zStud], rotation: brick.pose.rotationQuarterTurns, accepted: plan.bricks.includes(brick) } : id
          }
          const examples = issues.slice(0, 24).map(issue => ({
            type: issue.type,
            parts: issue.type === 'collision' ? issue.brickIds.map(detail) : [detail(issue.brickId)],
          }))
          throw new Error(`${summarizeBuildPlanIssues(issues, locale)}\nExact failing parts in WORLD coordinates: ${JSON.stringify(examples)}`)
        }
        acceptedPrograms.push({ module, program })
        checkpoint?.save(acceptedPrograms.map(item => item.program))
        plan.bricks = candidate.bricks
        plan.structures!.push({ id: createId('structure'), name: module.name, description: module.description, brickIds: bricks.map(b => b.id) })
        break
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof LlmServiceError || error instanceof LlmOutputLimitError && error.reasoningOnly) throw error
        checkpoint?.onDraft?.({ ...plan, bricks: [...plan.bricks], structures: [...plan.structures!], steps: [] })
        if (attempt < 0) checkpoint?.programs.splice(moduleIndex)
        if (attempt >= retries) throw new Error(`${module.name}: ${error instanceof Error ? error.message : String(error)}`)
        if (program !== undefined) previous = program
        feedback = error instanceof Error ? error.message : String(error)
      }
    }
    signal?.throwIfAborted()
    await checkpoint?.onProgress?.({ ...plan, bricks: [...plan.bricks], structures: [...plan.structures!], steps: createSingleBrickSteps(plan.bricks) })
    signal?.throwIfAborted()
  }
  plan.steps = createSingleBrickSteps(plan.bricks)
  return plan
}
