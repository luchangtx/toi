/**
 * 三角洲行动 - 游戏核心逻辑（小程序版）
 * 与网页版（sjz.html）保持玩法一致：波次系统、四类敌人、四把武器、补给、连击、音效事件。
 * 不依赖任何 wx / DOM API，可在 node 中直接模拟运行（音效/UI 通过事件队列外抛）。
 *
 * 时间相关（开火冷却、波次间隔、连击、换弹）使用 Date.now()（毫秒）；
 * 位移/子弹按「每帧」步进，speed 与网页版逐帧数值一致。
 */

// ==================== 配置 ====================
var WEAPONS = {
  m4a1:   { name: 'M4A1',   damage: 22, fireRate: 120, magazine: 30, totalAmmo: 180, reloadTime: 1900, recoil: 2, color: '#00a8ff', caliber: '5.56mm',  mode: '全自动', type: 'auto',    bulletSpeed: 18, bulletLife: 70, spread: 0.03 },
  ak47:   { name: 'AK-47',  damage: 34, fireRate: 160, magazine: 30, totalAmmo: 120, reloadTime: 2300, recoil: 5, color: '#ff4444', caliber: '7.62mm',  mode: '高伤害', type: 'auto',    bulletSpeed: 18, bulletLife: 70, spread: 0.06 },
  smg:    { name: 'SMG-45', damage: 14, fireRate: 75,  magazine: 40, totalAmmo: 240, reloadTime: 1600, recoil: 1, color: '#00ff88', caliber: '.45ACP',  mode: '高速',   type: 'auto',    bulletSpeed: 16, bulletLife: 55, spread: 0.05 },
  shotgun:{ name: 'M870',   damage: 0,  fireRate: 650, magazine: 8,  totalAmmo: 48,  reloadTime: 2800, recoil: 3, color: '#ffaa00', caliber: '12GA',    mode: '霰弹',   type: 'shotgun', pellets: 8, pelletDamage: 14, pelletSpeed: 14, pelletLife: 22, spread: 0.5 }
};
var WEAPON_ORDER = ['m4a1', 'ak47', 'smg', 'shotgun'];

var ENEMY_TYPES = {
  grunt:  { health: 50,  speed: 1.4, fireRate: 1100, damage: 7,  inacc: 0.25, color: '#8B0000', barrel: '#ff3333', size: 15, score: 100, behavior: 'chase',  range: 380, retreat: 170 },
  runner: { health: 34,  speed: 3.3, fireRate: 0,    damage: 14, inacc: 0,    color: '#ff6600', barrel: '#ffaa00', size: 13, score: 120, behavior: 'rush' },
  heavy:  { health: 170, speed: 0.9, fireRate: 1400, damage: 16, inacc: 0.12, color: '#5b2c8f', barrel: '#b07cff', size: 22, score: 220, behavior: 'chase',  range: 430, retreat: 140 },
  sniper: { health: 62,  speed: 1.1, fireRate: 2300, damage: 28, inacc: 0.03, color: '#0099cc', barrel: '#66e0ff', size: 16, score: 200, behavior: 'sniper', range: 680, retreat: 400, telegraph: 650 }
};
var ENEMY_NAMES = { grunt: '步兵', runner: '冲锋兵', heavy: '重甲兵', sniper: '狙击手' };

var MAP_WIDTH = 3200;
var MAP_HEIGHT = 3200;
var GRID_SIZE = 100;
var BG_PARTICLE_COUNT = 100;
var PLAYER_RADIUS = 18;
var MAX_ALIVE = 12;
var WAVE_VICTORY = 10;

// ==================== 状态 ====================
function createState() {
  return {
    running: false, paused: false, over: false, victory: false, endless: false,
    player: {
      x: 0, y: 0, health: 100, maxHealth: 100, speed: 3.2, angle: 0,
      weapon: 'm4a1', ammo: 30, totalAmmo: 180, reloading: false, lastShot: 0, kills: 0, muzzle: 0
    },
    enemies: [], bullets: [], particles: [], pickups: [],
    camera: { x: 0, y: 0, shake: 0 },
    wave: 0, waveActive: false, enemiesToSpawn: [], nextSpawn: 0, intermissionEnd: 0,
    score: 0, kills: 0, combo: 0, comboExpire: 0,
    shotsFired: 0, shotsHit: 0,
    startTime: 0, elapsed: 0,
    events: [], reloadTimer: null
  };
}

function emit(state, type, payload) {
  state.events.push({ type: type, payload: payload });
}

// ==================== 地图 ====================
function generateMap() {
  var obstacles = [];
  for (var i = 0; i < 46; i++) {
    obstacles.push({
      x: Math.random() * (MAP_WIDTH - 200) + 100,
      y: Math.random() * (MAP_HEIGHT - 200) + 100,
      width: Math.random() * 160 + 60,
      height: Math.random() * 160 + 60,
      type: Math.random() > 0.45 ? 'building' : 'barrier'
    });
  }
  obstacles.push({ x: -100, y: -100, width: MAP_WIDTH + 200, height: 100, type: 'wall' });
  obstacles.push({ x: -100, y: MAP_HEIGHT, width: MAP_WIDTH + 200, height: 100, type: 'wall' });
  obstacles.push({ x: -100, y: -100, width: 100, height: MAP_HEIGHT + 200, type: 'wall' });
  obstacles.push({ x: MAP_WIDTH, y: -100, width: 100, height: MAP_HEIGHT + 200, type: 'wall' });
  return obstacles;
}

function pointInObstacle(x, y, pad, obstacles) {
  pad = pad || 0;
  for (var j = 0; j < obstacles.length; j++) {
    var o = obstacles[j];
    if (o.type === 'wall') continue;
    if (x > o.x - pad && x < o.x + o.width + pad && y > o.y - pad && y < o.y + o.height + pad) return true;
  }
  return false;
}

function randomOpenPos(state, minFromPlayer) {
  for (var i = 0; i < 60; i++) {
    var x = 200 + Math.random() * (MAP_WIDTH - 400);
    var y = 200 + Math.random() * (MAP_HEIGHT - 400);
    if (pointInObstacle(x, y, 30, state.obstacles)) continue;
    if (minFromPlayer && Math.hypot(x - state.player.x, y - state.player.y) < minFromPlayer) continue;
    return { x: x, y: y };
  }
  return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
}

// ==================== 背景粒子 ====================
function initBgParticles(w, h) {
  var list = [];
  for (var i = 0; i < BG_PARTICLE_COUNT; i++) {
    list.push({
      x: Math.random() * w, y: Math.random() * h,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.5, speedY: (Math.random() - 0.5) * 0.5,
      opacity: Math.random() * 0.5 + 0.1
    });
  }
  return list;
}
function updateBgParticles(ctx, list, w, h) {
  ctx.clearRect(0, 0, w, h);
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    p.x += p.speedX; p.y += p.speedY;
    if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(212, 175, 55, ' + p.opacity + ')';
    ctx.fill();
  }
}

// ==================== 粒子 ====================
function addParticle(state, x, y, vx, vy, color, size, life) {
  if (state.particles.length > 500) state.particles.shift();
  state.particles.push({ x: x, y: y, vx: vx, vy: vy, color: color, size: size, life: life, maxLife: life, type: 'dot' });
}
function explosion(state, x, y, size) {
  for (var k = 0; k < 22; k++) {
    var a = Math.random() * Math.PI * 2, s = Math.random() * 5 + 1;
    addParticle(state, x, y, Math.cos(a) * s, Math.sin(a) * s, Math.random() > 0.5 ? '#ffaa00' : '#ff3333', Math.random() * 3 + 2, 32);
  }
  state.particles.push({ x: x, y: y, vx: 0, vy: 0, color: '#ffaa00', size: size, r: size, vr: size * 0.12, life: 24, maxLife: 24, type: 'ring' });
}
function updateGameParticles(state) {
  state.particles = state.particles.filter(function (p) {
    if (p.type === 'ring') { p.r += p.vr; p.life--; return p.life > 0; }
    p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; p.size *= 0.96; return p.life > 0;
  });
}

// ==================== 补给 ====================
function dropPickup(state, x, y, type) { state.pickups.push({ x: x, y: y, type: type, bob: Math.random() * Math.PI * 2 }); }
function updatePickups(state) {
  for (var i = state.pickups.length - 1; i >= 0; i--) {
    var p = state.pickups[i];
    p.bob += 0.05;
    if (Math.hypot(p.x - state.player.x, p.y - state.player.y) < PLAYER_RADIUS + 14) {
      if (p.type === 'health') { state.player.health = Math.min(state.player.maxHealth, state.player.health + 35); emit(state, 'score', '+35 HP'); }
      else { var w = WEAPONS[state.player.weapon]; state.player.totalAmmo += w.magazine * 2; emit(state, 'score', '+弹药'); }
      emit(state, 'sfx', 'pickup');
      state.pickups.splice(i, 1);
    }
  }
}

// ==================== 玩家受伤 / 死亡 ====================
function damagePlayer(state, dmg) {
  if (state.over || state.victory) return;
  state.player.health -= dmg;
  state.combo = 0; state.comboExpire = 0;
  emit(state, 'damage');
  emit(state, 'sfx', 'hurt');
  state.camera.shake = Math.max(state.camera.shake, 9);
  if (state.player.health <= 0) {
    state.player.health = 0;
    state.over = true; state.running = false;
    emit(state, 'sfx', 'explosion');
    emit(state, 'dead', gameStats(state));
  }
}

// ==================== 射击 / 换弹 / 换枪 ====================
function spawnPlayerBullet(state, angle, dmg, speed, life) {
  state.bullets.push({
    x: state.player.x + Math.cos(angle) * 26, y: state.player.y + Math.sin(angle) * 26,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    damage: dmg, owner: 'player', color: WEAPONS[state.player.weapon].color, life: life, maxLife: life
  });
}
function fire(state) {
  if (!state.running || state.reloading) return;
  var w = WEAPONS[state.player.weapon];
  var now = Date.now();
  if (now - state.player.lastShot < w.fireRate) return;
  if (state.player.ammo <= 0) { reload(state); return; }
  state.player.lastShot = now;
  state.player.ammo--;
  state.player.muzzle = 5;
  var aim = state.player.angle;
  if (w.type === 'shotgun') {
    for (var i = 0; i < w.pellets; i++) {
      var a = aim + (Math.random() - 0.5) * w.spread;
      spawnPlayerBullet(state, a, w.pelletDamage, w.pelletSpeed, w.pelletLife);
    }
    state.shotsFired += w.pellets;
  } else {
    var rec = aim + (Math.random() - 0.5) * w.recoil * 0.05;
    spawnPlayerBullet(state, rec, w.damage, w.bulletSpeed, w.bulletLife);
    state.shotsFired += 1;
  }
  for (var k = 0; k < 5; k++) {
    addParticle(state, state.player.x + Math.cos(aim) * 26, state.player.y + Math.sin(aim) * 26,
      Math.cos(aim) * 3 + (Math.random() - 0.5) * 2, Math.sin(aim) * 3 + (Math.random() - 0.5) * 2, '#ffaa00', 4, 9);
  }
  state.camera.shake = Math.max(state.camera.shake, w.recoil * 0.4);
  emit(state, 'sfx', 'shoot');
}
function reload(state) {
  if (state.reloading || state.player.ammo >= WEAPONS[state.player.weapon].magazine) return;
  var w = WEAPONS[state.player.weapon];
  if (state.player.totalAmmo <= 0) return;
  state.player.reloading = true;
  emit(state, 'notify', '换弹中...');
  emit(state, 'sfx', 'reload');
  state.reloadTimer = setTimeout(function () {
    if (!state.running) { state.player.reloading = false; state.reloadTimer = null; return; }
    var need = w.magazine - state.player.ammo;
    var take = Math.min(need, state.player.totalAmmo);
    state.player.ammo += take; state.player.totalAmmo -= take;
    state.player.reloading = false; state.reloadTimer = null;
  }, w.reloadTime);
}
function selectWeapon(state, id) {
  if (!WEAPONS[id]) return;
  state.player.weapon = id;
  var w = WEAPONS[id];
  state.player.ammo = w.magazine; state.player.totalAmmo = w.totalAmmo; state.player.reloading = false;
  if (state.reloadTimer) { clearTimeout(state.reloadTimer); state.reloadTimer = null; }
}

// ==================== 敌人 ====================
function waveComposition(wave) {
  var comp = [];
  var total = 4 + Math.floor(wave * 1.5);
  for (var i = 0; i < total; i++) {
    var r = Math.random();
    if (wave >= 3 && r < 0.18) comp.push('sniper');
    else if (wave >= 2 && r < 0.40) comp.push('heavy');
    else if (r < 0.62) comp.push('runner');
    else comp.push('grunt');
  }
  return comp;
}
function spawnEnemy(state, type) {
  var base = ENEMY_TYPES[type];
  var diff = 1 + (state.wave - 1) * 0.12;
  var angle = Math.random() * Math.PI * 2;
  var dist = 650 + Math.random() * 450;
  var x = state.player.x + Math.cos(angle) * dist;
  var y = state.player.y + Math.sin(angle) * dist;
  x = Math.max(150, Math.min(MAP_WIDTH - 150, x));
  y = Math.max(150, Math.min(MAP_HEIGHT - 150, y));
  if (pointInObstacle(x, y, 40, state.obstacles)) { var p = randomOpenPos(state, 500); x = p.x; y = p.y; }
  state.enemies.push({
    type: type, x: x, y: y,
    health: base.health * diff, maxHealth: base.health * diff,
    speed: base.speed * (1 + (state.wave - 1) * 0.04),
    angle: Math.atan2(state.player.y - y, state.player.x - x),
    cd: base.fireRate, telegraph: 0, hitFlash: 0, contactAt: 0, size: base.size
  });
}
function fireEnemyBullet(state, e, angle, dmg) {
  state.bullets.push({
    x: e.x + Math.cos(angle) * (ENEMY_TYPES[e.type].size + 4),
    y: e.y + Math.sin(angle) * (ENEMY_TYPES[e.type].size + 4),
    vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8,
    damage: dmg, owner: 'enemy', color: '#ff4444', life: 110, maxLife: 110
  });
}
function updateEnemies(state, obstacles) {
  var now = Date.now();
  for (var i = 0; i < state.enemies.length; i++) {
    var e = state.enemies[i], base = ENEMY_TYPES[e.type];
    var dx = state.player.x - e.x, dy = state.player.y - e.y;
    var dist = Math.hypot(dx, dy);
    e.angle = Math.atan2(dy, dx);
    if (e.hitFlash > 0) e.hitFlash -= 1;

    if (base.behavior === 'rush') {
      e.x += Math.cos(e.angle) * e.speed;
      e.y += Math.sin(e.angle) * e.speed;
      if (dist < PLAYER_RADIUS + base.size && now >= e.contactAt) {
        e.contactAt = now + 600;
        damagePlayer(state, base.damage);
        e.x -= Math.cos(e.angle) * 30; e.y -= Math.sin(e.angle) * 30;
        state.player.x += Math.cos(e.angle) * 8; state.player.y += Math.sin(e.angle) * 8;
      }
    } else if (base.behavior === 'sniper') {
      if (dist > base.range) { e.x += Math.cos(e.angle) * e.speed; e.y += Math.sin(e.angle) * e.speed; }
      else if (dist < base.retreat) { e.x -= Math.cos(e.angle) * e.speed; e.y -= Math.sin(e.angle) * e.speed; }
      e.cd -= 16;
      if (dist < base.range && dist > base.retreat) {
        if (e.cd <= 0 && e.telegraph <= 0) e.telegraph = base.telegraph;
        if (e.telegraph > 0) { e.telegraph -= 16; if (e.telegraph <= 0) { fireEnemyBullet(state, e, e.angle, base.damage); e.cd = base.fireRate; } }
      } else { e.cd = Math.min(e.cd, 250); }
    } else {
      if (dist > base.range) { e.x += Math.cos(e.angle) * e.speed; e.y += Math.sin(e.angle) * e.speed; }
      else if (dist < base.retreat) { e.x -= Math.cos(e.angle) * e.speed; e.y -= Math.sin(e.angle) * e.speed; }
      else {
        var strafe = Math.sin(now / 400 + i) * 0.5;
        e.x += Math.cos(e.angle + Math.PI / 2) * strafe;
        e.y += Math.sin(e.angle + Math.PI / 2) * strafe;
      }
      e.cd -= 16;
      if (dist <= base.range && dist >= base.retreat && e.cd <= 0) {
        e.cd = base.fireRate;
        fireEnemyBullet(state, e, e.angle + (Math.random() - 0.5) * 2 * base.inacc, base.damage);
      }
    }

    // 障碍碰撞
    for (var j = 0; j < obstacles.length; j++) {
      var o = obstacles[j];
      if (o.type === 'wall') continue;
      if (e.x > o.x && e.x < o.x + o.width && e.y > o.y && e.y < o.y + o.height) {
        e.x -= Math.cos(e.angle) * e.speed * 2;
        e.y -= Math.sin(e.angle) * e.speed * 2;
      }
    }
    // 敌人间分离
    for (var m = 0; m < state.enemies.length; m++) {
      if (m === i) continue;
      var o2 = state.enemies[m];
      var d2 = Math.hypot(e.x - o2.x, e.y - o2.y);
      if (d2 < base.size + o2.size && d2 > 0) {
        var push = (base.size + o2.size - d2) / 2;
        e.x += (e.x - o2.x) / d2 * push; e.y += (e.y - o2.y) / d2 * push;
      }
    }
  }
}
function killEnemy(state, i) {
  var e = state.enemies[i], base = ENEMY_TYPES[e.type];
  state.enemies.splice(i, 1);
  state.player.kills++; state.kills++;
  state.combo++; state.comboExpire = Date.now() + 3000;
  var mult = 1 + Math.floor((state.combo - 1) / 3) * 0.5;
  var gain = Math.round(base.score * mult);
  state.score += gain;
  emit(state, 'score', '+' + gain + (mult > 1 ? (' x' + mult) : ''));
  if (state.combo > 1) emit(state, 'combo', '连击 x' + state.combo);
  emit(state, 'kill', ENEMY_NAMES[e.type] + ' 已消灭');
  explosion(state, e.x, e.y, base.size);
  emit(state, 'sfx', 'explosion');
  state.camera.shake = Math.max(state.camera.shake, 5);
  var r = Math.random();
  if (r < 0.22) dropPickup(state, e.x, e.y, 'health');
  else if (r < 0.44) dropPickup(state, e.x, e.y, 'ammo');
}

// ==================== 子弹 ====================
function updateBullets(state, obstacles) {
  state.bullets = state.bullets.filter(function (b) {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.life <= 0) return false;
    if (b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) return false;
    for (var k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      if (o.type === 'wall') continue;
      if (b.x > o.x && b.x < o.x + o.width && b.y > o.y && b.y < o.y + o.height) {
        for (var n = 0; n < 4; n++) addParticle(state, b.x, b.y, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, '#888', 2, 18);
        return false;
      }
    }
    if (b.owner === 'player') {
      for (var m = state.enemies.length - 1; m >= 0; m--) {
        var e = state.enemies[m];
        if (Math.hypot(b.x - e.x, b.y - e.y) < ENEMY_TYPES[e.type].size + 4) {
          e.health -= b.damage; e.hitFlash = 5; state.shotsHit++;
          for (var q = 0; q < 6; q++) addParticle(state, b.x, b.y, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, '#ff3333', 3, 26);
          emit(state, 'sfx', 'hit');
          if (e.health <= 0) killEnemy(state, m);
          return false;
        }
      }
    } else {
      if (Math.hypot(b.x - state.player.x, b.y - state.player.y) < PLAYER_RADIUS + 3) {
        damagePlayer(state, b.damage);
        return false;
      }
    }
    return true;
  });
}

// ==================== 波次 ====================
function startWave(state, n) {
  state.wave = n; state.waveActive = true; state.enemiesToSpawn = waveComposition(n); state.nextSpawn = Date.now();
  var h = randomOpenPos(state, 400); dropPickup(state, h.x, h.y, 'health');
  var a = randomOpenPos(state, 400); dropPickup(state, a.x, a.y, 'ammo');
  emit(state, 'wave', { big: '第 ' + n + ' 波', sub: n >= WAVE_VICTORY ? 'FINAL DEFENSE' : 'ENEMY INCOMING' });
  emit(state, 'sfx', 'wave');
}
function updateWave(state) {
  var now = Date.now();
  if (state.intermissionEnd > 0) {
    if (now >= state.intermissionEnd) { state.intermissionEnd = 0; startWave(state, state.wave + 1); }
    return;
  }
  if (!state.waveActive) return;
  if (now >= state.nextSpawn && state.enemiesToSpawn.length > 0 && state.enemies.length < MAX_ALIVE) {
    spawnEnemy(state, state.enemiesToSpawn.shift());
    state.nextSpawn = now + 500 + Math.random() * 500;
  }
  if (state.enemiesToSpawn.length === 0 && state.enemies.length === 0) {
    state.waveActive = false;
    if (state.wave >= WAVE_VICTORY && !state.endless) {
      state.victory = true; state.running = false;
      emit(state, 'victory', gameStats(state));
      return;
    }
    var bonus = 250 + state.wave * 50;
    state.score += bonus;
    emit(state, 'notify', '第 ' + state.wave + ' 波 已清除  +' + bonus);
    state.intermissionEnd = now + 3200;
  }
}
function continueEndless(state) {
  state.endless = true; state.victory = false; state.running = true;
  state.startTime = Date.now() - state.elapsed;
  startWave(state, state.wave + 1);
}

// ==================== 每帧杂项（震动衰减 / 连击过期 / 枪口火光） ====================
function updateMisc(state) {
  state.camera.shake *= 0.85; if (state.camera.shake < 0.3) state.camera.shake = 0;
  if (state.player.muzzle > 0) state.player.muzzle--;
  if (state.comboExpire > 0 && Date.now() > state.comboExpire) { state.combo = 0; state.comboExpire = 0; emit(state, 'combo', ''); }
}

// ==================== 玩家移动 ====================
function movePlayer(state, leftActive, leftData, obstacles) {
  if (leftActive) {
    var mx = leftData.x, my = leftData.y;
    var ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    state.player.x += mx * state.player.speed;
    state.player.y += my * state.player.speed;
  }
  state.player.x = Math.max(20, Math.min(MAP_WIDTH - 20, state.player.x));
  state.player.y = Math.max(20, Math.min(MAP_HEIGHT - 20, state.player.y));
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (o.type === 'wall') continue;
    if (state.player.x > o.x - PLAYER_RADIUS && state.player.x < o.x + o.width + PLAYER_RADIUS &&
      state.player.y > o.y - PLAYER_RADIUS && state.player.y < o.y + o.height + PLAYER_RADIUS) {
      var cx = o.x + o.width / 2, cy = o.y + o.height / 2;
      if (Math.abs(state.player.x - cx) / o.width > Math.abs(state.player.y - cy) / o.height) {
        state.player.x = state.player.x < cx ? o.x - PLAYER_RADIUS : o.x + o.width + PLAYER_RADIUS;
      } else {
        state.player.y = state.player.y < cy ? o.y - PLAYER_RADIUS : o.y + o.height + PLAYER_RADIUS;
      }
    }
  }
}

// ==================== 渲染 ====================
function render(ctx, state, obstacles, w, h) {
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, w, h);
  var sx = (Math.random() - 0.5) * state.camera.shake, sy = (Math.random() - 0.5) * state.camera.shake;
  ctx.save();
  ctx.translate(-state.camera.x + sx, -state.camera.y + sy);

  ctx.strokeStyle = 'rgba(212,175,55,0.05)'; ctx.lineWidth = 1;
  var ox = -state.camera.x % GRID_SIZE, oy = -state.camera.y % GRID_SIZE;
  for (var gx = ox; gx < w; gx += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
  for (var gy = oy; gy < h; gy += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

  var vx0 = state.camera.x - 50, vy0 = state.camera.y - 50, vx1 = state.camera.x + w + 50, vy1 = state.camera.y + h + 50;
  for (var oi = 0; oi < obstacles.length; oi++) {
    var o = obstacles[oi];
    if (o.x > vx1 || o.x + o.width < vx0 || o.y > vy1 || o.y + o.height < vy0) continue;
    if (o.type === 'building') {
      ctx.fillStyle = '#262626'; ctx.fillRect(o.x, o.y, o.width, o.height);
      ctx.strokeStyle = '#3f3f3f'; ctx.lineWidth = 2; ctx.strokeRect(o.x, o.y, o.width, o.height);
      ctx.fillStyle = '#1f1f1f'; ctx.fillRect(o.x + 8, o.y + 8, o.width - 16, o.height - 16);
    } else if (o.type === 'barrier') {
      ctx.fillStyle = '#30301f'; ctx.fillRect(o.x, o.y, o.width, o.height);
      ctx.strokeStyle = '#4a4a30'; ctx.lineWidth = 2; ctx.strokeRect(o.x, o.y, o.width, o.height);
    }
  }

  for (var pi = 0; pi < state.pickups.length; pi++) {
    var p = state.pickups[pi]; var yy = p.y + Math.sin(p.bob) * 3;
    if (p.type === 'health') {
      ctx.fillStyle = '#1a3a1a'; ctx.beginPath(); ctx.arc(p.x, yy, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#00ff66'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#00ff66'; ctx.fillRect(p.x - 7, yy - 2, 14, 4); ctx.fillRect(p.x - 2, yy - 7, 4, 14);
    } else {
      ctx.fillStyle = '#3a3410'; ctx.beginPath(); ctx.arc(p.x, yy, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffcc00'; ctx.fillRect(p.x - 7, yy - 5, 14, 3); ctx.fillRect(p.x - 7, yy, 14, 3); ctx.fillRect(p.x - 7, yy + 5, 14, 3);
    }
  }

  for (var ei = 0; ei < state.enemies.length; ei++) {
    var e = state.enemies[ei], base = ENEMY_TYPES[e.type];
    if (e.type === 'sniper' && e.telegraph > 0) {
      ctx.strokeStyle = 'rgba(255,40,40,' + (0.3 + 0.5 * Math.abs(Math.sin(Date.now() / 40))) + ')';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(state.player.x, state.player.y); ctx.stroke();
    }
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle);
    ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : base.color;
    ctx.beginPath(); ctx.arc(0, 0, base.size, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = base.barrel; ctx.fillRect(0, -3, base.size + 8, 6);
    ctx.restore();
    var hp = e.health / e.maxHealth;
    ctx.fillStyle = '#333'; ctx.fillRect(e.x - 15, e.y - base.size - 8, 30, 4);
    ctx.fillStyle = hp > 0.5 ? '#00ff00' : (hp > 0.25 ? '#ffaa00' : '#ff0000');
    ctx.fillRect(e.x - 15, e.y - base.size - 8, 30 * hp, 4);
  }

  for (var bi = 0; bi < state.bullets.length; bi++) {
    var b = state.bullets[bi];
    ctx.strokeStyle = b.color; ctx.lineWidth = b.owner === 'player' ? 2.5 : 2;
    ctx.globalAlpha = Math.min(1, b.life / 30);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 2.5, b.y - b.vy * 2.5); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (var qi = 0; qi < state.particles.length; qi++) {
    var pt = state.particles[qi];
    if (pt.type === 'ring') {
      ctx.globalAlpha = pt.life / pt.maxLife; ctx.strokeStyle = pt.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife); ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, Math.max(0.5, pt.size), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  ctx.save(); ctx.translate(state.player.x, state.player.y); ctx.rotate(state.player.angle);
  if (state.player.muzzle > 0) { ctx.fillStyle = 'rgba(255,180,40,0.9)'; ctx.beginPath(); ctx.arc(28, 0, 9, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#0c5a8a'; ctx.beginPath(); ctx.arc(-6, -10, 8, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(-6, 10, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#00a8ff'; ctx.beginPath(); ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d4af37'; ctx.fillRect(0, -4, 26, 8);
  var wpn = WEAPONS[state.player.weapon]; ctx.fillStyle = wpn.color; ctx.fillRect(18, 6, 18, 6);
  ctx.restore();

  ctx.restore();
}

function renderMinimap(ctx, state, obstacles, size) {
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, size, size);
  var scale = size / MAP_WIDTH;
  ctx.fillStyle = '#333';
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (o.type !== 'wall') ctx.fillRect(o.x * scale, o.y * scale, o.width * scale, o.height * scale);
  }
  ctx.fillStyle = '#ff4444';
  for (var j = 0; j < state.enemies.length; j++) {
    var e = state.enemies[j];
    ctx.beginPath(); ctx.arc(e.x * scale, e.y * scale, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#00ff88';
  for (var k = 0; k < state.pickups.length; k++) {
    var p = state.pickups[k]; ctx.fillRect(p.x * scale - 1.5, p.y * scale - 1.5, 3, 3);
  }
  ctx.fillStyle = '#00a8ff';
  ctx.beginPath(); ctx.arc(state.player.x * scale, state.player.y * scale, 3, 0, Math.PI * 2); ctx.fill();
}

// ==================== 统计 / 开始 ====================
function gameStats(state) {
  var acc = state.shotsFired ? Math.round(state.shotsHit / state.shotsFired * 100) : 0;
  return { wave: state.wave, kills: state.kills, score: state.score, acc: acc, time: Math.floor(state.elapsed / 1000) };
}
function startGame(state) {
  state.over = false; state.victory = false; state.endless = false; state.paused = false;
  var p = state.player;
  p.x = MAP_WIDTH / 2; p.y = MAP_HEIGHT / 2; p.health = p.maxHealth; p.weapon = 'm4a1';
  p.ammo = WEAPONS.m4a1.magazine; p.totalAmmo = WEAPONS.m4a1.totalAmmo; p.reloading = false; p.kills = 0; p.lastShot = 0; p.muzzle = 0; p.angle = 0;
  state.enemies = []; state.bullets = []; state.particles = []; state.pickups = [];
  state.score = 0; state.kills = 0; state.combo = 0; state.comboExpire = 0;
  state.shotsFired = 0; state.shotsHit = 0; state.wave = 0; state.waveActive = false; state.intermissionEnd = 0;
  state.camera.x = p.x - 400; state.camera.y = p.y - 400; state.camera.shake = 0;
  state.running = true; state.startTime = Date.now();
  var obstacles = generateMap();
  state.obstacles = obstacles;
  startWave(state, 1);
  emit(state, 'notify', '行动开始！肃清所有敌人');
  return obstacles;
}

module.exports = {
  WEAPONS: WEAPONS, WEAPON_ORDER: WEAPON_ORDER, ENEMY_TYPES: ENEMY_TYPES, ENEMY_NAMES: ENEMY_NAMES,
  MAP_WIDTH: MAP_WIDTH, MAP_HEIGHT: MAP_HEIGHT, GRID_SIZE: GRID_SIZE, PLAYER_RADIUS: PLAYER_RADIUS, WAVE_VICTORY: WAVE_VICTORY,
  createState: createState, generateMap: generateMap, initBgParticles: initBgParticles, updateBgParticles: updateBgParticles,
  addParticle: addParticle, explosion: explosion, updateGameParticles: updateGameParticles,
  dropPickup: dropPickup, updatePickups: updatePickups,
  damagePlayer: damagePlayer,
  spawnPlayerBullet: spawnPlayerBullet, fire: fire, reload: reload, selectWeapon: selectWeapon,
  waveComposition: waveComposition, spawnEnemy: spawnEnemy, fireEnemyBullet: fireEnemyBullet, updateEnemies: updateEnemies,
  killEnemy: killEnemy,
  updateBullets: updateBullets,
  startWave: startWave, updateWave: updateWave, continueEndless: continueEndless,
  updateMisc: updateMisc,
  movePlayer: movePlayer,
  render: render, renderMinimap: renderMinimap,
  gameStats: gameStats, startGame: startGame
};
