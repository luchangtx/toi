/**
 * 你画我猜 - 小程序版
 * 移植自 draw.html，游戏规则、词库、计分与工具档位与原版一致。
 * 联机通道由 WebRTC DataChannel 改为微信云开发实时同步（utils/ws.js 的 RoomClient），
 * 业务消息结构沿用原版（round / draw / dot / clear / undo / chat / correct / end / final）。
 */

const { ROUND_TIME, TOTAL_ROUNDS, BOARD_BG, randWord } = require('../../utils/drawWords.js');
const { RoomClient, connectionHint } = require('../../utils/ws.js');

const app = getApp();

/** 原版 8 档笔刷颜色 */
const COLORS = ['#1a1a1a', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de'];
/** 主题存储键（原版 localStorage 的 dg-theme） */
const THEME_KEY = 'dg-theme';
/** 笔迹发送节流间隔（ms） */
const SEND_INTERVAL = 50;
/** 单批最多累积的点数，超过立即发送 */
const MAX_BATCH_PTS = 24;
/** 聊天区最多保留条数 */
const CHAT_LIMIT = 100;

const ERR_TEXT = {
  ROOM_NOT_FOUND: '房间不存在，请检查房间号',
  ROOM_FULL: '房间已满',
  GAME_MISMATCH: '房间游戏类型不匹配',
  NOT_IN_ROOM: '尚未加入房间',
  RECONNECT_FAILED: '重连失败，请检查网络或服务器',
  SOCKET_ERROR: '连接失败，请检查服务器地址'
};

function winInfo() {
  return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

Page({
  data: {
    theme: 'dark',
    screen: 'menu',

    // 联机
    joinCode: '',
    roomCode: '',
    netStatus: '',
    netStatusCls: '',

    // 画板
    cw: 0,
    ch: 0,
    colors: COLORS,
    activeColor: '#1a1a1a',
    tool: 'pen',
    brushSize: 4,
    toolsDisabled: false,
    isDrawer: false,
    overlayText: '',

    // 对局
    scores: { p1: 0, p2: 0 },
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    timer: ROUND_TIME,
    timerDanger: false,
    drawer: 1,
    wordText: '等待开始...',
    wordCls: 'guessing',
    showHint: false,
    p1Role: '',
    p2Role: '',
    p1Status: '等待中',
    p2Status: '等待中',

    // 聊天
    chat: [],
    chatAnchor: '',
    chatInput: '',
    // 软键盘高度（px）：猜词输入条需抬到键盘之上，避免被键盘遮挡
    kbHeight: 0,

    // 结果浮层
    showResult: false,
    resultTitle: '',
    resultDesc: '',
    nextText: '下一轮',
    nextDisabled: false
  },

  /* ==================== 生命周期 ==================== */

  onLoad() {
    // 非响应式状态
    this.gameMode = 'practice';
    this.myRole = '';
    this.myPlayer = 1;
    this.currentWord = '';
    this.hintRevealed = [];
    this.isGameActive = false;
    this.guessedCorrectly = false;
    this.timerVal = ROUND_TIME;
    this.timerId = null;
    this.roundEndTimer = null;
    this.startDelayTimer = null;
    this.chatSeq = 0;
    this.resultMode = 'round';

    // 画板运行时
    this.canvas = null;
    this.ctx = null;
    this.boardW = 0;
    this.boardH = 0;
    this.boardLeft = 0;
    this.boardTop = 0;
    this.strokes = [];       // 已完成笔迹（归一化坐标），用于撤销与重放
    this.curStroke = null;   // 本地正在画的笔迹
    this.remoteStroke = null;// 远端正在画的笔迹
    this.pending = [];       // 待发送的点缓冲
    this.lastSendAt = 0;
    this.isTouching = false;

    this.client = null;

    // 画布尺寸：屏宽减去 game-wrap 左右各 20rpx 内边距，保持原版 4:3
    const info = winInfo();
    const cw = Math.floor((info.windowWidth || 375) * (750 - 40) / 750);
    const ch = Math.round(cw * 3 / 4);

    let theme = 'dark';
    try {
      theme = wx.getStorageSync(THEME_KEY) || 'dark';
    } catch (e) {
      theme = 'dark';
    }

    this.setData({ cw, ch, theme });
  },

  onShow() {
    this.applyNavTheme(this.data.theme);
  },

  onUnload() {
    this.stopTimer();
    this.clearPendingTimers();
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  },

  clearPendingTimers() {
    if (this.roundEndTimer) {
      clearTimeout(this.roundEndTimer);
      this.roundEndTimer = null;
    }
    if (this.startDelayTimer) {
      clearTimeout(this.startDelayTimer);
      this.startDelayTimer = null;
    }
  },

  /* ==================== 主题 ==================== */

  toggleTheme() {
    const t = this.data.theme === 'dark' ? 'light' : 'dark';
    this.setData({ theme: t });
    try {
      wx.setStorageSync(THEME_KEY, t);
    } catch (e) { /* ignore */ }
    this.applyNavTheme(t);
  },

  applyNavTheme(t) {
    wx.setNavigationBarColor({
      frontColor: t === 'light' ? '#000000' : '#ffffff',
      backgroundColor: t === 'light' ? '#eef1f8' : '#06080f'
    });
  },

  /* ==================== 画板 ==================== */

  initCanvas(cb) {
    wx.createSelectorQuery()
      .in(this)
      .select('#board')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) {
          if (cb) cb();
          return;
        }
        const canvas = item.node;
        const ctx = canvas.getContext('2d');
        const dpr = winInfo().pixelRatio || 1;
        canvas.width = item.width * dpr;
        canvas.height = item.height * dpr;
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        this.canvas = canvas;
        this.ctx = ctx;
        this.boardW = item.width;
        this.boardH = item.height;
        this.boardLeft = item.left || 0;
        this.boardTop = item.top || 0;

        this.redraw();
        if (cb) cb();
      });
  },

  /** 触摸点 -> 归一化坐标（0~1），两端屏幕尺寸不同也不会画歪 */
  posOf(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t || !this.boardW || !this.boardH) return null;
    let x = t.x;
    let y = t.y;
    if (typeof x !== 'number' || typeof y !== 'number') {
      x = t.clientX - this.boardLeft;
      y = t.clientY - this.boardTop;
    }
    return { x: round4(clamp01(x / this.boardW)), y: round4(clamp01(y / this.boardH)) };
  },

  effColor() {
    return this.data.tool === 'eraser' ? BOARD_BG : this.data.activeColor;
  },

  drawDot(nx, ny, color, size) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(nx * this.boardW, ny * this.boardH, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  },

  drawLine(from, to, color, size) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(from.x * this.boardW, from.y * this.boardH);
    ctx.lineTo(to.x * this.boardW, to.y * this.boardH);
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.stroke();
  },

  drawStroke(s) {
    if (!s || !s.pts || !s.pts.length) return;
    this.drawDot(s.pts[0].x, s.pts[0].y, s.color, s.size);
    for (let i = 1; i < s.pts.length; i++) {
      this.drawLine(s.pts[i - 1], s.pts[i], s.color, s.size);
    }
  },

  /** 按笔迹数据整屏重绘（撤销 / 重放 / 重新初始化画板都用它） */
  redraw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.boardW, this.boardH);
    this.strokes.forEach((s) => this.drawStroke(s));
    if (this.remoteStroke) this.drawStroke(this.remoteStroke);
    if (this.curStroke) this.drawStroke(this.curStroke);
  },

  clearBoard() {
    this.strokes = [];
    this.curStroke = null;
    this.remoteStroke = null;
    this.pending = [];
    if (this.ctx) this.ctx.clearRect(0, 0, this.boardW, this.boardH);
  },

  canDraw() {
    if (!this.isGameActive) return false;
    if (this.gameMode === 'practice') return true;
    if (this.gameMode === 'local') return true;
    if (this.gameMode === 'net') {
      return (this.myRole === 'host' && this.data.drawer === 1) ||
             (this.myRole === 'guest' && this.data.drawer === 2);
    }
    return false;
  },

  onTouchStart(e) {
    if (!this.canDraw()) return;
    const p = this.posOf(e);
    if (!p) return;
    const color = this.effColor();
    const size = this.data.brushSize;
    this.isTouching = true;
    this.curStroke = { color, size, pts: [p] };
    this.pending = [];
    this.lastSendAt = Date.now();
    this.drawDot(p.x, p.y, color, size);
    this.netSend({ type: 'dot', x: p.x, y: p.y, color, size });
  },

  onTouchMove(e) {
    if (!this.isTouching || !this.canDraw()) return;
    const s = this.curStroke;
    if (!s) return;
    const p = this.posOf(e);
    if (!p) return;
    const last = s.pts[s.pts.length - 1];
    if (last.x === p.x && last.y === p.y) return;

    this.drawLine(last, p, s.color, s.size);
    s.pts.push(p);
    this.pending.push(p);

    // 节流：每 50ms（或攒够 24 个点）批量发送一次，避免刷爆通道
    if (Date.now() - this.lastSendAt >= SEND_INTERVAL || this.pending.length >= MAX_BATCH_PTS) {
      this.flushPending();
    }
  },

  onTouchEnd() {
    if (!this.isTouching) return;
    this.isTouching = false;
    this.flushPending();
    if (this.curStroke && this.curStroke.pts.length) {
      this.strokes.push(this.curStroke);
      this.netSend({ type: 'stroke-end' });
    }
    this.curStroke = null;
  },

  flushPending() {
    this.lastSendAt = Date.now();
    if (!this.pending.length || !this.curStroke) return;
    this.netSend({
      type: 'draw',
      pts: this.pending,
      color: this.curStroke.color,
      size: this.curStroke.size
    });
    this.pending = [];
  },

  /* ==================== 工具栏 ==================== */

  onPickColor(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ activeColor: color, tool: 'pen' });
  },

  onToolPen() {
    this.setData({ tool: 'pen' });
  },

  onToolEraser() {
    this.setData({ tool: 'eraser' });
  },

  onToolClear() {
    if (!this.canDraw()) return;
    this.clearBoard();
    this.netSend({ type: 'clear' });
  },

  onToolUndo() {
    if (!this.canDraw()) return;
    if (!this.strokes.length) return;
    this.strokes.pop();
    this.redraw();
    this.netSend({ type: 'undo' });
  },

  onBrushSize(e) {
    this.setData({ brushSize: e.detail.value });
  },

  /* ==================== 词语显示 / 提示 ==================== */

  isDrawerNow() {
    if (this.gameMode === 'practice' || this.gameMode === 'local') return true;
    if (this.gameMode === 'net') {
      return (this.myRole === 'host' && this.data.drawer === 1) ||
             (this.myRole === 'guest' && this.data.drawer === 2);
    }
    return false;
  },

  maskedWord() {
    return Array.from(this.currentWord)
      .map((ch, i) => (this.hintRevealed.indexOf(i) >= 0 ? ch : '＿'))
      .join(' ');
  },

  canUseHint() {
    return this.isGameActive &&
      (Array.from(this.currentWord).length - this.hintRevealed.length) > 1;
  },

  updateWordDisplay() {
    if (this.isDrawerNow()) {
      this.setData({
        wordText: '你要画：' + this.currentWord,
        wordCls: 'drawing',
        showHint: false
      });
    } else {
      const len = Array.from(this.currentWord).length;
      this.setData({
        wordText: '猜词：' + this.maskedWord() + '（' + len + '字）',
        wordCls: 'guessing',
        showHint: this.canUseHint()
      });
    }
  },

  onUseHint() {
    if (!this.canUseHint()) return;
    const remaining = [];
    Array.from(this.currentWord).forEach((_, i) => {
      if (this.hintRevealed.indexOf(i) < 0) remaining.push(i);
    });
    const idx = remaining[Math.floor(Math.random() * remaining.length)];
    this.hintRevealed.push(idx);
    this.addChat('system', '使用了提示，揭开了一个字');
    this.updateWordDisplay();
  },

  /* ==================== 对局流程 ==================== */

  onStartPractice() {
    this.startGame('practice');
  },

  onStartLocal() {
    this.startGame('local');
  },

  startGame(mode) {
    this.gameMode = mode;
    this.myPlayer = mode === 'net' ? (this.myRole === 'host' ? 1 : 2) : 1;
    this.clearBoard();
    this.setData({
      screen: 'game',
      showResult: false,
      round: 1,
      drawer: 1,
      scores: { p1: 0, p2: 0 }
    }, () => {
      this.initCanvas(() => this.startRound());
    });
  },

  startRound() {
    this.isGameActive = true;
    this.guessedCorrectly = false;
    this.timerVal = ROUND_TIME;
    this.currentWord = randWord();
    this.hintRevealed = [];
    this.chatSeq = 0;
    this.clearBoard();

    const isDrawer = this.isDrawerNow();
    this.setData({
      chat: [],
      totalRounds: TOTAL_ROUNDS,
      timer: this.timerVal,
      timerDanger: false,
      toolsDisabled: !isDrawer,
      isDrawer: isDrawer,
      showResult: false
    });

    this.updateWordDisplay();
    this.addChat('system', isDrawer
      ? '轮到你画画了！请画「' + this.currentWord + '」'
      : '对手正在画画，快猜！');
    this.updatePlayers();
    this.startTimer();

    // 联机：房主把回合信息（含权威分数）同步给访客
    if (this.gameMode === 'net' && this.myRole === 'host') {
      this.netSend({
        type: 'round',
        round: this.data.round,
        word: this.currentWord,
        drawer: this.data.drawer,
        timer: this.timerVal,
        scores: this.data.scores
      });
    }
  },

  startTimer() {
    this.stopTimer();
    this.timerId = setInterval(() => {
      this.timerVal--;
      this.setData({ timer: this.timerVal, timerDanger: this.timerVal <= 10 });
      if (this.timerVal <= 0) {
        this.stopTimer();
        this.endRound(false);
      }
    }, 1000);
  },

  stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  },

  endRound(correct) {
    this.isGameActive = false;
    this.stopTimer();

    const isNetGuest = this.gameMode === 'net' && this.myRole === 'guest';

    // 原版规则：答对则画者与猜者各 +10。
    // 联机时分数以房主为权威（随后的 end 消息会下发），访客不自行加分，
    // 否则「访客先收到 end、再执行本地 endRound」会把同一回合加两次。
    const scores = { p1: this.data.scores.p1, p2: this.data.scores.p2 };
    if (correct && !isNetGuest) {
      scores.p1 += 10;
      scores.p2 += 10;
    }

    this.addChat('system', correct
      ? '答对了！答案是「' + this.currentWord + '」'
      : '时间到！答案是「' + this.currentWord + '」');

    const isLast = this.data.round >= TOTAL_ROUNDS;
    const nextText = isNetGuest
      ? (isLast ? '等待房主开始新游戏…' : '等待房主开始下一轮…')
      : (isLast ? '查看最终结果' : '下一轮');

    this.resultMode = 'round';
    this.setData({
      scores,
      showResult: true,
      resultTitle: correct ? '答对了！' : '时间到！',
      resultDesc: correct
        ? '答案是「' + this.currentWord + '」，双方各得 10 分'
        : '答案是「' + this.currentWord + '」',
      nextText,
      nextDisabled: isNetGuest
    });
    this.updatePlayers();

    // 房主把本回合结束信息（含权威分数）同步给访客
    if (this.gameMode === 'net' && this.myRole === 'host') {
      this.netSend({ type: 'end', scores, word: this.currentWord });
    }
  },

  onNextRound() {
    // 联机模式由房主驱动回合，访客不主动推进
    if (this.gameMode === 'net' && this.myRole === 'guest') return;
    // 防止快速连点导致回合号 / 画者被推进两次
    if (this.isGameActive) return;

    if (this.resultMode === 'final') {
      this.startGame(this.gameMode);
      return;
    }

    this.setData({ showResult: false });

    if (this.data.round >= TOTAL_ROUNDS) {
      this.showFinal();
      return;
    }

    this.setData({
      round: this.data.round + 1,
      drawer: this.data.drawer === 1 ? 2 : 1
    }, () => this.startRound());
  },

  showFinal() {
    const p1 = this.data.scores.p1;
    const p2 = this.data.scores.p2;
    let title = '平局！';
    if (p1 > p2) title = '玩家1 获胜！';
    else if (p2 > p1) title = '玩家2 获胜！';

    this.resultMode = 'final';
    this.setData({
      showResult: true,
      resultTitle: title,
      resultDesc: '最终比分 ' + p1 + ' : ' + p2,
      nextText: '再来一局',
      nextDisabled: false
    });

    if (this.gameMode === 'net' && this.myRole === 'host') {
      this.netSend({ type: 'final', scores: this.data.scores });
    }
  },

  onQuitGame() {
    this.stopTimer();
    this.clearPendingTimers();
    this.isGameActive = false;
    if (this.gameMode === 'net') this.resetNet();
    this.setData({ showResult: false, screen: 'menu' });
  },

  /* ==================== 聊天 / 猜词 ==================== */

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value });
  },

  /** 猜词输入框聚焦：记录键盘高度，把底部输入条抬到键盘之上 */
  onGuessFocus(e) {
    const h = (e && e.detail && e.detail.height) || 0;
    if (h !== this.data.kbHeight) this.setData({ kbHeight: h });
  },

  /** 猜词输入框失焦：恢复输入条到屏幕底部 */
  onGuessBlur() {
    if (this.data.kbHeight !== 0) this.setData({ kbHeight: 0 });
  },

  onSubmitGuess() {
    const text = (this.data.chatInput || '').trim();
    if (!text || !this.isGameActive) return;

    const isDrawer = this.isDrawerNow();
    this.addChat('p' + this.myPlayer, text);
    if (this.gameMode === 'net') {
      this.netSend({ type: 'chat', player: this.myPlayer, text });
    }

    // 画者只能聊天，不参与判定（与原版一致）
    if (!isDrawer && !this.guessedCorrectly && text === this.currentWord) {
      this.guessedCorrectly = true;
      this.addChat('system', '回答正确！');
      if (this.gameMode === 'net') {
        this.netSend({ type: 'correct', player: this.myPlayer });
      }
      this.roundEndTimer = setTimeout(() => {
        this.roundEndTimer = null;
        this.endRound(true);
      }, 500);
    }

    this.setData({ chatInput: '' });
  },

  addChat(type, text) {
    const id = ++this.chatSeq;
    let name = '';
    if (type === 'p1') name = '玩家1';
    else if (type === 'p2') name = '玩家2';
    const chat = this.data.chat.concat([{ id, type, text, name }]);
    if (chat.length > CHAT_LIMIT) chat.splice(0, chat.length - CHAT_LIMIT);
    this.setData({ chat, chatAnchor: 'msg' + id });
  },

  updatePlayers() {
    const drawer = this.data.drawer;
    const isNet = this.gameMode === 'net';
    this.setData({
      p1Status: drawer === 1 ? '正在画...' : '猜词中',
      p2Status: drawer === 1 ? '猜词中' : '正在画...',
      p1Role: isNet && this.myRole === 'host' ? '(你)' : '',
      p2Role: isNet && this.myRole === 'guest' ? '(你)' : ''
    });
  },

  /* ==================== 联机（WebSocket 房间） ==================== */

  onGotoNetMenu() {
    this.setData({ screen: 'net-menu', joinCode: '' });
  },

  onBackToMenu() {
    this.setData({ screen: 'menu' });
  },

  onJoinCodeInput(e) {
    this.setData({ joinCode: (e.detail.value || '').toUpperCase() });
  },

  ensureClient() {
    if (this.client) return this.client;

    const client = new RoomClient({
      env: app.globalData.cloudEnv,
      game: 'draw',
      nick: this.myRole === 'host' ? '玩家1' : '玩家2'
    });

    client.on('created', (m) => {
      this.setData({
        roomCode: m.room,
        netStatus: '等待好友加入...',
        netStatusCls: ''
      });
    });

    client.on('joined', (m) => {
      this.setData({
        roomCode: m.room,
        netStatus: '连接成功！等待房主开始...',
        netStatusCls: 'connected'
      });
    });

    client.on('peer-join', () => {
      if (this.myRole !== 'host') return;
      if (this.data.screen === 'game') {
        // 对手中途进房/重连：补发当前回合与已有笔迹
        this.netSend({
          type: 'round',
          round: this.data.round,
          word: this.currentWord,
          drawer: this.data.drawer,
          timer: this.timerVal,
          scores: this.data.scores
        });
        this.netSend({ type: 'replay', strokes: this.strokes });
        return;
      }
      this.setData({ netStatus: '连接成功！正在启动游戏...', netStatusCls: 'connected' });
      this.startDelayTimer = setTimeout(() => {
        this.startDelayTimer = null;
        this.startGame('net');
      }, 500);
    });

    client.on('peer-leave', () => {
      this.stopTimer();
      this.clearPendingTimers();
      this.isGameActive = false;
      wx.showToast({ title: '对方已离开', icon: 'none' });
      this.setData({ netStatus: '对方已离开', netStatusCls: 'error' });
    });

    client.on('data', (data) => this.handleNetMessage(data));

    client.on('reconnecting', () => {
      this.setData({ netStatus: '断线重连中...', netStatusCls: 'waiting' });
      wx.showToast({ title: '断线重连中...', icon: 'none' });
    });

    client.on('error', (e) => {
      const code = e && e.code;
      let msg = (e && (e.msg || e.errMsg)) || ERR_TEXT[code] || '联机出错';
      if (code === 'SOCKET_ERROR' || code === 'CONNECT_TIMEOUT') {
        msg += '。' + connectionHint(e.url);
      }
      this.setData({ netStatus: msg, netStatusCls: 'error' });
      wx.showToast({ title: msg, icon: 'none' });
    });

    this.client = client;
    return client;
  },

  onHostStart() {
    this.myRole = 'host';
    this.setData({
      screen: 'host',
      roomCode: '',
      netStatus: '正在连接服务器...',
      netStatusCls: 'waiting'
    });
    const client = this.ensureClient();
    client.createRoom('玩家1').catch((err) => {
      const raw = (err && (err.errMsg || err.msg)) || '连接服务器失败';
      this.setData({ netStatus: raw + '。' + connectionHint(client.url), netStatusCls: 'error' });
    });
  },

  onGuestStart() {
    const code = (this.data.joinCode || '').trim().toUpperCase();
    if (code.length !== 4) {
      wx.showToast({ title: '请输入 4 位房间号', icon: 'none' });
      return;
    }
    this.myRole = 'guest';
    this.setData({
      screen: 'guest',
      roomCode: code,
      netStatus: '正在加入房间...',
      netStatusCls: 'waiting'
    });
    const client = this.ensureClient();
    client.joinRoom(code, '玩家2').catch((err) => {
      const raw = (err && (err.errMsg || err.msg)) || '连接服务器失败';
      this.setData({ netStatus: raw + '。' + connectionHint(client.url), netStatusCls: 'error' });
    });
  },

  onCopyRoom() {
    if (!this.data.roomCode) return;
    wx.setClipboardData({
      data: this.data.roomCode,
      success: () => wx.showToast({ title: '房间号已复制', icon: 'none' })
    });
  },

  onCancelNet() {
    this.resetNet();
    this.setData({ screen: 'menu' });
  },

  resetNet() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.myRole = '';
    this.setData({ roomCode: '', netStatus: '', netStatusCls: '' });
  },

  netSend(obj) {
    if (this.gameMode !== 'net' || !this.client) return;
    this.client.send(obj);
  },

  handleNetMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      /* -------- 回合开始（房主 -> 访客） -------- */
      case 'round': {
        if (this.gameMode !== 'net') {
          this.gameMode = 'net';
          this.myPlayer = this.myRole === 'guest' ? 2 : 1;
        }
        const needInit = this.data.screen !== 'game';

        this.isGameActive = true;
        this.guessedCorrectly = false;
        this.hintRevealed = [];
        this.currentWord = msg.word;
        this.timerVal = msg.timer;
        this.chatSeq = 0;
        this.clearBoard();

        this.setData({
          screen: 'game',
          showResult: false,
          round: msg.round,
          totalRounds: TOTAL_ROUNDS,
          drawer: msg.drawer,
          scores: msg.scores || this.data.scores,
          timer: msg.timer,
          timerDanger: msg.timer <= 10,
          chat: []
        }, () => {
          if (needInit) {
            this.initCanvas(() => this.afterRemoteRound());
          } else {
            this.afterRemoteRound();
          }
        });
        break;
      }

      /* -------- 笔迹 -------- */
      case 'dot': {
        this.remoteStroke = { color: msg.color, size: msg.size, pts: [{ x: msg.x, y: msg.y }] };
        this.drawDot(msg.x, msg.y, msg.color, msg.size);
        break;
      }

      case 'draw': {
        const pts = msg.pts || [];
        if (!pts.length) break;
        if (!this.remoteStroke) {
          this.remoteStroke = { color: msg.color, size: msg.size, pts: [pts[0]] };
          this.drawDot(pts[0].x, pts[0].y, msg.color, msg.size);
        }
        const s = this.remoteStroke;
        pts.forEach((p) => {
          const last = s.pts[s.pts.length - 1];
          if (last.x === p.x && last.y === p.y) return;
          this.drawLine(last, p, s.color, s.size);
          s.pts.push(p);
        });
        break;
      }

      case 'stroke-end': {
        if (this.remoteStroke) {
          this.strokes.push(this.remoteStroke);
          this.remoteStroke = null;
        }
        break;
      }

      case 'clear':
        this.clearBoard();
        break;

      case 'undo':
        this.strokes.pop();
        this.remoteStroke = null;
        this.redraw();
        break;

      case 'replay':
        this.strokes = msg.strokes || [];
        this.remoteStroke = null;
        this.redraw();
        break;

      /* -------- 聊天 / 判定 -------- */
      case 'chat':
        this.addChat('p' + msg.player, msg.text);
        break;

      case 'correct': {
        this.guessedCorrectly = true;
        this.addChat('system', '回答正确！');
        this.roundEndTimer = setTimeout(() => {
          this.roundEndTimer = null;
          this.endRound(true);
        }, 500);
        break;
      }

      /* -------- 回合结束 / 最终结果（房主权威分数） -------- */
      case 'end': {
        if (msg.scores) this.setData({ scores: msg.scores });
        if (this.data.showResult && msg.word) {
          this.setData({ resultDesc: '答案是「' + msg.word + '」' });
        }
        this.updatePlayers();
        break;
      }

      case 'final': {
        const scores = msg.scores || this.data.scores;
        let title = '平局！';
        if (scores.p1 > scores.p2) title = '玩家1 获胜！';
        else if (scores.p2 > scores.p1) title = '玩家2 获胜！';
        this.resultMode = 'final';
        this.setData({
          scores,
          showResult: true,
          resultTitle: title,
          resultDesc: '最终比分 ' + scores.p1 + ' : ' + scores.p2,
          nextText: '等待房主开始新游戏…',
          nextDisabled: true
        });
        break;
      }

      default:
        break;
    }
  },

  /** 访客收到 round 后的本地初始化（与 startRound 的界面部分一致） */
  afterRemoteRound() {
    const isDrawer = this.isDrawerNow();
    this.setData({ toolsDisabled: !isDrawer, isDrawer: isDrawer });
    this.updateWordDisplay();
    this.addChat('system', isDrawer
      ? '轮到你画画了！请画「' + this.currentWord + '」'
      : '对手正在画画，快猜！');
    this.updatePlayers();
    this.startTimer();
  }
});
