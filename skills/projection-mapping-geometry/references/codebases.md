# Where to read working projection-mapping code

Pointers to implementations worth reading or porting, with licence and the specific files. Collected 2026-10-23; see `../../projection-show-workflow/references/research-tools.md` for the full survey.

## Small, readable references

| Project | Licence | Read this | What you get |
|---|---|---|---|
| **ofxPiMapper** (kr15h) | MIT | `src/Utils/HomographyHelper.cpp`, `src/Surfaces/QuadSurface.cpp`, `GridWarpSurface.cpp`, `src/Commands/` | 8×9 Gaussian-elimination homography packed into a column-major 4×4 (`{h11,h21,0,h31, h12,h22,0,h32, 0,0,0,0, h13,h23,0,1}`), lazy recompute on corner drag, grid-warp surface, command-pattern undo, `surfaces.xml` save format |
| **ofxWarp** (prisonerjohn, port of Cinder-Warping) | MIT | `src/ofxWarp/WarpPerspective.cpp`, `WarpBilinear.cpp`, `WarpBase.cpp`, `example/bin/data/shaders/ofxWarp` | perspective, bilinear and perspective-then-bilinear warps; bicubic (Catmull-Rom style) interpolation of a control grid with edge reflection; blend params `edges, exponent (2.0), gamma, luminance` serialized to JSON |
| **ofxProjectorBlend** (jeffcrouse / Flightphase) | MIT-style | `src/ofxProjectorBlendShader.h` | the Bourke blend fragment shader everyone copies (lineage → TouchDesigner `projectorBlend`) |
| **Keystone** (David Bouchard, Processing) | GPL-2.0+ | `CornerPinSurface.java`, `Keystone.java` | corner-pin via JAI `PerspectiveTransform.getQuadToQuad`, inverse for mouse picking, `keystone.xml` |
| **maptastic.js** (glowbox) | see repo | `src/maptastic.js` `updateTransform()` | CSS `matrix3d` corner pin from an 8×8 solve; localStorage layouts |
| **three-projection-mapper** (bhoffmann93) | MIT | `src/ProjectionMapper.ts`, `MeshWarper.ts`, `glsl/vertex/bicubicGridWarp.vert`, `examples/multi-window` | closest browser analogue: corner pin + bicubic grid (from Omnidome), SDF polygon masks, feather, `ProjectorCamera` with throw ratio/lens shift, BroadcastChannel multi-window |
| **ofxBezierWarp** (gameoverhack) | check `LICENCE.txt` | `src/ofxBezierWarp.cpp` | fixed-function `glMap2f` Bézier surface — conceptual reference only |

## Calibration toolkits

| Project | Licence | Read this | What you get |
|---|---|---|---|
| **RoomAlive Toolkit** (Microsoft) | MIT | `ProCamCalibration/GrayCode.cs`, `ProjectorCameraEnsemble.cs`, `ProjectionMappingSample/Shaders/` | Gray-code encode/decode with `|cap−inv| > 10` validity, projector init `fx=fy=1000, cx=W/2, cy=0`, RANSAC + Levenberg–Marquardt, off-centre projection matrix from intrinsics, `calibration.xml` ensemble |
| **ProCamToolkit / mapamok** (YCAM, Kyle McDonald) | MIT | `mapamok`, `ProCamScan`, `ProjectorGeometryCalibrate` | ≥ 6 clicked model vertices → `calibrateCamera` → GL projection/modelview; Gray-code scanning to point clouds and `.exr` displacement maps |
| **OpenCV structured_light** | Apache-2.0 | `GrayCodePattern`, `SinusoidalPattern`, tutorials `tutorial_capture/decode_graycode_pattern` | pattern generation, shadow masks, `getProjPixel`, phase maps and unwrapping |
| **Splash** (SAT Metalab) | GPL-3.0+ | docs: `explanations/ui/calibration.html`, `tutorials/multi_projector_example.html`; source `src/graphics/camera.cpp`, `warp.cpp`, `shaderSources.h`, `src/controller/colorcalibrator.cpp` | ≥ 6-point least-squares projector fit (FOV, principal point, pose), low-poly calibration mesh swapped for a hi-res UV sphere, blend weights as mesh vertex attributes, per-camera Bézier warp for inflatables, HDR colour calibration, one window per GPU |
| **Omnidome** (WilstonOreo) | AGPL-3.0 | repo | dome/sphere/cylinder/box canvases with virtual projectors; bicubic grid warp (re-licensed into three-projection-mapper) |
| **procamcalib** (Audet, JavaCV) | — | mirror `361809948/javacv.procamcalib` | geometric + colour procam calibration, multiple cams/projectors |

## Commercial tools whose docs explain the model

- **TouchDesigner** palette: `camSchnappr` (mapamok port, reports reprojection error, blend masks from projected-UV overlap), `stoner` (warp baked to a UV map for `Remap TOP`), `kantanMapper`, `projectorBlend`, `MPCDI TOP` (Python `projection()`/`cameraTransform()`).
- **Resolume Arena** Advanced Output articles 50/52/54: big corners = perspective, small inner points = linear or Bézier; ≥ 15 % overlap; Power/Luminance/Gamma RGB; Black Level Compensation.
- **QLab 5** video output docs: Perspective / Linear / Bézier warp types, linked control points to wrap regions onto one object, auto edge blends.
- **Dataton WATCHOUT 7**: pipeline "composite → warp → masks → soft-edge"; blend after warp; MPCDI 2D import.
- **Unreal nDisplay** projection policies: Mesh (UV channel 0 as warp), MPCDI / explicit PFM + alpha + beta, EasyBlend, VIOSO.
- **Paul Bourke** (paulbourke.net): `dataformats/meshwarp` (.data), `miscellaneous/edgeblend`, `dome/fisheye`, `dome/fish2`, `dome/3projdome`, `dome/isphere`.

## Known gaps in the open-source browser mappers

None of maptastic, dommapper, p5.mapper or three-projection-mapper implements gamma-corrected blends, black-level lift, 3-D model calibration (`solvePnP`/`calibrateCamera`) or MPCDI/PFM import/export. The openFrameworks, TouchDesigner and Splash sources above are the implementations to port when adding those.
