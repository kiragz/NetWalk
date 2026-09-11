/**
 * 击键速率采集（主进程侧）
 * 优先：子进程中的系统级全局钩子（IPC 取数）
 * 兜底：浏览器窗口内上报（POST /api/key）
 *
 * 隐私设计：只累计「次数 + 时间戳」，绝不记录键码、字符或窗口标题。
 */
const { spawnChild } = require('./childproc');
const { uiohookEnv } = require('./native');
const { EventEmitter } = require('events');

const WINDOW_MS = 15000;

class KeyMonitor extends EventEmitter {
  constructor() {
    super();
    this.stamps = [];
    this.total = 0;
    this.peakKpm = 0;
    this.activeMs = 0;
    this.lastKeyAt = 0;
    this.mode = 'none';       // global | remote | none
    this.error = null;
    this._child = null;
    this._global = { kpm: 0, wpm: 0, total: 0, peakKpm: 0, activeMs: 0, lastKeyAt: 0 };
  }

  /**
   * 处理采集子进程的消息（单独一个方法，方便单测）
   * @param {object} m
   * @param {Function} [done] 收到 ready 时回调
   */
  _onChildMessage(m, done) {
    if (!m) return;
    if (m.type === 'ready') {
      // 打包后子进程要解压快照、还可能被杀毒软件首扫，首启可能 10 秒以上；
      // 晚到的 ready 也要把最终状态更新进来，只是不再重复 resolve
      this.mode = m.mode === 'global' ? 'global' : 'remote';
      if (m.mode !== 'global') this.error = m.error || '全局钩子不可用';
      if (done) done();
    } else if (m.type === 'snapshot') {
      this._global = {
        kpm: m.kpm, wpm: m.wpm, total: m.total,
        peakKpm: m.peakKpm, activeMs: m.activeMs, lastKeyAt: m.lastKeyAt,
      };
    } else if (m.type === 'boss') {
      // 老板键：只转发「按下了」这个事实，不带任何字符或窗口信息
      this.emit('boss');
    }
  }

  /** 浏览器兜底上报入口 */
  push(ts = Date.now()) {
    this.stamps.push(ts);
    this.total += 1;
    if (this.lastKeyAt) {
      const gap = ts - this.lastKeyAt;
      if (gap < 3000) this.activeMs += gap;
    }
    this.lastKeyAt = ts;
    this.emit('key', ts);
  }

  _prune(now = Date.now()) {
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i] < cutoff) i++;
    if (i > 0) this.stamps.splice(0, i);
  }

  _remoteRate() {
    this._prune();
    const n = this.stamps.length;
    const kpm = Math.round((n / WINDOW_MS) * 60000);
    this.peakKpm = Math.max(this.peakKpm, kpm);
    return { kpm, wpm: Math.round(kpm / 5), windowKeys: n };
  }

  async start(extraEnv) {
    if (this._child) return this.mode;
    this._env = extraEnv || this._env || null;
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnChild('keyworker', Object.assign({}, uiohookEnv(), this._env || {}));
      } catch (err) {
        this.mode = 'remote';
        this.error = err && err.message ? err.message : String(err);
        return resolve(this.mode);
      }
      this._child = child;
      let settled = false;
      const done = () => { if (settled) return; settled = true; resolve(this.mode); };

      child.on('message', (m) => this._onChildMessage(m, done));
      child.on('error', (err) => {
        this.error = err && err.message ? err.message : String(err);
        this.mode = 'remote';
        done();
      });
      child.on('exit', () => {
        this._child = null;
        if (this.mode === 'global') this.mode = 'remote';
        done();
      });
      // 打包子进程首启可能 10s+（快照解压 / 杀毒扫描），3 秒判定窗太短会永远降级
      setTimeout(() => done(), 20000);
    });
  }

  stop() {
    if (this._child) {
      try { this._child.send({ type: 'stop' }); } catch (_) { /* noop */ }
      try { this._child.kill(); } catch (_) { /* noop */ }
      this._child = null;
    }
  }

  /** 用新的老板键配置重启采集子进程（改设置后立即生效，不用重启整个程序） */
  async restart(extraEnv) {
    this.stop();
    this.mode = 'none';
    return this.start(extraEnv);
  }

  snapshot() {
    if (this.mode === 'global') {
      return {
        kpm: this._global.kpm,
        wpm: this._global.wpm,
        windowKeys: 0,
        total: this._global.total,
        peakKpm: this._global.peakKpm,
        activeMs: this._global.activeMs,
        mode: 'global',
        error: this.error,
        lastKeyAt: this._global.lastKeyAt,
      };
    }
    const r = this._remoteRate();
    return {
      kpm: r.kpm,
      wpm: r.wpm,
      windowKeys: r.windowKeys,
      total: this.total,
      peakKpm: this.peakKpm,
      activeMs: this.activeMs,
      mode: this.mode,
      error: this.error,
      lastKeyAt: this.lastKeyAt,
    };
  }
}

module.exports = { KeyMonitor, WINDOW_MS };
