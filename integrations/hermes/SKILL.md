---
name: whatsapp-sound-stickers
description: "Use when creating or sending native WhatsApp sound stickers (WebP + Opus) via MCP or bridge."
version: 1.0.0
platforms: [linux, macos]
---

# WhatsApp Sound Stickers (`wa-sound-sticker`)

Create and send native WhatsApp sound stickers (`audioStickerMessage`, protobuf field `134`) from PNG, JPG, WebP, GIF, or short MP4 clips paired with local audio or MyInstants HTTPS URLs.

## Tools (via MCP server `wa-sound-sticker-mcp`)

1. `create_sound_sticker` — converts image/GIF/video + audio into a `512x512` WebP (with `0x5741` EXIF + `sound-sha256`) and mono `48kHz` Ogg/Opus (`<= 950 KB`).
2. `send_sound_sticker_via_bridge` — sends the sticker or sound sticker directly through the running Hermes WhatsApp bridge (`POST /send-sticker`).
3. `inspect_webp_sticker` — checks WebP dimensions, animation chunks, and WhatsApp EXIF metadata.

## CLI fallback

```bash
wa-sound-sticker bridge-send \
  --to "<chat_jid>" \
  --image /path/to/meme.mp4 \
  --video-audio \
  --fit cover \
  --pack "My Pack" \
  --publisher "@handle"
```

## Notes

- WhatsApp sound stickers require recipient clients that have rolled out `sound_stickers_consumption_enabled` (Android/iOS/Web late-2026 builds).
- Always keep audio strictly under 950 KB (`audio/ogg; codecs=opus`, mono 48kHz, `-vn -map 0:a:0` to strip cover-art streams).
- Static images paired with audio are wrapped as 1-frame animated WebP (`isAnimated: true`) for reliable playback on mobile clients.
