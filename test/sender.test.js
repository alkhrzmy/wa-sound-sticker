import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { proto } from '@whiskeysockets/baileys';
import { sendSoundSticker } from '../src/sender.js';
import { extractSoundStickerInfo, scanWireFields } from '../src/wire.js';

test('sendSoundSticker works end-to-end with stock Baileys upload + relayMessage while preserving mediatype=sticker', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wass-sender-test-'));
  try {
    const pngPath = path.join(dir, 'icon.png');
    await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 245, g: 158, b: 11, alpha: 1 } },
    }).png().toFile(pngPath);

    const wavPath = path.join(dir, 'clip.wav');
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=600:duration=1.2',
      '-ar', '48000', '-ac', '1', wavPath,
    ], { stdio: 'pipe' });

    const uploadedTypes = [];
    const relayed = [];

    const mockSock = {
      authState: { creds: { me: { id: '6281111111111:1@s.whatsapp.net' } } },
      user: { id: '6281111111111:1@s.whatsapp.net' },
      async waUploadToServer(_encFilePath, { mediaType }) {
        uploadedTypes.push(mediaType);
        return {
          mediaUrl: `https://mmg.whatsapp.net/v/${mediaType}/item`,
          directPath: `/v/${mediaType}/item`,
        };
      },
      async relayMessage(jid, message, opts) {
        // Simulate stock Baileys getMediaType check before encoding
        assert.ok(message.stickerMessage, 'relayMessage must see stickerMessage so stock Baileys sets mediatype="sticker"');
        const wireBytes = proto.Message.encode(message).finish();
        relayed.push({ jid, message, opts, wireBytes });
      },
    };

    const result = await sendSoundSticker(mockSock, '6287860811076@s.whatsapp.net', {
      filePath: pngPath,
      audioPath: wavPath,
      packName: 'Jimmy Stickers',
      publisher: '@jimnn.as',
      emojis: ['🔊'],
    });

    assert.equal(result.hasAudio, true);
    assert.equal(result.isAnimated, true);
    assert.deepEqual(uploadedTypes, ['audio', 'sticker']);
    assert.equal(relayed.length, 1);

    // Check actual emitted protobuf wire bytes
    const topFields = scanWireFields(relayed[0].wireBytes);
    assert.equal(topFields.some(f => f.fieldNum === 26), false);
    assert.ok(topFields.some(f => f.fieldNum === 134));

    const decoded = proto.Message.decode(relayed[0].wireBytes);
    const info = extractSoundStickerInfo(decoded);
    assert.equal(info.hasAudio, true);
    assert.equal(info.emojis, '🔊');
    assert.equal(info.audioMimetype, 'audio/ogg; codecs=opus');
    assert.equal(info.audioSeconds, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
