# wa-sound-sticker

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Native WhatsApp Sound Stickers (`audioStickerMessage`, protobuf field `134`) for Node.js, Baileys 7.x, CLI, and AI Agents (MCP / Hermes Agent) — without editing `node_modules`.**

Turn any PNG, JPG, WebP, animated GIF, or short video (MP4/MOV/WebM) + local audio or MyInstants HTTPS URL into a real WhatsApp sound sticker (`512x512` WebP with `0x5741` EXIF + `48 kHz` mono Ogg/Opus) and send/decode it straight over Baileys or your AI agent.

---

## Why this exists

| Project | Creates `512x512` WebP + Opus | Sends Native WA Sound Sticker | Works Without Browser / WhatsApp Web | Baileys 7.x Zero-Touch | CLI & MCP / Agent Tool |
| :--- | :---: | :---: | :---: | :---: | :---: |
| [SilverFeit/StikSound](https://github.com/SilverFeit/StikSound) | ZIP / MP4 only | No | Desktop / Chrome | No | No |
| [Shirtep/WA-audio-stickers](https://github.com/Shirtep/WA-audio-stickers) | Yes (Browser) | Yes (via WA Web DOM) | No (Chrome extension) | No | No |
| **wa-sound-sticker** | **Yes (`ffmpeg` + `sharp`)** | **Yes (field `134` wire proto)** | **Yes (pure Node.js)** | **Yes** | **Yes** |

---

## How WhatsApp Sound Stickers Work on the Wire

WhatsApp sound stickers are **not** audio bytes stuffed inside a WebP. They are **two separate encrypted media attachments** linked inside one protobuf message:

1. **Sticker (`image/webp`, `<= 950 KB`):** Animated WebP (`512x512`) carrying a big-endian TIFF `EXIF` chunk under tag `0x5741` (`"WA"`) with JSON metadata including `"sound-sha256"` (base64 SHA-256 of the unencrypted Ogg/Opus file). Static images paired with audio are wrapped as a 1-frame animated WebP (`isAnimated: true`).
2. **Audio (`audio/ogg; codecs=opus`, `<= 950 KB`):** Mono `48 kHz` Ogg/Opus clip uploaded via the `audio` media path (`ptt: false`, cover-art streams stripped with `-vn -map 0:a:0`).
3. **Protobuf Envelope:**
   ```text
   Message {
     audioStickerMessage (134): FutureProofMessage {
       message (1): Message {
         stickerMessage (26): StickerMessage {
           ...fields 1..22...,
           premium (24) = 0,
           emojis (25) = "🔊",
           audioMessage (26): AudioMessage { mimetype = "audio/ogg; codecs=opus", ... }
         }
       }
     }
   }
   ```

Stock `@whiskeysockets/baileys` (`7.0.0-rc13` / `rc14`) stops at field `114` and drops `134` (see [Baileys#2932](https://github.com/WhiskeySockets/Baileys/issues/2932)). `wa-sound-sticker` hooks `proto.Message.encode` and `proto.Message.decode` cleanly in memory at runtime so:
- `messages-send.js` still sees `stickerMessage` and emits `<message type="media">` + `<enc mediatype="sticker">` + `deviceSentMessage`.
- Outbound wire bytes serialize as field `134 -> 1 -> 26 -> (24, 25, 26)`.
- Inbound sound stickers decode cleanly via `extractSoundStickerInfo()` / `downloadSoundSticker()`.
- **Zero files in `node_modules` are touched.**

---

## Requirements

- **Node.js >= 20**
- **`ffmpeg` & `ffprobe`** available on `PATH`

---

## Installation

```bash
npm install wa-sound-sticker
```

Or clone directly:

```bash
git clone https://github.com/alkhrzmy/wa-sound-sticker.git
cd wa-sound-sticker
npm install
npm test
```

---

## Quickstart: Baileys 7.x (Zero-Touch)

### Send a Sound Sticker

```js
import { sendSoundSticker } from 'wa-sound-sticker';

// Image + local audio
await sendSoundSticker(sock, '6281234567890@s.whatsapp.net', {
  filePath: './meme.png',
  audioPath: './vine-boom.mp3',
  packName: 'My Stickers',
  publisher: '@alkhrzmy',
  emojis: ['🔊'],
});

// Short MP4/MOV meme using its own audio track, center-cropped 1:1
await sendSoundSticker(sock, '6281234567890@s.whatsapp.net', {
  filePath: './meme-short.mp4',
  useVideoAudio: true,
  fit: 'cover',
  packName: 'My Stickers',
  publisher: '@alkhrzmy',
});

// GIF + MyInstants URL
await sendSoundSticker(sock, '6281234567890@s.whatsapp.net', {
  filePath: './cat.gif',
  audioUrl: 'https://www.myinstants.com/en/instant/vine-boom/',
});
```

### Receive & Download Inbound Sound Stickers

Call `installSoundStickerCodec(proto)` once before connecting your socket:

```js
import { proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { installSoundStickerCodec, extractSoundStickerInfo, downloadSoundSticker } from 'wa-sound-sticker';

installSoundStickerCodec(proto);

sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    const info = extractSoundStickerInfo(msg);
    if (info?.hasAudio) {
      const { stickerBuffer, audioBuffer, emojis, audioSeconds } = await downloadSoundSticker(msg, {
        downloadOptions: {},
      });
      console.log('Received sound sticker:', { emojis, audioSeconds, webp: stickerBuffer.length, ogg: audioBuffer?.length });
    }
  }
});
```

---

## CLI Usage

```bash
# 1. Convert locally to sticker.webp + sound.ogg
npx wa-sound-sticker convert \
  --image ./meme.mp4 \
  --video-audio \
  --fit cover \
  --pack "My Stickers" \
  --publisher "@handle" \
  --out ./out

# 2. Inspect EXIF + chunks of any sticker .webp
npx wa-sound-sticker inspect --file ./out/sticker.webp

# 3. Send through a running Hermes WhatsApp bridge
npx wa-sound-sticker bridge-send \
  --to "6281234567890@s.whatsapp.net" \
  --image ./meme.png \
  --audio ./sound.mp3
```

---

## AI Agent Integration (MCP & Hermes Agent)

`wa-sound-sticker` ships a zero-dependency JSON-RPC 2.0 **MCP stdio server** (`wa-sound-sticker-mcp`) exposing three tools:
- `create_sound_sticker`
- `send_sound_sticker_via_bridge`
- `inspect_webp_sticker`

### Hermes Agent / Claude Code / Cursor MCP Config

```json
{
  "mcpServers": {
    "wa-sound-sticker": {
      "command": "node",
      "args": ["/absolute/path/to/wa-sound-sticker/src/mcp.js"],
      "env": {
        "WA_STICKER_PACK_NAME": "My Stickers",
        "WA_STICKER_PUBLISHER": "@handle"
      }
    }
  }
}
```

See [`integrations/hermes/README.md`](integrations/hermes/README.md) and [`integrations/hermes/SKILL.md`](integrations/hermes/SKILL.md) for the Hermes Agent skill and `/send-sticker` bridge route setup.

---

## Caveats & Troubleshooting

- **Recipient client rollout:** Meta is rolling out `sound_stickers_consumption_enabled` gradually across Android/iOS/Web clients. Clients without the feature enabled may render a silent sticker or an empty message.
- **Audio mimetype matters:** Plain `audio/ogg` renders the sticker silently. `audio/ogg; codecs=opus` is required.
- **Cover art trap in MP3 -> OGG:** Converting MP3s that carry embedded album art without `-vn -map 0:a:0` embeds a video stream inside the `.ogg`, causing WhatsApp clients to silently fail playback. `wa-sound-sticker` strips non-audio streams automatically.
- **Size ceiling:** Keep both WebP and Ogg/Opus under `1,000,000` bytes (`950 KB` safety cap enforced automatically via quality/bitrate stepdown).

---

## Credits & References

- Wire structure & Baileys workaround findings from [WhiskeySockets/Baileys#2932](https://github.com/WhiskeySockets/Baileys/issues/2932)
- Sound-sticker EXIF (`0x5741` `"sound-sha256"`) and Opus packaging notes from [Shirtep/WA-audio-stickers](https://github.com/Shirtep/WA-audio-stickers) & [7ucg/whatsapp-docs](https://github.com/7ucg/whatsapp-docs/blob/main/WA_STICKERS.md)
- Inspired by [SilverFeit/StikSound](https://github.com/SilverFeit/StikSound)

---

## License

[MIT](LICENSE) © Gymnastiar Al K ([@alkhrzmy](https://github.com/alkhrzmy))
