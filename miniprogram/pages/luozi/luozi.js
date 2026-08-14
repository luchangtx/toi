// pages/luozi/luozi.js
// 《落字》：改变重力方向，部件滑入槽位拼出汉字
// 体感模式：物理倾斜手机改变重力（绝对重力映射）；按钮模式后备；无尽模式：动态生成关卡
const { createGame, rotate, slotFilled, DIRS } = require('../../utils/luoziCore');
const { LEVELS } = require('../../utils/luoziLevels');
const { createSignCalib, feedSignCalib, createTilt, feed } = require('../../utils/luoziTilt');
const { generateLevel, solveState, cloneState } = require('../../utils/luoziGen');

const STORE_KEY = 'luozi_progress';
const MODE_KEY = 'luozi_mode';
const MIRROR_KEY = 'luozi_mirror';
const SIGN_KEY = 'luozi_sign';
const ENDLESS_KEY = 'luozi_endless';
const TAU = Math.PI * 2;

const C = {
  boardBg: 'rgba(255,255,255,0.03)',
  boardBorder: 'rgba(255,255,255,0.10)',
  gridLine: 'rgba(255,255,255,0.045)',
  wallFill: 'rgba(129,140,248,0.18)',
  wallBorder: 'rgba(129,140,248,0.5)',
  slotBorder: 'rgba(255,255,255,0.32)',
  slotGhost: 'rgba(255,255,255,0.20)',
  tileFill: 'rgba(255,255,255,0.07)',
  tileBorder: 'rgba(255,255,255,0.20)',
  tileGlyph: '#e0e0e0',
  lockFill: 'rgba(255,215,0,0.12)',
  lockBorder: 'rgba(255,215,0,0.85)',
  lockGlyph: '#ffd700',
};

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInQuad(t) { return t * t; }
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glyphFont(px) {
  return Math.round(px) + 'px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
}

function loadProgress() {
  try {
    const p = wx.getStorageSync(STORE_KEY);
    if (p && typeof p === 'object') {
      return {
        unlocked: Math.min(Math.max(p.unlocked || 1, 1), LEVELS.length),
        stars: p.stars || {},
        last: typeof p.last === 'number' ? p.last : 0,
      };
    }
  } catch (e) { /* ignore */ }
  return { unlocked: 1, stars: {}, last: 0 };
}

function loadMode() {
  try {
    if (wx.getStorageSync(MODE_KEY) === 'button') return 'button';
  } catch (e) { /* ignore */ }
  return 'tilt';
}

function loadSign() {
  try {
    const s = wx.getStorageSync(SIGN_KEY);
    if (s === 1 || s === -1) return s;
  } catch (e) { /* ignore */ }
  return 0;
}

function loadEndlessRec() {
  try {
    const r = wx.getStorageSync(ENDLESS_KEY);
    if (r && typeof r === 'object') {
      return {
        cleared: r.cleared || 0,
        recent: Array.isArray(r.recent) ? r.recent.slice(-6) : [],
        current: r.current && typeof r.current === 'object' ? r.current : null,
      };
    }
  } catch (e) { /* ignore */ }
  return { cleared: 0, recent: [], current: null };
}

function endlessTier(cleared) {
  if (cleared < 3) return 0;
  if (cleared < 8) return 1;
  if (cleared < 15) return 2;
  return 3;
}

Page({
  data: {
    levelIndex: 0,
    total: LEVELS.length,
    moves: 0,
    par: 0,
    targetChar: '',
    hint: '',
    won: false,
    stars: 0,
    allCleared: false,
    pickerOpen: false,
    pickerLevels: [],
    mode: 'tilt',
    tiltStatus: '',
    endless: false,
    endlessCleared: 0,
  },

  onLoad() {
    this.progress = loadProgress();
    this.mode = loadMode();
    this._sign = loadSign();
    try { this._mirror = !!wx.getStorageSync(MIRROR_KEY); } catch (e) { this._mirror = false; }
    this._endlessRec = loadEndlessRec();
    this.endless = false;
    this.setData({ mode: this.mode, endlessCleared: this._endlessRec.cleared });
    const idx = Math.min(Math.max(this.progress.last, 0), this.progress.unlocked - 1, LEVELS.length - 1);
    this.loadLevel(idx);
  },

  onReady() {
    this.initCanvas();
  },

  onShow() {
    this.startLoop();
    if (this.mode === 'tilt') this.ensureAccel();
  },

  onHide() {
    this.stopLoop();
    this.stopAccel();
  },

  onUnload() {
    this.stopLoop();
    this.stopAccel();
    if (this._winTimer) clearTimeout(this._winTimer);
    if (this._tiltTimer) clearTimeout(this._tiltTimer);
  },

  // ---------- 画布 ----------
  initCanvas() {
    wx.createSelectorQuery().in(this)
      .select('#board')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        let dpr = 2;
        try { dpr = wx.getWindowInfo().pixelRatio || 2; } catch (e) { /* ignore */ }
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        this._canvas = canvas;
        this._ctx = ctx;
        this._cw = res[0].width;
        this._ch = res[0].height;
        this.computeLayout();
        this.startLoop();
      });
  },

  computeLayout() {
    const lv = this._level;
    if (!lv) return;
    const m = 12;
    const availW = this._cw - m * 2;
    const availH = this._ch - m * 2;
    // 旋转 90° 后宽高互换，取两种朝向都能放下的尺寸
    const cell = Math.min(availW / lv.w, availH / lv.h, availW / lv.h, availH / lv.w);
    const bw = lv.w * cell;
    const bh = lv.h * cell;
    this._layout = {
      cell,
      bw,
      bh,
      bx: (this._cw - bw) / 2,
      by: (this._ch - bh) / 2,
      cx: this._cw / 2,
      cy: this._ch / 2,
    };
  },

  startLoop() {
    if (this._raf || !this._canvas) return;
    const draw = () => {
      this.renderFrame();
      this._raf = this._canvas.requestAnimationFrame(draw);
    };
    this._raf = this._canvas.requestAnimationFrame(draw);
  },

  stopLoop() {
    if (this._raf && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  worldToScreen(wx, wy, cos, sin, L) {
    const lx = L.bx + (wx + 0.5) * L.cell;
    const ly = L.by + (wy + 0.5) * L.cell;
    const dx = lx - L.cx;
    const dy = ly - L.cy;
    return { x: L.cx + dx * cos - dy * sin, y: L.cy + dx * sin + dy * cos };
  },

  renderFrame() {
    const ctx = this._ctx;
    const L = this._layout;
    if (!ctx || !L || !this.state) return;
    const now = Date.now();
    const dt = Math.min(0.064, (now - (this._lastFrame || now)) / 1000);
    this._lastFrame = now;
    const lv = this._level;

    // 推进旋转动画（仅按钮模式）
    if (this.phase === 'rotating' && this._rot) {
      const r = this._rot;
      const t = clamp01((now - r.start) / r.dur);
      this.angleVis = r.from + (r.to - r.from) * easeOutCubic(t);
      if (t >= 1) {
        this.angleVis = r.to;
        this._rot = null;
        this.applyRotation(r.dir);
      }
    } else {
      this.angleVis = this.angle;
    }

    // 推进下落动画
    let fallEase = 0;
    if (this.phase === 'falling' && this._fall) {
      const f = this._fall;
      const t = clamp01((now - f.start) / f.dur);
      fallEase = easeInQuad(t);
      if (t >= 1) {
        this._fall = null;
        this.afterSettle(f.locked, f.won);
      }
    }

    const A = this.angleVis || 0;
    const cos = Math.cos(A);
    const sin = Math.sin(A);

    ctx.clearRect(0, 0, this._cw, this._ch);

    // 1) 随容器旋转的部分：底盘、网格、墙、槽位框
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.rotate(A);
    ctx.translate(-L.cx, -L.cy);

    roundRect(ctx, L.bx - 7, L.by - 7, L.bw + 14, L.bh + 14, 16);
    ctx.fillStyle = C.boardBg;
    ctx.fill();
    ctx.strokeStyle = C.boardBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    for (let i = 1; i < lv.w; i++) {
      ctx.beginPath();
      ctx.moveTo(L.bx + i * L.cell, L.by);
      ctx.lineTo(L.bx + i * L.cell, L.by + L.bh);
      ctx.stroke();
    }
    for (let j = 1; j < lv.h; j++) {
      ctx.beginPath();
      ctx.moveTo(L.bx, L.by + j * L.cell);
      ctx.lineTo(L.bx + L.bw, L.by + j * L.cell);
      ctx.stroke();
    }

    for (const w of this.state.walls) {
      const x = L.bx + w.x * L.cell;
      const y = L.by + w.y * L.cell;
      roundRect(ctx, x + 2, y + 2, L.cell - 4, L.cell - 4, L.cell * 0.14);
      ctx.fillStyle = C.wallFill;
      ctx.fill();
      ctx.strokeStyle = C.wallBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = C.slotBorder;
    ctx.lineWidth = 1.2;
    for (const s of this.state.slots) {
      if (slotFilled(this.state, s)) continue;
      const x = L.bx + s.x * L.cell;
      const y = L.by + s.y * L.cell;
      roundRect(ctx, x + 3, y + 3, L.cell - 6, L.cell - 6, L.cell * 0.16);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // 2) 屏幕空间正立的文字与部件
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const s of this.state.slots) {
      if (slotFilled(this.state, s)) continue;
      const p = this.worldToScreen(s.x, s.y, cos, sin, L);
      ctx.font = glyphFont(L.cell * 0.56);
      ctx.fillStyle = C.slotGhost;
      ctx.fillText(s.c, p.x, p.y + L.cell * 0.03);
    }

    for (const pc of this.state.pieces) {
      let px = pc.x;
      let py = pc.y;
      if (this.phase === 'falling' && this._fall) {
        const mv = this._fall.byId[pc.id];
        if (mv) {
          px = mv.from.x + (mv.to.x - mv.from.x) * fallEase;
          py = mv.from.y + (mv.to.y - mv.from.y) * fallEase;
        }
      }
      const p = this.worldToScreen(px, py, cos, sin, L);
      const s = L.cell;
      const half = s / 2 - 3;
      if (pc.locked) {
        ctx.shadowColor = 'rgba(255,215,0,0.45)';
        ctx.shadowBlur = 12;
        roundRect(ctx, p.x - half, p.y - half, half * 2, half * 2, s * 0.18);
        ctx.fillStyle = C.lockFill;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = C.lockBorder;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        roundRect(ctx, p.x - half, p.y - half, half * 2, half * 2, s * 0.18);
        ctx.fillStyle = C.tileFill;
        ctx.fill();
        ctx.strokeStyle = C.tileBorder;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.font = glyphFont(s * 0.56);
      ctx.fillStyle = pc.locked ? C.lockGlyph : C.tileGlyph;
      ctx.fillText(pc.c, p.x, p.y + s * 0.03);
    }

    // 3) 锁定涟漪
    if (this._effects.length) {
      this._effects = this._effects.filter((fx) => {
        const t = (now - fx.start) / fx.dur;
        if (t >= 1) return false;
        const p = this.worldToScreen(fx.x, fx.y, cos, sin, L);
        ctx.beginPath();
        ctx.arc(p.x, p.y, L.cell * (0.42 + 0.45 * t), 0, TAU);
        ctx.strokeStyle = 'rgba(255,215,0,' + (0.55 * (1 - t)).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
        return true;
      });
    }

    // 4) 体感模式：重力方向指示
    if (this.mode === 'tilt') this.drawGravityArrow(ctx, now, dt);
  },

  drawGravityArrow(ctx, now, dt) {
    const g = this.state.grav;
    const target = Math.atan2(DIRS[g].dy, DIRS[g].dx);
    if (this._arrowAngle === undefined) this._arrowAngle = target;
    let d = target - this._arrowAngle;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this._arrowAngle += d * Math.min(1, dt * 14);

    const cx = this._cw - 34;
    const cy = 34;
    const r = 19;
    const ready = this._tilt && !this._tilt.flat;
    const a = this._arrowAngle;
    const ux = Math.cos(a);
    const uy = Math.sin(a);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = ready ? 'rgba(255,215,0,0.55)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    const tipX = cx + ux * r * 0.62;
    const tipY = cy + uy * r * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx - ux * r * 0.45, cy - uy * r * 0.45);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = ready ? '#ffd700' : 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const sgn of [0.82, -0.82]) {
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(a + Math.PI * sgn) * r * 0.34, tipY + Math.sin(a + Math.PI * sgn) * r * 0.34);
      ctx.stroke();
    }

    if (!ready) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4 + pulse * 3, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.10 + 0.08 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  },

  // ---------- 游戏流程 ----------
  loadLevel(idx) {
    this.endless = false;
    this._level = LEVELS[idx];
    this.setupLevel({
      levelIndex: idx,
      par: this._level.par,
      targetChar: this._level.char,
      hint: this._level.hint || '',
      endless: false,
    });
  },

  enterEndless() {
    const rec = this._endlessRec;
    if (!rec.current) {
      rec.current = this.generateEndlessLevel();
      this.saveEndlessRec();
    }
    this.endless = true;
    this._level = rec.current;
    this.setupLevel({
      par: this._level.par,
      targetChar: this._level.char,
      hint: this._level.hint || '',
      endless: true,
      endlessCleared: rec.cleared,
    });
  },

  setupLevel(extra) {
    if (this._winTimer) {
      clearTimeout(this._winTimer);
      this._winTimer = null;
    }
    if (this._tiltTimer) {
      clearTimeout(this._tiltTimer);
      this._tiltTimer = null;
    }
    this.state = createGame(this._level);
    this.angle = 0;
    this.angleVis = 0;
    this.phase = 'idle';
    this._rot = null;
    this._fall = null;
    this._effects = [];
    this._targetGrav = undefined;
    const data = {
      moves: 0,
      won: false,
      stars: 0,
      pickerOpen: false,
    };
    if (!extra.endless) data.pickerLevels = this.buildPicker(extra.levelIndex);
    Object.assign(data, extra);
    this.setData(data);
    if (this._cw) this.computeLayout();
    if (this.mode === 'tilt') this.beginTilt();
  },

  generateEndlessLevel() {
    const rec = this._endlessRec;
    const tier = endlessTier(rec.cleared);
    let lv = generateLevel(tier, { avoidChars: rec.recent });
    if (!lv) lv = generateLevel(0);
    if (lv) lv.hint = '转动重力，把部件送进虚线槽';
    return lv;
  },

  saveEndlessRec() {
    try { wx.setStorageSync(ENDLESS_KEY, this._endlessRec); } catch (e) { /* ignore */ }
  },

  buildPicker(current) {
    return LEVELS.map((lv, i) => ({
      idx: i,
      char: lv.char,
      stars: this.progress.stars[i] || 0,
      locked: i >= this.progress.unlocked,
      current: i === current,
    }));
  },

  rotateCW() { this.tryRotate(1); },
  rotateCCW() { this.tryRotate(-1); },

  tryRotate(dir) {
    if (this.mode !== 'button') return;
    if (!this.state || this.state.won || this.data.won || this.data.pickerOpen) return;
    if (this.phase !== 'idle') return;
    this.phase = 'rotating';
    this._rot = {
      from: this.angle,
      to: this.angle + dir * Math.PI / 2,
      start: Date.now(),
      dur: 240,
      dir,
    };
    this.angle = this._rot.to;
    this.setData({ moves: this.state.moves + 1 });
  },

  applyRotation(dir) {
    const res = rotate(this.state, dir);
    if (res.moves.length) {
      const byId = {};
      res.moves.forEach((m) => { byId[m.id] = m; });
      this._fall = {
        start: Date.now(),
        dur: 220,
        byId,
        locked: res.locked,
        won: res.won,
      };
      this.phase = 'falling';
    } else {
      this.afterSettle(res.locked, res.won);
    }
  },

  afterSettle(locked, won) {
    if (locked && locked.length) {
      for (const id of locked) {
        const p = this.state.pieces[id];
        this._effects.push({ x: p.x, y: p.y, start: Date.now(), dur: 450 });
      }
      this.vibrate('light');
    }
    if (won) {
      this.phase = 'won';
      this._winTimer = setTimeout(() => this.finishWin(), 520);
    } else {
      this.phase = 'idle';
      if (this.mode === 'tilt' && this._targetGrav !== undefined && this._targetGrav !== this.state.grav) {
        this._tiltTimer = setTimeout(() => {
          this._tiltTimer = null;
          this.maybeStepTowardTarget();
        }, 70);
      }
    }
  },

  finishWin() {
    const { moves, par } = this.data;
    const stars = moves <= par ? 3 : moves <= par + 2 ? 2 : 1;
    if (this.endless) {
      const rec = this._endlessRec;
      rec.cleared += 1;
      rec.recent.push(this._level.char);
      if (rec.recent.length > 6) rec.recent.shift();
      this.saveEndlessRec();
      this.setData({ won: true, stars, endlessCleared: rec.cleared, allCleared: false });
      this.vibrate('heavy');
      return;
    }
    const { levelIndex } = this.data;
    const p = this.progress;
    p.stars[levelIndex] = Math.max(p.stars[levelIndex] || 0, stars);
    p.unlocked = Math.max(p.unlocked, Math.min(levelIndex + 2, LEVELS.length));
    p.last = levelIndex;
    try { wx.setStorageSync(STORE_KEY, p); } catch (e) { /* ignore */ }
    this.setData({
      won: true,
      stars,
      allCleared: levelIndex + 1 >= LEVELS.length,
      pickerLevels: this.buildPicker(levelIndex),
    });
    this.vibrate('heavy');
  },

  vibrate(type) {
    try {
      wx.vibrateShort({ type, fail() { /* ignore */ } });
    } catch (e) { /* ignore */ }
  },

  // ---------- 体感模式 ----------
  ensureAccel() {
    if (this._accelOn) return;
    try {
      this._accelHandler = (res) => this.onAccel(res);
      wx.onAccelerometerChange(this._accelHandler);
      wx.startAccelerometer({
        interval: 'game',
        fail: () => this.degradeToButtons(),
      });
      this._accelOn = true;
    } catch (e) {
      this.degradeToButtons();
    }
  },

  stopAccel() {
    if (!this._accelOn) return;
    try { wx.stopAccelerometer({ fail() { /* ignore */ } }); } catch (e) { /* ignore */ }
    try {
      if (this._accelHandler) wx.offAccelerometerChange(this._accelHandler);
    } catch (e) { /* ignore */ }
    this._accelHandler = null;
    this._accelOn = false;
  },

  degradeToButtons() {
    this.stopAccel();
    this.mode = 'button';
    try { wx.setStorageSync(MODE_KEY, 'button'); } catch (e) { /* ignore */ }
    this.setData({ mode: 'button', tiltStatus: '' });
    wx.showToast({ title: '当前设备不支持体感，已切换按钮模式', icon: 'none' });
  },

  beginTilt() {
    this._targetGrav = undefined;
    this.ensureAccel();
    if (this._sign) {
      this._tilt = createTilt(this._sign, this._mirror);
      this.setTiltStatus('倾斜手机改变重力');
    } else {
      this._tilt = null;
      this._signCalib = createSignCalib();
      this.setTiltStatus('首次使用：请竖直拿起手机（顶部朝上）');
    }
  },

  onAccel(res) {
    if (this.mode !== 'tilt' || !this.state) return;
    if (this.data.won || this.data.pickerOpen) return;

    // 一次性符号校准（吸收 iOS/Android 整体符号差异）
    if (!this._tilt) {
      const S = feedSignCalib(this._signCalib, res.x, res.y, res.z, this._mirror);
      if (S) {
        this._sign = S;
        try { wx.setStorageSync(SIGN_KEY, S); } catch (e) { /* ignore */ }
        this._tilt = createTilt(S, this._mirror);
        this.setTiltStatus('倾斜手机改变重力');
        this.vibrate('light');
      }
      return;
    }

    const out = feed(this._tilt, res.x, res.y, res.z);
    if (out.flat) {
      this.setTiltStatus('手机太平了，请竖直拿起');
      return;
    }
    if (out.changed) {
      this.setTargetGrav(out.dir);
    } else {
      this.setTiltStatus('倾斜手机改变重力');
    }
  },

  // 目标重力方向（绝对映射，直接取自物理姿态）
  setTargetGrav(dir) {
    this._targetGrav = dir;
    this.maybeStepTowardTarget();
  },

  maybeStepTowardTarget() {
    if (!this.canTiltRotate() || this.phase !== 'idle') return;
    if (this._targetGrav === undefined || this._targetGrav === this.state.grav) return;
    const delta = (this._targetGrav - this.state.grav + 4) % 4;
    const dir = delta === 1 ? -1 : 1; // delta=2 时两步顺时针到达
    this.setData({ moves: this.state.moves + 1 });
    this.applyRotation(dir);
  },

  canTiltRotate() {
    return this.mode === 'tilt' && this.state && !this.state.won && !this.data.won && !this.data.pickerOpen;
  },

  setTiltStatus(s) {
    if (this.data.tiltStatus === s) return;
    this.setData({ tiltStatus: s });
  },

  // ---------- 交互 ----------
  toggleMode() {
    const next = this.mode === 'tilt' ? 'button' : 'tilt';
    this.mode = next;
    try { wx.setStorageSync(MODE_KEY, next); } catch (e) { /* ignore */ }
    if (next === 'tilt') {
      this.setData({ mode: next });
      this.beginTilt();
    } else {
      this.stopAccel();
      this.setData({ mode: next, tiltStatus: '' });
    }
  },

  recalibrate() {
    if (this.mode !== 'tilt') return;
    this._tilt = null;
    this._signCalib = createSignCalib();
    this._targetGrav = undefined;
    this.setTiltStatus('请竖直拿起手机（顶部朝上）校准…');
  },

  flipMirror() {
    if (this.mode !== 'tilt') return;
    this._mirror = !this._mirror;
    // mirror 改变映射公式的符号约定，已测定的 S 需同步翻转
    if (this._sign) this._sign = -this._sign;
    try { wx.setStorageSync(MIRROR_KEY, this._mirror); } catch (e) { /* ignore */ }
    try { if (this._sign) wx.setStorageSync(SIGN_KEY, this._sign); } catch (e) { /* ignore */ }
    if (this._tilt) {
      this._tilt = createTilt(this._sign, this._mirror);
      this._targetGrav = undefined;
    }
    wx.showToast({ title: '已切换方向修正', icon: 'none' });
  },

  hintMove() {
    if (!this.state || this.state.won || this.data.won || this.data.pickerOpen) return;
    if (this.phase !== 'idle') return;
    const r = solveState(cloneState(this.state), { nodeCap: 60000, depthCap: 12 });
    if (r.status === 'SOLVED') {
      wx.showToast({
        title: (r.firstDir === 1 ? '提示：试试顺时针转' : '提示：试试逆时针转') + '，还剩 ' + r.par + ' 步',
        icon: 'none',
        duration: 2400,
      });
    } else {
      wx.showToast({ title: '当前局面可能是死局，试试重开', icon: 'none', duration: 2400 });
    }
  },

  toggleEndless() {
    if (this.endless) {
      const idx = Math.min(Math.max(this.progress.last, 0), this.progress.unlocked - 1, LEVELS.length - 1);
      this.loadLevel(idx);
    } else {
      this.enterEndless();
    }
  },

  rerollEndless() {
    if (!this.endless) return;
    const lv = this.generateEndlessLevel();
    this._endlessRec.current = lv;
    this.saveEndlessRec();
    this._level = lv;
    this.setupLevel({
      par: lv.par,
      targetChar: lv.char,
      hint: lv.hint || '',
      endless: true,
      endlessCleared: this._endlessRec.cleared,
    });
  },

  resetLevel() {
    if (this.endless) {
      this.setupLevel({
        par: this._level.par,
        targetChar: this._level.char,
        hint: this._level.hint || '',
        endless: true,
        endlessCleared: this._endlessRec.cleared,
      });
    } else {
      this.loadLevel(this.data.levelIndex);
    }
  },

  nextLevel() {
    if (this.endless) {
      this.rerollEndless();
      return;
    }
    const n = this.data.levelIndex + 1;
    if (n < LEVELS.length) {
      this.loadLevel(n);
    } else {
      this.setData({ won: false });
    }
  },

  openPicker() {
    this.setData({
      pickerOpen: true,
      pickerLevels: this.buildPicker(this.endless ? -1 : this.data.levelIndex),
    });
  },

  closePicker() {
    this.setData({ pickerOpen: false });
  },

  noop() {},

  pickLevel(e) {
    const i = e.currentTarget.dataset.idx;
    if (i >= this.progress.unlocked) return;
    this.loadLevel(i);
  },
});
