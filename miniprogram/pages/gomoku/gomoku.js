// 联机五子棋 —— 1:1 移植自 wzq.html
// 联机通道：PeerJS(WebRTC) → 微信云开发实时同步 RoomClient（小程序不支持 WebRTC）
// 业务消息结构保持原样：{type:'move',row,col} / {type:'restart'} / {type:'surrender'}

const { RoomClient, connectionHint } = require('../../utils/ws.js');

const SIZE = 15; // 原版棋盘 15 路

/** 空棋盘：Array(15).fill().map(() => Array(15).fill(null)) */
function createEmptyBoard() {
  const b = [];
  for (let row = 0; row < SIZE; row++) {
    const line = [];
    for (let col = 0; col < SIZE; col++) line.push(null);
    b.push(line);
  }
  return b;
}

/** 渲染用格子列表，cls 承担原版靠 data-row/data-col 做的边缘去线 */
function buildCells() {
  const list = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      let cls = '';
      if (row === 0) cls += ' r0';
      if (row === SIZE - 1) cls += ' r14';
      if (col === 0) cls += ' c0';
      if (col === SIZE - 1) cls += ' c14';
      list.push({
        k: row * SIZE + col,
        row: row,
        col: col,
        cls: cls.trim(),
        piece: null,
        last: false
      });
    }
  }
  return list;
}

Page({
  data: {
    phase: 'menu',          // menu(创建/加入) | waiting(等待对手) | playing(对局中)
    roomId: '',
    joinRoomId: '',
    connecting: false,
    statusText: '等待开始',
    cells: []
  },

  /* ================= 生命周期 ================= */

  onLoad() {
    // 非渲染状态放在实例上，避免 setData 抖动（对应原版顶层变量）
    this.client = null;
    this.myColor = null;        // 'black' | 'white'
    this.currentTurn = 'black';
    this.board = createEmptyBoard();
    this.gameStarted = false;
    this.winner = null;
    this.lastMove = null;
    this.reconnecting = false;
    this._modalShown = false;

    this.initBoard(); // 原版脚本末尾的 initBoard()
  },

  onUnload() {
    if (this.client) {
      this.client.destroy(); // 内部会清掉心跳 setInterval
      this.client = null;
    }
  },

  /* ================= 棋盘 ================= */

  /** 对应原版 initBoard() */
  initBoard() {
    this.board = createEmptyBoard();
    this.winner = null;
    this.lastMove = null;
    this.setData({
      cells: buildCells(),
      statusText: this.gameStarted ? this.turnText() : '等待开始'
    });
  },

  turnText() {
    return (
      '你执' + (this.myColor === 'black' ? '黑' : '白') + '棋，' +
      (this.currentTurn === this.myColor ? '你的回合' : '对手回合')
    );
  },

  /** 落子并局部刷新（对应原版 board 赋值 + renderPieces()） */
  applyPiece(row, col, color) {
    this.board[row][col] = color;
    const idx = row * SIZE + col;
    const patch = {};
    patch['cells[' + idx + '].piece'] = color;
    patch['cells[' + idx + '].last'] = true;
    if (this.lastMove) {
      const prev = this.lastMove.row * SIZE + this.lastMove.col;
      patch['cells[' + prev + '].last'] = false;
    }
    this.lastMove = { row: row, col: col };
    this.setData(patch);
  },

  /** 判断连五（与原版 checkWin 逐字一致） */
  checkWin(row, col, color) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let d = 0; d < dirs.length; d++) {
      const dr = dirs[d][0];
      const dc = dirs[d][1];
      let count = 1;
      for (let i = 1; i < 5; i++) {
        const nr = row + dr * i;
        const nc = col + dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || this.board[nr][nc] !== color) break;
        count++;
      }
      for (let i = 1; i < 5; i++) {
        const nr = row - dr * i;
        const nc = col - dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || this.board[nr][nc] !== color) break;
        count++;
      }
      if (count >= 5) return true;
    }
    return false;
  },

  /** 判断平局（与原版 checkDraw 一致） */
  checkDraw() {
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        if (!this.board[row][col]) return false;
      }
    }
    return true;
  },

  /** 对应原版 showGameEnd() */
  showGameEnd(msg) {
    this.gameStarted = false;
    this.setData({ statusText: msg });
  },

  /* ================= 落子交互 ================= */

  onCellTap(e) {
    const ds = e.currentTarget.dataset;
    this.handleCellClick(Number(ds.row), Number(ds.col));
  },

  /** 对应原版 handleCellClick() */
  handleCellClick(row, col) {
    // 合法性校验：未开局 / 已分胜负 / 不是自己回合 / 该点已有子
    if (!this.gameStarted || this.winner || this.currentTurn !== this.myColor) return;
    if (!(row >= 0 && row < SIZE && col >= 0 && col < SIZE)) return;
    if (this.board[row][col]) return;

    const myColor = this.myColor;
    this.applyPiece(row, col, myColor);
    if (this.client) this.client.send({ type: 'move', row: row, col: col });

    if (this.checkWin(row, col, myColor)) {
      this.winner = myColor;
      this.showGameEnd('🎉 你赢了！');
    } else if (this.checkDraw()) {
      this.showGameEnd('🤝 平局！');
    } else {
      this.currentTurn = this.currentTurn === 'black' ? 'white' : 'black';
      // 原版此处误写 getElementById('statusBar')（不存在）导致状态不刷新，这里修正
      this.setData({ statusText: this.turnText() });
    }
  },

  /* ================= 联机 ================= */

  buildClient() {
    if (this.client) this.client.destroy(); // 对应原版 if (peer) peer.destroy()

    const app = getApp();
    const client = new RoomClient({
      env: app.globalData.cloudEnv,
      game: 'gomoku',
      nick: '玩家'
    });

    // 房主建房成功
    client.on('created', (m) => {
      if (this.gameStarted) { this.setData({ roomId: m.room }); return; } // 断线重连重放，忽略
      this.setData({
        phase: 'waiting',
        connecting: false,
        roomId: m.room,
        statusText: '等待对手加入...'
      });
    });

    // 访客加入成功 → 执白，对手先下（对应原版 conn.on('open')）
    client.on('joined', (m) => {
      if (this.gameStarted) { this.setData({ roomId: m.room }); return; }
      this.myColor = 'white';
      this.gameStarted = true;
      this.currentTurn = 'black';
      this.initBoard();
      this.setData({
        phase: 'playing',
        connecting: false,
        roomId: m.room,
        statusText: '你执白棋，对手先下'
      });
    });

    // 对手进房 → 房主执黑开局（对应原版 peer.on('connection')）
    client.on('peer-join', () => {
      if (!client.isHost || this.gameStarted) return;
      this.myColor = 'black';
      this.gameStarted = true;
      this.currentTurn = 'black';
      this.initBoard();
      this.setData({ phase: 'playing', statusText: '你执黑棋，轮到你下' });
    });

    // 对手掉线（对应原版 conn.on('close')）
    client.on('peer-leave', () => {
      this.gameStarted = false;
      this.showModalOnce('对手已断开连接');
    });

    client.on('data', (data) => this.onPeerData(data));

    client.on('reconnecting', (e) => {
      this.reconnecting = true;
      this.setData({ statusText: '连接断开，正在重连…(' + e.attempt + ')' });
    });

    client.on('open', () => {
      if (this.reconnecting) {
        this.reconnecting = false;
        if (this.gameStarted) this.setData({ statusText: this.turnText() });
      }
    });

    client.on('error', (e) => {
      const code = e && e.code;
      // 重连过程中的瞬时 socket 错误交给 reconnecting / RECONNECT_FAILED 处理
      if (code === 'SOCKET_ERROR' && this.reconnecting) return;

      let msg;
      if (code === 'ROOM_NOT_FOUND') msg = '房间号不存在或连接失败，请检查';
      else if (code === 'ROOM_FULL') msg = '房间已满，无法加入';
      else if (code === 'GAME_MISMATCH') msg = '该房间不是五子棋房间';
      else if (code === 'RECONNECT_FAILED') msg = '重连失败，请检查网络后重试';
      else if (code === 'CONNECT_TIMEOUT') msg = '连接服务器超时（' + (e.url || '') + '）';
      else msg = '连接出错：' + ((e && (e.msg || e.errMsg)) || '未知错误');

      if (code === 'SOCKET_ERROR' || code === 'CONNECT_TIMEOUT') {
        msg += '。' + connectionHint(e.url);
      }
      this.setData({ connecting: false });
      this.showModalOnce(msg);
    });

    this.client = client;
    return client;
  },

  /** 收到对手消息（对应原版 conn.on('data')） */
  onPeerData(data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'move') {
      const row = data.row;
      const col = data.col;
      // 反作弊 / 防不同步校验
      if (!this.gameStarted || this.winner) return;
      if (typeof row !== 'number' || typeof col !== 'number') return;
      if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
      if (this.board[row][col]) return;
      if (this.currentTurn === this.myColor) return; // 现在轮到我，对手无权落子

      const color = this.currentTurn; // 原版：board[row][col] = currentTurn
      this.applyPiece(row, col, color);

      if (this.checkWin(row, col, color)) {
        this.winner = color;
        this.showGameEnd(this.winner === this.myColor ? '🎉 你赢了！' : '😅 你输了');
      } else if (this.checkDraw()) {
        this.showGameEnd('🤝 平局！');
      } else {
        this.currentTurn = color === 'black' ? 'white' : 'black';
        this.setData({ statusText: this.turnText() });
      }
    } else if (data.type === 'restart') {
      if (!this.myColor) return;
      this.currentTurn = 'black';
      this.winner = null;
      this.gameStarted = true; // 原版遗漏，导致重开后无法落子，这里修正
      this.initBoard();
      wx.showToast({ title: '对手重新开始了一局', icon: 'none' });
    } else if (data.type === 'surrender') {
      this.showGameEnd('🎉 对手认输了，你赢了！');
    }
  },

  /* ================= 房间操作 ================= */

  onRoomInput(e) {
    this.setData({ joinRoomId: (e.detail.value || '').toUpperCase() });
  },

  /** 对应原版 createRoom() */
  createRoom() {
    if (this.data.connecting) return;
    this.setData({ connecting: true });
    const client = this.buildClient();
    client.createRoom().catch((err) => {
      const raw = (err && (err.errMsg || err.msg)) || '房间创建失败，请重试';
      this.setData({ connecting: false });
      this.showModalOnce(raw + '。' + connectionHint(client.url));
    });
  },

  /** 对应原版 joinRoom() */
  joinRoom() {
    if (this.data.connecting) return;
    const roomId = (this.data.joinRoomId || '').trim();
    if (!roomId) {
      wx.showToast({ title: '请输入房间号', icon: 'none' });
      return;
    }
    this.setData({ connecting: true });
    const client = this.buildClient();
    client.joinRoom(roomId).catch((err) => {
      const raw = (err && (err.errMsg || err.msg)) || '房间号不存在或连接失败，请检查';
      this.setData({ connecting: false });
      this.showModalOnce(raw + '。' + connectionHint(client.url));
    });
  },

  copyRoomId() {
    if (!this.data.roomId) return;
    wx.setClipboardData({
      data: this.data.roomId,
      success: () => wx.showToast({ title: '房间号已复制', icon: 'none' })
    });
  },

  /** 对应原版 restartGame() */
  restartGame() {
    // 原版把发送条件写成 gameStarted && conn.open，分出胜负后无法同步重开，这里改为在房内即发送
    if (this.client) this.client.send({ type: 'restart' });
    this.currentTurn = 'black';
    this.winner = null;
    this.gameStarted = true;
    this.initBoard();
  },

  /** 对应原版 surrender() */
  surrender() {
    wx.showModal({
      title: '提示',
      content: '确定认输吗？',
      success: (res) => {
        if (!res.confirm) return;
        if (this.gameStarted && this.client) this.client.send({ type: 'surrender' });
        this.showGameEnd('😅 你认输了');
      }
    });
  },

  /** 对应原版 disconnect() */
  disconnect() {
    wx.showModal({
      title: '提示',
      content: '确定退出房间吗？',
      success: (res) => {
        if (res.confirm) this.resetToMenu(); // 等效原版 peer.destroy() + location.reload()
      }
    });
  },

  /* ================= 工具 ================= */

  showModalOnce(content) {
    if (this._modalShown) return;
    this._modalShown = true;
    wx.showModal({
      title: '提示',
      content: content,
      showCancel: false,
      success: () => this.resetToMenu(),
      fail: () => this.resetToMenu()
    });
  },

  /** 等效原版 location.reload()：回到初始状态 */
  resetToMenu() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.myColor = null;
    this.currentTurn = 'black';
    this.gameStarted = false;
    this.winner = null;
    this.lastMove = null;
    this.board = createEmptyBoard();
    this.reconnecting = false;
    this._modalShown = false;
    this.setData({
      phase: 'menu',
      roomId: '',
      joinRoomId: '',
      connecting: false,
      statusText: '等待开始',
      cells: buildCells()
    });
  }
});
