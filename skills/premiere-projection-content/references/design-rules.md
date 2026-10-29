# Design rules for projected content on textured, dark, coloured surfaces

Compiled 2026-10-29. Most of this is practice rather than documentation, so nearly every number is **[derived]** (our rule of thumb from the physics of projection, the mapper's readouts and signage practice). Primary sources are cited where they exist. Companion: `projection-show-workflow` (lumens, contrast, black level) and `multi-projector-blending`.

---

## 1. The physics that sets the rules

- A projector can only **add** light. Black in the file = the projector's black level on the surface, which under coloured ambient light on red brick is the ambient light itself. So black is "off", and anything *near* black is indistinguishable from off. (`projection-show-workflow` §5, "Black is not off".) Blend modes that remove light (Multiply, Darken) have no physical counterpart — see `premiere-workflow.md` §6 for the documented Screen/Add behaviour.
- **Contrast on the surface** = (projected luminance + ambient) ÷ ambient. Lumens-per-lux planning says aim for ≥ 5× the measured ambient lux (`projection-show-workflow` §1). Inside the content that means: anything meant to be *seen* must be bright; subtlety is lost first.
- Red brick reflects long wavelengths more than short ones, so projected **red/orange/yellow is brighter** on it than blue/cyan at equal file values, while red ambient light raises the floor most for red content. Result: red-on-brick is bright but low-contrast against red ambient; cyan/blue is high-contrast in hue but dim. **Test on the real wall** — there is no universal answer [derived].
- The projector's resolution is spread over the mapped shape, so the *pixel size on the object* (`width ÷ horizontal pixels`, `projection-show-workflow` §1; the mapper's Setup template prints pixels per inch) sets how fine anything can be. Warping (the mapper's corner pin / warp grid, or `bake.js`) **resamples** once more, so single-pixel detail that survives the export dies on the wall.

---

## 2. Numbers [derived]

| Rule | Value | Why |
|---|---|---|
| "Black" | code 0 (0 IRE). Anything you want invisible must be exactly 0, not 5–20 | low values still emit light and show as a grey rectangle on a dark wall |
| Lowest useful tone | ≥ 25–30 % luminance (≈ 64–77 in 8-bit) for content that must register at all; ≥ 50 % for anything the audience must *read* | ambient on brick swallows the bottom third of the scale |
| Dark greys | avoid 10–30 % greys as a design colour — they read as "projector on, nothing happening" | same |
| Saturation | push *Vibrance* first, then *Saturation*; keep hues pure (one or two channels near 255, the third low). Pastels desaturate further on a coloured wall | surface colour multiplies the projected spectrum |
| Thin lines | never < 2 px at projector resolution; **≥ 3 px** on any surface that is warped (ball, corner-pinned walls), ≥ 4 px on coarse brick | resampling + mortar lines break 1-px strokes |
| Stroke contrast | outlines/strokes in white or a pure bright hue, never dark on light (there is no "light" to be dark against) | add-only light |
| Type size | cap height in px ≥ `(viewing distance in ft ÷ 10) × (px per inch on the surface)`; sign-industry rule ≈ 1 inch of letter height per 10 ft of viewing (signs.com, banners.com, studiomatrx; vendor rules, not a standard) **[unverified as a standard]** | legibility at distance |
| Type size worked | 1920 px over a 12 ft wall = 13.3 px/in; viewers at 40 ft → 4 in cap height → **≥ 53 px cap height ≈ 75 px font size**; at 1280 px over the same wall, 8.9 px/in → ≥ 36 px cap ≈ 50 px font | |
| Type weight | bold / heavy sans, letter-spaced +5–10 %, no thin serifs, no light weights; stroke ≥ 3 px | mortar joints and texture eat thin strokes |
| Type colour | white or a saturated bright hue on pure black; no dark text on bright fields | add-only light |
| Safe margin | keep anything important ≥ 3 % of the frame (≈ 40 px at 1280, 60 px at 1920) inside every mapped-shape edge, and outside the dashed mask polygons in the Guide SVG | alignment drift, inflatable movement, feather |
| Edge treatment | large wall areas: soften the matte 20–60 px (Gaussian Blur on the matte) or break it with a noise/"ragged" edge so the lit area does not read as a rectangle; door/frame surfaces: hard edges on purpose | a crisp lit rectangle on brick screams "projector" |
| Motion speed | ≤ ¼ frame width per second for anything the eye should follow; faster motion smears into the brick texture at 30 fps | 30 fps + long-GOP + texture |
| Flicker/strobe | ≥ 4 frames per state at 30 fps (7.5 Hz max) for strobes; never 1-frame flashes | H.264 and players drop single frames; also health |
| Loops | loop length a whole number of seconds; every oscillation completes an integer number of cycles | seamless restart |
| Sphere strip | 2048 × 1024; key content within rows 25–75 % (±45° latitude), readable text within ±35°; edges tile | equirectangular stretch at the poles |

---

## 3. Surface-specific notes for the Arkham wall and the moon [derived]

- **Cell door, frame, side walls, long wall above** are separate mattes from the zip (`<prefix>_<surface>.png`). Give each its *own* content and tone: the door is the focal plane (hard edges, brightest), the frame can carry a rim light / crack glow, the side walls and the long wall take ambient atmosphere (slow Fractal Noise fog, flicker of a bulb, drips) at ≤ 50 % brightness so the door stays the brightest thing on the wall.
- **Brick under coloured ambient**: write the ambient colour down (gel number, RGB from a phone photo) and pick content hues on the opposite side of the wheel for anything that must pop (ambient red → cyan/green/white accents), reserving the same hue as the ambient for "invisible" blending effects.
- **Horizontal content on a brick wall** lands on mortar lines; vertical drips, cracks and light shafts read better than horizontal bars. A 1-px-perfect brick-aligned grid is impossible to hold; design as if the wall were slightly out of register.
- **The moon** is an inflatable: it moves with the blower and settles (`projection-show-workflow` §6). Feather the limb (the mapper's circular mask / ball blend), keep faces and text ±35° of the equator facing projector 1, and avoid fine lunar detail at the limb where pixels stretch. Content black stays black on a ball too — a dark moon phase is a *mask*, not a grey.
- **Text on the wall** is read from the audience position, not from the projector; measure the viewing distance from where people stand, not the throw distance.

---

## 4. Process rules

1. Build on the mapper's Shape PNG and Guide at 100 % zoom in the Program Monitor; never design on a scaled preview.
2. Check tones on `Window > Lumetri Scopes` Waveform (8-bit): blacks at 0, key content above ~64, highlights at 235–255 (https://helpx.adobe.com/premiere-pro/using/lumetri-scopes.html, May 24 2023).
3. View the Program Monitor with *Viewer Gamma* 2.2 (`premiere-workflow.md` §3) — it is closer to a Windows desktop and the player than 2.4 [derived].
4. Export, put the file on the stick, play it on the real projector on the real wall with the show lighting on, and walk the audience area. Adjust saturation and the black threshold *from the wall*, not from the laptop. Re-check after warm-up (`projection-show-workflow` §4).
5. Keep the sources: a slow-motion, high-contrast, over-saturated master grades down easily; a subtle one cannot be graded up.
