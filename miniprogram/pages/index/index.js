// 目录页卡片（4 个游戏）：你画我猜 / 联机五子棋 / 三角洲行动 置顶
// 配色严格沿用 index.html 的 nth-child 渐变方案
const CARDS = [
  {
    id: 'draw',
    icon: '🎨',
    category: '联机游戏',
    title: '你画我猜',
    desc: '云联机版。创建房间邀请好友，一人作画一人猜词，支持笔刷颜色粗细调节与清空撤销。无后端服务器，走微信云开发实时同步。',
    tags: ['云联机', '双人'],
    catColor: '#e879f9',
    line: 'linear-gradient(90deg, #e879f9, #d946ef)',
    bg: 'radial-gradient(circle at 30% 50%, #e879f9 0%, transparent 60%), radial-gradient(circle at 70% 50%, #fb7185 0%, transparent 60%)',
    url: '/pages/draw/draw',
    delay: 0.1
  },
  {
    id: 'gomoku',
    icon: '⚫',
    category: '联机游戏',
    title: '联机五子棋',
    desc: '云联机版。创建房间对弈，房主执黑先手，支持落子回放、悔棋与认输，士别三日即当刮目相看。无后端服务器，走微信云开发实时同步。',
    tags: ['云联机', '对弈'],
    catColor: '#818cf8',
    line: 'linear-gradient(90deg, #818cf8, #6366f1)',
    bg: 'radial-gradient(circle at 30% 50%, #818cf8 0%, transparent 60%), radial-gradient(circle at 70% 50%, #a78bfa 0%, transparent 60%)',
    url: '/pages/gomoku/gomoku',
    delay: 0.2
  },
  {
    id: 'delta',
    icon: '🎯',
    category: '射击游戏',
    title: '三角洲行动',
    desc: '化身 G.T.I. 特战干员"猎鹰"，潜入敌方控制区域。虚拟摇杆操控，三种武器可选，消灭 15 名敌方士兵。',
    tags: ['FPS', '全屏体验'],
    catColor: '#60a5fa',
    line: 'linear-gradient(90deg, #60a5fa, #3b82f6)',
    bg: 'radial-gradient(circle at 30% 50%, #60a5fa 0%, transparent 60%), radial-gradient(circle at 70% 50%, #a78bfa 0%, transparent 60%)',
    url: '/pages/delta/delta',
    delay: 0.3
  },
  {
    id: 'luozi',
    icon: '🧩',
    category: '益智游戏',
    title: '落字',
    desc: '旋转容器改变重力，让汉字部件方块滑落进槽位，拼出完整汉字。20 关难度递进，陷阱与机关并存，三星通关考验规划力。',
    tags: ['益智', '重力拼字'],
    catColor: '#ff8c00',
    line: 'linear-gradient(90deg, #ff8c00, #f59e0b)',
    bg: 'radial-gradient(circle at 30% 50%, #ff8c00 0%, transparent 60%), radial-gradient(circle at 70% 50%, #fbbf24 0%, transparent 60%)',
    url: '/pages/luozi/luozi',
    delay: 0.35
  },
  {
    id: 'toi',
    icon: '🏒',
    category: '实用工具',
    title: '冰球计时 TOI',
    desc: '专业冰球比赛计时与数据统计工具，支持比赛时间管理、进球统计、上场时间记录与数据导出。',
    tags: ['计时器', '数据统计'],
    catColor: '#34d399',
    line: 'linear-gradient(90deg, #34d399, #10b981)',
    bg: 'radial-gradient(circle at 30% 50%, #34d399 0%, transparent 60%), radial-gradient(circle at 70% 50%, #06b6d4 0%, transparent 60%)',
    url: '/pages/toi/toi',
    delay: 0.4
  },
  {
    id: 'twin',
    icon: '⚡',
    category: '反应游戏',
    title: '双子闪避',
    desc: '一个手指、双重后果：你只控制蓝点，绿点永远水平镜像。危险从两侧砸来，得找一条让两个自己都安全的走位。纯反应、不烧脑、单机即玩。',
    tags: ['反应', '镜像', '单人'],
    catColor: '#f472b6',
    line: 'linear-gradient(90deg, #f472b6, #fb7185)',
    bg: 'radial-gradient(circle at 30% 50%, #f472b6 0%, transparent 60%), radial-gradient(circle at 70% 50%, #38bdf8 0%, transparent 60%)',
    url: '/pages/twin/twin',
    delay: 0.45
  }
];

Page({
  data: { cards: CARDS },

  onReady() {
    this.initBgCanvas();
  },

  // 背景连线粒子（还原 index.html 的 bgCanvas 效果）
  initBgCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#bgCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        this._canvas = canvas;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        const w = res[0].width;
        const h = res[0].height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        const dots = [];
        for (let i = 0; i < 50; i++) {
          dots.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            r: Math.random() * 1.5 + 0.5
          });
        }

        const draw = () => {
          ctx.clearRect(0, 0, w, h);
          dots.forEach((d) => {
            d.x += d.vx; d.y += d.vy;
            if (d.x < 0) d.x = w; if (d.x > w) d.x = 0;
            if (d.y < 0) d.y = h; if (d.y > h) d.y = 0;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fill();
          });
          const maxDist = 150;
          for (let i = 0; i < dots.length; i++) {
            for (let j = i + 1; j < dots.length; j++) {
              const dx = dots[i].x - dots[j].x;
              const dy = dots[i].y - dots[j].y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < maxDist) {
                ctx.beginPath();
                ctx.moveTo(dots[i].x, dots[i].y);
                ctx.lineTo(dots[j].x, dots[j].y);
                ctx.strokeStyle = `rgba(255,255,255,${0.04 * (1 - dist / maxDist)})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
              }
            }
          }
          this._raf = canvas.requestAnimationFrame(draw);
        };
        draw();
      });
  },

  goPage(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  },

  onHide() {
    this.stopBg();
  },

  onUnload() {
    this.stopBg();
  },

  stopBg() {
    if (this._raf && this._canvas) {
      this._canvas.cancelAnimationFrame(this._raf);
    }
    this._raf = null;
  }
});
