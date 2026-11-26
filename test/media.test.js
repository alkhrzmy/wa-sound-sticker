import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  createSoundSticker,
  extractMyInstantsMediaUrl,
  isDisallowedIp,
  validateSafeHttpsUrl,
} from '../src/media.js';
import { extractWhatsAppExifMeta } from '../src/webp.js';

test('validateSafeHttpsUrl and isDisallowedIp block SSRF vectors', () => {
  assert.equal(isDisallowedIp('127.0.0.1'), true);
  assert.equal(isDisallowedIp('10.0.0.1'), true);
  assert.equal(isDisallowedIp('192.168.1.5'), true);
  assert.equal(isDisallowedIp('169.254.169.254'), true);
  assert.equal(isDisallowedIp('::1'), true);
  assert.equal(isDisallowedIp('8.8.8.8'), false);

  assert.throws(() => validateSafeHttpsUrl('http://www.myinstants.com/a'), /HTTPS/);
  assert.throws(() => validateSafeHttpsUrl('https://user:pass@www.myinstants.com/a'), /userinfo/);
  assert.throws(() => validateSafeHttpsUrl('https://www.myinstants.com:8443/a'), /443/);
  assert.throws(() => validateSafeHttpsUrl('https://127.0.0.1/x.mp3'), /Disallowed/);

  const html = `<button onclick="play('/media/sounds/bruh.mp3', 'loader', '1')">Play</button>`;
  assert.equal(
    extractMyInstantsMediaUrl(html, 'https://www.myinstants.com/en/instant/bruh/'),
    'https://www.myinstants.com/media/sounds/bruh.mp3',
  );
});

test('createSoundSticker converts PNG, GIF, and MP4 into WhatsApp-compliant WebP + Ogg Opus', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wass-media-test-'));
  try {
    const pngPath = path.join(dir, 'badge.png');
    await sharp({
      create: { width: 900, height: 450, channels: 4, background: { r: 20, g: 180, b: 220, alpha: 1 } },
    }).png().toFile(pngPath);

    const wavPath = path.join(dir, 'ding.wav');
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.6',
      '-ar', '44100', '-ac', '2', wavPath,
    ], { stdio: 'pipe' });

    const plain = await createSoundSticker({ filePath: pngPath });
    assert.equal(plain.isAnimated, false);
    assert.equal(plain.audioBuffer, null);
    assert.ok(plain.webpBuffer.length <= 98_000);

    const sound = await createSoundSticker({
      filePath: pngPath,
      audioPath: wavPath,
      packName: 'Custom Pack',
      publisher: '@alkhrzmy',
      emojis: ['🔊'],
    });
    assert.equal(sound.isAnimated, true);
    assert.equal(sound.audioMimetype, 'audio/ogg; codecs=opus');
    assert.equal(sound.audioSeconds, 2);
    assert.equal(sound.audioBuffer.subarray(0, 4).toString('ascii'), 'OggS');
    const sha = createHash('sha256').update(sound.audioBuffer).digest('base64');
    assert.equal(sound.soundSha256, sha);
    const exif = extractWhatsAppExifMeta(sound.webpBuffer);
    assert.equal(exif['sound-sha256'], sha);
    assert.equal(exif['sticker-pack-name'], 'Custom Pack');
    assert.equal(exif['sticker-pack-publisher'], '@alkhrzmy');

    const f1 = path.join(dir, 'f1.png');
    const f2 = path.join(dir, 'f2.png');
    const gifPath = path.join(dir, 'anim.gif');
    await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toFile(f1);
    await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toFile(f2);
    execFileSync('ffmpeg', ['-y', '-framerate', '4', '-i', path.join(dir, 'f%d.png'), gifPath], { stdio: 'pipe' });

    const gifSound = await createSoundSticker({ filePath: gifPath, audioPath: wavPath });
    assert.equal(gifSound.isAnimated, true);
    assert.equal(extractWhatsAppExifMeta(gifSound.webpBuffer)['sound-sha256'], gifSound.soundSha256);

    const mp4Path = path.join(dir, 'clip.mp4');
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=purple:s=360x640:d=1.4',
      '-f', 'lavfi', '-i', 'sine=frequency=523:duration=1.4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4Path,
    ], { stdio: 'pipe' });

    const vidSound = await createSoundSticker({ filePath: mp4Path, useVideoAudio: true, fit: 'cover' });
    assert.equal(vidSound.isAnimated, true);
    assert.equal(vidSound.width, 512);
    assert.equal(vidSound.height, 512);
    assert.equal(extractWhatsAppExifMeta(vidSound.webpBuffer)['sound-sha256'], vidSound.soundSha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
