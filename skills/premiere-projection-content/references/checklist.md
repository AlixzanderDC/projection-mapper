# Checklist and troubleshooting — Premiere/AE content for the mapper

Compiled 2026-10-29. Items marked [derived] are our rules; documented behaviour is cited in the other references.

## A. Before you start
- [ ] Projector window opened at its real size in the mapper, surfaces mapped, then **Content template** exported: Shape PNG, Guide SVG, Matte-per-surface zip (`README.md`, "Content template")
- [ ] Pixel size on the object and pixels-per-inch noted from the Setup template readout; viewing distance measured from the audience position
- [ ] Ambient light colour and level at show time written down (lux + colour)
- [ ] Projector model's USB-player manual read: file-system (FAT32 / exFAT), max file size (Epson: 2 GB), max resolution, profiles/levels, audio codecs, frame-rate cap, loop/playlist behaviour (`export-and-playback.md` §4)
- [ ] Premiere and After Effects on the **same major version** (Dynamic Link requirement)

## B. Sequence
- [ ] `File > New > Sequence` → Settings: Editing Mode **Custom**, Timebase **30**, Frame Size = projector native, Pixel Aspect Ratio **Square Pixels (1.0)**, Fields **No Fields (Progressive Scan)** → **Save Preset** per projector
- [ ] Color tab: *Color setup* **Direct 709 (SDR)** (default), Output Color Space Rec.709; no Wide Gamut preset
- [ ] `Lumetri Color > Settings > Project > Viewer Gamma` = 2.2 [derived]
- [ ] Track layout (bottom→top): V1 background/black, per surface: content nest + matte PNG above it, adjustment layer (global grade), top track `GUIDE` (rasterised Guide PNG, Screen, 50 %)
- [ ] Shape/matte PNGs at Scale 100, Position centre, no *Set To Frame Size*, no keyframes

## C. Mattes and placement
- [ ] Track Matte Key on the **content** clip; *Matte* = the track holding the PNG; *Composite Using* **Matte Luma** (mapper PNGs have no alpha)
- [ ] Content animated **inside** a nested sequence, not on the clip carrying Track Matte Key
- [ ] Soft edges where wanted: Gaussian Blur on a nested matte, or Opacity-mask Feather; hard edges on the door/frame
- [ ] Corner Pin / Offset / Turbulent Displace used only when the file is played 1:1 (Full frame / USB); flat content when the mapper warps live. Never both
- [ ] Moon strip comp 2048 × 1024, 2:1, edges tile, key content ±35° of the equator, nothing at the poles

## D. Look
- [ ] Blacks at code 0; nothing meant to be seen below ~25 % luminance; key content ≥ 50 %; Waveform checked
- [ ] Saturated, pure hues; Vibrance/Saturation pushed; contrast hue chosen against the ambient colour
- [ ] Lines ≥ 3 px, type cap height ≥ (distance ft ÷ 10) × px/in, bold sans, white or pure hue
- [ ] Key content ≥ 3 % of frame inside every mapped edge and outside mask polygons
- [ ] Large wall areas have softened/ragged edges; loops complete whole cycles; strobes ≥ 4 frames per state

## E. Export
- [ ] GUIDE track hidden (Eye icon) or clip deleted — confirm on the exported file
- [ ] `File > Export > Media`: Format **H.264**; Match Source boxes for Profile/Level **off**; Frame Size = sequence; Frame Rate 30; Field Order Progressive; Aspect Square Pixels
- [ ] Performance **Software Only**; Profile **High**; Level **4.1**; Bitrate Encoding **VBR, 2 pass**; Target 8–10 Mbps (1280×768) / 10–14 Mbps (1080p); Maximum ≤ 16–20 Mbps
- [ ] Key Frame Distance off (or 30); Render at Maximum Depth **on**; Use Maximum Render Quality **off** (same size); Time Interpolation irrelevant (same fps)
- [ ] Audio: none, or AAC stereo 48 kHz
- [ ] Preset saved per projector; sent to Media Encoder queue with that preset (not the default Adaptive preset)
- [ ] File length planned for the player's size cap (≤ 2 GB on Epson PC Free; ≤ 4 GiB on FAT32); loop copies laid back-to-back before export
- [ ] Mezzanine (ProRes/preview codec) kept for re-encodes

## F. On the player
- [ ] Stick formatted FAT32 (or what the manual says); one file per folder; names prefixed `01-`, `02-` for order
- [ ] Projector: native resolution, overscan/zoom off, same picture mode as during alignment, HDMI/colour range so that black is black (`README.md`)
- [ ] Played the file end-to-end and across at least one restart: restart gap acceptable, no stutter, no grey black, no scaling, no letterbox
- [ ] Looked at the wall from the audience: legibility, saturation, dark-grey check; adjusted and re-exported if needed

---

## G. Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Content misaligned by a few pixels / drifts off the mapped shape | something scaled: PNG not at Scale 100, *Set To Frame Size* applied, export Frame Size ≠ sequence, player zoom/overscan on, projector not at native res → fix the scale, re-export, check player settings |
| Content lands in the right place in Premiere but wrong on the wall | content was pre-warped **and** the mapper warps it (or the reverse) → flat content for live mapping, projector-space content for Full frame/USB only |
| Edges of the matte show a thin bright/dark line | matte anti-aliasing + Track Matte Key on a scaled clip → nest first; or the Shape PNG was resampled → keep PNG at 100 % |
| Grey rectangle where black should be | file black > 0 (check Waveform), or HDMI/colour range mismatch on the player/projector, or Wide Gamut colour setup darkened/lifted SDR → fix levels, set range on the player, use Direct 709 |
| Whole picture washed out on a laptop but fine on the projector | viewer gamma difference (macOS 1.96 vs 2.4) → ignore the laptop; judge on the projector |
| Stutter / dropped frames on the projector player | bitrate or VBR peaks too high, profile/level above the player's spec, 60 fps file, hardware-encoder quirk (multi-slice) → VBR max ≤ 16–20 Mbps or CBR, High 4.1, 30 fps, Software Only export |
| Player refuses the file | wrong container/codec/level, > 2 GB (Epson) or > 4 GiB (FAT32), resolution above the player cap (2048-wide strip), 10-bit, exotic audio → re-export High 4.1 8-bit, AAC/LPCM or no audio, smaller file |
| Wrong aspect / stretched picture | sequence or export Pixel Aspect Ratio not Square, or Frame Size from a Match Source of a 4K/anamorphic source → custom preset, explicit Frame Size and Aspect |
| Black bars (letterbox/pillarbox) | export Frame Size ≠ sequence, or player scaling to its panel → export at native, player zoom off |
| Flash of black / pause at loop restart | normal player restart gap → longer file (back-to-back copies), start/end on a dark frame, one file per folder |
| Loop seam visible in the content | design does not return to frame 0; dissolve too short → whole-cycle animation, Cycle Evolution for noise, ≥ 3 s cross-dissolve swap |
| Guide lines rendered into the output | GUIDE track still enabled → hide with the Eye icon / delete; in AE check *Render Settings > Guide Layers = All Off* |
| SVG will not import into Premiere | Premiere has no SVG importer → rasterise to PNG at W×H or go through Illustrator (.ai) |
| Guide SVG imports into AE without point numbers | SVG text is not imported → convert text to curves or use the PNG guide |
| AE immersive/VR effect shows a warning banner and no result | Mercury Software Only → `Project Settings > Video Rendering and Effects > Mercury GPU Acceleration` |
| Dynamic Link comp offline / empty | version mismatch between Premiere and AE, or the .aep moved → same major versions, keep project paths |
| Text unreadable on the brick | too small or too thin for the px/in and distance, mid-grey or pastel fill, placed across mortar/texture → bigger, bolder, white/pure hue, re-position |
| Thin lines vanish on the ball | < 3 px before warp → thicken; keep detail away from the limb |
