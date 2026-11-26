# Hermes Agent & MCP Integration

There are two ways to give Hermes Agent (or any MCP-capable agent like Claude Code / Cursor) native WhatsApp sound sticker capabilities:

## Option 1: Zero-Touch MCP Server (No core Hermes edits)

Add `wa-sound-sticker-mcp` to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  wa_sound_sticker:
    command: node
    args: ["/absolute/path/to/wa-sound-sticker/src/mcp.js"]
    env:
      WA_STICKER_PACK_NAME: "My Stickers"
      WA_STICKER_PUBLISHER: "@handle"
```

Copy `integrations/hermes/SKILL.md` to `~/.hermes/skills/messaging/whatsapp-sound-stickers/SKILL.md` so the agent knows when to invoke `create_sound_sticker` and `send_sound_sticker_via_bridge`.

## Option 2: Hermes Bridge `/send-sticker` Endpoint

If you run Hermes' Baileys bridge (`scripts/whatsapp-bridge/bridge.js`), `send_sound_sticker_via_bridge` expects a `POST /send-sticker` route authenticated with the session `.bridge-token`.

On the bridge side, use `createSoundSticker()` + `sendSoundSticker()` from `wa-sound-sticker`:

```js
import { sendSoundSticker } from 'wa-sound-sticker';

app.post('/send-sticker', async (req, res) => {
  const { chatId, filePath, audioPath, audioUrl, useVideoAudio, emojis, packName, publisher, fit, startSec, durationSec } = req.body;
  const result = await sendSoundSticker(sock, chatId, {
    filePath,
    audioPath,
    audioUrl,
    useVideoAudio,
    emojis,
    packName,
    publisher,
    fit,
    startSec,
    durationSec,
  });
  res.json({ success: true, ...result });
});
```

Because `sendSoundSticker` uses `wa-sound-sticker`'s runtime `installSoundStickerCodec(proto)` hook, **you do not need to edit any files inside `node_modules/@whiskeysockets/baileys`**.
