import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

// These exercise real Zustand/Zundo stores, not rendering. Konva's Node entry
// otherwise requires the optional native `canvas` package, unused by this suite.
const require = createRequire(import.meta.url);
const konvaPath = require.resolve('konva');
const previousKonva = require.cache[konvaPath];
require.cache[konvaPath] = { exports: { stages: [] } };
let server;
try {
  server = await createServer({
    configFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true },
  });
  const { createDocumentStore, createImageLayer } = await server.ssrLoadModule('/src/store/editorStore.ts');
  const { fittedImageBounds } = await server.ssrLoadModule('/src/interactions/canvasFit.ts');
  const { createTemporaryHandController } = await server.ssrLoadModule('/src/interactions/temporaryHand.ts');

  const guides = createDocumentStore();
  const originalLayers = guides.getState().layers;
  guides.getState().addGuide('v', 100);
  const id = guides.getState().guides[0].id;
  assert.equal(guides.temporal.getState().pastStates.length, 1);
  guides.getState().updateGuide(id, 110);
  guides.getState().updateGuide(id, 120);
  assert.equal(guides.getState().guides[0].pos, 120);
  guides.temporal.getState().undo();
  assert.equal(guides.getState().guides[0].pos, 110);
  guides.temporal.getState().redo();
  assert.equal(guides.getState().guides[0].pos, 120);
  guides.getState().clearGuides();
  assert.deepEqual(guides.getState().guides, []);
  guides.temporal.getState().undo();
  assert.equal(guides.getState().guides[0].pos, 120);
  assert.equal(guides.getState().layers, originalLayers);
  guides.getState().removeGuide(id);
  guides.temporal.getState().undo();
  assert.equal(guides.getState().guides[0].pos, 120);
  const historyCount = guides.temporal.getState().pastStates.length;
  guides.getState().updateGuide(id, 120);
  guides.getState().updateGuide(id, NaN);
  guides.getState().addGuide('h', Infinity);
  guides.getState().removeGuide('missing');
  assert.equal(guides.temporal.getState().pastStates.length, historyCount);
  while (guides.temporal.getState().pastStates.length) guides.temporal.getState().undo();
  assert.deepEqual(guides.getState().guides, []);

  const image = createImageLayer('unused-in-store-tests', 100, 50);
  const cases = [
    { rotation: 0, scaleX: 1, scaleY: 1, bounds: { x: 10, y: 20, width: 100, height: 50 } },
    { rotation: 90, scaleX: 1, scaleY: 1, bounds: { x: -40, y: 20, width: 50, height: 100 } },
    { rotation: 180, scaleX: 1, scaleY: 1, bounds: { x: -90, y: -30, width: 100, height: 50 } },
    { rotation: 0, scaleX: -1, scaleY: 1, bounds: { x: -90, y: 20, width: 100, height: 50 } },
    { rotation: 0, scaleX: -1, scaleY: -1, bounds: { x: -90, y: -30, width: 100, height: 50 } },
    { rotation: 90, scaleX: -1, scaleY: -1, bounds: { x: 10, y: -80, width: 50, height: 100 } },
    { rotation: 45, scaleX: 1, scaleY: 1, bounds: { x: -26, y: 20, width: 107, height: 107 } },
  ];
  for (const { bounds, ...transform } of cases) {
    const target = { ...image, x: 10, y: 20, ...transform };
    assert.deepEqual(fittedImageBounds(target), bounds);
    const other = { ...image, id: 'other', x: 37, y: 65 };
    const doc = createDocumentStore();
    doc.setState({ layers: [target, other], guides: [{ id: 'v', axis: 'v', pos: 30 }, { id: 'h', axis: 'h', pos: 40 }] });
    doc.temporal.getState().clear();
    const before = doc.getState();
    doc.getState().fitCanvasToLayer(target.id);
    const after = doc.getState();
    assert.equal(after.canvas.width, bounds.width);
    assert.equal(after.canvas.height, bounds.height);
    assert.equal(after.layers[0].x, 10 - bounds.x);
    assert.equal(after.layers[0].y, 20 - bounds.y);
    assert.equal(after.layers[0].rotation, target.rotation);
    assert.equal(after.layers[0].scaleX, target.scaleX);
    assert.equal(after.layers[1].x - after.layers[0].x, 27);
    assert.equal(after.layers[1].y - after.layers[0].y, 45);
    assert.equal(after.guides[0].pos, 30 - bounds.x);
    assert.equal(after.guides[1].pos, 40 - bounds.y);
    assert.equal(doc.temporal.getState().pastStates.length, 1);
    doc.temporal.getState().undo();
    assert.equal(doc.getState().canvas, before.canvas);
    assert.equal(doc.getState().layers, before.layers);
    assert.equal(doc.getState().guides, before.guides);
    doc.temporal.getState().redo();
    assert.equal(doc.getState().layers, after.layers);
  }
  assert.equal(fittedImageBounds({ ...image, scaleX: 0 }), null);
  assert.equal(fittedImageBounds({ ...image, rotation: NaN }), null);
  assert.equal(fittedImageBounds({ ...image, scaleY: 1000 }), null);

  const mergeDoc = createDocumentStore();
  mergeDoc.setState({ layers: [{ ...image, id: 'first' }, { ...image, id: 'second' }] });
  mergeDoc.temporal.getState().clear();
  const mergeBefore = mergeDoc.getState().layers;
  assert.equal(mergeDoc.getState().mergeLayers(['first', 'second'], 'merged-raster', 100, 50, 'Merged'), true);
  assert.equal(mergeDoc.getState().layers.length, 1);
  assert.equal(mergeDoc.temporal.getState().pastStates.length, 1);
  mergeDoc.temporal.getState().undo();
  assert.equal(mergeDoc.getState().layers, mergeBefore);
  mergeDoc.setState({ layers: [{ ...image, id: 'locked', locked: true }] });
  const lockedBefore = mergeDoc.getState().layers;
  assert.equal(mergeDoc.getState().mergeLayers(['locked'], 'merged-raster', 100, 50, 'Merged'), false);
  assert.equal(mergeDoc.getState().layers, lockedBefore);
  assert.equal(mergeDoc.getState().mergeLayers(['missing'], 'merged-raster', 100, 50, 'Merged'), false);

  const a = createDocumentStore();
  const b = createDocumentStore();
  a.getState().setTool('brush');
  b.getState().setTool('text');
  const hand = createTemporaryHandController();
  hand.begin(a);
  hand.begin(a); // repeat never replaces the original tool
  assert.equal(a.getState().tool, 'hand');
  hand.release(); // workspace switch / blur / keyup share this operation
  assert.equal(a.getState().tool, 'brush');
  assert.equal(b.getState().tool, 'text');
  hand.begin(a);
  hand.begin(b);
  assert.equal(a.getState().tool, 'brush');
  assert.equal(b.getState().tool, 'hand');
  hand.release();
  assert.equal(b.getState().tool, 'text');
  hand.begin(a);
  a.getState().setTool('shape');
  hand.release();
  assert.equal(a.getState().tool, 'shape');
  a.getState().setTool('hand');
  hand.begin(a);
  hand.release();
  assert.equal(a.getState().tool, 'hand');
  console.log('LayerLab editor store regression tests passed.');
} finally {
  await server?.close();
  if (previousKonva) require.cache[konvaPath] = previousKonva;
  else delete require.cache[konvaPath];
}
