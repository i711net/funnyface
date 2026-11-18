/* 搞怪脸工坊 app.js —— 纯前端，照片不离开浏览器
   结构：最多 4 个“格子”(cell)，每格独立的图片/贴纸/文字/识别结果/撤销记录。
   当前编辑格子的状态放在下面这些全局变量里，切换格子时 saveCell / loadCell 交换。 */
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
let work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
let W = 0, H = 0, orig = null, undoStack = [], stickers = [], sel = -1;
let tab = 'ai', brush = 'bulge', pickCenter = false, center = null;
let faces = [], origFaces = [], modelsReady = false, isDemo = false;
const MAX = 1200, UNDO_MAX = 15;

function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1900); }
function setStatus(msg, cls = '') { const s = $('status'); s.textContent = msg; s.className = 'status ' + cls; }
const clone = o => JSON.parse(JSON.stringify(o));

/* ================= 格子 ================= */
const LAYOUTS = { '1': [1, 1], '2v': [1, 2], '2h': [2, 1], '3h': [3, 1], '3v': [1, 3], '4': [2, 2] };
let layout = '1', active = 0;
const cellCount = () => LAYOUTS[layout][0] * LAYOUTS[layout][1];
function emptyCell() {
  const c = document.createElement('canvas');
  return { W: 0, H: 0, work: c, wctx: c.getContext('2d', { willReadFrequently: true }), orig: null, undo: [], stickers: [], sel: -1, center: null,
    faces: [], origFaces: [], isDemo: false, src: null, rotBase: null, detecting: false, dtoken: 0, txt: { top: '', bot: '', size: 9, color: '#ffffff', rt: 0, rb: 0 } };
}
function makeCell(img, demo = false) {
  const c = emptyCell(), s = Math.min(1, MAX / Math.max(img.width, img.height));
  c.W = c.work.width = Math.round(img.width * s); c.H = c.work.height = Math.round(img.height * s);
  c.wctx.drawImage(img, 0, 0, c.W, c.H);
  c.orig = c.wctx.getImageData(0, 0, c.W, c.H); c.src = { img: c.orig, W: c.W, H: c.H }; c.isDemo = demo;
  return c;
}
const cells = [emptyCell(), emptyCell(), emptyCell(), emptyCell()];
const isEmpty = c => !c.W || c.isDemo;

function saveCell() {
  Object.assign(cells[active], { W, H, work, wctx, orig, undo: undoStack, stickers, sel, center, faces, origFaces, isDemo,
    txt: { top: $('tTop').value, bot: $('tBot').value, size: +$('tSize').value, color: $('tColor').value, rt: +$('tRotT').value, rb: +$('tRotB').value } });
}
function loadCell(c) {
  ({ W, H, work, wctx, orig, stickers, sel, center, faces, origFaces, isDemo } = c); undoStack = c.undo;
  $('tTop').value = c.txt.top; $('tBot').value = c.txt.bot; $('tSize').value = c.txt.size; $('tColor').value = c.txt.color; $('tRotT').value = c.txt.rt || 0; $('tRotB').value = c.txt.rb || 0; showTxtRot(); syncS();
  c.rotBase = null; resetRotUI();
  if (W) { cv.width = W; cv.height = H; }
  $('empty').style.display = W ? 'none' : 'flex'; cv.style.display = W ? 'block' : 'none';
  $('emptyN').textContent = active + 1;
  zoom = 1; applyZoom(); updateStatus(); updateCellLabel();
}
function switchCell(i) {
  if (i === active || i >= cellCount()) return;
  saveCell(); cells[active].rotBase = null; active = i; loadCell(cells[i]); render();
}
function updateCellLabel() {
  const n = cellCount();
  $('cellLbl').innerHTML = n > 1 ? `正在编辑 <b>第 ${active + 1} 格</b> / 共 ${n} 格<br><small>点右边小图切换格子</small>` : '单图模式<br><small>选上面的版面可做多格拼图</small>';
  $('mini').style.display = n > 1 ? 'block' : 'none';
}
function setLayout(l) {
  layout = l;
  [...$('lays').children].forEach(b => b.classList.toggle('on', b.dataset.l === l));
  if (active >= cellCount()) { saveCell(); active = 0; loadCell(cells[0]); render(); }
  updateCellLabel(); schedulePreview(true);
}
function needImg() { if (!W) { toast(`第 ${active + 1} 格还没有照片，先上传`); return false; } return true; }

function updateStatus() {
  const c = cells[active];
  if (!c.W) return setStatus(`第 ${active + 1} 格还没有照片。点上方“📷 上传照片”（可以一次选多张，自动填进空格子）。`);
  if (c.isDemo) return setStatus(modelsReady ? '模型已就绪。点上方“📷 上传照片”，会自动识别五官。' : '正在加载人脸识别模型…', modelsReady ? 'ok' : '');
  if (!modelsReady) return setStatus('正在加载人脸识别模型…');
  if (c.detecting) return setStatus('正在识别人脸…');
  if (c.faces.length) setStatus(`识别到 ${c.faces.length} 张脸 ✓ 点下面的按钮开始恶搞`, 'ok');
  else setStatus('没识别到正脸（侧脸、太小、遮挡或卡通图可能识别不到）。可以用“变形刷”手动改。', 'err');
}

/* ================= 图片载入 ================= */
function putCell(i, c) {
  if (i === active) { cells[i] = c; loadCell(c); render(); }
  else { cells[i] = c; schedulePreview(true); }
  if (!c.isDemo) detect(false, true, c);
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
  putCell(0, makeCell(c, true));
}
function readImg(f) {
  return new Promise(res => {
    const u = URL.createObjectURL(f), img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); res(img); };
    img.onerror = () => { URL.revokeObjectURL(u); res(null); };
    img.src = u;
  });
}
async function loadFiles(list) {
  const files = [...(list || [])].filter(f => f && f.type && f.type.startsWith('image/'));
  if (!files.length) return toast('请选择图片文件');
  if (files.length > 1 && layout === '1') setLayout(files.length === 2 ? '2h' : files.length === 3 ? '3h' : '4');
  const n = cellCount(), targets = [active];
  for (let i = 0; i < n && targets.length < files.length; i++) if (i !== active && isEmpty(cells[i])) targets.push(i);
  let ok = 0;
  for (let k = 0; k < targets.length; k++) {
    const img = await readImg(files[k]);
    if (!img) { toast('有一张图片打不开，已跳过'); continue; }
    if (targets[k] === active) saveCell();
    putCell(targets[k], makeCell(img)); ok++;
  }
  if (files.length > targets.length) toast(`格子不够，只放了 ${targets.length} 张`);
  else if (ok > 1) toast(`已放入 ${ok} 张照片，点右上小图切换格子编辑`);
}

/* ================= 撤销 ================= */
function pushUndo() {
  if (!W) return;
  commitRot();
  undoStack.push({ img: wctx.getImageData(0, 0, W, H), W, H, orig, st: JSON.stringify(stickers), fc: JSON.stringify(faces), center });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}
function restoreImg(img, w, h) {
  W = w; H = h;
  if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
  wctx.setTransform(1, 0, 0, 1, 0, 0); wctx.putImageData(img, 0, 0);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; applyZoom(); }
}
$('undo').onclick = () => {
  const s = undoStack.pop(); if (!s) return toast('没有可以撤销的了');
  cells[active].rotBase = null; resetRotUI();
  restoreImg(s.img, s.W, s.H); orig = s.orig; stickers = JSON.parse(s.st); faces = JSON.parse(s.fc); center = s.center; sel = -1; render();
};
$('reset').onclick = () => {
  const c = cells[active]; if (!c.src) return;
  pushUndo(); restoreImg(c.src.img, c.src.W, c.src.H); orig = c.src.img;
  stickers = []; sel = -1; center = null; faces = clone(origFaces); $('tTop').value = $('tBot').value = ''; render(); toast('已还原这一格的原图');
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
function drawCell(g, c, showSel) {
  g.drawImage(c.work, 0, 0);
  c.stickers.forEach((s, i) => {
    g.save(); g.translate(s.x, s.y); g.rotate(s.r * Math.PI / 180); g.scale(s.f ? -1 : 1, 1);
    if (s.d) DRAW[s.d](g, s.s);
    else {
      g.font = s.s + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.e, 0, s.s * .06);
    }
    if (showSel && i === c.sel) {
      const k = handleR / 16;
      g.setLineDash([8 * k, 6 * k]); g.lineWidth = 3 * k; g.strokeStyle = '#ff6b35'; g.strokeRect(-s.s * .6, -s.s * .6, s.s * 1.2, s.s * 1.2);
      g.setLineDash([]); g.beginPath(); g.arc(s.s * .6, s.s * .6, handleR, 0, 7); g.fillStyle = '#ff6b35'; g.fill();
      g.lineWidth = 3 * k; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); const h = handleR * .45, hx = s.s * .6, hy = s.s * .6;
      g.moveTo(hx - h, hy - h); g.lineTo(hx + h, hy + h); g.moveTo(hx - h, hy - h); g.lineTo(hx - h * .2, hy - h); g.moveTo(hx - h, hy - h); g.lineTo(hx - h, hy - h * .2);
      g.moveTo(hx + h, hy + h); g.lineTo(hx + h * .2, hy + h); g.moveTo(hx + h, hy + h); g.lineTo(hx + h, hy + h * .2); g.stroke();
    }
    g.restore();
  });
  const T = c.txt, fs = Math.round(c.W * T.size / 100);
  if (T.top || T.bot) {
    g.save();
    g.font = `900 ${fs}px Impact,"Arial Black","Microsoft YaHei","PingFang SC",sans-serif`;
    g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = Math.max(3, fs / 7); g.strokeStyle = '#000'; g.fillStyle = T.color;
    g.textBaseline = 'middle';
    const line = (t, y, deg) => { g.save(); g.translate(c.W / 2, y); g.rotate((deg || 0) * Math.PI / 180); g.strokeText(t, 0, 0, c.W * .95); g.fillText(t, 0, 0, c.W * .95); g.restore(); };
    if (T.top) line(T.top, fs * .8, T.rt);
    if (T.bot) line(T.bot, c.H - fs * .8, T.rb);
    g.restore();
  }
  if (showSel && $('showPts').checked) {
    g.fillStyle = '#00e5ff';
    const r = Math.max(2, c.W / 400);
    c.faces.forEach(P => P.forEach(p => { g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill(); }));
  }
}
let handleR = 16;
function render(showSel = true) {
  saveCell();
  if (W) { const cw = cv.getBoundingClientRect().width; handleR = 16 * W / (cw || W); }
  if (W) { ctx.clearRect(0, 0, W, H); drawCell(ctx, cells[active], showSel); }
  schedulePreview();
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
    modelsReady = true; saveCell();
    updateStatus();
    for (const c of cells) if (c.W && !c.isDemo && !c.origFaces.length) await detect(false, true, c);
  } catch (e) {
    console.error(e);
    setStatus('识别模型加载失败（如果是直接双击打开 index.html，请改用网址访问或本地服务器）。手动工具照常能用。', 'err');
  }
}
/* 识别某个格子（默认当前格）。silent=编辑后静默更新，fresh=作为原图识别结果保存 */
async function detect(silent = false, fresh = false, c = null) {
  if (!c) { saveCell(); c = cells[active]; }
  if (!modelsReady || !c.W || c.isDemo) return;
  const token = ++c.dtoken, isCur = () => cells[active] === c;
  if (!silent) { c.detecting = true; if (isCur()) updateStatus(); }
  try {
    const res = await faceapi.detectAllFaces(c.work, new faceapi.SsdMobilenetv1Options({ minConfidence: .35, maxResults: 10 })).withFaceLandmarks();
    if (token !== c.dtoken) return;
    if (isCur()) saveCell();
    const found = res.map(r => r.landmarks.positions.map(p => [p.x, p.y]));
    if (!silent || found.length >= c.faces.length) c.faces = found;
    if (fresh) c.origFaces = clone(c.faces);
    if (!silent) c.detecting = false;
    if (isCur()) { faces = c.faces; origFaces = c.origFaces; updateStatus(); render(); }
  } catch (e) { console.error(e); c.detecting = false; if (!silent && isCur()) setStatus('识别出错了，可以点“重新识别”再试。', 'err'); }
}

/* ================= 脸部几何 ================= */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const avg = arr => [arr.reduce((s, p) => s + p[0], 0) / arr.length, arr.reduce((s, p) => s + p[1], 0) / arr.length];
function geo(P) {
  const R = (i, j) => avg(P.slice(i, j + 1));
  const eyeR = R(36, 41), eyeL = R(42, 47), eyeMid = avg([eyeR, eyeL]);
  const browMid = avg([P[19], P[24]]);
  const ux = browMid[0] - P[8][0], uy = browMid[1] - P[8][1], ul = Math.hypot(ux, uy) || 1;
  const up = [ux / ul, uy / ul], ang = Math.atan2(up[0], -up[1]);
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
  if (!needImg()) return false;
  if (isDemo) { toast('先上传一张真人照片'); return false; }
  if (!modelsReady) { toast('模型还在加载，稍等一下'); return false; }
  if (!faces.length) { toast('没识别到脸，试试“重新识别”或用手动工具'); return false; }
  return true;
}
let batchSeq = Date.now() % 100000;
function runOnFaces(fn, warps = true) {
  if (!needFaces()) return;
  pushUndo();
  const panel = document.querySelector('.panel'); panel.classList.add('busy');
  setTimeout(() => {
    const n0 = stickers.length;
    try { faces.map(geo).forEach(G => fn(G)); } catch (e) { console.error(e); toast('处理出错了'); }
    sel = -1;
    if (stickers.length > n0) { const b = ++batchSeq; for (let i = n0; i < stickers.length; i++) stickers[i].b = b; sel = stickers.length - 1; }
    panel.classList.remove('busy'); syncS(); render();
    if (warps) detect(true);
  }, 20);
}
$('aiFx').onclick = e => { const b = e.target.closest('button'); if (b) runOnFaces(G => FX[b.dataset.a](G)); };
$('aiCombo').onclick = e => { const b = e.target.closest('button'); if (b) runOnFaces(G => COMBO[b.dataset.c](G)); };
$('aiStk').onclick = e => { const b = e.target.closest('button'); if (b) runOnFaces(G => STK[b.dataset.s](G), false); };
$('redetect').onclick = () => { if (!needImg()) return; if (isDemo) return toast('先上传一张真人照片'); if (!modelsReady) return toast('模型还在加载'); detect(); };
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
document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { if (!needImg()) return; pushUndo(); FUN[b.dataset.f](); render(); detect(true); });
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
document.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { if (!needImg()) return; pushUndo(); applyFilter(b.dataset.x); render(); });


/* ================= 画面缩放 / 拖动 ================= */
const stage = $('stage');
var zoom = 1; let panMode = false, spaceDown = false, panning = null;
function fitScale() { return W ? Math.min((stage.clientWidth - 16) / W, (stage.clientHeight - 16) / H) : 1; }
function applyZoom() {
  if (!W) return; const s = fitScale() * zoom;
  cv.style.width = Math.max(1, W * s) + 'px'; cv.style.height = Math.max(1, H * s) + 'px';
  $('zVal').textContent = Math.round(zoom * 100) + '%';
}
function setZoom(z, ax, ay) {
  z = Math.max(.25, Math.min(8, z)); if (!W) return;
  const sr = stage.getBoundingClientRect();
  if (ax === undefined) { ax = sr.left + stage.clientWidth / 2; ay = sr.top + stage.clientHeight / 2; }
  const r = cv.getBoundingClientRect(), fx = (ax - r.left) / r.width, fy = (ay - r.top) / r.height;
  zoom = z; applyZoom();
  const r2 = cv.getBoundingClientRect();
  stage.scrollLeft += r2.left + fx * r2.width - ax; stage.scrollTop += r2.top + fy * r2.height - ay;
}
const scrollable = () => stage.scrollWidth > stage.clientWidth + 2 || stage.scrollHeight > stage.clientHeight + 2;
$('zIn').onclick = () => setZoom(zoom * 1.25);
$('zOut').onclick = () => setZoom(zoom / 1.25);
$('zFit').onclick = () => { zoom = 1; applyZoom(); };
$('zPan').onclick = () => { panMode = !panMode; $('zPan').classList.toggle('on', panMode); stage.classList.toggle('pan', panMode); toast(panMode ? '拖动画面模式：再点 ✋ 退出' : '已退出拖动模式'); };
document.addEventListener('keydown', e => { if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); if (!spaceDown) { spaceDown = true; stage.classList.add('pan'); $('ring').style.display = 'none'; } } });
document.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; stage.classList.toggle('pan', panMode); } });
stage.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false });
if (window.ResizeObserver) new ResizeObserver(() => applyZoom()).observe(stage); else window.addEventListener('resize', applyZoom);

/* ================= 画布交互 ================= */
// iPhone Safari 会用自带的双指缩放抢走手势，这里拦掉，交给下面的 pointer 事件处理
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
stage.addEventListener('touchmove', e => { if (e.touches.length > 1 || ptrs.size) e.preventDefault(); }, { passive: false });
stage.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
function pos(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; }
let down = false, last = null, cur = null, raf = 0, dragOff = null;
function hit(p) { for (let i = stickers.length - 1; i >= 0; i--) { const s = stickers[i]; if (Math.abs(p[0] - s.x) < s.s * .6 && Math.abs(p[1] - s.y) < s.s * .6) return i; } return -1; }
function updRing(e) {
  const ring = $('ring'); if (tab !== 'warp' || !e) { ring.style.display = 'none'; return; }
  if (panning || panMode || spaceDown) { ring.style.display = 'none'; return; }
  const d = $('size').value * cv.getBoundingClientRect().width / W;
  ring.style.display = 'block'; ring.style.width = ring.style.height = d + 'px';
  ring.style.left = (e.clientX - d / 2) + 'px'; ring.style.top = (e.clientY - d / 2) + 'px';
}
function loop() { if (!down) return; if (brush !== 'push' && cur) { warpAt(cur[0], cur[1], $('size').value / 2, brush, $('str').value * .012); render(); } raf = requestAnimationFrame(loop); }
/* 贴纸缩放手柄：把点转到贴纸自身坐标，看是否落在右下角手柄上 */
function hitHandle(p) {
  if (sel < 0 || !stickers[sel]) return false;
  const s = stickers[sel], a = -s.r * Math.PI / 180, dx = p[0] - s.x, dy = p[1] - s.y;
  let lx = dx * Math.cos(a) - dy * Math.sin(a); const ly = dx * Math.sin(a) + dy * Math.cos(a);
  if (s.f) lx = -lx;
  return Math.hypot(lx - s.s * .6, ly - s.s * .6) < handleR * 1.6;
}
const ptrs = new Map();
let pinch = null, handleDrag = null, pendingDeselect = false;
const stkTab = () => tab === 'stk' || tab === 'ai';
function twoPts() { const v = [...ptrs.values()]; return [v[0], v[1]]; }
function startPinch() {
  const [a, b] = twoPts(), d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
  down = false; cancelAnimationFrame(raf); handleDrag = null; panning = null; pendingDeselect = false;
  if (stkTab() && sel >= 0) pinch = { kind: 'stk', d0: d, a0: ang, s0: stickers[sel].s, r0: stickers[sel].r };
  else pinch = { kind: 'zoom', d0: d, z0: zoom };
  $('ring').style.display = 'none';
}
stage.addEventListener('pointerdown', e => {
  if (!W) return;
  if (e.target.closest && e.target.closest('#empty')) return;
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { startPinch(); return; }
  if (ptrs.size > 2) return;
  const p = pos(e);
  if (panMode || spaceDown || e.button === 1) { e.preventDefault(); panning = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; return; }
  if (pickCenter) { center = p; pickCenter = false; $('setCenter').classList.remove('on'); toast('中心点已设好，再点效果按钮'); return; }
  if (stkTab()) {
    if (hitHandle(p)) {
      const s = stickers[sel]; pushUndo();
      handleDrag = { s0: s.s, r0: s.r, d0: Math.hypot(p[0] - s.x, p[1] - s.y) || 1, a0: Math.atan2(p[1] - s.y, p[0] - s.x) };
      return;
    }
    const i = hit(p);
    if (i >= 0) { sel = i; pushUndo(); down = true; dragOff = [p[0] - stickers[i].x, p[1] - stickers[i].y]; syncS(); render(); }
    else pendingDeselect = sel >= 0;   // 等手指抬起再取消选中，方便双指捏合
    return;
  }
  if (tab !== 'warp') return;
  pushUndo(); down = true; last = cur = p; loop();
});
stage.addEventListener('pointermove', e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) {
    if (ptrs.size < 2) return;
    const [a, b] = twoPts(), d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (pinch.kind === 'stk' && stickers[sel]) {
      const s = stickers[sel];
      s.s = Math.max(15, Math.min(3000, pinch.s0 * d / pinch.d0));
      s.r = Math.round(normDeg(pinch.r0 + (ang - pinch.a0) * 180 / Math.PI)); syncS(); render();
    } else setZoom(pinch.z0 * d / pinch.d0, (a.x + b.x) / 2, (a.y + b.y) / 2);
    return;
  }
  if (handleDrag && stickers[sel]) {
    const p = pos(e), s = stickers[sel], d = Math.hypot(p[0] - s.x, p[1] - s.y);
    s.s = Math.max(15, Math.min(3000, handleDrag.s0 * d / handleDrag.d0));
    s.r = Math.round(normDeg(handleDrag.r0 + (Math.atan2(p[1] - s.y, p[0] - s.x) - handleDrag.a0) * 180 / Math.PI));
    syncS(); render(); return;
  }
  if (panning) { stage.scrollLeft = panning.l - (e.clientX - panning.x); stage.scrollTop = panning.t - (e.clientY - panning.y); return; }
  updRing(e); if (!down) return; const p = pos(e);
  if (tab !== 'warp') { if (sel >= 0) { stickers[sel].x = p[0] - dragOff[0]; stickers[sel].y = p[1] - dragOff[1]; render(); } return; }
  cur = p;
  if (brush === 'push') {
    const dx = p[0] - last[0], dy = p[1] - last[1];
    if (Math.hypot(dx, dy) > 1) { warpAt(last[0], last[1], $('size').value / 2, 'push', 0, dx * $('str').value / 6, dy * $('str').value / 6); last = p; render(); }
  }
});
const up = e => {
  ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) pinch = null; return; }
  handleDrag = null; panning = null;
  if (pendingDeselect) { pendingDeselect = false; sel = -1; render(); }
  const was = down && tab === 'warp'; down = false; cancelAnimationFrame(raf); if (was) detect(true);
};
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
stage.addEventListener('pointerleave', () => $('ring').style.display = 'none');
cv.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); return; }
  if ((tab === 'stk' || tab === 'ai') && sel >= 0) { e.preventDefault(); const s = stickers[sel]; s.s = Math.max(10, Math.min(3000, s.s * (e.deltaY < 0 ? 1.08 : .92))); syncS(); render(); }
  else if (tab === 'warp' && !scrollable()) { e.preventDefault(); const z = $('size'); z.value = +z.value + (e.deltaY < 0 ? 8 : -8); updRing(e); }
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
function addCenter(o) { if (!needImg()) return; pushUndo(); addStk(Object.assign({ x: W / 2, y: H / 2, s: Math.round(Math.min(W, H) * .22) }, o)); sel = stickers.length - 1; syncS(); render(); }
Object.keys(DRAW).forEach(k => { const b = document.createElement('button'); b.textContent = DRAW_NAMES[k]; b.title = k; b.onclick = () => addCenter({ d: k }); $('draws').appendChild(b); });
'😎 🤓 🥸 🤡 👓 🕶️ 🎩 👑 🧢 🎓 🪖 👒 👄 💋 👅 👃 👀 👁️ 🦷 🥵 😂 🤣 😜 🤪 💩 🔥 💦 💢 💤 ❤️ ⭐ ✨ 🌈 🐷 🐽 🐶 🐱 🦄 🍕 🍌 🎉 💯'.split(' ').forEach(m => {
  const b = document.createElement('button'); b.textContent = m; b.onclick = () => addCenter({ e: m }); $('emojis').appendChild(b);
});
/* 选中贴纸的控制（贴纸页 s* 和 AI 页 a* 两套，共用逻辑） */
/* 大小滑块用对数刻度：0~1000 对应 10~3000 像素，小贴纸也能细调 */
const v2size = v => 10 * Math.pow(300, v / 1000), size2v = sz => Math.round(1000 * Math.log(Math.max(10, sz) / 10) / Math.log(300));
function group(withAll) {
  const s = stickers[sel]; if (!s) return [];
  return withAll && s.b ? stickers.filter(t => t.b === s.b) : [s];
}
function syncS() {
  const s = stickers[sel], on = !!s;
  ['s', 'a'].forEach(k => {
    if (on) {
      $(k + 'Size').value = size2v(s.s); $(k + 'Rot').value = s.r; $(k + 'RotV').textContent = Math.round(s.r) + '°';
    }
  });
  document.querySelector('.stkctl').classList.toggle('dis', !on);
  $('aHint').textContent = on ? (s.b && $('aAll').checked && group(true).length > 1 ? `已选中这一批 ${group(true).length} 个贴纸，滑块会一起调整。` : '已选中贴纸，用滑块调整。') : '先点一下图上的贴纸选中它，再用下面的滑块调整。';
}
function bindCtl(k, allFn) {
  let sliding = false;
  const begin = () => { if (!sliding) { pushUndo(); sliding = true; } };
  const end = () => { sliding = false; };
  $(k + 'Size').addEventListener('input', () => {
    const s = stickers[sel]; if (!s) return toast('先点一下图上的贴纸选中它');
    begin(); const nv = v2size(+$(k + 'Size').value), f = nv / s.s;
    group(allFn()).forEach(t => { t.s = t === s ? nv : Math.max(10, t.s * f); }); render(); syncS();
  });
  $(k + 'Rot').addEventListener('input', () => {
    const s = stickers[sel]; if (!s) return toast('先点一下图上的贴纸选中它');
    begin(); const nv = +$(k + 'Rot').value, d = nv - s.r;
    group(allFn()).forEach(t => { t.r = t === s ? nv : Math.round(normDeg(t.r + d)); }); render(); syncS();
  });
  ['Size', 'Rot'].forEach(x => $(k + x).addEventListener('change', end));
  $(k + 'Flip').onclick = () => { if (sel < 0) return toast('先点一下图上的贴纸选中它'); pushUndo(); group(allFn()).forEach(t => t.f = !t.f); render(); };
  $(k + 'Del').onclick = () => {
    if (sel < 0) return toast('先点一下图上的贴纸选中它');
    pushUndo(); const g = group(allFn()); stickers = stickers.filter(t => !g.includes(t)); sel = -1; syncS(); render();
  };
}
function stepStk(k, op) {
  const s = stickers[sel]; if (!s) return toast('先点一下图上的贴纸选中它');
  pushUndo();
  const g = group(k === 'a' && $('aAll').checked);
  if (op === 's+' || op === 's-') { const f = op === 's+' ? 1.1 : 1 / 1.1; g.forEach(t => t.s = Math.max(10, Math.min(3000, t.s * f))); }
  else { const d = op === 'r+' ? 5 : -5; g.forEach(t => t.r = Math.round(normDeg(t.r + d))); }
  syncS(); render();
}
document.querySelectorAll('button.sm[data-op]').forEach(b => b.onclick = () => stepStk(b.dataset.k, b.dataset.op));
document.querySelectorAll('button.sm[data-t]').forEach(b => b.onclick = () => {
  const r = $(b.dataset.t); r.value = Math.max(-180, Math.min(180, +r.value + +b.dataset.d)); showTxtRot(); render();
});
bindCtl('s', () => false);
bindCtl('a', () => $('aAll').checked);
$('aAll').onchange = syncS;
document.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && !/INPUT/.test(document.activeElement.tagName)) { pushUndo(); stickers.splice(sel, 1); sel = -1; render(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('undo').click(); }
});
function showTxtRot() { $('tRotTV').textContent = $('tRotT').value + '°'; $('tRotBV').textContent = $('tRotB').value + '°'; }
['tTop', 'tBot', 'tSize', 'tColor', 'tRotT', 'tRotB'].forEach(id => $(id).oninput = () => { showTxtRot(); render(); });

/* ================= 旋转 / 翻转（当前格） ================= */
const normDeg = d => { d = ((d + 180) % 360 + 360) % 360 - 180; return d; };
function snapState() {
  const cp = document.createElement('canvas'); cp.width = W; cp.height = H; cp.getContext('2d').drawImage(work, 0, 0);
  return { work: cp, W, H, orig, st: JSON.stringify(stickers), fc: JSON.stringify(faces), center };
}
/* 用矩阵 m 把 base 状态变换到 nw×nh 的新画布；贴纸、五官点、中心点同步变换 */
function applyMatrix(base, nw, nh, m, stkFn, scale = 1) {
  const nc = document.createElement('canvas'); nc.width = nw; nc.height = nh;
  const g = nc.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.setTransform(m); g.drawImage(base.work, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
  const oc = document.createElement('canvas'); oc.width = base.W; oc.height = base.H; oc.getContext('2d').putImageData(base.orig, 0, 0);
  const o2 = document.createElement('canvas'); o2.width = nw; o2.height = nh; const og = o2.getContext('2d');
  og.setTransform(m); og.drawImage(oc, 0, 0);
  const mp = p => { const q = m.transformPoint(new DOMPoint(p[0], p[1])); return [q.x, q.y]; };
  W = nw; H = nh; work = nc; wctx = g; orig = og.getImageData(0, 0, nw, nh);
  stickers = JSON.parse(base.st).map(s => { const q = mp([s.x, s.y]); s.x = q[0]; s.y = q[1]; s.s *= scale; stkFn(s); s.r = Math.round(normDeg(s.r)); return s; });
  faces = JSON.parse(base.fc).map(P => P.map(mp));
  center = base.center ? mp(base.center) : null; sel = -1;
  cv.width = W; cv.height = H; applyZoom(); render();
}
function rotateFrom(base, deg, fill) {
  const a = deg * Math.PI / 180, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
  let nw, nh, s = 1;
  if (fill && deg % 90 !== 0) { nw = base.W; nh = base.H; s = Math.max((base.W * cs + base.H * sn) / base.W, (base.W * sn + base.H * cs) / base.H); }
  else { nw = Math.round(base.W * cs + base.H * sn); nh = Math.round(base.W * sn + base.H * cs); }
  const m = new DOMMatrix().translate(nw / 2, nh / 2).rotate(deg).scale(s).translate(-base.W / 2, -base.H / 2);
  applyMatrix(base, nw, nh, m, st => { st.r += deg; }, s);
}
function resetRotUI() { $('rot').value = 0; $('rotVal').textContent = '0°'; }
function commitRot() { const c = cells[active]; if (c.rotBase) { c.rotBase = null; resetRotUI(); } }
function liveRotate(v) {
  if (!needImg()) { resetRotUI(); return; }
  const c = cells[active];
  if (!c.rotBase) { pushUndo(); c.rotBase = snapState(); }
  $('rot').value = v; $('rotVal').textContent = v + '°';
  rotateFrom(c.rotBase, +v, $('rotFill').checked);
}
$('rot').oninput = () => liveRotate($('rot').value);
$('rotM1').onclick = () => liveRotate(Math.max(-180, +$('rot').value - 1));
$('rotP1').onclick = () => liveRotate(Math.min(180, +$('rot').value + 1));
$('rotFill').onchange = () => { const c = cells[active]; if (c.rotBase) rotateFrom(c.rotBase, +$('rot').value, $('rotFill').checked); };
$('rotL90').onclick = () => { if (!needImg()) return; pushUndo(); rotateFrom(snapState(), -90, false); };
$('rotR90').onclick = () => { if (!needImg()) return; pushUndo(); rotateFrom(snapState(), 90, false); };
$('flipH').onclick = () => { if (!needImg()) return; pushUndo(); applyMatrix(snapState(), W, H, new DOMMatrix().translate(W, 0).scale(-1, 1), s => { s.f = !s.f; s.r = -s.r; }); };
$('flipV').onclick = () => { if (!needImg()) return; pushUndo(); applyMatrix(snapState(), W, H, new DOMMatrix().translate(0, H).scale(1, -1), s => { s.f = !s.f; s.r = 180 - s.r; }); };

/* ================= 版面拼图 ================= */
const RATIOS = { auto: 0, '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '2:3': 2 / 3, '3:2': 3 / 2, '9:16': 9 / 16, '16:9': 16 / 9 };
function collageOpts() {
  return { ratio: $('cRatio').value, fit: $('cFit').value, gap: +$('cGap').value, color: $('cColor').value, radius: +$('cRadius').value, cap: $('cCap').value.trim(), capColor: $('cCapColor').value };
}
/* 把版面画到 target 画布上；Lm=长边像素。返回每格的矩形（用于点击小图切换） */
function compose(target, Lm, preview = false) {
  saveCell();
  const [cols, rows] = LAYOUTS[layout], n = cols * rows, o = collageOpts();
  let a = RATIOS[o.ratio];
  if (!a) { const f = cells.slice(0, n).find(c => c.W); const ca = f ? f.W / f.H : 3 / 4; a = cols * ca / rows; }
  let TW, TH; if (a >= 1) { TW = Lm; TH = Lm / a; } else { TH = Lm; TW = Lm * a; }
  const multi = n > 1, g = multi ? o.gap / 1000 * Math.max(TW, TH) : 0, rad = multi ? o.radius / 1000 * Math.max(TW, TH) : 0;  // 单图不加边框
  const capH = o.cap ? Math.max(TW, TH) * .09 : 0;
  target.width = Math.round(TW); target.height = Math.round(TH + capH);
  const x = target.getContext('2d');
  x.fillStyle = o.color; x.fillRect(0, 0, target.width, target.height);
  const cw = (TW - g * (cols + 1)) / cols, ch = (TH - g * (rows + 1)) / rows, rects = [];
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const i = r * cols + col, rx = g + col * (cw + g), ry = g + r * (ch + g), c = cells[i];
    rects.push([rx, ry, cw, ch]);
    x.save(); x.beginPath();
    if (rad > 0 && x.roundRect) x.roundRect(rx, ry, cw, ch, rad); else x.rect(rx, ry, cw, ch);
    x.clip();
    if (c.W) {
      const s = o.fit === 'cover' ? Math.max(cw / c.W, ch / c.H) : Math.min(cw / c.W, ch / c.H);
      x.translate(rx + cw / 2, ry + ch / 2); x.scale(s, s); x.translate(-c.W / 2, -c.H / 2);
      drawCell(x, c, false);
    } else if (preview) {
      x.fillStyle = 'rgba(128,128,128,.18)'; x.fillRect(rx, ry, cw, ch);
      x.fillStyle = 'rgba(80,80,80,.7)'; x.font = `bold ${Math.min(cw, ch) * .35}px system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(preview ? '+' : '', rx + cw / 2, ry + ch / 2);
    }
    x.restore();
    if (preview && i === active) { x.strokeStyle = '#ff6b35'; x.lineWidth = Math.max(3, Lm / 45); x.strokeRect(rx + 1, ry + 1, cw - 2, ch - 2); }
  }
  if (capH) {
    const fs = capH * .5;
    x.fillStyle = o.capColor; x.font = `900 ${fs}px "Microsoft YaHei","PingFang SC",system-ui,sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(o.cap, TW / 2, TH + capH / 2 - g * .3, TW * .92);
  }
  return rects;
}
let miniRects = [], prevT = 0, prevPending = false;
function schedulePreview(force = false) {
  if (cellCount() < 2 || prevPending) return;
  const wait = force ? 0 : Math.max(0, 150 - (performance.now() - prevT));
  prevPending = true;
  setTimeout(() => requestAnimationFrame(() => { prevPending = false; prevT = performance.now(); miniRects = compose($('mini'), 240, true); }), wait);
}
$('mini').addEventListener('click', e => {
  const r = $('mini').getBoundingClientRect(), x = (e.clientX - r.left) * $('mini').width / r.width, y = (e.clientY - r.top) * $('mini').height / r.height;
  const i = miniRects.findIndex(q => x >= q[0] && x <= q[0] + q[2] && y >= q[1] && y <= q[1] + q[3]);
  if (i >= 0) switchCell(i);
});
$('lays').onclick = e => { const b = e.target.closest('button'); if (b) setLayout(b.dataset.l); };
['cRatio', 'cFit', 'cGap', 'cColor', 'cRadius', 'cCap', 'cCapColor'].forEach(id => $(id).addEventListener('input', () => schedulePreview(true)));
document.querySelectorAll('.swatch').forEach(b => b.onclick = () => { $('cColor').value = b.dataset.c; schedulePreview(true); });
$('empty').onclick = () => $('file').click();

/* 上传：按钮 / 拖放 / 粘贴 */
$('file').onchange = e => { loadFiles(e.target.files); e.target.value = ''; };
const st = $('stage');
st.addEventListener('dragover', e => { e.preventDefault(); st.classList.add('drag'); });
st.addEventListener('dragleave', () => st.classList.remove('drag'));
st.addEventListener('drop', e => { e.preventDefault(); st.classList.remove('drag'); loadFiles(e.dataTransfer.files); });
window.addEventListener('paste', e => { const fs = [...((e.clipboardData || {}).items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()); if (fs.length) loadFiles(fs); });

/* ================= 导出 ================= */
let dlCap = null;
try { if (window.claude && window.claude.use) window.claude.use('downloads').then(d => dlCap = d).catch(() => {}); } catch (e) {}
$('export').onclick = () => {
  saveCell();
  const n = cellCount(), used = cells.slice(0, n), filled = used.filter(c => c.W).length;
  if (!filled) return toast('还没有照片可以导出');
  const out = document.createElement('canvas');
  const Lm = n === 1 ? Math.max(cells[0].W, cells[0].H) : 2000;
  compose(out, Lm, false);
  $('outImg').src = out.toDataURL('image/jpeg', .92);
  $('modal').classList.add('show');
  if (filled < n) toast(`还有 ${n - filled} 格没放照片`);
};
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

loadCell(cells[0]);
demo();
initModels();
