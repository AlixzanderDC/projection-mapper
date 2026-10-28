// editor.js — mouse/keyboard editing of surface control points on an overlay canvas.
import { evalMesh, outline, pointInPolygon, surfaceFn, surfaceInverse } from './core.js';

const HIT_RADIUS = 10; // css px

export class Editor {
  // hooks.get() -> {state, output}; hooks.send(op) applies an edit; hooks.region() (optional) -> the output's CSS rect.
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.drag = null;
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
    canvas.addEventListener('keydown', e => this.onKey(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Pointer position normalized to the output's region of the canvas (hooks.region() -> {x, y, w, h} in
  // CSS pixels, for a spanned window; absent = the whole canvas).
  toNorm(e) {
    const r = this.canvas.getBoundingClientRect();
    const rg = this.hooks.region ? this.hooks.region() : null;
    const x0 = r.left + (rg ? rg.x : 0), y0 = r.top + (rg ? rg.y : 0), w = rg ? rg.w : r.width, h = rg ? rg.h : r.height;
    return { x: (e.clientX - x0) / w, y: (e.clientY - y0) / h, W: w, H: h };
  }

  hit(p) {
    const { state, output } = this.hooks.get();
    if (!output) return null;
    const sel = state.selection;
    const order = [...output.surfaces].reverse(); // topmost first
    const selected = order.find(s => s.id === sel.surfaceId);
    const candidates = selected ? [selected, ...order.filter(s => s !== selected)] : order;
    if (selected && selected.mask && selected.mask.enabled && selected.mask.pts.length >= 3) {
      const f = surfaceFn(selected);
      for (let i = 0; i < selected.mask.pts.length; i++) {
        const m = selected.mask.pts[i], q = f(m.u, m.v);
        const dx = (q.x - p.x) * p.W, dy = (q.y - p.y) * p.H;
        if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return { type: 'mask', s: selected, i };
      }
    }
    for (const s of candidates) {
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const q = s.pts[r][c];
          const dx = (q.x - p.x) * p.W, dy = (q.y - p.y) * p.H;
          if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return { type: 'point', s, r, c };
        }
      }
    }
    for (const s of order) {
      if (pointInPolygon(outline(evalMesh(s, state.meshDensity)), p.x, p.y)) return { type: 'surface', s };
    }
    return null;
  }

  onDown(e) {
    if (e.button !== 0) return;
    const { output } = this.hooks.get();
    if (!output) return;
    this.canvas.focus();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toNorm(e);
    const h = this.hit(p);
    if (!h) { this.hooks.send({ type: 'select', outputId: output.id, surfaceId: null, point: null }); return; }
    if (h.type === 'mask') {
      this.hooks.send({ type: 'select', outputId: output.id, surfaceId: h.s.id, point: { mask: h.i } });
      if (h.s.locked) return;
      const m = h.s.mask.pts[h.i], q = surfaceFn(h.s)(m.u, m.v);
      this.drag = { type: 'mask', s: h.s, i: h.i, offX: p.x - q.x, offY: p.y - q.y, inv: surfaceInverse(h.s), last: { u: m.u, v: m.v } };
    } else if (h.type === 'point') {
      this.hooks.send({ type: 'select', outputId: output.id, surfaceId: h.s.id, point: { r: h.r, c: h.c } });
      if (h.s.locked) return;
      const q = h.s.pts[h.r][h.c];
      this.drag = { type: 'point', s: h.s, r: h.r, c: h.c, offX: p.x - q.x, offY: p.y - q.y };
    } else {
      this.hooks.send({ type: 'select', outputId: output.id, surfaceId: h.s.id, point: null });
      if (h.s.locked) return;
      this.drag = { type: 'surface', s: h.s, lx: p.x, ly: p.y };
    }
    e.preventDefault();
  }

  onMove(e) {
    if (!this.drag) return;
    const p = this.toNorm(e);
    const d = this.drag;
    if (d.type === 'point') {
      this.hooks.send({ type: 'movePoint', surfaceId: d.s.id, r: d.r, c: d.c, x: p.x - d.offX, y: p.y - d.offY });
    } else if (d.type === 'mask') {
      const uv = d.inv(p.x - d.offX, p.y - d.offY, d.last);
      d.last = uv;
      this.hooks.send({ type: 'moveMaskPoint', surfaceId: d.s.id, i: d.i, u: uv.u, v: uv.v });
    } else {
      this.hooks.send({ type: 'moveSurface', surfaceId: d.s.id, dx: p.x - d.lx, dy: p.y - d.ly });
      d.lx = p.x; d.ly = p.y;
    }
  }

  onUp(e) {
    if (this.drag) { try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
    this.drag = null;
  }

  onKey(e) {
    const { state, output } = this.hooks.get();
    if (!output) return;
    const sel = state.selection;
    if (sel.outputId !== output.id) return;
    const s = output.surfaces.find(x => x.id === sel.surfaceId);
    if (!s) return;
    const step = e.shiftKey ? 10 : 1;
    const dx = step / output.width, dy = step / output.height;
    const arrows = { ArrowLeft: [-dx, 0], ArrowRight: [dx, 0], ArrowUp: [0, -dy], ArrowDown: [0, dy] };
    if (arrows[e.key]) {
      const [mx, my] = arrows[e.key];
      if (sel.point && sel.point.mask != null && s.mask?.pts[sel.point.mask]) {
        const m = s.mask.pts[sel.point.mask], q = surfaceFn(s)(m.u, m.v);
        const uv = surfaceInverse(s)(q.x + mx, q.y + my, { u: m.u, v: m.v });
        this.hooks.send({ type: 'moveMaskPoint', surfaceId: s.id, i: sel.point.mask, u: uv.u, v: uv.v });
      } else if (sel.point && sel.point.r != null) {
        const q = s.pts[sel.point.r][sel.point.c];
        this.hooks.send({ type: 'movePoint', surfaceId: s.id, r: sel.point.r, c: sel.point.c, x: q.x + mx, y: q.y + my });
      } else {
        this.hooks.send({ type: 'moveSurface', surfaceId: s.id, dx: mx, dy: my });
      }
      e.preventDefault();
    } else if (e.key === 'Tab') {
      const n = s.rows * s.cols;
      let i = sel.point && sel.point.r != null ? sel.point.r * s.cols + sel.point.c : -1;
      i = (i + (e.shiftKey ? -1 : 1) + n) % n;
      this.hooks.send({ type: 'select', outputId: output.id, surfaceId: s.id, point: { r: Math.floor(i / s.cols), c: i % s.cols } });
      e.preventDefault();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.point && sel.point.mask != null) {
      this.hooks.send({ type: 'removeMaskPoint', surfaceId: s.id, i: sel.point.mask });
      e.preventDefault();
    } else if (e.key === 'Insert' || e.key === '+' || e.key === '=') {
      this.hooks.send({ type: 'addMaskPoint', surfaceId: s.id, after: sel.point?.mask ?? null });
      e.preventDefault();
    } else if (e.key === 'g' || e.key === 'G') {
      this.hooks.send({ type: 'cycleFill', surfaceId: s.id });
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.hooks.send({ type: 'select', outputId: output.id, surfaceId: sel.point ? s.id : null, point: null });
      e.preventDefault();
    }
  }
}
