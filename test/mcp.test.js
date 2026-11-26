import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';

test('MCP stdio server handles initialize, tools/list, create_sound_sticker, and inspect_webp_sticker', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wass-mcp-test-'));
  const mcpPath = fileURLToPath(new URL('../src/mcp.js', import.meta.url));
  let child;
  try {
    const pngPath = path.join(dir, 'in.png');
    await sharp({
      create: { width: 300, height: 300, channels: 4, background: { r: 220, g: 38, b: 38, alpha: 1 } },
    }).png().toFile(pngPath);

    const wavPath = path.join(dir, 'in.wav');
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=1.1',
      '-ar', '48000', '-ac', '1', wavPath,
    ], { stdio: 'pipe' });

    const outDir = path.join(dir, 'out');
    child = spawn(process.execPath, [mcpPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = createInterface({ input: child.stdout });
    const pending = new Map();

    rl.on('line', (line) => {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });

    const rpc = (id, method, params = {}) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`RPC timeout for ${method}`)), 15_000);
      pending.set(id, (res) => { clearTimeout(t); resolve(res); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

    const init = await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    assert.equal(init.result.serverInfo.name, 'wa-sound-sticker');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    const list = await rpc(2, 'tools/list');
    const names = list.result.tools.map(t => t.name);
    assert.deepEqual(names, ['create_sound_sticker', 'send_sound_sticker_via_bridge', 'inspect_webp_sticker']);

    const created = await rpc(3, 'tools/call', {
      name: 'create_sound_sticker',
      arguments: {
        filePath: pngPath,
        audioPath: wavPath,
        outDir,
        packName: 'MCP Pack',
        publisher: '@alkhrzmy',
      },
    });
    assert.notEqual(created.result.isError, true);
    const createdPayload = JSON.parse(created.result.content[0].text);
    assert.equal(existsSync(createdPayload.webpPath), true);
    assert.equal(existsSync(createdPayload.audioPath), true);
    assert.equal(createdPayload.isAnimated, true);

    const inspected = await rpc(4, 'tools/call', {
      name: 'inspect_webp_sticker',
      arguments: { filePath: createdPayload.webpPath },
    });
    const inspectedPayload = JSON.parse(inspected.result.content[0].text);
    assert.equal(inspectedPayload.width, 512);
    assert.equal(inspectedPayload.height, 512);
    assert.equal(inspectedPayload.exifMeta['sticker-pack-name'], 'MCP Pack');
    assert.equal(inspectedPayload.exifMeta['sound-sha256'], createdPayload.soundSha256);
    assert.ok(readFileSync(createdPayload.audioPath).subarray(0, 4).toString('ascii') === 'OggS');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
