App({
  globalData: {
    // 微信云开发环境 ID（联机游戏 你画我猜 / 五子棋 使用）
    // 获取方式：微信开发者工具 -> 云开发 -> 环境设置 -> 环境 ID
    // 留空字符串也能跑（非联机页面不受影响），但联机功能会报「云能力不可用」
    cloudEnv: 'cloud1-d8gclv2q2c1952643',

    systemInfo: null,
    safeArea: null
  },

  onLaunch() {
    // 初始化云开发（联机游戏依赖，无后端服务器）
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请使用 2.2.3 以上的基础库');
    } else {
      wx.cloud.init({
        // 不填 env 时默认使用第一个环境；显式填写更稳妥
        env: this.globalData.cloudEnv || undefined,
        traceUser: true
      });
    }
    this.refreshSystemInfo();
  },

  refreshSystemInfo() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : {};
      this.globalData.systemInfo = Object.assign({}, windowInfo, deviceInfo);
      this.globalData.safeArea = windowInfo.safeArea || null;
    } catch (e) {
      this.globalData.systemInfo = {};
    }
    return this.globalData.systemInfo;
  }
});
