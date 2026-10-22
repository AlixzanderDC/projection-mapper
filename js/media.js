// media.js — per-window video/image elements, GPU textures and clock sync.
import { transportTime, clamp } from './core.js';

export class MediaProvider {
  constructor(gl, { audio = false } = {}) {
    this.gl = gl;
    this.audio = audio;
    this.items = new Map();
    this.lastCorrect = 0;
    this.onMeta = null;    // (id, {duration, width, height})
    this.onError = null;   // (id)
  }

  // Keep elements in step with state.media. `keep(mediaId)` says which files this
  // window actually needs; everything else is unloaded so it costs no decoding.
  sync(state, keep = () => true) {
    const seen = new Set();
    for (const m of state.media) {
      if (!keep(m.id)) continue;
      seen.add(m.id);
      let it = this.items.get(m.id);
      if (it && it.url !== m.url) { this.remove(m.id); it = null; }
      if (!it && !m.missing) this.add(m);
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.remove(id);
  }

  add(m) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let el;
    if (m.kind === 'video') {
      el = document.createElement('video');
      el.muted = !this.audio;
      el.playsInline = true;
      el.preload = 'auto';
      el.loop = true;
      el.addEventListener('loadedmetadata', () => this.onMeta?.(m.id, { duration: el.duration, width: el.videoWidth, height: el.videoHeight }));
      el.addEventListener('error', () => this.onError?.(m.id));
      el.src = m.url;
      el.load();
    } else {
      el = new Image();
      el.addEventListener('load', () => this.onMeta?.(m.id, { duration: 0, width: el.naturalWidth, height: el.naturalHeight }));
      el.addEventListener('error', () => this.onError?.(m.id));
      el.src = m.url;
    }
    this.items.set(m.id, { id: m.id, url: m.url, kind: m.kind, el, tex, uploaded: false, lastT: -1 });
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    if (it.kind === 'video') { it.el.pause(); it.el.removeAttribute('src'); it.el.load(); }
    this.gl.deleteTexture(it.tex);
    this.items.delete(id);
  }

  // Returns {tex} when a frame is available, uploading the newest frame first.
  texture(id) {
    const it = this.items.get(id);
    if (!it) return null;
    const gl = this.gl, el = it.el;
    if (it.kind === 'image') {
      if (!it.uploaded && el.complete && el.naturalWidth) {
        gl.bindTexture(gl.TEXTURE_2D, it.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        it.uploaded = true;
      }
    } else if (el.readyState >= 2 && (el.currentTime !== it.lastT || !it.uploaded)) {
      gl.bindTexture(gl.TEXTURE_2D, it.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        it.uploaded = true;
        it.lastT = el.currentTime;
      } catch { /* frame not ready yet */ }
    }
    return it.uploaded ? it : null;
  }

  // Drive every video from the shared transport clock.
  // Diagnostics for the UI: how many videos are decoding here, and dropped frames (Chrome/Edge).
  stats() {
    let videos = 0, dropped = 0, errors = 0;
    for (const it of this.items.values()) {
      if (it.kind !== 'video') continue;
      videos++;
      if (it.playError) errors++;
      const q = it.el.getVideoPlaybackQuality?.();
      if (q) dropped += q.droppedVideoFrames;
    }
    return { videos, dropped, errors };
  }

  tick(transport, now = Date.now()) {
    const t = transportTime(transport, now);
    const correct = now - this.lastCorrect > 400;
    for (const it of this.items.values()) {
      if (it.kind !== 'video') continue;
      const v = it.el, d = v.duration;
      if (!(d > 0) || !isFinite(d)) continue;
      const target = transport.loop ? t % d : Math.min(t, d);
      if (v.loop !== !!transport.loop) v.loop = !!transport.loop;
      if (v.playbackRate !== transport.rate) v.playbackRate = transport.rate;
      const muted = !this.audio || transport.volume <= 0;
      if (v.muted !== muted) v.muted = muted;
      if (this.audio) v.volume = clamp(transport.volume, 0, 1);
      if (transport.playing && target < d) {
        if (v.paused) {
          // Never hammer play()/seek every frame: if play() is refused, retry once a second.
          if (now - (it.playTriedAt || 0) > 1000) {
            it.playTriedAt = now;
            if (Math.abs(v.currentTime - target) > 0.1) v.currentTime = target;
            v.play().catch(e => { it.playError = e.name; });
          }
        } else if (correct && Math.abs(v.currentTime - target) > 0.1) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (correct && Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
      }
    }
    if (correct) this.lastCorrect = now;
  }
}
