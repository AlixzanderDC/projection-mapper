---
name: premiere-projection-content
description: Build projection-mapping video content in Adobe Premiere Pro (and After Effects via Dynamic Link) from the mapper's Content template exports (Shape PNG, Guide SVG, per-surface mattes) as pixel-exact full-frame video at the projector's native resolution, or a 2:1 equirectangular strip for a sphere. Covers sequence presets (frame size, 30 fps, square pixels, Direct 709 SDR), importing PNG/SVG/.ai, guide layers, Track Matte Key (Matte Luma) and nesting, Corner Pin/Offset/Lumetri/blend modes, seamless loops, H.264 High 4.1 export for USB projector players (FAT32/2 GB limits, bitrate, VBR 2-pass, Media Encoder presets), After Effects particles, Fractal Noise, displacement, shapes from vectors, CC Sphere, VR Converter, design rules for dark/textured/coloured walls (black = off, saturation, line and type sizes), checklist, troubleshooting. Use for any Premiere, After Effects or Media Encoder question about mapped content, track mattes, projector exports, USB playback, loops, the Arkham wall or the inflatable moon.
---

# Premiere / After Effects content for the projection mapper

Pixel-exact video for one projector, built on the mapper's own exports, played 1:1 (a **Full frame** surface, `tools/bake.js`, or the projector's USB player). Every software claim below was checked against Adobe Help pages dated 2025–2026 unless tagged **[unverified]**; rules of thumb are **[derived]**. Details and source URLs: `references/`.

## 0. Know the inputs (from `js/export.js` and `README.md`)

- **Shape PNG** — white where the projector lights, black elsewhere, at the projector's pixels; feather/blend off, upright frame. **Alpha is 255 everywhere** → it is a *luma* matte.
- **Guide SVG** — same pixel size; cyan outlines, white 50 % warp-grid lines, dashed pink mask polygons, orange control points labelled `row,col`, surface names, footer "make content at this size and show it with a Full frame surface".
- **Matte per surface zip** — one white-on-black PNG per visible surface, `<prefix>_<surface>.png`.
- **Ball/moon** — a **2:1 equirectangular strip** (2048 × 1024 is enough for a 60-inch ball from 1080p); the strip's middle faces projector 1, the top row is the north pole, left/right edges meet behind.
- Ben's show: 1280 × 768 and 1920 × 1080 projectors, 30 fps, USB sticks in the projectors' players (H.264 High, Level 4.1), FAT32, red brick under coloured ambient light.

Decide first: **live from the mapper** (flat content, the mapper warps) or **played 1:1** (content already in projector space). Never pre-warp *and* let the mapper warp.

## 1. Sequence per projector (Premiere)

1. `File > New > Sequence` → **Settings** tab: Editing Mode **Custom**; Timebase **30**; Frame Size **1280 × 768** or **1920 × 1080** (max 10,240 × 8,192); Pixel Aspect Ratio **Square Pixels (1.0)**; Fields **No Fields (Progressive Scan)**. **Save Preset**, one per projector. Aspect ratios cannot be changed after creation **[unverified wording]**, so get this right first.
2. **Color** tab (also `Sequence > Sequence Settings`): *Color setup* **Direct 709 (SDR)** (the default; Adobe's page also calls it "Broadcast 709 (SDR)"), Output Color Space Rec.709. Never a Wide Gamut preset (it can darken SDR). *Auto Tone Map Media* only touches HDR/log sources; leave it.
3. `Lumetri Color > Settings > Project > Viewer Gamma` → **2.2** so the monitor is closer to the player [derived]; it does not change the export.
4. Still-image default duration (Preferences) long enough for the mattes, or stretch the PNG clips.
5. Moon strip: a separate **2048 × 1024** sequence (or AE comp), same rules.

## 2. Import the exports

- **PNG** (Shape, per-surface mattes): import, place at **Scale 100, centred**, no keyframes, no *Set To Frame Size* (sizes already match). Luma matte, not alpha.
- **SVG: Premiere Pro cannot import SVG** (supported still formats as of Sep 2026: AI/EPS, BMP, DPX, GIF, ICO, JPEG, PNG, PSD, PRTL, TGA, TIFF). Rasterise the guide to a transparent PNG at exactly W × H (the SVG's viewBox is already W × H px) with ImageMagick/Inkscape/Photoshop **[CLI flags unverified]**, or open in Illustrator → artboard W × H → `.ai` (Premiere rasterises .ai on import, empty areas become alpha; crop marks set the raster size).
- **Guide layer**: Premiere has none. Put the guide PNG on the **top video track**, Opacity ~50 %, Blend Mode **Screen**, name the track `GUIDE`, and before export hide it with the track **Eye icon** or delete the clip — then **check the exported file**. After Effects has real guide layers (`Layer > Guide Layer`, not rendered by default).

## 3. One matte per surface (Premiere)

- Current tool (verified in the Jan 2026 effects reference): **`Video Effects > Keying > Track Matte Key`**. White in the matte = opaque content, black = transparent, grey = partial. The 2025 masking tools (Object Mask Tool, Ellipse/Rectangle/Pen Mask, HSL/Luminance masks) are masks on effects, not a replacement.
- Layout per surface: content on a lower track, its matte PNG on the track above, Track Matte Key on the **content** clip; *Matte* = the matte's track (e.g. "Video 3"); *Composite Using* = **Matte Luma** (mapper PNGs are opaque). *Reverse* inverts **[option name unverified]**.
- **Nest the content first** and animate inside the nest; Motion on the clip carrying Track Matte Key also moves/scales the matte (Adobe documents Motion on the matte; community reports the same for scaling the keyed clip). Keep matte clips untouched.
- Soft edges: nest the matte and add a Gaussian Blur (10–60 px) to the matte nest, or draw an Opacity mask on the content and use *Feather* (mask properties: Feather, Expansion, Opacity, Invert).
- Global look: an **adjustment layer** (Project panel *New Item* or `File > New > Adjustment Layer`) above the surfaces, below `GUIDE`, carrying Lumetri.
- Several surfaces sharing a look can use the Shape PNG; distinct looks use the zip's per-surface PNGs.

## 4. Place, warp, grade

- Transforms: Motion (Position/Scale/Rotation/Anchor) on the nested content; Premiere-made graphics use **Vector Motion** (no rasterising). Text: Type tool + **Properties panel** (Essential Graphics is gone since 25.0).
- `Video Effects > Distort`: **Corner Pin** (pin a flat texture to the four corners read from the guide's `row,col` points, for 1:1 playback only), **Offset** (seamless scrolling textures: pixels pushed off one side reappear on the other), **Turbulent Displace**, **Spherize**, **Mirror**, **Magnify**, **Lens Distortion**.
- Cutouts: **Ultra Key** (green/blue), **Color Key**, **Luma Key** — but black already projects as nothing, so stock fire/smoke on black usually just needs Blend Mode **Screen** or **Linear Dodge (Add)**. **Multiply/Darken never work on a projector** (light only adds).
- Colour: Lumetri Basic *Saturation*, Creative **Vibrance** (protects already-saturated colours) and *Saturation* (0–200). Check `Window > Lumetri Scopes` Waveform (8-bit): blacks at 0, key content above ~64, highlights at 235–255.
- Keep key content ≥ 3 % of the frame inside every mapped edge and outside the dashed mask polygons.

## 5. Loops

- Design so frame N = frame 0: whole cycles per loop length, Offset by exactly one tile, AE **Fractal Noise → Cycle Evolution** (set the Out point one frame before the cycle end).
- Rescue a non-looping clip: split in the middle, swap halves, overlap ≥ 3 s, **Cross Dissolve** over the overlap, check with the Program Monitor **Loop** button.
- Players restart with a gap (ViewSonic documents "a short, single second black frame"; the mapper's `bake.js --loops` exists for this). Lay the nested loop back-to-back until the file is as long as the size cap allows, start and end on a dark frame, one file per folder.

## 6. Export for the projector player

`File > Export > Media` (Ctrl+M), Format **H.264**, then set — do not trust Match Source for these:

| Setting | Value |
|---|---|
| Frame Size / Frame Rate | = sequence (1280×768 or 1920×1080), **30**; no letterbox, no scaling |
| Field Order / Aspect | Progressive / Square Pixels (1.0) |
| Performance | **Software Only** (hardware is limited to CBR / 1-pass VBR) |
| Profile / Level | **High / 4.1** (1080p30 is the top of 4.1; 1280×768 is far inside) |
| Bitrate Encoding | **VBR, 2 pass**; Target **8–10 Mbps** (1280×768) / **10–14 Mbps** (1080p); Maximum ≤ 16–20 Mbps. If the player stutters: **CBR** at the target [derived] |
| Key Frame Distance | off (auto) or 30 |
| Render at Maximum Depth | on |
| Use Maximum Render Quality | **off** (same size as sequence; GPU renderers use it anyway) |
| Time Interpolation | irrelevant at matching fps — never export at a different frame rate |
| Export Color Space | Rec. 709 (default) |
| Video Is VR | off, even for the moon strip |
| Audio | none, or **AAC stereo 48 kHz** (Epson: AAC-LC/LPCM, ≤ 2 ch) |

Save it as a preset per projector and use **Send to Media Encoder** for batches (the queue otherwise falls back to *Match Source – Adaptive High Bitrate* or the last-used settings). Keep a ProRes mezzanine for re-encodes [derived].

Player limits: Epson PC Free — FAT16/32, **≤ 2 GB**, ≤ 1920 × 1200, YUV420, Baseline/Main/High, ≤ 30 fps, "single slice structure" (if an Epson rejects a hardware-encoded file, re-export Software Only [derived]); FAT32 itself caps files at **4 GiB** (Microsoft); BenQ accepts NTFS/FAT/FAT32 ≤ 128 GB; Optoma FAT/FAT32 only, LG ≤ Level 4.1 **[search snippets, unverified]**. Read the manual for the actual model. Hap/DXV are plugin-only (disguise Hap exporter tested on CC 2019/2020; Resolume DXV plugins) and no projector plays them — H.264 is the right answer here.

## 7. After Effects for the hard parts (Dynamic Link)

- Same **major version** as Premiere. `File > Adobe Dynamic Link > New After Effects Composition` (inherits size/PAR/fps, 30 s default duration) or right-click clips → **Replace With After Effects Composition**. AE project `File > Project Settings > Color` working space **Rec. 709** to match a Direct 709 sequence (Premiere warns on mismatch). Heavy comps: `Clip > Render and Replace`.
- Comp from the Shape PNG: drag it onto *Create a new composition* / `File > New Comp From Selection` → exact projector size.
- Track mattes: *Modes* column → **Track Matte** dropdown, any layer, **Luma** toggle for the mapper's PNGs, *Inverted* toggle; the matte layer's visibility turns off automatically.
- Vectors: **SVG import is a beta feature** (Nov 2025 page: native shape layers; `<text>` is dropped, so point numbers vanish; 1-frame duration). Release route: Illustrator `.ai` as footage → `Layer > Create > Create Shapes from Vector Layer` (one layer at a time; gradients may come in as 50 % grey).
- Organic growth: **Fractal Noise** (Noise & Grain) thresholded with Levels/Curves as an animated luma matte for frost, mould, cracks; **Displacement Map** (128 = no displacement; precompose the control layer); **Turbulent Displace**; **Shatter** with a Gradient Layer ("white areas shatter first"); **CC Particle World / CC Particle Systems II** (fire, smoke, dust), **CC Rainfall/Snowfall**. Keep comp background black — black is off.
- Sphere: author directly in a **2048 × 1024** comp (text within ±35° of the equator, edges tiling, nothing at the poles). **CC Sphere** (Perspective) wraps a layer onto a sphere for previews. **VR Converter** (`Effect > Immersive Video`; needs *Mercury GPU Acceleration*) converts *2D Source* / cube-map / fisheye → **Equirectangular 2:1** and re-orients with Pan/Tilt/Roll; the other Immersive Video effects (VR Blur, VR Glow, VR Fractal Noise…) are seam-aware.
- Guide: `Layer > Guide Layer` — shown while working, not rendered (Render Settings → Guide Layers → *All Off*).
- Output: Dynamic Link back to Premiere, or `File > Export > Add to Render Queue` → Output Module Format **H.264** (embedded Media Encoder) with the §6 settings.

## 8. Design rules for brick, dark walls and coloured ambient [derived]

- **Black = off.** Code 0 for anything invisible; nothing you want seen below ~25 % luminance; readable content ≥ 50 %. Dark greys (10–30 %) read as "projector on, nothing happening".
- **Saturated and bright.** Pure hues (two channels high, one low); push Vibrance then Saturation; pastels die on a coloured wall. Pick the accent hue against the ambient colour (red ambient → cyan/green/white); red-on-red-brick is bright but low-contrast.
- **Lines ≥ 3 px** at projector resolution on anything warped (≥ 4 px on coarse brick); never 1–2 px.
- **Type:** cap height in px ≥ `(viewing distance ft ÷ 10) × (px per inch on the surface)` (sign-industry 1 in per 10 ft, vendor rule); e.g. 1920 px over 12 ft at 40 ft → ≥ 53 px cap height (~75 px font); bold sans, white or a pure hue, letter-spaced.
- **Edges:** key content ≥ 3 % of frame inside every mapped edge; large wall areas get 20–60 px feather or a ragged/noise edge so they don't read as rectangles; the door/frame stay hard-edged on purpose.
- **Motion ≤ ¼ frame width per second** for things the eye should follow; strobes ≥ 4 frames per state; loops a whole number of seconds.
- **Test on the wall** with the show lighting on, from the audience position, after warm-up. Adjust from the wall, not the laptop.

## 9. Quick troubleshooting

| Symptom | Fix |
|---|---|
| Off by a few pixels | something scaled: PNG not at 100 %, *Set To Frame Size*, export size ≠ sequence, player zoom/overscan, non-native projector res |
| Grey instead of black | file black > 0 (Waveform), player/projector HDMI range, Wide Gamut colour setup |
| Stutter | bitrate peaks / CBR, profile or level above the player, 60 fps, hardware-encoder slices → Software Only, High 4.1, 30 fps |
| Wrong aspect / letterbox | PAR not square or Frame Size from Match Source → custom preset, explicit size |
| Flash at loop restart | player gap → longer file, dark first/last frame, one file per folder |
| Guide lines in the output | GUIDE track enabled / AE guide layers rendered |
| SVG won't import | Premiere has no SVG importer → PNG or .ai |

Full checklist and table: `references/checklist.md`.

## References in this skill

- `references/premiere-workflow.md` — sequence, colour, import (PNG/SVG/.ai), guide-layer pattern, Track Matte Key, nesting, Distort/Lumetri/blend modes, loops, Dynamic Link; source URLs and dates per claim.
- `references/after-effects.md` — comp and colour setup, guide layers, SVG/.ai → shapes, track mattes, Fractal Noise/Displacement/Shatter/particles, CC Sphere, VR Converter and the 2:1 strip, H.264 from AE.
- `references/export-and-playback.md` — Level 4.1 maths, every export option, Hap/DXV, vendor player limits (Epson, BenQ, Optoma, LG, ViewSonic), FAT32, loop gaps, range problems.
- `references/design-rules.md` — the numbers for projected content on dark/textured/coloured surfaces and notes for the Arkham wall and the moon.
- `references/checklist.md` — pre-flight checklist and the full troubleshooting table.
