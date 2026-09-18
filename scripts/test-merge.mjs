import assert from 'node:assert/strict';
import { createServer } from 'vite';

const layer = (id, parentId = null, overrides = {}) => ({
  id,
  type: 'image',
  name: id,
  parentId,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'source-over',
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  ...overrides,
});
const group = (id, parentId = null, overrides = {}) => layer(id, parentId, { type: 'group', ...overrides });

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { planSafeMerge } = await server.ssrLoadModule('/src/interactions/mergePolicy.ts');

  const normal = planSafeMerge([layer('top'), layer('bottom'), layer('outside')], ['top', 'bottom']);
  assert.equal(normal.ok, true, 'a contiguous root block remains mergeable');
  assert.deepEqual(normal.ok && normal.removeIds, ['top', 'bottom']);
  assert.deepEqual(normal.ok && normal.renderIds, ['top', 'bottom']);

  const nonContiguous = planSafeMerge([layer('top'), layer('gap'), layer('bottom')], ['top', 'bottom']);
  assert.deepEqual(nonContiguous, { ok: false, reason: 'non-contiguous' });

  const nested = planSafeMerge([
    group('folder'), layer('child-a', 'folder'), layer('child-b', 'folder'), layer('outside'),
  ], ['folder', 'child-a']);
  assert.equal(nested.ok, true, 'selecting a group normalizes away its selected descendant');
  assert.deepEqual(nested.ok && nested.rootIds, ['folder']);
  assert.deepEqual(nested.ok && nested.removeIds, ['folder', 'child-a', 'child-b']);

  const translucentWholeGroup = planSafeMerge([
    group('folder', null, { opacity: 0.5 }), layer('child-a', 'folder'), layer('child-b', 'folder'),
  ], ['folder']);
  assert.equal(translucentWholeGroup.ok, true, 'removing a complete translucent group does not reapply its opacity');

  const translucentRetainedParent = planSafeMerge([
    group('folder', null, { opacity: 0.5 }), layer('child-a', 'folder'), layer('child-b', 'folder'),
  ], ['child-a', 'child-b']);
  assert.deepEqual(translucentRetainedParent, { ok: false, reason: 'ancestor-state' });

  const hiddenDescendant = planSafeMerge([
    group('folder'), layer('child-a', 'folder'), layer('child-b', 'folder', { visible: false }),
  ], ['folder']);
  assert.deepEqual(hiddenDescendant, { ok: false, reason: 'hidden' });

  const blend = planSafeMerge([layer('top', null, { blendMode: 'multiply' }), layer('bottom')], ['top', 'bottom']);
  assert.deepEqual(blend, { ok: false, reason: 'blend-mode' });

  const clippingOutside = planSafeMerge([
    layer('clip', null, { clipped: true }), layer('base'), layer('other'),
  ], ['base', 'other']);
  assert.deepEqual(clippingOutside, { ok: false, reason: 'clipping' });

  const clippingInside = planSafeMerge([
    layer('clip', null, { clipped: true }), layer('base'), layer('other'),
  ], ['clip', 'base']);
  assert.equal(clippingInside.ok, true, 'a complete clipping pair is safe to remove together');

  console.log('merge policy tests passed');
} finally {
  await server.close();
}
