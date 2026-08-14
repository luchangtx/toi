// utils/sfx.js
// 《影子搭档》程序化音效 —— 用微信 WebAudio 现场合成，零音频文件，离线也能发声。
// 合家欢向：胜利用明亮上行三音；移动是轻 click；撞墙是低沉 thud；切换视角是清脆 tick；失败是下行二音。
// 运行环境若不支持 wx.createWebAudioContext（旧基础库 / 部分模拟器），全部静默降级，绝不影响游戏。

let _ctx = null;
function ctx() {
  if (_ctx) return _ctx;
  try {
    if (typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function') {
      _ctx = wx.createWebAudioContext();
    }
  } catch (e) {
    _ctx = null;
  }
  return _ctx;
}

function tone(opt) {
  const c = ctx();
  if (!c) return;
  try {
    if (c.state === 'suspended' && typeof c.resume === 'function') c.resume();
    const t0 = c.currentTime + (opt.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.freq, t0);
    if (opt.freqEnd) osc.frequency.exponentialRampToValueAtTime(opt.freqEnd, t0 + opt.dur);
    const peak = opt.gain == null ? 0.15 : opt.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + opt.dur + 0.03);
  } catch (e) {
    /* 合成失败：静默 */
  }
}

function playWin() {
  tone({ freq: 523.25, type: 'triangle', dur: 0.16, gain: 0.22 }); // C5
  tone({ freq: 659.25, type: 'triangle', dur: 0.16, delay: 0.12, gain: 0.22 }); // E5
  tone({ freq: 783.99, type: 'triangle', dur: 0.30, delay: 0.24, gain: 0.26 }); // G5
}

function playStep() {
  tone({ freq: 340, type: 'square', dur: 0.05, gain: 0.06 });
}

function playBump() {
  tone({ freq: 120, type: 'sawtooth', dur: 0.12, gain: 0.12 });
}

function playSwitch() {
  tone({ freq: 480, type: 'sine', dur: 0.08, gain: 0.10 });
}

function playLose() {
  tone({ freq: 392, type: 'triangle', dur: 0.20, gain: 0.18 }); // G4
  tone({ freq: 294, type: 'triangle', dur: 0.34, delay: 0.18, gain: 0.18 }); // D4
}

// 地图翻转：两声快速高低切换，醒目但不刺耳
function playSwap() {
  tone({ freq: 660, type: 'square', dur: 0.09, gain: 0.12 });
  tone({ freq: 440, type: 'square', dur: 0.13, delay: 0.10, gain: 0.12 });
}

module.exports = { playWin, playStep, playBump, playSwitch, playLose, playSwap };
