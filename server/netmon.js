/**
 * 实时网络速率采集（Windows 优先）
 *
 * 关键点：systeminformation 在 Windows 上单次 networkStats() 可能耗时 10~20 秒，
 * 若在 Web 服务主线程内周期调用会彻底阻塞事件循环（HTTP/WS 全部无响应）。
 * 因此主方案改为「常驻 PowerShell 子进程持续输出网卡累计字节数」，
 * 由本模块做时间差分得到速率；全程异步，不阻塞主线程。
 */
const { spawn } = require('child_process');
const { spawnChild } = require('./childproc');

// 虚拟/回环网卡前缀（不同系统命名不一，做宽松过滤）
const VIRTUAL_PREFIX = [
  'lo', 'loopback', 'isatap', 'teredo', 'vEthernet', 'vmnet', 'virtualbox',
  'vmware', 'hyper-v', 'docker', 'br-', 'veth', 'tailscale', 'zerotier',
  'npcap', 'wintun', 'utun', 'awdl', 'llw', 'bridge', 'bluetooth',
];

function isVirtual(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return true;
  return VIRTUAL_PREFIX.some((p) => n.startsWith(p));
}

const PS_SCRIPT = [
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
  "$ErrorActionPreference='SilentlyContinue'",
  "while($true){",
  "$ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
  "$o=@()",
  "foreach($a in Get-NetAdapterStatistics){ $o+=$a.Name+'|'+$a.ReceivedBytes+'|'+$a.SentBytes }",
  "[Console]::Out.WriteLine([string]$ts+'#'+($o -join ','))",
  "[Console]::Out.Flush()",
  "Start-Sleep -Milliseconds 1000",
  "}",
].join('; ');

class NetMonitor {
  constructor({ intervalMs = 1000 } = {}) {
    this.intervalMs = intervalMs;
    this.rx = 0;
    this.tx = 0;
    this.iface = '';
    this.peakRx = 0;
    this.peakTx = 0;
    this.totalRx = 0;
    this.totalTx = 0;
    this.available = false;
    this.source = 'none';     // powershell | si | none
    this.lastError = null;
    this._prev = new Map();
    this._ps = null;
    this._running = false;
    this._buf = '';
    this._got = false;
    this._siChild = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startPs();
    // PowerShell 冷启动可能要 6~10 秒（杀毒扫描/首次加载模块），判定窗太短
    // 会把本可用的方案误判为不可用。放宽到 25 秒再考虑兜底。
    setTimeout(() => {
      if (this._running && !this._got) this._startSi();
    }, 25000);
  }

  _startPs() {
    if (this._ps) return;
    try {
      this._ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      this.lastError = err && err.message ? err.message : String(err);
      this._startSi();
      return;
    }
    this._ps.stdout.on('data', (d) => {
      this._buf += d.toString();
      let i;
      while ((i = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, i).trim();
        this._buf = this._buf.slice(i + 1);
        if (line) this._onLine(line);
      }
    });
    this._ps.stderr.on('data', () => { /* 忽略 PowerShell 告警 */ });
    this._ps.on('error', (err) => {
      this.lastError = err && err.message ? err.message : String(err);
      this._ps = null;
      this._startSi();
    });
    this._ps.on('exit', () => {
      this._ps = null;
      if (this._running && this.source === 'powershell') {
        setTimeout(() => this._startPs(), 3000);
      }
    });
  }

  _onLine(line) {
    const hash = line.indexOf('#');
    if (hash < 0) return;
    const ts = Number(line.slice(0, hash));
    if (!Number.isFinite(ts)) return;
    const body = line.slice(hash + 1).trim();
    let rxSum = 0;
    let txSum = 0;
    let topName = '';
    let topRate = -1;
    const seen = new Set();

    for (const part of body.split(',')) {
      const f = part.split('|');
      if (f.length < 3) continue;
      const name = f[0];
      const rx = Number(f[1]);
      const tx = Number(f[2]);
      if (!name || !Number.isFinite(rx) || !Number.isFinite(tx)) continue;
      seen.add(name);
      const prev = this._prev.get(name);
      this._prev.set(name, { ts, rx, tx });
      if (!prev || ts <= prev.ts) continue;
      // 计数器回绕（网卡重置/休眠唤醒）时跳过
      if (rx < prev.rx || tx < prev.tx) continue;
      const dt = (ts - prev.ts) / 1000;
      if (dt <= 0) continue;
      const r = (rx - prev.rx) / dt;
      const t = (tx - prev.tx) / dt;
      if (isVirtual(name)) continue;
      rxSum += r;
      txSum += t;
      if (r + t > topRate) { topRate = r + t; topName = name; }
    }
    // 清理已消失的接口
    for (const k of this._prev.keys()) if (!seen.has(k)) this._prev.delete(k);

    if (topName === '' && seen.size > 0) {
      // 全部被过滤时取累计流量最大的一个，保证始终有数据
      let best = null;
      for (const [name, cur] of this._prev.entries()) {
        if (!best || cur.rx + cur.tx > best.cur.rx + best.cur.tx) best = { name, cur };
      }
      if (best) topName = best.name;
    }
    if (topName === '') return;

    const dtReal = this.intervalMs / 1000;
    this.totalRx += rxSum * dtReal;
    this.totalTx += txSum * dtReal;
    this.rx = Math.max(0, rxSum);
    this.tx = Math.max(0, txSum);
    this.iface = topName;
    this.peakRx = Math.max(this.peakRx, this.rx);
    this.peakTx = Math.max(this.peakTx, this.tx);
    this.available = true;
    this.source = 'powershell';
    this._got = true;
  }

  /**
   * 兜底：在独立子进程中使用 systeminformation。
   * 必须在子进程中运行 —— 其单次调用在 Windows 上可达 10~20 秒，
   * 放在主进程会直接阻塞 HTTP/WebSocket。
   */
  _startSi() {
    if (this._siChild || this._got) return;
    let child;
    try {
      child = spawnChild('networker');
    } catch (err) {
      this.lastError = err && err.message ? err.message : String(err);
      return;
    }
    this._siChild = child;
    child.on('message', (m) => {
      if (!m) return;
      if (m.type === 'net' && m.ok) {
        // 主方案已恢复时忽略兜底数据，避免抖动
        if (this.source === 'powershell') return;
        this.rx = Math.max(0, m.rx || 0);
        this.tx = Math.max(0, m.tx || 0);
        this.iface = m.iface || this.iface;
        this.peakRx = Math.max(this.peakRx, this.rx);
        this.peakTx = Math.max(this.peakTx, this.tx);
        this.available = true;
        this.source = 'si';
        this._got = true;
      } else if (m.type === 'net' || (m.type === 'ready' && !m.ok)) {
        if (m.error) this.lastError = m.error;
        if (m.type === 'ready') {
          try { child.kill(); } catch (_) { /* noop */ }
          this._siChild = null;
        }
      }
    });
    child.on('error', (err) => {
      this.lastError = err && err.message ? err.message : String(err);
      this._siChild = null;
    });
    child.on('exit', () => { this._siChild = null; });
  }

  stop() {
    this._running = false;
    if (this._ps) {
      try { this._ps.kill(); } catch (_) { /* noop */ }
      this._ps = null;
    }
    if (this._siChild) {
      try { this._siChild.send({ type: 'stop' }); } catch (_) { /* noop */ }
      try { this._siChild.kill(); } catch (_) { /* noop */ }
      this._siChild = null;
    }
  }

  snapshot() {
    return {
      rx: this.rx,
      tx: this.tx,
      iface: this.iface,
      peakRx: this.peakRx,
      peakTx: this.peakTx,
      totalRx: this.totalRx,
      totalTx: this.totalTx,
      available: this.available,
      source: this.source,
      error: this.lastError,
    };
  }
}

module.exports = { NetMonitor };
