import test from 'node:test';
import assert from 'node:assert/strict';
import * as gifenc from 'gifenc';
import { writeReplayFrame } from '../../src/lib/games/replay-gif.js';

const { GIFEncoder } = Reflect.get(gifenc, 'default') ?? gifenc;

test('cropped replay frames reuse their palette and preserve the header at any crop offset', () => {
  const gif = GIFEncoder(), palette = [[0, 0, 0], [255, 255, 255]], pixels = new Uint8Array(6);
  writeReplayFrame(gif, pixels, 2, 3, { palette, delay: 100 });
  const header = gif.bytesView().slice();
  for (const top of [100, 300]) {
    const start = gif.bytesView().length;
    writeReplayFrame(gif, pixels, 2, 3, { delay: 50, top });
    const bytes = gif.bytesView(), image = start + 8;
    assert.deepEqual(bytes.slice(0, header.length), header);
    assert.equal(bytes[image], 0x2c);
    assert.equal(bytes[image + 3] | bytes[image + 4] << 8, top);
    assert.equal(bytes[image + 9] & 0x80, 0, 'Cropped frames use the global palette');
    assert.equal(bytes[start + 3] >> 2 & 7, 1, 'The previous frame remains underneath');
  }
});

test('an unexpected encoder descriptor fails instead of corrupting the export', () => {
  let bytes = new Uint8Array();
  const gif = { bytesView: () => bytes, writeFrame() { bytes = new Uint8Array(20); } };
  assert.throws(() => writeReplayFrame(gif, new Uint8Array(1), 1, 1, { delay: 100, top: 100 }), /Could not encode/);
});
