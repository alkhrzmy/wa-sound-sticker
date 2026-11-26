export {
  STICKER_SIDE_PX,
  buildWhatsAppExif,
  buildWhatsAppStickerMeta,
  extractWhatsAppExifMeta,
  injectWhatsAppExif,
  makeWebpChunk,
  packIdFor,
  parseWebpInfo,
  readWebpChunks,
} from './webp.js';

export {
  ALLOWED_MYINSTANTS_HOSTS,
  DEFAULT_MAX_DURATION_SEC,
  MAX_PLAIN_ANIMATED_WEBP_BYTES,
  MAX_PLAIN_STATIC_WEBP_BYTES,
  MAX_SOUND_STICKER_WEBP_BYTES,
  MAX_STICKER_AUDIO_BYTES,
  createSoundSticker,
  downloadAudioFromUrl,
  extractMyInstantsMediaUrl,
  isDisallowedIp,
  probeDurationSec,
  transcodeToStickerWebp,
  transcodeToWhatsAppOpus,
  validateSafeHttpsUrl,
} from './media.js';

export {
  decodeVarint,
  encodeVarint,
  extractSoundStickerInfo,
  installSoundStickerCodec,
  registerPendingSoundSticker,
  scanWireFields,
  unwrapSoundStickerMessage,
} from './wire.js';

export {
  downloadSoundSticker,
  sendSoundSticker,
} from './sender.js';

export {
  checkHermesBridgeHealth,
  resolveHermesBridgeConfig,
  sendViaHermesBridge,
} from './hermes-bridge.js';
