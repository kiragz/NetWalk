/**
 * 速度换算引擎：网速 + 打字速度 → 人体移动速度
 * 纯函数，无副作用，便于两端复用与调参。
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    netWeight: 0.6,
    typeWeight: 0.4,
    // 20 Mbps 视为满负荷：日常网速远低于此，基准取小一些才有手感
    netFullMbps: 20,
    typeFullKpm: 300,
    walkMax: 6.5,
    runMax: 16,
    // 挂机保底：即使完全没有流量也在缓慢移动，保证一天下来有可见进度
    idleSpeed: 1.2,
  };

  const MODES = {
    idle: { label: '发呆', icon: '🧍', color: '#8b98b5' },
    stroll: { label: '散步', icon: '🚶', color: '#4aa8ff' },
    walk: { label: '走路', icon: '🚶', color: '#3ddc97' },
    brisk: { label: '快走', icon: '🚶', color: '#ffb020' },
    run: { label: '奔跑', icon: '🏃', color: '#ff5d5d' },
    sprint: { label: '狂奔', icon: '🔥', color: '#ff2d55' },
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

  /** 归一化网络强度（对数曲线：低速也敏感，高速不失控） */
  function netScore(bytesPerSec, cfg) {
    const mbps = (Math.max(0, bytesPerSec) * 8) / 1e6;
    const full = Math.max(1, cfg.netFullMbps);
    return clamp(Math.log10(1 + mbps) / Math.log10(1 + full), 0, 1);
  }

  /** 归一化打字强度 */
  function typeScore(kpm, cfg) {
    return clamp(kpm / Math.max(1, cfg.typeFullKpm), 0, 1);
  }

  /**
   * 换算综合速度与状态
   * @returns {{speedKmh:number, mode:string, label:string, icon:string, color:string, intensity:number, net:number, type:number}}
   */
  function convert({ rx = 0, tx = 0, kpm = 0 }, cfg = {}) {
    const c = Object.assign({}, DEFAULTS, cfg);
    const ns = netScore(rx + tx, c);
    const ts = typeScore(kpm, c);
    const wsum = Math.max(0.0001, c.netWeight + c.typeWeight);
    const intensity = clamp((ns * c.netWeight + ts * c.typeWeight) / wsum, 0, 1);

    let speed;
    let mode;
    if (intensity < 0.10) {
      mode = 'idle';
      speed = lerp(c.idleSpeed, 2.5, intensity / 0.10);
    } else if (intensity < 0.35) {
      mode = 'stroll';
      speed = lerp(2.5, 4.2, (intensity - 0.10) / 0.25);
    } else if (intensity < 0.58) {
      mode = 'walk';
      speed = lerp(4.2, c.walkMax, (intensity - 0.35) / 0.23);
    } else if (intensity < 0.76) {
      mode = 'brisk';
      speed = lerp(c.walkMax, 9.5, (intensity - 0.58) / 0.18);
    } else if (intensity < 0.92) {
      mode = 'run';
      speed = lerp(9.5, c.runMax, (intensity - 0.76) / 0.16);
    } else {
      mode = 'sprint';
      speed = lerp(c.runMax, c.runMax * 1.35, (intensity - 0.92) / 0.08);
    }

    const m = MODES[mode] || MODES.walk;
    return {
      speedKmh: Number(speed.toFixed(2)),
      mode,
      label: m.label,
      icon: m.icon,
      color: m.color,
      intensity: Number(intensity.toFixed(3)),
      net: Number(ns.toFixed(3)),
      type: Number(ts.toFixed(3)),
    };
  }

  /** 指数平滑器：避免网速抖动导致速度跳变 */
  function createSmoother(tauMs = 3000) {
    let value = null;
    let last = 0;
    return function smooth(next, now = Date.now()) {
      if (value === null || !last) { value = next; last = now; return value; }
      const dt = clamp((now - last) / 1000, 0, 5);
      const alpha = 1 - Math.exp(-dt / (tauMs / 1000));
      value = value + (next - value) * alpha;
      last = now;
      return value;
    };
  }

  /** ROLL100 路口决策：返回转向语义与目标距离 */
  function rollJunction(roll, currentBearing) {
    const r = clamp(Math.round(roll), 1, 100);
    let choice;
    let delta;
    if (r <= 45) { choice = '直行'; delta = 0; }
    else if (r <= 68) { choice = '左转'; delta = -90; }
    else if (r <= 89) { choice = '右转'; delta = 90; }
    else if (r <= 96) { choice = '掉头'; delta = 180; }
    else { choice = '灵感爆发·远行'; delta = 0; }

    const jitter = (Math.random() - 0.5) * 24;
    let bearing = (currentBearing + delta + jitter) % 360;
    if (bearing < 0) bearing += 360;
    const distance = r >= 97 ? 900 + Math.random() * 600 : 180 + r * 5.5 + Math.random() * 120;
    return { roll: r, choice, bearing, distance };
  }

  global.NetWalkSpeed = { convert, createSmoother, rollJunction, netScore, typeScore, MODES, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NetWalkSpeed;
})(typeof window !== 'undefined' ? window : global);
