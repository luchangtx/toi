// utils/luoziCore.js
// 《落字》核心逻辑：纯函数实现，不依赖 wx，可在 Node 侧复用做关卡求解器
// 玩法：旋转容器改变重力方向，部件沿重力滑落，落入同字槽位即锁定，集齐全部槽位过关
// 方向索引（屏幕坐标系，y 向下）：0=下 1=左 2=上 3=右
const DIRS = [
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 }
];

function key(x, y) {
  return x + ',' + y;
}

// level 结构：
// { char, w, h, slots:[[x,y,字,order?]], pieces:[[x,y,字]], walls:[[x,y]], par, hint }
function createGame(level) {
  return {
    char: level.char,
    w: level.w,
    h: level.h,
    walls: (level.walls || []).map((p) => ({ x: p[0], y: p[1] })),
    slots: level.slots.map((s, i) => ({ id: i, x: s[0], y: s[1], c: s[2], order: s[3] || 0 })),
    pieces: level.pieces.map((p, i) => ({ id: i, c: p[2], x: p[0], y: p[1], locked: false })),
    grav: 0,
    moves: 0,
    won: false
  };
}

function slotFilled(state, slot) {
  return state.pieces.some((p) => p.locked && p.x === slot.x && p.y === slot.y);
}

// 槽位顺序约束：order 更小的槽位必须已填充
function orderOk(state, slot) {
  return state.slots.every((s) => s.order <= slot.order || slotFilled(state, s));
}

// 让所有未锁定部件沿当前重力滑落至稳定，随后做槽位锁定判定
// 返回 { moves:[{id,from,to}], locked:[pieceId], won }
function settle(state) {
  const d = DIRS[state.grav];
  const occ = new Set(state.walls.map((w) => key(w.x, w.y)));
  state.pieces.forEach((p) => occ.add(key(p.x, p.y)));

  // 沿重力方向最远的部件先移动，保证结果确定
  const free = state.pieces.filter((p) => !p.locked);
  free.sort(
    (a, b) =>
      b.x * d.dx + b.y * d.dy - (a.x * d.dx + a.y * d.dy) || a.id - b.id
  );

  const moves = [];
  for (const p of free) {
    let nx = p.x;
    let ny = p.y;
    for (;;) {
      const tx = nx + d.dx;
      const ty = ny + d.dy;
      if (tx < 0 || ty < 0 || tx >= state.w || ty >= state.h) break;
      if (occ.has(key(tx, ty))) break;
      nx = tx;
      ny = ty;
    }
    if (nx !== p.x || ny !== p.y) {
      occ.delete(key(p.x, p.y));
      occ.add(key(nx, ny));
      moves.push({ id: p.id, from: { x: p.x, y: p.y }, to: { x: nx, y: ny } });
      p.x = nx;
      p.y = ny;
    }
  }

  const locked = [];
  for (const p of state.pieces) {
    if (p.locked) continue;
    const slot = state.slots.find(
      (s) =>
        s.x === p.x &&
        s.y === p.y &&
        s.c === p.c &&
        !slotFilled(state, s) &&
        orderOk(state, s)
    );
    if (slot) {
      p.locked = true;
      locked.push(p.id);
    }
  }

  state.won = state.slots.every((s) => slotFilled(state, s));
  return { moves, locked, won: state.won };
}

// 旋转容器：dir=1 顺时针，dir=-1 逆时针；随后立即沉降
function rotate(state, dir) {
  state.grav = (state.grav + (dir === 1 ? 3 : 1)) % 4;
  state.moves += 1;
  return settle(state);
}

module.exports = { DIRS, createGame, settle, rotate, slotFilled };
