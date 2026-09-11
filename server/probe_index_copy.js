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
const { staticMiddleware } = require('./static');
const { IS_PACKAGED, APP_ROOT, DATA_DIR, PUBLIC_DIR } = require('./paths');

const PORT = Number(process.env.NETWALK_PORT) || 8787;
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
// 测试时可关掉真实采集，避免拉起 PowerShell / 全局键盘钩子子进程
const NO_COLLECT = process.env.NETWALK_NO_COLLECT === '1';
// 打包运行时双击即用，启动后自动打开浏览器；设 NETWALK_NO_OPEN=1 可关闭
const NO_OPEN = process.env.NETWALK_NO_OPEN === '1';

fs.mkdirSync(DATA_DIR, { recursive: true });


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

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        ...DEFAULT_CONFIG,
        ...raw,
        speed: { ...DEFAULT_CONFIG.speed, ...(raw.speed || {}) },
        origin: { ...DEFAULT_CONFIG.origin, ...(raw.origin || {}) },
      };
    }
  } catch (err) {
    console.error('[config] 读取失败，使用默认配置：', err.message);
  }
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

let config = loadConfig();

const app = express();
app.use(express.json({ limit: '48mb' }));
app.use(staticMiddleware(PUBLIC_DIR));

const net = new NetMonitor({ intervalMs: 1000 });
const keys = new KeyMonitor();
const store = new TrackStore(DATA_DIR);
const achStore = new AchievementStore(DATA_DIR);

/** 把 range + date 解析成日期闭区间 */
function rangeToBounds(range, date) {
  const today = todayStr();
  if (range === 'day') {
    const d = date || today;
    return { from: d, to: d };
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
app.get('/api/config', (req, res) => {
  res.json({
    ...config,
    amapKey: config.amapKey ? '***configured***' : '',
    amapSecurityJsCode: config.amapSecurityJsCode ? '***configured***' : '',
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
  saveConfig(config);
  res.json({ ok: true, hasKey: Boolean(config.amapKey) });
});

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
  res.json({ ok: true });
});

app.post('/api/session/end', (req, res) => {
  const body = req.body || {};
  const date = body.date || todayStr();
  if (body.city || body.scope) store.setContext(date, { city: body.city, scope: body.scope });
  const data = store.finish(date, body.stats || null);
  // 结束后立即结算成就
  const agg = store.aggregate();
  const st = achStore.refresh(agg);
  res.json({ ok: true, date, stats: data.stats, achievements: st });
});

// ---------- 成就 ----------
app.get('/api/achievements', (req, res) => {
  const agg = store.aggregate(rangeToBounds('all'));
  const st = achStore.refresh(agg);
  res.json({ ok: true, ...st, agg });
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
  const outDir = path.join(DATA_DIR, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `netwalk-${date}.html`);
  fs.writeFileSync(outFile, html, 'utf8');
  res.json({ ok: true, url: `/reports/netwalk-${date}.html`, file: outFile });
});

app.use('/reports', express.static(path.join(DATA_DIR, 'reports')));

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
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  [!] 端口 ${PORT} 已被占用`);
    console.error('      可能 NetWalk 已经在运行，或者别的程序占用了这个端口。');
    console.error('      处理办法：');
    console.error('        1) 先看看任务栏/浏览器里是不是已经开着一个 NetWalk');
    console.error(`        2) 想同时开第二个实例，就先设置环境变量 NETWALK_PORT=8788 再启动`);
    console.error('');
  } else {
    console.error('');
    console.error('  [!] 启动失败：' + (err && err.message ? err.message : err));
    console.error('');
  }
}

async function main() {
  if (!NO_COLLECT) net.start();
  const mode = NO_COLLECT ? 'none' : await keys.start();

  server.on('error', (err) => {
    explainListenError(err);
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log('');
    console.log('  NetWalk 已启动');
    console.log(`  地图/HUD  : ${url}`);
    console.log(`  独立 DOCK : ${url}/dock.html`);
    console.log(`  数据目录  : ${DATA_DIR}`);
    console.log(`  网络采集  : ${NO_COLLECT ? '已禁用(测试)' : net.available ? '可用' : '不可用'} (${net.iface || '-'})`);
    console.log(`  击键采集  : ${NO_COLLECT ? '已禁用(测试)' : mode === 'global' ? '系统级全局钩子' : '仅浏览器窗口内'}`);
    console.log(`  地图模式  : ${config.amapKey ? '高德真实路网' : '演练模式（未配置高德 Key）'}`);
    if (IS_PACKAGED) console.log(`  程序目录  : ${APP_ROOT}`);
    console.log('');
    if (!NO_OPEN && (IS_PACKAGED || process.env.NETWALK_OPEN === '1')) {
      if (openBrowser(url)) console.log('  已为你打开浏览器；关闭本窗口即停止 NetWalk。\n');
    }
  });
}

function shutdown() {
  console.log('\n[netwalk] 正在保存并退出...');
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
  holdConsoleOpen();
});

