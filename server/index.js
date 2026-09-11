/**
 * NetWalk 服务端
 * 职责：采集真实网速/击键 → WebSocket 推送；接收前端轨迹并落盘；生成日报。
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');

const { NetMonitor } = require('./netmon');
const { KeyMonitor } = require('./keymon');
const { TrackStore, todayStr } = require('./store');
const { AchievementStore } = require('./achievements');
const { exportArchive, importArchive } = require('./archive');
const mailbox = require('./mailbox');
const { staticMiddleware } = require('./static');
const { IS_PACKAGED, APP_ROOT, DATA_DIR, PUBLIC_DIR } = require('./paths');
const { ensurePublic } = require('./webassets');
const { TrayIcon } = require('./tray');
const { normalizeBoss } = require('./bosskey');
const { AccountStore } = require('./account');
const { sendArchiveMail, configured: mailConfigured } = require('./mailer');

// BASE_DATA = 根数据目录（账号列表、运行日志）；ACTIVE_DATA = 当前账号的数据目录
// 未登录账号时 ACTIVE_DATA === BASE_DATA（兼容老数据）
const BASE_DATA = DATA_DIR;
const accounts = new AccountStore(BASE_DATA);
let activeAccount = accounts.getActive();
const accountDir = activeAccount ? path.join(BASE_DATA, 'accounts', activeAccount.id) : null;
if (accountDir) fs.mkdirSync(accountDir, { recursive: true });
const ACTIVE_DATA = accountDir || BASE_DATA;

const PREFERRED_PORT = Number(process.env.NETWALK_PORT) || 8787;
// 端口被别的程序占了就顺延，最多试 9 个，避免"双击没反应直接退出"
const PORT_TRIES = 9;
let PORT = PREFERRED_PORT;
const CONFIG_FILE = path.join(ACTIVE_DATA, 'config.json');
// 测试时可关掉真实采集，避免拉起 PowerShell / 全局键盘钩子子进程
const NO_COLLECT = process.env.NETWALK_NO_COLLECT === '1';
// 打包运行时双击即用，启动后自动打开浏览器；设 NETWALK_NO_OPEN=1 可关闭
const NO_OPEN = process.env.NETWALK_NO_OPEN === '1';
// 托盘：打包默认开，源码模式默认关（NETWALK_TRAY=1 强制开，=0 强制关）
const TRAY_ON = process.platform === 'win32' && (
  process.env.NETWALK_TRAY === '1' || (IS_PACKAGED && process.env.NETWALK_TRAY !== '0')
);
const LOG_FILE = path.join(BASE_DATA, 'netwalk.log');

fs.mkdirSync(ACTIVE_DATA, { recursive: true });

// ---------- 运行日志 ----------
// 双击 exe 时可能连控制台都没有，出问题就全靠这份日志
function logLine(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch (_) { /* 只读盘也能跑 */ }
}

/** 弹一个系统提示框（Windows）；打包运行出错时用户至少能看到一句话 */
function alertBox(msg, title) {
  if (process.platform !== 'win32') return;
  const safe = String(msg).replace(/'/g, "''").replace(/[\r\n]+/g, ' ').slice(0, 600);
  const ps = `Add-Type -AssemblyName System.Windows.Forms;`
    + `[System.Windows.Forms.MessageBox]::Show('${safe}', '${String(title || 'NetWalk').replace(/'/g, "''")}') | Out-Null`;
  try {
    require('child_process').spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, stdio: 'ignore', detached: true }).unref();
  } catch (_) { /* 弹不出来就算了，日志里已经有了 */ }
}

process.on('uncaughtException', (err) => {
  logLine('[uncaughtException] ' + (err && err.stack ? err.stack : err));
  console.error('[netwalk] 未捕获异常：', err && err.message ? err.message : err);
});
process.on('unhandledRejection', (err) => {
  logLine('[unhandledRejection] ' + (err && err.stack ? err.stack : err));
});


const DEFAULT_CONFIG = {
  // 高德开放平台自行申请的 Web 端(JS API) Key；留空则进入「演练模式」
  amapKey: '',
  // 高德安全密钥（申请 Key 时一并下发，启用静态安全密钥时必填）
  amapSecurityJsCode: '',
  provider: 'amap',           // amap | drill（演练模式）
  scope: 'city',              // city | china | world
  city: '深圳',
  origin: { lng: 114.057868, lat: 22.543099 },
  // 出发点：originCustom=false 时用所选城市的市中心；true 时用 origin 里的坐标
  originCustom: false,
  originName: '',
  // 高德每日调用软上限（路径规划 + 逆地理）。个人认证开发者日配额 5000，
  // 留出余量，超限后引擎自动退化为直线推进，不影响玩法
  amapMaxCallsPerDay: 4000,
  // 老板键：一键把所有浏览器窗口和 NetWalk 自己的窗口藏起来，只在托盘留个图标
  boss: {
    enabled: true,
    key: 67,          // uiohook 键码，67 = F9
    mods: '',         // 修饰键：'' | 'ctrl,shift' | 'ctrl,alt' | 'shift'
  },
  // 邮件服务（可选）：配置后注册/登录/结束漫游会自动把最新存档码发到邮箱；
  // IMAP 配好后出发时还能自动从邮箱取回最新存档码（换设备免手动复制）
  mailSmtpHost: '', mailUser: '', mailPass: '',
  mailImapHost: '', mailImapPort: 993,
  // 速度换算参数
  speed: {
    netWeight: 0.6,           // 网速权重
    typeWeight: 0.4,          // 打字权重
    netFullMbps: 20,          // 达到该速率视为满负荷
    typeFullKpm: 300,         // 达到该击键速度视为满负荷
    walkMax: 6.5,             // 走路速度上限 km/h
    runMax: 16,               // 跑步速度上限 km/h
    idleSpeed: 1.2,           // 挂机保底速度 km/h（无流量时也在缓慢移动）
  },
};

// 机器级配置（所有档案共享）：高德 Key / 邮件服务 —— 绑定这台电脑，不跟账号走
const MACHINE_KEYS = ['amapKey', 'amapSecurityJsCode', 'mailSmtpHost', 'mailSmtpPort', 'mailUser', 'mailPass', 'mailFrom', 'mailImapHost', 'mailImapPort'];
const MACHINE_CONFIG_FILE = path.join(BASE_DATA, 'config.json');

function _readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (_) { return {}; }
}

function loadConfig() {
  // 机器级（Key/邮件）永远在根目录 config.json；档案级在账号目录
  const machine = _readJson(MACHINE_CONFIG_FILE);
  const local = _readJson(CONFIG_FILE);
  const merged = {
    ...DEFAULT_CONFIG,
    ...machine,
    ...local,
    speed: { ...DEFAULT_CONFIG.speed, ...(machine.speed || {}), ...(local.speed || {}) },
    origin: { ...DEFAULT_CONFIG.origin, ...(machine.origin || {}), ...(local.origin || {}) },
    boss: normalizeBoss({ ...DEFAULT_CONFIG.boss, ...(machine.boss || {}), ...(local.boss || {}) }),
  };
  // Key 类字段永远以机器级为准：换账号不丢 Key，也不会把 Key 复制进每个账号目录
  for (const k of MACHINE_KEYS) merged[k] = machine[k] || '';
  return merged;
}

function saveConfig(cfg) {
  // 机器级字段写回根目录 config.json
  const machine = _readJson(MACHINE_CONFIG_FILE);
  for (const k of MACHINE_KEYS) if (cfg[k] !== undefined) machine[k] = cfg[k];
  try {
    fs.mkdirSync(path.dirname(MACHINE_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(MACHINE_CONFIG_FILE, JSON.stringify(machine, null, 2), 'utf8');
  } catch (err) { console.error('[config] 机器级配置写入失败：', err.message); }
  // 档案级字段写进账号目录（剔除机器级字段，避免 Key 散落到各档案）
  const local = { ...cfg };
  for (const k of MACHINE_KEYS) delete local[k];
  delete local.mailConfigured;
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(local, null, 2), 'utf8');
  } catch (err) { console.error('[config] 档案配置写入失败：', err.message); }
}

let config = loadConfig();

const app = express();
app.use(express.json({ limit: '48mb' }));
// 打包运行时先把内嵌的前端资源释放到 exe 旁边，再挂静态中间件
const STATIC_DIR = ensurePublic() || PUBLIC_DIR;
app.use(staticMiddleware(STATIC_DIR));

const net = new NetMonitor({ intervalMs: 1000 });
const keys = new KeyMonitor();
const store = new TrackStore(ACTIVE_DATA);
const achStore = new AchievementStore(ACTIVE_DATA);

/** 把 range + date 解析成日期闭区间 */
function rangeToBounds(range, date) {
  const today = todayStr();
  if (range === 'day') {
    const d = date || today;
    return { from: d, to: d };
  }
  if (range === 'week') {
    // 本周：周一为起点（数据里没有记录的日子自然是空，聚合时自动跳过）
    const d = date ? new Date(date + 'T00:00:00') : new Date();
    const day = d.getDay() || 7;                       // 周日算第 7 天
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 1);
    const fmt = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    return { from: fmt(monday), to: today };
  }
  if (range === 'month') {
    const m = (date || today).slice(0, 7);
    return { from: `${m}-01`, to: `${m}-31` };
  }
  if (range === 'year') {
    const y = (date || today).slice(0, 4);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return {};
}

// ---------- 配置接口 ----------
/** 机器配置文本（Key / 安全密钥 / SMTP）—— 随存档码邮件发到用户邮箱，换设备时一键恢复 */
function machineConfigText(cfg) {
  const lines = [];
  if (cfg.amapKey) lines.push('amapKey=' + cfg.amapKey);
  if (cfg.amapSecurityJsCode) lines.push('amapSecurityJsCode=' + cfg.amapSecurityJsCode);
  if (cfg.mailSmtpHost) lines.push('mailSmtpHost=' + cfg.mailSmtpHost);
  if (cfg.mailSmtpPort) lines.push('mailSmtpPort=' + cfg.mailSmtpPort);
  if (cfg.mailUser) lines.push('mailUser=' + cfg.mailUser);
  if (cfg.mailPass) lines.push('mailPass=' + cfg.mailPass);
  if (cfg.mailImapHost) lines.push('mailImapHost=' + cfg.mailImapHost);
  if (cfg.mailImapPort) lines.push('mailImapPort=' + cfg.mailImapPort);
  return lines.join('\n');
}

/** 解析邮件正文里的配置区（与 machineConfigText 对应），返回键值对象 */
function parseMachineConfigText(text) {
  const out = {};
  const body = String(text || '');
  for (const line of body.split(/\r?\n/)) {
    const kv = line.match(/^(amapKey|amapSecurityJsCode|mailSmtpHost|mailSmtpPort|mailUser|mailPass|mailImapHost|mailImapPort)=(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

app.get('/api/config', (req, res) => {
  res.json({
    ...config,
    amapKey: config.amapKey ? '***configured***' : '',
    amapSecurityJsCode: config.amapSecurityJsCode ? '***configured***' : '',
    mailPass: config.mailPass ? '***configured***' : '',
    mailConfigured: Boolean(config.mailSmtpHost && config.mailUser && config.mailPass),
    mailImapConfigured: Boolean(config.mailImapHost && config.mailUser && config.mailPass),
    hasKey: Boolean(config.amapKey),
    keyMode: Boolean(config.amapKey) ? 'self' : 'none',
  });
});

/**
 * 地图 Key 下发接口
 * 仅允许本机访问：本服务只监听 127.0.0.1，且这里再做一层来源校验。
 * 提示：正式对外部署时应改为后端代理签名，不要明文下发 Key。
 */
app.get('/api/mapkey', (req, res) => {
  const ip = (req.ip || '').replace('::ffff:', '');
  const local = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '';
  if (!local) return res.status(403).json({ ok: false, error: '仅允许本机访问' });
  res.json({
    ok: true,
    key: config.amapKey || '',
    securityJsCode: config.amapSecurityJsCode || '',
    provider: config.provider,
  });
});

app.post('/api/config', (req, res) => {
  const body = req.body || {};
  if (typeof body.amapKey === 'string' && body.amapKey !== '***configured***') {
    config.amapKey = body.amapKey.trim();
  }
  if (typeof body.amapSecurityJsCode === 'string' && body.amapSecurityJsCode !== '***configured***') {
    config.amapSecurityJsCode = body.amapSecurityJsCode.trim();
  }
  if (body.provider === 'amap' || body.provider === 'drill') config.provider = body.provider;
  if (['city', 'china', 'world'].includes(body.scope)) config.scope = body.scope;
  if (typeof body.city === 'string' && body.city.trim()) config.city = body.city.trim();
  if (body.origin && Number.isFinite(body.origin.lng) && Number.isFinite(body.origin.lat)) {
    // 经纬度范围校验，避免写入一个地球以外的坐标
    const lng = Math.max(-180, Math.min(180, Number(body.origin.lng)));
    const lat = Math.max(-85, Math.min(85, Number(body.origin.lat)));
    config.origin = { lng, lat };
  }
  if (typeof body.originName === 'string') config.originName = body.originName.trim().slice(0, 60);
  if (typeof body.originCustom === 'boolean') config.originCustom = body.originCustom;
  if (Number.isFinite(Number(body.amapMaxCallsPerDay))) {
    config.amapMaxCallsPerDay = Math.max(100, Math.min(100000, Math.round(Number(body.amapMaxCallsPerDay))));
  }
  if (body.speed && typeof body.speed === 'object') {
    config.speed = { ...config.speed, ...body.speed };
  }
  if (body.boss && typeof body.boss === 'object') config.boss = normalizeBoss(body.boss);
  // 邮件服务（可选）：配置后注册/登录会自动把最新存档码发到邮箱
  for (const k of ['mailSmtpHost', 'mailSmtpPort', 'mailUser', 'mailPass', 'mailFrom', 'mailImapHost', 'mailImapPort']) {
    if (typeof body[k] === 'string') config[k] = body[k].trim();
  }
  saveConfig(config);
  res.json({ ok: true, hasKey: Boolean(config.amapKey) });
});

// ---------- 版本信息 ----------
const { VERSION, CHANGELOG } = require('./version');

app.get('/api/version', (req, res) => {
  res.json({ ok: true, version: VERSION, changelog: CHANGELOG });
});

// ---------- 账号（单机多档案） ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.get('/api/account', (req, res) => {
  res.json({
    ok: true,
    current: activeAccount,                    // null = 未登录（用默认档案）
    mailConfigured: Boolean(config.mailSmtpHost),
    total: accounts.list().length,
  });
});

/** 获取验证码：配置了邮件服务就发信，否则本机直显（本地单机无泄露风险） */
app.post('/api/account/code', (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: '邮箱格式不正确' });
  const code = accounts.issueCode(email);
  logLine(`account code issued for ${accounts.maskEmail(email)}`);
  if (config.mailSmtpHost && config.mailUser && config.mailPass) {
    // 预留：配好 SMTP 后在这里发信（nodemailer），本轮先直显
    res.json({ ok: true, sent: true });
  } else {
    res.json({ ok: true, sent: false, devCode: code, hint: '未配置邮件服务，验证码直接显示（仅本机可见）' });
  }
});

app.post('/api/account/register', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: '邮箱格式不正确' });
  const v = accounts.verifyCode(email, b.code);
  if (!v.ok) return res.status(400).json(v);
  if (accounts.findByEmail(email)) return res.status(400).json({ ok: false, error: '该邮箱已注册，请直接登录' });
  const acc = accounts.create(email, b.name);
  accounts.setActive(acc);
  activeAccount = acc;   // 同步内存态：重启前的 rename/reset 也能识别
  // 存档码自动发到邮箱（配置了邮件服务才有；换设备时从邮箱复制即可接着走）
  if (mailConfigured(config)) {
    const code = exportArchive(store, achStore).code;
    sendArchiveMail(config, acc.email, code, logLine, machineConfigText(config));
  }
  res.json({ ok: true, account: acc, needRestart: true });
});

app.post('/api/account/login', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim();
  const acc = accounts.findByEmail(email);
  if (!acc) return res.status(400).json({ ok: false, error: '该邮箱尚未注册' });
  const v = accounts.verifyCode(email, b.code);
  if (!v.ok) return res.status(400).json(v);
  accounts.setActive(acc);
  activeAccount = acc;   // 同步内存态
  // 登录也发一份最新存档码到邮箱：换设备时打开邮箱复制即可接着走
  if (mailConfigured(config)) {
    const code = exportArchive(store, achStore).code;
    sendArchiveMail(config, acc.email, code, logLine, machineConfigText(config));
  }
  res.json({ ok: true, account: acc, needRestart: true });
});

app.post('/api/account/logout', (req, res) => {
  accounts.clearActive();
  res.json({ ok: true, needRestart: true });
});

app.post('/api/account/rename', (req, res) => {
  if (!activeAccount) return res.status(400).json({ ok: false, error: '未登录账号' });
  const acc = accounts.rename(activeAccount.id, (req.body && req.body.name) || '');
  if (!acc) return res.status(404).json({ ok: false, error: '账号不存在' });
  activeAccount = acc;
  accounts.setActive(acc);
  res.json({ ok: true, account: acc });
});

/**
 * 重置：清空当前账号的全部漫游数据与成就（出发点回到城市中心）
 * 必须输入 confirmText === '重置'，明确知道后果才会执行
 */
app.post('/api/account/reset', (req, res) => {
  if (!activeAccount) return res.status(400).json({ ok: false, error: '未登录账号' });
  if (String((req.body && req.body.confirmText) || '').trim() !== '重置') {
    return res.status(400).json({ ok: false, error: '请输入「重置」两个字确认' });
  }
  store.forgetAll();          // 先丢内存缓存，防止 8 秒 flush 把旧数据写回去
  logLine(`reset diag: pid=${process.pid} cache=${store.cache.size} dirty=${store.dirty.size}`);
  let removed = 0;
  try {
    // 注意：本机 fs.rmSync 被回收站 shim 重定向（可能删不干净），所以用「覆写清空」而不是删除
    const tracksDir = path.join(ACTIVE_DATA, 'tracks');
    if (fs.existsSync(tracksDir)) {
      for (const f of fs.readdirSync(tracksDir)) {
        if (!f.endsWith('.json')) continue;
        const date = f.replace('.json', '');
        fs.writeFileSync(path.join(tracksDir, f), JSON.stringify({
          date, startedAt: Date.now(), endedAt: null, city: '', path: [], samples: [], rolls: [], stats: null,
        }), 'utf8');
        removed++;
      }
    }
    achStore.forgetAll();   // 内存里的解锁记录也要清，否则 shutdown/save 会写回
    removed++;
    // 出发点回到城市中心
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg.originCustom = false;
      cfg.originName = '';
      cfg.origin = { lng: DEFAULT_CONFIG.origin.lng, lat: DEFAULT_CONFIG.origin.lat };
      saveConfig(cfg);
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
  logLine(`account reset done: pid=${process.pid} cleared=${removed} cacheNow=${store.cache.size}`);
  // 必须重启：运行中的 dayTotals 每秒都会重建当天数据，8 秒后又会写回磁盘
  res.json({ ok: true, removed, needRestart: true, note: '轨迹与成就已清空，出发点已回到城市中心，正在重启服务…' });
});

/** 切换账号 / 登出后需要重启服务让新的数据目录生效 */
app.post('/api/restart', (req, res) => {
  // 切换账号后拉起一个全新的自己（active.json 已更新，新进程会读到新账号的数据目录）。
  // 失败时绝不能把自己退掉 —— 宁可提示用户手动重启，也不能让服务凭空消失。
  let spawned = false;
  let spawnErr = '';
  if (process.argv[1]) {
    const { spawn } = require('child_process');
    try {
      spawn(process.execPath, [process.argv[1]], { env: process.env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      spawned = true;
    } catch (err) { spawnErr = err && err.message ? err.message : String(err); }
    if (!spawned) {
      // 打包 exe 自 spawn 被拦截（EACCES）时，退化为「等同双击」的 cmd start
      try {
        spawn('cmd.exe', ['/c', 'start', '', process.execPath], { env: process.env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
        spawned = true;
      } catch (err2) { spawnErr += ' / ' + (err2 && err2.message ? err2.message : String(err2)); }
    }
  }
  logLine('restart: spawned=' + spawned + (spawnErr ? ' err=' + spawnErr : ''));
  res.json({ ok: true, restarted: spawned, note: spawned ? '服务正在重启…' : '自动重启失败，请手动关闭后重新双击 NetWalk.exe（数据已保存）' });
  if (spawned) setTimeout(() => { try { shutdown(); } catch (_) { process.exit(0); } }, 600);
});

// ---------- 托盘 / 老板键 ----------
/** 把老板键配置传给采集子进程（改设置后会重启子进程生效） */
function bossEnv() {
  return {
    NETWALK_BOSS_ENABLED: config.boss.enabled ? '1' : '0',
    NETWALK_BOSS_KEY: String(config.boss.key),
    NETWALK_BOSS_MODS: config.boss.mods || '',
  };
}

const tray = TRAY_ON ? new TrayIcon({ onEvent: onTrayEvent }) : null;

app.get('/api/boss', (req, res) => {
  res.json({
    ok: true,
    supported: Boolean(tray),
    available: Boolean(tray && tray.ready),
    error: tray ? tray.error : null,
    hidden: Boolean(tray && tray.hidden),
    ...config.boss,
  });
});

app.post('/api/boss', async (req, res) => {
  const body = req.body || {};
  if (typeof body.enabled === 'boolean') config.boss.enabled = body.enabled;
  if (Number.isFinite(Number(body.key))) config.boss.key = Math.max(1, Math.round(Number(body.key)));
  if (typeof body.mods === 'string') config.boss.mods = body.mods;
  saveConfig(config);

  const action = String(body.action || '');
  if (action === 'hide' || action === 'show' || action === 'toggle') toggleBoss(action);
  // 键位/开关变了要重启击键采集子进程才能生效（不重启整个程序）
  if (typeof body.enabled === 'boolean' || body.key !== undefined || body.mods !== undefined) {
    if (!NO_COLLECT) keys.restart(bossEnv()).catch(() => { /* 起不来也不影响主服务 */ });
  }
  res.json({
    ok: true,
    available: Boolean(tray && tray.ready),
    hidden: Boolean(tray && tray.hidden),
    ...config.boss,
  });
});

function onTrayEvent(ev) {
  if (ev.type === 'ready') {
    logLine('tray ready');
    console.log('  [托盘] 任务栏右下角已显示图标（双击打开面板，右键可退出）');
  } else if (ev.type === 'open') {
    openBrowser(`http://127.0.0.1:${PORT}`);
  } else if (ev.type === 'quit') {
    logLine('tray request quit');
    shutdown();
  } else if (ev.type === 'state') {
    logLine('tray state hidden=' + ev.hidden);
  } else if (ev.type === 'exit') {
    logLine('tray exit code=' + ev.code);
  } else if (ev.type === 'error') {
    logLine('tray error: ' + ev.error);
  }
}

/** 老板键：隐藏 / 恢复窗口 */
function toggleBoss(action) {
  if (!tray || !tray.ready) return false;
  if (action === 'hide') tray.hide();
  else if (action === 'show') tray.show();
  else tray.toggle();
  return true;
}

// ---------- 采集上报 ----------
app.get('/api/status', (req, res) => {
  res.json({
    net: net.snapshot(),
    key: keys.snapshot(),
    totals: currentTotals(),
    config: { city: config.city, scope: config.scope },
  });
});

app.post('/api/key', (req, res) => {
  const raw = Number(req.body && req.body.count);
  const n = Number.isFinite(raw) ? Math.max(1, Math.min(500, Math.round(raw))) : 1;
  const now = Date.now();
  if (n === 1) {
    keys.push(now);
  } else {
    // 批量上报时把时间戳均匀摊到窗口内，避免 KPM 失真
    const span = 1000;
    for (let i = 0; i < n; i++) keys.push(now - span + Math.round((span * (i + 1)) / n));
  }
  res.json({ ok: true, kpm: keys.rate().kpm });
});

app.post('/api/track/path', (req, res) => {
  const date = (req.body && req.body.date) || todayStr();
  const n = store.appendPath(date, (req.body && req.body.points) || []);
  res.json({ ok: true, total: n });
});

app.post('/api/track/sample', (req, res) => {
  const date = (req.body && req.body.date) || todayStr();
  store.appendSample(date, (req.body && req.body.sample) || req.body || {});
  res.json({ ok: true });
});

app.post('/api/track/roll', (req, res) => {
  const date = (req.body && req.body.date) || todayStr();
  store.appendRoll(date, req.body || {});
  res.json({ ok: true });
});

app.post('/api/session/start', (req, res) => {
  const body = req.body || {};
  const date = body.date || todayStr();
  store.setContext(date, { city: body.city, scope: body.scope });
  // 记录本次出发的起点 + 全局序号（主地图紫点显示「第 N 次出发」）
  let n = null;
  if (Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
    try { n = store.addSessionStart(date, body.lat, body.lng); } catch (_) { /* 记录失败不影响出发 */ }
  }
  res.json({ ok: true, sessionNo: n });
});

/** 全部出发点（跨天），主地图/轨迹回看画紫点用 */
app.get('/api/sessions', (req, res) => {
  res.json({ ok: true, starts: store.allSessionStarts() });
});

app.post('/api/session/end', (req, res) => {
  const body = req.body || {};
  const date = body.date || todayStr();
  if (body.city || body.scope) store.setContext(date, { city: body.city, scope: body.scope });
  const data = store.finish(date, body.stats || null);
  // 结束后立即结算成就
  const agg = store.aggregate();
  const st = achStore.refresh(agg);
  // 结束也把最新存档码发到邮箱（配置了邮件服务才有）：换设备打开邮箱复制即可接着走
  try {
    if (mailConfigured(config)) {
      const acc = (typeof accounts.current === 'function' && accounts.current()) || activeAccount || null;
      const to = (acc && acc.email) || config.mailUser;
      if (to) {
        const { code } = exportArchive(store, achStore);
        sendArchiveMail(config, to, code, logLine, machineConfigText(config));
      }
    }
  } catch (_) { /* 邮件失败不影响结束 */ }
  res.json({ ok: true, date, stats: data.stats, achievements: st });
});

// ---------- 成就 ----------
app.get('/api/achievements', (req, res) => {
  const agg = store.aggregate(rangeToBounds('all'));
  const st = achStore.refresh(agg);
  res.json({ ok: true, ...st, agg });
});

// ---------- 旅行者档案 ----------
const profileMod = require('./profile');
const CITIES_COORDS = require('./cities');

app.get('/api/profile', (req, res) => {
  const p = profileMod.load();
  if (!p) return res.json({ ok: true, exists: false });
  res.json({
    ok: true, exists: true,
    name: p.name, emailMasked: profileMod.maskEmail(p.email),
    city: p.city, origin: p.origin, originName: p.originName,
    createdAt: p.createdAt,
  });
});

app.post('/api/profile/sendcode', (req, res) => {
  const r = profileMod.sendCode((req.body || {}).email);
  res.json({ ok: r.ok, ...r });
});

app.post('/api/profile/register', (req, res) => {
  const b = req.body || {};
  if (profileMod.exists()) {
    return res.status(400).json({ ok: false, error: '档案已存在；如需重新注册请使用「重置」' });
  }
  if (!profileMod.verifyCode(b.email, b.code)) {
    return res.status(400).json({ ok: false, error: '验证码不对或已过期' });
  }
  const city = String(b.city || '深圳');
  const origin = (b.origin && Number.isFinite(b.origin.lng)) ? b.origin : (CITIES_COORDS[city] || CITIES_COORDS['深圳']);
  const p = profileMod.register({ name: b.name, email: b.email, city, origin, originName: city });
  logLine(`profile registered: ${p.name} <${p.email}> origin=${city}`);
  res.json({ ok: true, profile: { name: p.name, emailMasked: profileMod.maskEmail(p.email), city: p.city } });
});

app.post('/api/profile/reset', (req, res) => {
  const b = req.body || {};
  const confirm = String(b.confirm || '').trim();
  if (confirm !== profileMod.RESET_PHRASE) {
    return res.status(400).json({ ok: false, error: '确认文字不匹配，重置已取消' });
  }
  // 顺序很重要：先清内存缓存（防止 flush 把删掉的文件写回去），再删文件
  store.forgetAll();
  achStore.forgetAll();
  const p = profileMod.resetAll({
    name: (profileMod.load() || {}).name,
    city: String(b.city || ''),
    origin: b.origin,
    originName: b.originName || b.city || '',
  });
  const agg = store.aggregate(rangeToBounds('all'));
  achStore.refresh(agg);
  logLine('profile & data RESET by user confirm');
  res.json({ ok: true, profile: p ? { name: p.name, city: p.city } : null });
});

/** 最近一次走过的位置（跨天也从此处继续，而不是回到出发点） */
app.get('/api/lastpos', (req, res) => {
  const dates = store.listDates().sort().reverse();
  for (const d of dates.slice(0, 90)) {
    const path = (store.get(d) || {}).path || [];
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
        return res.json({ ok: true, date: d, lat: p.lat, lng: p.lng, road: p.road || '' });
      }
    }
  }
  res.json({ ok: true, pos: null });
});

// 回看任意时间段（含单日）的轨迹：from/to 为 YYYY-MM-DD，闭区间
app.get('/api/track/range', (req, res) => {
  const to = String(req.query.to || req.query.date || todayStr()).slice(0, 10);
  const from = String(req.query.from || to).slice(0, 10);
  const days = [];
  for (const d of store.listDates().sort()) {
    if (d < from || d > to) continue;
    const data = store.get(d);
    if (!data || (!(data.path || []).length && !(data.sessions || []).length)) continue;
    days.push({ date: d, count: (data.path || []).length, path: data.path || [], sessions: data.sessions || [] });
  }
  res.json({ ok: true, from, to, days, starts: store.allSessionStarts().filter((x) => x.date >= from && x.date <= to), total: days.reduce((n, x) => n + x.count, 0) });
});

// 从邮箱拉回最新存档码（出发前调用；配置了 IMAP 才可用）
// 拿到后直接幂等导入（importArchive 按时间戳去重，重复导入不产生重复轨迹），
// 保证「从上次结束点继续」跨设备成立；同时解析邮件里的配置区返回给前端（一键恢复 Key/SMTP）
app.post('/api/mailbox/pull', (req, res) => {
  mailbox.fetchLatestArchiveCode(config, logLine).then((r) => {
    if (!r.ok) return res.json({ ok: false, error: r.error });
    const imp = importArchive(r.code, store, achStore);
    const cloudConfig = r.mailText ? parseMachineConfigText(r.mailText) : {};
    res.json({ ok: Boolean(imp && imp.ok), result: imp, cloudConfig });
  }).catch((e) => res.json({ ok: false, error: e && e.message ? e.message : String(e) }));
});

// 从邮箱恢复机器配置（Key / 安全密钥 / SMTP / IMAP）：换设备登录后点一次即全部恢复
app.post('/api/mailbox/restore-config', (req, res) => {
  mailbox.fetchLatestArchiveCode(config, logLine).then((r) => {
    if (!r.ok) return res.json({ ok: false, error: r.error });
    const cloud = parseMachineConfigText(r.mailText);
    if (!Object.keys(cloud).length) return res.json({ ok: false, error: '邮箱里这封存档邮件不含配置信息（可能是旧版本发出的）' });
    // 应用并落盘（mailPass 也一起恢复，这样新设备连授权码都不用重填）
    for (const k of ['amapKey', 'amapSecurityJsCode', 'mailSmtpHost', 'mailSmtpPort', 'mailUser', 'mailPass', 'mailImapHost', 'mailImapPort']) {
      if (cloud[k] !== undefined && cloud[k] !== '') config[k] = cloud[k];
    }
    saveConfig(config);
    logLine('machine config restored from mailbox: key=' + Boolean(cloud.amapKey) + ' smtp=' + Boolean(cloud.mailSmtpHost));
    res.json({ ok: true, restored: Object.keys(cloud), hasKey: Boolean(config.amapKey) });
  }).catch((e) => res.json({ ok: false, error: e && e.message ? e.message : String(e) }));
});

app.post('/api/achievements/refresh', (req, res) => {
  const agg = store.aggregate(rangeToBounds('all'));
  const st = achStore.refresh(agg);
  res.json({ ok: true, ...st, agg });
});

// ---------- 轨迹读取 ----------
app.get('/api/days', (req, res) => {
  res.json({ days: store.listDates() });
});

app.get('/api/day/:date', (req, res) => {
  const data = store.get(req.params.date);
  // 附带今日已走过的路名集合，供前端「不走重复路」使用
  const roads = [...new Set((data.path || []).map((p) => (p.road || '').trim()).filter(Boolean))];
  res.json({ ...data, visitedRoads: roads });
});

// ---------- 日 / 月 / 年 统计 ----------
app.get('/api/stats', (req, res) => {
  const range = String(req.query.range || 'day');
  const bounds = rangeToBounds(range, req.query.date ? String(req.query.date) : '');
  const agg = store.aggregate(bounds);
  res.json({ ok: true, range, from: agg.from, to: agg.to, agg: { ...agg, roads: undefined } });
});

// ---------- 存档码 ----------
app.post('/api/archive/export', (req, res) => {
  try {
    const r = exportArchive(store, achStore);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/archive/import', (req, res) => {
  try {
    const code = (req.body && req.body.code) || '';
    const r = importArchive(code, store, achStore);
    const agg = store.aggregate();
    const st = achStore.refresh(agg);
    res.json({ ok: true, ...r, days: store.listDates().length, achievements: st });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---------- 日报生成 ----------
const { buildReportHtml } = require('./report');

app.post('/api/report/:date', (req, res) => {
  const date = req.params.date;
  const data = store.get(date);
  if (!data || data.path.length === 0) {
    return res.status(400).json({ ok: false, error: '当天没有轨迹数据' });
  }
  const html = buildReportHtml(data, config);
  const outDir = path.join(ACTIVE_DATA, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `netwalk-${date}.html`);
  fs.writeFileSync(outFile, html, 'utf8');
  res.json({ ok: true, url: `/reports/netwalk-${date}.html`, file: outFile });
});

app.use('/reports', express.static(path.join(ACTIVE_DATA, 'reports')));

// ---------- 按天累计（下载/上传/击键）----------
const dayTotals = { lastKeyTotal: 0 };

setInterval(() => {
  const date = todayStr();
  const d = store.load(date);
  if (!d.totals) d.totals = { rx: 0, tx: 0, keys: 0 };
  d.totals.rx += Math.max(0, net.rx);
  d.totals.tx += Math.max(0, net.tx);
  const kt = keys.snapshot().total;
  if (kt > dayTotals.lastKeyTotal) d.totals.keys += kt - dayTotals.lastKeyTotal;
  dayTotals.lastKeyTotal = kt;
  store.markDirty(date);
}, 1000).unref();

function currentTotals() {
  const d = store.load(todayStr());
  return d.totals || { rx: 0, tx: 0, keys: 0 };
}

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
// ws 会把底层 server 的 error 转发到 wss 上；wss 没有 error 监听器时，
// 这个错误会变成未捕获异常并中断事件派发，导致下面 server.on('error') 的
// 端口占用处理（顺延 / 复用已有实例）永远不执行。这里必须先吃掉它。
wss.on('error', (err) => {
  logLine('ws error: ' + (err && err.message ? err.message : err));
});

wss.on('connection', (ws) => {
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    try { ws.ping(); } catch (_) { /* 忽略 */ }
  }, 15000);

  const send = () => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      type: 'tick',
      ts: Date.now(),
      net: net.snapshot(),
      key: keys.snapshot(),
      totals: currentTotals(),
      boss: { available: Boolean(tray && tray.ready), hidden: Boolean(tray && tray.hidden) },
    }));
  };
  send();
  const timer = setInterval(send, 1000);

  ws.on('close', () => {
    clearInterval(timer);
    clearInterval(ping);
  });
  ws.on('error', () => {
    clearInterval(timer);
    clearInterval(ping);
  });
});

// ---------- 启动 ----------
/** 用系统默认浏览器打开页面（打包运行时双击即用） */
function openBrowser(url) {
  try {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** 端口被占用时给出可执行的提示，而不是丢一段堆栈 */
function explainListenError(err) {
  console.error('');
  console.error(`  [!] 端口 ${PORT} 启动失败：${err && err.code ? err.code + ' · ' : ''}${err && err.message ? err.message : err}`);
  console.error(`      详细日志：${LOG_FILE}`);
  console.error('');
}

/** 探测某个端口上是不是已经跑着一个 NetWalk */
function probeNetWalk(port) {
  return new Promise((resolve) => {
    let req;
    try {
      req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1500 }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          let ok = false;
          try { ok = Boolean(JSON.parse(body).net); } catch (_) { ok = false; }
          resolve(ok);
        });
      });
    } catch (_) {
      return resolve(false);
    }
    req.on('timeout', () => { try { req.destroy(); } catch (_) { /* noop */ } resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function main() {
  logLine(`--- start port=${PREFERRED_PORT} packaged=${IS_PACKAGED} node=${process.version} data=${ACTIVE_DATA}`);

  // 托盘先起来：双击 exe 后即使服务还没就绪，任务栏也有个图标，不至于"没反应"
  if (tray) tray.start();

  if (!NO_COLLECT) {
    net.start();
    // 网络采集就绪较慢（PowerShell 冷启动 6~10 秒），就绪后异步补一行日志
    let netLogged = false;
    const netTimer = setInterval(() => {
      if (net.available && !netLogged) {
        netLogged = true;
        clearInterval(netTimer);
        console.log(`  [网络采集] 已就绪（${net.source} · ${net.iface || '-'}）`);
      }
    }, 1000);
    setTimeout(() => clearInterval(netTimer), 40000);
  }

  // 击键采集异步就绪：打包后子进程首启要解压快照、可能被杀毒首扫（10s+），
  // 不能阻塞 HTTP 服务启动。就绪后再往控制台补一行最终状态。
  let keyMode = NO_COLLECT ? 'none' : 'connecting';
  if (!NO_COLLECT) {
    keys.on('boss', () => {
      if (!config.boss.enabled) return;
      if (!toggleBoss('toggle')) logLine('boss key pressed but tray not ready');
    });
    keys.start(bossEnv()).then((m) => {
      keyMode = m;
      if (m === 'global') console.log('  [击键采集] 系统级全局钩子已就绪');
      else console.log(`  [击键采集] 已降级为浏览器窗口内上报${keys.error ? '（' + String(keys.error).split('\n')[0].slice(0, 80) + '）' : ''}`);
    }).catch(() => { keyMode = 'remote'; });
  }

  const onListening = () => {
    if (listening) return;   // 端口冲突时回调可能被触发两次
    listening = true;
    const url = `http://127.0.0.1:${PORT}`;
    const keyLabel = NO_COLLECT ? '已禁用(测试)'
      : keyMode === 'global' ? '系统级全局钩子'
        : keyMode === 'connecting' ? '连接中（首启最长约 20 秒，就绪后会再提示）'
          : '仅浏览器窗口内';
    const netLabel = NO_COLLECT ? '已禁用(测试)'
      : net.available ? '可用' : '启动中（就绪后会再提示）';
    console.log('');
    console.log('  NetWalk 已启动');
    console.log(`  地图/HUD  : ${url}`);
    console.log(`  独立 DOCK : ${url}/dock.html`);
    console.log(`  数据目录  : ${ACTIVE_DATA}`);
    console.log(`  网络采集  : ${netLabel} (${net.iface || '-'})`);
    console.log(`  击键采集  : ${keyLabel}`);
    console.log(`  老板键    : ${config.boss.enabled ? BOSS_LABEL(config.boss) + '（托盘图标' + (tray ? '已启用' : '未启用') + '）' : '已关闭'}`);
    console.log(`  地图模式  : ${config.amapKey ? '高德真实路网' : '演练模式（未配置高德 Key）'}`);
    if (PORT !== PREFERRED_PORT) console.log(`  [i] ${PREFERRED_PORT} 被别的程序占用，已自动改用 ${PORT}`);
    if (IS_PACKAGED) console.log(`  程序目录  : ${APP_ROOT}`);
    console.log('');
    logLine(`listening on ${PORT}`);
    if (!NO_OPEN && (IS_PACKAGED || process.env.NETWALK_OPEN === '1')) {
      if (openBrowser(url)) console.log('  已为你打开浏览器；要在后台继续跑，右键托盘图标退出。\n');
      else {
        console.log('  自动打开浏览器失败，请手动访问上面的地址。\n');
        if (tray) tray.tip(`NetWalk 已启动：${url}`);
      }
    }
  };

  // Windows 上端口冲突时 error 事件可能连着来两次，加个闸门避免重复顺延
  let handling = false;
  let listening = false;

  server.on('error', (err) => {
    if (listening) { logLine('late error after listening: ' + (err && err.code)); return; }
    if (handling) return;
    // 端口被占：先看是不是已经有一个 NetWalk 在跑，是就直接打开它，
    // 否则顺延到下一个端口，绝不"双击一下就没了"
    if (err && err.code === 'EADDRINUSE' && PORT < PREFERRED_PORT + PORT_TRIES) {
      handling = true;
      const busyPort = PORT;
      probeNetWalk(busyPort).then((isSelf) => {
        if (isSelf) {
          const url = `http://127.0.0.1:${busyPort}`;
          console.log('');
          console.log(`  NetWalk 已经在运行：${url}`);
          console.log('  已帮你打开现有的窗口，本窗口即将关闭。');
          console.log('');
          logLine(`already running at ${busyPort}`);
          openBrowser(url);
          setTimeout(() => process.exit(0), 1500);
          return;
        }
        PORT += 1;
        logLine(`port ${busyPort} busy by other program, retry ${PORT}`);
        setTimeout(() => server.listen(PORT, '127.0.0.1', onListening), 200);
      });
      return;
    }
    explainListenError(err);
    logLine('listen failed: ' + (err && err.message ? err.message : err));
    if (IS_PACKAGED) alertBox(`NetWalk 启动失败：${err && err.message ? err.message : err}\n\n详细日志：${LOG_FILE}`);
    process.exit(1);
  });

  server.listen(PORT, "127.0.0.1", onListening);
}

/** 把老板键配置显示成人话 */
function BOSS_LABEL(b) {
  const names = { 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12', 35: 'H', 49: 'N', 1: 'Esc' };
  const k = names[Number(b.key)] || ('键码' + b.key);
  const mods = String(b.mods || '').split(',').filter(Boolean).map((m) => (m === 'ctrl' ? 'Ctrl' : m === 'shift' ? 'Shift' : m === 'alt' ? 'Alt' : 'Win')).join('+');
  return mods ? `${mods}+${k}` : k;
}

let _shuttingDown = false;
function shutdown() {
  if (_shuttingDown) return;   // 防重复触发
  _shuttingDown = true;
  console.log('\n[netwalk] 正在保存并退出...');
  logLine('shutdown');
  if (tray) tray.stop();
  try { keys.stop(); } catch (_) { /* noop */ }
  net.stop();
  store.dispose();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 打包运行时双击启动，出错后窗口会瞬间关掉、用户什么都看不到，
// 所以失败时挂住等一次回车。
function holdConsoleOpen() {
  if (!IS_PACKAGED || process.env.NETWALK_NO_HOLD === '1') return;
  try {
    process.stdin.resume();
    console.log('  按回车键关闭此窗口…');
    process.stdin.once('data', () => process.exit(1));
    setTimeout(() => process.exit(1), 60000);
  } catch (_) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[netwalk] 启动失败', err);
  logLine('main failed: ' + (err && err.stack ? err.stack : err));
  if (IS_PACKAGED) alertBox(`NetWalk 启动失败：${err && err.message ? err.message : err}\n\n详细日志：${LOG_FILE}`);
  holdConsoleOpen();
});

