/**
 * RoomClient - 微信小程序联机房间客户端（云开发实时同步版）
 *
 * 用「微信云开发」替代原 HTML 版本中的 PeerJS(WebRTC P2P) 与自建 WebSocket 服务器。
 * 不需要你自己部署任何后端：房间状态与消息流转由微信云数据库 + 一个 room 云函数完成。
 *
 * 设计：
 *   - 房间状态（成员/座位）  -> 云数据库集合 `rooms`（单文档 watch 监听成员变化）
 *   - 业务消息流（落子/笔迹）-> 云数据库集合 `msgs`（按 roomId 查询 watch 监听新消息）
 *   - 所有写操作（建房/加入/发消息/离开）-> 调用 `room` 云函数（admin 权限写入）
 *   - 客户端只 watch 读取，集合权限设为「所有用户可读」即可
 *
 * 对外接口与原 WebSocket 版完全一致，游戏页几乎无需改动：
 *   new RoomClient({ env, game, nick })
 *   client.on('created'|'joined'|'peer-join'|'peer-leave'|'data'|'error'|'reconnecting'|'open', fn)
 *   await client.createRoom(nick)
 *   await client.joinRoom(room, nick)
 *   client.send(data)            // 转发给房间内其他人
 *   client.isHost / client.room / client.peers / client.connected
 *   client.destroy()
 */

const DB_ROOMS = 'rooms';
const DB_MSGS = 'msgs';

class RoomClient {
  constructor(options = {}) {
    // 兼容旧字段名 url，统一使用云环境 env
    this.env = options.env || options.url || '';
    this.url = this.env; // 兼容 connectionHint(client.url)
    this.game = options.game || 'common';
    this.nick = options.nick || '玩家';

    this.connected = false;
    this.room = '';
    this.self = null; // { id, seat, nick }  seat: 0=房主 1=访客
    this.peers = [];  // [{ id, seat, nick }]
    this.closedByUser = false;

    this._handlers = {};
    this._roomWatcher = null;
    this._msgWatcher = null;
    this._prevPeerIds = new Set();
    this._seenMsgIds = new Set();
    this._lastSeenTs = 0;     // 轮询增量游标（createdAt）
    this._pollTimer = null;   // 轮询兜底定时器
  }

  /* ---------- 事件系统 ---------- */
  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return this;
  }

  off(event, fn) {
    if (!this._handlers[event]) return this;
    if (!fn) {
      delete this._handlers[event];
    } else {
      this._handlers[event] = this._handlers[event].filter((f) => f !== fn);
    }
    return this;
  }

  emit(event, payload) {
    const list = this._handlers[event];
    if (!list) return;
    list.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error('[RoomClient] handler error:', event, e);
      }
    });
  }

  /* ---------- 云函数调用封装 ---------- */
  _call(action, data) {
    return new Promise((resolve) => {
      if (!wx.cloud || !wx.cloud.callFunction) {
        const err = { code: 'NO_CLOUD', msg: '云能力不可用，请确认已开通云开发' };
        this.emit('error', err);
        resolve({ error: 'NO_CLOUD' });
        return;
      }
      wx.cloud.callFunction({
        name: 'room',
        data: Object.assign({ action }, data),
        success: (r) => resolve((r && r.result) || {}),
        fail: (e) => {
          const msg = (e && e.errMsg) || '云函数调用失败';
          this.emit('error', { code: 'CLOUD_FAIL', msg });
          resolve({ error: 'CLOUD_FAIL', msg });
        }
      });
    });
  }

  _errText(code) {
    switch (code) {
      case 'ROOM_NOT_FOUND': return '房间不存在或已解散';
      case 'ROOM_FULL': return '房间已满（仅支持 2 人）';
      case 'GAME_MISMATCH': return '房间类型不匹配';
      case 'NOT_IN_ROOM': return '你不在该房间内';
      case 'NO_CLOUD': return '云能力不可用，请确认已开通云开发并填入 env';
      case 'CLOUD_FAIL': return '云函数调用失败，请检查网络或 room 云函数是否已部署';
      default: return '服务器异常';
    }
  }

  /* ---------- 实时监听 ---------- */
  _db() {
    return wx.cloud.database();
  }

  _startWatch() {
    const db = this._db();
    this._prevPeerIds = new Set((this.peers || []).map((p) => p.id));
    this._lastSeenTs = 0;

    // 房间成员变化（单文档监听）
    try {
      this._roomWatcher = db.collection(DB_ROOMS).doc(this.room).watch({
        onChange: (snap) => this._onRoomChange(snap),
        onError: (e) => this._onWatchError(e, 'room')
      });
    } catch (e) {
      this.emit('error', { code: 'WATCH_ERROR', msg: '房间监听启动失败：' + (e && e.message) });
    }

    // 业务消息流（按 roomId 查询监听新增）
    try {
      this._msgWatcher = db.collection(DB_MSGS).where({ roomId: this.room }).watch({
        onChange: (snap) => this._onMsgChange(snap),
        onError: (e) => this._onWatchError(e, 'msg')
      });
    } catch (e) {
      this.emit('error', { code: 'WATCH_ERROR', msg: '消息监听启动失败：' + (e && e.message) });
    }

    // 轮询兜底：watch 在某些基础库/网络下对 where 查询不可靠，
    // 用增量轮询保证业务消息（round / 落子 / 笔迹）必达。
    this._startPoll();
  }

  _stopWatch() {
    if (this._roomWatcher) {
      try { this._roomWatcher.close(); } catch (e) { /* ignore */ }
      this._roomWatcher = null;
    }
    if (this._msgWatcher) {
      try { this._msgWatcher.close(); } catch (e) { /* ignore */ }
      this._msgWatcher = null;
    }
    this._stopPoll();
  }

  _startPoll() {
    this._stopPoll();
    this._pollTimer = setInterval(() => this._pollMsgs(), 300);
  }

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** 增量轮询业务消息（watch 兜底）：读取 createdAt >= 上次游标-500ms 的新消息 */
  _pollMsgs() {
    if (!this.room || !this.connected) return;
    let db;
    try { db = this._db(); } catch (e) { return; }
    const _ = db.command;
    const since = (this._lastSeenTs || 0) - 500;
    db.collection(DB_MSGS)
      .where({ roomId: this.room, createdAt: _.gte(since) })
      .orderBy('createdAt', 'asc')
      .limit(200)
      .get()
      .then((res) => {
        const docs = (res && res.data) || [];
        docs.forEach((doc) => {
          if (doc.createdAt && doc.createdAt > (this._lastSeenTs || 0)) {
            this._lastSeenTs = doc.createdAt;
          }
          this._deliverMsg(doc);
        });
      })
      .catch(() => { /* 权限不足或网络抖动：下次轮询重试 */ });
  }

  /** 统一的消息投递：去重 + 过滤自身回声 + 触发 data 事件 */
  _deliverMsg(doc) {
    if (!doc || !doc._id) return;
    if (this._seenMsgIds.has(doc._id)) return;
    this._seenMsgIds.add(doc._id);
    // 云数据库会把发送者自己的消息也推送回来，需过滤自身回声
    if (doc.from && this.self && doc.from === this.self.id) return;
    this.emit('data', doc.data, doc.from);
  }

  _onRoomChange(snap) {
    const doc = (snap.docs && snap.docs[0]) || null;
    if (!doc) {
      // 房间文档被删除（对方解散）
      this.emit('peer-leave', { id: this.self && this.self.id });
      return;
    }
    const peers = doc.peers || [];
    const ids = peers.map((p) => p.id);
    // diff 出发送 join / leave 事件
    ids.forEach((id) => {
      if (!this._prevPeerIds.has(id)) {
        this.emit('peer-join', peers.find((p) => p.id === id));
      }
    });
    this._prevPeerIds.forEach((id) => {
      if (!ids.includes(id)) this.emit('peer-leave', { id });
    });
    this._prevPeerIds = new Set(ids);

    this.peers = peers;
    this.self = peers.find((p) => p.id === (this.self && this.self.id)) || this.self;
  }

  _onMsgChange(snap) {
    const changes = snap.docChanges ? snap.docChanges() : [];
    changes.forEach((ch) => {
      // 处理新增(add)与初始化(init)快照：
      // 访客加入时若房主已先发出 round，该消息落在 init 快照里，必须补发，否则访客卡在等待屏。
      if (ch.type !== 'add' && ch.type !== 'init') return;
      this._deliverMsg(ch.doc);
    });
  }

  _onWatchError(e, kind) {
    // 云开发 watch 具备自动重连能力，这里仅提示 UI，不刷屏
    this.emit('reconnecting', { kind });
  }

  /* ---------- 对外 API ---------- */
  async createRoom(nick) {
    if (nick) this.nick = nick;
    const res = await this._call('create', { game: this.game, nick: this.nick });
    if (res.error) {
      const err = { code: res.error, msg: this._errText(res.error) };
      this.emit('error', err);
      throw err;
    }
    this.room = res.room;
    this.self = res.self;
    this.peers = res.peers || [];
    this.connected = true;
    this.emit('open');
    this._startWatch();
    this.emit('created', res);
  }

  async joinRoom(room, nick) {
    if (nick) this.nick = nick;
    const res = await this._call('join', {
      room: String(room).toUpperCase(),
      game: this.game,
      nick: this.nick
    });
    if (res.error) {
      const err = { code: res.error, msg: this._errText(res.error) };
      this.emit('error', err);
      throw err;
    }
    this.room = res.room;
    this.self = res.self;
    this.peers = res.peers || [];
    this.connected = true;
    this.emit('open');
    this._startWatch();
    this.emit('joined', res);
  }

  /** 向房间内其他成员发送业务数据 */
  send(data) {
    if (!this.room || !this.connected) return false;
    this._call('send', { room: this.room, data }).catch(() => {});
    return true;
  }

  get isHost() {
    return !!this.self && this.self.seat === 0;
  }

  get peerCount() {
    return this.peers.length;
  }

  destroy() {
    this.closedByUser = true;
    if (this.room && this.connected) {
      this._call('leave', { room: this.room }).catch(() => {});
    }
    this._stopWatch();
    this.connected = false;
    this.room = '';
    this.self = null;
    this.peers = [];
    this._handlers = {};
  }
}

/**
 * 云开发环境下的排错提示
 */
function connectionHint(env) {
  if (!env) {
    return '未配置云开发环境：请在 app.js 的 globalData.cloudEnv 填入你的云开发环境 ID（在云开发控制台获取）';
  }
  return '请确认：1) 已在小程序后台开通云开发并填入正确的 env id；2) 已部署 room 云函数；3) 手机/模拟器网络连接正常';
}

module.exports = { RoomClient, connectionHint };
