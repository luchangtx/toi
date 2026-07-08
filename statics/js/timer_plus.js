function setWatermark(text) {
            // 先移除已有的水印
            const existingWatermark = document.querySelector('.watermark');
            if (existingWatermark) {
                existingWatermark.remove();
            }
            
            const watermark = document.createElement('div');
            watermark.textContent = text;
            watermark.classList.add('watermark');
            document.body.appendChild(watermark);
        }

        // 获取弹出框
        var modal = document.getElementById("myModal");
        var players = 22;
        var initMinutes = 12;
        document.getElementById("submitButton").addEventListener("click", function () {
            const playersDom = document.getElementById("input1")
            const initMinutesDom = document.getElementById("input2")
            const titleDom = document.getElementById("input3")
            setWatermark(setTitle(titleDom.value));

            players = parseInt(playersDom.value);
            initMinutes = parseInt(initMinutesDom.value);
            if (players > 30 || players <= 0) {
                alert("请设置正确的队员人数");
                return;
            }
            if (initMinutes > 20 || initMinutes <= 0) {
                alert("请设置正确的比赛时长");
                return;
            }
            init(players, initMinutes)
            commCloseModal(modal);
        });
        modal.addEventListener('keydown', function (event) {
            if (event.keyCode === 13) {
                document.getElementById("submitButton").click();
            }
        });

        function setTitle(selectedOption) {
            return selectedOption === '1' ? "主 队" : "客 队";
        }
        commShowModal(modal);
        document.getElementById("input1").focus();

        //运动员对象
        const Player = {
            init: function (serial, number, role, period, score) {
                this.number = number;
                this.serial = serial;
                this.role = role;
                this.period = period;
                this.score = score;
                return this;
            }
        };

        // 显示弹出框
        function commShowModal(modalDom) {
            modalDom.style.display = "block";
        }

        function commCloseModal(modalDom) {
            modalDom.style.display = "none";
            if (modalDom.getAttribute('id') == 'scoreModal') {
                scoreContext.innerHTML = '';
            }
        }

        function init(players, initMinutes) {
            const globalTimer = document.getElementById('globalTimer');
            globalTimer.textContent = initMinutes + ':00';

            const container = document.querySelector('.container');
            const startButton = document.getElementById('startButton');
            const pauseButton = document.getElementById('pauseButton');
            const changeButton = document.getElementById('changeButton');
            const endButton = document.getElementById('endButton');
            const batchButton = document.getElementById('batchButton');
            const resetButton = document.getElementById('resetButton');
            const resultsTable = document.getElementById('resultsTable');
            // const resultsTable2 = document.getElementById('resultsTable2');
            const batchTable = document.getElementById('batchTable');
            const exportButton = document.getElementById('exportButton');
            const addButton = document.getElementById('addButton');
            const reduceButton = document.getElementById('reduceButton');
            const scoreModal = document.getElementById('scoreModal');
            const scoreTitle = document.getElementById('scoreTitle');
            const scoreContext = document.getElementById('scoreContext');
            const scoreSubmitButton = document.getElementById('scoreSubmitButton');
            const goalsDisplay = document.getElementById('goals-display');
            const goalsList = document.getElementById('goals-list');

            const rewindButton = document.getElementById('rewindButton');
            const forwardButton = document.getElementById('forwardButton');

            let numbers = Array.from({length: players}, (_, i) => i + 1 + '');
            let countdownIntervals = new Map();
            let countdownTimes = new Map();
            let scoreArray = [];
            let isRunning = false;
            let keyHoldInterval = null;
            let fastForwardInterval = null;
            let fastRewindInterval = null;

            var batchModal = document.getElementById("batchModal");
            var span = document.getElementsByClassName("close");

            document.getElementById("batchModal").addEventListener('keydown', function (event) {
                if (event.keyCode === 13) {
                    document.getElementById("batchSubmitButton").click();
                }
            });

            let lastClickTime = 0;
            document.addEventListener('keydown', function (event) {
                // 空格键切换开始/暂停
                if (event.keyCode === 32) {
                    event.preventDefault();
                    const currentClickTime = new Date().getTime();
                    const delta = currentClickTime - lastClickTime;
                    if (delta < 500) {
                        if (isRunning) {
                            pauseButton.click();
                        } else {
                            startButton.click();
                        }
                    }
                    lastClickTime = currentClickTime;
                }
                
                // 左右方向键调整时间
                if (event.keyCode === 37) { // 左方向键 - 快退
                    event.preventDefault();
                    if (isRunning) {
                        clearInterval(keyHoldInterval);
                        adjustTime(1); // 快退：增加倒计时时间
                        keyHoldInterval = setInterval(() => {
                            adjustTime(1);
                        }, 200);
                    }
                } else if (event.keyCode === 39) { // 右方向键 - 快进
                    event.preventDefault();
                    if (isRunning) {
                        clearInterval(keyHoldInterval);
                        adjustTime(-1); // 快进：减少倒计时时间
                        keyHoldInterval = setInterval(() => {
                            adjustTime(-1);
                        }, 200);
                    }
                } 
                // 加分减分快捷键
                else if (event.keyCode === 187 || event.keyCode === 107) { // + 键
                    event.preventDefault();
                    addButton.click();
                } else if (event.keyCode === 189 || event.keyCode === 109) { // - 键
                    event.preventDefault();
                    reduceButton.click();
                }
            });

            document.addEventListener('keyup', function(event) {
                if (event.keyCode === 37 || event.keyCode === 39) {
                    clearInterval(keyHoldInterval);
                }
            });

            // 快退按钮功能
            rewindButton.addEventListener('mousedown', function() {
                if (isRunning) {
                    adjustTime(1); // 快退：增加倒计时时间
                    fastRewindInterval = setInterval(() => {
                        adjustTime(1);
                    }, 200);
                }
            });

            rewindButton.addEventListener('mouseup', function() {
                clearInterval(fastRewindInterval);
            });

            rewindButton.addEventListener('mouseleave', function() {
                clearInterval(fastRewindInterval);
            });

            // 快进按钮功能
            forwardButton.addEventListener('mousedown', function() {
                if (isRunning) {
                    adjustTime(-1); // 快进：减少倒计时时间
                    fastForwardInterval = setInterval(() => {
                        adjustTime(-1);
                    }, 200);
                }
            });

            forwardButton.addEventListener('mouseup', function() {
                clearInterval(fastForwardInterval);
            });

            forwardButton.addEventListener('mouseleave', function() {
                clearInterval(fastForwardInterval);
            });

            function adjustTime(direction) {
                if (!isRunning) return;
                
                // 暂停当前所有计时器
                pauseAllCountdowns();
                
                // 调整全局时间
                const [globalMinutes, globalSeconds] = globalTimer.textContent.split(':').map(Number);
                let totalSeconds = globalMinutes * 60 + globalSeconds + direction;
                
                // 确保时间在有效范围内
                if (totalSeconds < 0) totalSeconds = 0;
                if (totalSeconds > initMinutes * 60) totalSeconds = initMinutes * 60;
                
                const newMinutes = Math.floor(totalSeconds / 60);
                const newSeconds = totalSeconds % 60;
                globalTimer.textContent = `${String(newMinutes).padStart(2, '0')}:${String(newSeconds).padStart(2, '0')}`;
                
                // 调整选中卡片的时间
                const selectedCards = container.querySelectorAll('.selected');
                selectedCards.forEach(card => {
                    const timer = card.querySelector('.timer');
                    const [cardMinutes, cardSeconds] = timer.textContent.split(':').map(Number);
                    let cardTotalSeconds = cardMinutes * 60 + cardSeconds + direction;
                    
                    // 确保时间在有效范围内
                    if (cardTotalSeconds < 0) cardTotalSeconds = 0;
                    if (cardTotalSeconds > initMinutes * 60) cardTotalSeconds = initMinutes * 60;
                    
                    const newCardMinutes = Math.floor(cardTotalSeconds / 60);
                    const newCardSeconds = cardTotalSeconds % 60;
                    timer.textContent = `${String(newCardMinutes).padStart(2, '0')}:${String(newCardSeconds).padStart(2, '0')}`;
                    
                    // 更新球员在场时长
                    const serial = card.querySelector('.number').getAttribute('serial');
                    const player = countdownTimes.get(serial);
                    if (player) {
                        player.period = initMinutes * 60 - cardTotalSeconds;
                        countdownTimes.set(serial, player);
                    }
                });
                
                // 重新启动所有计时器，基于新的时间点
                const intervalGlobal = createTimer(globalTimer, null);
                countdownIntervals.set('global', intervalGlobal);
                container.querySelectorAll('.selected').forEach(card => {
                    const serial = card.querySelector('.number').getAttribute('serial');
                    const timer = card.querySelector('.timer');
                    const numberDiv = card.querySelector('.number');
                    const number = numberDiv.textContent;
                    const role = card.querySelector('.role').textContent;
                    
                    const john = Object.create(Player).init(serial, number, role, countdownTimes.get(serial).period, '');
                    const interval = createTimer(timer, john);
                    countdownIntervals.set(serial, interval);
                });
            }

            for (var i = 0; i < span.length; i++) {
                span[i].onclick = function () {
                    commCloseModal(this.parentNode.parentNode)
                }
            }

            document.getElementById("batchSubmitButton").addEventListener("click", function () {
                const trs = batchTable.querySelector('tbody').getElementsByTagName('tr');
                for (var i = 0; i < trs.length; i++) {
                    const tr = trs[i];
                    const inputs = tr.getElementsByTagName('input');
                    const serial = tr.getAttribute('serial');
                    const number = inputs[0].value;
                    const role = inputs[1].value.toUpperCase();
                    const player = countdownTimes.get(serial);
                    player.number = number;
                    player.role = role;

                    const numberDiv = container.querySelector(`.number[serial='${serial}']`);
                    const roleDiv = container.querySelector(`.role[serial='${serial}']`);
                    numberDiv.textContent = number;
                    roleDiv.textContent = role;

                    countdownTimes.set(serial, player);
                    numbers[parseInt(serial) - 1] = number;
                }
                commCloseModal(batchModal);
            });

            function createCard(number) {
                const card = document.createElement('div');
                card.className = 'card';
                const m = initMinutes + ':00';
                card.innerHTML = `
                    <div class="number" serial='${number}'>${number}</div>
                    <div class="role" serial='${number}'></div>
                    <div class="timer">${m}</div>
                    <div class="score" serial='${number}'></div>
                    <button class="edit-button">✏</button>
                `;
                card.setAttribute('serial', number);
                container.appendChild(card);
                const john = Object.create(Player).init(number, number, '', 0, '');
                countdownTimes.set(number + '', john);

                card.addEventListener('click', (event) => {
                    if (!event.target.classList.contains('edit-button')) {
                        const serial = card.querySelector('.number').getAttribute('serial');
                        if (card.classList.toggle('selected')) {
                            if (isRunning) startCountdown(card);
                        } else {
                            pauseCountdown(serial);
                        }
                    }
                });

                const editButton = card.querySelector('.edit-button');
                editButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const serial = card.querySelector('.number').getAttribute('serial');
                    const player = countdownTimes.get(serial);
                    scoreTitle.textContent = '编辑球员信息';
                    scoreContext.innerHTML = `
                        <table>
                            <tr>
                                <td>号码:</td>
                                <td><input type="number" id="editNumber" value="${player.number}"></td>
                                <td>位置:</td>
                                <td><input type="text" id="editRole" value="${player.role}"></td>
                            </tr>
                        </table>
                    `;
                    scoreContext.setAttribute('serial', serial);
                    commShowModal(scoreModal);
                });
                                const trole = card.querySelector('.role');

                    const observer = new MutationObserver(function (mutationsList, observer) {
                        for (let mutation of mutationsList) {
                            console.log(mutation.type);
                        if (mutation.type === 'characterData' || mutation.type === 'childList') {
                            // 检查文本内容是否为 "G"
                            if (trole.textContent.trim() === 'G') {
                            trole.style.backgroundColor = 'var(--warning-color)';
                            trole.style.color = 'black';
                            } else {
                            trole.style.backgroundColor = ''; // 如果不是 "G"，移除背景色
                            trole.style.color = '';
                            }
                        }
                        }
                    });

                    // 开始观察 .role 元素的文本变化
                    observer.observe(trole, {
                        characterData: true,  // 监听文本节点变化
                        childList: true,      // 监听子节点变化
                        subtree: true         // 监听所有后代节点
                    });
            }

            numbers.forEach(number => createCard(number));

            function updateButtons() {
                if (isRunning) {
                    startButton.classList.add('disabled');
                    pauseButton.classList.remove('disabled');
                    rewindButton.classList.remove('disabled');
                    forwardButton.classList.remove('disabled');
                } else {
                    startButton.classList.remove('disabled');
                    pauseButton.classList.add('disabled');
                    rewindButton.classList.add('disabled');
                    forwardButton.classList.add('disabled');
                    clearInterval(fastForwardInterval);
                    clearInterval(fastRewindInterval);
                }
            }

            function startCountdown(card) {
                const timer = card.querySelector('.timer');
                const numberDiv = card.querySelector('.number');
                const number = numberDiv.textContent;
                const serial = numberDiv.getAttribute('serial');
                const role = card.querySelector('.role').textContent;

                const john = Object.create(Player).init(serial, number, role, 0, '');
                const interval = createTimer(timer, john);
                countdownIntervals.set(serial, interval);
            }

            function createTimer(timerDiv, player) {
                let [minutes, seconds] = timerDiv.textContent.split(':').map(Number);
                const interval1 = setInterval(() => {
                    if (seconds === 0) {
                        if (minutes === 0) {
                            clearInterval(interval1);
                            return;
                        }
                        minutes--;
                        seconds = 59;
                    } else {
                        seconds--;
                    }
                    timerDiv.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    if (player != null) {
                        const itemSeconds = (initMinutes * 60 - (minutes * 60 + seconds));
                        player.period = itemSeconds;
                        countdownTimes.set(player.serial, player);

                        const globalText = globalTimer.textContent;
                        if (globalText == '00:00') {
                            clearInterval(interval1);
                            return;
                        }
                    }
                }, 1000);
                return interval1;
            }

            const observer = new MutationObserver(function (mutationsList, observer) {
                for (let mutation of mutationsList) {
                    if (mutation.type === 'childList') {
                        const globalText = globalTimer.textContent;
                        if (globalText == '00:00') {
                            setTimeout(() => {
                                alert('比赛结束');
                                endButton.click();
                            }, 1500);
                        }
                    }
                }
            });
            observer.observe(globalTimer, {attributes: false, childList: true, subtree: false});

            function pauseCountdown(serial) {
                clearInterval(countdownIntervals.get(serial));
                countdownIntervals.delete(serial);
            }

            function pauseAllCountdowns() {
                countdownIntervals.forEach((interval2, serial) => {
                    clearInterval(interval2);
                });
                countdownIntervals.clear();
            }

            function formatElapsedTime(seconds) {
                const minutes = Math.floor(seconds / 60);
                const remainingSeconds = seconds % 60;
                const format = (minutes < 10) ? '0' + minutes : minutes;
                return `${format}:${String(remainingSeconds).padStart(2, '0')}`;
            }

            function sortTimes(itemCountdownTimes) {
                return new Map([...itemCountdownTimes.entries()].sort((a, b) => {
                    const v1 = a[1];
                    const v2 = b[1];
                    const number1 = v1.number;
                    const number2 = v2.number;
                    const role1 = v1.role;
                    const role2 = v2.role;

                    if (role1 == 'G' && role2 != 'G') return -1;
                    if (role2 == 'G' && role1 != 'G') return 1;
                    return number1 - number2;
                }));
            }

            function convertTimeFormat(isoTimeStr, newFormat) {
                const date = new Date(isoTimeStr);
                const year = date.getFullYear();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                const hours = date.getHours().toString().padStart(2, '0');
                const minutes = date.getMinutes().toString().padStart(2, '0');
                const seconds = date.getSeconds().toString().padStart(2, '0');

                return newFormat
                    .replace('YYYY', year)
                    .replace('MM', month)
                    .replace('DD', day)
                    .replace('HH', hours)
                    .replace('mm', minutes)
                    .replace('ss', seconds);
            }

            function generateExcel() {
                const data = [];
                const sortedCountdownTimes = sortTimes(countdownTimes);
                sortedCountdownTimes.forEach((elapsedSeconds, serial) => {
                    const role = elapsedSeconds.role;
                    const period = elapsedSeconds.period;
                    const number = elapsedSeconds.number;
                    data.push([number, role, formatElapsedTime(period)]);
                });

                const worksheet = XLSX.utils.aoa_to_sheet([['号码', '位置', '经过时长 (分:秒)'], ...data]);
                worksheet['!cols'] = [
                    {wpx: 100},
                    {wpx: 100},
                    {wch: 50}
                ];

                const workbook = XLSX.utils.book_new();
                const suffix = convertTimeFormat(new Date().toISOString(), 'YYYYMMDDHHmmss');
                XLSX.utils.book_append_sheet(workbook, worksheet, '出场时间');
                XLSX.writeFile(workbook, '出场记录' + suffix + '.xlsx');
            }

            var total=0;

            // function addGoalRecord(type, players) {
            //     let [minutes, seconds] = globalTimer.textContent.split(':').map(Number);
            //     const itemSeconds = (initMinutes * 60 - (minutes * 60 + seconds));

            //      var a=initMinutes*60*total+itemSeconds;
            //     const zTime = formatElapsedTime(a);
                
            //     let scoreText = '';
            //     if (scoreArray.length === 0) {
            //         scoreText = type === '得分' ? '1:0' : '0:1';
            //     } else {
            //         const scoreTotal = scoreArray[scoreArray.length - 1][1];
            //         const arr = scoreTotal.split(':');
            //         let z = parseInt(arr[0]);
            //         let f = parseInt(arr[1]);
                    
            //         if (type === '得分') {
            //             z += 1;
            //         } else {
            //             f += 1;
            //         }
            //         scoreText = `${z}:${f}`;
            //     }
            //     scoreArray.push([a, scoreText, players.join('、')]);
                
            //     // 显示进球记录
            //     const goalEntry = document.createElement('div');
            //     goalEntry.className = 'goal-entry';
            //     var b=document.getElementById("input3").value;
            //     var c="";
            //     if(b==1){
            //         c="主队";
            //     }else{
            //         c="客队";
            //     }
            //     goalEntry.innerHTML = `<strong>${c}${type}</strong> - 时间: ${zTime} - 球员: ${players.join(', ')} - 比分: ${scoreText}`;
            //     // goalsList.appendChild(goalEntry);
            //     goalsList.prepend(goalEntry);
            //     goalsDisplay.style.display = 'block';
                
            //     const tip = document.getElementById("tipModal");
            //     tip.textContent = `${type}记录成功`;
            //     tip.classList.add('show');
            //     setTimeout(() => {
            //         tip.classList.remove('show');
            //     }, 2000);
            // }

            function addGoalRecord(type, players) {
                let [minutes, seconds] = globalTimer.textContent.split(':').map(Number);
                const itemSeconds = (initMinutes * 60 - (minutes * 60 + seconds));
                
                var a = initMinutes * 60 * total + itemSeconds;
                const zTime = formatElapsedTime(a);
                
                // 判断是哪个队的记录
                var b = document.getElementById("input3").value;
                var teamName = "";
                var isHomeTeam = false;
                
                if(b == 1){
                    teamName = "主队";
                    isHomeTeam = true;
                } else {
                    teamName = "客队";
                    isHomeTeam = false;
                }
                
                // 初始化比分
                let homeScore = 0;
                let awayScore = 0;
                
                // 从最近的记录获取当前比分
                if (scoreArray.length > 0) {
                    const lastScore = scoreArray[scoreArray.length - 1][1];
                    const [home, away] = lastScore.split(':').map(Number);
                    homeScore = home;
                    awayScore = away;
                }
                
                // 根据球队和记录类型更新比分
                // type === '得分' 表示该队得分
                // type === '失分' 表示该队失分（即对方得分）
                
                if (type === '得分') {
                    // 该队得分
                    if (isHomeTeam) {
                        homeScore += 1;
                    } else {
                        awayScore += 1;
                    }
                } else if (type === '失分') {
                    // 该队失分，即对方得分
                    if (isHomeTeam) {
                        // 主队失分，即客队得分
                        awayScore += 1;
                    } else {
                        // 客队失分，即主队得分
                        homeScore += 1;
                    }
                }
                
                // 确保比分格式为"主队得分:客队得分"
                const scoreText = `${homeScore}:${awayScore}`;
                scoreArray.push([a, scoreText, players.join('、')]);
                
                // 显示进球记录
                const goalEntry = document.createElement('div');
                goalEntry.className = 'goal-entry';
                goalEntry.innerHTML = `<strong>${teamName}${type}</strong> - 时间: ${zTime} - 球员: ${players.join(', ')} - 比分: ${scoreText}`;
                goalsList.prepend(goalEntry);
                goalsDisplay.style.display = 'block';
                
                const tip = document.getElementById("tipModal");
                tip.textContent = `${type}记录成功`;
                tip.classList.add('show');
                setTimeout(() => {
                    tip.classList.remove('show');
                }, 2000);
            }

            startButton.addEventListener('click', () => {
                const selectedCard = container.querySelectorAll('.selected');
                if (selectedCard.length == 0) {
                    alert("请选择上场的运动员");
                    return;
                }
                const countMap = new Map(numbers.map(item => [item, 0]));
                if (countMap.size != numbers.length) {
                    numbers.forEach(item => countMap.set(item, (countMap.get(item) || 0) + 1));
                    const keys = [...countMap.keys()];
                    const repeatKeys = keys.filter(x => countMap.get(x) > 1);
                    alert("存在重复的号码，请确认：\n" + repeatKeys.join('、'));
                    return;
                }
                if (isRunning) return;
                isRunning = true;
                updateButtons();
                const intervalGlobal = createTimer(globalTimer, null);
                countdownIntervals.set('global', intervalGlobal);
                container.querySelectorAll('.selected').forEach(card => startCountdown(card));
            });

            pauseButton.addEventListener('click', () => {
                if (!isRunning) return;
                isRunning = false;
                updateButtons();
                pauseAllCountdowns();
            });

            endButton.addEventListener('click', () => {
                const tbody = resultsTable.querySelector('tbody');
                // const tbody2 = resultsTable2.querySelector('tbody');
                tbody.innerHTML = '';
                // tbody2.innerHTML = '';

                const sortedCountdownTimes = sortTimes(countdownTimes);
                sortedCountdownTimes.forEach((elapsedSeconds, serial) => {
                    const role = elapsedSeconds.role;
                    const period = elapsedSeconds.period;
                    const row = document.createElement('tr');
                    const number = elapsedSeconds.number;
                    const periodFormat = formatElapsedTime(period);
                    row.innerHTML = `<td>${number}</td><td>${role}</td><td>${periodFormat}</td>`;
                    tbody.appendChild(row);
                });
                resultsTable.style.display = 'table';

                // if (scoreArray.length > 0) {
                //     scoreArray.forEach((item, index) => {
                //         const row = document.createElement('tr');
                //         const zTime = formatElapsedTime(item[0]);
                //         const scoreType = item[1].split(':')[0] > item[1].split(':')[1] ? '得分' : '失分';
                //         row.innerHTML = `<td>${zTime}</td><td>${scoreType}</td><td>${item[2]}</td>`;
                //         tbody2.appendChild(row);
                //     });
                //     resultsTable2.style.display = 'table';
                // }

                copyToClipboard();
            });

            function copyToClipboard() {
                const sortedCountdownTimes = sortTimes(countdownTimes);
                var copyArr = [];
                sortedCountdownTimes.forEach((elapsedSeconds, serial) => {
                    const role = elapsedSeconds.role;
                    const period = elapsedSeconds.period;
                    const number = elapsedSeconds.number;
                    const periodFormat = formatElapsedTime(period);
                    copyArr.push(periodFormat);
                });

                var copyText = document.getElementById("copyText");
                var t = copyArr.join('\n');
                t=t.replaceAll(":","")
                copyText.value = t;
                copyText.select();
                copyText.setSelectionRange(0, 99999);
                document.execCommand("copy");
            }

            function resetSecondConfirm() {
                if (confirm("确认重置之后，所有记录都将清空，请谨慎操作！")) {
                    if (isRunning) {
                        isRunning = false;
                        updateButtons();
                        pauseAllCountdowns();
                    }
                    countdownTimes.forEach((player, serial) => {
                        player.period = 0;
                    });
                    var cards = container.querySelectorAll('.card');

                    cards.forEach(function (child) {
                        child.classList.remove('selected');
                        var timerOne = child.querySelector('.timer');
                        timerOne.textContent = initMinutes + ':00'
                        var scoreOne = child.querySelector('.score');
                        scoreOne.textContent = '';
                    });
                    total++;
                    globalTimer.textContent = initMinutes + ':00'
                    pauseAllCountdowns();
                    const tbody = resultsTable.querySelector('tbody');
                    tbody.innerHTML = '';
                    resultsTable.style.display = 'none';
                    document.getElementById('copyText').value = '';
                }
            }

            resetButton.addEventListener('click', () => {
                resetSecondConfirm();
            });

            exportButton.addEventListener('click', () => {
                generateExcel();
            });

            changeButton.addEventListener('click', () => {
                const selectedCard = container.querySelectorAll('.selected');
                selectedCard.forEach(x => {
                    const role = x.querySelector('.role').textContent;
                    if (role !== 'G') {
                        x.click();
                    }
                });
            });

            batchButton.addEventListener('click', () => {
                const tbody = batchTable.querySelector('tbody');
                tbody.innerHTML = '';
                countdownTimes.forEach((player, serial) => {
                    const role = player.role;
                    const row = document.createElement('tr');
                    row.setAttribute('serial', serial);
                    const number = player.number;
                    row.innerHTML = `<td><input type="number" value="${number}"/></td><td><input type="text" value="${role}"/></td>`;
                    tbody.appendChild(row);
                });
                batchTable.style.display = 'table';
                commShowModal(batchModal);
            });

            var addTimestamp = 0;
            var reduceTimestamp = 0;

            addButton.addEventListener('click', () => {
                if (addTimestamp == 0) {
                    addTimestamp = new Date().getTime();
                } else {
                    const curTimestamp = new Date().getTime();
                    if ((curTimestamp - addTimestamp) / 1000 <= 1) {
                        console.log('连续点击，忽略');
                        return;
                    }
                }
                
                const selectedCard = container.querySelectorAll('.selected');
                if (!selectedCard || selectedCard.length == 0) {
                    alert('没有在场的队员');
                    return;
                }
                var onPlayer = [];
                selectedCard.forEach(function (x) {
                    onPlayer.push(x.querySelector('.number').textContent);
                });
                
                addGoalRecord('得分', onPlayer);
            });
            
            reduceButton.addEventListener('click', () => {
                if (reduceTimestamp == 0) {
                    reduceTimestamp = new Date().getTime();
                } else {
                    const curTimestamp = new Date().getTime();
                    if ((curTimestamp - reduceTimestamp) / 1000 <= 1) {
                        console.log('连续点击，忽略');
                        return;
                    }
                }
                
                const selectedCard = container.querySelectorAll('.selected');
                if (!selectedCard || selectedCard.length == 0) {
                    alert('没有在场的队员');
                    return;
                }
                var onPlayer = [];
                selectedCard.forEach(function (x) {
                    onPlayer.push(x.querySelector('.number').textContent);
                });
                
                addGoalRecord('失分', onPlayer);
            });

            scoreSubmitButton.addEventListener('click', () => {
                const title = scoreTitle.textContent;
                if (title === '编辑球员信息') {
                    const serial = scoreContext.getAttribute('serial');
                    const number = document.getElementById('editNumber').value;
                    const role = document.getElementById('editRole').value.toUpperCase();
                    
                    const player = countdownTimes.get(serial);
                    player.number = number;
                    player.role = role;
                    countdownTimes.set(serial, player);
                    
                    const numberDiv = container.querySelector(`.number[serial='${serial}']`);
                    const roleDiv = container.querySelector(`.role[serial='${serial}']`);
                    numberDiv.textContent = number;
                    roleDiv.textContent = role;
                    
                    numbers[parseInt(serial) - 1] = number;
                    commCloseModal(scoreModal);
                } else {
                    const selectedScoreCard = scoreContext.querySelector('.selected');
                    if (!selectedScoreCard || selectedScoreCard.length == 0) {
                        alert('请选择' + title + '队员');
                        return;
                    }
                    const serial = selectedScoreCard.getAttribute('serial');
                    const outCardSelector = `.score[serial='${serial}']`;
                    const outScoreDiv = container.querySelector(outCardSelector);
                    var outScore = outScoreDiv.textContent;
                    if (!outScore || outScore == '') {
                        outScore = '0';
                    }
                    var realScore = parseInt(outScore);
                    if (title == '得分') {
                        realScore = realScore + 1;
                    }
                    outScoreDiv.textContent = (realScore == 0 ? '' : realScore);
                    countdownTimes.get(serial).score = realScore;
                    commCloseModal(scoreModal);
                }
            });

            updateButtons();
        }

        // 禁用返回按钮
        history.pushState(null, null, location.href);
        window.onpopstate = function () {
            history.go(1);
        };

        // 禁用刷新
        window.addEventListener('beforeunload', function (e) {
            var confirmationMessage = '确定要离开此页面吗？';
            e.returnValue = confirmationMessage;
            return confirmationMessage;
        });