# Projection-Mapping Mathematics and Algorithms — Research Report

Compiled 2026-10-23 for writing Claude Code skills. Everything below is either (a) quoted/paraphrased from a fetched primary source, with the URL, or (b) explicitly marked **[derived]** (my own derivation from the cited material) or **[unverified]** (standard knowledge I could not confirm against a fetched source in this session). Notation: `~` or `≅` means equality up to scale of homogeneous vectors.

Source texts were extracted during research; URLs are in the References section at the end.

---

## 1. Geometry

### 1.1 Homography from 4+ points (DLT)

A planar homography maps homogeneous points `x = (X, Y, 1)ᵀ` to `x' = (x, y, 1)ᵀ`:

```
s · [x y 1]ᵀ = H · [X Y 1]ᵀ ,   H = [h1 h2 h3; h4 h5 h6; h7 h8 h9]   (8 DOF, defined up to scale)
```

OpenCV `findHomography` documents exactly what is minimized: `s_i [x'_i y'_i 1]ᵀ ~ H [x_i y_i 1]ᵀ` such that the back-projection error

```
Σ_i ( x'_i − (h11 x_i + h12 y_i + h13)/(h31 x_i + h32 y_i + h33) )² + ( y'_i − (h21 x_i + h22 y_i + h23)/(h31 x_i + h32 y_i + h33) )²
```

is minimized; method 0 = least squares on all points, `RANSAC`, `LMEDS`, `RHO` are the robust variants, with `ransacReprojThreshold` (1–10 px typical) deciding inliers; robust methods draw random 4-point subsets (collinear sets discarded). Source: OpenCV calib3d docs (local copy `opencv_calib3d.txt`; https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html).

**DLT linear system** (as written in Chen et al. 2002, Sec. 2.1, which cites Sukthankar's closed form): for each of n matches `(X_i,Y_i) ↔ (x_i,y_i)` build two rows of `A` (n×9... they write it as 2n×9):

```
[ X_i  Y_i  1   0    0   0   −X_i x_i   −Y_i x_i   −x_i ]
[ 0    0    0   X_i  Y_i  1   −X_i y_i   −Y_i y_i   −y_i ]
```

"compute the eigenvalues of AᵀA. h is given by the eigenvector corresponding to the smallest eigenvalue" (equivalently the right singular vector of A for the smallest singular value — Wikipedia DLT: with noise use "a right singular vector corresponding to the smallest singular value of B"). Sources: https://ics.uci.edu/~majumder/docs/hanchen.pdf ; https://en.wikipedia.org/wiki/Direct_linear_transformation.

**Hartley normalization** (do it, always). From the CS766 slide code (Hartley's `normalise2dpts`): translate so the centroid is at the origin, then scale so the mean distance from the origin is √2:

```
c = mean(pts);  newp = pts − c;  meandist = mean(‖newp‖);  scale = √2 / meandist
T = [ scale 0 −scale·c_x ;  0 scale −scale·c_y ;  0 0 1 ]
```

Apply `T1` to source points and `T2` to target points, solve the DLT on normalized points to get `Ĥ`, then **[derived]** denormalize `H = T2⁻¹ Ĥ T1` (the slides show the fundamental-matrix analogue `F = T2ᵀ F̂ T1`). Reason: raw pixel coordinates give data-matrix columns differing by orders of magnitude (~10⁴ vs ~10² vs 1), so least squares is ill-conditioned. Sources: https://pages.cs.wisc.edu/~lizhang/courses/cs766-2012f/syllabus/10-23-sfm/10-11-sfm.pdf ; Hartley, "In defense of the eight-point algorithm", IEEE TPAMI 19(6):580–593, 1997 (cited via https://arxiv.org/pdf/2304.10771). Hartley & Zisserman's book is the canonical reference (Algorithm 4.2, "normalized DLT") **[unverified page/algorithm number]**.

**Plane-induced homography (physical meaning).** Two cameras viewing a plane with normal `n` at distance `d`: `H_ab = R − t·nᵀ/d` (calibrated coordinates); in pixels `K_a H_ab K_b⁻¹`. Source: https://en.wikipedia.org/wiki/Homography_(computer_vision). This is why a projector-onto-flat-wall mapping is exactly a homography, and why it stops being one on a curved surface.

**Pitfalls.** 4 points = exact solution (no residual to check); use ≥ 8–20 and look at the residual. Degenerate if 3 of the 4 points are collinear. OpenCV returns `H` with `h33 = 1`; near-singular when the quad is extremely oblique (`h31 x + h32 y + h33 → 0` inside the quad means part of the quad maps behind the projector — reject).

### 1.2 Perspective-correct texturing of a quad (why bilinear UV fails; the q trick)

UC Davis handout: the rasterizer linearly interpolates `s,t` in *screen* space, which "would lead to unrealistic images"; for a quad "the heights of the texture squares would not get smaller as they get farther away, even though the widths would" — and splitting into two triangles puts most of the shrinkage in one triangle (the classic diagonal crease). Fix: interpolate quantities divided by `w`, then divide back: with screen parameter `τ` interpolated between `x0/w0` and `x1/w1`, the true parameter is `λ = τ·w0 / ((1−τ)·w1 + τ·w0)`; "modern graphics hardware does this for you" *when the vertices carry a real w*. Source: https://www.cs.ucdavis.edu/~amenta/s12/perspectiveCorrect.pdf.

OpenGL's projective texturing: texture coordinates are `(s, t, r, q)`; "The q coordinate is analogous to the w component in the vertex coordinates"; lookup uses `s/q, t/q` ("the division becomes a division by q/w"). Sources: https://www.opengl.org/archives/resources/code/samples/advanced/advanced97/notes/node33.html ; OpenGL Programming Guide (https://opengl.org.ru/docs/pg/0908.html).

**Recipe for a 2-D corner-pin quad in WebGL2 [derived, standard].** Let `H` map unit-square texture coords `(u,v)` to output quad corners `p_i`. For each corner compute `t_i = H⁻¹ · (p_i.x, p_i.y, 1)ᵀ` (a 3-vector; `t_i = (u_i·w_i, v_i·w_i, w_i)` with `w_i` its third component). Pass `t_i` as a `vec3` varying and in the fragment shader sample `texture(tex, t.xy / t.z)` (or `textureProj`). Because the quad is drawn flat in 2-D, `t` is affine over the quad, so linear interpolation of `t` is exact; the per-fragment divide reproduces the homography. Equivalent alternative: emit `gl_Position = vec4(p_i.xy · w_i, 0, w_i)` with plain `(u_i, v_i)` texcoords and let hardware perspective interpolation do it (Khronos forum: the quad looks right only if the vertex `w` is adjusted too — https://community.khronos.org/t/texture-q-coordinate-nvidia/41478). **Do not** merely interpolate `vec2 uv` across two triangles.

### 1.3 Keystone vs full corner pin

Wikipedia gives the 2-D small-angle keystone magnification `cos(ε − α/2) / cos(ε + α/2)`, with ε the angle between screen axis and central ray and α the angular width; digital keystone "skew[s] the output image", reducing used pixels and resolution; lens shift avoids it. Source: https://en.wikipedia.org/wiki/Keystone_effect.

Bimber & Raskar (SAR, §5.1) formalize it: an oblique projector produces a keystoned quadrilateral; the two images of any point on the screen plane (user-view image `m_T` and projector pixel `m_P`) "are related by a homography induced by the plane of the screen": `m_P ≅ A₃ₓ₃ m_T`, `A = [a11 a12 a13; a21 a22 a23; a31 a32 1]`, computed from ≥ 4 projector pixels whose 3-D screen positions are known. Rendering: the projection matrix becomes the product of an off-axis frustum `P_T` and the homography `A` — single pass, no texture resampling. Keystone correction is therefore the special case of corner-pin where the homography is constrained to those generated by rotating a pinhole projector (2 DOF pitch/yaw, plus zoom/shift) **[derived]**; a free 8-DOF corner pin also absorbs small lens-shift and non-square-pixel effects. Source: SAR book PDF https://pages.cs.wisc.edu/~dyer/cs534/papers/SAR.pdf (local `SAR.j.txt` ≈ offsets 211971–220000).

### 1.4 Mesh warping: Bézier, Catmull–Rom, thin-plate spline

**Bézier surface** of degree (n,m): `p(u,v) = Σ_{i=0}^{n} Σ_{j=0}^{m} B_i^n(u) B_j^m(v) k_{i,j}`, `B_i^n(u) = C(n,i) u^i (1−u)^{n−i}`. Corners interpolate four control points; the surface lies in the control-point convex hull; "a Bézier surface does not generally pass through its other control points"; bicubic = 16 control points. Source: https://en.wikipedia.org/wiki/B%C3%A9zier_surface. (Bézier patches do not interpolate interior handles — bad for direct user dragging of grid points; good as a smooth low-DOF global warp.)

**Catmull–Rom (interpolating).** Knots `t_{i+1} = |P_{i+1} − P_i|^α + t_i`, `t0 = 0`; α = 0 uniform, 0.5 centripetal, 1 chordal. Barry–Goldman evaluation for the segment P1→P2:

```
A1 = (t1−t)/(t1−t0)·P0 + (t−t0)/(t1−t0)·P1
A2 = (t2−t)/(t2−t1)·P1 + (t−t1)/(t2−t1)·P2
A3 = (t3−t)/(t3−t2)·P2 + (t−t2)/(t3−t2)·P3
B1 = (t2−t)/(t2−t0)·A1 + (t−t0)/(t2−t0)·A2
B2 = (t3−t)/(t3−t1)·A2 + (t−t1)/(t3−t1)·A3
C  = (t2−t)/(t2−t1)·B1 + (t−t1)/(t2−t1)·B2
```

Centripetal (α = 0.5): "loops and self-intersections do not occur within a curve segment", "cusps will never occur". Source: https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline. For a warp grid, apply tensor-product Catmull–Rom (rows then columns) on the grid of displaced control points; use centripetal when users drag points far (uniform Catmull–Rom can overshoot/loop) **[standard practice, unverified]**. The common uniform-matrix form (`0.5·[−1 3 −3 1; 2 −5 4 −1; −1 0 1 0; 0 2 0 0]`) is not on that page **[unverified]**.

**Thin-plate spline.** Kernel `φ(r) = r² log r`; mapping `f(x) = Σ_i w_i φ(‖x − c_i‖)` decomposed into "a global affine and a local non-affine component" (`f_tps(z) = z·d + φ(z)·c`); bending energy `∬ (f_xx² + 2 f_xy² + f_yy²) dx dy`; regularized form `E = ‖Y − Xd − Φc‖² + λ cᵀΦc`, λ "control[s] the rigidity of the deformation". Source: https://en.wikipedia.org/wiki/Thin_plate_spline. The classic closed-form solve (Bookstein 1989) is the linear system `[K P; Pᵀ 0][w; a] = [v; 0]` with `K_ij = φ(‖c_i − c_j‖)`, `P = [1 x_i y_i]` **[unverified, standard]**. TPS is the right tool for scattered calibration points (camera-measured dots) rather than a regular grid.

### 1.5 Per-pixel warp maps / UV lookup textures; Bourke's `.data` mesh

**Paul Bourke warp mesh format** (https://paulbourke.net/dataformats/meshwarp/): line 1 mesh type ("rectangular (2) and polar (1)" — they differ only in continuity across 0/360° for polar); line 2 `nx ny`; then `nx·ny` node lines of 5 values: `x y u v i`. `x,y` are "OpenGL style normalised coordinates" (for 4:3, x ∈ ±aspect, y ∈ ±1); `u,v` ∈ [0,1] index the input image and "Values outside the 0 to 1 range indicate that the node is not to be used"; `i` is "a multiplier applied to each r,g,b value", normally 0–1, negative = don't draw; it serves "for simple edge blending" and brightness compensation. Binary variant: header as 2-byte unsigned ints (the mesh type doubles as an endianness check), nodes as 4-byte floats. Render: one `GL_QUADS` cell per grid cell, `glColor3f(i,i,i)`, `glTexCoord2f(u,v)`, `glVertex3f(x,y,0)`, orthographic camera; skip cells with a negative-intensity corner; nodes need not be regular — "rectangular and polar describe topology and connectivity only". Offline prewarp = for each output pixel find the containing cell and bilinearly interpolate `(u,v)`; supersample for quality. Limitation Bourke notes: a single `i` cannot do per-channel gamma-corrected blending (needs r,g,b factors). The Blender/Vuo docs agree on the layout (https://docs.blender.org/manual/en/2.79/_sources/game_engine/camera/dome.rst.txt ; https://doc.vuo.org/0.9.0/vuo.image/vuo.image.project.dome.html).

**UV lookup texture [derived from the above].** The GPU-native equivalent of a `.data` mesh is a float texture at output resolution storing `(u, v, blend)` (RG32F/RGBA32F); fragment shader: `vec3 m = texture(map, gl_FragCoord.xy/res).xyz; color = texture(content, m.xy) * m.z;` Generate it once from any mesh/spline/calibration (this *is* the inverse mapping, §1.6). Vendor formats: VIOSO's WarpBlend API maps the image "using the 3D-coordinates of the actual screen for every projector pixel" (per-pixel 3-D warp), with "soft-edge gradients and black-out masks" (https://docs.vioso.com/vioso-warpblend-api — exact file layout not published there). NVIDIA Quadro NvAPI warp (`NvAPI_GPU_SetScanoutWarping`) takes a triangle-strip mesh with per-vertex `x,y,u,v,r,q` (`NV_GPU_WARPING_VERTICE_FORMAT_TRIANGLESTRIP_XYUVRQ`), where `r,q` give perspective mapping and "could be calculated by solving the 2D homography" (forum-level, **unverified** — https://forums.developer.nvidia.com/t/warping-with-perspective-mapping/64561), plus a separate intensity (blend) texture applied at scanout, "before pixels are scanned out" (https://github.com/errollw/Warp-and-Blend-Quadros). Scalable Display's export formats were not documented in anything I could fetch.

### 1.6 Inverse vs forward mapping

Forward mapping (push each source pixel to its destination) leaves holes and many-to-one collisions; inverse mapping (for each destination pixel, look up the source position and resample) visits every output pixel, needs interpolation and the backward map, "may oversample but is much simpler". Sources: Princeton COS426 notes https://www.cs.princeton.edu/courses/archive/spr17/cos426/notes/cos426_s17_lecture03_warping.pdf ; MIT comp-photo https://people.csail.mit.edu/fredo/comp-photo-book/06-warping-and-morphing-01-warping-and-resampling.html. OpenCV `remap`/`initUndistortRectifyMap` are inverse maps: "for each pixel (u,v) in the destination ... the function computes the corresponding coordinates in the source image". Bourke: "The usual approach for such image transformations is to perform the inverse mapping", supersample 2×2 or 3×3 (3×3 is 9× slower) — https://paulbourke.net/dome/fish2/. GPU texture lookup in a fragment shader is inherently inverse mapping; a vertex-displaced mesh is forward mapping of vertices with the rasterizer filling in (no holes because the mesh is connected — but folded cells overlap). Pitfall: minification aliasing in strongly compressed regions (dome edges) → use mipmaps/anisotropic filtering or supersample.

---

## 2. Camera–projector calibration

### 2.1 Camera model and distortion (OpenCV, exact)

```
s·p = A [R|t] P_w ,   A = [f_x 0 c_x; 0 f_y c_y; 0 0 1]
x' = X_c/Z_c, y' = Y_c/Z_c, r² = x'² + y'²
x'' = x'·(1 + k1 r² + k2 r⁴ + k3 r⁶)/(1 + k4 r² + k5 r⁴ + k6 r⁶) + 2 p1 x'y' + p2 (r² + 2x'²) + s1 r² + s2 r⁴
y'' = y'·(1 + k1 r² + k2 r⁴ + k3 r⁶)/(1 + k4 r² + k5 r⁴ + k6 r⁶) + p1 (r² + 2y'²) + 2 p2 x'y' + s3 r² + s4 r⁴
u = f_x x'' + c_x ,  v = f_y y'' + c_y
```

Coefficient vector order `(k1, k2, p1, p2[, k3[, k4, k5, k6[, s1..s4[, τx, τy]]]])`. Distortion coefficients are resolution-independent; `f_x, f_y, c_x, c_y` scale with the image. "Radial distortion is always monotonic for real lenses, and if the estimator produces a non-monotonic result, this should be considered a calibration failure." `calibrateCamera` steps: (1) initial intrinsics (planar patterns only) or from input; distortion zeros; (2) initial pose per view via `solvePnP`; (3) "global Levenberg-Marquardt optimization ... to minimize the reprojection error" (sum of squared distances); returns RMS. `solvePnP` flags: `SOLVEPNP_ITERATIVE` (default), `P3P`/`AP3P` (exactly 4 points), `IPPE` (≥4 coplanar), `IPPE_SQUARE` (4-point marker), `EPNP`, etc.; needs ≥ 4 points. Source: local `opencv_calib3d.txt` (https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html).

### 2.2 Zhang's method (what `calibrateCamera` does internally)

From Zhang, MSR-TR-98-71 (https://www-users.cse.umn.edu/~hspark/CSci5980/zhang.pdf): with model plane `Z = 0`, each view gives homography `H = [h1 h2 h3] = λ A [r1 r2 t]`. Orthonormality of `r1, r2` yields two constraints per view:

```
h1ᵀ A⁻ᵀ A⁻¹ h2 = 0            (3)
h1ᵀ A⁻ᵀ A⁻¹ h1 = h2ᵀ A⁻ᵀ A⁻¹ h2   (4)
```

"A⁻ᵀA⁻¹ actually describes the image of the absolute conic". Let `B = A⁻ᵀA⁻¹` (symmetric, 6-vector `b = [B11 B12 B22 B13 B23 B33]ᵀ`); then `h_iᵀ B h_j = v_ijᵀ b` with

```
v_ij = [h_i1 h_j1, h_i1 h_j2 + h_i2 h_j1, h_i2 h_j2, h_i3 h_j1 + h_i1 h_j3, h_i3 h_j2 + h_i2 h_j3, h_i3 h_j3]ᵀ
```

so each view contributes `[v_12ᵀ; (v_11 − v_22)ᵀ] b = 0`; stack n views into `V b = 0` (2n×6); n ≥ 3 gives a unique `b` up to scale (n = 2 with skew γ = 0 constraint); solve as the eigenvector of `VᵀV` for the smallest eigenvalue; recover `A` from `B` (Appendix B). Extrinsics: `r1 = λ A⁻¹ h1`, `r2 = λ A⁻¹ h2`, `r3 = r1 × r2`, `t = λ A⁻¹ h3`, `λ = 1/‖A⁻¹h1‖`; orthonormalize R (Appendix C). Refine by maximum likelihood: minimize `Σ_i Σ_j ‖m_ij − m̂(A, R_i, t_i, M_j)‖²` with Levenberg–Marquardt (rotation as Rodrigues vector). Radial distortion `x̆ = x + x[k1 r² + k2 r⁴]`, estimated by alternation with linear least squares `k = (DᵀD)⁻¹Dᵀd`, then full joint refinement. Planar pattern viewed in ≥ 2 (practically ≥ 3, better 10+) orientations; motion need not be known.

**Projector as inverse camera.** The same model and solver apply to a projector if you can supply, for each view, projector-pixel coordinates of known world points. Everything hinges on obtaining camera→projector pixel correspondences, which is what structured light provides.

### 2.3 Gray-code structured light

OpenCV `cv::structured_light::GrayCodePattern` (based on 3DUNDERWORLD): for a projector of `(P_res_x, P_res_y)`, `Ncols = log2(P_res_x)` column patterns and `Nrows = log2(P_res_y)` row patterns, each with a colour-inverted twin, total `Ncols·2 + Nrows·2` (40 for 1024×768); plus all-white/all-black images for shadow masks (`getImagesForShadowMasks`); `whiteThreshold` = minimum brightness difference between a pattern and its inverse for a valid pixel; `blackThreshold` for shadow regions; `getProjPixel(patternImages, x, y, projPix)` decodes one camera pixel to a projector pixel. `SinusoidalPattern` implements FTP, PSP and FAPS (`computePhaseMap`, `unwrapPhaseMap`, `findProCamMatches`). Sources: https://docs.opencv.org/4.x/d1/dec/classcv_1_1structured__light_1_1GrayCodePattern.html ; https://docs.opencv.org/4.x/d6/d96/classcv_1_1structured__light_1_1SinusoidalPattern.html ; module overview https://docs.opencv.org/4.0.0/d1/d90/group__structured__light.html.

3DUNDERWORLD (Herakleous & Poullis, https://arxiv.org/pdf/1406.6595): "it is preferable to project a pattern followed by a projection of its color-inverted pattern ... The threshold for the intensity value of a pixel p with a highest value p_h and a lowest value p_l can then be computed as the average (p_h + p_l)/2"; shadow pixels are found from the white and black images.

RoomAlive Toolkit's actual decoder (`GrayCode.cs`, https://github.com/microsoft/RoomAliveToolkit): code `grayCode = x ^ (x >> 1)`; per bit `valid = |captured − inverted| > 10`, `bit = captured >= inverted`; the mask stops being tightened at the least-significant levels while decoding continues; comment: "this value is tricky to set given AGC". Capture pipeline (`ProjectorCameraEnsemble.cs`): mid-grey warm-up 1500 ms for camera auto-gain, 500 ms settle per pattern, 100 depth frames averaged, depth variance ≤ 36 kept, points mapped to colour camera, looked up in decoded maps, pair kept if > 1000 correspondences; projector intrinsics initialised `fx = fy = 1000, cx = width/2, cy = 0` ("assumes desktop projection mode", i.e. lens offset — a good hint for any projector initial guess), intrinsics only refined when a non-planar subset exists (planarity test `d[2]/d[1] < 0.001` on 100-point subsets); RANSAC-style fits, inlier threshold 2.0 px, ≥ 500 inliers per view; global pose unification `T_PkW = T_CjW · inverse(T_CjPk)`; final LM over 6 params per camera and per projector minimizing `projectorPoint − Project(K, dist, T_WPk · T_CjW · x)`.

**Gray→binary decode [derived, standard]**: `b = g; for (i = 1; i < nbits; i++) b ^= (g >> i);` or iteratively `b_k = g_k XOR b_{k+1}` from MSB. Projector coordinate = decoded index (watch for mirrored axes — RoomAlive uses `width − decodedColumns`).

**Pitfalls:** camera auto-exposure/gain and white balance must be locked; projector and camera gamma don't matter for Gray code (only sign of difference matters) but do for phase shift; LSB patterns (1–2 px stripes) blur out — most toolkits stop at stripe widths of ~4–8 px and accept that resolution, or complement with phase shift; indirect/interreflected light corrupts bits on concave surfaces (Moreno–Taubin's motivation, §2.5).

### 2.4 Phase-shift structured light

Three-step PSP (from the temporal-phase-unwrapping review, https://ar5iv.labs.arxiv.org/html/1903.09836): projected `I^p_n(x^p,y^p) = 0.5 + 0.5 cos(2π f x^p − 2πn/3)`; captured `I^c_n(x,y) = A(x,y) + B(x,y) cos(Φ(x,y) − 2πn/3)`, n = 0,1,2 (A = average intensity, B = modulation); wrapped phase

```
φ(x,y) = tan⁻¹[ √3 (I¹_c − I²_c) / (2 I⁰_c − I¹_c − I²_c) ]
```

absolute phase `Φ = φ + 2π k`, k = fringe order 0..N−1 (N = number of periods); unwrapping by a unit-frequency reference `k_h = Round[((f_h/f_l)Φ_l − φ_h)/2π]` (multi-frequency TPU reliably unwraps only ~16 periods), or by Gray code giving k directly (hybrid). General N-step form `φ = −atan2(Σ_n I_n sin(2πn/N), Σ_n I_n cos(2πn/N))` **[unverified, standard]**. Projector x-coordinate = `Φ / (2π f) · width` **[derived]**. Phase shift gives sub-pixel projector coordinates (Wikipedia: ~1/10 stripe pitch, https://en.wikipedia.org/wiki/Structured-light_3D_scanner) and is sensitive to projector gamma (sinusoid distortion) — linearize the projector or use more steps.

### 2.5 Moreno & Taubin 2012

"Simple, Accurate, and Robust Projector-Camera Calibration", 3DIMPVT 2012, pp. 464–471, DOI 10.1109/3DIMPVT.2012.77 (Crossref; 389 citations per Semantic Scholar; no open PDF; the Brown server mesh.brown.edu was unreachable during this session). Method, assembled from the authors' patent (US 2014/0078260, https://patents.google.com/patent/US20140078260A1/en) and papers that reuse it (https://arxiv.org/pdf/2102.11395):

1. Place a printed checkerboard; for each pose, capture the full Gray-code sequence (one later paper reports 46 patterns) with the projector.
2. Detect checkerboard corners in the camera image (sub-pixel).
3. Decode Gray codes robustly: the camera intensity is "the sum of the amount of light emitted by a projector pixel" (direct) plus a global component; "Decoding errors in gray sequences are mostly caused by failure on identifying these components" — pixels are classified ON/OFF/uncertain using direct/global estimates from high-frequency patterns (the exact `b`, `m` thresholds are in the paper, not verified here).
4. **Local homographies**: "Each local homography is estimated within a small neighborhood of the target corner" — "small image patches centered at the checkerboard corner coordinates ... (e.g. a 47×47 pixels square)" — from all decoded camera→projector correspondences in the patch; the corner is "converted from camera coordinates to projector coordinates" by applying it. This averages out decoding noise and gives sub-pixel projector corners without assuming a planar global homography (the patent: local homographies "allow modeling non-linear distortions" and "are robust to small decoding errors because they are over determined").
5. Camera: `calibrateCamera` on the camera corners; projector: "identical procedure as for the camera" using the projector corners; then `stereoCalibrate` on both sets to get `R, T` projector↔camera.

Code: https://github.com/... (projection-mapping.org notes software by Moreno & Taubin: https://projection-mapping.org/?p=1855). Practical lesson for Ben's "flashed dots + least squares" approach: it is Moreno–Taubin with a single global homography; upgrading to local homographies per feature (or TPS) handles lens distortion and non-flat surfaces.

### 2.6 Shader Lamps / Dynamic Shader Lamps and PnP alignment

Raskar, Welch, Low, Bandyopadhyay, "Shader Lamps" (EGWR 2001; https://web.media.mit.edu/~raskar/RaskarPapers/shaderlampsRaskar01.pdf; also SAR §5.5): calibration — "We take a set of fiducials with known three-dimensional locations on the physical object and find the corresponding projector pixels that illuminate them. This allows us to compute a 3×4 perspective projection matrix up to scale, which is decomposed to find the intrinsic and extrinsic parameters of the projector. The rendering process uses the same internal and external parameters". Steps: build 3-D model G of the object, position projector, find pose P, at run time render G with P (and user location for view-dependent effects), then intensity-correct (§6.2). Dynamic Shader Lamps (Bandyopadhyay, Raskar, Fuchs 2001) adds tracking of the moving object (MERL TR2001-50, https://www.merl.com/publications/docs/TR2001-50.pdf; not read in full).

**Modern equivalent [derived]**: with projector intrinsics known (from §2.5), use `cv::solvePnP(objectPoints3D, projectorPixels, K_proj, dist_proj)` — ≥ 4 non-coplanar-or-IPPE points; with ≥ 6 points and unknown intrinsics use the DLT for the 3×4 matrix as above (degenerate if all points are coplanar — SAR notes "the least-squares method is degenerate due to the depth-scale ambiguity of viewing planar points"). Then draw the 3-D model with `gl_Position = P_proj · M · vertex`, where `P_proj` is built from `K_proj` (OpenGL frustum from `f_x, f_y, c_x, c_y`, near/far) — see the SAR appendix for a re-implementation of `Frustum`/`Perspective`.

**Projector lens distortion pitfall [derived]**: a camera *undistorts* (inverse map); a projector must *pre-distort* content — apply the forward distortion polynomial to normalized projector coordinates when building the warp map, or fit the warp directly with a per-pixel map that absorbs distortion.

### 2.7 RoomAlive Toolkit summary

Jones et al., "RoomAlive", UIST 2014; toolkit https://github.com/Kinect/RoomAliveToolkit (MIT). Calibration uses Kinect depth to get metric 3-D points per camera pixel, Gray codes for projector pixels, OpenCV-like `CalibrateCamera` (own C# implementation with Math.NET) for projector intrinsics/extrinsics, RANSAC, then joint LM. The XML output's "camera matrix" is the projector's intrinsics; poses are relative to the first camera (vvvv forum observation, https://forum.vvvv.org/t/roomalive-toolkit/14029). Details in §2.3.

### 2.8 Older/other toolkits

Procamcalib (Falcão, Hurtós, Massich 2008, MATLAB plane-based projector calibration) — **not found/verified** in this session. YCAM ProCamToolkit (openFrameworks) exists: https://github.com/YCAMInterlab/ProCamToolkit. Raskar & Beardsley, "A Self-Correcting Projector", CVPR 2001 (tilt-sensor keystone) — bibliographic only.

---

## 3. Curved surfaces

### 3.1 Fisheye and equirectangular mappings (Bourke)

Angular (equidistant) fisheye (https://paulbourke.net/dome/fisheye/): normalise pixel to `(x,y) ∈ [−1,1]²`, `r = √(x²+y²)` (r > 1 → outside the circle), `φ = atan2(y,x)`, and "The angle theta is just r multiplied by half the intended fisheye angle": `θ = r · aperture/2` (aperture up to 360°). Direction vector **[derived]** `(sinθ cosφ, sinθ sinφ, cosθ)` with the optical axis along z. Inverse (unit vector → texture coords, quoted): `r = atan2(√(x²+y²), z)/π`, `φ = atan2(y,x)`, `u = r cos φ + 0.5`, `v = r sin φ + 0.5` (for 180° aperture).

Equirectangular ↔ fisheye shader code (https://paulbourke.net/dome/fish2/), with the fisheye looking down +y, z up:

```
theta = 2π (x/width − 0.5);  phi = π (y/height − 0.5)        // lon ∈ [−π,π], lat ∈ [−π/2,π/2]
psph = (cos(phi) sin(theta), cos(phi) cos(theta), sin(phi))
theta = atan(psph.z, psph.x);  phi = atan(sqrt(psph.x²+psph.z²), psph.y);  r = width · phi / FOV
pfish = (0.5 width + r cos(theta), 0.5 width + r sin(theta))
```

(`FOV` in radians, e.g. π for 180°; output "should have 2:1 aspect"). Other fisheye models supported by Bourke's tools: stereographic, equisolid, orthographic (formulas not on the fetched pages; standard forms `r = 2f tan(θ/2)`, `r = 2f sin(θ/2)`, `r = f sin θ` **[unverified]**).

**Dome master** (IMERSA, https://imersa.org/guidelines): "an equidistant azimuthal 'fisheye' render representing a 180 x 360 degree hemisphere", square frame, "Top and sides of polar image are tangent to edges of circular image frame", "bottom of the frame representing the front bottom of the dome screen", resolutions 1024…4096 "or greater", outside the circle black, 30 fps standard.

**Cubemap source [derived/standard]**: render 4–6 90° faces from the sphere centre; sample by direction vector (`samplerCube`); Bourke's real-time fisheye renders "4 faces of a cube" and applies them "as textures on a mesh with precisely specified texture coordinates" (Graphite 2005 paper).

### 3.2 Ray–sphere intersection (fragment shader)

Sphere `‖x − c‖² = r²`, ray `x = o + d û` (unit û):

```
∇ = [û·(o−c)]² − (‖o−c‖² − r²)
d = −[û·(o−c)] ± √∇      (∇<0 miss, =0 tangent, >0 two hits; nearest = smaller positive d)
```

Source: https://en.wikipedia.org/wiki/Line%E2%80%93sphere_intersection.

**Sphere/equirectangular projector mode [derived]**: for projector pixel `(u,v)`: `û = normalize(R_pᵀ · K_p⁻¹ (u,v,1)ᵀ)` (projector pose `R_p, t_p`, origin `o = −R_pᵀ t_p`); intersect the moon sphere; `n = (x − c)/r`; `lon = atan2(n.z, n.x)`, `lat = asin(n.y)` (choose axis convention to match the content); `uv_equi = (lon/2π + 0.5, lat/π + 0.5)`. Pixels with no hit → black (or edge blend fade). The three projectors share the same world sphere and content, so seams are consistent by construction; blend weights come from the surface (§4), not from each projector's frame.

### 3.3 Quadric transfer (Raskar et al.) — the parametric alternative

From SAR §5.4 (and iLamps 2003, https://www.merl.com/publications/docs/TR2003-23.pdf; Eurographics 2004 "Quadric Transfer for Immersive Curved Screen Displays", https://web.media.mit.edu/~raskar/CurvedScreen/raskarEurographics04CurvedScreen.pdf): a quadric `Q` (4×4 symmetric, `XᵀQX = 0`, 9 DOF). Pixels in two views are related by

```
x' ≅ B x − ( qᵀx ± √((qᵀx)² − xᵀ Q33 x) ) e ,     Q = [Q33 q; qᵀ d], d = 1 if the quadric doesn't pass through the first view's centre
```

(21 parameters, 4 dependent). Simplified form: `A = B − e qᵀ`, `E = q qᵀ − Q33`, giving

```
x' ≅ A x ± √(xᵀ E x) · e ,   normalization E(3,3) = 1
```

"The equation xᵀEx = 0 defines the outline conic of the quadric in the first view" (e.g. the elliptical silhouette of a sphere); `A` is the homography via the polar plane; the sign of the root is fixed inside the outline conic and determined from one correspondence. Needs ≥ 9 correspondences (vs 4 for a homography). Algorithm (iLamps): (a) camera–projector correspondences via structured light, (b) triangulate and fit the 3-D quadric, (c) compute `{A, E, e}`, (d) nonlinear refinement (Powell) of reprojection error, (e) pre-warp content: "map the input image as a texture onto a densely tessellated rectangular mesh, and compute the projection of each vertex of the mesh using the quadric transfer" in a vertex shader (Cg code in SAR Appendix A.2: `scale = mul(m2, mul(E,m2)); mp = mul(A,m2) + sqrt(scale)*e;`). Warning from iLamps: the purely projective linear method "produces very large reprojection errors, in the order of 20 or 30 pixels for XGA projectors" because points lit by one projector have little depth variation; "We instead use known internal parameters and estimated Euclidean rigid transformations" — i.e. calibrate intrinsics first. Blending in the quadric case (SAR §5.4.8): `x_k ≅ Ψ_0k(Ψ_0i⁻¹(x_i))`, weight `Φ_i(x_i) = d(x_i)/Σ_k d(x_k)` with `d(x) = min(u, v, 1−u, 1−v)` in normalized window coordinates (0 outside), computed "at subpixel registration accuracy. The sum of weights at corresponding projector pixels accurately adds to 1.0."

### 3.4 Projector/camera pose from a sphere's silhouette

Camera at the origin, normalized image coordinates `(u, v, 1)`, sphere centre `(x0, y0, z0)`, radius r. A ray `t(u,v,1)` is tangent when the quadratic `(u²+v²+1)t² − 2(u x0 + v y0 + z0) t + (x0²+y0²+z0² − r²) = 0` has zero discriminant, which rearranges to the silhouette conic `A u² + B uv + C v² + D u + E v + F = 0` with

```
A = r² − y0² − z0²,  B = 2 x0 y0,  C = r² − x0² − z0²,  D = 2 x0 z0,  E = 2 y0 z0,  F = r² − x0² − y0²
```

(Tóth & Kató et al., "Automatic Estimation of Sphere Centers from Images of Calibrated Cameras", https://arxiv.org/pdf/2002.10217, eqs. 4–6). Given `K` (so pixels → normalized coords), fit an ellipse (Fitzgibbon/Halir–Flusser with data normalization; a circle-fit RANSAC gives a fast initial guess since 3 points suffice), then solve the 4 unknowns `(x0,y0,z0,r)` or `(x0,y0,z0)` with known r from the 5 conic ratios (nonlinear least squares, or their closed-form cone-angle construction — they build the tangent cone with half-angle β and axis angle α from the ellipse axes). Caveat quoted elsewhere: the ellipse centre is *not* exactly the projection of the sphere centre (error of a few pixels) — fine as an initialization. **[derived]** Relation to quadric transfer: `xᵀEx = 0` is the same conic, so `E` for a sphere is `C_conic` up to scale. For a *projector*, the silhouette can be observed only indirectly: project a dense pattern and find, in the camera, which projector pixels hit the sphere; the boundary of that set in projector pixel space is the projector's silhouette conic, and the formulas above then give the projector's position relative to the sphere (needs projector intrinsics).

### 3.5 Spherical-mirror dome projection (Bourke)

Graphite 2005 paper (https://paulbourke.net/papers/graphite2005/graphite.pdf): reduce the 3-D problem to the plane containing projector `P1`, mirror centre (origin, radius r) and dome point `P2`; path lengths `L1² = (P1x − r cos β)² + (r sin β)²`, `L2² = (P2x − r cos β)² + (P2z − r sin β)²`; the reflection point is the β that "minimises (L1² + L2²)^{1/2}" — i.e. Fermat's principle instead of explicit reflection; the mesh node stores `(x,y)` frustum coords, `(u,v)` fisheye texture coords and an intensity "for compensating for the brightness variation due to the range of light path lengths, to softly fade the image towards the back of the dome, and if stored as separate RGB correction ... gamma corrected edge blending". Focus varies with path length — "choosing projectors with a good depth of focus". Single-mirror vs fisheye trade-offs listed in the paper (hardware out of the dome centre, no chromatic rim aberration, full use of projector pixels but "not all pixels are used equally efficiently").

### 3.6 Multi-projector domes and spheres (Bourke)

Three-projector dome (https://paulbourke.net/dome/3projdome/): each projector covers a 120° wedge, blends at wedge seams and a three-way zone at the zenith; 0.8:1 throw, 4:3 example; mesh derived by "a regular polar grid in fisheye space, then, for each grid point, form the vector to the corresponding dome position and find where that vector intersects the projection plane" (chosen because it makes blend derivation easy); nodes store position, fisheye `(u,v)` and gamma-corrected r,g,b blend factors. Spherical (outward) display, "isphere" (https://paulbourke.net/dome/isphere/): a virtual camera per projector "with identical frustums"; masks "derived by calculating the warped version of a spherical projection with vertical edge-blend zones at +-45 degree intervals", "The image projected is multiplied by this mask", gamma handled per channel; 16:9 projectors suit spherical warping better than 4:3 (with 6 projectors the advantage swings back). Workflow (2016 slides): dice → geometry correction → edge-blend masks.

---

## 4. Edge blending and photometric calibration

### 4.1 Blend ramp formulas

Bourke (https://paulbourke.net/miscellaneous/edgeblend/), x ∈ [0,1] across the overlap, left image × (1 − f(x)), right image × f(x):

```
f(x) = 0.5 (2x)^p                 0 ≤ x ≤ 0.5
f(x) = 1 − 0.5 (2(1−x))^p         0.5 ≤ x ≤ 1
```

with centre-brightness variant `a (2x)^p` / `1 − (1−a)(2(1−x))^p` (a > 0.5 brightens the seam centre). p = 1 is linear and "tends to result in a visible step at the edges of the blending region"; he uses p = 2. Gamma: "What really needs to be done is to add brightness levels" — displays follow roughly `brightness = pixel^G`, G ≈ 1.8–2.2, so the applied factor is `f(x)^{1/G}` and `f(1−x)^{1/G}`, "applied to each r,g,b value because of variations in the projectors used"; without it "a grey band appears". Overlap: 256 px for XGA (128 "noticeably worse"). Other industry curves: raised cosine (`0.5 − 0.5 cos(πx)`) — Scalable Display: "gamma-corrected curves ... typically following a raised cosine or similar function"; "A linear ramp produces a visible gradient that the human eye detects even when brightness levels are technically correct" (https://www.scalabledisplay.com/blending-software/). WATCHOUT exposes a soft-edge "Gamma Correction slider (range 0.5–1.5, default 1.0)": too low → "a dark band at the blend center", too high → "a bright band"; overlaps "of 10–20% of the projector's output width are common", below 5% "much harder" (https://docs.dataton.com/watchout-7-new/watchout/displays-and-outputs/edge-blending.html). Immersaview writes the ramp as `output = input^γ`, i.e. the opposite exponent convention — always check which side γ sits on (https://immersaview.com/resources/edge-blending).

**Why blending must be done in linear light [derived from Bourke's argument].** If projector output is `L = v^γ` and two projectors with weights `w₁ + w₂ = 1` must sum to the unblended luminance `L`, then the pixel values must be `v_i = (w_i · L)^{1/γ} = w_i^{1/γ} · v`. Multiplying the *gamma-encoded* pixel by `w_i` instead yields `L_i = w_i^γ L`, summing to `(w₁^γ + w₂^γ) L < L` — the dark band. In a shader: either work on linearized content (`pow(c, γ)`), blend, re-encode (`pow(·, 1/γ)`), or equivalently multiply encoded colour by `pow(w, 1/γ)`. Use the *measured* per-channel γ of each projector, not 2.2.

### 4.2 Camera-based automatic blending (Raskar 1999 / SAR §5.3)

Guidelines: "The sum of the intensity weights of the corresponding projector pixels is 1" and weights "change smoothly in and near overlaps" (Shader Lamps adds: weights within each framebuffer are smooth so calibration errors don't produce sharp edges). Alpha mask per projector, "additionally modified through a gamma look-up table to correct for projector non-linearities". Computed in the *camera* image: form the convex hull `H_i` of each projector's observed pixels; for projector m's pixel (u,v),

```
A_m(u,v) = α_m(m,u,v) / Σ_i α_i(m,u,v),   α_i = w_i · d_i
```

`w_i = 1` if the observed pixel lies inside `H_i` else 0; `d_i` = distance to the nearest edge of `H_i`. The camera-space mask is then transformed into projector space with the same two-pass warp and rendered as a textured rectangle with transparency in the last pass. Shader Lamps' refinement for 3-D objects: assign weight 1 to pixels lit by a single projector, then weight ∝ 1/(shortest distance to a weight-1 pixel) *not crossing depth discontinuities*; surfaces at |θ_P| > 60° are treated as not lit (1/cos ranges 2→∞). Sources: SAR §5.3/§5.5 (SAR.pdf), Shader Lamps §4.3.

### 4.3 Black-level (black offset) compensation

Projectors emit light at black; in an overlap "both projectors contribute their black level simultaneously", producing "a grey band running between projectors"; correction "raises the black level of non-overlapping areas to match the elevated black floor of the overlap zone" (Scalable Display); Resolume and Dexon describe the same; Fulldome article: multi-projector domes need low black levels or "a gray haze" results. Bourke: black level is "A major limiting factor to how well the blending can be made invisible" (quotes 1500–3500:1 contrast). **[derived]** Model: black luminance `b_i` per projector; in a region lit by set S the floor is `Σ_{i∈S} b_i`; to flatten, add to each projector in region R an offset so that total black = `max_R Σ b_i` (e.g. with two equal projectors, raise single-coverage areas by one `b`); the offset must be added in *linear* light and then encoded (`v = ((b_target − b_own)/L_max)^{1/γ}` added before gamma... i.e. compute in luminance, convert once). Cost: global contrast drops to the overlap's black. Blend ramps cannot fix black level (WATCHOUT: "Even a perfect blend gradient cannot hide mismatched black levels").

### 4.4 Projector gamma measurement and luminance surfaces

Majumder's framework (dissertation, UNC 2003, https://sreal.ucf.edu/wp-content/uploads/2018/02/dissertation_majumder.pdf; TOG 2005 "Perceptual photometric seamlessness in projection-based tiled displays", ACM TOG 24(1):118–139, DOI 10.1145/1037957.1037964; TVCG 10(2):177–188, 2004 "Color nonuniformity in projection-based displays: analysis and solutions"): the display's luminance for channel l at display coordinate (u,v) with input i is modelled as `h_l(i_l) · W_l(u,v) + B_l(u,v)` — `h_l` the projector's (monotone) input transfer function, `W_l` the maximum luminance surface, `B_l` the black luminance surface. Measurement: a photometer for `h_l` (per channel), a camera (geometrically registered to the display) for `W_l` and `B_l` — "we need only four pictures" per channel for the max surface after geometric calibration; luminance surfaces of a single projector are themselves non-flat (centre bright, edges dark) and overlaps are the bright regions.

### 4.5 Perceptual photometric seamlessness (the key result)

Absolute uniformity (`E'(u1,v1) = E'(u2,v2)`) forces every pixel to the worst pixel → "compression in contrast". Perceptual uniformity: `|E'(u1,v1,i,e) − E'(u2,v2,i,e)| ≤ Δ` (6.2), Δ a threshold depending on distance, viewing angle, perception and task. Humans "are most sensitive to significant luminance discontinuities and insensitive to smooth changes", and "at least an order of magnitude more sensitive to variations in luminance than in chrominance" — hence correct luminance first. Optimization for the modified max surface `W'_l`:

```
Capability:            W'_l ≤ W_l                                   (7.10)
Perceptual uniformity: |∂W'_l/∂x| ≤ (1/λ) · W'_l   for any direction x   (7.11)
Objective:             minimize  W_l − W'_l   (i.e. maximize Σ_u Σ_v w'[u][v])
```

λ is the "smoothing parameter" (results shown for λ = 400 and 800; larger = smoother, dimmer). Discretized constraint for each of the 8 neighbours: `|w'[u][v] − w'[u'][v']| / √(|u−u'|² + |v−v'|²) ≤ (1/λ) w'[u][v]` — all linear, so solved by linear programming, or by their iterative "knot/free point" raising algorithm (dissertation §7.2.3). Black surface approximated by `B'(u,v) = max B(u,v)`. The **luminance attenuation map (LAM)** is then `W'_l(u,v)/W_l(u,v)`, transformed into each projector's pixel space and applied per pixel through the inverse transfer function `h_l⁻¹` (reprojection "in real time using commodity graphics hardware"). Earlier LAM paper: Majumder & Stevens, "LAM: luminance attenuation map for photometric uniformity in projection based displays", VRST 2002; patent US 7,038,727. Caution: a Lambertian screen is assumed; off-axis viewing re-exposes seams on non-Lambertian screens (their Fig. 8.10).

### 4.6 Colour (chrominance) matching

Practice: match white point per projector (WATCHOUT per-display R,G,B white-point sliders); Scalable: "measure and correct color output across the full array, not just in overlap zones"; same-model projectors differ and drift with age. Research: gamut-morphing in overlaps plus brightness smoothing (Majumder et al. patent US 9,052,584); Disney "Seamless Multi-Projection Revisited" (TVCG 2018, https://la.disneyresearch.com/wp-content/uploads/color_uniformity_2.pdf) — not read. Minimal implementable version **[derived]**: per projector, measure RGB primaries/white with a camera or colorimeter, compute a 3×3 matrix to a common target gamut (intersection), apply in linear light before gamma encoding, after the blend weights.

---

## 5. Multi-projector geometric registration

### 5.1 Planar screens, one camera (Raskar 1999 / Sukthankar / SAR §5.1)

Each projector k displays features; camera sees them → projector-to-camera homography `P_k`; camera-to-screen homography from 4 known screen points → `H_R1`; projector-to-reference `P_Rk = H_R1 · P_k`; pre-warp each projector's framebuffer by `P_Rk⁻¹` (Chen 2002: "This distortion is removed by pre-warping each projector k's output by P_Rk⁻¹"). The global frame ("world UV") is the display surface's own rectangle, not the camera (Chen fn. 3: `H_R1` "ensures that the global frame axes are aligned with the display surface rather than the root camera view"). Rendering: texture-mapped quad (two-pass) or SAR's single-pass modified projection matrix.

### 5.2 Camera homography trees (Chen, Sukthankar, Wallace, Li, IEEE Vis 2002)

https://ics.uci.edu/~majumder/docs/hanchen.pdf — for walls too big for one camera view. Camera Homography Graph: vertices = camera views, edge = directly computable homography (views sharing ≥ 1 projector). Chaining along any path gives a view-to-root homography `H_Rj = H_R1 · C_1i · … · C_ij`; loops in a real graph are inconsistent, so choose a spanning **tree** rooted near the centre ("fishbone" along the long axis to minimise path lengths); initialise each edge from shared features (20 line-intersection features per projector, 40 per adjacent-view pair); then iteratively refine bottom-up: removing edge e splits the tree into two subtrees, map *all* features of each subtree into the two end views and recompute e from the enlarged set; iterate until feature variance in the root view is below threshold. Sub-pixel features: project horizontal then vertical line sets, fit quadratics in 9×1/1×9 windows, fit lines jointly with a 5-parameter lens-distortion model (k1,k2,k3,p1,p2) by nonlinear optimization, intersect. Metrics: local error (displacement between the same point from adjacent projectors, in projected-pixel units) and global error (nonlinearity of a grid). Result: 0.55 px local error on a 24-projector (6×4) wall in < 9 min; simulations show sub-pixel accuracy to hundreds of projectors. Pitfalls they list: single-camera methods degrade as the wall grows (camera pixel ≫ projector pixel); naive chaining accumulates error.

### 5.3 Non-planar screens (SAR §5.2–5.3)

Stereo camera pair calibrated with a 3-D target (3×4 matrices from ≥ 6 points); the projector binary-codes its pixels ("n stereo correspondences in log₂(n) frames") → triangulated 3-D point cloud → Delaunay mesh in projector image space; projector matrix from the 3-D↔2-D correspondences (degenerate if the surface is planar — add temporary objects); for multiple projectors "re-register the display surface definitions and projector parameters for the entire system to a common world coordinate space"; render two-pass (user-view image → textured mesh seen through the projector's matrix); alpha masks per §4.2. Consistent global parametrization = the shared 3-D surface mesh in world coordinates; content is defined on it (for a sphere: lon/lat), each projector only warps.

### 5.4 Curved parametric screens

Quadric transfer (§3.3) replaces the mesh with 9 parameters per projector pair; per-pixel correspondences `x_k = Ψ_0k(Ψ_0i⁻¹(x_i))` give exact overlap regions and weights summing to 1.

---

## 6. Content and optics math

- **Throw ratio** `TR = D / W` (distance ÷ image width); `D = TR × W`; e.g. 30 ft throw, 15 ft wide → 2.0 (https://www.4wall.com/help/help-projector-throw-ratio-calculator-n-127). Width, not diagonal: a 100″ 16:9 image is 87.2″ wide; a 1.2:1 lens needs ≈ 104.6″ (https://www.rtings.com/projector/learn/throw-distance-calculator). Lens ratios vary by manufacturer; read the lens spec; zoom lenses have a TR range.
- **Pixel size on the surface [derived]**: `pixel pitch = W / N_x = D / (TR · N_x)`. Example, 3 m wide image: 1080p → 1.56 mm; 4K UHD (3840) → 0.78 mm. On a curved object the local pitch grows as `1/cos θ` along the incidence direction and with `d²`-spread (see falloff).
- **Lens shift**: Sony defines 0% as the lens-centre normal hitting the image centre, full image height/width = 100% (https://helpguide.sony.net/vpl/xw5000/v1/en/contents/TP1000558303.html); Norxe treats 50% as centred: `offset = H × (shift% − 50)/100` (1.2 m screen, 68% → 0.216 m) (https://storage.mixwave.co.jp/files/pro_video/norxe/product-support-norxe-lens-shift-explained.pdf). Conventions differ — check the datasheet. Lens shift is an off-axis frustum (`glFrustum` with asymmetric l,r,b,t), not a rotation; modelled by the principal point `c_x, c_y` in K (RoomAlive's `cy = 0` initial guess is exactly a 100%-shifted desktop projector).
- **Keystone from off-axis placement**: `cos(ε − α/2)/cos(ε + α/2)` (Wikipedia); the full effect is the homography of §1.3. A camera-forum formula `tan(keystone) = tan(image angle) × tan(tilt)` is informal **[unverified]**.
- **Illuminance / brightness falloff**: inverse square `I = P/(4πr²)` (https://en.wikipedia.org/wiki/Inverse-square_law); Lambert's cosine law `I = I₀ cos θ` and irradiance "proportional to the cosine of the angle between the illuminating source and the normal" (https://en.wikipedia.org/wiki/Lambert%27s_cosine_law). Shader Lamps combines them: radiance from the projector at a diffuse surface point `L(x,θ,φ) = g(x,θ,φ) · k_u(x) · I_p(x,θ_p,φ_p) · cos(θ_p) / d(x)²` (eq. 3), so the required projector intensity is `I_p = L · d(x)² / (k_u(x) cos(θ_p))` for `k_u > 0` (eq. 4); implemented by lighting a white copy of the model from the projector position "with black fog for squared distance attenuation"; don't illuminate beyond 60° incidence. For an inflatable moon lit from three sides this is the per-pixel attenuation that equalizes brightness between the sphere's centre and limb **[application note]**.
- **Screen gain**: ratio of reflected luminance to a reference diffuser (magnesium carbonate/titanium dioxide/barium sulfate), measured on-axis; higher gain → narrower viewing angle and hot-spotting ("an enlarged (and greatly blurred) reflection of the projector's lens") (https://en.wikipedia.org/wiki/Projection_screen). Image luminance rule of thumb: `ftL = (lumens / screen area in ft²) × gain` (vendor sources, e.g. https://www.projectorscreen.com/blogs/news/what-are-foot-lamberts-and-why-do-i-care). Inflatables and painted props are not unity-gain Lambertian: measure.
- **Ambient contrast** (textbook appendix, single source): `C = [L_a + p·L_amb] / [L_b + p·L_amb]`, `p = 1.0` front / 0.2 rear projection, `L_amb` ambient in foot-candles (https://www.oreilly.com/library/view/media-design-and/9781315442709/19-9781315442709_AppendixB.xhtml). SMPTE cinema reference ≈ 16 ftL dark room (reported by https://www.avnetwork.com/avnetwork/understanding-image-luminance).
- **Depth of field / focus on curved surfaces**: the whole surface must lie within the lens's depth of focus `FR` (about ±FR/2 around the focal distance — patent language); Bourke: variable focus "is not a major problem if a projector and lens combination is chosen with a good depth of focus, and the front/centre of the image is projected with the region of sharpest focus"; BenQ notes DOF as the key spec for dome sims. Longer throw (higher TR) at the same image size gives more depth of focus **[unverified rule of thumb]**; the f-number formula was not found.
- **Resolution vs viewing distance**: pixels per degree `ppd ≈ π / (360 · arctan(0.5 · W / (N_x · D_view)))`; 20/20 acuity = 1 arcmin ≈ 60 ppd, 20/10 = 120 ppd (https://arxiv.org/pdf/2410.06068). Equivalent: required PPI ≈ 6878 / viewing distance in inches for 60 ppd (forum derivation). Example: a 3 m wide image viewed from 5 m: 1080p ≈ 1920 / (2·atan(1.5/5)·180/π ≈ 33.4°) ≈ 57 ppd (just below retinal); 4K ≈ 115 ppd **[derived]**.

---

## 7. GPU performance and implementation notes

- **Render-to-texture then composite**: render content once to an FBO at content resolution; per output, one fullscreen pass that applies warp (homography/mesh/UV map), blend, black offset, colour matrix and gamma. Raskar's two-pass method is exactly this; SAR notes the resampling cost ("aliasing and jaggies") and that a single-pass modified projection matrix avoids it for planar screens. Use mipmaps/trilinear or anisotropic sampling where the warp compresses; render at ≥ output resolution.
- **Multiple outputs from one GPU in a browser**: the Window Management API — `window.getScreenDetails()` returns `ScreenDetails`/`ScreenDetailed` for every screen; `Element.requestFullscreen({ screen })` "Specifies on which screen you want to put the element in fullscreen mode"; `Screen.isExtended`; gated by the `window-management` permission policy; experimental/not Baseline; each `window.open()` needs its own user gesture (https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API). Pattern: one window (or one fullscreen canvas) per projector, each with its own `requestAnimationFrame` loop and GL context, content shared via a `BroadcastChannel`/`SharedWorker` clock or rendered redundantly from a deterministic time base.
- **Frame sync between windows**: `requestAnimationFrame` "will generally match the display refresh rate" (60/75/120/144 Hz) and pauses in background tabs/hidden iframes (https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame). Historically browsers ran rAF on a secondary monitor at the primary's rate, causing stutter (W3C list 2013, https://lists.w3.org/Archives/Public/public-web-perf/2013Aug/0057.html); Chromium later fixed D3D vsync timestamp drift on secondary monitors with a different refresh rate (https://crrev.com/873b91f1c41220589c05e39a9424ffc99eab785a). Practical: give all projectors identical modes/refresh rates; drive animation from a shared clock, never from frame counts.
- **Vsync, tearing, fullscreen modes (Windows)**: Microsoft: with the DXGI flip model, "windowed mode [is] effectively equivalent or better when compared to the classic 'fullscreen exclusive' mode"; DirectFlip/Independent Flip engage when the window covers the screen and buffers match (or MPO), bypassing DWM "in the same way that exclusive fullscreen does"; tearing requires `DXGI_FEATURE_PRESENT_ALLOW_TEARING` with sync interval 0, otherwise frames are vsynced; HDR formats aren't clamped unless composed to an SDR desktop; use PresentMon to see which path engaged (https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model). "Fullscreen Optimizations" make a game believe it is FSE while running borderless; FSO explicitly benefits "multiple monitor set ups"; disable per-exe if input lag appears (https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/). For a browser-based mapper this means: borderless fullscreen per display is the right mode; don't fight for exclusive fullscreen.
- **Hardware warp/blend at scanout**: NVIDIA Quadro/RTX-A NvAPI warp & blend runs in the display pipeline before scanout (no app changes, filtered by GPU hardware); settings don't persist across reboots unless re-applied (forum reports) (https://github.com/errollw/Warp-and-Blend-Quadros ; https://forums.developer.nvidia.com/t/keep-wrap-blend-configuration/111117).
- **HDR off**: with Windows HDR enabled, SDR content is tone-mapped and looks "dull and faded"; the "SDR content brightness" slider changes it (Dell KB https://www.dell.com/support/kbdoc/en-us/000143830; Microsoft Q&A https://learn.microsoft.com/en-us/answers/questions/4309236/screenshot-with-hdr-enabled-is-washed-out-the-sdr). For calibrated projection keep the OS in SDR so measured gammas stay valid.
- **Colour management**: WebGL2 `drawingBufferColorSpace` is `"srgb"` by default (`"display-p3"` optional); textures via `unpackColorSpace` (https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawingBufferColorSpace). Keep the whole pipeline in sRGB-encoded values, linearize inside the shader with the *measured* projector γ for blending/offsets, re-encode on output; disable projector "dynamic contrast/iris/eco" modes that change γ frame-to-frame **[practice, unverified]**. Chromium `chrome://flags/#force-color-profile` can pin the browser's assumed display profile (community workaround).
- **Projector-side pitfalls [practice]**: digital keystone in the projector re-samples and must be zeroed when the software does the warp; "frame interpolation"/"overscan" settings add latency or crop pixels; verify 1:1 pixel mapping with a single-pixel grid test pattern.

---

## Where sources could not be verified

- Moreno & Taubin 2012: paper PDF not reachable (Brown server down; IEEE closed); method reconstructed from the authors' patent and citing papers; thresholds b, m and reported reprojection errors unverified.
- Majumder & Stevens TOG 2005 and TVCG 2004 texts: not fetched (UNC link 404); method taken from the 2003 dissertation (same algorithm); DOI confirmed via Crossref.
- Raskar et al. Vis 1999 PDF uses bitmap (Type3) fonts; content taken from Bimber & Raskar's SAR book, which reproduces it.
- Geng's structured-light tutorial (Optica) blocked; phase-shift formulas taken from the arXiv TPU review instead.
- NVAPI `r,q` semantics, Scalable Display/VIOSO file layouts, depth-of-focus f-number formula, Procamcalib paper, uniform Catmull–Rom matrix, TPS linear system, N-step phase formula: standard but unverified here (marked inline).

---

## References (URLs)

Geometry
- OpenCV calib3d (camera model, distortion, calibrateCamera, findHomography, solvePnP, initUndistortRectifyMap): https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html
- Wikipedia, Direct linear transformation: https://en.wikipedia.org/wiki/Direct_linear_transformation
- Wikipedia, Homography (computer vision): https://en.wikipedia.org/wiki/Homography_(computer_vision)
- Hartley normalization (CS766 slides with `normalise2dpts`): https://pages.cs.wisc.edu/~lizhang/courses/cs766-2012f/syllabus/10-23-sfm/10-11-sfm.pdf ; Hartley 1997 context: https://arxiv.org/pdf/2304.10771
- Perspective-correct texture mapping handout (UC Davis): https://www.cs.ucdavis.edu/~amenta/s12/perspectiveCorrect.pdf
- OpenGL projective textures / q coordinate: https://www.opengl.org/archives/resources/code/samples/advanced/advanced97/notes/node33.html ; https://opengl.org.ru/docs/pg/0908.html ; https://community.khronos.org/t/texture-q-coordinate-nvidia/41478
- Wikipedia, Keystone effect: https://en.wikipedia.org/wiki/Keystone_effect
- Wikipedia, Bézier surface: https://en.wikipedia.org/wiki/B%C3%A9zier_surface
- Wikipedia, Centripetal Catmull–Rom spline: https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline
- Wikipedia, Thin plate spline: https://en.wikipedia.org/wiki/Thin_plate_spline
- Paul Bourke, Mesh format for image warping: https://paulbourke.net/dataformats/meshwarp/ ; Blender dome docs: https://docs.blender.org/manual/en/2.79/_sources/game_engine/camera/dome.rst.txt ; Vuo: https://doc.vuo.org/0.9.0/vuo.image/vuo.image.project.dome.html
- VIOSO WarpBlend API: https://docs.vioso.com/vioso-warpblend-api
- NVIDIA warp & blend (Quadro) project: https://github.com/errollw/Warp-and-Blend-Quadros ; forum on xyuvrq: https://forums.developer.nvidia.com/t/warping-with-perspective-mapping/64561
- Warping/resampling notes: https://www.cs.princeton.edu/courses/archive/spr17/cos426/notes/cos426_s17_lecture03_warping.pdf ; https://people.csail.mit.edu/fredo/comp-photo-book/06-warping-and-morphing-01-warping-and-resampling.html

Calibration
- Zhang, A Flexible New Technique for Camera Calibration (MSR-TR-98-71): https://www-users.cse.umn.edu/~hspark/CSci5980/zhang.pdf ; MSR page: https://www.microsoft.com/en-us/research/?p=145334
- OpenCV structured_light: https://docs.opencv.org/4.0.0/d1/d90/group__structured__light.html ; GrayCodePattern: https://docs.opencv.org/4.x/d1/dec/classcv_1_1structured__light_1_1GrayCodePattern.html ; SinusoidalPattern: https://docs.opencv.org/4.x/d6/d96/classcv_1_1structured__light_1_1SinusoidalPattern.html
- Herakleous & Poullis, 3DUNDERWORLD-SLS: https://arxiv.org/pdf/1406.6595
- Temporal phase unwrapping review / 3-step PSP equations: https://ar5iv.labs.arxiv.org/html/1903.09836
- Wikipedia, Structured-light 3D scanner: https://en.wikipedia.org/wiki/Structured-light_3D_scanner
- Moreno & Taubin 2012, DOI 10.1109/3DIMPVT.2012.77 (Crossref); patent US20140078260A1: https://patents.google.com/patent/US20140078260A1/en ; citing description: https://arxiv.org/pdf/2102.11395 ; software note: https://projection-mapping.org/?p=1855
- RoomAlive Toolkit: https://github.com/Kinect/RoomAliveToolkit (ProjectorCameraEnsemble.cs, GrayCode.cs); MSR page: https://www.microsoft.com/en-us/research/project/roomalive-toolkit/ ; vvvv thread: https://forum.vvvv.org/t/roomalive-toolkit/14029
- Raskar et al., Shader Lamps (EGWR 2001): https://web.media.mit.edu/~raskar/RaskarPapers/shaderlampsRaskar01.pdf ; MERL TR2001-21: https://www.merl.com/publications/TR2001-21 ; Dynamic Shader Lamps TR2001-50: https://www.merl.com/publications/docs/TR2001-50.pdf
- YCAM ProCamToolkit: https://github.com/YCAMInterlab/ProCamToolkit

Curved surfaces
- Bourke, Computer generated angular fisheye projections: https://paulbourke.net/dome/fisheye/
- Bourke, fisheye → spherical/perspective (fish2): https://paulbourke.net/dome/fish2/ ; sphere2fish: https://paulbourke.net/dome/2fish/ ; dualfish2sphere: https://paulbourke.net/dome/dualfish2sphere/
- Bourke, Full dome projection using three projectors: https://paulbourke.net/dome/3projdome/
- Bourke, isphere (spherical display): https://paulbourke.net/dome/isphere/
- Bourke, Using a spherical mirror for projection into immersive environments (Graphite 2005): https://paulbourke.net/papers/graphite2005/graphite.pdf ; 2016 slides: https://paulbourke.net/papers/anmm2016/slides.pdf ; off-axis fisheye: https://paulbourke.net/dome/offaxisfisheyeprojection
- IMERSA fulldome guidelines (dome master): https://imersa.org/guidelines
- Wikipedia, Fulldome: https://en.wikipedia.org/wiki/Fulldome
- Wikipedia, Line–sphere intersection: https://en.wikipedia.org/wiki/Line%E2%80%93sphere_intersection
- Tóth et al., Automatic Estimation of Sphere Centers from Images of Calibrated Cameras: https://arxiv.org/pdf/2002.10217
- Raskar et al., iLamps (MERL TR2003-23): https://www.merl.com/publications/docs/TR2003-23.pdf ; Quadric Transfer for Immersive Curved Screen Displays (EG 2004): https://web.media.mit.edu/~raskar/CurvedScreen/raskarEurographics04CurvedScreen.pdf ; project page: https://web.media.mit.edu/~raskar/geomproj.html

Blending / photometric
- Bourke, Edge blending using commodity projectors: https://paulbourke.net/miscellaneous/edgeblend/
- Scalable Display, blending software notes: https://www.scalabledisplay.com/blending-software/
- Dataton WATCHOUT 7, Edge Blending: https://docs.dataton.com/watchout-7-new/watchout/displays-and-outputs/edge-blending.html
- Immersaview, Edge Blending: https://immersaview.com/resources/edge-blending ; Resolume: https://resolume.com/article/54 ; Dexon: https://dexonsystems.com/blog/edge-blending
- Majumder, dissertation (UNC 2003): https://sreal.ucf.edu/wp-content/uploads/2018/02/dissertation_majumder.pdf ; thesis page: https://ics.uci.edu/~majumder/thesis.html
- Majumder & Stevens, Perceptual photometric seamlessness..., ACM TOG 24(1), 2005, DOI 10.1145/1037957.1037964 ; Color nonuniformity..., IEEE TVCG 10(2):177–188, 2004 ; LAM, VRST 2002 ; patent US 7,038,727: https://knowledge.uchicago.edu/record/9047/files/US7038727.pdf ; color seamlessness patent US 9,052,584: https://patents.google.com/patent/US9052584
- Pjanic et al., Seamless Multi-Projection Revisited (Disney, TVCG 2018): https://la.disneyresearch.com/wp-content/uploads/color_uniformity_2.pdf

Registration
- Raskar et al., Multi-Projector Displays Using Camera-Based Registration (Vis 1999): https://web.media.mit.edu/~raskar/UNC/Seamless/raskarSeamlessVis99.pdf ; project page: https://web.media.mit.edu/~raskar/UNC/Seamless
- Chen, Sukthankar, Wallace, Li, Scalable alignment ... camera homography trees (Vis 2002): https://ics.uci.edu/~majumder/docs/hanchen.pdf ; Princeton record: https://collaborate.princeton.edu/en/publications/scalable-alignment-of-large-format-multi-projector-displays-using/
- Bimber & Raskar, Spatial Augmented Reality (free PDF): https://pages.cs.wisc.edu/~dyer/cs534/papers/SAR.pdf (ch. 4–5, 7, app. A–B)

Optics / content
- Throw ratio: https://www.4wall.com/help/help-projector-throw-ratio-calculator-n-127 ; https://www.rtings.com/projector/learn/throw-distance-calculator
- Lens shift: https://helpguide.sony.net/vpl/xw5000/v1/en/contents/TP1000558303.html ; https://storage.mixwave.co.jp/files/pro_video/norxe/product-support-norxe-lens-shift-explained.pdf
- Wikipedia, Inverse-square law: https://en.wikipedia.org/wiki/Inverse-square_law ; Lambert's cosine law: https://en.wikipedia.org/wiki/Lambert%27s_cosine_law ; Projection screen (gain): https://en.wikipedia.org/wiki/Projection_screen
- Foot-lamberts/gain: https://www.projectorscreen.com/blogs/news/what-are-foot-lamberts-and-why-do-i-care ; ambient contrast formula: https://www.oreilly.com/library/view/media-design-and/9781315442709/19-9781315442709_AppendixB.xhtml ; luminance targets: https://www.avnetwork.com/avnetwork/understanding-image-luminance
- Depth of field for domes: https://www.benq.eu/en-uk/business/resource/trends/good-projector-dof-for-flight-simulation.html ; https://arxiv.org/pdf/astro-ph/0602448
- Pixels per degree / acuity: https://arxiv.org/pdf/2410.06068

GPU / OS
- MDN Window Management API: https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API ; requestAnimationFrame: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame ; drawingBufferColorSpace: https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawingBufferColorSpace
- Microsoft, DXGI flip model: https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model ; Demystifying Full Screen Optimizations: https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/
- Chromium secondary-monitor vsync fix: https://crrev.com/873b91f1c41220589c05e39a9424ffc99eab785a ; W3C web-perf thread: https://lists.w3.org/Archives/Public/public-web-perf/2013Aug/0057.html
- HDR/SDR washed-out: https://www.dell.com/support/kbdoc/en-us/000143830 ; https://learn.microsoft.com/en-us/answers/questions/4309236/screenshot-with-hdr-enabled-is-washed-out-the-sdr
