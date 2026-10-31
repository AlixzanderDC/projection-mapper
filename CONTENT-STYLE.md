# Arkham Asylum video content: style guide and hand-off

Condensed from the Halloween 2026 projection work in `C:\Users\benja\projection-mapper` so a fresh session can
make **more videos in the same world for an ordinary TV screen** (16:9, no mapping, no mattes).
Everything here was built and shown; paths are real. Written 2026-10-31.

---

## 1. The world in one paragraph

Arkham Asylum as a working institution that is quietly falling apart: a security feed, not a haunted house.
Everything reads as *signage and systems* (status boards, inmate alerts, hazard tape, scanlines, monospace
readouts) that get interrupted by failures (containment breach, lockdown, power loss, toxin leak, escapes).
Tone is deadpan institutional, with the venue's own places written into the alerts ("last seen: THE CANDY TABLE").
The Batman universe is referenced by silhouette and name, never by licensed art: bat signal, bats, villain names,
mugshots supplied by Ben (in `media/alerts/Arkham_Alerts/media/`).

## 2. Palette

| Role | Hex | Use |
|---|---|---|
| Breach red | `#ff3b3b` (alerts use `#ff2b2b`) | containment failure, lockdown, ESCAPE alerts, blinking words |
| Warning amber | `#ffb000` | hazard stripes, tickers, SPOTTED alerts, power failure, "DO NOT OPEN" |
| Cryo cyan | `#8fd3ff` | door readout text, nominal state, frost rims |
| Frost white | `#eaf8ff` / `rgba(190,225,255,…)` | frost texture, big "CRYO WING LOST" title |
| Nominal green | `#5fe0a0` | OK / NOMINAL values |
| Toxin green | `#7dff5a`, text `#d8ffc8`, panel `#b8ff9a` | fear-toxin scene |
| Bone | `#efe6d2` | blackletter titles, alert body text |
| Steel panel | gradient `#2a3d52` → `#1c2c3d` → `#223548` | the lit door panel |
| Dim reds/ambers | `#5a0606`, `#4a3400`, `#9a7a00`, `#8a1010` | backing fields, hazard tape dark stripe |
| Moon face | `#fbf8ee` → `#e4e0d2` → `#b9b5a7` → `#6e6b62` | radial gradient, maria and craters darker |

Rules that still apply on a TV: one accent hue per state (red = breach, amber = caution, green = toxin, cyan = calm),
pure saturated hues against black, and a final vivid pass (`saturate(1.6) contrast(1.08)` was baked into the
projection render; on a TV use roughly `saturate(1.2)` or none, since the screen is not fighting red ambient light).

## 3. Type

Google Fonts, loaded with `display=swap` and awaited via `document.fonts.load` before the first frame:

- **Oswald 700 / 500**: every headline and board title. This is the "LOCKDOWN IN EFFECT" look Ben asked to use
  for all boards: huge condensed caps, letter-spaced slightly, white or the state colour, often with a thick dark
  stroke (`lineWidth 10`, `rgba(0,15,35,0.95)`) under the fill so it stays readable over washes.
- **Share Tech Mono**: readouts, tickers, values, scan numbers. Label right-aligned in `#dfe7ee`, value
  left-aligned in the state colour at 1.2× the label size, both hung off a centre line.
- **Pirata One** (blackletter): only for the words ARKHAM ASYLUM on the banner. Ben asked for the *logo and
  information to be in an easier-to-read font*, so the boards are Oswald. Keep blackletter decorative and rare.
- Sizes at 1920×1080: board title 110 px (fit to 1500 px width), subtitle 44 to 54 px, ticker 28 to 30 px,
  door-panel lines 18 to 28 px with the cell number at 64 px. For a TV viewed from across a room these hold;
  for a TV behind a bar, go one step bigger.
- Text helpers worth copying from `content/cryo-wall.html`: `fitText` (shrinks to a max width), `board()`
  (title + subtitle + rotating readout line), `ticker()` (one endless line wrapping seamlessly), `hazardStripes()`.

## 4. Recurring graphic devices

- **Hazard tape**: 45° stripes, period 36 to 48 px, amber on near-black or red on `#0a0000`, scrolling at
  ±60 to 90 px/s, top and bottom of a band in opposite directions.
- **Scanlines**: 2 px dark lines every 4 px at 25 % black over lit panels; a slow 12 % dark scan bar sweeping down.
- **Blink**: words like FAILURE / SEAL BREACH / LOCKDOWN blink at ~1.5 Hz (`sin(t*9)` modulation); the alert
  red pulse is 2 Hz for the first two seconds only. Never 1-frame flashes; at least 4 frames per state.
- **Glitch in/out**: alerts arrive and leave with horizontal slice offsets for ~0.3 s.
- **Type-on**: alert text appears line by line, a red dot blinking at the cursor.
- **Frost**: value-noise arrival map so frost creeps as a ragged front with a bright rim, not a wipe.
- **Vapour**: soft radial puffs rising from under the door, additive, saturated cyan.
- **Emergency lighting**: amber radial pools every 260 px along the wall, pulsing with generator output.
- **Fade to black** between scenes: 1 to 1.5 s out, 1 s in. Scenes never hard-cut.

## 5. Scene catalogue (what already exists)

### Cryo wing loop, `content/cryo-wall.html`, 1920×1080, 320 s, five scenes
1. **Status board**: amber "ARKHAM ASYLUM" header, cyan door readout (CRYO CELL 07, CONTAINMENT NOMINAL,
   -196 °C, PATIENT 0455, DO NOT OPEN), ticker of routine notices, blue wash on the side walls.
2. **Containment failure**: red flash washes, board CONTAINMENT FAILURE with live STABILITY %, CORE TEMP rising
   from -196, COOLANT VENTING then LOST, door text turns red and blinks, orange rim pulsing round the door,
   then frost creeps door → frame → sides → up the wall; ends on a frost-white title **CRYO WING LOST /
   CELL 07 OPEN · PATIENT 0455 AT LARGE** over a dark blue field.
3. **Lockdown**: red hazard bands top and bottom scrolling, big LOCKDOWN IN EFFECT, rotating readout lines,
   "REMAIN IN YOUR CELLS · SECURITY RESPONSE TEAM DISPATCHED", red sweep bar, door SCAN counter.
4. **Power failure**: MAIN POWER FAILING → BACKUP POWER ENGAGED, GENERATOR OUTPUT %, door goes dark then
   reboots on battery, amber emergency pools, ticker.
5. **Fear toxin**: green wash and pulsing haze, AIRBORNE TOXIN board with CONCENTRATION PPM counting up,
   EXPOSED STAFF, RESPIRATORS MANDATORY, door reads AIR QUALITY HAZARD / VENT OPEN.

Rendered file: `media/cryo_wall_v2.mp4`; exported through Premiere with mattes as `media/exports/cryo_wall_export.mp4`.
For a TV: drop the geometry (DOOR/FRAME/SIDES/WALL polygons and `withSoftEdges`) and lay the same scenes out full
frame, e.g. the door panel as a tall card on the left third and the board on the right two thirds.

### Inmate alerts, `content/arkham-alerts.html`, 1920×1080, 10 s each, 13 inmates × 2 types
- **ESCAPE** (red): INMATE ESCAPED, scrolling "⚠ SECURITY BREACH ⚠ INMATE ESCAPED", foot line
  "LOCKDOWN IN EFFECT ◆ DO NOT APPROACH ◆ REPORT SIGHTINGS TO STAFF".
- **SPOTTED** (amber): INMATE SPOTTED, "◉ SURVEILLANCE ALERT ◉", foot "PROCEED WITH CAUTION ◆ DO NOT APPROACH ◆
  ALERT A MEMBER OF STAFF", plus LAST SEEN: a venue location.
- Card: mugshot left (supplied PNGs, desaturated with scanlines), text block types on: heading, NAME in
  Oswald, then inmate number, cell/ward, THREAT level, a one-line note (e.g. "ARMED WITH LAUGHING GAS · DO NOT
  ENGAGE"). Roster and copy live in the `ALERTS` table at the top of the file; edit freely.
- The 46-minute reel (`media/alerts/Arkham_Alerts/media/arkham_alerts_reel.webm`, VP9 with alpha, cue sheet
  alongside) was chopped into 26 clips at `media/alerts/clips/alert_NN_type_Name.mp4` (10.6 s, scaled 60 % over
  black). For a TV, render the alerts opaque over the status board instead of transparent.

### 360° banner, `content/arkham-banner.html`, 2048×1024, 192 s
Equirectangular strip for the inflatable moon: ARKHAM ASYLUM in blackletter bone white twice round the ball,
an amber monospace status feed with red blinking alerts, a hazard-stripe lower band with a counter-rotating
warning line, scanlines. Every band moves in whole laps so it loops. On a TV this becomes a horizontal
marquee: keep the band structure, drop the 2:1 ratio.

### Moon: bats and the signal, `content/moon-bats.html`, 1080×1080, 90 s
Pale moon face with maria and craters, cloud strips scrolling with wrap-around copies, flocks of flapping bat
silhouettes each crossing once per loop, the bat signal switching on twice per loop (warm beam spot with the
emblem, the rest of the moon dimming). Rendered as `media/moon_bats_1080x1080.mp4`. Works as-is in a 1080×1080
window on a TV; for 16:9 put the moon at the right and let bats enter from the dark left.

### Static holds made with ffmpeg only
- `media/exports/CAPDL_Kinkgarten_wall_10s.mp4`: sign PNG flattened onto black, lettering lifted with
  `curves=all='0/0 0.1/0 0.45/0.66 1/1'`, `eq=saturation=1.25`, no glow (Ben: glow made it unreadable).
- `media/exports/DC_logo_moon_10s.mp4` and `_5h.mp4`: logo cropped to its circle, `eq=saturation=1.9:contrast=1.08`,
  circular alpha via `geq`, then the 10 s clip repeated 1800× with `-stream_loop 1799 -c copy` for five hours.

### Not Arkham, same toolchain (Crucible)
`content/crucible-reveal.html` (14 s gold logo reveal) and `content/vines-roses.html` (28 s growing vines and
roses over a sunset-to-night wall). Useful as examples of a music-timed reveal and of procedural growth.

## 6. How a content page is built (the contract the renderer expects)

Plain HTML + Canvas 2D, no build step, one file per video:

```html
<canvas id="c" width="1920" height="1080"></canvas>
<script>
const W = 1920, H = 1080, DURATION = 320, FPS = 30;           // window.DURATION / window.FPS are read by the renderer
const SCENES = [];  function scene(len, draw) { SCENES.push({ len, draw }); }
scene(60, (lt, t) => { /* draw scene at local time lt */ });
const TOTAL = SCENES.reduce((a, s) => a + s.len, 0);
function renderAt(t) { /* pick scene by t mod TOTAL, draw it, apply fades and the vivid pass */ }
window.assetsReady = () => fontsReady;                        // fonts/images loaded
// preview loop with requestAnimationFrame when opened without ?frame=1
</script>
```

Hard rules that made everything else work:
- **Every frame is a pure function of t.** No state carried between frames, no `Math.random()` at draw time
  (use a seeded hash / value noise). This is what makes parallel rendering, resuming and seamless loops possible.
- Loop length is a whole number of seconds and every oscillation completes an integer number of cycles.
- Draw at native resolution; never rely on CSS scaling.
- Per-scene local time `lt`, with the fades computed from `lt` and `len`, so scenes can be reordered or retimed
  by changing one number.

## 7. Rendering (on the Surface, not the droplet)

```powershell
cd $env:USERPROFILE\projection-mapper
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
node content\render-frames.js content\my-page.html media\my_page.mp4 preview     # PNG stills at PREVIEW_TIMES
node content\render-frames.js content\my-page.html media\my_page.mp4             # full render
```

`content/render-frames.js`: serves the repo, opens N headless pages (Edge first on Windows, `WORKERS=N`, default
half the cores), calls `renderAt(t)` per frame, pipes raw RGBA into one ffmpeg per slice writing fragmented MP4
into `<out>.render/`, joins at the end. **Resumable**: rerun the same command after a kill. Env:
`SECONDS=30` for a short test, `PREVIEW_TIMES=3,7,12`, `AUDIO=file.wav`, `BROWSER`, `FFMPEG`, `PLAYWRIGHT_PATH`.
Output is H.264 yuv420p 30 fps. A 320 s 1080p page took about 15 to 20 minutes on the Surface; the droplet
needed hours, so never render there.

Delivery encode used for the all-night master (plays in VLC on the projector, fine for any TV or Plex):

```
ffmpeg -i in.mp4 -c:v libx264 -preset veryfast -crf 20 -profile:v high -level 4.1 -pix_fmt yuv420p -g 60 -maxrate 12M -bufsize 24M -an -movflags +faststart out.mp4
```

Joining pieces without re-encoding: a concat list with `inpoint`/`outpoint` and `-f concat -safe 0 -c copy`.
Long holds: build 10 s, then `-stream_loop N -c copy`. Keep files under 4 GB for FAT32 sticks (exFAT otherwise).

## 8. What changes for a TV screen

- **Black is black.** On the projector black meant "off" and anything under ~25 % luminance vanished into red
  brick, so everything was pushed vivid and dark greys were banned. On a TV you get the bottom of the scale back:
  dark steel panels, subtle vignettes and dim backgrounds all work. Pull the vivid pass down or remove it.
- **No mattes, no geometry.** Drop the show-file polygons, soft ragged edges and the per-surface logic. Design the
  full 1920×1080 frame; use title-safe margins (~5 %) since TVs may overscan.
- **Composition replaces mapping.** The door panel, board and ticker were placed where the real objects were.
  On a TV, give them a layout: e.g. left third = cell/door card, right two thirds = board, full-width tickers top
  and bottom, alerts as full-screen takeovers.
- **Keep**: palette, Oswald + Share Tech Mono, hazard tape, scanlines, blink rates, type-on, glitch in/out,
  state-coloured scenes, deadpan copy, venue place names, whole-second loops, no flashes under 4 frames.
- **Audio** was never used (everything played silently). If the TV has sound, a low hum + alert chirp would be new work.
- **Still 30 fps H.264 High 4.1**, which every TV, Plex client and stick player decodes.

## 9. Lessons learned (so the next session does not relearn them)

- Glow/bloom behind lettering flooded the frame and killed legibility; brighten the letters with curves instead.
- Scenes must fade through black; hard cuts between states looked like a glitch in the file.
- Boards go directly above the thing they describe (here, the cell); readouts hang off one centre line.
- Keep the focal object (the door) always lit; the audience reads a dark hero object as "broken projector".
- A non-fragmented MP4 from a killed render is garbage; the renderer now writes fragmented slices.
- Premiere locks files it has open; render to a new name and swap.
- Check a still at several timestamps before a long render (`preview` mode), and run `SECONDS=30` first.

## 10. Asset inventory

| What | Path (under `C:\Users\benja\projection-mapper\`) |
|---|---|
| Content pages | `content\cryo-wall.html`, `arkham-alerts.html`, `arkham-banner.html`, `moon-bats.html` |
| Renderer | `content\render-frames.js` (pages), `content\render-alerts.js` + `content\build-reel.py` (alpha reel) |
| Mugshots, reel, cue sheet | `media\alerts\Arkham_Alerts\` |
| 26 alert clips | `media\alerts\clips\alert_NN_*.mp4` |
| Cryo render | `media\cryo_wall_v2.mp4` (320 s) |
| Moon bats | `media\moon_bats_1080x1080.mp4` (90 s) |
| Finals | `media\exports\WALL_MASTER_15min_cycle.mp4` (97.5 min master), `DC_logo_moon_5h.mp4`, `CAPDL_Kinkgarten_wall_10s.mp4` |
| ffmpeg scripts | `media\baked\*.ps1`, `media\exports\*.ps1` |
| Premiere project | `C:\Users\benja\OneDrive\Desktop\Arkham Halloween.prproj` |
| Design rules (projection-specific) | `skills\premiere-projection-content\references\design-rules.md` |
