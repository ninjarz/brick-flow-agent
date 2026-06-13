import * as esbuild from 'esbuild'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const classic10696PartNumbers = [
  '44728', '3005', '30236', '3062', '92947', '98100', '3020', '63868',
  '3184', '2926', '4600', '4073', '2479', '3040', '3665', '87414',
  '87697', '61254', '60032', '3010', '3001', '3031', '87580', '3039',
  '88930', '93273', '3660', '92438', '3004', '87087', '3710', '3032',
  '87079', '4070', '30000', '4589', '3036', '3659', '60481', '54200',
  '3003', '6091', '3941', '3023', '3037', '3021', '3034', '4286',
  '61678', '85984', '3007', '98263', '4460', '3684', '50950', '2412',
  '3679', '4624', '6014', '13971', '3795', '2431', '3009', '3666',
  '3622', '3002', '96874', '15573', '3747', '3022', '11477', '6215',
  '3680', '94161', '6232', '3623', '30044', '3065', '88292', '49668',
  '60478', '75937', '15397', '98138',
  '30414', '3035', '61252', '64799', '4032', '3069', '67737', '34337',
  '98138',
]

const workspace = process.cwd()
const tempDir = await mkdtemp(join(tmpdir(), 'brick-flow-agent-validate-'))
const entry = join(tempDir, 'entry.ts')
const outfile = join(tempDir, 'entry.mjs')
const ldrawConfigSource = await readFile(join(workspace, 'public/ldraw/LDConfig.ldr'), 'utf8')

await writeFile(entry, `
  import { brickById, brickDefinitions } from ${JSON.stringify(`${workspace}/src/data/basicBricks.ts`)};
  import { officialPartColorsByPartNumber } from ${JSON.stringify(`${workspace}/src/data/officialPartColors.ts`)};
  import { defaultFinishedAssets } from ${JSON.stringify(`${workspace}/src/lib/finishedAssets.ts`)};
  import { generateBuildPlan } from ${JSON.stringify(`${workspace}/src/lib/localGenerator.ts`)};
  import { buildLlmUserPrompt, maxLlmBricks } from ${JSON.stringify(`${workspace}/src/lib/llmGenerator.ts`)};
  import { getBrickConnectors } from ${JSON.stringify(`${workspace}/src/lib/brickUnits.ts`)};
  import { serializeBuildManual } from ${JSON.stringify(`${workspace}/src/lib/manualSerializer.ts`)};
  import { normalizeImportedPlan, normalizeImportedPose, tryNormalizeImportedPlan } from ${JSON.stringify(`${workspace}/src/lib/planImport.ts`)};
  import { findNearestOpenPoseAround, findOpenPose, getBlockingBuildPlanIssues, hasBrickCollision, isBrickAboveGround, isBrickSupported, summarizeBuildPlanIssues, validateBuildPlan } from ${JSON.stringify(`${workspace}/src/lib/planUtils.ts`)};
  import { createLDrawStudConnector, ldrawPointToBrickLocal } from ${JSON.stringify(`${workspace}/src/lib/ldrawConnectors.ts`)};
  import { parseLDrawColorDefinitions } from ${JSON.stringify(`${workspace}/src/lib/ldrawColors.ts`)};
  import { loadLDrawGeneratedVisual } from ${JSON.stringify(`${workspace}/src/lib/ldrawGeneratedVisualLoader.ts`)};
  import { getBrickLocalBounds, getBrickWorldBounds } from ${JSON.stringify(`${workspace}/src/lib/ldrawBounds.ts`)};
  import { getBrickStructuralCells } from ${JSON.stringify(`${workspace}/src/lib/structuralGrid.ts`)};
  import {
    createCurvedSlope1x2Geometry,
    createCurvedSlope1x2OutlineGeometry,
    createCurvedSlope3x1Geometry,
    createCurvedSlope3x1OutlineGeometry,
    createInvertedSlope45Geometry,
    createSlope45Geometry,
  } from ${JSON.stringify(`${workspace}/src/lib/slopeGeometries.ts`)};

  await loadLDrawGeneratedVisual();

  const results = defaultFinishedAssets.map((asset) => {
    const plan = asset.plan;
    const planIssues = validateBuildPlan(plan);
    const planBlockingIssues = getBlockingBuildPlanIssues(planIssues);
    const planRoundTripIssues = validateBuildPlan(normalizeImportedPlan(JSON.parse(JSON.stringify(plan))));
    const planRoundTripBlockingIssues = getBlockingBuildPlanIssues(planRoundTripIssues);
    const manual = serializeBuildManual(plan);
    const manualPlan = {
      id: manual.planId,
      title: manual.title,
      prompt: manual.prompt,
      source: manual.source,
      bricks: manual.steps.flatMap((step) =>
        step.addPieces.map((piece) => ({
          id: piece.instanceId,
          brickId: piece.brickId,
          color: piece.color,
          pose: piece.pose,
        })),
      ),
      steps: manual.steps.map((step) => ({
        id: 'manual-step-' + step.stepNumber,
        title: step.title,
        description: step.description,
        brickIds: step.addPieces.map((piece) => piece.instanceId),
      })),
    };
    const manualRoundTripIssues = validateBuildPlan(normalizeImportedPlan(manualPlan));
    const manualRoundTripBlockingIssues = getBlockingBuildPlanIssues(manualRoundTripIssues);
    const invalidManualSteps = manual.steps.filter((step) => !step.validation.ok);

    return {
      assetId: asset.id,
      title: plan.title,
      pieces: plan.bricks.length,
      planIssues,
      planBlockingIssues,
      planRoundTripIssues,
      planRoundTripBlockingIssues,
      manualSchema: manual.schemaVersion,
      manualRoundTripIssues,
      manualRoundTripBlockingIssues,
      invalidManualSteps,
      summary: {
        plan: summarizeBuildPlanIssues(planIssues),
        planRoundTrip: summarizeBuildPlanIssues(planRoundTripIssues),
        manualRoundTrip: summarizeBuildPlanIssues(manualRoundTripIssues),
      },
    };
  });

  const distance = (source, target) => Math.sqrt(
    Math.pow(source.pose.xStud - target.pose.xStud, 2) +
    Math.pow(source.pose.yStud - target.pose.yStud, 2) +
    Math.pow(source.pose.zStud - target.pose.zStud, 2),
  );

  const directionDot = (source, target) =>
    source.direction.x * target.direction.x +
    source.direction.y * target.direction.y +
    source.direction.z * target.direction.z;

  const getDefinition = (brickId) => {
    const definition = brickById.get(brickId);
    if (!definition) throw new Error('Missing brick definition: ' + brickId);
    return definition;
  };
  const partNumbers = new Set(brickDefinitions.map((brick) => brick.partNumber));
  const legoPartNumbers = new Set(brickDefinitions.filter((brick) => brick.pack === 'lego').map((brick) => brick.partNumber));
  const missingOfficialColorPartNumbers = [...legoPartNumbers].filter((partNumber) =>
    !officialPartColorsByPartNumber[partNumber]?.length,
  );
  const emptyColorDefinitionIds = brickDefinitions
    .filter((brick) => brick.colors.length === 0)
    .map((brick) => brick.id);
  const defaultAssetIds = defaultFinishedAssets.map((asset) => asset.id);
  const duplicateDefaultAssetIds = defaultAssetIds.filter((id, index, ids) => ids.indexOf(id) !== index);
  const expectedDefaultAssetIds = new Set([
    'finished-ghost',
    'finished-bridge',
    'finished-house',
    'finished-castle',
    'finished-bench',
    'finished-rocket',
    'finished-flower',
    'finished-robot',
    'finished-tree',
    'finished-duck',
  ]);
  const expectedDefaultAssetPieceCounts = {
    'finished-ghost': 26,
    'finished-bridge': 19,
    'finished-house': 19,
    'finished-castle': 20,
    'finished-bench': 18,
    'finished-rocket': 19,
    'finished-flower': 19,
    'finished-robot': 18,
    'finished-tree': 19,
    'finished-duck': 19,
  };
  const retiredDefaultAssetIds = new Set([
    'finished-tiger',
    'finished-toaster',
    'finished-windmill',
    'finished-plane',
    'finished-window-house',
    'finished-spinner',
    'finished-arch-gate',
  ]);
  const unexpectedDefaultAssetIds = defaultAssetIds.filter((id) => !expectedDefaultAssetIds.has(id));
  const missingDefaultAssetIds = [...expectedDefaultAssetIds].filter((id) => !defaultAssetIds.includes(id));
  const resurfacedRetiredDefaultAssetIds = defaultAssetIds.filter((id) => retiredDefaultAssetIds.has(id));
  const nonGhostClassicDefaultAssets = defaultFinishedAssets.filter((asset) =>
    asset.category === 'Classic' && asset.id !== 'finished-ghost',
  );
  const changedDefaultAssetPieceCounts = defaultFinishedAssets
    .map((asset) => ({
      id: asset.id,
      expected: expectedDefaultAssetPieceCounts[asset.id],
      actual: asset.plan.bricks.length,
    }))
    .filter((item) => item.expected !== undefined && item.actual !== item.expected);
  const retiredLocalGeneratorTitles = new Set([
    'Classic 小老虎',
    'Classic 小烤面包机',
    'Classic 小风车',
    'Classic 小飞机',
    'Classic 小窗房',
    'Classic 小转盘',
    'Classic 小拱门',
  ]);
  const retiredPromptResults = [
    '一个 Classic 小老虎',
    '一个 Classic 小烤面包机',
    '一个 Classic 小风车',
    '一个 Classic 小飞机',
    '一个 Classic 小窗房',
    '一个 Classic 小转盘',
    '一个 Classic 小拱门',
  ].map((prompt) => ({
    prompt,
    title: generateBuildPlan({ prompt }).title,
  }));
  const resurfacedRetiredPrompts = retiredPromptResults.filter((result) =>
    retiredLocalGeneratorTitles.has(result.title),
  );
  const ghostReferencePlan = generateBuildPlan({ prompt: '一个 Classic 小幽灵' });
  const llmPrompt = buildLlmUserPrompt({ prompt: 'test prompt' });
  const llmPromptGhostExampleMatch = llmPrompt.match(/Good official-replica example[\\s\\S]*?\\n(\\{[\\s\\S]*\\})$/);
  const llmPromptGhostExample = llmPromptGhostExampleMatch ? JSON.parse(llmPromptGhostExampleMatch[1]) : undefined;
  const duplicateDefinitionIds = brickDefinitions
    .map((brick) => brick.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  const missing10696PartNumbers = ${JSON.stringify(classic10696PartNumbers)}.filter((partNumber) =>
    !partNumbers.has(partNumber),
  );
  const approx = (source, target) => Math.abs(source - target) <= 0.000001;
  const hasVertex = (geometry, expected) => {
    const positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      if (
        approx(positions.getX(index), expected.x) &&
        approx(positions.getY(index), expected.y) &&
        approx(positions.getZ(index), expected.z)
      ) {
        return true;
      }
    }
    return false;
  };
  const slope3040Definition = getDefinition('slope-1x2');
  const slope3040Studs = slope3040Definition.connectors.filter((connector) => connector.kind === 'stud');
  const slope3040WorldStuds = getBrickConnectors(
    slope3040Definition,
    { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  ).filter((connector) => connector.kind === 'stud');
  const slope3040Geometry = createSlope45Geometry(2, 1.2, 1);
  const invertedSlope3665Definition = getDefinition('inverted-slope-1x2');
  const invertedSlope3665Studs = invertedSlope3665Definition.connectors.filter((connector) => connector.kind === 'stud');
  const invertedSlope3665WorldStuds = getBrickConnectors(
    invertedSlope3665Definition,
    { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  ).filter((connector) => connector.kind === 'stud');
  const invertedSlope3665Geometry = createInvertedSlope45Geometry(2, 1.2, 1);
  const curvedSlope50950Definition = getDefinition('slope-curved-3x1');
  const curvedSlope50950Studs = curvedSlope50950Definition.connectors.filter((connector) => connector.kind === 'stud');
  const curvedSlope50950Geometry = createCurvedSlope3x1Geometry(3, 1.2, 1);
  const curvedSlope50950OutlineGeometry = createCurvedSlope3x1OutlineGeometry(3, 1.2, 1);
  const curvedSlope6091Definition = getDefinition('curved-slope-1x2');
  const curvedSlope6091Frame = { minX: -10, maxY: 32, minZ: -30 };
  const curvedSlope6091ConvertedStud = createLDrawStudConnector(
    'test-6091-stud',
    { x: 0, y: 8, z: 0 },
    curvedSlope6091Frame,
  );
  const ldrawColors = parseLDrawColorDefinitions(${JSON.stringify(ldrawConfigSource)});
  const curvedSlope6091Studs = curvedSlope6091Definition.connectors.filter((connector) => connector.kind === 'stud');
  const curvedSlope6091Tubes = curvedSlope6091Definition.connectors.filter((connector) => connector.kind === 'tube');
  const curvedSlope6091WorldStuds = getBrickConnectors(
    curvedSlope6091Definition,
    { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  ).filter((connector) => connector.kind === 'stud');
  const curvedSlope6091WorldTubes = getBrickConnectors(
    curvedSlope6091Definition,
    { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  ).filter((connector) => connector.kind === 'tube');
  const curvedSlope6091Geometry = createCurvedSlope1x2Geometry(2, 1.6, 1);
  const curvedSlope6091OutlineGeometry = createCurvedSlope1x2OutlineGeometry(2, 1.6, 1);
  const curvedSlope6091StructuralCells = getBrickStructuralCells(curvedSlope6091Definition);
  const has6091SolidVoxel = (x, y, z) => curvedSlope6091StructuralCells.some((cell) =>
    cell.kind === 'solid' &&
    cell.minX <= x && cell.maxX > x &&
    cell.minY <= y && cell.maxY > y &&
    cell.minZ <= z && cell.maxZ > z
  );
  const has6091VoxelKind = (kind, x, y, z) => curvedSlope6091StructuralCells.some((cell) =>
    cell.kind === kind &&
    cell.minX <= x && cell.maxX > x &&
    cell.minY <= y && cell.maxY > y &&
    cell.minZ <= z && cell.maxZ > z
  );
  const curvedSlope6091ArcMidpoint = {
    x: -1 + (1 - Math.SQRT1_2),
    y: -0.2 + Math.SQRT1_2,
    z: -0.5,
  };

  const headlightConnector = getBrickConnectors(
    getDefinition('headlight-brick-1x1'),
    { xStud: 3, yStud: 6, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  ).find((connector) =>
    connector.kind === 'stud' &&
    connector.gender === 'male' &&
    connector.axis === 'z' &&
    connector.direction.z < 0
  );
  const eyeConnector = getBrickConnectors(
    getDefinition('tile-eye-1x1'),
    { xStud: 3, yStud: 6.2, zStud: -0.2, rotationQuarterTurns: 0, verticalQuarterTurns: 1 },
  )[0];
  const legacyPose = normalizeImportedPose({ xStud: 1, yPlate: 4, zStud: 2, rotationQuarterTurns: 0 });
  const noisyFloatPose = normalizeImportedPose({
    xStud: 0.39999999999999963,
    yStud: 0.39999999999999963,
    zStud: 0.39999999999999963,
    rotationQuarterTurns: 0,
  });
  const invalidPlan = {
    id: 'invalid-plan',
    title: 'Invalid',
    prompt: '',
    source: 'template-local',
    bricks: [
      {
        id: 'bad-piece',
        brickId: 'brick-1x1',
        color: 'red',
        pose: { xStud: 0, zStud: 0, rotationQuarterTurns: 0 },
      },
    ],
    steps: [],
  };
  const makePlacedBrick = (id, brickId, yStud, color = 'red') => ({
    id,
    brickId,
    color,
    pose: { xStud: 0, yStud, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  });
  const support3005 = makePlacedBrick('support-3005', 'brick-1x1', 0);
  const highEyeTile98138 = makePlacedBrick('eye-tile-high', 'tile-eye-1x1', 1.4, 'white');
  const seatedEyeTile98138 = makePlacedBrick('eye-tile-seated', 'tile-eye-1x1', 1.2, 'white');
  const highStacked3005 = makePlacedBrick('stacked-3005-high', 'brick-1x1', 1.4);
  const seatedStacked3005 = makePlacedBrick('stacked-3005-seated', 'brick-1x1', 1.2);
  const flippedGround3005 = {
    ...makePlacedBrick('flipped-ground-3005', 'brick-1x1', 0),
    pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 2 },
  };
  const liftedFlippedGround3005 = findOpenPose(flippedGround3005, []);
  const blockedRotation3005 = {
    ...makePlacedBrick('blocked-rotation-3005', 'brick-1x1', 0),
    pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 1, verticalQuarterTurns: 0 },
  };
  const blockingRotation3005 = {
    ...makePlacedBrick('blocking-rotation-3005', 'brick-1x1', 0),
    pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  };
  const relocatedRotation3005 = findNearestOpenPoseAround(blockedRotation3005, [blockingRotation3005], { radiusStuds: 1 });
  const minecraftBlockDefinition = getDefinition('minecraft-basic-block');
  const minecraftBlockConnectors = minecraftBlockDefinition.connectors.filter((connector) => connector.kind === 'studsocket');
  const minecraftBlockStructuralCells = getBrickStructuralCells(minecraftBlockDefinition);
  const hasMinecraftVoxelKind = (kind, x, y, z) => minecraftBlockStructuralCells.some((cell) =>
    cell.kind === kind &&
    cell.minX <= x && cell.maxX > x &&
    cell.minY <= y && cell.maxY > y &&
    cell.minZ <= z && cell.maxZ > z
  );
  const minecraftBaseBlock = makePlacedBrick('minecraft-base', 'minecraft-basic-block', 0, 'green');
  const minecraftTopBlock = makePlacedBrick('minecraft-top', 'minecraft-basic-block', 1, 'green');
  const minecraftSideBaseBlock = {
    ...makePlacedBrick('minecraft-side-base', 'minecraft-basic-block', 1, 'green'),
    pose: { xStud: 0, yStud: 1, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  };
  const minecraftSideBlock = {
    ...makePlacedBrick('minecraft-side', 'minecraft-basic-block', 1, 'green'),
    pose: { xStud: 1, yStud: 1, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  };
  const minecraftOverlapBlock = makePlacedBrick('minecraft-overlap', 'minecraft-basic-block', 0, 'green');
  const clipBarPlan = {
    id: 'clip-bar-regression',
    title: 'Clip Bar Regression',
    prompt: '',
    source: 'template-local',
    bricks: [
      {
        id: 'clip-bar-base',
        brickId: 'plate-2x4',
        color: 'gray',
        pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
      },
      {
        id: 'clip-bar-handle',
        brickId: 'plate-bar-end-1x2',
        color: 'white',
        pose: { xStud: 0, yStud: 0.4, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
      },
      {
        id: 'clip-bar-clip',
        brickId: 'plate-clip-open-1x1',
        color: 'yellow',
        pose: { xStud: 1, yStud: 0.4, zStud: -1.3, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
      },
    ],
    steps: [
      { id: 'clip-bar-step-1', title: 'Base', description: '', brickIds: ['clip-bar-base'] },
      { id: 'clip-bar-step-2', title: 'Bar', description: '', brickIds: ['clip-bar-handle'] },
      { id: 'clip-bar-step-3', title: 'Clip', description: '', brickIds: ['clip-bar-clip'] },
    ],
  };
  const clipBarIssues = validateBuildPlan(clipBarPlan);
  const clipBarBlockingIssues = getBlockingBuildPlanIssues(clipBarIssues);
  const clipBarHandleConnector = getBrickConnectors(
    getDefinition('plate-bar-end-1x2'),
    clipBarPlan.bricks[1].pose,
  ).find((connector) => connector.kind === 'bar');
  const clipBarClipConnector = getBrickConnectors(
    getDefinition('plate-clip-open-1x1'),
    clipBarPlan.bricks[2].pose,
  ).find((connector) => connector.kind === 'bar');
  const pinPropellerPlan = {
    id: 'pin-propeller-regression',
    title: 'Pin Propeller Regression',
    prompt: '',
    source: 'template-local',
    bricks: [
      {
        id: 'pin-propeller-base',
        brickId: 'plate-2x4',
        color: 'gray',
        pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
      },
      {
        id: 'pin-propeller-stack-1',
        brickId: 'brick-2x2',
        color: 'yellow',
        pose: { xStud: 0, yStud: 0.4, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
      },
      {
        id: 'pin-propeller-stack-2',
        brickId: 'brick-2x2',
        color: 'yellow',
        pose: { xStud: 0, yStud: 1.6, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
      },
      {
        id: 'pin-propeller-holder',
        brickId: 'brick-modified-2x2-pin-axle',
        color: 'tan',
        pose: { xStud: 0, yStud: 2.8, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
      },
      {
        id: 'pin-propeller-blade',
        brickId: 'propeller-4-blade-open',
        color: 'black',
        pose: { xStud: -1.5, yStud: 0.9, zStud: -1.4, rotationQuarterTurns: 0, verticalQuarterTurns: 1 },
      },
    ],
    steps: [
      { id: 'pin-propeller-step-1', title: 'Base', description: '', brickIds: ['pin-propeller-base'] },
      { id: 'pin-propeller-step-2', title: 'Stack 1', description: '', brickIds: ['pin-propeller-stack-1'] },
      { id: 'pin-propeller-step-3', title: 'Stack 2', description: '', brickIds: ['pin-propeller-stack-2'] },
      { id: 'pin-propeller-step-4', title: 'Holder', description: '', brickIds: ['pin-propeller-holder'] },
      { id: 'pin-propeller-step-5', title: 'Propeller', description: '', brickIds: ['pin-propeller-blade'] },
    ],
  };
  const pinPropellerIssues = validateBuildPlan(pinPropellerPlan);
  const pinPropellerBlockingIssues = getBlockingBuildPlanIssues(pinPropellerIssues);
  const pinHolderConnector = getBrickConnectors(
    getDefinition('brick-modified-2x2-pin-axle'),
    pinPropellerPlan.bricks[3].pose,
  ).find((connector) => connector.kind === 'pin');
  const propellerHubConnector = getBrickConnectors(
    getDefinition('propeller-4-blade-open'),
    pinPropellerPlan.bricks[4].pose,
  ).find((connector) => connector.kind === 'pin');
  const closedHubConnector = getBrickConnectors(
    getDefinition('propeller-4-blade-closed'),
    { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  ).find((connector) => connector.kind === 'pin');
  const openPropellerDefinition = getDefinition('propeller-4-blade-open');
  const closedPropellerDefinition = getDefinition('propeller-4-blade-closed');
  const openPropellerLocalBounds = getBrickLocalBounds(openPropellerDefinition);
  const closedPropellerFlippedBounds = getBrickWorldBounds(
    closedPropellerDefinition,
    { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 2 },
  );

  const regressionFailures = [
    !headlightConnector ? 'Headlight side stud connector is missing' : '',
    headlightConnector && eyeConnector ? (
      distance(headlightConnector, eyeConnector) > 0.000001
        ? 'Headlight side stud and vertical eye tile tube no longer overlap'
        : ''
    ) : '',
    headlightConnector && eyeConnector && directionDot(headlightConnector, eyeConnector) >= -0.999
      ? 'Headlight side stud and vertical eye tile tube are no longer facing each other'
      : '',
    headlightConnector?.axis !== 'z' || eyeConnector?.axis !== 'z'
      ? 'Headlight eye regression must stay on the Z axis'
      : '',
    legacyPose.yStud !== 1.6
      ? 'Legacy yPlate import no longer converts 4 plates to 1.6 studs'
      : '',
    noisyFloatPose.xStud !== 0.4 || noisyFloatPose.yStud !== 0.4 || noisyFloatPose.zStud !== 0.4
      ? 'Imported noisy floating point pose values must normalize to the nearest edit grid'
      : '',
    tryNormalizeImportedPlan(invalidPlan) !== undefined
      ? 'Invalid imported plans with missing yStud/yPlate should not be normalized'
      : '',
    !clipBarHandleConnector || !clipBarClipConnector
      ? 'Clip/bar regression connectors are missing'
      : '',
    clipBarHandleConnector && clipBarClipConnector && distance(clipBarHandleConnector, clipBarClipConnector) > 0.051
      ? 'Clip/bar regression connectors drifted outside LDraw-derived tolerance'
      : '',
    clipBarHandleConnector && clipBarClipConnector && directionDot(clipBarHandleConnector, clipBarClipConnector) < 0.999
      ? 'Clip/bar regression connectors are no longer coaxial'
      : '',
    clipBarBlockingIssues.length > 0
      ? 'Clip/bar regression plan failed validation: ' + summarizeBuildPlanIssues(clipBarIssues)
      : '',
    !pinHolderConnector || !propellerHubConnector
      ? 'Pin/propeller regression connectors are missing'
      : '',
    !closedHubConnector
      ? '67737 closed hub propeller should expose a pin connector'
      : '',
    openPropellerDefinition.footprint.heightStuds < openPropellerLocalBounds.maxY - 0.000001
      ? '2479 propeller footprint height must cover its LDraw hub and blade geometry'
      : '',
    closedPropellerFlippedBounds.minY < -0.000001
      ? '67737 vertical 180-degree rotation at ground level must not render below ground'
      : '',
    pinHolderConnector && propellerHubConnector && distance(pinHolderConnector, propellerHubConnector) > 0.000001
      ? 'Pin/propeller regression connectors are outside mechanical tolerance'
      : '',
    pinHolderConnector && propellerHubConnector && directionDot(pinHolderConnector, propellerHubConnector) < 0.999
      ? 'Pin/propeller regression connectors are no longer coaxial'
      : '',
    pinPropellerBlockingIssues.length > 0
      ? 'Pin/propeller regression plan failed validation: ' + summarizeBuildPlanIssues(pinPropellerIssues)
      : '',
    duplicateDefinitionIds.length > 0
      ? 'Brick definitions contain duplicate ids: ' + duplicateDefinitionIds.join(', ')
      : '',
    resurfacedRetiredPrompts.length > 0
      ? 'Retired Classic local templates resurfaced: ' + JSON.stringify(resurfacedRetiredPrompts)
      : '',
    !llmPromptGhostExample || llmPromptGhostExample.bricks?.length !== ghostReferencePlan.bricks.length
      ? 'LLM prompt ghost example must be generated from the current Classic ghost plan'
      : '',
    /\bsteps\b/i.test(llmPrompt) || /brickIndexes/.test(llmPrompt)
      ? 'LLM prompt must not mention build steps or brickIndexes'
      : '',
    !llmPrompt.includes('Use 1 to ' + maxLlmBricks + ' bricks.')
      ? 'LLM prompt brick limit must use maxLlmBricks'
      : '',
    llmPrompt.includes('minecraft-basic-block')
      ? 'Default LLM prompt should not include Minecraft parts until generation supports pack selection'
      : '',
    missing10696PartNumbers.length > 0
      ? '10696 part coverage is missing: ' + missing10696PartNumbers.join(', ')
      : '',
    missingOfficialColorPartNumbers.length > 0
      ? 'Official color data is missing for part numbers: ' + missingOfficialColorPartNumbers.join(', ')
      : '',
    emptyColorDefinitionIds.length > 0
      ? 'Brick definitions have no available colors: ' + emptyColorDefinitionIds.join(', ')
      : '',
    minecraftBlockDefinition.pack !== 'minecraft' || minecraftBlockDefinition.kind !== 'block'
      ? 'Minecraft basic block must live in the Minecraft pack as block kind'
      : '',
    minecraftBlockDefinition.footprint.widthStuds !== 1 ||
      minecraftBlockDefinition.footprint.depthStuds !== 1 ||
      minecraftBlockDefinition.footprint.heightStuds !== 1
      ? 'Minecraft basic block must be exactly 1 x 1 x 1 studs / 5 x 5 x 5 voxels'
      : '',
    minecraftBlockConnectors.length !== 6 ||
      minecraftBlockConnectors.some((connector) => connector.gender !== 'bidirectional')
      ? 'Minecraft basic block must expose six bidirectional studsocket faces'
      : '',
    !hasMinecraftVoxelKind('studsocket', 0.5, 0.9, 0.5) ||
      !hasMinecraftVoxelKind('studsocket', 0.5, 0.1, 0.5) ||
      !hasMinecraftVoxelKind('studsocket', 0.9, 0.5, 0.5) ||
      !hasMinecraftVoxelKind('studsocket', 0.1, 0.5, 0.5) ||
      !hasMinecraftVoxelKind('studsocket', 0.5, 0.5, 0.9) ||
      !hasMinecraftVoxelKind('studsocket', 0.5, 0.5, 0.1)
      ? 'Minecraft basic block structural grid must mark all six face connector voxels'
      : '',
    hasBrickCollision(minecraftTopBlock, [minecraftBaseBlock])
      ? 'Minecraft blocks should not collide when touching top-to-bottom'
      : '',
    !hasBrickCollision(minecraftOverlapBlock, [minecraftBaseBlock])
      ? 'Minecraft blocks must collide when fully overlapped'
      : '',
    !isBrickSupported(minecraftTopBlock, [minecraftBaseBlock, minecraftTopBlock])
      ? 'Minecraft top block should be supported by the block below'
      : '',
    !isBrickSupported(minecraftSideBlock, [minecraftSideBaseBlock, minecraftSideBlock])
      ? 'Minecraft side block should be supported by a horizontal studsocket connection'
      : '',
    slope3040Definition.partNumber !== '3040'
      ? '3040 slope must keep the user-facing common part number 3040'
      : '',
    slope3040Studs.length !== 1
      ? '3040 slope must expose exactly one high-end top stud'
      : '',
    !slope3040WorldStuds[0] ||
      !approx(slope3040WorldStuds[0].pose.xStud, 1.5) ||
      !approx(slope3040WorldStuds[0].pose.yStud, 1.2) ||
      !approx(slope3040WorldStuds[0].pose.zStud, 0.5)
      ? '3040 slope top stud drifted from the LDraw high-end position'
      : '',
    !hasVertex(slope3040Geometry, { x: -1, y: -0.4, z: -0.5 }) ||
      !hasVertex(slope3040Geometry, { x: 0, y: 0.6, z: -0.5 }) ||
      !hasVertex(slope3040Geometry, { x: 1, y: 0.6, z: -0.5 })
      ? '3040 slope profile must keep the LDraw low-end rise and one-stud high platform'
      : '',
    invertedSlope3665Definition.partNumber !== '3665'
      ? '3665 inverted slope must keep the user-facing common part number'
      : '',
    invertedSlope3665Studs.length !== 2
      ? '3665 inverted slope must expose the two top studs'
      : '',
    !invertedSlope3665WorldStuds[0] ||
      !invertedSlope3665WorldStuds[1] ||
      !approx(invertedSlope3665WorldStuds[0].pose.xStud, 0.5) ||
      !approx(invertedSlope3665WorldStuds[0].pose.yStud, 1.2) ||
      !approx(invertedSlope3665WorldStuds[0].pose.zStud, 0.5) ||
      !approx(invertedSlope3665WorldStuds[1].pose.xStud, 1.5) ||
      !approx(invertedSlope3665WorldStuds[1].pose.yStud, 1.2) ||
      !approx(invertedSlope3665WorldStuds[1].pose.zStud, 0.5)
      ? '3665 inverted slope top studs drifted from the 2x1 top surface'
      : '',
    !hasVertex(invertedSlope3665Geometry, { x: -1, y: 0.4, z: -0.5 }) ||
      !hasVertex(invertedSlope3665Geometry, { x: 0, y: -0.6, z: -0.5 }) ||
      !hasVertex(invertedSlope3665Geometry, { x: 1, y: -0.6, z: -0.5 })
      ? '3665 inverted slope must use the lengthwise inverted 45-degree profile'
      : '',
    curvedSlope50950Definition.partNumber !== '50950'
      ? '50950 curved slope must keep the real part number'
      : '',
    curvedSlope50950Studs.length !== 0
      ? '50950 curved slope must remain studless on top'
      : '',
    curvedSlope50950Definition.footprint.widthStuds !== 3 ||
      curvedSlope50950Definition.footprint.depthStuds !== 1 ||
      curvedSlope50950Definition.footprint.heightStuds !== 1.2
      ? '50950 curved slope footprint must stay 3 x 1 x 3 plates'
      : '',
    !hasVertex(curvedSlope50950Geometry, { x: -1.5, y: -0.4, z: -0.5 }) ||
      !hasVertex(curvedSlope50950Geometry, { x: 1.5, y: 0.6, z: -0.5 }) ||
      !hasVertex(curvedSlope50950Geometry, { x: -0.4135, y: 0.2195, z: -0.5 })
      ? '50950 curved slope profile must keep the LDraw-derived 3x1 arc'
      : '',
    !hasVertex(curvedSlope50950OutlineGeometry, { x: -1.5, y: -0.4, z: -0.502 }) ||
      !hasVertex(curvedSlope50950OutlineGeometry, { x: 1.5, y: 0.6, z: 0.502 })
      ? '50950 curved slope outline must expose the LDraw-derived curved side edges'
      : '',
    curvedSlope6091Definition.partNumber !== '6091'
      ? '6091 curved slope must keep the real part number'
      : '',
    curvedSlope6091Definition.footprint.heightStuds !== 1.6
      ? '6091 curved slope must be 1.333 bricks / 4 plates tall'
      : '',
    !approx(ldrawPointToBrickLocal({ x: 0, y: 8, z: 0 }, curvedSlope6091Frame).xStud, 1.5) ||
      !approx(ldrawPointToBrickLocal({ x: 0, y: 8, z: 0 }, curvedSlope6091Frame).yStud, 1.2) ||
      !approx(ldrawPointToBrickLocal({ x: 0, y: 8, z: 0 }, curvedSlope6091Frame).zStud, 0.5)
      ? 'LDraw point conversion must map 6091 stud.dat origin into brick-local center coordinates'
      : '',
    !approx(curvedSlope6091ConvertedStud.pose.xStud, 1) ||
      !approx(curvedSlope6091ConvertedStud.pose.yStud, 1.2) ||
      !approx(curvedSlope6091ConvertedStud.pose.zStud, 0)
      ? 'LDraw connector conversion must include y-axis stud/tube half-stud pose offset'
      : '',
    curvedSlope6091Studs.length !== 1
      ? '6091 curved slope must expose exactly one recessed high-platform stud'
      : '',
    !curvedSlope6091WorldStuds[0] ||
      !approx(curvedSlope6091WorldStuds[0].pose.xStud, 1.5) ||
      !approx(curvedSlope6091WorldStuds[0].pose.yStud, 1.2) ||
      !approx(curvedSlope6091WorldStuds[0].pose.zStud, 0.5)
      ? '6091 curved slope stud must sit on the lowered 1x1x0.4 right platform'
      : '',
    curvedSlope6091Tubes.length !== 2
      ? '6091 curved slope must expose the two underside tube sockets'
      : '',
    !curvedSlope6091WorldTubes.some((connector) =>
      approx(connector.pose.xStud, 0.5) &&
      approx(connector.pose.yStud, 0) &&
      approx(connector.pose.zStud, 0.5)
    ) ||
      !curvedSlope6091WorldTubes.some((connector) =>
        approx(connector.pose.xStud, 1.5) &&
        approx(connector.pose.yStud, 0.8) &&
        approx(connector.pose.zStud, 0.5)
      )
      ? '6091 curved slope sockets must keep the bottom-left and high-right entry points'
      : '',
    !hasVertex(curvedSlope6091Geometry, { x: -1, y: -0.2, z: -0.5 }) ||
      !hasVertex(curvedSlope6091Geometry, { x: 0, y: 0.8, z: -0.5 }) ||
      !hasVertex(curvedSlope6091Geometry, { x: 0, y: 0.4, z: -0.5 }) ||
      !hasVertex(curvedSlope6091Geometry, { x: 1, y: 0.4, z: -0.5 })
      ? '6091 curved slope profile must keep the left arc and lowered 1x1x0.4 right platform'
      : '',
    !hasVertex(curvedSlope6091Geometry, curvedSlope6091ArcMidpoint)
      ? '6091 curved slope arc must keep the quarter-circle tangent direction'
      : '',
    !hasVertex(curvedSlope6091OutlineGeometry, { x: 0, y: 0.8, z: -0.502 }) ||
      !hasVertex(curvedSlope6091OutlineGeometry, { x: 0, y: 0.4, z: -0.502 }) ||
      !hasVertex(curvedSlope6091OutlineGeometry, { x: 1, y: 0.4, z: 0.502 })
      ? '6091 curved slope outline must show the arc-to-lowered-platform step'
      : '',
    !has6091SolidVoxel(0.9, 1.5, 0.5)
      ? '6091 structural grid must occupy the left arc high point'
      : '',
    has6091SolidVoxel(0.1, 1.2, 0.5)
      ? '6091 structural grid must leave the lower left arc shoulder open'
      : '',
    has6091SolidVoxel(1.5, 1.3, 0.5)
      ? '6091 structural grid must keep the lowered right platform below the top arc'
      : '',
    !has6091SolidVoxel(1.5, 1.1, 0.5)
      ? '6091 structural grid must keep the lowered right platform solid'
      : '',
    has6091SolidVoxel(1.5, 0.5, 0.5) ||
      !has6091VoxelKind('enterable', 1.5, 0.5, 0.5)
      ? '6091 structural grid must leave the underside below the right platform enterable'
      : '',
    !has6091VoxelKind('enterable', 0.1, 1.2, 0.5)
      ? '6091 structural grid must mark non-solid in-bounds arc space as enterable'
      : '',
    has6091VoxelKind('enterable', 1.5, 0.8, 0.5) ||
      !has6091VoxelKind('socket', 1.5, 0.8, 0.5)
      ? '6091 structural grid must let socket cells override enterable cells'
      : '',
    !ldrawColors.some((color) => color.name === 'Red' && color.code === 4 && color.value === '#B40000')
      ? 'LDConfig colour parser must expose LDraw colour definitions'
      : '',
    isBrickSupported(highEyeTile98138, [support3005, highEyeTile98138])
      ? '98138 should remain unsupported while it can still descend over a 3005 top stud'
      : '',
    !isBrickSupported(seatedEyeTile98138, [support3005, seatedEyeTile98138])
      ? '98138 should be supported once seated at the real stud/tube connection height'
      : '',
    isBrickSupported(highStacked3005, [support3005, highStacked3005])
      ? '3005 stacked at the visual stud-top height should remain unsupported while it can descend'
      : '',
    !isBrickSupported(seatedStacked3005, [support3005, seatedStacked3005])
      ? '3005 should be supported once seated at the real stud/tube connection height'
      : '',
    isBrickAboveGround(flippedGround3005)
      ? '3005 flipped at ground level must be below-ground because the top stud rotates below y=0'
      : '',
    isBrickSupported(flippedGround3005, [flippedGround3005])
      ? '3005 flipped below ground must not count as supported'
      : '',
    !isBrickAboveGround(liftedFlippedGround3005)
      ? 'findOpenPose must lift flipped 3005 above ground'
      : '',
    !validateBuildPlan({
      id: 'flipped-ground-3005-regression',
      title: 'Flipped 3005 Regression',
      prompt: '',
      source: 'template-local',
      bricks: [flippedGround3005],
      steps: [],
    }).some((issue) => issue.type === 'invalid-pose' && issue.brickId === flippedGround3005.id)
      ? '3005 flipped at ground level must be rejected as an invalid pose'
      : '',
    !relocatedRotation3005
      ? 'Rotation fallback search should find a nearby open 3005 position'
      : '',
    relocatedRotation3005 && hasBrickCollision(relocatedRotation3005, [blockingRotation3005])
      ? 'Rotation fallback search must return a collision-free 3005 position'
      : '',
    relocatedRotation3005 && Math.hypot(
      relocatedRotation3005.pose.xStud - blockedRotation3005.pose.xStud,
      relocatedRotation3005.pose.zStud - blockedRotation3005.pose.zStud,
    ) > 1.000001
      ? 'Rotation fallback search must respect the configured local radius'
      : '',
    duplicateDefaultAssetIds.length > 0
      ? 'Default finished assets contain duplicate ids: ' + duplicateDefaultAssetIds.join(', ')
      : '',
    defaultFinishedAssets.length !== expectedDefaultAssetIds.size
      ? 'Default finished asset count changed unexpectedly: ' + defaultFinishedAssets.length
      : '',
    unexpectedDefaultAssetIds.length > 0
      ? 'Default finished assets contain unexpected ids: ' + unexpectedDefaultAssetIds.join(', ')
      : '',
    missingDefaultAssetIds.length > 0
      ? 'Default finished assets are missing ids: ' + missingDefaultAssetIds.join(', ')
      : '',
    resurfacedRetiredDefaultAssetIds.length > 0
      ? 'Retired default assets resurfaced: ' + resurfacedRetiredDefaultAssetIds.join(', ')
      : '',
    nonGhostClassicDefaultAssets.length > 0
      ? 'Only finished-ghost may remain in the Classic default category: ' + nonGhostClassicDefaultAssets.map((asset) => asset.id).join(', ')
      : '',
    changedDefaultAssetPieceCounts.length > 0
      ? 'Default finished asset piece counts changed unexpectedly: ' + JSON.stringify(changedDefaultAssetPieceCounts)
      : '',
  ].filter(Boolean);

  const failures = results.filter((result) =>
    result.planBlockingIssues.length > 0 ||
    result.planRoundTripBlockingIssues.length > 0 ||
    result.manualRoundTripBlockingIssues.length > 0 ||
    result.invalidManualSteps.length > 0 ||
    result.manualSchema !== 3,
  );

  console.log(JSON.stringify(results.map((result) => ({
    assetId: result.assetId,
    title: result.title,
    pieces: result.pieces,
    manualSchema: result.manualSchema,
    plan: result.summary.plan,
    planRoundTrip: result.summary.planRoundTrip,
    manualRoundTrip: result.summary.manualRoundTrip,
    invalidManualSteps: result.invalidManualSteps.length,
  })), null, 2));

  if (regressionFailures.length > 0) {
    console.error(JSON.stringify({ regressionFailures, headlightConnector, eyeConnector, legacyPose }, null, 2));
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
`)

await esbuild.build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  logLevel: 'silent',
  outfile,
  platform: 'node',
})

await import(outfile)
