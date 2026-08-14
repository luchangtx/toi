# 小游戏合集 · 微信小程序版

将 `/Users/lile/Desktop/ai_space/wp` 下的 HTML 小游戏合集 1:1 转换为微信小程序。
`index.html` 为目录页，其余游戏为其收录的子页面。

## 目录结构

```
miniprogram/                # 小程序主包（~340KB，远小于 2MB 上限）
├── app.js / app.json / app.wxss      # 全局配置与深色科技风主题
├── sitemap.json / project.config.json
├── pages/
│   ├── index/   目录页（原 index.html，背景连线粒子 + 卡片入口）
│   ├── delta/   三角洲行动（原 sjz.html，Canvas 2D 射击，3 画布改 wx type=2d）
│   ├── toi/     冰球计时 TOI（合并原 711.html + timers.html）
│   ├── draw/    你画我猜（原 draw.html，PeerJS → 微信云开发实时同步）
│   ├── gomoku/  联机五子棋（原 wzq.html，PeerJS → 微信云开发实时同步）
│   └── luozi/   落字（原创重力拼字益智游戏，体感倾斜/按钮双操作 + 无尽动态关卡，纯前端）
├── utils/
│   ├── luoziCore.js  落字核心逻辑（重力/旋转/锁定，Node 可复用）
│   ├── luoziLevels.js 落字 20 关数据（BFS 求解器验证可解 + 最优步数）
│   ├── luoziTilt.js  落字体感量化逻辑（绝对重力映射/一次性符号校准/迟滞防抖/平放检测，Node 可复用）
│   ├── luoziGen.js   落字动态关卡生成器（84 字部件库 + BFS 验证可解/最优步数/任意局面求解提示）
│   ├── ws.js         云开发联机房间客户端（RoomClient，draw/gomoku 共用）
│   ├── deltaCore.js  三角洲行动游戏核心逻辑
│   ├── toiCore.js    冰球计时业务与统计
│   ├── csv.js        轻量 CSV 导出（替代 xlsx.full.min.js）
│   └── drawWords.js  你画我猜词库
└── cloudfunctions/
    └── room/         room 云函数：联机房间中转（create/join/send/leave）
        ├── index.js
        └── package.json
```

## 导入微信开发者工具

1. 打开「微信开发者工具」→ 导入项目 → 目录选择 `miniprogram/`。
2. 填写你自己的 **AppID**（测试号也可）。
3. 项目类型选「小程序」。
4. 编译后首页即为目录页。点卡片进入对应游戏。

> 非联机页面（三角洲行动、冰球计时）无需任何后端，导入即可玩。

## 联机游戏（你画我猜 / 五子棋）的云开发配置

小程序不支持 WebRTC / PeerJS，原联机逻辑改用**微信云开发**做实时同步。
**好处：不需要你自己部署任何服务器**——房间状态与消息流转由微信云数据库 + 一个 `room` 云函数完成。

### 一次性准备（约 5 分钟）

1. **开通云开发**：开发者工具顶部点「云开发」→ 开通 → 创建环境（选按量付费或免费额度，记住**环境 ID**）。
2. **填入环境 ID**：把环境 ID 填到 `miniprogram/app.js` 的 `globalData.cloudEnv`：
   ```js
   globalData: {
     cloudEnv: 'your-env-id-here',   // 改成你的环境 ID
     ...
   }
   ```
3. **部署 room 云函数**：
   - 在「云开发」控制台 → 云函数 → 新建云函数，名称填 `room`，运行环境 Nodejs。
   - 把 `miniprogram/cloudfunctions/room/` 下的 `index.js` 和 `package.json` 上传进去。
   - 右键该云函数 → **「上传并部署：云端安装依赖」**（会自动安装 `wx-server-sdk`）。
4. **建数据库集合**：在「云开发」控制台 → 数据库 → 新建集合 `rooms` 与 `msgs`。
   - 把这两个集合的权限改为 **「所有用户可读，仅创建者可读写」**（客户端只读取，写全部走云函数 admin 权限）。
   - ⚠️ **重要**：`msgs` 集合必须有「所有用户可读」权限——客户端用增量轮询读取它来实现消息兜底同步，若设为「仅创建者可读写」会导致落子 / 笔迹 / 回合消息收不到（表现为对方卡在等待屏或落子不同步）。
5. 重新编译小程序，进入你画我猜 / 五子棋即可联机。

### 联机流程

- 房主点「创建房间」→ 生成 4 位房间号 → 通过微信发给好友。
- 好友点「加入房间」→ 输入房间号 → 两人即可对战。

### 创建房间报错排查

点击「创建房间 / 加入房间」若弹出错误，提示已含真实原因，对照处理：

1. **未填 cloudEnv / 未开通云开发**
   提示含 `NO_CLOUD` / `云能力不可用`。
   解决：确认已在后台开通云开发，并把环境 ID 填进 `app.js` 的 `globalData.cloudEnv`。

2. **room 云函数未部署 / 部署失败**
   提示含 `CLOUD_FAIL` / `云函数调用失败`。
   解决：确认 `room` 云函数已上传并「云端安装依赖」成功，且名称拼写正确。

3. **rooms / msgs 集合未建或权限不对**
   表现：调用成功但监听不到对方、或报权限错误。
   解决：确认已建 `rooms`、`msgs` 两个集合，权限设为「所有用户可读，仅创建者可读写」。

4. **房间已满 / 类型不匹配 / 不存在**
   提示含 `ROOM_FULL` / `GAME_MISMATCH` / `房间不存在`。
   多为房间号输错或对方已退出，重新创建/加入即可。

## 与原 HTML 的关键差异（平台限制处理）

| 原特性 | 小程序方案 |
|---|---|
| `document` / `getElementById` / `innerHTML` | 全部改为 `setData` + `wx:for` 数据驱动 |
| `localStorage` | `wx.getStorageSync` / `wx.setStorageSync` |
| `-webkit-background-clip:text` 渐变标题 | 纯亮色 + 文字阴影等效 |
| `backdrop-filter` 毛玻璃 | 加深半透明背景替代 |
| `clamp()` / `100dvh` | 固定 rpx / `100vh` |
| `.hover` | 改为 `hover-class` + `:active` |
| `<canvas>` getContext | `wx.createSelectorQuery` + `type="2d"` + `canvas.requestAnimationFrame` |
| 鼠标事件 | `bindtouchstart/move/end` 触摸事件 |
| `alert()` / `prompt()` | `wx.showToast` / `wx.showModal`（可 `editable`） |
| 冰球 Excel 导出（xlsx 881KB） | 自写轻量 CSV（带 UTF-8 BOM）+ `wx.shareFileMessage` 转发 |
| 你画我猜 / 五子棋 的 PeerJS P2P | `miniprogram/utils/ws.js` 的 `RoomClient` + 微信云开发（rooms/msgs 集合 + room 云函数） |
| 711.html 与 timers.html 完全相同 | 合并为单个「冰球计时 TOI」页面 |

## 性能与资源清理

- 所有页面的 `setInterval` / `setTimeout` / canvas `requestAnimationFrame` 均在 `onUnload`（`onHide`）中清理。
- 游戏页在进入时 `wx.setKeepScreenOn(true)`，离开时关闭。
- 联机页在 `onUnload` 调用 `client.destroy()`，会关闭云数据库 watch 监听并通知对方离开。
- 三角洲行动的游戏状态存于非响应式的 `this` 属性，仅 HUD 数值变化才 `setData`（节流），避免每帧刷新卡顿。

## 已知限制

- 你画我猜 / 五子棋依赖微信云开发（免费额度足够小游戏 demo），需完成上面的「云开发配置」才能联机；单机无法对战。
- 云数据库实时监听（watch）按读次数计费，免费额度 5 万次/天，小游戏量级完全够用。
- 冰球计时 CSV 导出依赖 `wx.shareFileMessage`，部分基础库版本可能不支持，已做复制文本兜底。
- 外部 Google 字体不可用，统一回退到系统字体（`PingFang SC` 等）。
