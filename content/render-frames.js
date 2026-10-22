// Headless frame renderer: loads the animation page, renders every frame via renderAt(t), encodes with ffmpeg.
// Runs where Playwright + Chrome + ffmpeg exist: node render-frames.js <page.html> <out.mp4> [preview]
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'); const { execSync } = require('child_process');
(async () => {
  // usage: node render-frames.js <page.html> <out.mp4> [preview]   env: AUDIO=<file> to mux an external soundtrack
  const [,, htmlPath, outMp4, previewOnly] = process.argv;
  const path = require('path');
  const root = path.resolve(path.dirname(htmlPath), '..');          // serve the project root so ../media/ resolves
  const srv = require('child_process').spawn('python3', [path.join(root, 'serve.py'), '8797'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1120 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://127.0.0.1:8797/' + path.relative(root, htmlPath).replace(/\\/g, '/') + '?frame=1');
  await page.waitForFunction(() => !window.assetsReady || window.assetsReady(), null, { timeout: 20000 }).catch(() => console.log('assets not ready, rendering anyway'));
  const { DURATION, FPS } = await page.evaluate(() => ({ DURATION: window.DURATION, FPS: window.FPS }));
  const dir = '/tmp/frames-' + path.basename(outMp4, '.mp4'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);   // one folder per output, so parallel renders cannot collide
  const times = previewOnly ? [3, 7, 12.5, 17, 21, 25] : Array.from({ length: DURATION * FPS }, (_, i) => i / FPS);
  let n = 0;
  for (const t of times) {
    const data = await page.evaluate(t => { renderAt(t); return document.getElementById('c').toDataURL('image/png').slice(22); }, t);
    fs.writeFileSync(`${dir}/f${String(n++).padStart(4, '0')}.png`, Buffer.from(data, 'base64'));
    if (n % 100 === 0) console.log('frames', n);
  }
  let audioArgs = '';
  if (!previewOnly && process.env.AUDIO) {
    audioArgs = `-i "${process.env.AUDIO}" -c:a aac -b:a 192k -shortest`;
  } else if (!previewOnly && await page.evaluate(() => typeof window.renderAudio === 'function')) {
    console.log('rendering audio…');
    const wav = await page.evaluate(() => window.renderAudio());
    fs.writeFileSync(`${dir}/audio.wav`, Buffer.from(wav, 'base64'));
    audioArgs = `-i ${dir}/audio.wav -c:a aac -b:a 192k -shortest`;
  }
  await browser.close(); srv.kill();
  if (previewOnly) { console.log('preview frames in', dir); return; }
  console.log('encoding…');
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/f%04d.png ${audioArgs} -c:v libx264 -preset medium -crf 17 -g 30 -keyint_min 30 -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart "${outMp4}"`, { stdio: 'inherit' });
  console.log('done', outMp4, fs.statSync(outMp4).size);
})();
