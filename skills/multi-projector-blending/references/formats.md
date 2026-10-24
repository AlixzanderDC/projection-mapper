# Warp-and-blend interchange formats

## MPCDI (VESA Multiple Projector Common Data Interchange)
- v1.0 published 23 July 2013 by the VESA MPAC task group; v2.0 added colour (3D LUTs, decode/correct/encode pipeline). Spec PDF is VESA-members/paid; details here are triangulated from implementer docs (Dataton, BrightSign, Unreal, Scalable, VIOSO, Gaia Sky) — token names `[unverified]` against the spec.
- Container: ZIP renamed `.mpcdi` with `mpcdi.xml` plus referenced files. XML: `<display>` → `<buffer>` (render canvas, `Xresolution/Yresolution`) → `<region>` (one per output: `id`, `x y xsize ysize` as fractions of the buffer, `XResolution/YResolution` px) → `<frustum>` (3-D profiles) and `<fileset>` with `<geometryWarpFile>` (PFM), `<alphaMap>` (PNG, `gammaEmbedded`), `<betaMap>` (PNG), `<distortionMap>`, `<coordinateFrame>`, `<extensionSet>`.
- Profiles: **2D Media** (flat canvas, regions are sub-rectangles — WATCHOUT, BrightSign), **3D Simulation** and **Advanced 3D** (regions carry frustums; a real-time engine renders per projector — Unreal nDisplay exposes `projection()`/`cameraTransform()`), **Shader Lamps** (warp onto an arbitrary 3-D object — Scalable Atlas → TouchDesigner MPCDI TOP). Geometry levels 1–3 describe warp density/accuracy.
- **PFM warp**: 3-channel 32-bit float image, one texel per output pixel (or coarser), R,G = normalized (u,v) into the input buffer, B unused; PFM is bottom-up with endianness flagged by the sign of the scale line (Gaia Sky samples are big-endian) `[unverified vs spec]`. Unreal's explicit-PFM path adds a world scale because 3-D-profile PFMs hold XYZ positions in metres.
- **Alpha map**: multiplicative blend/intensity, 1 or 3 channels, 8/16-bit PNG, `gammaEmbedded` tells the player how to linearize (Unreal: "Alpha Gamma = 1.0 for a linear mask"). Vendors bake colour-uniformity into a 3-channel alpha.
- **Beta map**: black-level lift; gamma does not apply (BrightSign). Without beta only alpha blending is applied (WATCHOUT).
- Writers: VIOSO, Scalable (SDM, Atlas), domeprojection ProjectionTools, NestMap, Christie/Barco/Norxe chains. Readers: WATCHOUT (2D, single-pass warp+blend after compositing), BrightSign (`roVideoMode.SetMpcdi()`), Unreal nDisplay (all profiles, or explicit PFM + alpha + beta), TouchDesigner MPCDI TOP (File / Buffer ID / Region ID / Output By / Alpha-Beta blending / Gamma encoding), Pixera, 7thSense, Barco/Christie projectors, Gaia Sky (PFM only).
- Open-source parsers: none standalone found; Unreal's `MPCDI` / `DisplayClusterWarp` plugin source is the most complete open reader.

## Paul Bourke `.data` warp mesh
https://paulbourke.net/dataformats/meshwarp/
- Line 1 mesh type (2 rectangular, 1 polar — topology only); line 2 `nx ny`; then `nx·ny` nodes `x y u v i`. `x,y` GL-normalized (±aspect, ±1); `u,v ∈ [0,1]` into the input, outside = node unused; `i` multiplies r,g,b (0–1; negative = don't draw) and serves "for simple edge blending". Binary variant: 2-byte header ints (type doubles as endianness check), 4-byte float nodes. Render as one quad per cell with `glColor(i,i,i)`; skip cells with a negative-intensity corner. Limitation: a single `i` cannot do per-channel gamma-corrected blending.
- Readers: Bourke's tools, Blender 2.7x BGE dome mode, Vuo `vuo.image.project.dome`, many fulldome players.

## Hardware / vendor
- NVIDIA Quadro/RTX-A NvAPI warp & blend (`NvAPI_GPU_SetScanoutWarping`): triangle-strip mesh with per-vertex `x,y,u,v,r,q` (r,q give perspective — "could be calculated by solving the 2D homography", forum-level `[unverified]`) plus an intensity texture applied before scan-out; settings do not persist across reboots unless re-applied. Project: github.com/errollw/Warp-and-Blend-Quadros.
- VIOSO `.vwf` (per-pixel 3-D warp + soft-edge + black-out; exports MPCDI), Scalable `ScalableData.pol` + `InputBoundaryMask-blend.bmp` (EasyBlend) or MPCDI, Christie Twist / Mystique, Panasonic Geometry Manager Pro, Epson in-projector Edge Blending menus.

## Tool-native
- ofxWarp JSON: `{type, brightness, warp:{columns, rows, "control points"}, blend:{exponent, edges, gamma, luminance}}`.
- ofxPiMapper `surfaces.xml`: `<surface type>` with `<vertices>`, `<texCoords>`, `<source>`, `<properties><perspectiveWarping/>` or `<gridCols/><gridRows/>`.
- Keystone `keystone.xml`: `<surface res x y w h><point i x y u v/>`.
- RoomAlive `calibration.xml`: cameras/projectors with `hostnameOrAddress`, `displayIndex`, 4×4 pose; the projector "camera matrix" is its intrinsics.
- Splash `configuration.json` + OBJ meshes (Blender add-on export, Y forward, Z up, metres).
- Resolume Advanced Output preset XML, QLab stage files, TouchDesigner Stoner displacement/UV maps (consumed by Remap TOP).
