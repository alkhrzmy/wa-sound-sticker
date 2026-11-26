import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proto } from '@whiskeysockets/baileys';
import {
  extractSoundStickerInfo,
  installSoundStickerCodec,
  registerPendingSoundSticker,
  scanWireFields,
  unwrapSoundStickerMessage,
} from '../src/wire.js';

test('stock Baileys proto stays untouched on disk and zero-touch codec encodes/decodes field 134', () => {
  // Verify stock Baileys WAProto does NOT have audioStickerMessage natively
  assert.equal(
    Object.prototype.hasOwnProperty.call(proto.Message.prototype, 'audioStickerMessage'),
    false,
  );

  installSoundStickerCodec(proto);

  const audioMsg = proto.Message.AudioMessage.fromObject({
    url: 'https://mmg.whatsapp.net/v/audio.enc',
    directPath: '/v/audio.enc',
    mimetype: 'audio/ogg; codecs=opus',
    fileSha256: Buffer.alloc(32, 1),
    fileEncSha256: Buffer.alloc(32, 2),
    mediaKey: Buffer.alloc(32, 3),
    fileLength: 9876,
    seconds: 3,
    mediaKeyTimestamp: 1795650000,
  });
  const audioBytes = proto.Message.AudioMessage.encode(audioMsg).finish();

  const msg = proto.Message.fromObject({
    stickerMessage: {
      url: 'https://mmg.whatsapp.net/v/sticker.enc',
      directPath: '/v/sticker.enc',
      mimetype: 'image/webp',
      fileSha256: Buffer.alloc(32, 4),
      fileEncSha256: Buffer.alloc(32, 5),
      mediaKey: Buffer.alloc(32, 6),
      fileLength: 5432,
      width: 512,
      height: 512,
      isAnimated: true,
    },
    messageContextInfo: {
      messageSecret: Buffer.alloc(32, 7),
    },
  });

  registerPendingSoundSticker(msg.stickerMessage, {
    audioBytes,
    premium: 0,
    emojis: '🔊',
  });

  // Encode directly and also wrapped inside DeviceSentMessage
  const rawBytes = proto.Message.encode(msg).finish();
  const topFields = scanWireFields(rawBytes);

  assert.equal(topFields.some(f => f.fieldNum === 26), false, 'top-level field 26 must be dropped');
  assert.ok(topFields.some(f => f.fieldNum === 35), 'messageContextInfo (35) must remain');

  const f134 = topFields.find(f => f.fieldNum === 134 && f.wireType === 2);
  assert.ok(f134, 'top-level field 134 must be written');

  const fpFields = scanWireFields(f134.val);
  const f1 = fpFields.find(f => f.fieldNum === 1 && f.wireType === 2);
  assert.ok(f1);

  const innerFields = scanWireFields(f1.val);
  const f26 = innerFields.find(f => f.fieldNum === 26 && f.wireType === 2);
  assert.ok(f26);

  const stkFields = scanWireFields(f26.val);
  assert.equal(stkFields.find(f => f.fieldNum === 24)?.varintVal, 0);
  assert.equal(Buffer.from(stkFields.find(f => f.fieldNum === 25)?.val).toString('utf8'), '🔊');
  assert.ok(stkFields.find(f => f.fieldNum === 26 && f.wireType === 2));

  // Decode inbound round-trip
  const decoded = proto.Message.decode(rawBytes);
  const info = extractSoundStickerInfo(decoded);
  assert.ok(info);
  assert.equal(info.hasAudio, true);
  assert.equal(info.emojis, '🔊');
  assert.equal(info.premium, 0);
  assert.equal(info.audioSeconds, 3);
  assert.equal(info.audioMimetype, 'audio/ogg; codecs=opus');

  // Verify DeviceSentMessage recursive encode + decode
  const dsmBytes = proto.Message.encode(proto.Message.fromObject({
    deviceSentMessage: {
      destinationJid: '15551234567@s.whatsapp.net',
      message: msg,
    },
  })).finish();
  const decodedDsm = proto.Message.decode(dsmBytes);
  const unwrappedDsm = unwrapSoundStickerMessage(decodedDsm);
  assert.equal(unwrappedDsm.stickerMessage.audioMessage.seconds, 3);
  assert.equal(unwrappedDsm.stickerMessage.emojis, '🔊');
});
