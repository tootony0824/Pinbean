import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasPointerInput, sampleCanvasSegment } from '../src/utils/canvasPointerInput';
const pointer = (pointerId: number, pointerType: string, clientX = 10, clientY = 10) => ({ pointerId, pointerType, clientX, clientY, button: 0 });
test('touch only pans, pen interrupts touch and blocks that contact until lift', () => {
  const input = new CanvasPointerInput();
  assert.equal(input.down(pointer(1, 'touch')), 'pan');
  assert.deepEqual(input.move(pointer(1, 'touch', 30, 20)), { type: 'pan', dx: 20, dy: 10 });
  assert.equal(input.down(pointer(2, 'pen')), 'draw');
  assert.equal(input.move(pointer(1, 'touch', 40)), null);
  assert.equal(input.down(pointer(3, 'touch')), 'ignore');
  assert.equal(input.end(3), false);
  assert.equal(input.move(pointer(2, 'pen', 50))?.type, 'draw');
  input.end(2);
  assert.equal(input.move(pointer(1, 'touch')), null);
  input.end(1);
  assert.equal(input.down(pointer(1, 'touch')), 'pan');
});
test('cancel/reset releases drawing ownership, foreign pointer cannot end a stroke', () => {
  const input = new CanvasPointerInput();
  assert.equal(input.down(pointer(1, 'mouse')), 'draw');
  assert.equal(input.end(9), false);
  assert.equal(input.move(pointer(1, 'mouse'))?.type, 'draw');
  input.end(1);
  assert.equal(input.move(pointer(1, 'mouse')), null);
  input.down(pointer(2, 'pen'));
  input.reset();
  assert.equal(input.down(pointer(3, 'touch')), 'pan');
});
test('fast motion covers intermediate cells after translation and scaling, outside stays empty', () => {
  const rect = { left: 100, top: 200, width: 200, height: 100 };
  assert.deepEqual(sampleCanvasSegment({ x: 110, y: 210 }, { x: 290, y: 210 }, rect, 10, 5), [0,1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(sampleCanvasSegment({ x: 110, y: 210 }, { x: 190, y: 290 }, rect, 10, 5), [0,11,22,33,44]);
  assert.deepEqual(sampleCanvasSegment({ x: 0, y: 0 }, { x: 50, y: 50 }, rect, 10, 5), []);
});
