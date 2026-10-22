// media.js — per-window video/image elements, GPU textures and clock sync.
import { transportTime, clamp } from './core.js';

export class MediaProvider {
  constructor(gl, { audio = false } = {}) {
    this.gl = gl;
    this.audio = audio;
    this.uploadVia = 'direct';   // 'direct' = texImage2D(video); 'canvas' = via a 2D canvas (works around GPU driver bugs)
    this.items = new Map();
    this.posters = new Map();   // mediaId -> {src, tex, uploaded}: a still frame used when the file itself is not loaded
    // Media elements live in the document (off-screen) rather than detached: some Chrome builds
    // will not run a decoder for an element that is not in the DOM.
    this.holder = document.createElement('div');
    this.holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.append(this.holder);
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
    if (m.kind === 'video' || m.kind === 'audio') {
      el = document.createElement(m.kind);
      el.muted = !this.audio;
      el.playsInline = true;
      el.preload = 'auto';
      el.loop = true;
      el.addEventListener('loadedmetadata', () => this.onMeta?.(m.id, { duration: el.duration, width: el.videoWidth || 0, height: el.videoHeight || 0 }));
      el.addEventListener('error', () => this.onError?.(m.id));
      el.src = m.url;
      el.style.cssText = 'width:2px;height:2px';
      this.holder.append(el);
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
    if (it.kind !== 'image') { it.el.pause(); it.el.removeAttribute('src'); it.el.load(); it.el.remove(); }
    this.gl.deleteTexture(it.tex);
    this.items.delete(id);
  }

  // A still frame (canvas or image) to show when this window is not decoding the file.
  setPoster(id, src) {
    const old = this.posters.get(id);
    if (old) this.gl.deleteTexture(old.tex);
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.posters.set(id, { src, tex, uploaded: false });
  }

  // Returns {tex} when a frame is available, uploading the newest frame first.
  texture(id) {
    const it = this.items.get(id);
    if (!it) {
      const p = this.posters.get(id);
      if (!p) return null;
      if (!p.uploaded) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, p.tex);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, p.src);
        p.uploaded = true;
      }
      return p;
    }
    const gl = this.gl, el = it.el;
    if (it.kind === 'image') {
      if (!it.uploaded && el.complete && el.naturalWidth) {
        gl.bindTexture(gl.TEXTURE_2D, it.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        it.uploaded = true;
      }
    } else if (it.kind === 'audio') {
      return null;
    } else if (el.readyState >= 2 && (el.currentTime !== it.lastT || !it.uploaded)) {
      gl.bindTexture(gl.TEXTURE_2D, it.tex);
      try {
        let src = el;
        if (this.uploadVia === 'canvas') {
          if (!it.canvas) { it.canvas = document.createElement('canvas'); it.ctx2d = it.canvas.getContext('2d'); }
          if (it.canvas.width !== el.videoWidth || it.canvas.height !== el.videoHeight) { it.canvas.width = el.videoWidth; it.canvas.height = el.videoHeight; }
          it.ctx2d.drawImage(el, 0, 0);
          src = it.canvas;
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        it.uploaded = true;
        it.lastT = el.currentTime;
        it.uploads = (it.uploads || 0) + 1;
      } catch (e) { it.uploadError = e.name; }
    }
    return it.uploaded ? it : null;
  }

  // One line per element for the on-screen diagnostics.
  lines(transport) {
    const t = transportTime(transport);
    return [...this.items.values()].map(it => {
      const v = it.el, q = v.getVideoPlaybackQuality?.();
      if (it.kind === 'image') return `${it.id} image uploaded=${it.uploaded}`;
      return `${it.kind} rs=${v.readyState} ns=${v.networkState} ${v.paused ? 'PAUSED' : 'playing'} t=${v.currentTime.toFixed(2)} clock=${t.toFixed(2)} rate=${v.playbackRate.toFixed(2)} dec=${q ? q.totalVideoFrames : '-'} drop=${q ? q.droppedVideoFrames : '-'} up=${it.uploads || 0} ${v.error ? 'ERR ' + v.error.code : ''}${it.playError ? ' play:' + it.playError : ''}${it.uploadError ? ' upload:' + it.uploadError : ''}`;
    });
  }

  // Diagnostics for the UI: how many videos are decoding here, and dropped frames (Chrome/Edge).
  stats() {
    let videos = 0, dropped = 0, errors = 0;
    for (const it of this.items.values()) {
      if (it.kind === 'image') continue;
      videos++;
      if (it.playError) errors++;
      const q = it.el.getVideoPlaybackQuality?.();
      if (q) dropped += q.droppedVideoFrames;
    }
    return { videos, dropped, errors };
  }

  // Drive every video/audio element from the shared transport clock.
  // Seeking is expensive (Chrome re-decodes from the last keyframe, which can be seconds of
  // video), so small drift is corrected by nudging playbackRate; we only seek for big jumps,
  // and never more than once every 2.5 s or while the element has no decoded frame.
  tick(transport, now = Date.now()) {
    const t = transportTime(transport, now);
    for (const it of this.items.values()) {
      if (it.kind === 'image') continue;
      const v = it.el, d = v.duration;
      if (!(d > 0) || !isFinite(d)) continue;
      const target = transport.loop ? t % d : Math.min(t, d);
      if (v.loop !== !!transport.loop) v.loop = !!transport.loop;
      const muted = !this.audio || transport.volume <= 0;
      if (v.muted !== muted) v.muted = muted;
      if (this.audio) v.volume = clamp(transport.volume, 0, 1);
      let drift = v.currentTime - target;                 // + = element is ahead of the clock
      if (transport.loop) { if (drift > d / 2) drift -= d; else if (drift < -d / 2) drift += d; }
      const ad = Math.abs(drift);
      const canSeek = now - (it.lastSeekAt || 0) > 2500;
      if (transport.playing && target < d) {
        if (v.paused) {
          if (now - (it.playTriedAt || 0) > 1000) {         // if play() is refused, retry once a second
            it.playTriedAt = now;
            if (ad > 0.25) { v.currentTime = target; it.lastSeekAt = now; }
            v.playbackRate = transport.rate;
            v.play().catch(e => { it.playError = e.name; });
          }
        } else if (v.readyState >= 3 && now - (it.rateAt || 0) > 1000) {
          // Judge drift once a second, once frames are flowing. Rate changes are expensive in
          // Chrome (the pipeline reconfigures), so use a few fixed steps and a dead zone.
          it.rateAt = now;
          let want = transport.rate;
          if (ad > 1.5 && canSeek) { v.currentTime = target; it.lastSeekAt = now; }
          else if (ad > 0.4) want = transport.rate * (drift > 0 ? 0.92 : 1.08);
          else if (ad > 0.12) want = transport.rate * (drift > 0 ? 0.97 : 1.03);
          if (Math.abs(v.playbackRate - want) > 0.001) v.playbackRate = want;
        }
      } else {
        if (!v.paused) v.pause();
        if (ad > 0.05 && now - (it.lastSeekAt || 0) > 250) { v.currentTime = target; it.lastSeekAt = now; }
      }
    }
  }
}
