/* 搞怪脸工坊 app.js —— 纯前端，照片不离开浏览器 */
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
let W = 0, H = 0, orig = null, undoStack = [], stickers = [], sel = -1;
let tab = 'ai', brush = 'bulge', pickCenter = false, center = null;
let faces = [], origFaces = [], modelsReady = false, detectToken = 0, isDemo = false;
const MAX = 1200;

function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800); }
function setStatus(msg, cls = '') { const s = $('status'); s.textContent = msg; s.className = 'status ' + cls; }

/* ================= 图片载入 ================= */
function setImage(src, demo = false) {
  const s = Math.min(1, MAX / Math.max(src.width, src.height));
  W = work.width = cv.width = Math.round(src.width * s);
  H = work.height = cv.height = Math.round(src.height * s);
  wctx.drawImage(src, 0, 0, W, H);
  orig = wctx.getImageData(0, 0, W, H);
  undoStack = []; stickers = []; sel = -1; center = null; faces = []; origFaces = []; isDemo = demo;
  render();
  if (demo) setStatus(modelsReady ? '模型已就绪。点上方“📷 上传照片”，会自动识别五官。' : '正在加载人脸识别模型…', modelsReady ? 'ok' : '');
  else detect(false, true);
}
function demo() {
  const c = document.createElement('canvas'); c.width = 700; c.height = 800; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 800); gr.addColorStop(0, '#8ecae6'); gr.addColorStop(1, '#219ebc'); g.fillStyle = gr; g.fillRect(0, 0, 700, 800);
  g.fillStyle = '#3d2b1f'; g.beginPath(); g.ellipse(350, 300, 215, 230, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#f4c79a'; g.beginPath(); g.ellipse(350, 370, 190, 230, 0, 0, 7); g.fill();
  g.fillRect(300, 580, 100, 120); g.fillStyle = '#e76f51'; g.beginPath(); g.ellipse(350, 800, 260, 140, 0, 0, 7); g.fill();
  for (const x of [275, 425]) { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 340, 40, 26, 0, 0, 7); g.fill(); g.fillStyle = '#3a2a1a'; g.beginPath(); g.arc(x, 342, 17, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 6, 336, 5, 0, 7); g.fill(); }
  g.strokeStyle = '#3d2b1f'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(235, 290); g.lineTo(310, 285); g.moveTo(390, 285); g.lineTo(465, 290); g.stroke();
  g.fillStyle = '#e0a67a'; g.beginPath(); g.moveTo(350, 360); g.lineTo(325, 440); g.lineTo(375, 440); g.fill();
  g.strokeStyle = '#a33'; g.lineWidth = 8; g.beginPath(); g.arc(350, 470, 60, .2, Math.PI - .2); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 28px system-ui'; g.textAlign = 'center'; g.fillText('示例图 · 上传真人照片才能用 AI 一键功能', 350, 760);
  setImage(c, true);
}
function loadFile(f) {
  if (!f || !f.type.startsWith('image/')) return toast('请选择图片文件');
  const u = URL.createObjectURL(f), img = new Image();
  img.onload = () => { setImage(img); URL.revokeObjectURL(u); };
  img.onerror = () => toast('这张图片打不开，换一张试试');
  img.src = u;
}

/* ================= 撤销 ================= */
function pushUndo() {
  undoStack.push({ img: wctx.getImageData(0, 0, W, H), st: JSON.stringify(stickers), fc: JSON.stringify(faces) });
  if (undoStack.length > 25) undoStack.shift();
}
$('undo').onclick = () => {
  const s = undoStack.pop(); if (!s) return toast('没有可以撤销的了');
  wctx.putImageData(s.img, 0, 0); stickers = JSON.parse(s.st); faces = JSON.parse(s.fc); sel = -1; render();
};
$('reset').onclick = () => {
  if (!orig) return; pushUndo(); wctx.putImageData(orig, 0, 0);
  stickers = []; sel = -1; faces = JSON.parse(JSON.stringify(origFaces)); $('tTop').value = $('tBot').value = ''; render(); toast('已还原原图');
};

/* ================= 画的贴纸 ================= */
const DRAW = {
  mustache(g, s) {
    g.fillStyle = '#2b1a10';
    for (const k of [1, -1]) {
      g.save(); g.scale(k, 1); g.beginPath();
      g.moveTo(0, -.06 * s);
      g.bezierCurveTo(.12 * s, -.2 * s, .32 * s, -.12 * s, .38 * s, -.02 * s);
      g.bezierCurveTo(.42 * s, .05 * s, .5 * s, .02 * s, .5 * s, -.1 * s);
      g.bezierCurveTo(.56 * s, .1 * s, .38 * s, .2 * s, .24 * s, .12 * s);
      g.bezierCurveTo(.14 * s, .07 * s, .05 * s, .08 * s, 0, .06 * s);
      g.closePath(); g.fill(); g.restore();
    }
  },
  clownNose(g, s) {
    const r = s / 2, gr = g.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r);
    gr.addColorStop(0, '#ff9a9a'); gr.addColorStop(.45, '#e8141e'); gr.addColorStop(1, '#8a0008');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  },
  blush(g, s) {
    g.save(); g.scale(1, .6);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    gr.addColorStop(0, 'rgba(255,70,110,.6)'); gr.addColorStop(1, 'rgba(255,70,110,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, s / 2, 0, 7); g.fill(); g.restore();
  },
  unibrow(g, s) {
    g.strokeStyle = '#21140c'; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) { g.lineWidth = s * (.11 - i * .02); g.beginPath(); g.moveTo(-.5 * s, (.05 + i * .01) * s); g.quadraticCurveTo(0, (-.12 + i * .02) * s, .5 * s, (.05 + i * .01) * s); g.stroke(); }
  },
  glasses(g, s) {
    g.lineWidth = s * .05; g.strokeStyle = '#111'; g.fillStyle = 'rgba(200,230,255,.25)';
    for (const x of [-.25, .25]) { g.beginPath(); g.arc(x * s, 0, .2 * s, 0, 7); g.fill(); g.stroke(); }
    g.beginPath(); g.arc(0, .02 * s, .06 * s, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.beginPath(); g.moveTo(-.45 * s, -.03 * s); g.lineTo(-.5 * s, -.06 * s); g.moveTo(.45 * s, -.03 * s); g.lineTo(.5 * s, -.06 * s); g.stroke();
  }
};
const DRAW_NAMES = { mustache: '🥸', clownNose: '🔴', blush: '☺️', unibrow: '〰️', glasses: '👓' };

/* ================= 渲染 ================= */
function render(showSel = true) {
  ctx.clearRect(0, 0, W, H); ctx.drawImage(work, 0, 0);
  stickers.forEach((s, i) => {
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.r * Math.PI / 180); ctx.scale(s.f ? -1 : 1, 1);
    if (s.d) DRAW[s.d](ctx, s.s);
    else {
      ctx.font = s.s + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.e, 0, s.s * .06);
    }
    if (showSel && i === sel) { ctx.setLineDash([8, 6]); ctx.lineWidth = 3; ctx.strokeStyle = '#ff6b35'; ctx.strokeRect(-s.s * .6, -s.s * .6, s.s * 1.2, s.s * 1.2); }
    ctx.restore();
  });
  const fs = Math.round(W * $('tSize').value / 100);
  ctx.font = `900 ${fs}px Impact,"Arial Black","Microsoft YaHei","PingFang SC",sans-serif`;
  ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, fs / 7); ctx.strokeStyle = '#000'; ctx.fillStyle = $('tColor').value;
  const t = $('tTop').value, b = $('tBot').value;
  if (t) { ctx.textBaseline = 'top'; ctx.strokeText(t, W / 2, fs * .3, W * .95); ctx.fillText(t, W / 2, fs * .3, W * .95); }
  if (b) { ctx.textBaseline = 'bottom'; ctx.strokeText(b, W / 2, H - fs * .3, W * .95); ctx.fillText(b, W / 2, H - fs * .3, W * .95); }
  if (showSel && $('showPts').checked) {
    ctx.fillStyle = '#00e5ff';
    const r = Math.max(2, W / 400);
    faces.forEach(P => P.forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); }));
  }
}

/* ================= 像素变形核心 ================= */
function sample(S, w, h, x, y, o, O) {
  x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * w + x0) * 4, j = i + w * 4;
  for (let c = 0; c < 4; c++) { const a = S[i + c] + (S[i + 4 + c] - S[i + c]) * fx, b = S[j + c] + (S[j + 4 + c] - S[j + c]) * fx; O[o + c] = a + (b - a) * fy; }
}
function warpAt(cx, cy, r, type, k, dx = 0, dy = 0) {
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(W, Math.ceil(cx + r)), y1 = Math.min(H, Math.ceil(cy + r));
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  const src = wctx.getImageData(x0, y0, w, h), S = src.data, out = new ImageData(new Uint8ClampedArray(S), w, h), O = out.data, OG = orig.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x0 + x, py = y0 + y, ddx = px - cx, ddy = py - cy, d = Math.hypot(ddx, ddy); if (d >= r) continue;
    const t = d / r, o = (y * w + x) * 4; let sx, sy;
    if (type === 'restore') { const a = Math.min(1, k * 3 * (1 - t * t)), g = (py * W + px) * 4; for (let c = 0; c < 4; c++) O[o + c] = S[o + c] + (OG[g + c] - S[o + c]) * a; continue; }
    if (type === 'bulge') { const f = 1 - k * (1 - t * t); sx = cx + ddx * f; sy = cy + ddy * f; }
    else if (type === 'pinch') { const f = 1 + k * (1 - t * t); sx = cx + ddx * f; sy = cy + ddy * f; }
    else if (type === 'swirl') { const a = k * 4 * (1 - t) * (1 - t), cs = Math.cos(a), sn = Math.sin(a); sx = cx + ddx * cs - ddy * sn; sy = cy + ddx * sn + ddy * cs; }
    else { const f = (1 - t * t) * (1 - t * t); sx = px - dx * f; sy = py - dy * f; }
    sample(S, w, h, sx - x0, sy - y0, o, O);
  }
  wctx.putImageData(out, x0, y0);
}
function remapAll(fn) {
  const S = wctx.getImageData(0, 0, W, H).data, out = new ImageData(W, H), O = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = fn(x, y); sample(S, W, H, p[0], p[1], (y * W + x) * 4, O); }
  wctx.putImageData(out, 0, 0);
}
/* 推移若干小步，效果更平滑 */
function pushSteps(p, r, vx, vy, n = 5) {
  let x = p[0], y = p[1];
  for (let i = 0; i < n; i++) { warpAt(x, y, r, 'push', 0, vx / n, vy / n); x += vx / n; y += vy / n; }
}
/* 脸部区域上色（边缘柔和） */
function tintFace(G, fn, amt = 1) {
  const cx = G.center[0], cy = G.center[1] - G.faceH * .08, rx = G.faceW * .6, ry = G.faceH * .85;
  const x0 = Math.max(0, cx - rx | 0), y0 = Math.max(0, cy - ry | 0), x1 = Math.min(W, Math.ceil(cx + rx)), y1 = Math.min(H, Math.ceil(cy + ry));
  if (x1 - x0 < 2 || y1 - y0 < 2) return;
  const img = wctx.getImageData(x0, y0, x1 - x0, y1 - y0), D = img.data, w = x1 - x0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const e = Math.hypot((x - cx) / rx, (y - cy) / ry); if (e >= 1) continue;
    const a = amt * Math.min(1, (1 - e) / .35), i = ((y - y0) * w + (x - x0)) * 4, v = fn(D[i], D[i + 1], D[i + 2]);
    for (let c = 0; c < 3; c++) D[i + c] += (v[c] - D[i + c]) * a;
  }
  wctx.putImageData(img, x0, y0);
}

/* ================= 人脸识别 ================= */
async function initModels() {
  if (typeof faceapi === 'undefined') { setStatus('人脸识别库没加载成功，AI 功能暂不可用；手动工具照常能用。', 'err'); return; }
  try {
    const okGL = await faceapi.tf.setBackend('webgl').catch(() => false);
    if (!okGL) await faceapi.tf.setBackend('cpu');
    await faceapi.tf.ready();
    await Promise.all([faceapi.nets.ssdMobilenetv1.loadFromUri('./models'), faceapi.nets.faceLandmark68Net.loadFromUri('./models')]);
    modelsReady = true;
    if (isDemo) setStatus('模型已就绪。点上方“📷 上传照片”，会自动识别五官。', 'ok');
    else if (W) detect(false, true);
  } catch (e) {
    console.error(e);
    setStatus('识别模型加载失败（如果是直接双击打开 index.html，请改用网址访问或本地服务器）。手动工具照常能用。', 'err');
  }
}
async function detect(silent = false, fresh = false) {
  if (!modelsReady || !W || isDemo) return;
  const token = ++detectToken;
  if (!silent) setStatus('正在识别人脸…');
  try {
    const res = await faceapi.detectAllFaces(work, new faceapi.SsdMobilenetv1Options({ minConfidence: .35, maxResults: 10 })).withFaceLandmarks();
    if (token !== detectToken) return;
    const found = res.map(r => r.landmarks.positions.map(p => [p.x, p.y]));
    if (!silent || found.length >= faces.length) faces = found;
    if (fresh) origFaces = JSON.parse(JSON.stringify(faces));
    if (!silent) {
      if (faces.length) setStatus(`识别到 ${faces.length} 张脸 ✓ 点下面的按钮开始恶搞`, 'ok');
      else setStatus('没识别到正脸（侧脸、太小、遮挡或卡通图可能识别不到）。可以用“变形刷”手动改。', 'err');
    }
    render();
  } catch (e) { console.error(e); if (!silent) setStatus('识别出错了，可以点“重新识别”再试。', 'err'); }
}

/* ================= 脸部几何 ================= */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const avg = arr => [arr.reduce((s, p) => s + p[0], 0) / arr.length, arr.reduce((s, p) => s + p[1], 0) / arr.length];
function geo(P) {
  const R = (i, j) => avg(P.slice(i, j + 1));
  const eyeR = R(36, 41), eyeL = R(42, 47), eyeMid = avg([eyeR, eyeL]);
  const ang = Math.atan2(eyeL[1] - eyeR[1], eyeL[0] - eyeR[0]);
  const up = [Math.sin(ang), -Math.cos(ang)];
  const browMid = avg([P[19], P[24]]);
  return {
    P, eyeR, eyeL, eyeMid, ang, up, browMid,
    eyeW: (dist(P[36], P[39]) + dist(P[42], P[45])) / 2, eyeDist: dist(eyeR, eyeL),
    nose: avg([P[29], P[30], P[33]]), noseW: dist(P[31], P[35]),
    mouth: R(48, 59), mouthW: dist(P[48], P[54]),
    faceW: dist(P[0], P[16]), faceH: dist(browMid, P[8]) * 1.25,
    center: avg([eyeMid, P[8], P[0], P[16]]), chin: P[8],
    browL: R(22, 26)
  };
}
const M = () => $('aiStr').value / 100;
const K = k => Math.min(.85, k * M());

const FX = {
  bigEyes: (G, s = 1) => [G.eyeR, G.eyeL].forEach(e => warpAt(e[0], e[1], G.eyeW * 1.6, 'bulge', K(.42 * s))),
  smallEyes: (G, s = 1) => [G.eyeR, G.eyeL].forEach(e => warpAt(e[0], e[1], G.eyeW * 1.3, 'pinch', K(.55 * s))),
  bigNose: (G, s = 1) => warpAt(G.nose[0], G.nose[1], G.noseW * 1.5, 'bulge', K(.48 * s)),
  smallNose: (G, s = 1) => warpAt(G.nose[0], G.nose[1], G.noseW * 1.3, 'pinch', K(.5 * s)),
  bigMouth: (G, s = 1) => warpAt(G.mouth[0], G.mouth[1], G.mouthW * .9, 'bulge', K(.45 * s)),
  smallMouth: (G, s = 1) => warpAt(G.mouth[0], G.mouth[1], G.mouthW * .9, 'pinch', K(.6 * s)),
  wideMouth: (G, s = 1) => {
    const v = G.mouthW * .18 * M() * s, c = Math.cos(G.ang), n = Math.sin(G.ang);
    pushSteps(G.P[54], G.mouthW * .55, v * c, v * n); pushSteps(G.P[48], G.mouthW * .55, -v * c, -v * n);
  },
  smirk: (G, s = 1) => {
    const v = G.mouthW * .3 * M() * s;
    pushSteps(G.P[54], G.mouthW * .6, G.up[0] * v, G.up[1] * v);
    pushSteps(G.P[48], G.mouthW * .5, -G.up[0] * v * .3, -G.up[1] * v * .3);
  },
  brow: (G, s = 1) => { const v = G.eyeW * .8 * M() * s; pushSteps(G.browL, G.eyeW * 1.7, G.up[0] * v, G.up[1] * v); },
  thinFace: (G, s = 1) => jaw(G, -1, s),
  fatFace: (G, s = 1) => jaw(G, 1, s),
  bigChin: (G, s = 1) => { const v = G.faceH * .14 * M() * s; pushSteps(G.chin, G.faceW * .38, -G.up[0] * v, -G.up[1] * v); },
  bigHead: (G, s = 1) => { const c = avg([G.center, G.eyeMid]); warpAt(c[0], c[1], G.faceW * 1.1, 'bulge', K(.38 * s)); }
};
function jaw(G, dir, s) {
  const r = G.faceW * .22, mag = G.faceW * .06 * M() * s, c = G.center;
  for (let i = 3; i <= 13; i++) {
    const p = G.P[i], dx = c[0] - p[0], dy = c[1] - p[1], d = Math.hypot(dx, dy) || 1;
    pushSteps(p, r, -dir * dx / d * mag, -dir * dy / d * mag, 3);
  }
}

/* 自动贴纸 */
function addStk(o) { stickers.push(Object.assign({ r: 0, f: false }, o)); }
const deg = a => a * 180 / Math.PI;
const off = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
const STK = {
  shades: G => addStk({ e: '🕶️', x: G.eyeMid[0], y: G.eyeMid[1], s: G.eyeDist * 2.3, r: deg(G.ang) }),
  glasses: G => addStk({ d: 'glasses', x: G.eyeMid[0], y: G.eyeMid[1], s: G.eyeDist * 2.05, r: deg(G.ang) }),
  mustache: G => { const p = avg([G.P[33], G.P[51]]); addStk({ d: 'mustache', x: p[0], y: p[1], s: G.mouthW * 1.7, r: deg(G.ang) }); },
  clownNose: G => addStk({ d: 'clownNose', x: G.P[30][0], y: G.P[30][1], s: G.noseW * 1.25 }),
  blush: G => [avg([G.P[2], G.P[31], G.P[41]]), avg([G.P[14], G.P[35], G.P[46]])].forEach(p => addStk({ d: 'blush', x: p[0], y: p[1], s: G.eyeW * 2.1, r: deg(G.ang) })),
  unibrow: G => addStk({ d: 'unibrow', x: G.browMid[0], y: G.browMid[1], s: dist(G.P[17], G.P[26]) * .95, r: deg(G.ang) }),
  crown: G => { const p = off(G.browMid, G.up, G.faceH * .62); addStk({ e: '👑', x: p[0], y: p[1], s: G.faceW * .8, r: deg(G.ang) }); },
  hat: G => { const p = off(G.browMid, G.up, G.faceH * .66); addStk({ e: '🎩', x: p[0], y: p[1], s: G.faceW * 1.15, r: deg(G.ang) }); },
  pigNose: G => { const p = avg([G.P[30], G.P[33]]); addStk({ e: '🐽', x: p[0], y: p[1], s: G.noseW * 1.7, r: deg(G.ang) }); },
  sweat: G => { const p = off(G.P[16], G.up, G.faceH * .45); addStk({ e: '💦', x: p[0], y: p[1], s: G.eyeW * 1.5 }); }
};

/* 整套变身 */
const green = (r, g, b) => { const v = .3 * r + .59 * g + .11 * b; return [v * .62, v * 1.08 + 30, v * .55]; };
const COMBO = {
  alien: G => { FX.smallMouth(G, .8); FX.smallNose(G, .8); FX.thinFace(G, 1.4); FX.bigEyes(G, 1.5); tintFace(G, green, .75); FX.bigHead(G, .6); },
  doll: G => { FX.smallNose(G, .8); FX.smallMouth(G, .6); FX.thinFace(G, .9); FX.bigEyes(G, 1.25); FX.bigHead(G, .9); STK.blush(G); },
  frog: G => { FX.wideMouth(G, 1.6); FX.bigMouth(G, .7); FX.fatFace(G, 1); FX.bigEyes(G, 1.3); tintFace(G, green, .45); },
  pig: G => { FX.bigNose(G, 1.1); FX.fatFace(G, 1.3); FX.smallEyes(G, .7); tintFace(G, (r, g, b) => [r * 1.08 + 25, g * .85 + 10, b * .9 + 15], .5); STK.pigNose(G); },
  clown: G => { FX.bigMouth(G, 1); FX.wideMouth(G, 1); tintFace(G, (r, g, b) => [r * .4 + 160, g * .4 + 155, b * .4 + 155], .55); STK.clownNose(G); STK.blush(G); },
  random: G => {
    const ks = Object.keys(FX).sort(() => Math.random() - .5).slice(0, 3);
    ks.forEach(k => FX[k](G, .7 + Math.random() * .6));
    if (Math.random() < .7) { const sk = Object.keys(STK); STK[sk[Math.random() * sk.length | 0]](G); }
  }
};

function needFaces() {
  if (isDemo) { toast('先上传一张真人照片'); return false; }
  if (!modelsReady) { toast('模型还在加载，稍等一下'); return false; }
  if (!faces.length) { toast('没识别到脸，试试“重新识别”或用手动工具'); return false; }
  return true;
}
function runOnFaces(fn, warps = true) {
  if (!needFaces()) return;
  pushUndo();
  const panel = document.querySelector('.panel'); panel.classList.add('busy');
  setTimeout(() => {
    try { faces.map(geo).forEach(G => fn(G)); } catch (e) { console.error(e); toast('处理出错了'); }
    panel.classList.remove('busy'); sel = -1; render();
    if (warps) detect(true);
  }, 20);
}
$('aiFx').onclick = e => { const b = e.target.closest('button'); if (b) runOnFaces(G => FX[b.dataset.a](G)); };
$('aiCombo').onclick = e => { const b = e.target.closest('button'); if (b) runOnFaces(G => COMBO[b.dataset.c](G)); };
$('aiStk').onclick = e => { const b = e.target.closest('button'); if (b) runOnFaces(G => STK[b.dataset.s](G), false); };
$('redetect').onclick = () => { if (isDemo) return toast('先上传一张真人照片'); if (!modelsReady) return toast('模型还在加载'); detect(); };
$('showPts').onchange = () => render();

/* ================= 整图效果 ================= */
function ctr(rr) {
  let c = center, r = Math.min(W, H) * rr;
  if (!c && faces.length) { const G = geo(faces[0]); c = avg([G.center, G.eyeMid]); r = G.faceW * 1.1; }
  return [c || [W / 2, H * .42], r];
}
function radial(c, r, f) { remapAll((x, y) => { const dx = x - c[0], dy = y - c[1], d = Math.hypot(dx, dy); if (d >= r) return [x, y]; const k = f(d / r); return [c[0] + dx * k, c[1] + dy * k]; }); }
const midX = () => center ? center[0] : faces.length ? geo(faces[0]).center[0] : W / 2;
const FUN = {
  bighead: () => { const [c, r] = ctr(.36); radial(c, r, t => 1 - .5 * (1 - t * t)); },
  smallhead: () => { const [c, r] = ctr(.36); radial(c, r, t => 1 + .45 * (1 - t * t) * (1 - t)); },
  fisheye: () => radial([W / 2, H / 2], Math.hypot(W, H) / 2, t => .45 + .55 * t),
  thin: () => remapAll((x, y) => [W / 2 + (x - W / 2) * (1 + .55 * Math.sin(Math.PI * y / H)), y]),
  fat: () => remapAll((x, y) => [W / 2 + (x - W / 2) * (1 - .32 * Math.sin(Math.PI * y / H)), y]),
  longface: () => remapAll((x, y) => [W / 2 + (x - W / 2) * 1.25, H * Math.pow(y / H, 1.35)]),
  wave: () => remapAll((x, y) => [x + W * .02 * Math.sin(y / H * Math.PI * 8), y + H * .012 * Math.sin(x / W * Math.PI * 6)]),
  mirrorL: () => { const c = midX(); remapAll((x, y) => [x > c ? 2 * c - x : x, y]); },
  mirrorR: () => { const c = midX(); remapAll((x, y) => [x < c ? 2 * c - x : x, y]); },
  twist: () => { const [c, r] = ctr(.45); remapAll((x, y) => { const dx = x - c[0], dy = y - c[1], d = Math.hypot(dx, dy); if (d >= r) return [x, y]; const t = d / r, a = 2.2 * (1 - t) * (1 - t), cs = Math.cos(a), sn = Math.sin(a); return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs]; }); }
};
document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { pushUndo(); FUN[b.dataset.f](); render(); detect(true); });
$('setCenter').onclick = () => { pickCenter = true; $('setCenter').classList.add('on'); toast('在图上点一下中心位置'); };

/* ================= 滤镜 ================= */
const FLT = {
  gray: (r, g, b) => { const v = .3 * r + .59 * g + .11 * b; return [v, v, v]; },
  sepia: (r, g, b) => [.393 * r + .769 * g + .189 * b, .349 * r + .686 * g + .168 * b, .272 * r + .534 * g + .131 * b],
  invert: (r, g, b) => [255 - r, 255 - g, 255 - b],
  pop: (r, g, b) => { const v = (r + g + b) / 3; return [v + (r - v) * 2.2, v + (g - v) * 2.2, v + (b - v) * 2.2]; },
  poster: (r, g, b) => [Math.round(r / 64) * 64, Math.round(g / 64) * 64, Math.round(b / 64) * 64],
  hulk: (r, g, b) => { const v = .3 * r + .59 * g + .11 * b; return [v * .55, v * 1.15 + 20, v * .45]; },
  sunburn: (r, g, b) => [r * 1.25 + 25, g * .82, b * .78]
};
function applyFilter(n) {
  if (n === 'pixel') {
    const s = Math.max(6, Math.round(Math.max(W, H) / 70)), t = document.createElement('canvas');
    t.width = Math.ceil(W / s); t.height = Math.ceil(H / s); t.getContext('2d').drawImage(work, 0, 0, t.width, t.height);
    wctx.imageSmoothingEnabled = false; wctx.clearRect(0, 0, W, H); wctx.drawImage(t, 0, 0, W, H); wctx.imageSmoothingEnabled = true; return;
  }
  const d = wctx.getImageData(0, 0, W, H), D = d.data, f = FLT[n];
  for (let i = 0; i < D.length; i += 4) { const v = f(D[i], D[i + 1], D[i + 2]); D[i] = v[0]; D[i + 1] = v[1]; D[i + 2] = v[2]; }
  wctx.putImageData(d, 0, 0);
}
document.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { pushUndo(); applyFilter(b.dataset.x); render(); });

/* ================= 画布交互 ================= */
function pos(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; }
let down = false, last = null, cur = null, raf = 0, dragOff = null;
function hit(p) { for (let i = stickers.length - 1; i >= 0; i--) { const s = stickers[i]; if (Math.abs(p[0] - s.x) < s.s * .6 && Math.abs(p[1] - s.y) < s.s * .6) return i; } return -1; }
function updRing(e) {
  const ring = $('ring'); if (tab !== 'warp' || !e) { ring.style.display = 'none'; return; }
  const sr = $('stage').getBoundingClientRect(), d = $('size').value * cv.getBoundingClientRect().width / W;
  ring.style.display = 'block'; ring.style.width = ring.style.height = d + 'px';
  ring.style.left = (e.clientX - sr.left - d / 2) + 'px'; ring.style.top = (e.clientY - sr.top - d / 2) + 'px';
}
function loop() { if (!down) return; if (brush !== 'push' && cur) { warpAt(cur[0], cur[1], $('size').value / 2, brush, $('str').value * .012); render(); } raf = requestAnimationFrame(loop); }
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); const p = pos(e);
  if (pickCenter) { center = p; pickCenter = false; $('setCenter').classList.remove('on'); toast('中心点已设好，再点效果按钮'); return; }
  if (tab === 'stk' || tab === 'ai') {
    const i = hit(p); sel = i;
    if (i >= 0) { pushUndo(); down = true; dragOff = [p[0] - stickers[i].x, p[1] - stickers[i].y]; syncS(); }
    render(); return;
  }
  if (tab !== 'warp') return;
  pushUndo(); down = true; last = cur = p; loop();
});
cv.addEventListener('pointermove', e => {
  updRing(e); if (!down) return; const p = pos(e);
  if (tab !== 'warp') { if (sel >= 0) { stickers[sel].x = p[0] - dragOff[0]; stickers[sel].y = p[1] - dragOff[1]; render(); } return; }
  cur = p;
  if (brush === 'push') {
    const dx = p[0] - last[0], dy = p[1] - last[1];
    if (Math.hypot(dx, dy) > 1) { warpAt(last[0], last[1], $('size').value / 2, 'push', 0, dx * $('str').value / 6, dy * $('str').value / 6); last = p; render(); }
  }
});
const up = () => { const was = down && tab === 'warp'; down = false; cancelAnimationFrame(raf); if (was) detect(true); };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('pointerleave', () => $('ring').style.display = 'none');
cv.addEventListener('wheel', e => {
  if ((tab === 'stk' || tab === 'ai') && sel >= 0) { e.preventDefault(); const s = stickers[sel]; s.s = Math.max(20, Math.min(1200, s.s * (e.deltaY < 0 ? 1.08 : .92))); syncS(); render(); }
  else if (tab === 'warp') { e.preventDefault(); const z = $('size'); z.value = +z.value + (e.deltaY < 0 ? 8 : -8); updRing(e); }
}, { passive: false });

$('tabs').onclick = e => {
  const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t;
  [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.sec').forEach(s => s.classList.toggle('show', s.id === 'sec-' + tab));
  cv.style.cursor = tab === 'warp' ? 'crosshair' : (tab === 'stk' || tab === 'ai') ? 'move' : 'default';
  if (tab !== 'stk' && tab !== 'ai') { sel = -1; render(); }
};
$('brushes').onclick = e => { const b = e.target.closest('button'); if (!b) return; brush = b.dataset.b; [...$('brushes').children].forEach(x => x.classList.toggle('on', x === b)); };

/* 贴纸面板 */
function addCenter(o) { pushUndo(); addStk(Object.assign({ x: W / 2, y: H / 2, s: Math.round(Math.min(W, H) * .22) }, o)); sel = stickers.length - 1; syncS(); render(); }
Object.keys(DRAW).forEach(k => { const b = document.createElement('button'); b.textContent = DRAW_NAMES[k]; b.title = k; b.onclick = () => addCenter({ d: k }); $('draws').appendChild(b); });
'😎 🤓 🥸 🤡 👓 🕶️ 🎩 👑 🧢 🎓 🪖 👒 👄 💋 👅 👃 👀 👁️ 🦷 🥵 😂 🤣 😜 🤪 💩 🔥 💦 💢 💤 ❤️ ⭐ ✨ 🌈 🐷 🐽 🐶 🐱 🦄 🍕 🍌 🎉 💯'.split(' ').forEach(m => {
  const b = document.createElement('button'); b.textContent = m; b.onclick = () => addCenter({ e: m }); $('emojis').appendChild(b);
});
function syncS() { if (sel < 0) return; $('sSize').value = stickers[sel].s; $('sRot').value = stickers[sel].r; }
$('sSize').oninput = () => { if (sel >= 0) { stickers[sel].s = +$('sSize').value; render(); } };
$('sRot').oninput = () => { if (sel >= 0) { stickers[sel].r = +$('sRot').value; render(); } };
$('sFlip').onclick = () => { if (sel >= 0) { stickers[sel].f = !stickers[sel].f; render(); } };
$('sDel').onclick = () => { if (sel >= 0) { pushUndo(); stickers.splice(sel, 1); sel = -1; render(); } };
document.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && !/INPUT/.test(document.activeElement.tagName)) { pushUndo(); stickers.splice(sel, 1); sel = -1; render(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('undo').click(); }
});
['tTop', 'tBot', 'tSize', 'tColor'].forEach(id => $(id).oninput = () => render());

/* 上传：按钮 / 拖放 / 粘贴 */
$('file').onchange = e => { loadFile(e.target.files[0]); e.target.value = ''; };
const st = $('stage');
st.addEventListener('dragover', e => { e.preventDefault(); st.classList.add('drag'); });
st.addEventListener('dragleave', () => st.classList.remove('drag'));
st.addEventListener('drop', e => { e.preventDefault(); st.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });
window.addEventListener('paste', e => { const it = [...((e.clipboardData || {}).items || [])].find(i => i.type.startsWith('image/')); if (it) loadFile(it.getAsFile()); });

/* ================= 导出 ================= */
let dlCap = null;
try { if (window.claude && window.claude.use) window.claude.use('downloads').then(d => dlCap = d).catch(() => {}); } catch (e) {}
$('export').onclick = () => { render(false); $('outImg').src = cv.toDataURL('image/jpeg', .92); render(); $('modal').classList.add('show'); };
$('dl').onclick = async () => {
  const name = '搞怪脸_' + Date.now() + '.jpg', url = $('outImg').src;
  if (dlCap) {
    try {
      const b = atob(url.split(',')[1]), arr = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
      await dlCap.save({ filename: name, data: new Blob([arr], { type: 'image/jpeg' }) }); toast('已保存');
    } catch (e) { toast('未保存：可右键/长按图片保存'); }
    return;
  }
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
};
$('close').onclick = () => $('modal').classList.remove('show');
$('modal').onclick = e => { if (e.target.id === 'modal') $('modal').classList.remove('show'); };

demo();
initModels();
