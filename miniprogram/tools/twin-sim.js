// 复刻 twin.js 核心纯逻辑做不变量自检（不依赖 wx / Page）。
// 验证：镜像正确、碰撞判定（含绿格）、危险物生成远离双角色、边界不越界、长程不崩溃。
const W = 11, H = 11;
const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);

let fail = 0, pass = 0;
function assert(cond, msg) { if (cond) pass++; else { fail++; console.log('❌ ' + msg); } }

// ---- 单测：镜像 ----
function greenPos(blue) { return { r: blue.r, c: W - 1 - blue.c }; }
(function () {
  const g = greenPos({ r: 3, c: 2 });
  assert(g.r === 3 && g.c === 8, '镜像水平翻转 c=2→8 (W=11)');
  const g2 = greenPos({ r: 0, c: 0 });
  assert(g2.r === 0 && g2.c === 10, '蓝在左边界 → 绿在右边界');
  const b = { r: 3, c: 2 };
  for (const dir of ['up', 'down', 'left', 'right']) {
    const d = DIRS[dir];
    const nb = { r: clamp(b.r + d[0], 0, H - 1), c: clamp(b.c + d[1], 0, W - 1) };
    const ng = greenPos(nb), eg = { r: nb.r, c: W - 1 - nb.c };
    assert(ng.r === eg.r && ng.c === eg.c, '移动后镜像仍正确 (' + dir + ')');
  }
  const g3 = greenPos({ r: 5, c: 10 });
  assert(g3.c === 0 && g3.c >= 0 && g3.c < W, '蓝在右边界 → 绿在左边界且界内');
})();

// ---- 单测：碰撞（含绿格） ----
function collide(blue, hazards) {
  const g = greenPos(blue);
  for (const h of hazards) {
    if ((h.r === blue.r && h.c === blue.c) || (h.r === g.r && h.c === g.c)) return true;
  }
  return false;
}
(function () {
  assert(collide({ r: 2, c: 2 }, [{ r: 2, c: 2 }]), '蓝撞危险 → true');
  assert(collide({ r: 2, c: 2 }, [{ r: 2, c: 8 }]), '绿撞危险 → true（绿镜像在 c=8）');
  assert(!collide({ r: 2, c: 2 }, [{ r: 0, c: 0 }]), '无碰撞 → false');
})();

// ---- 集成：6000 tick 验证不变量 ----
function runSim(maxTicks) {
  let blue = { r: 5, c: 2 }, hazards = [], ticks = 0, level = 0, sinceSpawn = 0, dodged = 0;
  function spawn() {
    const chaserRatio = Math.min(0.4, level * 0.03);
    const isChaser = Math.random() < chaserRatio;
    const gc = W - 1 - blue.c;
    for (let t = 0; t < 30; t++) {
      const r = Math.floor(Math.random() * H), c = Math.floor(Math.random() * W);
      const dB = Math.abs(r - blue.r) + Math.abs(c - blue.c);
      const dG = Math.abs(r - blue.r) + Math.abs(c - gc);
      if (dB < 2 || dG < 2) continue;
      if (hazards.some(h => h.r === r && h.c === c)) continue;
      const life = isChaser ? 99999 : Math.max(10, 18 - level);
      hazards.push({ r, c, type: isChaser ? 'chaser' : 'static', life, age: 0, stepAge: 0 });
      assert(dB >= 2 && dG >= 2, 'spawn 远离蓝绿');
      return;
    }
  }
  function stepHaz() {
    const next = [];
    for (const h of hazards) {
      h.age++;
      if (h.type === 'static' && h.age >= h.life) { dodged++; continue; }
      if (h.type === 'chaser') {
        h.stepAge++;
        if (h.stepAge >= 2) {
          h.stepAge = 0;
          const gc = W - 1 - blue.c;
          const tg = [{ r: blue.r, c: blue.c }, { r: blue.r, c: gc }];
          let best = tg[0], bd = Infinity;
          for (const t of tg) { const d = Math.abs(h.r - t.r) + Math.abs(h.c - t.c); if (d < bd) { bd = d; best = t; } }
          const dr = sign(best.r - h.r), dc = sign(best.c - h.c);
          if (Math.abs(best.r - h.r) >= Math.abs(best.c - h.c)) h.r += dr; else h.c += dc;
          h.r = clamp(h.r, 0, H - 1); h.c = clamp(h.c, 0, W - 1);
        }
      }
      next.push(h);
    }
    hazards = next;
  }
  // 贪心 AI：朝让蓝+绿都离危险最远的方向走
  function greedyMove() {
    const cand = ['up', 'down', 'left', 'right'].map(dir => {
      const d = DIRS[dir];
      return { dir, r: clamp(blue.r + d[0], 0, H - 1), c: clamp(blue.c + d[1], 0, W - 1) };
    });
    let best = cand[0], bs = -1;
    for (const m of cand) {
      let s = 0;
      for (const h of hazards) { s += Math.abs(h.r - m.r) + Math.abs(h.c - m.c); }
      const g = { r: m.r, c: W - 1 - m.c };
      for (const h of hazards) { s += Math.abs(h.r - g.r) + Math.abs(h.c - g.c); }
      if (s > bs) { bs = s; best = m; }
    }
    blue = { r: best.r, c: best.c };
  }
  for (let i = 0; i < maxTicks; i++) {
    ticks++; level = Math.floor(ticks / 50);
    sinceSpawn++;
    const spawnEvery = Math.max(3, 9 - Math.floor(level / 2));
    if (sinceSpawn >= spawnEvery) { sinceSpawn = 0; spawn(); }
    stepHaz();
    greedyMove();
    assert(blue.r >= 0 && blue.r < H && blue.c >= 0 && blue.c < W, '蓝界内');
    const g = greenPos(blue);
    assert(g.c >= 0 && g.c < W, '绿界内');
    for (const h of hazards) assert(h.r >= 0 && h.r < H && h.c >= 0 && h.c < W, '危险物界内');
    if (collide(blue, hazards)) return { dead: true, ticks, dodged };
  }
  return { dead: false, ticks, dodged };
}
const res = runSim(6000);
console.log('\n仿真：' + (res.dead ? ('贪心AI 第 ' + res.ticks + ' tick 阵亡（正常）') : '存活满 6000 tick') + '，躲过 ' + res.dodged + ' 个');
console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
