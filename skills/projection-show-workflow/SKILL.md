---
name: projection-show-workflow
description: The professional workflow for planning, rigging, aligning and running single- and multi-projector shows — site survey and lumens-per-lux math, throw ratio, lens shift and placement to avoid shadows and keystone, signal and outputs (EDID emulators, MST hubs, DisplayLink limits, Mosaic/Eyefinity, frame sync, 4K bandwidth), the on-site order of operations (warm-up, test patterns, align, warp, blend-after-warp, black level, colour match, save), content production for mapped surfaces (UV templates and stencils, equirectangular strips for spheres, Hap/DXV/NotchLC vs H.264, frame rates, loop seams), mapping spheres, globes and inflatables with 2–4 projectors (NOAA Science On a Sphere alignment procedure), and a troubleshooting table. Use for projection-mapping event planning, projector selection, a mapping-day checklist, content specs for a mapped object, or diagnosing seams, swapped outputs, judder and soft overlaps.
---

# Projection show workflow

What professionals do before, during and after a mapping job, distilled from manufacturer guides (Epson, Panasonic, Christie, Barco), media-server docs (WATCHOUT, Resolume, MadMapper, QLab, Millumin, disguise, TouchDesigner, Splash) and NOAA's Science On a Sphere manual. Math lives in `projection-mapping-geometry`; blend theory in `multi-projector-blending`. Full survey with URLs: `references/research-tools.md`.

## 1. Survey and choose projectors

- **Measure**: surface size and shape, candidate projector positions (distance, height, offset), ambient light in lux *at the surface*, power and signal runs, audience sight-lines (where shadows would fall).
- **Throw ratio** `TR = distance ÷ image width` (not diagonal). `D = TR × W`. Short-throw (0.5–0.8:1) lenses rarely have lens shift, so placement is unforgiving; zoom lenses give a TR range. Use the manufacturer's calculator for the exact model.
- **Brightness**: lux on surface ≈ lumens ÷ area (m²); aim for **≥ 5× the measured ambient lux**. Dark or textured surfaces (brick, black wood) need 2–3× the lumens of a white one. Prefer ANSI lumens with colour lumens ≈ white lumens; **native contrast (≥ 10,000:1) matters more than lumens** for black floors, invisible blends and hiding the projector rectangle. Avoid single-chip DLP if the audience will see fast motion (rainbow); laser/LED for stable colour.
- **Pixel size on the object** = `width ÷ horizontal pixels`; 1080p over 3 m = 1.6 mm, 4K = 0.8 mm. Choose resolution by viewing distance: ~60 pixels per degree is retinal; `ppd ≈ 180·N_x / (π · 2·atan(W/2D_view))`.
- **Lens shift** avoids keystone. **Never use the projector's digital keystone** when software maps: it resamples before your warp (CamSchnappr and SOS both require it reset).

## 2. Placement and mounting

- Symmetric rigs (same height, distance, tilt) give blend zones with matching pixel density and brightness. For spheres: lens at equator height, equal distances, equal angular spacing.
- Shadows: project from above or behind the audience line; for objects, choose angles so overlaps fall where incidence angles are similar.
- Rigid mounts; drift weeks later is usually a bumped mount or lamp warm-up. **Write every physical measurement into the show file** (lens height, distance to centre, resolution, lens offset).

## 3. Signal and outputs

- **EDID is the number-one failure mode.** When a projector is off or an extender strips its EDID, Windows/macOS re-enumerate and warps land on the wrong projector. Fixes by reliability: power-on sequencing and never unplugging live (~90 %); **inline EDID emulators per output** cloned from the real projector (~99 %; must support the exact mode); uniquely named custom EDIDs; pro GPUs that manage EDIDs in the driver. Set EDIDs *before* making calibration files.
- **One logical display per GPU** (NVIDIA Mosaic / AMD Eyefinity): one clock, one fullscreen window spanning all projectors (Splash: one window per GPU). Separate OS displays are not synchronized and apps cannot span them reliably.
- **Frame sync tiers**: VSync off (tearing) → Mosaic/Eyefinity (one clock per GPU) → framelock (Quadro Sync) → genlock (house reference) → genlock + swap barriers. Software "Ethernet" sync still tears through the desktop compositor. Give every projector identical mode and refresh; drive animation from a shared clock, not frame counts.
- **Bandwidth**: 4K60 8-bit ≈ 14–18 Gbit/s. DP 1.2 MST hub → two 4K30; DP 1.4 without DSC → one 4K60 + one 4K30; DP 1.4 + DSC → two 4K60; HDMI 2.0 = one 4K60 4:4:4. Three 1080p60 from one DP 1.2 MST hub is fine.
- **DisplayLink / USB graphics**: CPU-compressed, 100s of ms latency, dropped frames — GUI monitors only, never a projector output. **Datapath Fx4 / Matrox TripleHead2Go** split one big output so the OS sees one display; still the laptop-friendly answer.
- Keep the OS in **SDR** (Windows HDR tone-maps SDR content and shifts gamma). Borderless fullscreen per display is the right mode; do not fight for exclusive fullscreen.

## 4. On-site order of operations

1. Rig, power, cable; label outputs; EDIDs/emulators; Mosaic or desktop layout; confirm each projector shows **its own labelled test pattern**.
2. **Warm up 15–20 min** before any alignment (images drift while warming).
3. Projector menus: native resolution, identical picture/colour mode on all units (Epson: Multi-Projection), keystone off, lens shift centred, **zoom then focus at the centre of the surface** (SOS: focus at the equator); disable frame interpolation, overscan, dynamic contrast/iris/eco.
4. Rough physical aim with a full-frame pattern, one projector at a time, covering its zone with minimal overshoot.
5. Geometry: corner-pin or calibrate each projector to the surface or model; **align grids across seams** — translate first, then scale, rotate only with a level; "meet in the middle"; toggle projectors to see which is wrong. Mesh/Bézier warp last and locally.
6. **Blend after warp**: set overlap widths to the real pixel overlap, enable blend, tune gamma/power/luminance on 25/50/75/100 % white and a grey ramp; then black-level compensation on black.
7. Brightness/colour match: dim the brightest unit, set white point per output, or camera-based (Splash colorCalibrator, Panasonic ET-CUK10, Christie Mystique).
8. **Save the show file at every step**; export per-projector masks/warps as images where possible.
9. Rehearse cues with real content — motion and high contrast reveal errors static images hide.

## 5. Content production

- **Template / stencil**: unwrap the surface to a normalized UV layout and render it as a 2-D image at ≥ projector pixel density (disguise example: 1080 px over 5 m = 216 px/m → 3698×1080). Artists paint on that; the mapper samples it; projector moves never require re-rendering. For a sphere author in **equirectangular 2:1** (or cubemap/fisheye) and let the UV-sphere do the projection; keep text within ±35° latitude to limit stretch; the poles are rarely visible from projectors at object height.
- **Resolution**: at least native per output; the strip for a 60-inch ball from 1080p projectors reads well at 2048×1024. Wide canvases (5760×1080) exceed H.264 level limits in many players.
- **Codecs**: media servers scrub, loop, speed-change and layer, so they use **intra-frame, GPU-decoded** codecs: Hap / Hap Q / Hap Alpha (open, BSD; FFmpeg `-c:v hap -format hap_q -chunks 8`), Resolume DXV3, NotchLC, with ProRes/MJPEG as CPU intra-frame fallbacks (Splash recommends MJPEG). H.264/HEVC are long-GOP: fine for linear forward playback at normal speed, poor for seeking; if you must use them, encode short GOPs (`-g 30`) so seeks are cheap. DXV/Hap files are ~6× the size of H.264.
- **Frame rate**: equal to or an integer divisor of the output refresh (60 Hz → 30 or 60). Never re-encode 30→60; 24p on 60 Hz judders (3:2).
- **Loops**: make every moving element complete whole cycles over the loop length and tile exactly across any wrap seam; check the seam in the player at 2× and 0.5× speed. Keep audio as a separate cue or let the player clock to it.
- **Black is not off**: content black still emits the projector's black level; mask what must stay dark.

## 6. Spheres, globes and inflatables

- Coverage: one projector lights roughly the front half with heavy stretch toward the limb; **four at 90°** give full equatorial coverage with poles unlit (Bourke iSphere, NOAA SOS: 4 units ~17 ft from a 6 ft sphere, lenses at equator height); **three at 120°** is a documented compromise — complete equatorial coverage, partial pole coverage (raising the projectors with lens shift improves the top at the expense of the bottom).
- Two mapping schools: (a) **3-D model + virtual camera per projector** (Splash, TouchDesigner, MadMapper 3-D calibration, WATCHOUT 3-D) with equirectangular/cubemap content on a UV sphere and blending from the model's overlap; (b) **2-D quads with circular/gradient masks** per projector (MadMapper's workaround: it does not blend 3-D surfaces) — good enough for abstract visuals, not for text crossing seams.
- **SOS alignment procedure** (best-documented): warm up; record ground-to-equator height, lens-centre heights and lens-to-centre distances; keystone off, native res, same lamp mode; "Red Ball" — one projector at a time, cover your quadrant, no overshoot onto walls; "Grid" — white-on-red grid, laser level on the equator, translate → scale → rotate only for level, fix adjacent seams first, move each line halfway; "Vertex tweaking" only once nearly seamless (order: sides, then corners, then top/bottom), otherwise it tears. Lines diverging top vs bottom → re-measure heights ±1 inch. Budget 1–2 h the first time.
- **Inflatables** are not true spheres and move with blower pressure: keep the blower constant during calibration, use a local Bézier/grid warp as the last step (Splash recommends it for inflatable domes), expect to re-touch after the object settles, and give alignment a soft margin (feather the limb).
- Brightness falls off toward the limb (`cos θ / d²`); either accept it, compensate per pixel, or let incidence-weighted blending hand over to the neighbour before the limb.

## 7. Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Projectors swapped after reboot / warp on wrong unit | EDID re-enumeration → emulators, power sequencing, Mosaic |
| Visible band in the blend on grey | gamma wrong side or value → tune on 50 % grey; overlap width ≠ real overlap → re-measure |
| Grey band on black | black levels add in overlap → black-level lift on single-coverage areas; higher-contrast units |
| Grid lines cross at top but meet at bottom | projector height/distance mis-measured → re-measure ±1 inch, redo coarse steps; don't vertex-tweak |
| Soft image in overlap only | focus set at the edge → focus at surface centre; digital keystone on → off |
| Judder | content fps not dividing refresh (24 on 60), VSync/DWM → match fps, one clock per GPU |
| Stutter at high resolution | long-GOP codec, slow disk, several decodes of one big file → Hap/DXV, SSD, per-projector encodes |
| Seams on planar faces of a 3-D model | skewed UVs from triangulated quads → subdivide the mesh |
| Tearing between projectors | outputs on different clocks → Mosaic/Eyefinity, framelock |
| Washed-out colours | OS HDR on → off; "dynamic contrast/eco" modes → off |
| Image moved weeks later | bumped mount, lamp ageing → rigid mounts, re-align after warm-up |
| Text unreadable across a sphere seam | 2-D mask approach → switch to shared 3-D/equirectangular mapping |

## References in this skill

- `references/research-tools.md` — full survey: open-source and commercial mappers (architecture, files to read, licences), MPCDI, pro workflow sources, codecs, sphere/inflatable projects, browser mappers.
- `references/site-checklist.md` — printable pre-show and show-day checklist.
