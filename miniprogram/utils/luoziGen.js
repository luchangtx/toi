// utils/luoziGen.js
// 《落字》动态关卡生成器：随机汉字结构 + 随机棋盘/墙/部件，BFS 现场验证可解并给出最优步数
// 纯函数 CommonJS，Node 侧可直接复用做批量测试
const { createGame, settle, rotate } = require('./luoziCore');

// ---------- 随机数 ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 汉字部件库 ----------
// s 为槽位相对偏移 [dx, dy, 部件]；t 为最低出现档位（1 易 ~ 3 难）
const BANK = [];
function lr(c, a, b, t) { BANK.push({ c, t, s: [[0, 0, a], [1, 0, b]] }); }
function tb(c, a, b, t) { BANK.push({ c, t, s: [[0, 0, a], [0, 1, b]] }); }
function lr3(c, a, b, d, t) { BANK.push({ c, t, s: [[0, 0, a], [1, 0, b], [2, 0, d]] }); }
function tb3(c, a, b, d, t) { BANK.push({ c, t, s: [[0, 0, a], [0, 1, b], [0, 2, d]] }); }
function tri(c, p, t) { BANK.push({ c, t, s: [[1, 0, p], [0, 1, p], [2, 1, p]] }); }

// 左右结构
lr('明', '日', '月', 1); lr('好', '女', '子', 1); lr('朋', '月', '月', 1);
lr('林', '木', '木', 1); lr('从', '人', '人', 1); lr('双', '又', '又', 1);
lr('比', '匕', '匕', 1); lr('羽', '习', '习', 1); lr('肥', '月', '巴', 1);
lr('肚', '月', '土', 1); lr('妈', '女', '马', 1); lr('妹', '女', '未', 1);
lr('姑', '女', '古', 1); lr('姓', '女', '生', 1); lr('她', '女', '也', 1);
lr('时', '日', '寸', 1); lr('旺', '日', '王', 1); lr('晴', '日', '青', 1);
lr('叶', '口', '十', 1); lr('吹', '口', '欠', 1); lr('味', '口', '未', 1);
lr('吗', '口', '马', 1); lr('吧', '口', '巴', 1); lr('鸣', '口', '鸟', 1);
lr('机', '木', '几', 1); lr('松', '木', '公', 1); lr('柏', '木', '白', 1);
lr('村', '木', '寸', 1); lr('相', '木', '目', 1); lr('鲜', '鱼', '羊', 2);
lr('鸭', '甲', '鸟', 2); lr('鹅', '我', '鸟', 2); lr('朗', '良', '月', 2);
lr('枝', '木', '支', 1); lr('唱', '口', '昌', 2); lr('吴', '口', '天', 1);
lr3('树', '木', '又', '寸', 2); lr3('谢', '讠', '身', '寸', 2); lr3('哪', '口', '那', '日', 2);
// 上下结构
tb('吕', '口', '口', 1); tb('昌', '日', '日', 1); tb('炎', '火', '火', 1);
tb('圭', '土', '土', 1); tb('多', '夕', '夕', 1); tb('哥', '可', '可', 1);
tb('男', '田', '力', 1); tb('尖', '小', '大', 1); tb('岩', '山', '石', 1);
tb('音', '立', '日', 1); tb('早', '日', '十', 1); tb('古', '十', '口', 1);
tb('吉', '士', '口', 1); tb('吞', '天', '口', 1); tb('杏', '木', '口', 1);
tb('呆', '口', '木', 1); tb('李', '木', '子', 1); tb('季', '禾', '子', 1);
tb('香', '禾', '日', 1); tb('志', '士', '心', 1); tb('思', '田', '心', 1);
tb('忘', '亡', '心', 1); tb('忠', '中', '心', 1); tb('忍', '刃', '心', 2);
tb('态', '太', '心', 2); tb('架', '加', '木', 2); tb('梨', '利', '木', 2);
tb('柴', '此', '木', 2); tb('泉', '白', '水', 2); tb('雷', '雨', '田', 2);
tb('雹', '雨', '包', 2); tb('驾', '加', '马', 2); tb('岛', '鸟', '山', 2);
tb3('意', '立', '日', '心', 2); tb3('莫', '艹', '日', '大', 2);
tb3('竟', '立', '日', '儿', 2); tb3('草', '艹', '早', '日', 2);
// 品字结构
tri('品', '口', 2); tri('晶', '日', 2); tri('森', '木', 3);
tri('众', '人', 3); tri('磊', '石', 3); tri('焱', '火', 3); tri('鑫', '金', 3);
// 特殊结构
BANK.push({ c: '器', t: 3, s: [[0, 0, '口'], [2, 0, '口'], [0, 2, '口'], [2, 2, '口'], [1, 1, '犬']] });

const DECOYS = ['口', '木', '日', '大', '火', '水', '田', '山', '金', '又', '人', '月'];

// 档位参数（档位由无尽模式已通关节数决定）
const TIERS = [
  { walls: [0, 0], decoys: [0, 0], par: [1, 4] },
  { walls: [0, 1], decoys: [0, 1], par: [2, 5] },
  { walls: [1, 2], decoys: [0, 2], par: [3, 6] },
  { walls: [2, 3], decoys: [1, 2], par: [3, 8] }
];

function rngInt(rng, n) { return Math.floor(rng() * n); }
function rngRange(rng, lo, hi) { return lo + rngInt(rng, hi - lo + 1); }
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(rng, i + 1);
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

// ---------- BFS 求解 ----------
// 返回 { status: 'SOLVED', par, firstDir } | { status: 'UNSTABLE' | 'TRIVIAL' | 'UNSOLVABLE' | 'TOO_LARGE', states }
function cloneState(st) {
  return {
    char: st.char, w: st.w, h: st.h,
    walls: st.walls, slots: st.slots,
    pieces: st.pieces.map((p) => ({ id: p.id, c: p.c, x: p.x, y: p.y, locked: p.locked })),
    grav: st.grav, moves: st.moves, won: st.won
  };
}

function bfs(start, opt) {
  const nodeCap = opt.nodeCap;
  const depthCap = opt.depthCap;
  const key = (st) => {
    const parts = st.pieces.map((p) => p.c + (p.locked ? '#' : '@') + p.x + ',' + p.y);
    parts.sort();
    return st.grav + '|' + parts.join(';');
  };
  const queue = [{ st: start, depth: 0, first: 0 }];
  const seen = new Set([key(start)]);
  let head = 0;
  while (head < queue.length) {
    if (seen.size > nodeCap) return { status: 'TOO_LARGE', states: seen.size };
    const cur = queue[head++];
    if (cur.depth >= depthCap) continue;
    for (const dir of [1, -1]) {
      const ns = cloneState(cur.st);
      const res = rotate(ns, dir);
      if (res.won) {
        return { status: 'SOLVED', par: cur.depth + 1, states: seen.size, firstDir: cur.depth === 0 ? dir : cur.first };
      }
      const k = key(ns);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push({ st: ns, depth: cur.depth + 1, first: cur.depth === 0 ? dir : cur.first });
      }
    }
  }
  return { status: 'UNSOLVABLE', states: seen.size };
}

function solve(level, opt) {
  opt = opt || {};
  const start = createGame(level);
  if (settle(start).moves.length) return { status: 'UNSTABLE' };
  if (start.won) return { status: 'TRIVIAL', par: 0 };
  return bfs(start, { nodeCap: opt.nodeCap || 60000, depthCap: opt.depthCap || 12 });
}

// 从任意已沉降局面求解（提示功能用）；会修改传入 state，调用方请传副本
function solveState(state, opt) {
  opt = opt || {};
  if (state.won) return { status: 'TRIVIAL', par: 0 };
  return bfs(state, { nodeCap: opt.nodeCap || 60000, depthCap: opt.depthCap || 12 });
}

// ---------- 结构校验（同战役关卡规则） ----------
function validate(level) {
  const errs = [];
  const cells = new Map();
  const put = (x, y, what) => {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) { errs.push('越界 ' + what); return; }
    const k = x + ',' + y;
    if (cells.has(k)) errs.push('重叠 ' + k);
    cells.set(k, what);
  };
  level.walls.forEach((w, i) => put(w[0], w[1], '墙' + i));
  level.slots.forEach((s, i) => put(s[0], s[1], '槽' + i));
  level.pieces.forEach((p, i) => put(p[0], p[1], '件' + i));
  const solid = new Set(level.walls.map((w) => w[0] + ',' + w[1]));
  level.pieces.forEach((p, i) => {
    if (!((p[1] + 1 >= level.h) || solid.has(p[0] + ',' + (p[1] + 1)))) errs.push('件' + i + '(' + p[2] + ') 悬空');
  });
  const need = {};
  const have = {};
  level.slots.forEach((s) => { need[s[2]] = (need[s[2]] || 0) + 1; });
  level.pieces.forEach((p) => { have[p[2]] = (have[p[2]] || 0) + 1; });
  for (const c of Object.keys(need)) {
    if ((have[c] || 0) < need[c]) errs.push('部件 ' + c + ' 数量不足');
  }
  return errs;
}

// ---------- 候选关卡构建 ----------
function buildCandidate(rng, tier, avoidChars) {
  const conf = TIERS[tier];
  let pool = BANK.filter((e) => e.t <= tier + 1);
  if (avoidChars && avoidChars.length) {
    const filtered = pool.filter((e) => avoidChars.indexOf(e.c) < 0);
    if (filtered.length >= 8) pool = filtered;
  }
  const entry = pool[rngInt(rng, pool.length)];

  let bw = 1;
  let bh = 1;
  for (const s of entry.s) {
    bw = Math.max(bw, s[0] + 1);
    bh = Math.max(bh, s[1] + 1);
  }

  const w = Math.min(7, Math.max(5, bw + rngRange(rng, 2, 4)));
  const h = Math.min(9, Math.max(7, bh + rngRange(rng, 3, 6)));
  if (bw > w || bh > h - 2) return null;

  const sxMax = w - bw;
  let sx = sxMax <= 1 ? sxMax : 1 + rngInt(rng, sxMax - 1);
  let sy = h - bh - rngRange(rng, 0, 1);
  let t0Side = 0;
  if (tier === 0) {
    // 热身档：槽位贴左/右墙，部件放对侧底行，保证低步数可解
    t0Side = rngInt(rng, 2);
    sx = t0Side === 0 ? 0 : w - bw;
    sy = h - bh;
  }
  const slots = entry.s.map((s) => [sx + s[0], sy + s[1], s[2]]);

  const occupied = new Set(slots.map((s) => s[0] + ',' + s[1]));

  // 墙
  const wallCount = rngRange(rng, conf.walls[0], conf.walls[1]);
  const walls = [];
  let guard = 0;
  while (walls.length < wallCount && guard++ < 60) {
    const x = rngInt(rng, w);
    const y = rngInt(rng, h);
    const k = x + ',' + y;
    if (occupied.has(k)) continue;
    occupied.add(k);
    walls.push([x, y]);
  }
  const solid = new Set(walls.map((p) => p[0] + ',' + p[1]));

  // 可停放的格子：底行，或正下方是墙
  const rest = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = x + ',' + y;
      if (occupied.has(k)) continue;
      if (y + 1 >= h || solid.has(x + ',' + (y + 1))) rest.push([x, y]);
    }
  }
  shuffle(rest, rng);

  // 热身档：部件限制在对侧底行（一次旋转即可滑入贴墙槽位）
  if (tier === 0) {
    const xMin = t0Side === 0 ? bw : 0;
    const xMax = t0Side === 0 ? w - 1 : w - bw - 1;
    const far = rest.filter((p) => p[1] === h - 1 && p[0] >= xMin && p[0] <= xMax);
    if (far.length >= entry.s.length) {
      rest.length = 0;
      far.forEach((p) => rest.push(p));
    }
  }

  // 干扰部件（与目标字无关）
  const partChars = entry.s.map((s) => s[2]);
  const decoyPool = DECOYS.filter((c) => partChars.indexOf(c) < 0);
  shuffle(decoyPool, rng);
  const decoyCount = Math.min(rngRange(rng, conf.decoys[0], conf.decoys[1]), decoyPool.length);

  const pieceSpecs = partChars.slice();
  for (let i = 0; i < decoyCount; i++) pieceSpecs.push(decoyPool[i]);
  if (rest.length < pieceSpecs.length) return null;

  const pieces = pieceSpecs.map((c, i) => [rest[i][0], rest[i][1], c]);

  return { char: entry.c, w, h, slots, pieces, walls, par: 0, hint: '' };
}

// ---------- 生成入口 ----------
// rng 可选（缺省用时间种子）；返回带 par 的关卡；极端情况下保证返回可解关卡
function generateLevel(tier, opts) {
  opts = opts || {};
  const rng = opts.rng || mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  const conf = TIERS[tier] || TIERS[0];
  const maxAttempts = opts.maxAttempts || 80;
  let fallback = null;
  let fallbackPar = 0;

  for (let i = 0; i < maxAttempts; i++) {
    const lv = buildCandidate(rng, tier, opts.avoidChars);
    if (!lv) continue;
    const r = solve(lv, { nodeCap: 60000, depthCap: 12 });
    if (r.status === 'SOLVED') {
      if (!fallback) { fallback = lv; fallbackPar = r.par; }
      if (r.par >= conf.par[0] && r.par <= conf.par[1]) {
        lv.par = r.par;
        return lv;
      }
      // 记录一个更贴近难度区间的后备
      if (!fallbackPar || Math.abs(r.par - conf.par[0]) < Math.abs(fallbackPar - conf.par[0])) {
        fallback = lv;
        fallbackPar = r.par;
      }
    }
  }
  if (fallback) {
    fallback.par = fallbackPar;
    return fallback;
  }
  // 理论不可达：放宽限制再试一轮
  for (let i = 0; i < 200; i++) {
    const lv = buildCandidate(rng, tier, null);
    if (!lv) continue;
    const r = solve(lv, { nodeCap: 120000, depthCap: 14 });
    if (r.status === 'SOLVED' && r.par >= 1) {
      lv.par = r.par;
      return lv;
    }
  }
  return null;
}

module.exports = { BANK, TIERS, mulberry32, solve, solveState, cloneState, validate, buildCandidate, generateLevel };
