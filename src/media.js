import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  STICKER_SIDE_PX,
  buildWhatsAppStickerMeta,
  injectWhatsAppExif,
  parseWebpInfo,
} from './webp.js';

export const MAX_SOUND_STICKER_WEBP_BYTES = 950_000;
export const MAX_PLAIN_ANIMATED_WEBP_BYTES = 490_000;
export const MAX_PLAIN_STATIC_WEBP_BYTES = 98_000;
export const MAX_STICKER_AUDIO_BYTES = 950_000;
export const DEFAULT_MAX_DURATION_SEC = 10;
export const ALLOWED_MYINSTANTS_HOSTS = new Set(['www.myinstants.com', 'myinstants.com']);

const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', '3gp', 'm4v']);

export function isDisallowedIp(ip) {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    const norm = ip.toLowerCase();
    if (norm === '::' || norm === '::1') return true;
    if (norm.startsWith('fe80:') || norm.startsWith('fc') || norm.startsWith('fd') || norm.startsWith('ff')) {
      return true;
    }
    if (norm.startsWith('::ffff:')) {
      return isDisallowedIp(norm.slice(7));
    }
    return false;
  }
  return true;
}

export function validateSafeHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Malformed URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL userinfo is forbidden');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Non-443 ports are forbidden');
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || isIP(host)) {
    if (!host || host === 'localhost' || isDisallowedIp(host)) {
      throw new Error('Disallowed host or IP address');
    }
  }
  return parsed;
}

async function assertPublicHostname(hostname) {
  if (isIP(hostname)) {
    if (isDisallowedIp(hostname)) throw new Error('Private or reserved IP address forbidden');
    return;
  }
  const addrs = await dnsLookup(hostname, { all: true });
  if (!addrs.length) throw new Error('DNS returned no addresses');
  for (const { address } of addrs) {
    if (isDisallowedIp(address)) {
      throw new Error(`Resolved to disallowed private/reserved IP (${address})`);
    }
  }
}

export function extractMyInstantsMediaUrl(html, pageUrl) {
  const patterns = [
    /preload\(\s*['"]([^'"]+\.(?:mp3|ogg|wav|m4a))['"]\s*\)/i,
    /onclick=["'][^"']*play\(\s*['"]([^'"]+\.(?:mp3|ogg|wav|m4a))['"]/i,
    /<audio[^>]+src=["']([^"']+)["']/i,
    /["'](\/media\/sounds\/[^"']+\.(?:mp3|ogg|wav|m4a))["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return new URL(m[1], pageUrl).toString();
    }
  }
  return null;
}

export async function downloadAudioFromUrl(rawUrl, tmpPrefix) {
  const parsed = validateSafeHttpsUrl(rawUrl);
  const host = parsed.hostname.toLowerCase();
  await assertPublicHostname(host);

  let fetchUrl = parsed.toString();
  if (ALLOWED_MYINSTANTS_HOSTS.has(host) && !/\.(?:mp3|ogg|wav|m4a)(?:$|\?)/i.test(parsed.pathname)) {
    const resp = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 wa-sound-sticker/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      throw new Error(`MyInstants page fetch failed (HTTP ${resp.status})`);
    }
    const html = await resp.text();
    const extracted = extractMyInstantsMediaUrl(html, fetchUrl);
    if (!extracted) {
      throw new Error('Could not find audio link on MyInstants page');
    }
    const nextParsed = validateSafeHttpsUrl(extracted);
    await assertPublicHostname(nextParsed.hostname.toLowerCase());
    fetchUrl = nextParsed.toString();
  }

  const audioResp = await fetch(fetchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 wa-sound-sticker/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!audioResp.ok) {
    throw new Error(`Audio URL fetch failed (HTTP ${audioResp.status})`);
  }
  const buf = Buffer.from(await audioResp.arrayBuffer());
  if (!buf.length || buf.length > 25 * 1024 * 1024) {
    throw new Error(`Downloaded audio size invalid (${buf.length} bytes)`);
  }
  const extMatch = new URL(fetchUrl).pathname.match(/\.(mp3|ogg|opus|wav|m4a|aac|flac)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';
  const outPath = `${tmpPrefix}_dl.${ext}`;
  writeFileSync(outPath, buf);
  return outPath;
}

export function probeDurationSec(filePath, ffprobeBin = 'ffprobe') {
  try {
    const out = execFileSync(ffprobeBin, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { timeout: 15_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const parsed = parseFloat(out);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function transcodeToWhatsAppOpus(inputPath, {
  startSec = 0,
  durationSec = null,
  maxDurationSec = DEFAULT_MAX_DURATION_SEC,
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
} = {}) {
  const srcDur = probeDurationSec(inputPath, ffprobeBin);
  const start = Math.max(0, Number(startSec) || 0);
  const maxDur = Math.max(0.5, Number(maxDurationSec) || DEFAULT_MAX_DURATION_SEC);
  let targetDur = durationSec != null && Number(durationSec) > 0
    ? Math.min(Number(durationSec), maxDur)
    : maxDur;
  if (srcDur > 0) {
    const avail = Math.max(0.2, srcDur - start);
    targetDur = Math.min(targetDur, avail);
  }

  const tmpOut = path.join(tmpdir(), `wass_aud_${randomBytes(6).toString('hex')}.ogg`);
  try {
    for (const bitrate of ['32k', '24k', '16k', '12k']) {
      const args = ['-y', '-hide_banner', '-loglevel', 'error'];
      if (start > 0) args.push('-ss', start.toFixed(3));
      args.push('-i', inputPath);
      if (targetDur > 0) args.push('-t', targetDur.toFixed(3));
      // -vn -map 0:a:0 prevents cover-art video streams inside .ogg
      args.push(
        '-vn', '-map', '0:a:0',
        '-af', 'afade=t=in:st=0:d=0.008',
        '-ar', '48000', '-ac', '1',
        '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on',
        '-f', 'ogg', tmpOut,
      );
      execFileSync(ffmpegBin, args, { timeout: 30_000, stdio: 'pipe' });
      const oggBuffer = readFileSync(tmpOut);
      if (oggBuffer.length <= MAX_STICKER_AUDIO_BYTES || bitrate === '12k') {
        if (oggBuffer.length > MAX_STICKER_AUDIO_BYTES) {
          throw new Error(`Encoded Ogg Opus (${oggBuffer.length} bytes) exceeds 950 KB limit`);
        }
        const actualDur = probeDurationSec(tmpOut, ffprobeBin) || targetDur || 1;
        const seconds = Math.max(1, Math.round(actualDur));
        const soundSha256 = createHash('sha256').update(oggBuffer).digest('base64');
        return { oggBuffer, durationSec: actualDur, seconds, soundSha256 };
      }
    }
  } finally {
    try { if (existsSync(tmpOut)) unlinkSync(tmpOut); } catch {}
  }
  throw new Error('Failed to transcode audio to Opus');
}

export async function transcodeToStickerWebp(filePath, {
  hasAudio = false,
  targetDurationSec = 0,
  startSec = 0,
  fit = 'contain',
  meta = null,
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
} = {}) {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  const isVideo = VIDEO_EXTS.has(ext);
  const finalMeta = meta || buildWhatsAppStickerMeta();
  const sharpFit = fit === 'cover' ? 'cover' : 'contain';

  if (isVideo) {
    const dur = Math.max(0.5, Math.min(Number(targetDurationSec) || probeDurationSec(filePath, ffprobeBin) || 5, DEFAULT_MAX_DURATION_SEC));
    const tmpOut = path.join(tmpdir(), `wass_vid_${randomBytes(6).toString('hex')}.webp`);
    const presets = [
      [512, 15, 72],
      [512, 12, 55],
      [384, 12, 50],
      [320, 10, 40],
      [256, 8, 30],
    ];
    const cap = hasAudio ? MAX_SOUND_STICKER_WEBP_BYTES : MAX_PLAIN_ANIMATED_WEBP_BYTES;
    try {
      for (const [side, fps, q] of presets) {
        const scaleFilter = fit === 'cover'
          ? `fps=${fps},scale=${side}:${side}:force_original_aspect_ratio=increase,crop=${side}:${side},format=rgba`
          : `fps=${fps},scale=${side}:${side}:force_original_aspect_ratio=decrease,pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`;
        const args = ['-y', '-hide_banner', '-loglevel', 'error'];
        if (startSec > 0) args.push('-ss', Number(startSec).toFixed(3));
        args.push(
          '-i', filePath,
          '-t', dur.toFixed(3),
          '-an',
          '-vf', scaleFilter,
          '-c:v', 'libwebp_anim', '-loop', '0', '-q:v', String(q),
          tmpOut,
        );
        execFileSync(ffmpegBin, args, { timeout: 60_000, stdio: 'pipe' });
        const rawWebp = readFileSync(tmpOut);
        const withExif = injectWhatsAppExif(rawWebp, finalMeta, {
          forceAnimatedDurationMs: hasAudio ? Math.round(dur * 1000) : 0,
        });
        if (withExif.length <= cap || side === 256) {
          if (withExif.length > MAX_SOUND_STICKER_WEBP_BYTES) {
            throw new Error(`Animated WebP (${withExif.length} bytes) exceeds max limit`);
          }
          const info = parseWebpInfo(withExif);
          return { webpBuffer: withExif, ...info };
        }
      }
    } finally {
      try { if (existsSync(tmpOut)) unlinkSync(tmpOut); } catch {}
    }
  }

  const inputBuf = readFileSync(filePath);
  const imgMeta = await sharp(inputBuf, { animated: true }).metadata();
  const inputIsAnimated = (imgMeta.pages || 1) > 1;
  const maxBytes = hasAudio
    ? MAX_SOUND_STICKER_WEBP_BYTES
    : (inputIsAnimated ? MAX_PLAIN_ANIMATED_WEBP_BYTES : MAX_PLAIN_STATIC_WEBP_BYTES);

  if (inputIsAnimated) {
    for (const [side, q] of [[512, 75], [512, 55], [512, 35], [384, 45], [320, 35], [256, 25]]) {
      const encoded = await sharp(inputBuf, { animated: true })
        .resize(side, side, { fit: sharpFit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: q, effort: 4, loop: 0 })
        .toBuffer();
      const withExif = injectWhatsAppExif(encoded, finalMeta);
      if (withExif.length <= maxBytes || side === 256) {
        if (withExif.length > MAX_SOUND_STICKER_WEBP_BYTES) {
          throw new Error(`Animated sticker WebP (${withExif.length} bytes) exceeds 950 KB`);
        }
        const info = parseWebpInfo(withExif);
        return { webpBuffer: withExif, ...info };
      }
    }
  }

  const animDurMs = hasAudio ? Math.max(500, Math.min(10_000, Math.round((targetDurationSec || 2) * 1000))) : 0;
  for (const q of [88, 75, 60, 45, 30, 18]) {
    const encoded = await sharp(inputBuf)
      .ensureAlpha()
      .resize(STICKER_SIDE_PX, STICKER_SIDE_PX, {
        fit: sharpFit,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: q, effort: 4 })
      .toBuffer();
    const withExif = injectWhatsAppExif(encoded, finalMeta, {
      forceAnimatedDurationMs: animDurMs,
    });
    if (withExif.length <= maxBytes || q === 18) {
      const info = parseWebpInfo(withExif);
      return { webpBuffer: withExif, ...info };
    }
  }

  throw new Error('Failed to encode sticker WebP within WhatsApp size limits');
}

export async function createSoundSticker({
  filePath,
  audioPath = null,
  audioUrl = null,
  useVideoAudio = false,
  emojis = null,
  packName = process.env.WA_STICKER_PACK_NAME || 'WA Sound Stickers',
  publisher = process.env.WA_STICKER_PUBLISHER || 'wa-sound-sticker',
  fit = 'contain',
  startSec = 0,
  durationSec = null,
  maxDurationSec = DEFAULT_MAX_DURATION_SEC,
} = {}) {
  if (!filePath || !existsSync(filePath)) {
    throw new Error(`Sticker visual file not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  let tempDownloadedAudio = null;
  let audioResult = null;

  try {
    let effectiveAudioSource = audioPath || null;
    if (!effectiveAudioSource && audioUrl) {
      const tmpPrefix = path.join(tmpdir(), `wass_url_${randomBytes(6).toString('hex')}`);
      tempDownloadedAudio = await downloadAudioFromUrl(audioUrl, tmpPrefix);
      effectiveAudioSource = tempDownloadedAudio;
    } else if (!effectiveAudioSource && useVideoAudio && VIDEO_EXTS.has(ext)) {
      effectiveAudioSource = filePath;
    }

    if (effectiveAudioSource) {
      if (!existsSync(effectiveAudioSource)) {
        throw new Error(`Audio file not found: ${effectiveAudioSource}`);
      }
      audioResult = transcodeToWhatsAppOpus(effectiveAudioSource, {
        startSec,
        durationSec,
        maxDurationSec,
      });
    }

    const defaultEmoji = audioResult ? '🔊' : '✨';
    const emojiList = Array.isArray(emojis)
      ? (emojis.length ? emojis : [defaultEmoji])
      : String(emojis || defaultEmoji).trim()
        ? [String(emojis || defaultEmoji).trim()]
        : [defaultEmoji];

    const exifMeta = buildWhatsAppStickerMeta({
      packName,
      publisher,
      emojis: emojiList,
      soundSha256: audioResult?.soundSha256 || null,
    });

    const webpResult = await transcodeToStickerWebp(filePath, {
      hasAudio: Boolean(audioResult),
      targetDurationSec: audioResult?.durationSec || durationSec || 0,
      startSec: !audioPath && !audioUrl && useVideoAudio ? startSec : 0,
      fit,
      meta: exifMeta,
    });

    return {
      webpBuffer: webpResult.webpBuffer,
      width: webpResult.width,
      height: webpResult.height,
      isAnimated: webpResult.isAnimated,
      emojis: emojiList,
      exifMeta,
      audioBuffer: audioResult?.oggBuffer || null,
      audioSeconds: audioResult?.seconds || null,
      audioMimetype: audioResult ? 'audio/ogg; codecs=opus' : null,
      soundSha256: audioResult?.soundSha256 || null,
    };
  } finally {
    if (tempDownloadedAudio) {
      try { if (existsSync(tempDownloadedAudio)) unlinkSync(tempDownloadedAudio); } catch {}
    }
  }
}
