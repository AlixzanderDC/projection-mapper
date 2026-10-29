#!/usr/bin/env node
// export-template.js — write a projector's content-template files from a show file, without the browser UI:
//   node tools/export-template.js <show.pmap.json> <projector> <out-dir>
// Produces <name>_WxH_shape.png (everything lit), <name>_WxH_guide.svg and _guide.png (outlines, grid, point
// numbers; the PNG is for editors that cannot import SVG, such as Premiere Pro), and one matte PNG per visible
// surface (<name>_WxH_<surface>.png). Needs Playwright with Edge or Chrome (same as render-frames.js).
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const [,, showPath, outputSel, outDir] = process.argv;
if (!showPath || !outputSel || !outDir) { console.log('usage: node tools/export-template.js <show.pmap.json> <projector name|id|number> <out-dir>'); process.exit(1); }
const ROOT = path.resolve(__dirname, '..');
const show = JSON.parse(fs.readFileSync(showPath, 'utf8'));
const output = show.outputs.find(o => o.id === outputSel) || show.outputs.find(o => (o.name || '').toLowerCase() === outputSel.toLowerCase()) || (/^\d+$/.test(outputSel) ? show.outputs[Number(outputSel) - 1] : null);
if (!output) { console.error('no such projector; have: ' + show.outputs.map((o, i) => `${i + 1}: ${o.name}`).join(', ')); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = path.join(ROOT, path.normalize(decodeURIComponent(p)).replace(/^([/\\]?\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let pw; try { pw = require(process.env.PLAYWRIGHT_PATH || 'playwright'); } catch { console.error('Playwright not found'); process.exit(1); }
  const launch = { headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist'] };
  const channels = process.env.BROWSER ? [process.env.BROWSER] : (process.platform === 'win32' ? ['msedge', 'chrome', 'chromium'] : ['chrome', 'chromium']);
  let browser; for (const ch of channels) { try { browser = await pw.chromium.launch(ch === 'chromium' ? launch : { ...launch, channel: ch }); break; } catch (e) { if (ch === channels[channels.length - 1]) { console.error('no browser: ' + e.message); process.exit(1); } } }
  const page = await browser.newPage(); page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/bake.html?port=${port}`);
  const files = await page.evaluate(async ({ show, outputId }) => {
    const C = await import('/js/core.js'); const E = await import('/js/export.js');
    const state = Object.assign(C.defaultState(), show);
    for (const o of state.outputs) { C.upgradeOutput(o); for (const sf of o.surfaces) C.upgradeSurface(sf); }
    const o = state.outputs.find(x => x.id === outputId);
    const b64 = async blob => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
    const safe = s => (s || 'projector').replace(/[^\w.-]+/g, '_');
    const prefix = `${safe(o.name)}_${o.width}x${o.height}`;
    const out = [];
    out.push({ name: `${prefix}_shape.png`, b64: await b64(await E.silhouettePng(o, state)) });
    const svg = E.guideSvg(o, state);
    out.push({ name: `${prefix}_guide.svg`, text: svg });
    // rasterise the guide for editors without SVG import
    const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas'); c.width = o.width; c.height = o.height; c.getContext('2d').drawImage(img, 0, 0, o.width, o.height);
    out.push({ name: `${prefix}_guide.png`, b64: c.toDataURL('image/png').split(',')[1] });
    const seen = new Map();
    for (const sf of o.surfaces) {
      if (!sf.visible) continue;
      let n = safe(sf.name || 'surface'); const k = (seen.get(n) || 0) + 1; seen.set(n, k); if (k > 1) n += `_${k}`;
      out.push({ name: `${prefix}_${n}.png`, b64: await b64(await E.silhouettePng(o, state, sf.id)) });
    }
    return out;
  }, { show, outputId: output.id });
  await browser.close(); server.close();
  for (const f of files) { const p = path.join(outDir, f.name); fs.writeFileSync(p, f.text != null ? f.text : Buffer.from(f.b64, 'base64')); console.log('wrote', p); }
})().catch(e => { console.error(e.stack || e); process.exit(1); });
