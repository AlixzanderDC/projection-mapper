# Blend mathematics — sources and derivations

Extracted from the research report in `../../projection-mapping-geometry/references/research-math.md` (§4) and the tool survey in `../../projection-show-workflow/references/research-tools.md` (§3.5). Quotes are from the cited pages; `[derived]` marks our own derivation.

## Bourke 2004 — "Edge blending using commodity projectors"
https://paulbourke.net/miscellaneous/edgeblend/

- Overlap `x ∈ [0,1]`; left × `(1 − f(x))`, right × `f(x)`; `f(x) = 0.5(2x)^p` for `x ≤ 0.5`, `1 − 0.5(2(1−x))^p` above; centre-brightness variant `a(2x)^p` / `1 − (1−a)(2(1−x))^p`.
- `p = 1` "tends to result in a visible step at the edges of the blending region"; he uses `p = 2`.
- "What really needs to be done is to add brightness levels": displays follow `brightness = pixel^G`, `G ≈ 1.8–2.2`, so apply `f(x)^{1/G}` and `f(1−x)^{1/G}`, "applied to each r,g,b value because of variations in the projectors used"; without it "a grey band appears".
- 256 px overlap on XGA worked; 128 px "noticeably worse". Mask drawn as a multiplicative post-pass. Assumes a Lambertian surface. Black level is "a major limiting factor to how well the blending can be made invisible" (1500–3500:1 contrast quoted).

## Why linear light [derived]
Projector output `L = v^γ`. Two projectors with weights `w₁ + w₂ = 1` must sum to the unblended `L`: pixel values `v_i = (w_i L)^{1/γ} = w_i^{1/γ} v`. Multiplying encoded pixels by `w_i` instead gives `L_i = w_i^γ L`, total `(w₁^γ + w₂^γ) L < L` → dark band. Equivalent implementations: multiply encoded colour by `pow(w, 1/γ)`, or linearize–weight–re-encode. Use measured per-channel γ.

## Industry conventions
- Scalable Display: gamma-corrected curves "typically following a raised cosine or similar function"; "A linear ramp produces a visible gradient that the human eye detects even when brightness levels are technically correct".
- WATCHOUT 7: soft-edge "Gamma Correction slider (range 0.5–1.5, default 1.0)"; too low → "a dark band at the blend center", too high → "a bright band"; 10–20 % overlap common, < 5 % "much harder"; pipeline "composite → warp → masks → soft-edge"; test at 25/50/75/100 % white; "Even a perfect blend gradient cannot hide mismatched black levels".
- Resolume Arena: Power = `p`, Luminance = `a`, Gamma R/G/B = `G`, Black Level Compensation brightens non-overlap areas; ≥ 15 % overlap; align on the test card first.
- Immersaview writes `output = input^γ` (opposite exponent side) — check conventions.
- ofxProjectorBlend shader: `curve = loc/extend`; lower half `lumCon·pow(2·curve, blePow)`, upper `1 − (1 − lumCon)·pow(2(1 − curve), blePow)`; then per-channel `pow(curve, 1/gamma.rgb)`; corners multiply two edge factors; blankout regions black. TouchDesigner `projectorBlend` cites this lineage.

## Black level [derived model]
Black luminance `b_i` per projector. Region covered by set S has floor `Σ_{i∈S} b_i`. To flatten, add to each projector in region R an offset so total black = `max_R Σ b_i` (two equal units: lift single-coverage areas by one `b`). Compute in luminance, encode once: `v = ((b_target − b_own)/L_max)^{1/γ}`. Mechanical alternative: Christie blinders at the projector. MPCDI stores this as the beta map (gamma not applied).

## Camera-based masks — Raskar 1999 / Bimber & Raskar SAR §5.3
"The sum of the intensity weights of the corresponding projector pixels is 1"; weights "change smoothly in and near overlaps". In the camera image form each projector's convex hull `H_i`; for projector m's pixel `(u,v)`: `A_m(u,v) = α_m / Σ_i α_i`, `α_i = w_i · d_i`, `w_i = 1` inside `H_i` else 0, `d_i` = distance to the nearest hull edge. Transform the mask into projector space with the same warp; pass through a gamma LUT. Shader Lamps refinement for 3-D objects: weight 1 where only one projector lights the point; otherwise ∝ 1/(distance to the nearest weight-1 pixel) without crossing depth discontinuities; `|θ| > 60°` treated as unlit.

## Incidence weighting [practice]
`w_i = max(0, n · toward_i)^k`, `a_i = w_i / Σ_j w_j`, then `a_i^{1/γ}`. Consistent across projectors because each computes the same denominator from the shared projector positions. Shader Lamps brightness model: radiance `L = g · k_u · I_p · cos θ_p / d²`, so required `I_p = L d² / (k_u cos θ_p)`.

## Majumder & Stevens — perceptual photometric seamlessness
Dissertation (UNC 2003) https://sreal.ucf.edu/wp-content/uploads/2018/02/dissertation_majumder.pdf ; TOG 24(1) 2005, DOI 10.1145/1037957.1037964 ; TVCG 10(2) 2004.
- Display model per channel: `h(i) · W(u,v) + B(u,v)` — transfer function (photometer), max-luminance surface and black surface (registered camera; "we need only four pictures" per channel after geometric calibration).
- Absolute uniformity forces every pixel to the worst pixel ("compression in contrast"). Humans are "most sensitive to significant luminance discontinuities and insensitive to smooth changes" and "at least an order of magnitude more sensitive to variations in luminance than in chrominance".
- Optimization: capability `W' ≤ W`; perceptual uniformity `|∂W'/∂x| ≤ W'/λ` in every direction (λ = 400–800 shown; larger = smoother, dimmer); maximize Σ W'. Discretized over 8 neighbours → linear program or iterative raising. Black `B' = max B`. Luminance attenuation map `W'/W`, applied per pixel through `h⁻¹`. Assumes Lambertian screen; off-axis viewing re-exposes seams on non-Lambertian screens.

## Colour matching
Practice: per-unit white point (RGB gains), measure across the whole array not only overlaps, same-model units differ and drift. Research: gamut morphing in overlaps (Majumder patent US 9,052,584), Disney "Seamless Multi-Projection Revisited" (TVCG 2018). Minimal implementable version `[derived]`: measure primaries/white per projector, 3×3 to a common (intersection) gamut in linear light, applied after weights, before encoding.
