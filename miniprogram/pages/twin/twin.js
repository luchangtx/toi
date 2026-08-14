const BEST_KEY = 'twin_best';
const W = 11, H = 11;                 // 网格（奇数 → 水平中线镜像对称）
const START_TICK = 150;              // [PLACEHOLDER] 起始 tick(ms)，待 playtest 校准
const MIN_TICK = 85;                 // [PLACEHOLDER] 最低 tick(ms)
const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

Page({
  data: {
    cells: [],
    score: 0,
    best: 0,
    dodged: 0,
    level: 0,
    phase: 'ready',   // ready | playing | over
    boardCols: W
  },

  onLoad() {
    this.best = wx.getStorageSync(BEST_KEY) || 0;
    this.phase = 'ready';
    this.setData({ best: this.best, boardCols: W });
    this.buildCells();
  },

  buildCells() {
    const coords = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) coords.push({ id: r * W + c, r, c });
    this.coords = coords;
    this.setData({ cells: coords.map(p => ({ ...p, t: 'e' })) });
  },

  tickMs() { return Math.max(MIN_TICK, START_TICK - this.level * 8); },  // [PLACEHOLDER]

  startGame() {
    this.phase = 'playing';
    this.ticks = 0;
    this.level = 0;
    this.sinceSpawn = 0;
    this.dodged = 0;
    this.score = 0;
    this.blue = { r: (H - 1) / 2, c: Math.floor(W / 4) };
    this.hazards = [];
    this.dir = null;
    this._lastX = undefined; this._lastY = undefined;
    this.setData({ phase: 'playing', score: 0, dodged: 0, level: 0 });
    this.render();
    this.loop = setInterval(() => this.tick(), this.tickMs());
  },

  tick() {
    if (this.phase !== 'playing') return;
    this.ticks++;
    const newLevel = Math.floor(this.ticks / 50);   // [PLACEHOLDER] 每 50 tick 升一级
    if (newLevel !== this.level) { this.level = newLevel; this.setData({ level: this.level }); }

    this.sinceSpawn++;
    const spawnEvery = Math.max(3, 9 - Math.floor(this.level / 2));  // [PLACEHOLDER]
    if (this.sinceSpawn >= spawnEvery) { this.sinceSpawn = 0; this.spawnHazard(); }

    this.stepHazards();
    if (this.dir) this.movePlayer(this.dir);
    if (this.collide()) { this.gameOver(); return; }

    this.score = this.ticks;
    this.setData({ score: this.score });
    this.render();
  },

  spawnHazard() {
    const chaserRatio = Math.min(0.4, this.level * 0.03);  // [PLACEHOLDER]
    const isChaser = Math.random() < chaserRatio;
    const gc = W - 1 - this.blue.c;
    for (let tries = 0; tries < 30; tries++) {
      const r = Math.floor(Math.random() * H);
      const c = Math.floor(Math.random() * W);
      const dBlue = Math.abs(r - this.blue.r) + Math.abs(c - this.blue.c);
      const dGreen = Math.abs(r - this.blue.r) + Math.abs(c - gc);
      if (dBlue < 2 || dGreen < 2) continue;   // 远离双角色，避免瞬死
      if (this.hazards.some(h => h.r === r && h.c === c)) continue;
      const life = isChaser ? 99999 : Math.max(10, 18 - this.level);  // [PLACEHOLDER]
      this.hazards.push({ r, c, type: isChaser ? 'chaser' : 'static', life, age: 0, stepAge: 0 });
      return;
    }
  },

  stepHazards() {
    const next = [];
    for (const h of this.hazards) {
      h.age++;
      if (h.type === 'static' && h.age >= h.life) { this.dodged++; continue; }
      if (h.type === 'chaser') {
        h.stepAge++;
        if (h.stepAge >= 2) {   // [PLACEHOLDER] 追踪者每 2 tick 走一格
          h.stepAge = 0;
          const gc = W - 1 - this.blue.c;
          const targets = [{ r: this.blue.r, c: this.blue.c }, { r: this.blue.r, c: gc }];
          let best = targets[0], bd = Infinity;
          for (const t of targets) { const d = Math.abs(h.r - t.r) + Math.abs(h.c - t.c); if (d < bd) { bd = d; best = t; } }
          const dr = sign(best.r - h.r), dc = sign(best.c - h.c);
          if (Math.abs(best.r - h.r) >= Math.abs(best.c - h.c)) h.r += dr; else h.c += dc;
          h.r = clamp(h.r, 0, H - 1); h.c = clamp(h.c, 0, W - 1);
        }
      }
      next.push(h);
    }
    this.hazards = next;
  },

  movePlayer(dir) {
    const d = DIRS[dir]; if (!d) return;
    this.blue = { r: clamp(this.blue.r + d[0], 0, H - 1), c: clamp(this.blue.c + d[1], 0, W - 1) };
  },

  greenPos() { return { r: this.blue.r, c: W - 1 - this.blue.c }; },

  collide() {
    const g = this.greenPos();
    for (const h of this.hazards) {
      if ((h.r === this.blue.r && h.c === this.blue.c) || (h.r === g.r && h.c === g.c)) return true;
    }
    return false;
  },

  onTouchStart(e) { this.handleTouch(e); },
  onTouchMove(e) { this.handleTouch(e); },
  handleTouch(e) {
    if (this.phase !== 'playing') return;
    const t = e.touches && e.touches[0]; if (!t) return;
    if (this._lastX === undefined) { this._lastX = t.clientX; this._lastY = t.clientY; return; }
    const dx = t.clientX - this._lastX, dy = t.clientY - this._lastY;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;   // 死区，防抖
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
    else this.dir = dy > 0 ? 'down' : 'up';
    this._lastX = t.clientX; this._lastY = t.clientY;
  },
  onTouchEnd() { this._lastX = undefined; this._lastY = undefined; },

  onStartTap() { if (this.phase === 'ready') this.startGame(); },
  restart() { if (this.loop) clearInterval(this.loop); this.startGame(); },

  render() {
    const g = this.greenPos();
    const map = {};
    for (const h of this.hazards) map[h.r + ',' + h.c] = h.type;
    const cells = this.coords.map(p => {
      let t = 'e';
      if (p.r === this.blue.r && p.c === this.blue.c) t = 'blue';
      else if (p.r === g.r && p.c === g.c) t = 'green';
      else if (map[p.r + ',' + p.c]) t = map[p.r + ',' + p.c];
      return { id: p.id, r: p.r, c: p.c, t };
    });
    this.setData({ cells });
  },

  gameOver() {
    this.phase = 'over';
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
    if (this.score > this.best) { this.best = this.score; wx.setStorageSync(BEST_KEY, this.best); }
    this.setData({ phase: 'over', best: this.best });
    this.vibrate('heavy');
    this.tone(180, 0.32, 'sawtooth');
  },

  onUnload() { if (this.loop) clearInterval(this.loop); },
  onHide() { if (this.loop) clearInterval(this.loop); },

  vibrate(type) { try { wx.vibrateShort({ type, fail() {} }); } catch (e) {} },
  tone(freq, dur, type) {
    try {
      const ctx = wx.createWebAudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq; o.type = type || 'sine';
      o.connect(g); g.connect(ctx.destination); g.gain.value = 0.16;
      o.start();
      setTimeout(() => { try { o.stop(); ctx.close && ctx.close(); } catch (e) {} }, dur * 1000);
    } catch (e) {}
  }
});
