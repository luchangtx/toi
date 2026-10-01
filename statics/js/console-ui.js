/* =============================================================
   TOI 冰球比赛指挥台 · 界面交互层
   -------------------------------------------------------------
   本文件只做“显示层”增强，不改动任何比赛业务逻辑：
     · 位置为 G（守门员）的队员 → 卡片/表格行金色高亮
     · 顶部计分牌：从进球记录中解析比分，标记本方
     · 比赛信息：本方 / 人数 / 时长 / 在场人数
     · 运行状态：待开始 / 进行中 / 已暂停
     · 全局倒计时最后 1 分钟与终场提醒态
   所有数据均来自原有脚本已经渲染好的 DOM，不新增业务规则。
   ============================================================= */
(function () {
    'use strict';

    var GOALIE = 'G';

    function $(id) {
        return document.getElementById(id);
    }

    /* ---------------------------------------------------------
       1. 守门员（位置 = G）颜色区分
       --------------------------------------------------------- */

    // 卡片：G → .is-goalie
    function stripRole(card) {
        var roleEl = card.querySelector('.role');
        return roleEl ? roleEl.textContent.trim().toUpperCase() : '';
    }

    function paintGoalies() {
        var cards = document.querySelectorAll('.container .card');
        for (var i = 0; i < cards.length; i++) {
            var isGoalie = stripRole(cards[i]) === GOALIE;
            cards[i].classList.toggle('is-goalie', isGoalie);
        }
    }

    function paintResultRows(table) {
        if (!table) return;
        var rows = table.querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
            var roleCell = rows[i].children[1];
            var isGoalie = roleCell &&
                roleCell.textContent.trim().toUpperCase() === GOALIE;
            rows[i].classList.toggle('is-goalie', isGoalie);
        }
    }

    function paintBatchRows() {
        var table = $('batchTable');
        if (!table) return;
        var rows = table.querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
            var inputs = rows[i].getElementsByTagName('input');
            var isGoalie = inputs.length > 1 &&
                inputs[1].value.trim().toUpperCase() === GOALIE;
            rows[i].classList.toggle('is-goalie', isGoalie);
        }
    }

    /* ---------------------------------------------------------
       2. 顶部计分牌 / 比赛信息
       --------------------------------------------------------- */

    var homeBox = $('homeTeamBox');
    var awayBox = $('awayTeamBox');
    var homeScore = $('homeScore');
    var awayScore = $('awayScore');
    var metaTeam = $('metaTeam');
    var metaPlayers = $('metaPlayers');
    var metaMinutes = $('metaMinutes');
    var metaOnIce = $('metaOnIce');

    function syncScoreboard() {
        var latest = document.querySelector('#goals-list .goal-entry');
        var home = 0;
        var away = 0;
        if (latest) {
            var matched = latest.textContent.match(/比分[:：]\s*(\d+)\s*[:：]\s*(\d+)/);
            if (matched) {
                home = parseInt(matched[1], 10) || 0;
                away = parseInt(matched[2], 10) || 0;
            }
        }
        if (homeScore) homeScore.textContent = String(home);
        if (awayScore) awayScore.textContent = String(away);
    }

    function syncOnIce() {
        var count = document.querySelectorAll('.container .card.selected').length;
        if (metaOnIce) metaOnIce.textContent = String(count);
    }

    function syncTeamSide() {
        var select = $('input3');
        var isHome = !select || select.value === '1';
        if (homeBox) homeBox.classList.toggle('is-us', isHome);
        if (awayBox) awayBox.classList.toggle('is-us', !isHome);
        if (metaTeam) metaTeam.textContent = isHome ? '主队' : '客队';
    }

    /* ---------------------------------------------------------
       3. 运行状态与倒计时提醒
       --------------------------------------------------------- */

    var startButton = $('startButton');
    var runState = $('runState');
    var globalTimer = $('globalTimer');

    function syncRunState() {
        if (!runState || !startButton) return;
        var running = startButton.classList.contains('disabled');
        var hasOnIce = document.querySelectorAll('.container .card.selected').length > 0;
        runState.textContent = running ? '进行中' : (hasOnIce ? '已暂停' : '待开始');
        runState.classList.toggle('is-running', running);
    }

    function syncClockState() {
        if (!globalTimer) return;
        var parts = globalTimer.textContent.split(':');
        var minutes = parseInt(parts[0], 10);
        var seconds = parseInt(parts[1], 10);
        if (isNaN(minutes) || isNaN(seconds)) return;
        // 比赛设置提交前 #globalTimer 还是占位的 00:00，此时不应显示终场态
        var started = document.querySelectorAll('.container .card').length > 0;
        var total = minutes * 60 + seconds;
        globalTimer.classList.toggle('is-urgent', started && total > 0 && total <= 60);
        globalTimer.classList.toggle('is-final', started && total <= 0);
    }

    /* ---------------------------------------------------------
       4. 变更监听
       --------------------------------------------------------- */

    // 卡片增删、位置修改（含 G）→ 重绘守门员高亮
    var container = document.querySelector('.container');
    if (container && window.MutationObserver) {
        var cardObserver = new MutationObserver(function (records) {
            var needPaint = false;
            for (var i = 0; i < records.length && !needPaint; i++) {
                var record = records[i];
                if (record.type === 'childList' || record.type === 'characterData') {
                    var node = record.target;
                    var el = node.nodeType === 1 ? node : node.parentElement;
                    if (!el) continue;
                    if (el.classList && (el.classList.contains('role') || el.classList.contains('container'))) {
                        needPaint = true;
                    } else if (el.closest && el.closest('.role')) {
                        needPaint = true;
                    }
                }
                if (record.type === 'attributes') {
                    needPaint = true;
                }
            }
            if (needPaint) {
                paintGoalies();
                syncOnIce();
                syncRunState();
            }
        });
        cardObserver.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    // 出场时间表 → 守门员行高亮
    var resultsTable = $('resultsTable');
    if (resultsTable && window.MutationObserver) {
        new MutationObserver(function () {
            paintResultRows(resultsTable);
        }).observe(resultsTable, {childList: true, subtree: true});
    }

    // 批量编辑弹窗 → 输入 G 即时高亮
    var batchTable = $('batchTable');
    if (batchTable) {
        new MutationObserver(paintBatchRows).observe(batchTable, {childList: true, subtree: true});
        batchTable.addEventListener('input', paintBatchRows);
    }

    // 进球记录 → 计分牌
    var goalsList = $('goals-list');
    if (goalsList && window.MutationObserver) {
        new MutationObserver(syncScoreboard).observe(goalsList, {childList: true, subtree: true});
    }

    // 开始/暂停按钮 class 变化 → 运行状态
    if (startButton && window.MutationObserver) {
        new MutationObserver(syncRunState).observe(startButton, {
            attributes: true,
            attributeFilter: ['class']
        });
    }
    if (globalTimer && window.MutationObserver) {
        new MutationObserver(syncClockState).observe(globalTimer, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    // 提交比赛设置 → 同步队伍/人数/时长并首次绘制守门员高亮
    var submitButton = $('submitButton');
    if (submitButton) {
        submitButton.addEventListener('click', function () {
            var players = parseInt($('input1').value, 10);
            var minutes = parseInt($('input2').value, 10);
            if (!(players > 0 && players <= 30) || !(minutes > 0 && minutes <= 20)) return;
            if (metaPlayers) metaPlayers.textContent = String(players);
            if (metaMinutes) metaMinutes.textContent = minutes + ' 分';
            syncTeamSide();
            paintGoalies();
            syncOnIce();
            syncRunState();
            syncClockState();
        });
    }

    /* ---------------------------------------------------------
       6. 明亮 / 深色模式切换（纯显示层，不影响比赛逻辑）
       --------------------------------------------------------- */
    var THEME_KEY = 'toi-theme';
    var themeToggle = $('themeToggle');
    var themeColorMeta = document.querySelector('meta[name="theme-color"]');

    function applyTheme(theme, persist) {
        var isLight = theme === 'light';
        document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
        if (themeColorMeta) themeColorMeta.setAttribute('content', isLight ? '#eef5ff' : '#050b18');
        if (themeToggle) {
            themeToggle.title = isLight ? '切换到深色模式' : '切换到明亮模式';
            themeToggle.setAttribute('aria-label', themeToggle.title);
        }
        if (persist) {
            try {
                localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
            } catch (e) {
                /* 隐私模式下忽略 */
            }
        }
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', function () {
            var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            applyTheme(next, true);
            syncClockState();
        });
    }

    /* ---------------------------------------------------------
       7. 初始状态
       --------------------------------------------------------- */
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark', false);
    paintGoalies();
    syncTeamSide();
    syncOnIce();
    syncRunState();
    syncClockState();
    syncScoreboard();
})();
