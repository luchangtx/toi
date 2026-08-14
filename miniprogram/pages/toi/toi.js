// 冰球比赛计时与统计系统 —— 1:1 移植自 711.html + statics/js/timer_plus.js
var toiCore = require('../../utils/toiCore.js');
var csv = require('../../utils/csv.js');

var THEME_KEY = 'timers-theme';
var TICK_MS = 250;      // 时间轴轮询间隔（真实走时由 Date.now() 差值决定）
var FAST_MS = 200;      // 原版长按快进/快退的重复间隔
var TIP_MS = 2000;      // 原版 tipModal 显示时长
var END_DELAY = 1500;   // 原版比赛结束提示延迟

Page({
  data: {
    theme: 'dark',
    themeIcon: '🌓',
    watermark: '',
    globalText: '00:00',
    isRunning: false,
    cards: [],
    goals: [],
    results: [],
    showResults: false,

    setupVisible: false,
    teamOptions: [
      { label: '主队', value: '1' },
      { label: '客队', value: '2' }
    ],
    form: {
      players: String(toiCore.FORM_DEFAULT_PLAYERS),
      minutes: String(toiCore.FORM_DEFAULT_MINUTES),
      teamIndex: 0
    },

    batchVisible: false,
    batchRows: [],

    scoreVisible: false,
    scoreTitle: '得分/失分',
    editSerial: '',
    editNumber: '',
    editRole: '',

    tipShow: false,
    tipText: ''
  },

  onLoad: function () {
    this.core = toiCore.createCore();
    this.ticker = null;
    this.fastTimer = null;
    this.tipTimer = null;
    this.endTimer = null;

    var saved = wx.getStorageSync(THEME_KEY);
    var theme = saved === 'light' ? 'light' : 'dark';
    this.setData({
      theme: theme,
      themeIcon: theme === 'light' ? '☀' : '🌓',
      setupVisible: true // 原版：加载即弹出设置比赛内容
    });

    wx.setKeepScreenOn({ keepScreenOn: true });
  },

  onUnload: function () {
    this.stopTicker();
    this.clearFast();
    if (this.tipTimer) { clearTimeout(this.tipTimer); this.tipTimer = null; }
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    wx.setKeepScreenOn({ keepScreenOn: false });
  },

  /* ══════════ 主题切换（原版 localStorage timers-theme） ══════════ */
  onToggleTheme: function () {
    var next = this.data.theme === 'light' ? 'dark' : 'light';
    wx.setStorageSync(THEME_KEY, next);
    this.setData({ theme: next, themeIcon: next === 'light' ? '☀' : '🌓' });
  },

  /* ══════════ 设置弹窗 ══════════ */
  onFormPlayers: function (e) {
    this.setData({ 'form.players': e.detail.value });
  },

  onFormMinutes: function (e) {
    this.setData({ 'form.minutes': e.detail.value });
  },

  onFormTeam: function (e) {
    this.setData({ 'form.teamIndex': Number(e.detail.value) });
  },

  onSetupSubmit: function () {
    var form = this.data.form;
    var teamValue = this.data.teamOptions[form.teamIndex].value;
    // 原版顺序：先设置水印，再做人数/时长校验
    var watermark = toiCore.setTitle(teamValue);
    this.setData({ watermark: watermark });

    var players = parseInt(form.players, 10);
    var initMinutes = parseInt(form.minutes, 10);
    var err = this.core.validateSetup(players, initMinutes);
    if (err) {
      this.showAlert(err);
      return;
    }

    this.core.init(players, initMinutes, teamValue);
    this.setData({
      setupVisible: false,
      goals: [],
      results: [],
      showResults: false
    });
    this.refreshAll();
  },

  /* ══════════ 卡片 上场 / 下场 ══════════ */
  onCardTap: function (e) {
    var serial = e.currentTarget.dataset.serial;
    this.core.toggleSelect(serial);
    this.refreshCards();
  },

  /* ══════════ 开始 / 暂停 ══════════ */
  onStart: function () {
    var res = this.core.start(Date.now());
    if (!res.ok) {
      if (!res.silent) this.showAlert(res.msg);
      return;
    }
    this.startTicker();
    this.setData({ isRunning: true });
  },

  onPause: function () {
    if (!this.core.pause()) return;
    this.stopTicker();
    this.clearFast();
    this.setData({ isRunning: false });
  },

  /* ══════════ 快退 / 快进（原版长按 200ms 重复） ══════════ */
  onRewindStart: function () {
    this.startFast(1);
  },

  onForwardStart: function () {
    this.startFast(-1);
  },

  onFastEnd: function () {
    this.clearFast();
  },

  startFast: function (direction) {
    if (!this.core.isRunning) return;
    var self = this;
    this.clearFast();
    this.core.adjustTime(direction, Date.now());
    this.refreshClocks();
    this.fastTimer = setInterval(function () {
      self.core.adjustTime(direction, Date.now());
      self.refreshClocks();
    }, FAST_MS);
  },

  clearFast: function () {
    if (this.fastTimer) {
      clearInterval(this.fastTimer);
      this.fastTimer = null;
    }
  },

  /* ══════════ 得分 / 失分 ══════════ */
  onAddScore: function () {
    this.record('得分');
  },

  onReduceScore: function () {
    this.record('失分');
  },

  record: function (type) {
    var res = this.core.addGoalRecord(type, Date.now());
    if (!res.ok) {
      if (!res.silent) this.showAlert(res.msg);
      return;
    }
    this.setData({ goals: this.core.goals.slice() });
    this.showTip(res.tip);
  },

  /* ══════════ 全换 ══════════ */
  onChangeAll: function () {
    this.core.changeAll();
    this.refreshCards();
  },

  /* ══════════ 批量编辑 ══════════ */
  onOpenBatch: function () {
    var rows = this.core.list.map(function (p) {
      return { serial: p.serial, number: p.number, role: p.role };
    });
    this.setData({ batchRows: rows, batchVisible: true });
  },

  onBatchNumber: function (e) {
    var i = e.currentTarget.dataset.index;
    this.setData(this.pair('batchRows[' + i + '].number', e.detail.value));
  },

  onBatchRole: function (e) {
    var i = e.currentTarget.dataset.index;
    this.setData(this.pair('batchRows[' + i + '].role', e.detail.value));
  },

  onBatchSubmit: function () {
    this.core.applyBatch(this.data.batchRows);
    this.setData({ batchVisible: false });
    this.refreshCards();
  },

  onCloseBatch: function () {
    this.setData({ batchVisible: false });
  },

  /* ══════════ 单个球员编辑（原版卡片 ✏ → scoreModal） ══════════ */
  onOpenPlayerEdit: function (e) {
    var serial = e.currentTarget.dataset.serial;
    var p = this.core.getPlayer(serial);
    if (!p) return;
    this.setData({
      scoreVisible: true,
      scoreTitle: '编辑球员信息',
      editSerial: serial,
      editNumber: p.number,
      editRole: p.role
    });
  },

  onEditNumber: function (e) {
    this.setData({ editNumber: e.detail.value });
  },

  onEditRole: function (e) {
    this.setData({ editRole: e.detail.value });
  },

  onScoreSubmit: function () {
    this.core.applyEdit(this.data.editSerial, this.data.editNumber, this.data.editRole);
    this.setData({ scoreVisible: false });
    this.refreshCards();
  },

  onCloseScore: function () {
    this.setData({ scoreVisible: false });
  },

  /* ══════════ 查看（原版 endButton：出表 + 复制） ══════════ */
  onEnd: function () {
    var results = this.core.getResults();
    this.setData({ results: results, showResults: true });
    var text = this.core.buildCopyText();
    if (text) {
      wx.setClipboardData({ data: text, fail: function () {} });
    }
  },

  /* ══════════ 重置 ══════════ */
  onReset: function () {
    var self = this;
    wx.showModal({
      title: '提示',
      content: '确认重置之后，所有记录都将清空，请谨慎操作！',
      success: function (res) {
        if (!res.confirm) return;
        self.stopTicker();
        self.clearFast();
        if (self.endTimer) { clearTimeout(self.endTimer); self.endTimer = null; }
        self.core.reset();
        self.setData({ results: [], showResults: false });
        self.refreshAll();
      }
    });
  },

  /* ══════════ 导出 CSV（替代原版 xlsx 导出） ══════════ */
  onExport: function () {
    var results = this.core.getResults();
    if (results.length === 0) {
      this.showAlert('暂无可导出的数据');
      return;
    }
    var rows = [['号码', '位置', '经过时长 (分:秒)']];
    results.forEach(function (r) {
      rows.push([r.number, r.role, r.periodFormat]);
    });

    var suffix = toiCore.convertTimeFormat(new Date().toISOString(), 'YYYYMMDDHHmmss');
    var fileName = '出场记录' + suffix + '.csv';

    var self = this;
    wx.showLoading({ title: '生成中', mask: true });
    csv.exportCsv({ fileName: fileName, rows: rows })
      .then(function (res) {
        wx.hideLoading();
        if (res.way === 'clipboard') {
          self.showAlert('当前环境不支持文件转发，数据已复制到剪贴板，可粘贴到表格软件中保存。');
        } else {
          self.showTip('导出成功');
        }
      })
      .catch(function () {
        wx.hideLoading();
        self.showAlert('导出失败，请重试');
      });
  },

  /* ══════════ 时间轴 ══════════ */
  startTicker: function () {
    var self = this;
    this.stopTicker();
    this.ticker = setInterval(function () {
      var res = self.core.tick(Date.now());
      if (res.changed) self.refreshClocks();
      if (res.ended) self.onGameEnd();
    }, TICK_MS);
  },

  stopTicker: function () {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  },

  /** 原版：globalTimer 变为 00:00 后 1.5s 弹「比赛结束」并自动查看 */
  onGameEnd: function () {
    var self = this;
    this.stopTicker();
    this.clearFast();
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(function () {
      self.endTimer = null;
      wx.showModal({
        title: '提示',
        content: '比赛结束',
        showCancel: false,
        complete: function () { self.onEnd(); }
      });
    }, END_DELAY);
  },

  /* ══════════ 渲染 ══════════ */
  refreshAll: function () {
    var core = this.core;
    this.setData({
      cards: this.buildCards(),
      globalText: core.clockText(core.globalRemaining),
      isRunning: core.isRunning
    });
  },

  refreshCards: function () {
    this.setData({ cards: this.buildCards() });
  },

  /** 只下发变化的时钟字段，降低 setData 开销 */
  refreshClocks: function () {
    var core = this.core;
    var cards = this.data.cards;
    var patch = {};
    var g = core.clockText(core.globalRemaining);
    if (g !== this.data.globalText) patch.globalText = g;
    core.list.forEach(function (p, i) {
      if (!cards[i]) return;
      var c = core.clockText(p.remaining);
      if (cards[i].clock !== c) patch['cards[' + i + '].clock'] = c;
    });
    if (Object.keys(patch).length > 0) this.setData(patch);
  },

  buildCards: function () {
    var core = this.core;
    return core.list.map(function (p) {
      return {
        serial: p.serial,
        number: p.number,
        role: p.role,
        clock: core.clockText(p.remaining),
        selected: p.selected,
        score: p.score
      };
    });
  },

  /* ══════════ 小工具 ══════════ */
  pair: function (key, value) {
    var o = {};
    o[key] = value;
    return o;
  },

  showAlert: function (content) {
    wx.showModal({ title: '提示', content: content, showCancel: false });
  },

  showTip: function (text) {
    var self = this;
    if (this.tipTimer) clearTimeout(this.tipTimer);
    this.setData({ tipText: text, tipShow: true });
    this.tipTimer = setTimeout(function () {
      self.tipTimer = null;
      self.setData({ tipShow: false });
    }, TIP_MS);
  }
});
