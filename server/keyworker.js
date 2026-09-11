/**
 * 全局击键采集子进程
 * 独立进程的原因：uiohook 的钩子会占用宿主线程的消息循环，
 * 若在 Web 服务进程内启动会阻塞 HTTP/WebSocket 响应。
 *
 * 隐私：只统计次数与时间戳，不记录任何键码、字符或窗口信息。
 */
const path = require('path');
const { requireFrom } = require('./external');

const WINDOW_MS = 15000;
const stamps = [];
let total = 0;
let peakKpm = 0;
let activeMs = 0;
let lastKeyAt = 0;
let started = false;

// 老板键默认 F9。判定逻辑放在 bosskey.js（纯函数，可单测）
const { parseBossEnv, isBossEvent } = require('./bosskey');
const BOSS = parseBossEnv(process.env);
let lastBossAt = 0;

/**
 * 加载原生全局键盘钩子。
 * - 打包运行：父进程已把 uiohook-napi 释放到磁盘，路径经 NETWALK_UIOHOOK_DIR 传入。
 *   这里必须用 requireFrom（createRequire）—— SEA 里运行时 require 只能解析内置模块。
 * - 源码运行：走正常的 node_modules 解析。
 */
function loadUiohook() {
  const ext = process.env.NETWALK_UIOHOOK_DIR;
  if (ext) return requireFrom(ext, 'uiohook-napi');
  return requireFrom(path.join(__dirname, '..'), 'uiohook-napi');
}

function prune(now) {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < stamps.length && stamps[i] < cutoff) i++;
  if (i > 0) stamps.splice(0, i);
}

function snapshot() {
  const now = Date.now();
  prune(now);
  const kpm = Math.round((stamps.length / WINDOW_MS) * 60000);
  peakKpm = Math.max(peakKpm, kpm);
  return {
    type: 'snapshot',
    mode: 'global',
    kpm,
    wpm: Math.round(kpm / 5),
    windowKeys: stamps.length,
    total,
    peakKpm,
    activeMs,
    lastKeyAt,
  };
}

try {
  const { uIOhook } = loadUiohook();
  uIOhook.on('keydown', (e) => {
    const now = Date.now();
    stamps.push(now);
    total += 1;
    if (lastKeyAt) {
      const gap = now - lastKeyAt;
      if (gap < 3000) activeMs += gap;
    }
    lastKeyAt = now;

    // 老板键：通知主进程切换隐藏（去抖 600ms，长按不会连续触发）
    if (isBossEvent(e, BOSS)) {
      if (now - lastBossAt > 600) {
        lastBossAt = now;
        try { process.send({ type: 'boss' }); } catch (_) { /* 主进程可能已退出 */ }
      }
    }
  });
  uIOhook.start();
  started = true;
  process.send({ type: 'ready', mode: 'global' });
} catch (err) {
  process.send({ type: 'ready', mode: 'none', error: err && err.message ? err.message : String(err) });
  process.exit(0);
}

const timer = setInterval(() => {
  try { process.send(snapshot()); } catch (_) { /* 父进程已退出 */ }
}, 500);

process.on('message', (m) => {
  if (m && m.type === 'stop') {
    clearInterval(timer);
    try { if (started) loadUiohook().uIOhook.stop(); } catch (_) { /* noop */ }
    process.exit(0);
  }
});

process.on('disconnect', () => {
  clearInterval(timer);
  process.exit(0);
});
