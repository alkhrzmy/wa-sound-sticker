#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSoundSticker } from './media.js';
import { parseWebpInfo } from './webp.js';
import { checkHermesBridgeHealth, sendViaHermesBridge } from './hermes-bridge.js';
import { startMcpServer } from './mcp.js';

const args = process.argv.slice(2);
const command = args[0];

function getArg(name, fallback = null) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

function printHelp() {
  console.log(`wa-sound-sticker — WhatsApp Sound Sticker CLI & MCP Server

Commands:
  convert      --image <path> [--audio <path> | --audio-url <https://...> | --video-audio]
               [--out <dir>] [--pack "..."] [--publisher "..."] [--emojis 🔊] [--fit contain|cover]
               [--start 0] [--duration 5] [--max-duration 10]
  bridge-send  --to <jid> --image <path> [--audio <path> | --audio-url <https://...> | --video-audio]
               [--pack "..."] [--publisher "..."] [--emojis 🔊] [--fit contain|cover] [--port 3000]
  inspect      --file <path.webp>
  health       [--port 3000]
  mcp          Start JSON-RPC 2.0 MCP server on stdio
`);
}

if (!command || command === '-h' || command === '--help') {
  printHelp();
  process.exit(0);
}

if (command === 'mcp') {
  startMcpServer();
} else if (command === 'inspect') {
  const filePath = getArg('file') || args[1];
  if (!filePath) {
    console.error('--file <path.webp> is required');
    process.exit(1);
  }
  const info = parseWebpInfo(readFileSync(path.resolve(filePath)));
  console.log(JSON.stringify(info, null, 2));
} else if (command === 'convert') {
  const filePath = getArg('image') || getArg('file');
  if (!filePath) {
    console.error('--image <path> is required');
    process.exit(1);
  }
  const outDir = path.resolve(getArg('out') || './out');
  mkdirSync(outDir, { recursive: true });
  const res = await createSoundSticker({
    filePath,
    audioPath: getArg('audio'),
    audioUrl: getArg('audio-url'),
    useVideoAudio: hasFlag('video-audio'),
    emojis: getArg('emojis'),
    packName: getArg('pack') || process.env.WA_STICKER_PACK_NAME || 'WA Sound Stickers',
    publisher: getArg('publisher') || process.env.WA_STICKER_PUBLISHER || 'wa-sound-sticker',
    fit: getArg('fit') || 'contain',
    startSec: Number(getArg('start') || 0),
    durationSec: getArg('duration') != null ? Number(getArg('duration')) : null,
    maxDurationSec: Number(getArg('max-duration') || 10),
  });
  const webpPath = path.join(outDir, 'sticker.webp');
  writeFileSync(webpPath, res.webpBuffer);
  let audioOut = null;
  if (res.audioBuffer) {
    audioOut = path.join(outDir, 'sound.ogg');
    writeFileSync(audioOut, res.audioBuffer);
  }
  console.log(JSON.stringify({
    webpPath,
    audioPath: audioOut,
    width: res.width,
    height: res.height,
    isAnimated: res.isAnimated,
    webpBytes: res.webpBuffer.length,
    audioBytes: res.audioBuffer?.length || 0,
    audioSeconds: res.audioSeconds || 0,
    soundSha256: res.soundSha256,
    exifMeta: res.exifMeta,
  }, null, 2));
} else if (command === 'health') {
  const port = getArg('port');
  const h = await checkHermesBridgeHealth(port ? { port: Number(port) } : {});
  console.log(JSON.stringify(h, null, 2));
} else if (command === 'bridge-send') {
  const chatId = getArg('to');
  const filePath = getArg('image') || getArg('file');
  if (!chatId || !filePath) {
    console.error('--to <jid> and --image <path> are required');
    process.exit(1);
  }
  const port = getArg('port');
  const out = await sendViaHermesBridge({
    chatId,
    filePath,
    audioPath: getArg('audio'),
    audioUrl: getArg('audio-url'),
    useVideoAudio: hasFlag('video-audio'),
    emojis: getArg('emojis'),
    packName: getArg('pack') || process.env.WA_STICKER_PACK_NAME || 'WA Sound Stickers',
    publisher: getArg('publisher') || process.env.WA_STICKER_PUBLISHER || 'wa-sound-sticker',
    fit: getArg('fit') || 'contain',
    startSec: Number(getArg('start') || 0),
    durationSec: getArg('duration') != null ? Number(getArg('duration')) : null,
    maxDurationSec: Number(getArg('max-duration') || 10),
    replyTo: getArg('reply-to'),
    bridgeConfig: port ? { port: Number(port) } : {},
  });
  console.log(JSON.stringify(out, null, 2));
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
