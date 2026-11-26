#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSoundSticker } from './media.js';
import { parseWebpInfo } from './webp.js';
import { checkHermesBridgeHealth, sendViaHermesBridge } from './hermes-bridge.js';

const SERVER_INFO = { name: 'wa-sound-sticker', version: '1.0.0' };
const SUPPORTED_PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'create_sound_sticker',
    description:
      'Convert an image, animated GIF, WebP, or short video + optional audio file or MyInstants HTTPS URL into a WhatsApp-ready 512x512 WebP (with 0x5741 EXIF + sound-sha256) and 48kHz mono Ogg/Opus audio.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Local path to visual input (PNG, JPG, WebP, GIF, MP4, MOV, WebM).' },
        audioPath: { type: 'string', description: 'Optional local path to audio (MP3, WAV, OGG, M4A, AAC).' },
        audioUrl: { type: 'string', description: 'Optional HTTPS audio URL or MyInstants page URL.' },
        useVideoAudio: { type: 'boolean', description: 'Extract audio from filePath when filePath is a video.' },
        outDir: { type: 'string', description: 'Directory where sticker.webp and sound.ogg will be written.' },
        packName: { type: 'string', description: 'Sticker pack name shown in WhatsApp.' },
        publisher: { type: 'string', description: 'Sticker pack author/publisher shown in WhatsApp.' },
        emojis: { type: 'string', description: 'Emoji tag for the sticker (default: 🔊).' },
        fit: { type: 'string', enum: ['contain', 'cover'], description: 'Square framing mode (default: contain).' },
        startSec: { type: 'number', description: 'Trim start offset in seconds.' },
        durationSec: { type: 'number', description: 'Trim duration in seconds.' },
        maxDurationSec: { type: 'number', description: 'Max duration cap in seconds (default: 10).' },
      },
      required: ['filePath', 'outDir'],
    },
  },
  {
    name: 'send_sound_sticker_via_bridge',
    description:
      'Send a native WhatsApp sticker or sound sticker (audioStickerMessage field 134) through the running Hermes WhatsApp bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'Target WhatsApp JID (@s.whatsapp.net, @lid, or @g.us).' },
        filePath: { type: 'string', description: 'Local path to image, GIF, WebP, or video.' },
        audioPath: { type: 'string', description: 'Optional local audio path.' },
        audioUrl: { type: 'string', description: 'Optional HTTPS audio URL or MyInstants URL.' },
        useVideoAudio: { type: 'boolean', description: 'Extract audio track from video filePath.' },
        packName: { type: 'string', description: 'Sticker pack name.' },
        publisher: { type: 'string', description: 'Sticker pack publisher.' },
        emojis: { type: 'string', description: 'Emoji metadata.' },
        fit: { type: 'string', enum: ['contain', 'cover'], description: 'Square framing mode.' },
        startSec: { type: 'number' },
        durationSec: { type: 'number' },
        maxDurationSec: { type: 'number' },
        replyTo: { type: 'string', description: 'Optional message ID to quote.' },
      },
      required: ['chatId', 'filePath'],
    },
  },
  {
    name: 'inspect_webp_sticker',
    description: 'Inspect RIFF dimensions, animation status, and WhatsApp 0x5741 EXIF JSON of a .webp sticker file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Local path to .webp file.' },
      },
      required: ['filePath'],
    },
  },
];

async function handleToolCall(name, args = {}) {
  if (name === 'create_sound_sticker') {
    const outDir = path.resolve(args.outDir);
    mkdirSync(outDir, { recursive: true });
    const res = await createSoundSticker({
      filePath: args.filePath,
      audioPath: args.audioPath || null,
      audioUrl: args.audioUrl || null,
      useVideoAudio: Boolean(args.useVideoAudio),
      emojis: args.emojis || null,
      packName: args.packName || process.env.WA_STICKER_PACK_NAME || 'WA Sound Stickers',
      publisher: args.publisher || process.env.WA_STICKER_PUBLISHER || 'wa-sound-sticker',
      fit: args.fit || 'contain',
      startSec: args.startSec || 0,
      durationSec: args.durationSec ?? null,
      maxDurationSec: args.maxDurationSec || 10,
    });
    const webpPath = path.join(outDir, 'sticker.webp');
    writeFileSync(webpPath, res.webpBuffer);
    let audioPathOut = null;
    if (res.audioBuffer) {
      audioPathOut = path.join(outDir, 'sound.ogg');
      writeFileSync(audioPathOut, res.audioBuffer);
    }
    return {
      webpPath,
      audioPath: audioPathOut,
      width: res.width,
      height: res.height,
      isAnimated: res.isAnimated,
      webpBytes: res.webpBuffer.length,
      audioBytes: res.audioBuffer?.length || 0,
      audioSeconds: res.audioSeconds || 0,
      soundSha256: res.soundSha256 || null,
      exifMeta: res.exifMeta,
    };
  }

  if (name === 'send_sound_sticker_via_bridge') {
    const health = await checkHermesBridgeHealth().catch(() => null);
    if (health && health.capabilities && !health.capabilities.soundStickers) {
      throw new Error('Running Hermes bridge does not report soundStickers capability');
    }
    return sendViaHermesBridge({
      chatId: args.chatId,
      filePath: args.filePath,
      audioPath: args.audioPath || null,
      audioUrl: args.audioUrl || null,
      useVideoAudio: Boolean(args.useVideoAudio),
      emojis: args.emojis || null,
      packName: args.packName || process.env.WA_STICKER_PACK_NAME || 'WA Sound Stickers',
      publisher: args.publisher || process.env.WA_STICKER_PUBLISHER || 'wa-sound-sticker',
      fit: args.fit || 'contain',
      startSec: args.startSec || 0,
      durationSec: args.durationSec ?? null,
      maxDurationSec: args.maxDurationSec || 10,
      replyTo: args.replyTo || null,
    });
  }

  if (name === 'inspect_webp_sticker') {
    const buf = readFileSync(path.resolve(args.filePath));
    return parseWebpInfo(buf);
  }

  throw new Error(`Unknown tool: ${name}`);
}

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

export function startMcpServer() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      sendError(null, -32700, 'Parse error');
      return;
    }

    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    try {
      if (method === 'initialize') {
        if (!isNotification) {
          sendResponse(id, {
            protocolVersion: params?.protocolVersion || SUPPORTED_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
        }
        return;
      }
      if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
        return;
      }
      if (method === 'ping') {
        if (!isNotification) sendResponse(id, {});
        return;
      }
      if (method === 'tools/list') {
        if (!isNotification) sendResponse(id, { tools: TOOLS });
        return;
      }
      if (method === 'tools/call') {
        try {
          const data = await handleToolCall(params?.name, params?.arguments || {});
          if (!isNotification) {
            sendResponse(id, {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            });
          }
        } catch (err) {
          if (!isNotification) {
            sendResponse(id, {
              isError: true,
              content: [{ type: 'text', text: err?.message || String(err) }],
            });
          }
        }
        return;
      }
      if (!isNotification) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      if (!isNotification) {
        sendError(id, -32603, err?.message || String(err));
      }
    }
  });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  }
}

if (isMainModule()) {
  startMcpServer();
}
