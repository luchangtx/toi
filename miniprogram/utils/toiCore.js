/**
 * 冰球比赛计时与统计核心逻辑
 * 逐条移植自 statics/js/timer_plus.js，不含任何 DOM / wx API，可独立单测。
 *
 * 与原版的唯一实现差异：原版为全局计时器与每张卡片各自 setInterval 累加，
 * 这里改为单一时间轴 + Date.now() 时间戳差值驱动（tick），避免小程序后台节流走时不准。
 */

// ── 原版常量（逐字提取） ──
var DEFAULT_PLAYERS = 22;        // timer_plus.js: var players = 22;
var DEFAULT_INIT_MINUTES = 12;   // timer_plus.js: var initMinutes = 12;
var MAX_PLAYERS = 30;            // if (players > 30 || players <= 0)
var MAX_INIT_MINUTES = 20;       // if (initMinutes > 20 || initMinutes <= 0)
// 设置弹窗表单初值取自 711.html：input1 = 15、input2 = 12、input3 = 1（主队）
var FORM_DEFAULT_PLAYERS = 15;
var FORM_DEFAULT_MINUTES = 12;

function pad2(n) {
  n = String(n);
  return n.length >= 2 ? n : '0' + n;
}

/** 倒计时展示：初始/重置态沿用原版未补零写法（initMinutes + ':00'），走时后补零 */
function formatClock(remaining, initTotal, initMinutes) {
  if (remaining === initTotal) return initMinutes + ':00';
  var m = Math.floor(remaining / 60);
  var s = remaining % 60;
  return pad2(m) + ':' + pad2(s);
}

/** 原版 formatElapsedTime：分钟不足两位补零 */
function formatElapsedTime(seconds) {
  var minutes = Math.floor(seconds / 60);
  var remainingSeconds = seconds % 60;
  var format = minutes < 10 ? '0' + minutes : minutes;
  return format + ':' + pad2(remainingSeconds);
}

/** 原版 convertTimeFormat */
function convertTimeFormat(isoTimeStr, newFormat) {
  var date = new Date(isoTimeStr);
  var year = date.getFullYear();
  var month = pad2(date.getMonth() + 1);
  var day = pad2(date.getDate());
  var hours = pad2(date.getHours());
  var minutes = pad2(date.getMinutes());
  var seconds = pad2(date.getSeconds());
  return newFormat
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/** 原版 setTitle：'1' → 主 队，否则 客 队（水印文字） */
function setTitle(selectedOption) {
  return String(selectedOption) === '1' ? '主 队' : '客 队';
}

/** 原版 sortTimes：门将（G）置顶，其余按号码数值升序 */
function sortTimes(list) {
  return list.slice().sort(function (v1, v2) {
    var role1 = v1.role;
    var role2 = v2.role;
    if (role1 == 'G' && role2 != 'G') return -1;
    if (role2 == 'G' && role1 != 'G') return 1;
    return v1.number - v2.number;
  });
}

/** 原版 Player 对象 */
function createPlayer(serial, number, role, period, score) {
  return {
    serial: String(serial),
    number: String(number),
    role: role,
    period: period,
    score: score
  };
}

function createCore() {
  return {
    // ── 配置 ──
    players: DEFAULT_PLAYERS,
    initMinutes: DEFAULT_INIT_MINUTES,
    initTotal: DEFAULT_INIT_MINUTES * 60,
    teamOption: '1',
    watermark: '',

    // ── 运行态 ──
    list: [],            // 每项 = Player + { remaining, selected }
    globalRemaining: 0,
    isRunning: false,
    total: 0,            // 原版 var total：重置一次 +1，用于跨节累计进球时间
    scoreArray: [],
    goals: [],           // 进球记录（最新在前，等价原版 goalsList.prepend）
    anchor: 0,           // 时间轴锚点（Date.now()）
    addTimestamp: 0,     // 原版 addButton 连点保护
    reduceTimestamp: 0,  // 原版 reduceButton 连点保护
    copyBuffer: '',

    /** 校验设置弹窗输入，返回错误文案（null 表示通过） */
    validateSetup: function (players, initMinutes) {
      if (isNaN(players) || players > MAX_PLAYERS || players <= 0) {
        return '请设置正确的队员人数';
      }
      if (isNaN(initMinutes) || initMinutes > MAX_INIT_MINUTES || initMinutes <= 0) {
        return '请设置正确的比赛时长';
      }
      return null;
    },

    /** 原版 init(players, initMinutes) */
    init: function (players, initMinutes, teamOption) {
      this.players = players;
      this.initMinutes = initMinutes;
      this.initTotal = initMinutes * 60;
      this.teamOption = String(teamOption);
      this.watermark = setTitle(teamOption);

      this.list = [];
      for (var i = 1; i <= players; i++) {
        var p = createPlayer(i, i, '', 0, '');
        p.remaining = this.initTotal;
        p.selected = false;
        this.list.push(p);
      }
      this.globalRemaining = this.initTotal;
      this.isRunning = false;
      this.total = 0;
      this.scoreArray = [];
      this.goals = [];
      this.addTimestamp = 0;
      this.reduceTimestamp = 0;
      this.copyBuffer = '';
    },

    getPlayer: function (serial) {
      for (var i = 0; i < this.list.length; i++) {
        if (this.list[i].serial === String(serial)) return this.list[i];
      }
      return null;
    },

    selectedPlayers: function () {
      return this.list.filter(function (p) { return p.selected; });
    },

    /** 卡片点击：上场 / 下场 */
    toggleSelect: function (serial) {
      var p = this.getPlayer(serial);
      if (!p) return;
      p.selected = !p.selected;
    },

    /** 原版 changeButton「全换」：非门将全部下场 */
    changeAll: function () {
      this.list.forEach(function (p) {
        if (p.selected && p.role !== 'G') p.selected = false;
      });
    },

    /** 原版 startButton */
    start: function (now) {
      if (this.selectedPlayers().length === 0) {
        return { ok: false, msg: '请选择上场的运动员' };
      }
      var numbers = this.list.map(function (p) { return p.number; });
      var countMap = {};
      var unique = 0;
      numbers.forEach(function (n) {
        if (countMap[n] === undefined) { countMap[n] = 0; unique++; }
        countMap[n]++;
      });
      if (unique !== numbers.length) {
        var repeatKeys = Object.keys(countMap).filter(function (k) { return countMap[k] > 1; });
        return { ok: false, msg: '存在重复的号码，请确认：\n' + repeatKeys.join('、') };
      }
      if (this.isRunning) return { ok: false, silent: true };
      this.isRunning = true;
      this.anchor = now;
      return { ok: true };
    },

    /** 原版 pauseButton */
    pause: function () {
      if (!this.isRunning) return false;
      this.isRunning = false;
      return true;
    },

    /**
     * 时间轴推进。返回 { changed, ended }
     * ended：本次推进使全局倒计时归零（原版 MutationObserver 检测 '00:00'）
     */
    tick: function (now) {
      if (!this.isRunning) return { changed: false, ended: false };
      var elapsed = Math.floor((now - this.anchor) / 1000);
      if (elapsed <= 0) return { changed: false, ended: false };
      this.anchor += elapsed * 1000;

      // 全局归零后，场上球员计时同步停止（原版：player interval 检测 globalText == '00:00'）
      var delta = Math.min(elapsed, this.globalRemaining);
      if (delta <= 0) return { changed: false, ended: false };

      this.globalRemaining -= delta;
      var initTotal = this.initTotal;
      this.list.forEach(function (p) {
        if (!p.selected) return;
        p.remaining = Math.max(0, p.remaining - delta);
        p.period = initTotal - p.remaining;
      });
      return { changed: true, ended: this.globalRemaining === 0 };
    },

    /**
     * 原版 adjustTime(direction)
     * direction = +1 快退（增加倒计时），-1 快进（减少倒计时）
     */
    adjustTime: function (direction, now) {
      if (!this.isRunning) return false;
      var initTotal = this.initTotal;

      var totalSeconds = this.globalRemaining + direction;
      if (totalSeconds < 0) totalSeconds = 0;
      if (totalSeconds > initTotal) totalSeconds = initTotal;
      this.globalRemaining = totalSeconds;

      this.list.forEach(function (p) {
        if (!p.selected) return;
        var cardTotalSeconds = p.remaining + direction;
        if (cardTotalSeconds < 0) cardTotalSeconds = 0;
        if (cardTotalSeconds > initTotal) cardTotalSeconds = initTotal;
        p.remaining = cardTotalSeconds;
        p.period = initTotal - cardTotalSeconds;
      });

      // 原版此处 pauseAllCountdowns() 后重建 interval，等价于重置时间轴锚点
      this.anchor = now;
      return true;
    },

    /** 原版 resetSecondConfirm 确认后的主体 */
    reset: function () {
      if (this.isRunning) this.isRunning = false;
      var initTotal = this.initTotal;
      this.list.forEach(function (p) {
        p.period = 0;
        p.remaining = initTotal;
        p.selected = false;
        p.score = '';
      });
      this.total++;
      this.globalRemaining = initTotal;
      this.copyBuffer = '';
    },

    /** 原版 scoreSubmitButton「编辑球员信息」分支 */
    applyEdit: function (serial, number, role) {
      var p = this.getPlayer(serial);
      if (!p) return;
      p.number = String(number);
      p.role = String(role).toUpperCase();
    },

    /** 原版 batchSubmitButton 批量编辑 */
    applyBatch: function (rows) {
      var self = this;
      rows.forEach(function (row) {
        var p = self.getPlayer(row.serial);
        if (!p) return;
        p.number = String(row.number);
        p.role = String(row.role).toUpperCase();
      });
    },

    /**
     * 原版 addGoalRecord(type, players)
     * type: '得分' | '失分'
     */
    addGoalRecord: function (type, now) {
      // 原版连点保护（addTimestamp / reduceTimestamp）
      if (type === '得分') {
        if (this.addTimestamp === 0) {
          this.addTimestamp = now;
        } else if ((now - this.addTimestamp) / 1000 <= 1) {
          return { ok: false, silent: true };
        }
      } else {
        if (this.reduceTimestamp === 0) {
          this.reduceTimestamp = now;
        } else if ((now - this.reduceTimestamp) / 1000 <= 1) {
          return { ok: false, silent: true };
        }
      }

      var selected = this.selectedPlayers();
      if (selected.length === 0) {
        return { ok: false, msg: '没有在场的队员' };
      }
      var onPlayer = selected.map(function (p) { return p.number; });

      var itemSeconds = this.initTotal - this.globalRemaining;
      var a = this.initTotal * this.total + itemSeconds;
      var zTime = formatElapsedTime(a);

      var isHomeTeam = this.teamOption == 1;
      var teamName = isHomeTeam ? '主队' : '客队';

      var homeScore = 0;
      var awayScore = 0;
      if (this.scoreArray.length > 0) {
        var lastScore = this.scoreArray[this.scoreArray.length - 1][1].split(':');
        homeScore = Number(lastScore[0]);
        awayScore = Number(lastScore[1]);
      }
      if (type === '得分') {
        if (isHomeTeam) homeScore += 1; else awayScore += 1;
      } else if (type === '失分') {
        if (isHomeTeam) awayScore += 1; else homeScore += 1;
      }

      var scoreText = homeScore + ':' + awayScore;
      this.scoreArray.push([a, scoreText, onPlayer.join('、')]);

      var entry = {
        id: this.scoreArray.length,
        title: teamName + type,
        time: zTime,
        players: onPlayer.join(', '),
        score: scoreText
      };
      this.goals.unshift(entry); // 原版 goalsList.prepend
      return { ok: true, entry: entry, tip: type + '记录成功' };
    },

    /** 原版 endButton：生成结果表数据 */
    getResults: function () {
      return sortTimes(this.list).map(function (p) {
        return {
          serial: p.serial,
          number: p.number,
          role: p.role,
          periodFormat: formatElapsedTime(p.period)
        };
      });
    },

    /** 原版 copyToClipboard：时长按行拼接并去掉冒号 */
    buildCopyText: function () {
      var t = this.getResults().map(function (r) { return r.periodFormat; }).join('\n');
      t = t.split(':').join('');
      this.copyBuffer = t;
      return t;
    },

    /** 卡片 / 全局倒计时展示文本 */
    clockText: function (remaining) {
      return formatClock(remaining, this.initTotal, this.initMinutes);
    }
  };
}

module.exports = {
  createCore: createCore,
  createPlayer: createPlayer,
  formatElapsedTime: formatElapsedTime,
  formatClock: formatClock,
  convertTimeFormat: convertTimeFormat,
  setTitle: setTitle,
  sortTimes: sortTimes,
  DEFAULT_PLAYERS: DEFAULT_PLAYERS,
  DEFAULT_INIT_MINUTES: DEFAULT_INIT_MINUTES,
  MAX_PLAYERS: MAX_PLAYERS,
  MAX_INIT_MINUTES: MAX_INIT_MINUTES,
  FORM_DEFAULT_PLAYERS: FORM_DEFAULT_PLAYERS,
  FORM_DEFAULT_MINUTES: FORM_DEFAULT_MINUTES
};
