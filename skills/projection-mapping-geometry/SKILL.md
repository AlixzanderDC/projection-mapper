---
name: projection-mapping-geometry
description: Geometry and calibration math for projection mapping code — corner-pin homographies (DLT, Hartley normalization, packing a 3×3 into a 4×4 so the GPU does the perspective divide), perspective-correct quads, Bézier / Catmull-Rom / thin-plate-spline warp grids, per-pixel UV warp maps (Bourke .data, PFM), inverse vs forward mapping, projector intrinsics from throw ratio and lens shift, camera–projector calibration (Gray-code structured light, phase shift, Zhang / calibrateCamera, Moreno–Taubin local homographies, solvePnP, RoomAlive), and curved surfaces (ray–sphere in a fragment shader, equirectangular / fisheye / dome master, quadric transfer, pose from a sphere's silhouette). Use when writing or debugging a projection mapper, keystone or warp code, a WebGL/Three.js/openFrameworks/TouchDesigner mapping tool, a structured-light scanner, or when asked how to map onto a sphere, dome, cylinder or building.
---

# Projection-mapping geometry

Everything a mapper does geometrically reduces to: **composite the content → per output, resample it through a warp → mask → blend**. This skill covers the warp and the calibration that produces it. Blending and photometrics are in `multi-projector-blending`; site work, signal and content production are in `projection-show-workflow`.

Formulas below are quoted from primary sources where possible (see `references/research-math.md` for the full report with URLs, and the `[derived]` / `[unverified]` tags on anything not confirmed against a source).

## 1. Flat surface = homography (corner pin)

A projector throwing onto a plane is related to any other view of that plane by a 3×3 homography `H` (8 degrees of freedom, `x' ≅ H x`). Keystone correction is the special case where `H` comes only from tilting the projector; a free corner pin also absorbs lens shift and non-square pixels.

**Solve (DLT).** For each correspondence `(X,Y) → (x,y)` add two rows to `A`:

```
[ X  Y  1  0  0  0  -X·x  -Y·x  -x ]
[ 0  0  0  X  Y  1  -X·y  -Y·y  -y ]
```

`h` is the right singular vector of `A` for the smallest singular value (4 points: exact; more: least squares). **Always Hartley-normalize first**: translate each point set to its centroid, scale so the mean distance from the origin is √2, solve, then `H = T2⁻¹ Ĥ T1`. Raw pixel coordinates make the system ill-conditioned by orders of magnitude. Reject degenerate sets (3 collinear points) and solutions where `h31·x + h32·y + h33` changes sign inside the quad (part of the quad maps behind the projector).

**Apply on the GPU — do not interpolate `vec2 uv` over two triangles.** Screen-space linear interpolation of texture coordinates gives the classic diagonal crease. Two correct options:

1. Pack the 3×3 into a 4×4 with the z row and column zeroed and let the rasterizer do the perspective divide (ofxPiMapper, ofxWarp, maptastic all do this):
   ```
   column-major: { h11, h21, 0, h31,   h12, h22, 0, h32,   0, 0, 0, 0,   h13, h23, 0, 1 }
   ```
   Draw the unit quad with that matrix and plain `(u,v)` texcoords; the hardware's perspective-correct interpolation reproduces the homography.
2. Per corner compute `t_i = H⁻¹·(x_i, y_i, 1)ᵀ`, pass as `vec3`, sample `texture(tex, t.xy / t.z)` (or `textureProj`). Exact because `t` is affine over a flat 2-D quad.

For a **subdivided** quad (needed when you mix a homography with a free-form grid), evaluate `H` at each mesh vertex on the CPU (`squareToQuad`) and interpolate only the small residual displacement; the perspective part stays exact.

## 2. Warp grids for curved and imperfect surfaces

| Method | Interpolates handles? | Use for |
|---|---|---|
| Bézier surface (`p(u,v) = ΣΣ B_i^n(u) B_j^m(v) k_ij`) | No (only corners) | smooth global correction, few DOF (Resolume/QLab "Bézier", Splash per-camera warp) |
| Catmull-Rom tensor grid | Yes | user-dragged control points; use **centripetal** (α = 0.5, Barry–Goldman form) when points move far: no cusps or loops within a segment |
| Linear / bilinear grid | Yes, creases | boxes, crosses, folded walls where the surface really creases |
| Thin-plate spline `φ(r) = r² log r` | Yes, scattered | irregular measured points (camera dots), smooth with a stiffness λ |

Rules: evaluate the warp on a dense mesh (16 px per cell is ofxWarp's default; adaptive to the curvature) or bake it to a lookup texture; apply any homography first and the grid as an offset on top ("perspective then bilinear", ofxWarp's `WarpPerspectiveBilinear`); keep the corner pin and the grid as separate state so one can be reset without the other.

## 3. Per-pixel warp maps (the universal interchange)

Any warp can be baked to a float texture at **output** resolution holding `(u, v, intensity)`: `m = texture(map, gl_FragCoord.xy/res); color = texture(content, m.xy) * m.z;`. That is what MPCDI's PFM warp file is (R,G = normalized UV into the input buffer), what TouchDesigner's Stoner exports for the Remap TOP, and what Paul Bourke's `.data` mesh is in text form (`type`, `nx ny`, then `x y u v i` per node, u/v outside 0–1 or negative `i` = don't draw; `x,y` in GL-normalized ±aspect/±1). Vendor calibrators (VIOSO, Scalable, Christie, NVIDIA scan-out warp) all consume one of these. Baking makes export, hardware warp and offline prewarp trivial — build it once per calibration, not per frame.

Inverse mapping (for every output pixel, where do I sample?) is what a fragment shader does and has no holes; forward mapping (push source pixels) leaves holes and collisions. A displaced mesh is forward-mapped vertices with the rasterizer filling in; it only breaks if cells fold. In strongly compressed regions (dome rims, sphere limbs) use mipmaps/anisotropic filtering or supersample.

## 4. Projector intrinsics without a camera

Treat the projector as a pinhole camera `K = [f 0 cx; 0 f cy; 0 0 1]` in output pixels:

- `f = throwRatio × width_px` (throw ratio = distance ÷ image width, from the lens spec; zoom lenses give a range).
- Lens shift is an **off-axis frustum**, not a rotation: it moves the principal point. 100 % vertical offset (the common "desktop" projector: image bottom edge level with the lens) means `cy = height` with y down, i.e. the optical axis exits at the bottom edge. RoomAlive initializes projectors with exactly `cy = 0` (y up) for this reason. Conventions differ (Sony: 0 % = centred; Norxe: 50 % = centred) — read the datasheet.
- Ray behind pixel `(px, py)`: `normalize((px − cx)/f, (cy − py)/f, 1)`.
- Digital keystone inside the projector resamples pixels before your warp: **switch it off** whenever software does the mapping.

With `K` known, placing a known object (a sphere of known radius, a model with ≥ 6 picked vertices) in the frame is enough to recover the projector's pose relative to it (`solvePnP`, or the silhouette-conic method in §6).

## 5. Camera–projector calibration

- **Projector = inverse camera.** Zhang's planar method (what `cv::calibrateCamera` runs) works unchanged if you can give it, per view, the *projector pixel* that lands on each known world point. Structured light provides that correspondence.
- **Gray codes.** `log2(W)` column + `log2(H)` row patterns, each with its inverse; a bit is valid when `|captured − inverted|` exceeds a threshold (RoomAlive uses 10/255; 3DUNDERWORLD thresholds at the midpoint of a pixel's max and min); all-white/all-black frames give the shadow mask; decode Gray → binary with `b = g; for i in 1..n: b ^= g >> i`. Lock camera exposure, gain and white balance; expect the 1–2 px LSB stripes to blur out, so stop early or refine with phase shift. OpenCV: `cv::structured_light::GrayCodePattern::getProjPixel`.
- **Phase shift** (sub-pixel): 3-step `φ = atan2(√3 (I₁ − I₂), 2 I₀ − I₁ − I₂)`, unwrap with a Gray code or multi-frequency; sensitive to projector gamma — linearize or use more steps.
- **Moreno & Taubin (2012)** is the robust recipe: checkerboard + full Gray-code sequence per pose; for each detected corner fit a **local homography** from the decoded correspondences in a ~47×47 px patch and push the corner through it to get its projector-pixel position; then `calibrateCamera` for the camera, again for the projector, `stereoCalibrate` for the pair. A single global homography from flashed dots (a 4-to-many least-squares fit) is this method with one patch; upgrading to per-feature local homographies or a TPS handles lens distortion and non-flat surfaces.
- **3-D model alignment (Shader Lamps / mapamok / CamSchnappr / Splash).** Pick ≥ 6 non-coplanar model vertices and click where they land; solve the 3×4 projection (DLT) or `calibrateCamera` with a FOV guess and fixed aspect; render the model through that camera. Degenerate when all points are coplanar. Report reprojection error; under ~2 px is usable.
- **Projector lens distortion** must be *pre*-distorted (forward polynomial applied when building the warp map), the opposite of undistorting a camera.
- **Multiple projectors** share one world frame: register every projector to the surface (a measured rectangle, a 3-D mesh, a sphere), never to each other pairwise; for walls too big for one camera view use a homography tree (Chen et al. 2002: spanning tree of camera views, iterative refinement, 0.55 px on 24 projectors).

## 6. Curved surfaces

**Sphere (moon, globe).** Per projector pixel: ray `û` from §4; intersect `‖o + dû − c‖² = r²` → `Δ = [û·(o−c)]² − (‖o−c‖² − r²)`, nearest hit `d = −û·(o−c) − √Δ`, miss if `Δ < 0`; normal `n = (p − c)/r`; `lon = atan2(n.x, n.z)`, `lat = asin(n.y)`; equirectangular `uv = (lon/2π + 0.5, 0.5 − lat/π)`. All projectors share the same world sphere and the same 2:1 strip, so seams are consistent by construction; weights come from incidence angle (see blending skill). With `K` known, the projector's distance in radii follows from the disc's angular radius `α`: `L = 1/sin α`, and the direction to the centre from the disc centre pixel — the whole pose except roll comes from where the ball sits in the frame. For a full conic fit (off-axis spheres project as ellipses) use the silhouette conic `A u² + B uv + C v² + D u + E v + F = 0` with `A = r² − y0² − z0², B = 2x0y0, C = r² − x0² − z0², D = 2x0z0, E = 2y0z0, F = r² − x0² − y0²` (Tóth et al.).

**Dome / fisheye.** Dome master = equidistant ("angular") fisheye, square, 180°: `θ = r · aperture/2`, `φ = atan2(y, x)`, direction `(sinθ cosφ, sinθ sinφ, cosθ)`. Equirectangular ↔ fisheye conversion code is on Bourke's `fish2` page. Multi-projector domes: each projector a 120° wedge with blends at the seams (Bourke 3projdome); spherical-mirror domes use Fermat's principle (minimize path length) to find the reflection point.

**Quadric transfer (Raskar).** Parametric alternative for spheres/cylinders/domes: `x' ≅ A x ± √(xᵀ E x) · e`, 9+ correspondences per pair, `xᵀEx = 0` is the outline conic; calibrate intrinsics first or expect 20–30 px errors. Implement as a vertex shader on a dense mesh.

**Cylinders and buildings.** Use a 3-D model + virtual camera per projector (§5), or for shallow curvature a Catmull-Rom grid with straight (linear) rows where the surface creases.

## 7. Implementation checklist for a mapper

- State per surface: corner points, grid points (offsets), interpolation kind, UV crop, mask polygon, blend parameters — all serializable; persist and export the baked UV map.
- Render content once to an FBO; per output, one pass that applies warp + mask + blend + gamma. Composite at ≥ output resolution.
- Keep editing geometry in normalized output coordinates (0–1) so a resolution change does not move surfaces.
- Provide: labelled test pattern with single-pixel grid (verifies 1:1 pixel mapping and projector keystone off), lon/lat graticule for spheres, undo, numeric nudging, locking.
- Test the math numerically (a unit test that pins four points and checks `H·corner = target`, a sphere test that maps a projector's centre pixel to the expected longitude) before testing on a wall.

## References in this skill

- `references/research-math.md` — full research report: formulas, derivations, source URLs for every topic above (§1 geometry, §2 calibration, §3 curved, §5 registration, §6 optics, §7 GPU notes).
- `references/codebases.md` — where to read working implementations (ofxPiMapper, ofxWarp, Splash, RoomAlive, ProCamToolkit, Keystone, three-projection-mapper, maptastic, TouchDesigner palette).
