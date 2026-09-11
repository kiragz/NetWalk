/**
 * 老板键判定（纯函数，方便单测）
 *
 * 隐私：只比对「键码 + 修饰键」，不记录按下了哪个字符，也不关心焦点在哪个窗口。
 */
const MOD_KEYS = ['ctrl', 'shift', 'alt', 'meta'];

/** uiohook 键码常量（只列设置里可选的几个，避免到处写魔法数字） */
const KEYS = { Esc: 1, H: 35, N: 49, F9: 67, F10: 68, F11: 87, F12: 88 };

/** 从采集子进程的环境变量里读老板键配置 */
function parseBossEnv(env) {
  const e = env || {};
  return {
    enabled: e.NETWALK_BOSS_ENABLED !== '0',
    key: Number(e.NETWALK_BOSS_KEY) || KEYS.F9,
    mods: String(e.NETWALK_BOSS_MODS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => MOD_KEYS.indexOf(s) >= 0),
  };
}

/** 把 config.boss 规范化（前端可能传来缺字段的对象） */
function normalizeBoss(b) {
  const o = b || {};
  return {
    enabled: o.enabled !== false,
    key: Number(o.key) || KEYS.F9,
    mods: Array.isArray(o.mods)
      ? o.mods.filter((s) => MOD_KEYS.indexOf(s) >= 0)
      : parseBossEnv({ NETWALK_BOSS_MODS: o.mods }).mods,
  };
}

/** 某个键盘事件是否命中老板键 */
function isBossEvent(e, cfg) {
  if (!cfg || !cfg.enabled || !e) return false;
  if (Number(e.keycode) !== Number(cfg.key)) return false;
  if (!cfg.mods.length) return true;   // 单键模式：不要求修饰键
  return cfg.mods.every((m) => Boolean(e[m + 'Key'] || e[m]));
}

module.exports = { parseBossEnv, normalizeBoss, isBossEvent, KEYS, MOD_KEYS };
