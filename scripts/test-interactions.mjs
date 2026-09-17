import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const drawing = await server.ssrLoadModule(
    '/src/interactions/drawingConstraints.ts',
  );
  const selection = await server.ssrLoadModule(
    '/src/interactions/selectionPolicy.ts',
  );
  const layerMove = await server.ssrLoadModule(
    '/src/interactions/layerMove.ts',
  );
  const fontCatalog = await server.ssrLoadModule('/src/fonts/catalog.ts');
  const colorSelection = await server.ssrLoadModule(
    '/src/imaging/colorSelection.ts',
  );
  const colorAdjustments = await server.ssrLoadModule(
    '/src/imaging/colorAdjustments.ts',
  );
  const llabFile = await server.ssrLoadModule('/src/utils/llabFile.ts');
  const layerOrder = await server.ssrLoadModule('/src/utils/layerOrder.ts');
  const keyboardPolicy = await server.ssrLoadModule('/src/interactions/keyboardPolicy.ts');
  const photoshopHints = await server.ssrLoadModule('/src/interactions/photoshopHints.ts');
  const paintPolicy = await server.ssrLoadModule('/src/interactions/paintPolicy.ts');
  const adjustmentPreview = await server.ssrLoadModule('/src/interactions/adjustmentPreview.ts');
  const canvasLimits = await server.ssrLoadModule('/src/utils/canvasLimits.ts');
  const unsavedChanges = await server.ssrLoadModule('/src/utils/unsavedChanges.ts');
  const historyPolicy = await server.ssrLoadModule('/src/interactions/historyPolicy.ts');
  const psdLimits = await server.ssrLoadModule('/src/utils/psdLimits.ts');
  const layerLockPolicy = await server.ssrLoadModule('/src/interactions/layerLockPolicy.ts');
  const rasterHeader = await server.ssrLoadModule('/src/utils/rasterHeader.ts');
  const savePolicy = await server.ssrLoadModule('/src/interactions/savePolicy.ts');
  const saveQueue = await server.ssrLoadModule('/src/interactions/saveQueue.ts');
  const pendingEdits = await server.ssrLoadModule('/src/interactions/pendingEdits.ts');
  const projectRasterBudget = await server.ssrLoadModule('/src/utils/projectRasterBudget.ts');
  const channelPack = await server.ssrLoadModule('/src/utils/channelPack.ts');
  const normalMap = await server.ssrLoadModule('/src/utils/normalMap.ts');
  assert.equal(normalMap.isSafeNormalMapSize(4096, 4096), true);
  assert.equal(normalMap.isSafeNormalMapSize(8192, 4096), false);
  assert.equal(paintPolicy.isSafeBrushCanvas(4096, 4096), true);
  assert.equal(paintPolicy.isSafeBrushCanvas(8192, 4096), false);
  assert.equal(channelPack.isSafeChannelPackSize(4096, 4096), true);
  assert.equal(channelPack.isSafeChannelPackSize(8192, 4096), false);
  const full4kLayer = { type: 'image', naturalWidth: 4096, naturalHeight: 4096 };
  assert.equal(
    projectRasterBudget.validateProjectRasterBudget(Array(8).fill(full4kLayer)).ok,
    true,
  );
  assert.equal(
    projectRasterBudget.validateProjectRasterBudget(Array(9).fill(full4kLayer)).ok,
    false,
  );
  assert.equal(
    projectRasterBudget.validateProjectStorageBudget(
      [],
      projectRasterBudget.MAX_PROJECT_EMBEDDED_CHARS + 1,
    ).ok,
    false,
  );
  assert.ok(projectRasterBudget.estimatedRgbaDataUrlChars(4096, 4096) > 80 * 1024 * 1024);

  const queueKey = {};
  const saveOrder = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstSave = saveQueue.enqueueDocumentSave(queueKey, async (isLatest) => {
    saveOrder.push('first-start');
    await firstGate;
    saveOrder.push(`first-latest:${isLatest()}`);
    return 'first';
  });
  const secondSave = saveQueue.enqueueDocumentSave(queueKey, async (isLatest) => {
    saveOrder.push('second-start');
    saveOrder.push(`second-latest:${isLatest()}`);
    return 'second';
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(saveOrder, ['first-start']);
  releaseFirst();
  assert.deepEqual(await Promise.all([firstSave, secondSave]), ['first', 'second']);
  assert.deepEqual(saveOrder, [
    'first-start',
    'first-latest:false',
    'second-start',
    'second-latest:true',
  ]);

  const pendingState = { pendingOperations: 0 };
  const pendingStore = {
    getState: () => pendingState,
    setState: (partial) => Object.assign(pendingState, partial),
  };
  const flushedDrafts = [];
  pendingEdits.registerPendingSyncEdit(pendingStore, 'text:1', { flush: () => flushedDrafts.push('old') });
  pendingEdits.registerPendingSyncEdit(pendingStore, 'text:1', { flush: () => flushedDrafts.push('latest') });
  assert.equal(pendingState.pendingOperations, 1);
  pendingEdits.flushPendingSyncEdits(pendingStore);
  assert.deepEqual(flushedDrafts, ['latest']);
  assert.equal(pendingState.pendingOperations, 0);
  let finishAsync;
  const pendingTask = new Promise((resolve) => { finishAsync = resolve; });
  const trackedTask = pendingEdits.trackPendingAsyncEdit(pendingStore, pendingTask);
  assert.equal(pendingState.pendingOperations, 1);
  finishAsync();
  await trackedTask;
  assert.equal(pendingState.pendingOperations, 0);
  await pendingEdits.trackPendingAsyncEdit(
    pendingStore,
    Promise.reject(new Error('decode failed')),
  ).catch(() => undefined);
  await assert.rejects(
    () => pendingEdits.flushPendingEdits(pendingStore),
    /decode failed/,
  );

  const savedRefs = { canvas: {}, layers: [], guides: [], path: 'a.llab' };
  assert.equal(savePolicy.savedSnapshotStillCurrent(savedRefs, { ...savedRefs }), true);
  assert.equal(
    savePolicy.savedSnapshotStillCurrent(savedRefs, { ...savedRefs, layers: [] }),
    false,
  );

  const historyStates = [
    { payload: 'old'.repeat(20) },
    { payload: 'middle'.repeat(20) },
    { payload: 'new'.repeat(20) },
  ];
  const newestBudget = historyPolicy.estimateHistorySnapshotBytes(historyStates[2]);
  assert.deepEqual(
    historyPolicy.trimHistoryStatesToBudget(historyStates, newestBudget),
    [historyStates[2]],
  );

  const pngHeader = new ArrayBuffer(24);
  const pngBytes = new Uint8Array(pngHeader);
  pngBytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  pngBytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const pngView = new DataView(pngHeader);
  pngView.setUint32(16, 4096, false);
  pngView.setUint32(20, 2048, false);
  assert.deepEqual(rasterHeader.inspectRasterHeader(pngHeader), {
    format: 'png', width: 4096, height: 2048,
  });
  pngView.setUint32(16, 100000, false);
  assert.equal(rasterHeader.validateRasterHeader(pngHeader), null);
  const onePixelPngHeader = Buffer.alloc(24);
  onePixelPngHeader.set([0x89, 0x50, 0x4e, 0x47], 0);
  onePixelPngHeader.set([0x49, 0x48, 0x44, 0x52], 12);
  onePixelPngHeader.writeUInt32BE(1, 16);
  onePixelPngHeader.writeUInt32BE(1, 20);
  const onePixelPngDataUrl = `data:image/png;base64,${onePixelPngHeader.toString('base64')}`;
  assert.deepEqual(rasterHeader.inspectRasterDataUrl(onePixelPngDataUrl), {
    ok: true,
    header: { format: 'png', width: 1, height: 1 },
    decodedBytes: 24,
  });
  assert.equal(
    rasterHeader.inspectRasterDataUrl(`${onePixelPngDataUrl.slice(0, -1)}!`).reason,
    'invalid-base64',
  );
  assert.equal(
    rasterHeader.inspectRasterDataUrl(onePixelPngDataUrl.replace('image/png', 'image/jpeg')).reason,
    'mime-mismatch',
  );
  assert.equal(rasterHeader.inspectRasterDataUrl(onePixelPngDataUrl, 23).reason, 'file-too-large');
  const heightField = await server.ssrLoadModule('/src/utils/heightField.ts');

  assert.deepEqual(heightField.largeRadiusBoxRadii(11), [4, 4, 5]);
  assert.deepEqual(heightField.largeRadiusBoxRadii(21), [9, 9, 9]);

  const constantHeight = new Float32Array(17).fill(0.375);
  const constantBlur = heightField.blurLargeRadius(constantHeight, 17, 1, 21);
  for (const value of constantBlur) assert.ok(Math.abs(value - 0.375) < 1e-6);

  const impulseSize = 65;
  const impulse = new Float32Array(impulseSize * impulseSize);
  const impulseCenter = Math.floor(impulseSize / 2);
  impulse[impulseCenter * impulseSize + impulseCenter] = 1;
  const impulseBlur = heightField.blurLargeRadius(impulse, impulseSize, impulseSize, 21);
  let impulseEnergy = 0;
  for (const value of impulseBlur) {
    assert.ok(Number.isFinite(value) && value >= 0);
    impulseEnergy += value;
  }
  assert.ok(Math.abs(impulseEnergy - 1) < 1e-5);
  assert.ok(Math.abs(
    impulseBlur[impulseCenter * impulseSize + impulseCenter - 8]
      - impulseBlur[impulseCenter * impulseSize + impulseCenter + 8],
  ) < 1e-7);
  assert.ok(Math.abs(
    impulseBlur[(impulseCenter - 8) * impulseSize + impulseCenter]
      - impulseBlur[(impulseCenter + 8) * impulseSize + impulseCenter],
  ) < 1e-7);

  const qualityWidth = 96;
  const qualityHeight = 80;
  const qualityInput = new Float32Array(qualityWidth * qualityHeight);
  for (let y = 0; y < qualityHeight; y++) {
    for (let x = 0; x < qualityWidth; x++) {
      qualityInput[y * qualityWidth + x] = (
        (x / qualityWidth) * 0.55
        + (y / qualityHeight) * 0.25
        + (((x * 31 + y * 17) % 101) / 100) * 0.2
      );
    }
  }
  const exactLargeBlur = heightField.blurSeparable(
    qualityInput, qualityWidth, qualityHeight, 11,
  );
  const fastLargeBlur = heightField.blurLargeRadius(
    qualityInput, qualityWidth, qualityHeight, 11,
  );
  let blurAbsoluteError = 0;
  let blurMaxError = 0;
  for (let i = 0; i < qualityInput.length; i++) {
    const error = Math.abs(exactLargeBlur[i] - fastLargeBlur[i]);
    blurAbsoluteError += error;
    blurMaxError = Math.max(blurMaxError, error);
  }
  assert.ok(blurAbsoluteError / qualityInput.length < 0.005);
  assert.ok(blurMaxError < 0.06);

  assert.deepEqual(normalMap.normalMapRenderSize(4096, 2048, 1024), {
    width: 1024,
    height: 512,
  });
  assert.deepEqual(normalMap.normalMapRenderSize(800, 600, 1024), {
    width: 800,
    height: 600,
  });
  const normalParams = {
    sourceLayerId: 'source', grayMode: 'luminance', invert: false,
    autoLevel: false, blackPoint: 0, whitePoint: 1, gamma: 1,
    preBlur: 1, detailScale: 0.6, strength: 2.5, zStrength: 1, flipY: false,
  };
  assert.notEqual(
    normalMap.normalMapParamsKey(normalParams),
    normalMap.normalMapParamsKey({ ...normalParams, strength: 2.6 }),
  );
  const generationIdentity = {
    generation: 7,
    paramsKey: normalMap.normalMapParamsKey(normalParams),
    sourceSrc: 'source-v1',
    targetSrc: 'normal-before-generation',
    canvasWidth: 4096,
    canvasHeight: 4096,
  };
  assert.equal(
    normalMap.sameNormalMapGeneration(generationIdentity, { ...generationIdentity }),
    true,
  );
  assert.equal(
    normalMap.sameNormalMapGeneration(generationIdentity, {
      ...generationIdentity,
      targetSrc: 'normal-restored-by-undo',
    }),
    false,
  );
  assert.equal(
    normalMap.sameNormalMapGeneration(generationIdentity, {
      ...generationIdentity,
      generation: generationIdentity.generation + 1,
    }),
    false,
  );

  const lockLayers = [
    { id: 'group', type: 'group', parentId: null, locked: true },
    { id: 'child', type: 'image', parentId: 'group', locked: false },
  ];
  assert.equal(layerLockPolicy.isLayerEffectivelyLocked(lockLayers, 'child'), true);
  assert.equal(
    layerLockPolicy.isLayerEffectivelyLocked([
      { id: 'a', type: 'group', parentId: 'b', locked: false },
      { id: 'b', type: 'group', parentId: 'a', locked: false },
    ], 'a'),
    true,
  );

  const psdHeader = new ArrayBuffer(psdLimits.PSD_HEADER_BYTES);
  const psdBytes = new Uint8Array(psdHeader);
  psdBytes.set([0x38, 0x42, 0x50, 0x53]);
  const psdView = new DataView(psdHeader);
  psdView.setUint16(4, 1, false);
  psdView.setUint32(14, 2048, false);
  psdView.setUint32(18, 4096, false);
  assert.deepEqual(psdLimits.validatePsdHeader(psdHeader, 1024), {
    ok: true, version: 1, width: 4096, height: 2048,
  });
  psdView.setUint32(18, 9000, false);
  assert.equal(psdLimits.validatePsdHeader(psdHeader, 1024).code, 'unsafe-canvas');
  assert.equal(
    psdLimits.validatePsdHeader(psdHeader, psdLimits.MAX_PSD_FILE_BYTES + 1).code,
    'file-too-large',
  );
  assert.deepEqual(
    psdLimits.validatePsdLayerBudget([
      {
        children: [
          { left: 0, top: 0, right: 4096, bottom: 4096 },
          { left: -10, top: -20, right: 2038, bottom: 2028 },
        ],
      },
    ]),
    { ok: true, layerCount: 3, layerPixels: (4096 * 4096) + (2048 * 2048) },
  );
  assert.equal(
    psdLimits.validatePsdLayerBudget([
      { left: 0, top: 0, right: 8192, bottom: 4096 },
      { left: 0, top: 0, right: 8192, bottom: 4096 },
      { left: 0, top: 0, right: 1, bottom: 1 },
    ]).code,
    'too-many-layer-pixels',
  );
  assert.equal(
    psdLimits.validatePsdLayerBudget(
      Array.from({ length: psdLimits.MAX_PSD_LAYERS + 1 }, () => ({})),
    ).code,
    'too-many-layers',
  );
  assert.equal(
    psdLimits.validatePsdLayerBudget([
      { left: 0, top: 0, right: psdLimits.MAX_PSD_DIMENSION + 1, bottom: 1 },
    ]).code,
    'unsafe-layer-bounds',
  );
  const cyclicPsdLayer = { children: [] };
  cyclicPsdLayer.children.push(cyclicPsdLayer);
  assert.equal(psdLimits.validatePsdLayerBudget([cyclicPsdLayer]).code, 'invalid-layer-tree');

  assert.deepEqual(
    drawing.constrainShapeEndpoint(
      'rect',
      { x: 0, y: 0 },
      { x: 12, y: 7 },
      { shift: true },
    ),
    { x: 12, y: 12 },
  );

  const horizontal = drawing.constrainShapeEndpoint(
    'line',
    { x: 0, y: 0 },
    { x: 20, y: 2 },
    { shift: true },
  );
  assert.ok(Math.abs(horizontal.y) < 1e-9);

  const diagonal = drawing.constrainShapeEndpoint(
    'line',
    { x: 10, y: 10 },
    { x: 20, y: 18 },
    { shift: true },
  );
  assert.ok(Math.abs((diagonal.x - 10) - (diagonal.y - 10)) < 1e-9);

  assert.deepEqual(
    drawing.constrainShapeEndpoint(
      'line',
      { x: 1, y: 2 },
      { x: 8, y: 11 },
      { shift: false },
    ),
    { x: 8, y: 11 },
  );

  assert.equal(drawing.brushStrokeMode({ shift: true }), 'straight');
  assert.equal(drawing.brushStrokeMode({ shift: false }), 'freehand');

  const workspace = {};
  assert.equal(
    selection.shouldClearLayerSelection({
      button: 0,
      target: workspace,
      currentTarget: workspace,
      tool: 'move',
    }),
    true,
  );
  assert.equal(
    selection.shouldClearLayerSelection({
      button: 0,
      target: {},
      currentTarget: workspace,
      tool: 'move',
    }),
    false,
  );
  assert.equal(
    selection.shouldClearLayerSelection({
      button: 0,
      target: {},
      currentTarget: workspace,
      tool: 'move',
      insideCanvas: false,
    }),
    true,
  );
  assert.equal(
    selection.shouldClearLayerSelection({
      button: 0,
      target: workspace,
      currentTarget: workspace,
      tool: 'move',
      insideCanvas: true,
    }),
    false,
  );
  assert.equal(
    selection.shouldClearLayerSelection({
      button: 2,
      target: workspace,
      currentTarget: workspace,
      tool: 'move',
    }),
    false,
  );
  assert.equal(
    selection.shouldClearLayerSelection({
      button: 0,
      target: workspace,
      currentTarget: workspace,
      tool: 'marquee',
      shiftKey: true,
    }),
    false,
  );

  assert.equal(
    selection.shouldClearPixelSelection({
      button: 0,
      target: workspace,
      currentTarget: workspace,
      tool: 'marquee',
    }),
    true,
  );
  assert.equal(
    selection.shouldClearPixelSelection({
      button: 0,
      target: workspace,
      currentTarget: workspace,
      tool: 'move',
    }),
    true,
  );
  assert.equal(
    selection.shouldClearPixelSelection({
      button: 0,
      target: {},
      currentTarget: workspace,
      tool: 'marquee',
      insideCanvas: true,
    }),
    false,
  );
  assert.equal(
    selection.shouldClearPixelSelection({
      button: 2,
      target: workspace,
      currentTarget: workspace,
      tool: 'marquee',
    }),
    false,
  );
  assert.equal(
    selection.shouldClearPixelSelection({
      button: 0,
      target: workspace,
      currentTarget: workspace,
      tool: 'marquee',
      shiftKey: true,
    }),
    false,
  );

  assert.equal(
    selection.shouldStartMarqueeOnCanvasEnter({
      tool: 'marquee',
      hasDraft: false,
      buttons: 1,
      shiftKey: true,
    }),
    true,
  );
  assert.equal(
    selection.shouldStartMarqueeOnCanvasEnter({
      tool: 'marquee',
      hasDraft: false,
      buttons: 0,
      shiftKey: true,
    }),
    false,
  );
  assert.equal(
    selection.shouldStartMarqueeOnCanvasEnter({
      tool: 'move',
      hasDraft: false,
      buttons: 1,
      shiftKey: true,
    }),
    false,
  );
  assert.deepEqual(
    selection.clampPointToCanvas({ x: -14, y: 220 }, 640, 180),
    { x: 0, y: 180 },
  );

  const rectLayer = {
    id: 'rect', type: 'shape', shape: 'rect', x: 10, y: 20,
    shapeWidth: 100, shapeHeight: 60,
  };
  assert.deepEqual(layerMove.layerNodePosition(rectLayer), { x: 60, y: 50 });
  assert.deepEqual(
    layerMove.layerNodePosition({ id: 'image', type: 'image', x: 10, y: 20 }),
    { x: 10, y: 20 },
  );
  assert.equal(
    layerMove.shouldPreserveMultiSelection(['a', 'b'], 'a', {
      shift: false, ctrl: false, meta: false,
    }),
    true,
  );
  assert.equal(
    layerMove.shouldPreserveMultiSelection(['a', 'b'], 'c', {
      shift: false, ctrl: false, meta: false,
    }),
    false,
  );
  const starts = new Map([
    ['a', { layer: { x: 10, y: 20 }, node: { x: 10, y: 20 } }],
    ['b', { layer: { x: 40, y: 50 }, node: { x: 70, y: 80 } }],
  ]);
  assert.deepEqual(layerMove.translatedLayerPositions(starts, 7, -4), [
    { id: 'a', x: 17, y: 16 },
    { id: 'b', x: 47, y: 46 },
  ]);
  assert.deepEqual(layerMove.constrainDragDelta(7, -4, false), { x: 7, y: -4 });
  const horizontalDrag = layerMove.constrainDragDelta(20, 2, true);
  assert.ok(Math.abs(horizontalDrag.y) < 1e-9);
  const diagonalDrag = layerMove.constrainDragDelta(10, 8, true);
  assert.ok(Math.abs(diagonalDrag.x - diagonalDrag.y) < 1e-9);

  const mergedFonts = fontCatalog.mergeAndSortFonts([
    'Arial',
    'Yu Gothic',
    'Noto Sans JP',
    'Arial',
  ]);
  assert.equal(mergedFonts[0], fontCatalog.DEFAULT_TEXT_FONT);
  assert.equal(mergedFonts.filter((family) => family === 'Noto Sans JP').length, 1);
  assert.ok(mergedFonts.indexOf('Yu Gothic') < mergedFonts.indexOf('Arial'));
  assert.equal(fontCatalog.BUNDLED_FONT_FAMILIES.length, 30);

  const identityPixel = new Uint8ClampedArray([12, 127, 244, 73]);
  colorAdjustments.applyColorAdjustmentsToRgba(
    identityPixel,
    colorAdjustments.DEFAULT_COLOR_ADJUSTMENTS,
  );
  assert.deepEqual([...identityPixel], [12, 127, 244, 73]);

  const invertedPixel = new Uint8ClampedArray([12, 127, 244, 73]);
  colorAdjustments.applyColorAdjustmentsToRgba(invertedPixel, { invert: true });
  assert.deepEqual([...invertedPixel], [243, 128, 11, 73]);

  const maskedPixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  colorAdjustments.applyColorAdjustmentsToRgba(
    maskedPixels,
    { invert: true },
    new Uint8ClampedArray([255, 0]),
  );
  assert.deepEqual([...maskedPixels], [245, 235, 225, 255, 40, 50, 60, 255]);

  const exposurePixel = new Uint8ClampedArray([128, 128, 128, 255]);
  colorAdjustments.applyColorAdjustmentsToRgba(exposurePixel, { exposure: 1 });
  assert.ok(exposurePixel[0] >= 175 && exposurePixel[0] <= 177);
  assert.equal(exposurePixel[0], exposurePixel[1]);

  const compressedContrast = new Uint8ClampedArray([64, 64, 64, 255]);
  colorAdjustments.applyColorAdjustmentsToRgba(compressedContrast, { contrast: -50 });
  assert.ok(compressedContrast[0] >= 95 && compressedContrast[0] <= 96);

  const onceBright = new Uint8ClampedArray([80, 80, 80, 255]);
  colorAdjustments.applyColorAdjustmentsToRgba(onceBright, { brightness: 50 });
  const twiceBright = new Uint8ClampedArray(onceBright);
  colorAdjustments.applyColorAdjustmentsToRgba(twiceBright, { brightness: 50 });
  assert.ok(twiceBright[0] > onceBright[0]);

  const invertThenLevels = new Uint8ClampedArray([32, 32, 32, 255]);
  colorAdjustments.applyColorAdjustmentsToRgba(invertThenLevels, { invert: true });
  colorAdjustments.applyColorAdjustmentsToRgba(invertThenLevels, { inputBlack: 0, inputWhite: 128 });
  const levelsThenInvert = new Uint8ClampedArray([32, 32, 32, 255]);
  colorAdjustments.applyColorAdjustmentsToRgba(levelsThenInvert, { inputBlack: 0, inputWhite: 128 });
  colorAdjustments.applyColorAdjustmentsToRgba(levelsThenInvert, { invert: true });
  assert.notDeepEqual([...invertThenLevels], [...levelsThenInvert]);

  const levelsPixel = new Uint8ClampedArray([64, 128, 192, 99]);
  colorAdjustments.applyColorAdjustmentsToRgba(levelsPixel, {
    inputBlack: 64,
    inputWhite: 192,
  });
  assert.deepEqual([...levelsPixel], [0, 128, 255, 99]);

  const channelPixel = new Uint8ClampedArray([100, 100, 100, 88]);
  colorAdjustments.applyColorAdjustmentsToRgba(channelPixel, {
    levelsRed: { inputBlack: 100, inputGamma: 1, inputWhite: 255, outputBlack: 0, outputWhite: 255 },
    curveGreen: [{ x: 0, y: 255 }, { x: 255, y: 0 }],
  });
  assert.deepEqual([...channelPixel], [0, 155, 100, 88]);

  const grayPixel = new Uint8ClampedArray([255, 0, 0, 41]);
  colorAdjustments.applyColorAdjustmentsToRgba(grayPixel, {
    blackAndWhite: true,
  });
  assert.equal(grayPixel[0], grayPixel[1]);
  assert.equal(grayPixel[1], grayPixel[2]);
  assert.equal(grayPixel[3], 41);

  const curve = colorAdjustments.curveLut([
    { x: 0, y: 0 },
    { x: 128, y: 192 },
    { x: 255, y: 255 },
  ]);
  assert.equal(curve[0], 0);
  assert.equal(curve[128], 192);
  assert.equal(curve[255], 255);

  const groupLayer = {
    id: 'group-1', type: 'group', name: 'Group', visible: true, locked: false,
    opacity: 1, blendMode: 'source-over', x: 0, y: 0, rotation: 0,
    scaleX: 1, scaleY: 1, collapsed: false,
  };
  const projectText = llabFile.serializeProject(
    { width: 64, height: 64, background: '#fff' },
    [groupLayer],
    groupLayer.id,
  );
  assert.equal(llabFile.parseProject(projectText).layers[0].type, 'group');

  const safeImageLayer = {
    id: 'image-safe', type: 'image', name: 'Safe', visible: true, locked: false,
    opacity: 1, blendMode: 'source-over', x: 0, y: 0, rotation: 0,
    scaleX: 1, scaleY: 1, naturalWidth: 1, naturalHeight: 1,
    src: onePixelPngDataUrl,
  };
  assert.throws(
    () => llabFile.serializeProject(
      { width: 4096, height: 4096, background: '#fff' },
      Array.from({ length: 9 }, (_, index) => ({
        ...safeImageLayer,
        id: `budget-${index}`,
        naturalWidth: 4096,
        naturalHeight: 4096,
      })),
      null,
    ),
    /128 MP/,
  );
  const imageProject = llabFile.serializeProject(
    { width: 64, height: 64, background: '#fff' },
    [safeImageLayer],
    safeImageLayer.id,
  );
  assert.equal(llabFile.parseProject(imageProject).layers[0].naturalWidth, 1);
  assert.throws(
    () => llabFile.parseProject(imageProject.replace('"naturalWidth": 1', '"naturalWidth": 100000')),
    /unsafe image dimensions/,
  );
  assert.throws(
    () => llabFile.parseProject(llabFile.serializeProject(
      { width: 64, height: 64, background: '#fff' },
      [safeImageLayer, { ...safeImageLayer }],
      null,
    )),
    /duplicate id/,
  );
  assert.throws(
    () => llabFile.parseProject(imageProject.replace('"opacity": 1', '"opacity": 1e309')),
    /opacity/,
  );
  assert.throws(
    () => llabFile.parseProject(imageProject.replace('"naturalHeight": 1', '"naturalHeight": 2')),
    /header mismatch/,
  );
  assert.throws(
    () => llabFile.parseProject(imageProject.replace(/base64,[^"]+/, 'base64,not-valid-base64!')),
    /invalid embedded image/,
  );

  const groupNode = (id, parentId = null) => ({
    ...groupLayer,
    id,
    name: id,
    parentId,
  });
  const lockedHierarchy = [
    { ...groupNode('locked-parent'), locked: true },
    { ...safeImageLayer, id: 'locked-child', parentId: 'locked-parent' },
    { ...safeImageLayer, id: 'free-layer', parentId: null },
  ];
  assert.equal(
    layerLockPolicy.layerBlocksContainLock(lockedHierarchy, ['locked-child']),
    true,
  );
  assert.equal(
    layerLockPolicy.layerBlocksContainLock(lockedHierarchy, ['locked-parent']),
    true,
  );
  assert.equal(
    layerLockPolicy.layerBlocksContainLock(lockedHierarchy, ['free-layer']),
    false,
  );
  const normalHierarchy = [
    groupNode('normal-root'),
    groupNode('normal-child', 'normal-root'),
    groupNode('normal-sibling'),
  ];
  assert.strictEqual(layerOrder.breakParentCycles(normalHierarchy), normalHierarchy);
  assert.deepEqual(
    layerOrder.normalizeLayerOrder(normalHierarchy).map((layer) => layer.id),
    ['normal-root', 'normal-child', 'normal-sibling'],
  );
  const crossGroupClip = [
    { ...safeImageLayer, id: 'clip-child', parentId: 'normal-root', clipped: true },
    { ...safeImageLayer, id: 'outside-base', parentId: null },
  ];
  layerOrder.sanitizeClips(crossGroupClip);
  assert.equal(crossGroupClip[0].clipped, false);

  const selfCycle = [groupNode('self', 'self')];
  const repairedSelf = layerOrder.breakParentCycles(selfCycle);
  assert.equal(repairedSelf[0].parentId, null);
  assert.equal(selfCycle[0].parentId, 'self');

  const threeNodeCycle = [
    groupNode('cycle-b', 'cycle-c'),
    groupNode('cycle-a', 'cycle-b'),
    groupNode('cycle-c', 'cycle-a'),
  ];
  const repairedCycle = layerOrder.breakParentCycles(threeNodeCycle);
  assert.deepEqual(
    repairedCycle.map((layer) => layer.parentId),
    [null, 'cycle-b', 'cycle-a'],
  );
  assert.deepEqual(
    layerOrder.normalizeLayerOrder(threeNodeCycle).map((layer) => layer.id),
    ['cycle-b', 'cycle-a', 'cycle-c'],
  );
  const parsedCycle = llabFile.parseProject(llabFile.serializeProject(
    { width: 64, height: 64, background: '#fff' },
    threeNodeCycle,
    null,
  ));
  assert.deepEqual(
    parsedCycle.layers.map((layer) => layer.parentId),
    [null, 'cycle-b', 'cycle-a'],
  );

  assert.equal(
    keyboardPolicy.getLayerOrderCommand({ code: 'BracketRight', ctrlKey: true }),
    'up',
  );
  assert.equal(
    keyboardPolicy.getLayerOrderCommand({ code: 'BracketRight', ctrlKey: true, shiftKey: true }),
    'front',
  );
  assert.equal(
    keyboardPolicy.getLayerOrderCommand({ code: 'BracketLeft', metaKey: true, shiftKey: true }),
    'back',
  );
  assert.equal(
    keyboardPolicy.getLayerOrderCommand({ code: 'BracketLeft', ctrlKey: true, altKey: true }),
    null,
  );
  assert.equal(keyboardPolicy.isNativeEditingShortcut({ editable: true, ctrlKey: true, key: 'c' }), true);
  assert.equal(keyboardPolicy.isNativeEditingShortcut({ editable: true, ctrlKey: true, key: 'z' }), true);
  assert.equal(keyboardPolicy.isNativeEditingShortcut({ editable: true, ctrlKey: true, key: 's' }), false);

  assert.match(
    photoshopHints.photoshopToolHint({ tool: 'move' }).en,
    /Alt\+drag.*Shift.*Arrows/,
  );
  assert.match(
    photoshopHints.photoshopToolHint({ tool: 'brush' }).ja,
    /スポイト.*サイズ.*直線/,
  );

  const paintableLayer = {
    id: 'paint', type: 'image', src: '', name: 'Paint', visible: true,
    locked: false, opacity: 1, blendMode: 'source-over', x: 0, y: 0,
    rotation: 0, scaleX: 1, scaleY: 1, naturalWidth: 1024, naturalHeight: 1024,
  };
  assert.equal(paintPolicy.isPaintTarget(paintableLayer, 1024, 1024), true);
  assert.equal(paintPolicy.isPaintTarget({ ...paintableLayer, locked: true }, 1024, 1024), false);
  assert.equal(
    paintPolicy.isPaintTarget({ ...paintableLayer, normalGen: { sourceLayerId: 'x' } }, 1024, 1024),
    false,
  );

  assert.equal(adjustmentPreview.adjustmentPreviewPixelRatio(4096, 4096, true), 0.25);
  assert.equal(adjustmentPreview.adjustmentPreviewPixelRatio(800, 600, true), 1);
  assert.equal(adjustmentPreview.adjustmentPreviewPixelRatio(4096, 4096, false), 1);

  assert.equal(canvasLimits.validatePixelSize(4096, 4096).ok, true);
  assert.equal(canvasLimits.validatePixelSize(100000, 100000).ok, false);
  assert.equal(canvasLimits.validateExportSize(12288, 12288).ok, false);
  assert.throws(
    () => llabFile.parseProject(projectText.replace('"width": 64', '"width": 100000')),
    /Unsafe canvas dimensions/,
  );

  assert.equal(
    unsavedChanges.hasUnsavedDocuments([
      { store: { getState: () => ({ dirty: false }) } },
      { store: { getState: () => ({ dirty: true }) } },
    ]),
    true,
  );
  assert.equal(
    unsavedChanges.hasUnsavedDocuments([
      { store: { getState: () => ({ dirty: false, pendingOperations: 1 }) } },
    ]),
    true,
  );

  const sharedCanvas = { width: 64, height: 64 };
  const sharedLayers = [{ toJSON: () => { throw new Error('large layers were serialized'); } }];
  assert.equal(historyPolicy.editorHistoryEqual(
    { canvas: sharedCanvas, layers: sharedLayers, selection: null },
    { canvas: sharedCanvas, layers: sharedLayers, selection: null },
  ), true);
  assert.equal(historyPolicy.editorHistoryEqual(
    { canvas: sharedCanvas, layers: sharedLayers, selection: { type: 'rect', x: 0 } },
    { canvas: sharedCanvas, layers: sharedLayers, selection: { type: 'rect', x: 1 } },
  ), false);
  assert.equal(historyPolicy.historyStackMoved(2, 1), true);
  assert.equal(historyPolicy.historyStackMoved(0, 0), false);
  assert.equal(historyPolicy.historyStackMoved(1, 2), false);

  const makePixels = (rows) =>
    new Uint8ClampedArray(rows.flat(2));

  const hardEdge = makePixels([
    [[250, 250, 250, 255], [248, 249, 250, 255], [15, 15, 15, 255]],
    [[249, 250, 248, 255], [251, 249, 250, 255], [15, 15, 15, 255]],
    [[250, 249, 251, 255], [248, 250, 249, 255], [15, 15, 15, 255]],
  ]);
  const hardEdgeMask = colorSelection.createColorSelectionMask(
    hardEdge,
    3,
    3,
    0,
    1,
    { tolerance: 18, contiguous: true, antiAlias: true },
  );
  assert.ok(hardEdgeMask[0] > 0);
  assert.equal(hardEdgeMask[2], 0);
  assert.equal(hardEdgeMask[5], 0);
  assert.equal(hardEdgeMask[8], 0);

  const disconnected = makePixels([
    [[240, 240, 240, 255], [0, 0, 0, 255], [240, 240, 240, 255]],
  ]);
  const contiguousMask = colorSelection.createColorSelectionMask(
    disconnected,
    3,
    1,
    0,
    0,
    { tolerance: 10, contiguous: true, antiAlias: false },
  );
  assert.equal(contiguousMask[0], 255);
  assert.equal(contiguousMask[2], 0);

  const globalMask = colorSelection.createColorSelectionMask(
    disconnected,
    3,
    1,
    0,
    0,
    { tolerance: 10, contiguous: false, antiAlias: false },
  );
  assert.equal(globalMask[0], 255);
  assert.equal(globalMask[2], 255);

  const noisySeed = makePixels([
    [[200, 200, 200, 255], [201, 200, 199, 255], [200, 201, 200, 255]],
    [[199, 200, 201, 255], [180, 180, 180, 255], [201, 199, 200, 255]],
    [[200, 199, 201, 255], [201, 201, 200, 255], [199, 200, 199, 255]],
  ]);
  const denoisedMask = colorSelection.createColorSelectionMask(
    noisySeed,
    3,
    3,
    1,
    1,
    { tolerance: 18, contiguous: true, antiAlias: false },
  );
  assert.equal(denoisedMask[0], 255);
  assert.equal(denoisedMask[8], 255);

  assert.equal(
    colorSelection.perceptualColorDistance(
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 255, g: 0, b: 255, a: 0 },
    ),
    0,
  );

  console.log('LayerLab interaction tests passed.');
} finally {
  await server.close();
}
