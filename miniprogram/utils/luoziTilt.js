// utils/luoziTilt.js
// 《落字》体感纯逻辑（绝对映射版）
// 加速度计向量直接映射为屏幕重力方向，无需每关校准：
//   屏幕重力向量 = S * (x, -y)（设备系 x 向右、y 向屏幕顶部；屏幕系 y 向下）
//   S=±1 吸收 iOS/Android 整体符号差异，由一次性竖直校准测定并持久化
//   mirrorY 处理个别设备单轴镜像异常（「方向反了」按钮切换）
// 方向索引与 luoziCore.DIRS 一致：0=下 1=左 2=上 3=右

const DIRS = [
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 }
];

const HPI = Math.PI / 2;
const EARLY = 5 * Math.PI / 180; // 提前 5° 切换（越过 45° 边界前 5° 即生效），兼顾响应与防抖
const FLAT_RATIO = 0.45;
const CALIB_SAMPLES = 6;

function uprightRatio(x, y, z) {
  const total = Math.sqrt(x * x + y * y + z * z);
  if (total < 1e-6) return 0;
  return Math.sqrt(x * x + y * y) / total;
}

// ---------- 一次性符号校准 ----------
function createSignCalib() {
  return { buf: [] };
}

// 喂入竖直状态样本，凑够后返回 S（+1/-1）；平放会清空缓冲
// mirrorY 必须与运行时一致，否则 S 与映射公式不配套
function feedSignCalib(c, x, y, z, mirrorY) {
  if (uprightRatio(x, y, z) < FLAT_RATIO) {
    c.buf = [];
    return null;
  }
  c.buf.push([x, y]);
  if (c.buf.length < CALIB_SAMPLES) return null;
  let sx = 0;
  let sy = 0;
  for (const p of c.buf) { sx += p[0]; sy += p[1]; }
  sy /= c.buf.length;
  // 竖直持握时屏幕重力应向下（屏幕系 +y）：
  // 常规映射 vy = S*(-sy)；mirrorY 映射 vy = S*(sy)
  const vyRaw = mirrorY ? sy : -sy;
  return vyRaw > 0 ? 1 : -1;
}

// ---------- 实时方向量化 ----------
function createTilt(S, mirrorY) {
  return {
    S: S === -1 ? -1 : 1,
    mirrorY: !!mirrorY,
    dir: -1,      // 当前量化方向（-1 表示未知）
    lastCand: -1, // 候选方向（两样本稳定判定）
    flat: false
  };
}

// 返回 { flat, changed, dir }
function feed(t, x, y, z) {
  const out = { flat: false, changed: false, dir: t.dir };
  const yy = t.mirrorY ? -y : y;
  const ratio = uprightRatio(x, yy, z);
  if (ratio < FLAT_RATIO) {
    t.flat = true;
    out.flat = true;
    return out;
  }
  t.flat = false;

  const vx = t.S * x;
  const vy = t.S * (-yy);
  const mag = Math.sqrt(vx * vx + vy * vy);
  if (mag < 1e-6) return out;

  // 候选方向：四向投影最大者
  let cand = 0;
  let best = -Infinity;
  const dots = [];
  for (let i = 0; i < 4; i++) {
    const d = vx * DIRS[i].dx + vy * DIRS[i].dy;
    dots.push(d);
    if (d > best) { best = d; cand = i; }
  }

  if (t.dir < 0) {
    t.dir = cand;
    t.lastCand = cand;
    out.dir = cand;
    out.changed = true;
    return out;
  }
  if (cand === t.dir) {
    t.lastCand = cand;
    return out;
  }

  // 提前切换：与当前方向夹角超过 45°-EARLY 即切向候选
  const angCur = Math.acos(Math.min(1, dots[t.dir] / mag));
  if (angCur <= HPI / 2 - EARLY) return out;
  // 两样本稳定，防止瞬时尖峰
  if (cand !== t.lastCand) {
    t.lastCand = cand;
    return out;
  }
  t.dir = cand;
  out.dir = cand;
  out.changed = true;
  return out;
}

module.exports = { DIRS, uprightRatio, createSignCalib, feedSignCalib, createTilt, feed, FLAT_RATIO, EARLY };
