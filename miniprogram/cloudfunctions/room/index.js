/**
 * room 云函数 - 联机房间中转（你画我猜 / 联机五子棋共用）
 *
 * 用微信云开发替代自建 WebSocket 服务器：
 *   - 房间状态写入云数据库集合 `rooms`
 *   - 业务消息流写入云数据库集合 `msgs`
 *   - 客户端只 watch 读取，本云函数用 admin 权限写入
 *
 * 部署：在「云开发」控制台创建名为 room 的云函数（Nodejs），把本目录两个文件上传，
 *       右键「上传并部署：云端安装依赖」即可。
 *
 * 集合权限：把 rooms 与 msgs 的权限设为「所有用户可读，仅创建者可读写」
 *          （客户端不写库，写全部走本云函数的 admin 权限，故「仅创建者可写」对客户端无影响）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const ROOMS = 'rooms';
const MSGS = 'msgs';

// 排除易混淆字符 I O 0 1
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genRoomId() {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    if (action === 'create') {
      let roomId = null;
      let exists = true;
      let tries = 0;
      while (exists && tries < 12) {
        roomId = genRoomId();
        const r = await db.collection(ROOMS).doc(roomId).get().catch(() => ({ err: true }));
        exists = !r.err;
        tries += 1;
      }
      if (exists) return { error: 'GEN_ROOM_FAILED' };

      const self = { id: OPENID, seat: 0, nick: event.nick || '房主' };
      await db.collection(ROOMS).add({
        data: {
          _id: roomId,
          game: event.game,
          host: OPENID,
          peers: [self],
          state: 'waiting',
          createdAt: Date.now()
        }
      });
      return { room: roomId, self, peers: [self] };
    }

    if (action === 'join') {
      const roomId = String(event.room || '').toUpperCase();
      const doc = await db.collection(ROOMS).doc(roomId).get().catch(() => ({ err: true }));
      if (doc.err) return { error: 'ROOM_NOT_FOUND' };
      if (doc.data.game !== event.game) return { error: 'GAME_MISMATCH' };
      const peers = doc.data.peers || [];
      if (peers.length >= 2) return { error: 'ROOM_FULL' };

      const self = { id: OPENID, seat: 1, nick: event.nick || '访客' };
      // 若房主已不在（异常），加入者顶替为 seat 0
      const seat = peers.length === 0 ? 0 : 1;
      self.seat = seat;
      await db.collection(ROOMS).doc(roomId).update({ data: { peers: _.push(self) } });
      return { room: roomId, self, peers: peers.concat([self]) };
    }

    if (action === 'send') {
      const roomId = String(event.room || '').toUpperCase();
      const doc = await db.collection(ROOMS).doc(roomId).get().catch(() => ({ err: true }));
      if (doc.err) return { error: 'ROOM_NOT_FOUND' };
      const inRoom = (doc.data.peers || []).some((p) => p.id === OPENID);
      if (!inRoom) return { error: 'NOT_IN_ROOM' };

      await db.collection(MSGS).add({
        data: { roomId, from: OPENID, data: event.data, createdAt: Date.now() }
      });
      return { ok: true };
    }

    if (action === 'leave') {
      const roomId = String(event.room || '').toUpperCase();
      const doc = await db.collection(ROOMS).doc(roomId).get().catch(() => ({ err: true }));
      if (doc.err) return { ok: true };
      const peers = (doc.data.peers || []).filter((p) => p.id !== OPENID);
      if (peers.length === 0) {
        await db.collection(ROOMS).doc(roomId).remove();
        await db.collection(MSGS).where({ roomId }).remove();
      } else {
        await db.collection(ROOMS).doc(roomId).update({ data: { peers } });
      }
      return { ok: true };
    }

    return { error: 'UNKNOWN_ACTION' };
  } catch (e) {
    return { error: 'SERVER_ERROR', msg: e.message };
  }
};
