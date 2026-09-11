/**
 * 任务栏右下角托盘 + 老板键执行端（Windows）
 *
 * 为什么要一个常驻 PowerShell：
 *   Windows 的托盘图标和「隐藏别的进程窗口」都要走 Win32 / WinForms，
 *   纯 Node 做不了（要编译原生模块）。而 PowerShell 冷启动要 6~10 秒，
 *   所以不能"按下老板键再临时拉起"，必须常驻一个进程待命。
 *
 * 通信方式：
 *   Node → 托盘：写命令文件（tray/cmd.txt），托盘每 250ms 轮询
 *   （不读 stdin，是因为消息循环里阻塞读管道会把图标卡死）
 *   托盘 → Node：stdout 逐行输出 open / quit / ready / state:hidden / state:visible
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./paths');

const TRAY_DIR = path.join(DATA_DIR, 'tray');

function scriptPath() {
  // 打包后在只读快照里，这里只为了读内容；实际执行的是释放到数据目录的副本
  return path.join(__dirname, 'tray.ps1');
}

class TrayIcon {
  constructor(opts = {}) {
    this.onEvent = opts.onEvent || (() => {});
    this.proc = null;
    this.ready = false;
    this.hidden = false;
    this.error = null;
    this.extraProc = opts.extraProc || '';   // 额外要一起隐藏的进程名（调试用）
    this.cmdFile = path.join(TRAY_DIR, 'cmd.txt');
  }

  /** 启动托盘；返回是否成功发起（就绪是异步的，通过 onEvent({type:'ready'}) 通知） */
  start() {
    if (process.platform !== 'win32') {
      this.error = '托盘图标仅支持 Windows';
      return false;
    }
    if (this.proc) return true;
    try {
      fs.mkdirSync(TRAY_DIR, { recursive: true });
      // 先清空命令文件：否则上一次退出时写的 quit 会被新进程当成新命令立刻执行
      try { fs.writeFileSync(this.cmdFile, '', 'utf8'); } catch (_) { /* noop */ }
      const ps1 = path.join(TRAY_DIR, 'tray.ps1');
      // 加 BOM：PowerShell 5.1 靠 BOM 识别 UTF-8，否则脚本里的中文会变乱码
      fs.writeFileSync(ps1, '\uFEFF' + fs.readFileSync(scriptPath(), 'utf8'), 'utf8');

      const args = [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', ps1,
        '-OwnerPid', String(process.pid),
        '-CmdFile', this.cmdFile,
        '-ExePath', process.execPath,
      ];
      if (this.extraProc) args.push('-ExtraProc', this.extraProc);
      const proc = spawn('powershell.exe', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.proc = proc;

      let buf = '';
      proc.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        let i = buf.indexOf('\n');
        while (i >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) this._onLine(line);
          i = buf.indexOf('\n');
        }
      });
      let errBuf = '';
      proc.stderr.on('data', (d) => {
        errBuf += d.toString('utf8');
        if (errBuf.length > 2000) errBuf = errBuf.slice(-2000);
      });
      proc.on('error', (err) => {
        this.error = err && err.message ? err.message : String(err);
        this.proc = null;
        this.ready = false;
      });
      proc.on('exit', (code) => {
        if (!this.error && errBuf.trim()) this.error = errBuf.trim().split('\n')[0].slice(0, 160);
        this.proc = null;
        this.ready = false;
        this.onEvent({ type: 'exit', code });
      });
      return true;
    } catch (err) {
      this.error = err && err.message ? err.message : String(err);
      return false;
    }
  }

  _onLine(line) {
    if (line === 'ready') {
      this.ready = true;
      this.onEvent({ type: 'ready' });
    } else if (line === 'open') {
      this.onEvent({ type: 'open' });
    } else if (line === 'quit') {
      this.onEvent({ type: 'quit' });
    } else if (line === 'owner-gone') {
      this.onEvent({ type: 'owner-gone' });
    } else if (line === 'state:hidden') {
      this.hidden = true;
      this.onEvent({ type: 'state', hidden: true });
    } else if (line === 'state:visible') {
      this.hidden = false;
      this.onEvent({ type: 'state', hidden: false });
    } else if (line.indexOf('err:') === 0) {
      this.error = line.slice(4);
      this.onEvent({ type: 'error', error: this.error });
    }
  }

  /** 写一条命令给托盘进程 */
  send(cmd) {
    try {
      fs.writeFileSync(this.cmdFile, cmd, 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 老板键：隐藏所有浏览器窗口 + NetWalk 自己的窗口 */
  hide() {
    if (!this.ready) return false;
    this.hidden = true;
    return this.send('hide');
  }

  /** 恢复刚才隐藏的窗口 */
  show() {
    if (!this.ready) return false;
    this.hidden = false;
    return this.send('show');
  }

  toggle() {
    if (!this.ready) return false;
    this.hidden = !this.hidden;
    return this.send(this.hidden ? 'hide' : 'show');
  }

  tip(text) {
    if (!this.ready) return false;
    return this.send('tip:' + String(text).slice(0, 200));
  }

  stop() {
    if (!this.proc) return;
    try { this.send('quit'); } catch (_) { /* noop */ }
    const p = this.proc;
    setTimeout(() => {
      try { if (p && !p.killed) p.kill(); } catch (_) { /* noop */ }
    }, 1200);
    this.proc = null;
    this.ready = false;
  }
}

module.exports = { TrayIcon, TRAY_DIR };
