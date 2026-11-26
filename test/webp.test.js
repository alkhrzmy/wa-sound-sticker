import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  buildWhatsAppExif,
  buildWhatsAppStickerMeta,
  extractWhatsAppExifMeta,
  injectWhatsAppExif,
  parseWebpInfo,
  readWebpChunks,
} from '../src/webp.js';

test('injectWhatsAppExif wraps static WebP into 1-frame animated WebP with 0x5741 EXIF', async () => {
  const staticWebp = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 120, b: 0, alpha: 0.9 } },
  }).webp({ quality: 80 }).toBuffer();

  const meta = buildWhatsAppStickerMeta({
    packName: 'My Pack',
    publisher: '@tester',
    emojis: ['🔊'],
    soundSha256: 'abc123sha==',
  });
  const animated = injectWhatsAppExif(staticWebp, meta, { forceAnimatedDurationMs: 2500 });
  const chunks = readWebpChunks(animated).map(c => c.fourcc);

  assert.equal(chunks[0], 'VP8X');
  assert.ok(chunks.includes('ANIM'));
  assert.ok(chunks.includes('ANMF'));
  assert.equal(chunks[chunks.length - 1], 'EXIF');

  const info = parseWebpInfo(animated);
  assert.equal(info.width, 512);
  assert.equal(info.height, 512);
  assert.equal(info.isAnimated, true);
  assert.equal(info.hasAlpha, true);
  assert.equal(info.hasExif, true);

  const decodedMeta = extractWhatsAppExifMeta(animated);
  assert.equal(decodedMeta['sticker-pack-name'], 'My Pack');
  assert.equal(decodedMeta['sticker-pack-publisher'], '@tester');
  assert.equal(decodedMeta['sound-sha256'], 'abc123sha==');
  assert.deepEqual(decodedMeta.emojis, ['🔊']);
});

test('buildWhatsAppExif writes big-endian TIFF header with 0x5741 tag', () => {
  const exif = buildWhatsAppExif({ emojis: ['🎵'] });
  assert.equal(exif.subarray(0, 4).toString('hex'), '4d4d002a');
  assert.equal(exif.readUInt16BE(10), 0x5741);
  assert.equal(exif.readUInt16BE(12), 7);
});
