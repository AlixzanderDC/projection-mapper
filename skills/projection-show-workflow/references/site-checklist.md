# Projection show checklist

## A. Before the day
- [ ] Surface measured (W × H, shape, material, colour); photo from each candidate projector position
- [ ] Ambient light measured in lux at the surface at show time; lumens ÷ area ≥ 5× ambient
- [ ] Projector model: throw ratio range, lens shift range and convention (0 % or 50 % = centred), native resolution, contrast, inputs
- [ ] Distance and height per projector computed from throw ratio and lens shift (lens height relative to object centre)
- [ ] Overlap planned (10–30 % of width, or ≥ 128–256 px); projectors symmetric
- [ ] Signal plan: outputs per GPU, hub/dock bandwidth (4K60 ≈ 18 Gbit/s; DP 1.2 MST → two 4K30 or three 1080p60), cable lengths (HDMI > 5 m: active/fibre), **EDID emulators** per output
- [ ] Playback machine: GPU decode for the codec, SSD, SDR mode, notifications/sleep/updates off, power plan "performance"
- [ ] Content at native per-output resolution, intra-frame codec (Hap/DXV/NotchLC) or short-GOP H.264; fps = refresh or divisor; loops verified; template/stencil renders match the surface
- [ ] Show file skeleton with surfaces named per projector; test patterns loaded (labelled, single-pixel grid, 25/50/75/100 % white, grey ramp, black)
- [ ] Spares: cables, adapters, EDID emulator, lamp/lens cloth, laser level, tape measure, gaffer, extension leads

## B. Show day
1. [ ] Rig, power, cable; label every output and projector; EDIDs in; desktop layout / Mosaic set; each projector shows its own labelled pattern
2. [ ] Warm up 15–20 min
3. [ ] Projector menus: native res, same picture mode on all, keystone 0, lens shift centred then set, frame interpolation/overscan/dynamic contrast/eco off; zoom then focus at surface centre
4. [ ] Coarse aim one projector at a time (cover your zone, minimal spill)
5. [ ] Geometry per projector (corner pin / calibration); align grids across seams: translate → scale → rotate (level) → local warp
6. [ ] Blend after warp: widths = real overlap; gamma per channel on 50 % grey; power/luminance on the ramp; black-level lift on black
7. [ ] Brightness and white point matched across units
8. [ ] Save show file; export masks/warps; photograph the rig and note all measurements
9. [ ] Run real content end to end; walk the audience area; check seams in motion
10. [ ] Mark projector positions on the floor/rig (tape) for quick recovery after a bump

## C. During the show
- [ ] Never unplug or power-cycle a projector while the machine is running (EDID)
- [ ] Keep blower constant for inflatables; re-touch warp after the object settles
- [ ] If an output swaps: reload the show file after re-enumeration, or restart with projectors already on

## D. After
- [ ] Note what drifted and why; update distances/heights in the show file; archive the show file with the content
