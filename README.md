# Projection Mapper

A small, free projection-mapping tool that runs in your browser. No install, no build step, no accounts.

- **Flat and curved surfaces** — corner-pin (perspective-correct) for walls and screens; a warp grid of up to 12×12 points for columns, domes, drapes and curved walls.
- **High-resolution video** — hardware-decoded by the browser and drawn through WebGL2, so 4K H.264 / VP9 / AV1 plays at full frame rate on a normal laptop GPU.
- **Multi-projector** — one window per projector, all driven from one control window with a shared clock, per-edge blending for overlaps, and source cropping to spread one wide video across several projectors.
- Still images, soft edges, opacity, layering, test patterns, keyboard nudging, autosave, and show files you can reload or move between machines.

Everything is plain HTML + JavaScript. The only thing that needs to run on your machine is a tiny Python script that serves the files (browsers need an `http://` origin for the windows to talk to each other and for video seeking).

## Requirements

- Python 3 (for `serve.py`). Nothing else to install.
- A current Firefox, Chrome or Edge. (Chrome/Edge can also place projector windows on displays for you; in Firefox you drag them.)
- A GPU that handles WebGL2 — anything from the last decade.

## Quick start

1. Download or clone this repository.
2. Put your videos/images in the `media/` folder (MP4 H.264 or WebM for video; PNG/JPG for stills).
3. Double-click `serve.ps1` (Windows) or run `python3 serve.py` (macOS/Linux). The control window opens at <http://127.0.0.1:8765/>.
4. Click **Rescan media/**, then **Add projector**.
5. Click **Open projector window**. Drag that window onto the projector's display and press **F** for fullscreen.
6. Click **Add surface**, pick a source, and drag the corners onto the real object — in the preview or straight on the projector window.
7. Press **Space** to play.

Your show autosaves in the browser. **Save as…** writes a `.pmap.json` file you can **Open…** later.

## Concepts

| Thing | What it is |
|---|---|
| **Projector** | One output window. Its resolution follows the window once it is open. Has edge blend, brightness, gamma, a test pattern and a handle overlay you can hide. |
| **Surface** | One patch of a source drawn onto something in the room. A projector can have any number, layered in order. |
| **Source** | A video or image from the media bin. Several surfaces (on any projector) can share one source. |
| **Show** | What a surface displays: the **Source**, a **Grid** (white lines over a faint fill, for lining up), or a **Solid color** (to see exactly what the surface covers). Press **G** to cycle. |
| **Crop** | The part of the source a surface shows. "Split into 2, piece 1" shows the left half — that is how one video spans two projectors. |

## Flat surfaces

Keep the default 2×2 grid. Drag the four corners onto the corners of the wall, screen or box face. The mapping is a true homography, so straight lines in the video stay straight on the surface even when the projector is off to one side.

## Curved surfaces

Set the warp grid to more columns and rows (3–7 is usually enough) and pull the inner points so the grid lines follow the curve. Interior points move the image smoothly between them (Catmull-Rom), and the image passes exactly through every point you place. Changing the grid size later keeps the shape you already have. **Straighten** removes all curvature but keeps the corners.

Tip: set the surface to **Grid** (or press **G**) and shape it against the real object first; switch back to **Source** when the lines sit where they should.

## Mapping with the camera

The **Camera** tab uses your laptop's back camera (or any webcam) to find the object for you.

1. Select the projector in the left column and open its window on the projector.
2. In the Camera tab, **Start camera**. Point it so it sees the whole area the projector lights. Dim the room.
3. **Calibrate (auto)**: the projector flashes 16 dots one at a time and the camera finds them. Takes about ten seconds; keep the camera still. If it finds fewer than four, use **Calibrate (click dots)**: all dots are projected with numbers and you click each one in the camera image.
4. **Trace object**: click the object's four corners in the camera image (top-left, top-right, bottom-right, bottom-left). A surface appears on it, shown as a grid so you can check the fit on the real object.
5. Fine-tune by dragging the handles on the camera image, in the preview, or on the projector itself. Then set **Show** to Source.

The calibration is a camera→projector mapping fitted through the found dots, with a local correction so curved walls still land on their dots. Accuracy depends on the camera staying where it was during calibration; move it and calibrate again. Calibration is saved with the show.

## Objects with straight edges: boxes, crosses, folded walls

Set **Between points** to **Straight lines**. Then pulling an interior point makes a crease instead of a curve, so a 3×2 grid can wrap a box corner and a 3×3 can follow a folded wall.

For shapes with holes or notches, use a **Mask**: a polygon in surface space that limits where light falls. Tick **Use mask** and pick a preset (**X cross**, **Plus**, **Diamond**, **Rectangle**) with an arm width, then drag the pink diamonds to fit. Click a mask point and press **Insert** (or **+**) to add one after it, **Delete** to remove it. **Mask soft edge** feathers the cutout; **Invert** lights everything except the shape.

An X-shaped cross: one surface, corner-pinned to the four tips of the X (the cross's bounding box), mask preset **X cross**, arm width to match the beams, nudge the points. Show it as a Grid or Solid while fitting, then switch to the Source.

## An object in front of a wall

Map the wall as one surface and the object as another. In the wall surface's inspector, under **Cut out other surfaces**, tick the object. The object's shape (mask included) is punched out of the wall, so the wall content never lands on the object. The hole stays when the object surface is hidden, so you can light the wall alone. **Expand cut** grows the hole by a few pixels for a safety margin; a soft hole edge comes from the object surface's own soft edges or mask soft edge.

## Making content for a mapped shape

Once a shape is mapped, you usually want video made for it rather than a rectangle warped onto it. In the projector inspector, **Content template** gives you two files at the projector's real resolution (open the projector window first so the size is right):

- **Shape PNG** — white where the projector lights, black elsewhere, pixel-exact. Use it as a track matte or mask layer in Premiere, After Effects, Resolve or whatever you edit in.
- **Guide SVG** — outlines, warp grid lines, control point numbers and masks as vector paths. Drop it on a layer above your composition to see where everything lands.

Make the video at that size, put it in `media/`, add a surface, press **Full frame** (the whole projector, 1:1), and pick the video as its source. Nothing else to warp: the content already has the shape. Keep the original mapped surfaces in the show if you want to switch between warped rectangles and purpose-made content; just toggle **Visible**.

## Setting up around a known object

If you know the real size of what you'll light (a 60-inch inflatable moon, say), the projector can be placed before the object is even there. In the projector inspector, **Setup template**: pick the object (or enter a custom size), the lens's throw ratio from its spec sheet (distance ÷ image width), and the distance. The projector shows a dashed outline of the object at its true pixel size, with the numbers (image size in inches, pixels per inch, percentage of the frame). The **Distance to fill 70 %** button tells you where to stand the projector so the object fills most of the frame (measured on whichever side it hits first) with room for edge content. **Lens offset** (from the spec sheet: 1.0 means the picture's bottom edge is level with the lens) turns into a mounting height: the readout says how far below the object's centre the lens should sit so the object lands on the outline with the projector square to it, no keystone. Hang the object inside the outline, then **Make surface from template** turns the outline into a mapped surface (circular mask for a sphere) to fine-tune.

## All the way round a ball: several projectors, one 360° strip

A **360° ball** surface treats its four corners as the bounding box of a sphere (the moon). From the projector's throw ratio and lens offset (the Setup template) the mapper knows the ray behind every pixel, so each pixel is traced onto the ball and finds its longitude and latitude. The source is then a **2:1 equirectangular strip**, the same layout as a 360° video: its middle lands on the point of the ball facing projector 1, its left and right edges meet behind the ball, the top row is the north pole. Anything moving right in the strip travels round the ball to the right as seen from projector 1.

1. On each projector, set the Setup template's throw ratio and lens offset, hang the moon, and **Make 360° ball surface**. Drag the corners until the dashed circle sits on the ball.
2. Give each ball surface the same source and set **Position round the ball**: 0 for projector 1, then how far round each other projector stands (walk right round the ball from behind projector 1: a third of the way is 120°, two thirds 240°). Height above or below the ball is worked out from where the ball sits in the frame, assuming the projector is level; **Projector tilt** corrects a unit that is pitched up or down.
3. Switch all of them to **Show → Grid**: the longitude/latitude lines must coincide on the ball. Nudge azimuths and corners until they do.

Where projectors overlap, each one's share follows how squarely it hits the surface, so the seams blend on their own (no edge-blend widths to set); **Overlap sharpness** hands over faster or slower and **Blend gamma** should match the projectors. A ball surface can sit on the same projector as an ordinary flat surface: tick **Add light** on the ball layer so its black stays see-through and only the content lights the ball on top of the flat picture. `test-sphere.html` shows three such projectors sharing one labelled strip.

The strip is decoded once per projector window, so keep it modest: 2048×1024 reads well on a 60-inch ball from 1080p projectors.

## Multiple projectors on one wall

1. Add two projectors, open both windows, put each on its display, press **F** in each.
2. Add a surface on each with the same source. On the left one: *Split into 2, piece 1*. On the right one: *piece 2*.
3. Physically overlap the projectors by 10–20 % of their width. Corner-pin each surface so the content lines up in the overlap (use the test pattern's grid).
4. On the left projector set **Right width** under Edge blend to the overlap in pixels; on the right projector set **Left width** the same. Adjust the **curve** until the seam disappears. Lower **brightness** slightly on the brighter unit if needed.

A single video decodes once per window, so two projectors showing one 4K file means two 4K decodes. That is fine on recent hardware; if it stutters, encode the video at the resolution each projector actually needs, or split the file into one piece per projector ahead of time.

## Keys

Control window: **Ctrl+Z** undo, **Ctrl+Y** or **Ctrl+Shift+Z** redo (a drag or slider sweep is one step; also works from a projector window) · **Space** play/pause · **Arrows** nudge the selected point or surface by 1px (**Shift** = 10px) · **Tab** / **Shift+Tab** next/previous grid point · **G** cycle Source/Grid/Solid on the selected surface · **Insert** / **Delete** add or remove a mask point · **Esc** deselect.

Projector window: **F** or double-click = fullscreen · **E** show/hide handles · **T** test pattern · same arrow/Tab editing as above. Hide the handles (E) before the show; the cursor hides with them.

## Files and formats

- `media/` — your content. Ignored by git. Anything you drop here shows up after **Rescan media/**.
- **Add files…** loads content for this session only (it is not copied anywhere); after a reload those entries show as *missing* until you add the same files again.
- Video: MP4 (H.264) and WebM (VP9/AV1) play in every browser. HEVC/H.265 plays in Chrome and Edge but not Firefox. ProRes and other editing codecs do not play in browsers — export a delivery file.
- Audio plays from the control window only; projector windows are muted. Audio files (MP3, WAV, M4A…) in the bin are soundtracks: they run in sync with the transport whenever **Audio** is above 0.
- Each window decodes only the files its surfaces show. The control window also decodes what its preview plays; untick **Play video in this preview** and it shows still frames instead (a badge says so) and decodes nothing unless **Audio** is above 0.

## Memory

Almost all of the memory is video decoders: one per file, per window that shows it, and a 4K H.264 decoder in Chrome is several hundred MB by itself. To keep it down:

- Untick **Play video in this preview** and keep **Audio** at 0 in the control window during a show if memory is tight.
- Encode each file at the resolution of the projector that shows it. A 1920×1080 projector gains nothing from a 4K file, and the decoder for it is four times the size.
- One file per projector beats one 4K file cropped across two projectors: each projector window would otherwise decode the whole 4K frame.
- Close projector windows you are not using; a hidden surface still costs nothing, but an open window with a visible video surface decodes.
- Show file: `*.pmap.json`, plain JSON. Media are referenced by path (`media/clip.mp4`), so a show plus its `media/` folder is portable.

## How it works

- `js/core.js` — state model, homography + spline warp math, edit operations. Shared by both windows.
- `js/render.js` — WebGL2 renderer (surfaces → offscreen texture → edge-blend/brightness pass) and the 2D overlay.
- `js/media.js` — video/image/audio elements, GPU uploads, and the shared-clock sync. Two hard-won rules live here: the video elements sit **underneath** the output canvas, full size and opaque, with the canvas created `alpha: true`, because Chrome (at least on Windows/Qualcomm) only decodes at full rate for a WebGL consumer when the compositor is drawing the element; and drift is corrected with small, rare `playbackRate` nudges, never by seeking, because a seek re-decodes from the last keyframe and a seek every few frames starves the decoder entirely. `test-video.html` and `test-visibility.html` are the pages that established this; keep them.
- `js/editor.js` — mouse/keyboard editing of control points.
- `js/control.js`, `js/output.js` — the control window and the projector window. They talk over a `BroadcastChannel`; the control window owns the state and autosaves it.
- `serve.py` — static server with HTTP Range support (needed for seeking) and correct MIME types.

## Limits and ideas for later

- Ball surfaces assume the projector is level (or tilted only up/down, see Projector tilt) and the ball is a true sphere.
- The camera traces four corners (a quad). For a curved object, trace the quad, then raise the grid and pull the inner points on the camera image.
- No DMX/OSC/MIDI triggering yet — the transport is play/pause/seek.
- One cue (one set of sources) per show file. Make a show file per look and **Open…** between them.
- Windows are placed by hand in Firefox. Chrome/Edge support **Detect displays** and will open a projector window on a chosen screen.

## License

MIT — see `LICENSE`.

## Procedural content: `content/`

`content/vines-roses.html` is a time-driven canvas animation made for a mapped X-cross and the wall behind it (shapes taken from the exported Guide SVG). Open it in a browser to preview and scrub; **Record WebM** saves one loop as a video. `content/render-frames.js` renders every frame headlessly and encodes an MP4 with ffmpeg (needs Node with Playwright, Chrome and ffmpeg). Add `?nobg=1` for the cross alone.

`content/crucible-reveal.html` is a 14 s logo reveal (logo PNG and theme MP3 live in `media/`, not in git). `content/arkham-banner.html` is a 2:1 equirectangular strip for a **360° ball** surface: an "Arkham Asylum" title, a status feed ("CRYO WING STABILITY AT 12%", …) and a warning tape travel round the ball in whole laps, so the 192 s video loops and wraps without a seam. Edit the `FEED` list at the top of the file to change the messages; render with `node content/render-frames.js content/arkham-banner.html media/arkham_banner_2048x1024.mp4` (set `PLAYWRIGHT_PATH` if Playwright is not installed next to the script).
