---
name: multi-projector-blending
description: Edge blending and photometric matching for multi-projector displays — Bourke's soft-edge ramp (power p, luminance a, per-channel inverse gamma), why blends must be summed in linear light, black-level (black offset) compensation, overlap-width guidance, blending on 3-D surfaces by incidence angle (spheres, domes, objects), camera-based alpha masks that sum to 1, luminance attenuation maps and perceptual uniformity (Majumder), colour matching across units, the test procedure (25/50/75/100 % white, grey ramp), and the MPCDI / PFM / alpha / beta file formats. Includes a GLSL reference implementation. Use when seams, bright or dark bands, grey overlap bands, or mismatched projectors appear, when adding edge blending to a mapper, or when importing/exporting warp-and-blend calibrations.
---

# Multi-projector blending and photometrics

Blending is a *photometric* problem layered on a solved *geometric* one: the two projectors must already put the same content pixel on the same spot (see `projection-mapping-geometry`). Then, in the overlap, their light must add up to exactly what one projector would have produced. Everything below follows from that sentence.

## 1. The ramp (what every tool implements)

Paul Bourke (2004), overlap coordinate `x ∈ [0,1]`, right image × `f(x)`, left image × `1 − f(x)`:

```
f(x) = 0.5 · (2x)^p              0 ≤ x ≤ 0.5
f(x) = 1 − 0.5 · (2(1−x))^p      0.5 < x ≤ 1
```

- `p` ("Power" in Resolume, "exponent" in ofxWarp, "blend" in TouchDesigner): `p = 1` is a linear ramp and shows a visible step at both edges of the zone; `p = 2` is the usual choice. Raised cosine `0.5 − 0.5 cos(πx)` is the other common curve (Scalable).
- Centre-brightness variant: `a·(2x)^p` / `1 − (1−a)·(2(1−x))^p` with `a` ("Luminance", default 0.5) raising or lowering the seam centre.
- The ramp is a **multiplicative mask applied after the warp**, per output ("blend after warp, not before" — WATCHOUT). Corners of a 2-D array multiply the horizontal and vertical factors.

## 2. Gamma: blend in linear light or the seam goes dark

A projector emits roughly `L = v^γ` (γ ≈ 1.8–2.4, per channel, per unit). If two projectors with weights `w₁ + w₂ = 1` must sum to the unblended luminance, the *pixel values* must be `v_i = w_i^{1/γ} · v`. Multiplying gamma-encoded pixels by `w_i` directly sums to `(w₁^γ + w₂^γ)·L < L`: the dark band through the middle of every blend. So either

- apply `pow(w, 1/γ)` per channel to the encoded colour (Bourke, ofxProjectorBlend, TouchDesigner), or
- linearize the content (`pow(c, γ)`), weight, re-encode (`pow(·, 1/γ)`).

Use the **measured** γ of each projector and channel, not 2.2. Symptoms: dark band at the blend centre → γ too low in the correction (WATCHOUT's slider goes the other way: lower slider = darker band); bright band → too high. Some vendors write `output = input^γ` — check which side the exponent sits on before copying a formula.

## 3. Black level

Projectors emit light at black. In an overlap both blacks add, so black scenes show a **grey band** that no ramp can remove ("even a perfect blend gradient cannot hide mismatched black levels" — WATCHOUT). Fix: raise the black of the *non-overlapping* areas to the overlap's floor (Resolume "Black Level Compensation", Epson "Black Level → Area Correction", MPCDI **beta** map, Christie mechanical blinders). Model: black luminance `b_i` per projector; in a region covered by set S the floor is `Σ_{i∈S} b_i`; add to each projector an offset so every region reaches the maximum floor. Compute the offset in linear light and encode once. Cost: global contrast drops to the overlap's black, which is why high native contrast matters more than lumens for invisible blends.

## 4. Overlap width and placement

| Source | Overlap guidance |
|---|---|
| Bourke | 256 px on XGA worked, 128 px "noticeably worse" |
| Resolume | ≥ 15 % of the output width |
| WATCHOUT | 10–20 % common; < 5 % "much harder" |
| MadMapper forum | 20–30 % |
| Millumin | 5–10 % |
| QLab users | 100–300 px |

Make the blend zone equal to the **real** pixel overlap (measure with the test pattern); place projectors symmetrically (same height, distance, tilt) so pixel density and brightness match inside the zone; aim so overlaps fall where both units hit the surface at similar incidence.

## 5. Blending on 3-D surfaces (spheres, domes, objects)

Screen-edge ramps assume a flat overlap band. On a sphere lit from three sides the overlap is a curved region, so weight **per surface point** instead:

- **Incidence weighting** [practice, Splash / Shader Lamps lineage]: for surface point `p` with normal `n`, `w_i = max(0, n · toward_projector_i)^k`, normalized `a_i = w_i / Σ_j w_j`, then gamma-correct `a_i^{1/γ}`. Every projector computes the same `Σ_j` (it knows the others' positions), so weights sum to 1 by construction and each unit fades out automatically where it hits at grazing angle. `k` (sharpness) 1–4; higher hands over faster. Shader Lamps treats `|θ| > 60°` as unlit.
- **Camera-space masks** (Raskar 1999): per projector form the convex hull of its lit pixels in the camera; `A_m = α_m / Σ_i α_i` with `α_i = (inside hull) × (distance to hull edge)`; warp the mask back into projector space; pass it through the projector's gamma LUT. Weights "change smoothly in and near overlaps" and sum to 1.
- **Mesh-based** (Splash): blend weights stored as vertex attributes on the shared 3-D model, recomputed per frame for moving objects.
- Remember the Shader Lamps attenuation for brightness falloff on an object: required projector intensity `I_p ∝ L · d² / cos θ` — the limb of a ball is dimmer than its centre for the same pixel value; compensate per pixel or accept it.

## 6. Luminance and colour uniformity (beyond the seam)

A single projector is brighter in the centre than at its edges, units differ, and overlaps are bright. Majumder & Stevens: measure each projector's transfer function `h(i)` with a photometer and its max/black luminance surfaces `W(u,v)`, `B(u,v)` with a registered camera; humans are "most sensitive to significant luminance discontinuities and insensitive to smooth changes" and an order of magnitude more sensitive to luminance than chrominance — so flatten luminance *gradients* rather than absolute luminance: constrain `|∂W'/∂x| ≤ W'/λ` (λ ≈ 400–800), maximize Σ W' by linear programming or their iterative raise, and apply the **luminance attenuation map** `W'/W` per pixel through `h⁻¹`. Absolute uniformity (every pixel to the worst pixel) wastes most of the light.

Colour: match white points per unit first (RGB gain sliders); for a measured fix compute a per-projector 3×3 matrix to a common gamut in linear light, applied after the blend weight and before gamma encoding. Disable "dynamic contrast", "eco" and auto-iris modes that change γ frame to frame.

## 7. Test procedure

1. Geometry first: single-pixel grid test pattern; lines must coincide across the seam and be equally sharp (focus at the surface centre, projector keystone off).
2. Set blend widths to the measured overlap, enable the ramp.
3. Show flat **25 / 50 / 75 / 100 % white** and a grey ramp. Tune γ per channel until the 50 % field has no band (the 50 % field is the most sensitive); tune `p`/luminance on the ramp.
4. Show black; tune black-level lift on the single-coverage areas.
5. Show real content with motion and high contrast; static tests hide blend errors.
6. Save the show file; export masks/warps as images if the tool allows.

## 8. File formats

- **MPCDI** (VESA, v1 2013, v2 adds colour LUTs): `.mpcdi` = ZIP with `mpcdi.xml` (display → buffer → region with frustum and fileset), per region a **PFM** warp (32-bit float, R,G = normalized UV into the input buffer), an **alpha** PNG (multiplicative blend/intensity, `gammaEmbedded` attribute says how to linearize it) and a **beta** PNG (black-level lift, gamma does not apply). Profiles: 2D Media, 3D Simulation, Advanced 3D, Shader Lamps. Written by VIOSO, Scalable, domeprojection; read by WATCHOUT (2D), BrightSign, Unreal nDisplay, TouchDesigner MPCDI TOP, Pixera, Barco/Christie. No standalone open-source parser was found; Unreal's `DisplayClusterWarp` plugin is the most complete open reader. The spec itself is VESA-members-only; token names are from implementer docs.
- **Bourke `.data` mesh**: node `x y u v i`; one intensity per node, so per-channel gamma blending needs an RGB extension.
- **Tool-native**: Resolume Advanced Output preset XML, ofxWarp JSON (`blend: {exponent, edges, gamma, luminance}`), Splash `configuration.json`, QLab stage files, RoomAlive `calibration.xml`.

## Reference implementation

`assets/blend.glsl` is a WebGL2/GLSL ES 3.00 fragment-shader function set: the four-edge Bourke ramp with power, luminance and per-channel gamma, black-level lift, and the incidence-angle weight for 3-D surfaces. Read `references/blend-math.md` for the derivations and source quotes, and `references/formats.md` for MPCDI/PFM details.
