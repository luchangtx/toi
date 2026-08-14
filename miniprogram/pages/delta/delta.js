// 三角洲行动 - 页面逻辑（小程序版，与 sjz.html 玩法一致）
const core = require('../../utils/deltaCore.js');

const AUDIO_BASE = '/audio/';

function getWindowInfo() {
  if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo();
  return wx.getSystemInfoSync();
}

Page({
  data: {
    statusBarHeight: 20,
    started: false,
    paused: false,
    gameOver: false,
    victory: false,
    muted: false,
    currentWeapon: 'm4a1',
    weaponList: [
      { id: 'm4a1', name: 'M4A1' },
      { id: 'ak47', name: 'AK-47' },
      { id: 'smg', name: 'SMG-45' },
      { id: 'shotgun', name: 'M870' }
    ],
    hud: {
      healthPercent: 100, healthText: '100/100', ammo: 30, totalAmmo: 180,
      weaponName: 'M4A1', weaponMode: '全自动 | 5.56mm', kills: 0, wave: 1, score: 0, combo: ''
    },
    stickX: 0, stickY: 0,
    aimX: 0, aimY: 0,
    killFeed: [],
    scoreText: '+100', scoreShow: false,
    notifyText: '', notifyShow: false,
    damageActive: false,
    waveBig: '', waveSub: '', waveShow: false,
    overStats: {}, victoryStats: {}, best: 0
  },

  // ==================== 生命周期 ====================
  onLoad() {
    const info = getWindowInfo();
    this.dpr = info.pixelRatio || 2;
    this.state = core.createState();
    this.obstacles = core.generateMap();
    this.bgParticles = [];
    this.joystickActive = false; this.joystickData = { x: 0, y: 0 }; this.joystickCenter = null;
    this.aimActive = false; this.aimData = { x: 0, y: 0 }; this.aimCenter = null;
    this.firing = false;
    this.canvasReady = false;
    this._raf = null;
    this._timers = [];
    this._notifyTimer = null; this._scoreTimer = null; this._damageTimer = null;
    this._waveTimer = null; this._deadTimer = null; this._overTimer = null;
    this._lastHudFlush = 0; this._lastStickFlush = 0; this._lastAimFlush = 0;
    this._killSeq = 0; this._hudCache = null;
    this.sfx = {};
    try { this.data.best = wx.getStorageSync('delta_best') || 0; } catch (e) { this.data.best = 0; }

    this.setData({ statusBarHeight: info.statusBarHeight || 20, best: this.data.best });
  },

  onReady() { this.initCanvases(); },

  onShow() { if (this.canvasReady && !this._raf) this.startLoop(); },

  onHide() {
    this.stopLoop();
    this.firing = false; this.joystickActive = false; this.aimActive = false;
    this.joystickData = { x: 0, y: 0 }; this.aimData = { x: 0, y: 0 };
    wx.setKeepScreenOn({ keepScreenOn: false });
  },

  onUnload() { this.stopLoop(); this.clearAllTimers(); wx.setKeepScreenOn({ keepScreenOn: false }); },

  // ==================== Canvas 初始化 ====================
  initCanvases() {
    const dpr = this.dpr;
    wx.createSelectorQuery().in(this)
      .select('#gameCanvas').fields({ node: true, size: true, rect: true })
      .select('#particlesCanvas').fields({ node: true, size: true })
      .select('#minimapCanvas').fields({ node: true, size: true })
      .select('#joystick').boundingClientRect()
      .select('#aimJoystick').boundingClientRect()
      .exec((res) => {
        const g = res[0], p = res[1], m = res[2], j = res[3], aj = res[4];
        if (!g || !g.node) return;
        this.gameCanvas = g.node; this.gctx = g.node.getContext('2d');
        this.gw = g.width; this.gh = g.height; this.gLeft = g.left || 0; this.gTop = g.top || 0;
        g.node.width = g.width * dpr; g.node.height = g.height * dpr; this.gctx.scale(dpr, dpr);

        if (p && p.node) {
          this.pctx = p.node.getContext('2d'); this.pw = p.width; this.ph = p.height;
          p.node.width = p.width * dpr; p.node.height = p.height * dpr; this.pctx.scale(dpr, dpr);
          this.bgParticles = core.initBgParticles(p.width, p.height);
        }
        if (m && m.node) {
          this.mctx = m.node.getContext('2d'); this.mSize = m.width;
          m.node.width = m.width * dpr; m.node.height = m.height * dpr; this.mctx.scale(dpr, dpr);
        }
        if (j) this.joystickCenter = { x: j.left + j.width / 2, y: j.top + j.height / 2 };
        if (aj) this.aimCenter = { x: aj.left + aj.width / 2, y: aj.top + aj.height / 2 };
        this.canvasReady = true;
        this.startLoop();
      });
  },

  // ==================== 主循环 ====================
  startLoop() {
    if (!this.gameCanvas || this._raf) return;
    const canvas = this.gameCanvas;
    const loop = () => { this.tick(); this._raf = canvas.requestAnimationFrame(loop); };
    this._raf = canvas.requestAnimationFrame(loop);
  },
  stopLoop() {
    if (this._raf && this.gameCanvas) this.gameCanvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  tick() {
    const st = this.state;
    if (!st.running) {
      if (this.pctx) core.updateBgParticles(this.pctx, this.bgParticles, this.pw, this.ph);
      return;
    }
    if (st.paused) return;

    st.elapsed = Date.now() - st.startTime;
    core.movePlayer(st, this.joystickActive, this.joystickData, this.obstacles);
    if (this.aimActive) {
      st.player.angle = Math.atan2(this.aimData.y, this.aimData.x);
      core.fire(st);
    }
    if (this.firing) core.fire(st);

    st.camera.x = st.player.x - this.gw / 2;
    st.camera.y = st.player.y - this.gh / 2;

    core.updateWave(st);
    core.updateEnemies(st, this.obstacles);
    core.updateBullets(st, this.obstacles);
    core.updateGameParticles(st);
    core.updatePickups(st);
    core.updateMisc(st);

    core.render(this.gctx, st, this.obstacles, this.gw, this.gh);
    if (this.mctx) core.renderMinimap(this.mctx, st, this.obstacles, this.mSize);

    this.drainEvents();
    this.flushHUD();
  },

  // ==================== HUD ====================
  flushHUD(force) {
    const now = Date.now();
    if (!force && now - this._lastHudFlush < 100) return;
    this._lastHudFlush = now;
    const player = this.state.player;
    const weapon = core.WEAPONS[player.weapon];
    const hud = {
      healthPercent: player.health / player.maxHealth * 100,
      healthText: Math.ceil(player.health) + '/' + player.maxHealth,
      ammo: player.ammo, totalAmmo: player.totalAmmo,
      weaponName: weapon.name, weaponMode: weapon.mode + ' | ' + weapon.caliber,
      kills: player.kills, wave: this.state.wave, score: this.state.score, combo: (this.data.hud.combo || '')
    };
    const c = this._hudCache;
    if (c && c.healthPercent === hud.healthPercent && c.healthText === hud.healthText &&
      c.ammo === hud.ammo && c.totalAmmo === hud.totalAmmo && c.weaponName === hud.weaponName &&
      c.weaponMode === hud.weaponMode && c.kills === hud.kills && c.wave === hud.wave &&
      c.score === hud.score && c.combo === hud.combo) return;
    this._hudCache = hud;
    this.setData({ hud: hud });
  },

  // ==================== 事件队列（核心 -> UI/音效） ====================
  drainEvents() {
    const evts = this.state.events;
    if (!evts.length) return;
    for (let i = 0; i < evts.length; i++) {
      const e = evts[i];
      if (e.type === 'notify') this.showNotification(e.payload);
      else if (e.type === 'score') this.showScorePopup(e.payload);
      else if (e.type === 'kill') this.addKillFeed(e.payload);
      else if (e.type === 'damage') this.flashDamage();
      else if (e.type === 'wave') this.showWaveBanner(e.payload.big, e.payload.sub);
      else if (e.type === 'combo') this.setData({ 'hud.combo': e.payload });
      else if (e.type === 'sfx') this.playSound(e.payload);
      else if (e.type === 'dead') this.onPlayerDead(e.payload);
      else if (e.type === 'victory') this.onVictory(e.payload);
    }
    evts.length = 0;
  },

  playSound(name) {
    if (this.data.muted) return;
    let ctx = this.sfx[name];
    if (!ctx) {
      ctx = wx.createInnerAudioContext();
      ctx.src = AUDIO_BASE + name + '.wav';
      this.sfx[name] = ctx;
    }
    try { ctx.stop(); ctx.seek(0); ctx.play(); } catch (err) { ctx.play(); }
  },

  showNotification(text) {
    if (this._notifyTimer) clearTimeout(this._notifyTimer);
    this.setData({ notifyText: text, notifyShow: true });
    this._notifyTimer = setTimeout(() => { this.setData({ notifyShow: false }); this._notifyTimer = null; }, 2000);
  },
  showScorePopup(text) {
    if (this._scoreTimer) clearTimeout(this._scoreTimer);
    this.setData({ scoreText: text, scoreShow: true });
    this._scoreTimer = setTimeout(() => { this.setData({ scoreShow: false }); this._scoreTimer = null; }, 800);
  },
  addKillFeed(text) {
    const id = ++this._killSeq;
    this.setData({ killFeed: this.data.killFeed.concat([{ id: id, text: text }]) });
    const t = setTimeout(() => { this.setData({ killFeed: this.data.killFeed.filter((k) => k.id !== id) }); }, 3000);
    this._timers.push(t);
  },
  flashDamage() {
    if (this._damageTimer) clearTimeout(this._damageTimer);
    else this.setData({ damageActive: true });
    this._damageTimer = setTimeout(() => { this.setData({ damageActive: false }); this._damageTimer = null; }, 200);
  },
  showWaveBanner(big, sub) {
    if (this._waveTimer) clearTimeout(this._waveTimer);
    this.setData({ waveBig: big, waveSub: sub, waveShow: true });
    this._waveTimer = setTimeout(() => { this.setData({ waveShow: false }); this._waveTimer = null; }, 2200);
  },

  // ==================== 结束 / 胜利 ====================
  onPlayerDead(stats) {
    this.saveBest(stats.score);
    const s = this.formatStats(stats);
    this.setData({ gameOver: true, overStats: s });
  },
  onVictory(stats) {
    this.saveBest(stats.score);
    const s = this.formatStats(stats);
    this.setData({ victory: true, victoryStats: s });
  },
  formatStats(stats) {
    const m = Math.floor(stats.time / 60), sec = stats.time % 60;
    return {
      wave: stats.wave, kills: stats.kills, score: stats.score,
      acc: stats.acc + '%', time: m + ':' + (sec < 10 ? '0' : '') + sec, best: this.data.best
    };
  },
  saveBest(score) {
    if (score > this.data.best) {
      this.data.best = score;
      try { wx.setStorageSync('delta_best', score); } catch (e) {}
      this.setData({ best: score });
    }
  },

  resetToStart() {
    this.state = core.createState();
    this.obstacles = core.generateMap();
    this.state.obstacles = this.obstacles;
    if (this.pctx) this.bgParticles = core.initBgParticles(this.pw, this.ph);
    if (this.gctx) this.gctx.clearRect(0, 0, this.gw, this.gh);
    if (this.mctx) this.mctx.clearRect(0, 0, this.mSize, this.mSize);
    this._hudCache = null;
    wx.setKeepScreenOn({ keepScreenOn: false });
  },
  clearAllTimers() {
    this._timers.forEach((t) => clearTimeout(t)); this._timers = [];
    if (this._notifyTimer) { clearTimeout(this._notifyTimer); this._notifyTimer = null; }
    if (this._scoreTimer) { clearTimeout(this._scoreTimer); this._scoreTimer = null; }
    if (this._damageTimer) { clearTimeout(this._damageTimer); this._damageTimer = null; }
    if (this._waveTimer) { clearTimeout(this._waveTimer); this._waveTimer = null; }
    if (this._deadTimer) { clearTimeout(this._deadTimer); this._deadTimer = null; }
    if (this.state && this.state.reloadTimer) { clearTimeout(this.state.reloadTimer); this.state.reloadTimer = null; }
  },

  // ==================== 开始 / 控制 ====================
  onStart() {
    if (!this.canvasReady) return;
    this.obstacles = core.startGame(this.state);
    this.state.obstacles = this.obstacles;
    wx.setKeepScreenOn({ keepScreenOn: true });
    this.setData({ started: true, paused: false, gameOver: false, victory: false, currentWeapon: 'm4a1', killFeed: [], scoreShow: false, notifyShow: false, damageActive: false, waveShow: false, 'hud.combo': '' });
    this.flushHUD(true);
  },
  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index', fail: () => {} }) });
  },
  onRestart() {
    this.clearAllTimers();
    this.firing = false; this.joystickActive = false; this.aimActive = false;
    this.joystickData = { x: 0, y: 0 }; this.aimData = { x: 0, y: 0 };
    this.resetToStart();
    this.onStart();
  },
  onContinueEndless() {
    if (this.state.reloadTimer) { clearTimeout(this.state.reloadTimer); this.state.reloadTimer = null; }
    core.continueEndless(this.state);
    wx.setKeepScreenOn({ keepScreenOn: true });
    this.setData({ victory: false, started: true, currentWeapon: this.state.player.weapon });
    this.flushHUD(true);
  },

  onPause() {
    if (!this.state.running || this.state.over || this.state.victory) return;
    this.state.paused = true;
    this.setData({ paused: true });
  },
  onResume() {
    this.state.paused = false;
    this.setData({ paused: false });
  },
  onMute() {
    const muted = !this.data.muted;
    this.setData({ muted: muted });
  },

  // ==================== 摇杆（左：移动） ====================
  updateJoystick(touch) {
    if (!this.joystickCenter) return;
    let dx = touch.clientX - this.joystickCenter.x;
    let dy = touch.clientY - this.joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 45;
    if (dist > maxDist) { dx = dx / dist * maxDist; dy = dy / dist * maxDist; }
    this.joystickData = { x: dx / maxDist, y: dy / maxDist };
    const now = Date.now();
    if (now - this._lastStickFlush >= 60) {
      this._lastStickFlush = now;
      this.setData({ stickX: dx, stickY: dy });
    }
  },
  onJoystickStart(e) { if (!e.touches.length) return; this.joystickActive = true; this.updateJoystick(e.touches[0]); },
  onJoystickMove(e) { if (!e.touches.length) return; if (this.joystickActive) this.updateJoystick(e.touches[0]); },
  onJoystickEnd() { this.joystickActive = false; this.joystickData = { x: 0, y: 0 }; this.setData({ stickX: 0, stickY: 0 }); },

  // ==================== 摇杆（右：瞄准 + 开火） ====================
  updateAim(touch) {
    if (!this.aimCenter) return;
    let dx = touch.clientX - this.aimCenter.x;
    let dy = touch.clientY - this.aimCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 45;
    if (dist > maxDist) { dx = dx / dist * maxDist; dy = dy / dist * maxDist; }
    this.aimData = { x: dx / maxDist, y: dy / maxDist };
    const now = Date.now();
    if (now - this._lastAimFlush >= 60) {
      this._lastAimFlush = now;
      this.setData({ aimX: dx, aimY: dy });
    }
  },
  onAimStart(e) { if (!e.touches.length) return; this.setPlayerAngle(e.touches[0]); this.aimActive = true; this.updateAim(e.touches[0]); },
  onAimMove(e) { if (!e.touches.length) return; this.setPlayerAngle(e.touches[0]); if (this.aimActive) this.updateAim(e.touches[0]); },
  onAimEnd() { this.aimActive = false; this.aimData = { x: 0, y: 0 }; this.setData({ aimX: 0, aimY: 0 }); },
  // 点屏瞄准（不自动开火），便于没有右摇杆习惯时点击战场方向
  setPlayerAngle(touch) {
    const st = this.state;
    if (!st.running || st.paused) return;
    const x = touch.clientX - this.gLeft + st.camera.x;
    const y = touch.clientY - this.gTop + st.camera.y;
    st.player.angle = Math.atan2(y - st.player.y, x - st.player.x);
  },

  // ==================== 射击 / 换弹 / 换枪 ====================
  onFireStart() { this.firing = true; },
  onFireEnd() { this.firing = false; },
  onReload() { core.reload(this.state); this.drainEvents(); },
  onSelectWeapon(e) {
    const id = e.currentTarget.dataset.weapon;
    core.selectWeapon(this.state, id);
    this.setData({ currentWeapon: id });
    this.flushHUD(true);
  }
});
