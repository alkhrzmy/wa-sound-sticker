import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function resolveHermesBridgeConfig({
  hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || '~', '.hermes'),
  sessionDir = null,
  port = null,
  token = process.env.HERMES_WHATSAPP_BRIDGE_TOKEN || null,
} = {}) {
  const resolvedSessionDir = sessionDir || path.join(hermesHome, 'whatsapp', 'session');
  const tokenPath = path.join(resolvedSessionDir, '.bridge-token');
  const pidPath = path.join(resolvedSessionDir, 'bridge.pid');

  let resolvedToken = token;
  if (!resolvedToken && existsSync(tokenPath)) {
    resolvedToken = readFileSync(tokenPath, 'utf8').trim();
  }
  if (!resolvedToken) {
    throw new Error(`Hermes bridge token not found at ${tokenPath}`);
  }

  let resolvedPort = port ? Number(port) : null;
  if (!resolvedPort && existsSync(pidPath)) {
    const lines = readFileSync(pidPath, 'utf8').trim().split(/\r?\n/);
    const pidPort = parseInt(lines[2] || '', 10);
    if (Number.isFinite(pidPort) && pidPort > 0) {
      resolvedPort = pidPort;
    }
  }
  if (!resolvedPort) {
    resolvedPort = 3000;
  }

  return {
    baseUrl: `http://127.0.0.1:${resolvedPort}`,
    port: resolvedPort,
    token: resolvedToken,
    sessionDir: resolvedSessionDir,
  };
}

export async function checkHermesBridgeHealth(config = {}) {
  const { baseUrl, token } = resolveHermesBridgeConfig(config);
  const resp = await fetch(`${baseUrl}/health`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    throw new Error(`Bridge /health returned HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function sendViaHermesBridge({
  chatId,
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
  maxDurationSec = 10,
  replyTo = null,
  mentions = null,
  bridgeConfig = {},
}) {
  if (!chatId) throw new Error('chatId is required');
  if (!filePath) throw new Error('filePath is required');

  const { baseUrl, token } = resolveHermesBridgeConfig(bridgeConfig);
  const body = {
    chatId,
    filePath: path.resolve(filePath),
    packName,
    publisher,
    fit,
    ...(audioPath ? { audioPath: path.resolve(audioPath) } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    ...(useVideoAudio ? { useVideoAudio: true } : {}),
    ...(emojis ? { emojis } : {}),
    ...(startSec ? { startSec: Number(startSec) } : {}),
    ...(durationSec != null ? { durationSec: Number(durationSec) } : {}),
    ...(maxDurationSec != null ? { maxDurationSec: Number(maxDurationSec) } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(mentions ? { mentions } : {}),
  };

  const resp = await fetch(`${baseUrl}/send-sticker`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Hermes bridge /send-sticker failed (HTTP ${resp.status}): ${text}`);
  }
  return JSON.parse(text);
}
