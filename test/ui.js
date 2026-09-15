/**
 * NetWalk 前端 DOM 级冒烟测试
 * 把 public/index.html + 全部脚本加载进 jsdom，mock 网络层，
 * 逐一点开新功能弹窗，捕获运行时错误。
 */
const fs = require('fs');
const path = require('path');

// jsdom 只用于测试；缺失时给出清晰提示而不是堆栈
let JSDOM;
let jsdomErr = null;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  jsdomErr = e;
}
if (!JSDOM && process.env.NW_NODE_MODULES) {
  try {
    ({ JSDOM } = require(path.join(process.env.NW_NODE_MODULES, 'jsdom')));
    jsdomErr = null;
  } catch (e) { jsdomErr = e; }
}
if (!JSDOM) {
  console.log('[uitest] 无法加载 jsdom：' + (jsdomErr ? jsdomErr.message.split('\n')[0] : '未知原因'));
  console.log('  请先安装：npm i -D jsdom');
  console.log('  若已安装仍报「Cannot find module <子依赖>」，通常是解包不完整，重跑一次 npm install 即可。');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..', 'public');
const SCRIPTS = ['js/speed.js', 'js/achievements.js', 'js/provider-drill.js',
  'js/provider-amap.js', 'js/engine.js', 'js/share.js', 'js/app.js'];

let pass = 0, fail = 0;
const errors = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' -> ' + extra : '')); }
}

// ---------- 构造 DOM ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:8787/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;

win.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e)));
const origCE = win.console.error;
win.console.error = (...a) => { errors.push('console.error: ' + a.join(' ').slice(0, 300)); };

// ---------- Canvas 2D stub ----------
function ctx2dStub() {
  const t = {};
  return new Proxy(t, {
    get(o, k) {
      if (k === 'measureText') return () => ({ width: 12 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'createPattern') return () => ({});
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k in o) return o[k];
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
win.HTMLCanvasElement.prototype.getContext = function () { return ctx2dStub(); };
win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,iVBORw0KGgo='; };

// ---------- BroadcastChannel ----------
class BCStub { constructor() {} postMessage() {} close() {} }
win.BroadcastChannel = BCStub;

// ---------- WebSocket ----------
const wsInstances = [];
class WSStub {
  constructor(url) { this.url = url; this.readyState = 1; this.OPEN = 1; wsInstances.push(this); }
  send() {} close() { this.readyState = 3; if (this.onclose) this.onclose(); }
}
win.WebSocket = WSStub;

// ---------- fetch mock ----------
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const FAKE_TRACK = Array.from({ length: 40 }, (_, i) => ({
  lat: 22.543 + i * 0.0004, lng: 114.057 + i * 0.0005,
  spd: 2 + (i % 12), road: '科技路' + (i % 5), t: Date.now() - (40 - i) * 1000,
}));
const FAKE_AGG = {
  totalDistance: 12345, totalDuration: 3600000 * 3, activeDays: 3, streakDays: 2,
  maxSpeed: 12.3, uniqueRoads: 47, litCells: 128, totalRolls: 21,
  totalRx: 123456789, totalTx: 23456789, totalKeys: 45678, totalPoints: 4000,
  maxDayDistance: 8000,
  perDay: [
    { date: '2026-09-08', city: '深圳', distance: 4000, duration: 1200000, rolls: 7, keys: 15000 },
    { date: '2026-09-09', city: '深圳', distance: 3500, duration: 1000000, rolls: 6, keys: 12000 },
    { date: '2026-09-10', city: '深圳', distance: 4845, duration: 1400000, rolls: 8, keys: 18678 },
  ],
};
function json(o, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(o) });
}
let MAILBOX_STATUS = { imapConfigured: false, hasArchive: false, count: 0 };   // 可变的邮箱状态桩
let TRACK_RANGE_DAYS = [];                                                     // 可变的轨迹范围桩（空=新设备）
let MAIL_STUB = { ok: true, to: '172805132@qq.com', error: '' };   // 模拟服务端「结束自动发信」的结果
const calls = [];
const postBodies = [];   // 记录 /api/config 的 POST 载荷，用于校验出发点配置
win.fetch = function (url, opt) {
  const u = String(url);
  calls.push((opt && opt.method ? opt.method : 'GET') + ' ' + u);
  if (opt && opt.method === 'POST' && u.indexOf('/api/config') === 0) {
    try { postBodies.push(JSON.parse(opt.body || '{}')); } catch (_) { postBodies.push(null); }
  }
  if (u.indexOf('/api/config') === 0 && (!opt || opt.method !== 'POST')) {
    return json({ city: '深圳', scope: 'city', hasKey: false, provider: 'drill', origin: { lng: 114.057868, lat: 22.543099 }, speed: { netWeight: 0.6, typeWeight: 0.4, netFullMbps: 20, typeFullKpm: 300, walkMax: 6.5, runMax: 16, idleSpeed: 1.2 } });
  }
  if (u.indexOf('/api/day/') === 0) {
    return json({ date: TODAY, path: FAKE_TRACK, stats: { distance: 4845, duration: 1400000, avgSpeed: 5.2, maxSpeed: 12.3, rolls: 8 }, rolls: new Array(8).fill({}), visitedRoads: ['科技路0', '科技路1', '科技路2'] });
  }
  if (u.indexOf('/api/mailbox/status') === 0) return json(Object.assign({ ok: true }, MAILBOX_STATUS));
  if (u.indexOf('/api/track/range') === 0) return json({ ok: true, days: TRACK_RANGE_DAYS, starts: [] });
  if (u.indexOf('/api/lastpos') === 0) {
    const lastPt = FAKE_TRACK[FAKE_TRACK.length - 1];
    return json({ ok: true, date: TODAY, lat: lastPt.lat, lng: lastPt.lng, road: lastPt.road || '' });
  }
  if (u.indexOf('/api/achievements') === 0) {
    return json({ ok: true, newly: ['dist_first'], unlocked: { dist_first: Date.now(), dist_5k: Date.now(), spd_run: Date.now(), roll_10: Date.now() }, total: 36, got: 4, agg: FAKE_AGG });
  }
  if (u.indexOf('/api/stats') === 0) return json({ ok: true, range: 'day', from: TODAY, to: TODAY, agg: FAKE_AGG });
  if (u.indexOf('/api/archive/export') === 0) return json({ ok: true, code: 'NW1.' + 'A'.repeat(300), days: 3, bytes: 7080, rawBytes: 44764 });
  if (u.indexOf('/api/archive/import') === 0) return json({ ok: true, added: 1, merged: 2, days: 4, achievements: { newly: [], unlocked: {}, total: 36, got: 4 } });
  if (u.indexOf('/api/session/end') === 0) return json({ ok: true, date: TODAY, achievements: { newly: ['dist_5k'], unlocked: {}, total: 36, got: 5 }, mail: MAIL_STUB });
  if (u.indexOf('/api/session/') === 0) return json({ ok: true, date: TODAY, achievements: { newly: ['dist_5k'], unlocked: {}, total: 36, got: 5 } });
  if (u.indexOf('/api/report/') === 0) return json({ ok: true, url: '/reports/netwalk-' + TODAY + '.html' });
  if (u.indexOf('/api/mapkey') === 0) return json({ ok: true, key: '' });
  return json({ ok: true });
};

// ---------- navigator.clipboard ----------
let copied = null;
try {
  Object.defineProperty(win.navigator, 'clipboard', {
    value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true,
  });
} catch (_) { /* noop */ }

// ---------- 加载脚本 ----------
console.log('== A. 脚本加载与全局导出 ==');
for (const s of SCRIPTS) {
  const code = fs.readFileSync(path.join(ROOT, s), 'utf8');
  try { win.eval(code); } catch (e) { ok('load ' + s, false, e.message); }
}
ok('NetWalkSpeed', typeof win.NetWalkSpeed === 'object');
ok('NetWalkAch', typeof win.NetWalkAch === 'object');
ok('DrillProvider', typeof win.DrillProvider === 'function');
ok('AmapProvider', typeof win.AmapProvider === 'function');
ok('RoamEngine', typeof win.RoamEngine === 'function');
ok('NetWalkShare', typeof win.NetWalkShare === 'object');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => doc.getElementById(id);
const shown = (id) => $(id).classList.contains('show');

(async () => {
  await sleep(400); // 等 boot(): fetch config → initProvider → bindUi

  console.log('\n== B. 启动与 UI 绑定 ==');
  ok('pillMap 已更新', $('pillMap').textContent.indexOf('演练') >= 0, $('pillMap').textContent);
  ok('cfgCity 已填充', $('cfgCity').value === '深圳', $('cfgCity').value);
  ok('toolbar 5 按钮存在', ['btnOverview', 'btnAch', 'btnStats', 'btnArchive', 'btnShare'].every((i) => $(i)));
  ok('地图已渲染 SVG', $('map').querySelector('svg') !== null);

  // 出发
  console.log('\n== C. 出发（引擎启动） ==');
  $('btnStart').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(600);
  ok('btnStart 已禁用', $('btnStart').disabled === true);
  ok('mDist 有数值', /\d/.test($('mDist').textContent), $('mDist').textContent);
  ok('mVisited 有数值', /条路/.test($('mVisited').textContent), $('mVisited').textContent);
  ok('mLit 有数值', /块/.test($('mLit').textContent), $('mLit').textContent);
  ok('/api/session/start 已调用', calls.some((c) => c.indexOf('/api/session/start') >= 0));
  ok('/api/day/ 已调用', calls.some((c) => c.indexOf('/api/day/') >= 0));
  ok('WS 已连接', wsInstances.length > 0);
  // 当天已有轨迹时，应从上次结束位置继续，而不是回到出发点
  const lastPt = FAKE_TRACK[FAKE_TRACK.length - 1];
  ok('从上次结束位置继续（日志可见）', $('logList').textContent.indexOf('从上次结束位置继续') >= 0);

  // C-2：区域修复（框选 → 只修框内）
  console.log('\n== C-2. 区域轨迹修复 ==');
  ok('btnRepairArea 按钮存在', !!$('btnRepairArea'));
  ok('框选矩形 + 确认条元素存在', !!$('pickBox') && !!$('repairBar') && !!$('repairInfo'));
  ok('NetWalkRepairUtil 已导出', !!(win.NetWalkRepairUtil && win.NetWalkRepairUtil.splitByDistance));
  const RU = win.NetWalkRepairUtil;
  ok('撤销修复按钮存在', !!$('btnRepairUndo'));
  // 修复护栏：绕远/异常的规划结果必须被拒绝，避免"越修越没有"
  const piece0 = [{ lat: 22.5, lng: 114.0 }, { lat: 22.5, lng: 114.002 }];
  ok('护栏：正常路线通过', RU.routeSane({ points: [{ lat: 22.5, lng: 114.0 }, { lat: 22.5, lng: 114.002 }] }, piece0) === true);
  ok('护栏：跑远 1km 的路线被拒绝', RU.routeSane({ points: [{ lat: 22.5, lng: 114.0 }, { lat: 22.51, lng: 114.01 }] }, piece0) === false);
  ok('护栏：点数不足的路线被拒绝', RU.routeSane({ points: [{ lat: 22.5, lng: 114.0 }] }, piece0) === false);
  const windy = [];
  for (let i = 0; i < 40; i++) windy.push({ lat: 22.5, lng: 114.0 + (i % 2) * 0.0004 });
  ok('护栏：来回折返的超长绕路被拒绝', RU.routeSane({ points: windy }, piece0) === false);
  ok('bboxOf 算出包围盒', JSON.stringify(RU.bboxOf(piece0)).indexOf('22.5') >= 0);
  const segs = RU.splitByDistance([
    { lat: 22.5, lng: 114.0 }, { lat: 22.5, lng: 114.004 }, { lat: 22.5, lng: 114.008 },
    { lat: 22.5, lng: 114.012 }, { lat: 22.5, lng: 114.016 },
  ], 500);
  ok('splitByDistance 按距离分段（约 400m/段）', segs.length >= 2, 'segs=' + segs.length);
  ok('分段连续（相邻段共享边界点）', segs[0][segs[0].length - 1].lng === segs[1][0].lng);
  const B = { minLat: 22.0, maxLat: 23.0, minLng: 113.5, maxLng: 114.5 };
  ok('insideBounds 命中框内点', RU.insideBounds({ lat: 22.5, lng: 114.0 }, B) === true);
  ok('insideBounds 排除框外点', RU.insideBounds({ lat: 31.2, lng: 121.5 }, B) === false);
  const cnt = RU.countInBounds([{ date: '2026-09-12', path: FAKE_TRACK }], B);
  ok('countInBounds 统计框内点数/段数', cnt.pts > 0 && cnt.runs >= 1 && cnt.dayN === 1, JSON.stringify(cnt));
  // 演练模式（jsdom 无高德 Key）点按钮 → 给出提示、不进入框选
  $('btnRepairArea').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  ok('演练模式下点区域修复给出提示且不进入框选',
    $('logList').textContent.indexOf('区域修复需要高德模式') >= 0 && !doc.body.classList.contains('picking'));
  $('btnRepairCancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('取消后仍处于非框选状态', !doc.body.classList.contains('picking'));

  // C-3：重叠热力着色 + 修复分段（0.9.20）
  console.log('\n== C-3. 重叠按次数着色 ==');
  ok('全局「轨迹整备」按钮已移除', !doc.getElementById('btnSnapTrack'));
  // 修复分段：每段 ~200m 且端点取原始点
  const mkRun = (n, stepDeg) => Array.from({ length: n }, (_, i) => ({ lat: 22.5, lng: 114.0 + i * stepDeg, road: '某路' }));
  const run500 = mkRun(11, 0.0005);   // 每步 ~51m，共 ~510m
  const j1 = RU.nextPieceIndex(run500, 0, 200);
  ok('演练图热力层已移除（dTrack 只有 0..9）',
    ![10, 11, 12, 13].some((i) => doc.getElementById('dTrack' + i)));
    ok('修复分段终点落在 ~200m 处（4 步 ≈ 205m）', j1 === 4, 'j=' + j1 + ' len=' + run500.length + ' fn=' + String(RU.nextPieceIndex).slice(0, 90));
  const j2 = RU.nextPieceIndex(run500, j1, 200);
  ok('第二段继续推进且不越界', j2 > j1 && j2 < run500.length, 'j1=' + j1 + ' j2=' + j2 + ' len=' + run500.length);
  const j3 = RU.nextPieceIndex(mkRun(3, 0.0005), 0, 200);
  ok('长段一次走完（<200m 直接到末点）', j3 === 2, String(j3) + ' fn=' + String(RU.nextPieceIndex).slice(0, 90));

  // 成就墙
  console.log('\n== D. 成就墙 ==');
  $('btnAch').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  ok('成就弹窗已显示', shown('maskAch'));
  const achHtml = $('achBody').innerHTML;
  ok('成就墙有内容', achHtml.length > 500, 'len=' + achHtml.length);
  ok('成就墙含 SVG 勋章', achHtml.indexOf('<svg') >= 0);
  const achTabs = $('achBody').querySelectorAll('.ach-tab');
  ok('成就分组 Tab >= 4', achTabs.length >= 4, 'n=' + achTabs.length);
  // 切换到"速度"分组
  const spdTab = [...achTabs].find((t) => (t.dataset.group || '') === 'speed');
  if (spdTab) { spdTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await sleep(80); }
  ok('分组切换后可渲染', $('achBody').innerHTML.indexOf('<svg') >= 0);
  ok('已解锁数量 > 0', win.NetWalkAch.evaluate(FAKE_AGG).length > 0);
  // 回归：成就红点看过就该熄灭（0.9.6 之前一旦点亮永不消失）
  ok('打开成就墙后红点熄灭', !$('achDot').classList.contains('on'),
    'achDot=' + ($('achDot').classList.contains('on') ? 'on' : 'off'));
  $('btnAchClose').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('成就弹窗可关闭', !shown('maskAch'));

  // 数据
  console.log('\n== E. 日/月/年数据 ==');
  $('btnStats').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  ok('数据弹窗已显示', shown('maskStats'));
  ok('统计格子 12 个', $('statsGrid').querySelectorAll('.stat-cell').length === 12, 'n=' + $('statsGrid').querySelectorAll('.stat-cell').length);
  ok('含下载总量', $('statsGrid').textContent.indexOf('下载总量') >= 0);
  ok('日表有 3 行', $('statsDaily').querySelectorAll('tbody tr').length === 3, 'n=' + $('statsDaily').querySelectorAll('tbody tr').length);
  // 切到本月
  const mTab = [...$('statsTabs').querySelectorAll('.ach-tab')].find((t) => t.dataset.range === 'month');
  mTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  ok('/api/stats?range=month 已调用', calls.some((c) => c.indexOf('range=month') >= 0));
  ok('本月 Tab 高亮', mTab.classList.contains('on'));
  $('btnStatsClose').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('数据弹窗可关闭', !shown('maskStats'));

  // 存档
  console.log('\n== F. 存档码 ==');
  $('btnArchive').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(150);
  ok('存档弹窗已显示', shown('maskArchive'));
  $('btnArGen').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(250);
  ok('存档码已填入', $('arCode').value.indexOf('NW1.') === 0, $('arCode').value.slice(0, 12));
  ok('hint 显示压缩信息', /KB/.test($('arHint').textContent), $('arHint').textContent);
  $('btnArCopy').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  ok('复制写入剪贴板', typeof copied === 'string' && copied.indexOf('NW1.') === 0);
  $('arInput').value = 'NW1.fakecode';
  $('btnArImport').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(250);
  ok('导入成功提示', /导入成功/.test($('arHint').textContent), $('arHint').textContent);
  ok('/api/archive/import 已调用', calls.some((c) => c.indexOf('/api/archive/import') >= 0));
  $('btnArClose').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('存档弹窗可关闭', !shown('maskArchive'));

  // 分享
  console.log('\n== G. 分享图 ==');
  $('btnShare').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  ok('分享弹窗已显示', shown('maskShare'));
  $('btnShareCopy').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  ok('分享文案已复制', typeof copied === 'string' && copied.length > 20, (copied || '').slice(0, 40));
  ok('分享文案含话题标签', typeof copied === 'string' && copied.indexOf('#NetWalk') >= 0);
  ok('分享文案含里程', typeof copied === 'string' && /\d/.test(copied));
  $('btnShareSave').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(150);
  ok('保存图片未抛错', errors.length === 0, errors[0]);
  $('btnShareClose').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('分享弹窗可关闭', !shown('maskShare'));

  // 轨迹总览
  console.log('\n== H. 今日轨迹总览 ==');
  $('btnOverview').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  ok('总览弹窗已显示', shown('maskOverview'));
  ok('总览 SVG 含轨迹线', $('ovSvg').querySelectorAll('line').length > 5, 'n=' + $('ovSvg').querySelectorAll('line').length);
  ok('总览含起点/终点/当前位置', /起点/.test($('ovSvg').innerHTML) && /终点/.test($('ovSvg').innerHTML) && /当前位置/.test($('ovSvg').innerHTML));
  ok('总览摘要已填充', $('ovSummary').querySelectorAll('.ov-cell').length === 4);
  $('btnOvClose').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('总览弹窗可关闭', !shown('maskOverview'));

  // 不走重复路（引擎逻辑，模拟路网直接断言）
  console.log('\n== I. 不走重复路 ==');
  const mkProvider = (roadName) => {
    let n = 0;
    return {
      name: 'mock', isVirtual: true,
      moveTo() {}, addTrackPoint() {}, lightCell() {},
      roadAt: () => Promise.resolve(roadName),
      planRoute: (from, to) => {
        n++;
        const road = typeof roadName === 'function' ? roadName(n) : roadName;
        return Promise.resolve({
          points: [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }],
          steps: [{ road, distance: 200 }],
          distance: 200,
        });
      },
    };
  };
  // I-1：唯一路线全是走过的路 → 0.9.16 起方向由 ROLL 决定（不按新路占比重掷），
  // 掷到重复路也照走（减少重复靠 100 个方位的探索半径，而不是重掷）
  const p1 = mkProvider('REPEAT_ROAD');
  const e1 = new win.RoamEngine({
    provider: p1, cfg: {}, origin: { lat: 22.54, lng: 114.05 }, scope: 'city',
    visitedRoads: ['REPEAT_ROAD'], onLog() {}, onUpdate() {}, onRoll() {},
  });
  await e1._planNext(true);
  ok('重复路也照常规划（方向由 ROLL 决定，不卡死）', !!e1.route);
  // 0.9.18：地图自由拖动 / 回到分身按钮
  ok('btnFollow 按钮存在', !!doc.getElementById('btnFollow'));
  $('btnFollow').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(100);
  ok('点击 🎯 后进入跟踪态（绿色 on）', $('btnFollow').classList.contains('on'));
  ok('ROLL 记录保存新路占比（诊断用）', e1.stats.rolls === 1, 'rolls=' + e1.stats.rolls);
  e1.stop();

  // I-1b：路网始终规划不出结果（前方不通）→ 原路返回上一个路口重掷，且绝不停住
  const pB = mkProvider('DEAD_END');
  pB.name = 'blocked';
  pB.planRoute = () => new Promise((resolve) => setTimeout(() => resolve(null), 5));
  const eB = new win.RoamEngine({
    provider: pB, cfg: {}, origin: { lat: 22.54, lng: 114.05 }, scope: 'city',
    visitedRoads: [], onLog() {}, onUpdate() {}, onRoll() {},
  });
  // 先走一段真实路线，制造一个可以退回的路口
  const pSeed = mkProvider('SEED_ROAD');
  const eSeed = new win.RoamEngine({
    provider: pSeed, cfg: {}, origin: { lat: 22.54, lng: 114.05 }, scope: 'city',
    visitedRoads: [], onLog() {}, onUpdate() {}, onRoll() {},
  });
  await eSeed._planNext(true);
  eB.junctionStack = [{ pos: { lat: 22.54, lng: 114.05 }, bearing: 90 }];
  await eB._planNext(true);
  ok('道路不通 → 原路返回路口（ROLL100 重掷）', eB.backtracks >= 1, 'backtracks=' + eB.backtracks);
  ok('原路返回后仍有路线（不卡死）', !!eB.route && eB.route.distance > 0);
  const posBefore = Object.assign({}, eB.pos);
  eB.traveled = eB.route.distance;
  await eB._planNext();
  ok('连续不通也能继续推进', !!eB.route && eB.route.distance > 0, `pos=${posBefore.lat.toFixed(4)}`);
  ok('无路线时不会永久挂起（planning 已释放）', eB.planning === false);
  eB.stop();
  eSeed.stop();

  // I-1c：路网调用超时 → 按预算放弃并直线兜底，不把引擎挂住
  const pT = mkProvider('SLOW_ROAD');
  pT.planRoute = () => new Promise(() => { /* 永不 resolve，模拟网络挂起 */ });
  const eT = new win.RoamEngine({
    provider: pT, cfg: {}, origin: { lat: 22.54, lng: 114.05 }, scope: 'city',
    visitedRoads: [], onLog() {}, onUpdate() {}, onRoll() {},
  });
  const t0 = Date.now();
  await eT._planNext(true);
  const cost = Date.now() - t0;
  ok('规划挂起时按预算放弃（<10s）', cost < 10000, cost + 'ms');
  ok('挂起后仍有兜底路线', !!eT.route && eT.route.distance > 0);
  eT.stop();

  // I-2：全新路网 → 首次即接受，且探索/点亮随行走累积
  const p2 = mkProvider((n) => 'ROAD_' + n);
  const e2 = new win.RoamEngine({
    provider: p2, cfg: {}, origin: { lat: 22.54, lng: 114.05 }, scope: 'city',
    visitedRoads: [], onLog() {}, onUpdate() {}, onRoll() {},
  });
  await e2.start();
  e2.feed({ rx: 3000000, tx: 1000000 }, { kpm: 260, total: 500 });
  await sleep(1500);
  const s2 = e2.snapshot();
  ok('新路首次即接受（无重掷）', e2.repeatSkips === 0, 'skips=' + e2.repeatSkips);
  ok('已走道路累积', s2.visited >= 1, 'visited=' + s2.visited);
  ok('点亮街区累积', s2.litCells >= 1, 'lit=' + s2.litCells);
  ok('段进度 0~100', s2.roadPct >= 0 && s2.roadPct <= 100, 'pct=' + s2.roadPct);
  ok('里程随时间增长', s2.distance > 0, 'dist=' + s2.distance.toFixed(1));
  ok('速度已换算 (>3km/h)', s2.speedKmh > 3, 'spd=' + s2.speedKmh.toFixed(2));
  e2.stop();

  // 结束
  console.log('\n== J. 结束并结算成就 ==');
  $('btnEnd').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(600);
  ok('结束浮层已显示', shown('maskDone'));
  ok('结束统计 6 格', $('doneStats').querySelectorAll('.done-stat').length === 6, 'n=' + $('doneStats').querySelectorAll('.done-stat').length);
  ok('结束弹窗给出存档码', $('doneArc').value.indexOf('NW1.') === 0, ($('doneArc').value || '').slice(0, 12));
  ok('/api/session/end 已调用', calls.some((c) => c.indexOf('/api/session/end') >= 0));
  ok('/api/report/ 已调用', calls.some((c) => c.indexOf('/api/report/') >= 0));
  ok('成就解锁已写入日志', $('logList').textContent.indexOf('解锁成就') >= 0);
  ok('achDot 已点亮', $('achDot').classList.contains('on'));

  // 结束面板：发送存档到邮箱（新增）
  ok('结束面板有「发送到邮箱」按钮', !!$('btnDoneMail'));
  $('btnDoneMail').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  ok('点「发送到邮箱」调用 /api/mailbox/push', calls.some((c) => c.indexOf('/api/mailbox/push') >= 0));
  ok('发送后有结果提示', (($('doneHint') || {}).textContent || '').length > 0, ($('doneHint') || {}).textContent);

  // 结束漫游自动发信：界面必须明确反馈（用户不必再点按钮）
  ok('结束提示写明已自动发送（邮箱脱敏）', ($('doneDesc').textContent || '').indexOf('172***32@qq.com') >= 0, $('doneDesc').textContent);
  ok('日志记录「存档码已自动发送到」', $('logList').textContent.indexOf('存档码已自动发送到') >= 0);
  ok('手动按钮改名为「重新发送到邮箱」', $('btnDoneMail').textContent.indexOf('重新发送') >= 0, $('btnDoneMail').textContent);
  // 自动发信失败分支：要给出原因 + 重发入口
  MAIL_STUB = { ok: false, to: '', error: '未配置邮箱（设置 → 邮箱配置）' };
  $('btnRestart').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  $('btnEnd').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(500);
  ok('发信失败时提示原因', ($('doneHint').textContent || '').indexOf('未配置邮箱') >= 0, $('doneHint').textContent);
  ok('失败时日志给出告警', $('logList').textContent.indexOf('存档邮件未自动发出') >= 0);

  // 结束面板：打开今日日报（修复：不再"点了没反应"）
  let openedUrl = null;
  const origWinOpen = win.open;
  win.open = (u) => { openedUrl = u; return null; };
  $('btnOpenReport').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  ok('点「打开今日日报」能打开日报 URL', typeof openedUrl === 'string' && openedUrl.indexOf('/reports/') >= 0, String(openedUrl));
  win.open = origWinOpen;

  // Esc 关闭
  console.log('\n== K. 全局 Esc 与错误检查 ==');
  $('btnStats').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);
  ok('Esc 可统一关闭弹窗', !shown('maskStats'));
  ok('无运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---------- 高德真实路网提供者（mock SDK） ----------
  // 这条路径在没有真实 Key 时从没被执行过，用 mock AMap 覆盖一遍
  console.log('\n== L. 高德真实路网提供者（mock SDK） ==');
  const mkAmap = () => {
    const st = { pluginCalls: [], listeners: {}, circles: [] };
    class LngLat { constructor(lng, lat) { this.lng = lng; this.lat = lat; } }
    class Pixel { constructor(x, y) { this.x = x; this.y = y; } }
    class Map {
      constructor(container, opts) { this.container = container; this.opts = opts; this.added = []; this.center = null; st.map = this; }
      on(ev, cb) { (st.listeners[ev] = st.listeners[ev] || []).push(cb); }
      off() {}
      add(o) { this.added.push(o); }
      setCenter(p) { this.center = p; }
      setFitView() {}
      destroy() { this.destroyed = true; }
    }
    class Marker {
      constructor(o) { Object.assign(this, o); st.marker = this; }
      setPosition(p) { this.position = p; }
      getContent() { return this.content; }
    }
    class Polyline { constructor(o) { Object.assign(this, o); this.path = o.path || []; st.polyline = this; (st.speedLines = st.speedLines || []).push(this); } setPath(p) { this.path = p; } getPath() { return this.path; } }
    class OverlayGroup { constructor() { this.overlays = []; st.group = this; } addOverlay(o) { this.overlays.push(o); } }
    class Circle { constructor(o) { Object.assign(this, o); st.circles.push(this); } }
    class Geocoder { getAddress(lnglat, cb) { cb('complete', { regeocode: { addressComponent: { streetNumber: { street: '测试街道' } }, pois: [] } }); } }
    class PlaceSearch { constructor(o) { Object.assign(this, o); } setType(t) {} searchInBounds(k, b, cb) { cb('complete', { poiList: { pois: [] } }); } searchNearBy(k, c, r, cb) { cb('complete', { poiList: { pois: [] } }); } }
    class Walking {
      search(o, d, cb) {
        cb('complete', {
          routes: [{
            distance: 1200,
            steps: [
              { road: '深南大道', distance: 600, path: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }] },
              { road: '深南大道', distance: 300, path: [{ lng: 3, lat: 3 }] },
              { road: '华强北路', distance: 300, path: [{ lng: 4, lat: 4 }] },
            ],
          }],
        });
      }
    }
    const AMap = {
      Map, Marker, Polyline, OverlayGroup, Circle, Geocoder, PlaceSearch, Walking, LngLat, Pixel,
      plugin(plugins, cb) { st.pluginCalls.push(plugins.slice()); if (cb) cb(); },
    };
    return { AMap, st };
  };

  const { AMap: AMapMock, st: amapSt } = mkAmap();
  win.AMap = AMapMock;
  const ap = new win.AmapProvider({ key: 'test-key', zoom: 16 });
  await ap.init($('map'), { center: { lng: 114.057868, lat: 22.543099 } });
  ok('AMap.plugin 显式加载 Walking/Geocoder',
    amapSt.pluginCalls.length === 1
    && amapSt.pluginCalls[0].includes('AMap.Walking')
    && amapSt.pluginCalls[0].includes('AMap.Geocoder'),
    JSON.stringify(amapSt.pluginCalls));
  ok('地图已创建且用暗色样式', !!amapSt.map && amapSt.map.opts.mapStyle === 'amap://styles/dark');
  // 0.9.13 笔迹模型：Polyline 按需创建（连续同色段一条线），初始只有 Marker
  ok('初始不预建 Polyline（笔迹按需创建）+ Marker 已挂到地图', amapSt.map.added.length === 1, 'n=' + amapSt.map.added.length);
  ok('Marker content 是真实 DOM 元素', !!amapSt.marker.content
    && typeof amapSt.marker.content.querySelector === 'function',
    typeof amapSt.marker.content);
  ok('能直接取到方向箭头元素（回归：之前 getContent() 返回字符串取不到）',
    !!ap._arrowEl && ap._arrowEl.className.indexOf('nw-avatar-arrow') >= 0);

  ok('未触发 complete 时 waitFirstFrame 超时返回 false', (await ap.waitFirstFrame(500)) === false);
  amapSt.listeners.complete.forEach((f) => f());
  ok('触发 complete 后 waitFirstFrame 返回 true', (await ap.waitFirstFrame(300)) === true);

  ap.moveTo(22.55, 114.07, 123.4);
  ok('marker 位置已更新', !!amapSt.marker.position && amapSt.marker.position.lng === 114.07);
  ok('地图已跟随居中', !!amapSt.map.center && amapSt.map.center.lng === 114.07);
  const arrowStyle = (ap._arrowEl.getAttribute('style') || '');
  ok('箭头已按方位角旋转', /rotate\(123\.4deg\)/.test(arrowStyle), 'style=' + JSON.stringify(arrowStyle));

  ap.addTrackPoint(22.55, 114.07, null, 2);          // 慢速 → 浅黄档（档 1）
  ap.addTrackPoint(22.56, 114.08, { lat: 22.55, lng: 114.07 }, 8);   // 快速 → 深色档（档 5）
  // v0.9.24 笔迹模型：跨档 = 换新笔迹（不再跨档补缝多画 4 条，避免颜色层堆叠导致闪烁/断线）
  ok('速度跨档 → 只为新高档建 1 条笔迹（不再跨档补缝多画）',
    amapSt.speedLines.length === 1 && amapSt.speedLines[0].path.length === 2,
    'runs=' + amapSt.speedLines.length + ' paths=' + JSON.stringify(amapSt.speedLines.map((l) => l.path.length)));

  // 飞线回归（核心！）：两段不相邻、同速度档的轨迹，绝不能被同一条 Polyline 连起来
  const segA = [{ lat: 1, lng: 1, spd: 5 }, { lat: 1.001, lng: 1.001, spd: 5 }];
  const segB = [{ lat: 2, lng: 2, spd: 5 }, { lat: 2.001, lng: 2.001, spd: 5 }];
  const runsBefore = amapSt.speedLines.length;
  ap.setTrack(segA);
  ap.setTrack(segB, { append: true });
  const newRuns = amapSt.speedLines.slice(runsBefore);
  ok('断笔后新段用新 Polyline（两次 setTrack 各建一条，互不相连）',
    newRuns.length === 2 && newRuns.every((l) => l.path.length === 2),
    JSON.stringify(newRuns.map((l) => l.path.length)));

  // 飞线回归 2：速度跨档来回变化时，回到旧档绝不能追加进旧笔迹
  // （否则速度波动就会把相距很远的两部分连进同一条线 —— v0.9.13 仍存在的飞线来源）
  const before2 = amapSt.speedLines.length;
  ap.setTrack([{ lat: 1, lng: 1, spd: 5 }, { lat: 1.001, lng: 1.001, spd: 8 }]);            // 5→8 跨档
  ap.setTrack([{ lat: 2, lng: 2, spd: 8 }, { lat: 2.001, lng: 2.001, spd: 5 }], { append: true }); // 8→5 回旧档
  const badRuns = amapSt.speedLines.slice(before2).filter((l) => {
    const lngs = (l.path || []).map((p) => p.lng);
    return lngs.some((x) => x < 1.5) && lngs.some((x) => x > 1.5);
  });
  ok('速度跨档来回变化也不连飞线（任何一条线里不得同时含两段远处的点）',
    badRuns.length === 0,
    'badRuns=' + badRuns.length + ' total=' + (amapSt.speedLines.length - before2));

  ap.lightCell(22.55, 114.07);
  ap.lightCell(22.56, 114.08);
  ok('点亮走 OverlayGroup', !!amapSt.group && amapSt.group.overlays.length === 2);
  ok('点亮半径约 150m 网格', amapSt.circles[0].radius === 78, amapSt.circles[0].radius);

  const amapRoute = await ap.planRoute({ lat: 22.54, lng: 114.05 }, { lat: 22.55, lng: 114.06 });
  ok('planRoute 返回路径', !!amapRoute && amapRoute.points.length === 4, amapRoute && amapRoute.points.length);
  ok('planRoute 合并相邻同名路段',
    amapRoute.steps.length === 2 && amapRoute.steps[0].road === '深南大道' && amapRoute.steps[0].distance === 900,
    JSON.stringify(amapRoute.steps));

  const amapRoad = await ap.roadAt(22.55, 114.07, { force: true });
  ok('roadAt 取到真实路名', amapRoad === '测试街道', amapRoad);

  ap.destroy();
  ok('destroy 后 ready=false 且清空引用', ap._ready === false && ap._arrowEl === null);
  ok('L 阶段无运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));

  // ---------- 出发点设置 / Key 说明 / 调用量 ----------
  console.log('\n== M. 出发点设置 / Key 说明 / 调用量 ==');

  // 演练模式下点地图角标即可打开设置弹窗
  $('pillMap').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  ok('点 pillMap 可打开设置弹窗', shown('maskSettings'));

  const originIds = ['orCurName', 'orCurCoord', 'orSearch', 'btnOrSearch', 'btnOrPick',
    'btnOrGeo', 'btnOrReset', 'orLng', 'orLat', 'orHint', 'pickBar', 'pbCoord', 'btnPickCancel', 'cfgSec'];
  ok('出发点/安全密钥相关元素齐全', originIds.every((i) => $(i)), originIds.filter((i) => !$(i)).join(','));

  ok('初始出发点=城市中心 · 深圳', $('orCurName').textContent === '城市中心 · 深圳', $('orCurName').textContent);
  ok('初始坐标=深圳市中心', $('orCurCoord').textContent === '114.057868, 22.543099', $('orCurCoord').textContent);
  // 回归：出发点控件不能被锁死（否则"重置后无法重新选择出发点"）
  ok('出发点控件始终可用（搜索/点选/定位/回中心）',
    ['orSearch', 'btnOrSearch', 'btnOrPick', 'btnOrGeo', 'btnOrReset'].every((i) => $(i) && !$(i).disabled),
    ['orSearch', 'btnOrSearch', 'btnOrPick', 'btnOrGeo', 'btnOrReset'].filter((i) => $(i) && $(i).disabled).join(','));

  // Key 说明与防泄露提示
  const setHtml = $('maskSettings').innerHTML;
  ok('设置里有「请用你自己的手机号申请」', setHtml.indexOf('请用你自己的手机号申请') >= 0);
  ok('说明含高德开放平台申请链接', setHtml.indexOf('console.amap.com/dev/id/phone') >= 0);
  ok('说明强调 Key 只存本机不上传', setHtml.indexOf('不会上传') >= 0);
  ok('含分享前勿发 config.json 的告警', setHtml.indexOf('不要把') >= 0 && setHtml.indexOf('data/config.json') >= 0);
  ok('DOCK 有高德调用量行（默认 0 / 4000）', $('mAmap').textContent.indexOf('/') >= 0, $('mAmap').textContent);

  // 空地址搜索
  $('orSearch').value = '';
  $('btnOrSearch').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  ok('空地址搜索给出提示', $('orHint').textContent.indexOf('请输入地址') >= 0, $('orHint').textContent);

  // 演练模式下按地址搜索应被拦截
  $('orSearch').value = '深圳湾公园';
  $('btnOrSearch').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  ok('演练模式下地址搜索被拦截并提示', $('orHint').textContent.indexOf('演练模式') >= 0, $('orHint').textContent);

  // 手动输入坐标
  $('orLng').value = '113.900000';
  $('orLat').value = '22.500000';
  $('orLng').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(30);
  ok('手填坐标后名称=手动输入坐标', $('orCurName').textContent === '手动输入坐标', $('orCurName').textContent);
  ok('手填坐标后坐标已更新', $('orCurCoord').textContent === '113.900000, 22.500000', $('orCurCoord').textContent);

  // 越界坐标应被拒绝且不污染已选点
  $('orLng').value = '999';
  $('orLat').value = '200';
  $('orLng').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(30);
  ok('越界坐标被拒绝并提示范围', $('orHint').textContent.indexOf('超出有效范围') >= 0, $('orHint').textContent);
  ok('越界坐标不污染当前出发点', $('orCurCoord').textContent === '113.900000, 22.500000', $('orCurCoord').textContent);

  // 恢复城市中心
  $('btnOrReset').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  ok('恢复城市中心生效', $('orCurName').textContent === '城市中心 · 深圳', $('orCurName').textContent);

  // 切换城市应跟随更新中心坐标
  $('cfgCity').value = '北京';
  $('cfgCity').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(30);
  ok('换城市后中心坐标跟随（北京）', $('orCurCoord').textContent === '116.397428, 39.909230', $('orCurCoord').textContent);
  $('cfgCity').value = '深圳';
  $('cfgCity').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(30);

  // 地图点选：收起设置弹窗 + 显示顶部提示条
  $('btnOrPick').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  ok('进入点选后设置弹窗收起', !shown('maskSettings'));
  ok('进入点选后显示提示条', shown('pickBar'));

  // 模拟一次带坐标的点选（jsdom 默认 rect 为 0，需给定尺寸）
  const svgEl = $('map').querySelector('svg');
  if (svgEl) {
    svgEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
    svgEl.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 400, clientY: 300 }));
  }
  await sleep(60);
  ok('点选后坐标条写入经纬度', /\d+\.\d+,\s*\d+\.\d+/.test($('pbCoord').textContent), $('pbCoord').textContent);
  ok('点选后设置弹窗自动回来', shown('maskSettings'));
  ok('点选结果写回出发点名称', $('orCurName').textContent.indexOf('地图点选') >= 0, $('orCurName').textContent);
  ok('点选后提示条已收起', !shown('pickBar'));

  // 取消点选
  $('btnOrPick').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('可再次进入点选', shown('pickBar') && !shown('maskSettings'));
  $('btnPickCancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('取消点选后提示条收起、弹窗恢复', !shown('pickBar') && shown('maskSettings'));
  ok('取消点选有文字反馈', $('orHint').textContent.indexOf('取消') >= 0, $('orHint').textContent);

  // Esc 在点选态优先取消点选
  $('btnOrPick').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(40);
  ok('Esc 优先取消点选而非关弹窗', !shown('pickBar') && shown('maskSettings'));

  // 保存：POST 载荷应带上出发点配置
  $('orLng').value = '118.797329';
  $('orLat').value = '32.060203';
  $('orLng').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(30);
  const beforePost = postBodies.length;
  $('btnSaveCfg').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(160);
  const saved = postBodies[postBodies.length - 1];
  ok('保存时已 POST /api/config', postBodies.length > beforePost);
  ok('保存载荷携带 origin', !!saved && !!saved.origin
    && Math.abs(saved.origin.lng - 118.797329) < 1e-6 && Math.abs(saved.origin.lat - 32.060203) < 1e-6,
    JSON.stringify(saved && saved.origin));
  ok('保存载荷标记 originCustom=true', !!saved && saved.originCustom === true, saved && String(saved.originCustom));
  ok('保存载荷带 originName', !!saved && typeof saved.originName === 'string' && saved.originName.length > 0,
    saved && saved.originName);
  // 0.9.1 起的契约：没有可用 Key 时【不下发】amapKey（下发空串会把已配置的 Key 清掉，
  // 表现为"保存设置后地图变虚拟路网"）。所以这里断言"绝不下发空串"。
  ok('保存绝不把 Key 清成空串（不下发即保持原值）',
    !!saved && (!('amapKey' in saved) || String(saved.amapKey || '').length > 0)
    && (!('amapSecurityJsCode' in saved) || String(saved.amapSecurityJsCode || '').length > 0),
    saved && JSON.stringify({ amapKey: saved.amapKey, sec: saved.amapSecurityJsCode }));
  ok('M 阶段无运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));

  // N. 走出广州 / 走出中国（大尺度推进：路网规划失败时走直线兜底）
  console.log('\n== N. 走出广州 / 走出中国 ==');
  const GZ = { lat: 23.129, lng: 113.264 };
  // isVirtual=false：模拟高德真实路网（演练路网固定 1×，大尺度只在真实路网下有意义）
  const mkNull = (name) => { const p = mkProvider(name); p.isVirtual = false; p.planRoute = () => Promise.resolve(null); return p; };

  // 全国尺度 50×：前 3 次不通会先"原路返回路口重掷"（原地打转是预期行为），
  // 第 4 次起退无可退 → 直线兜底狂奔。0.9.8 起每段约 240-300m，30 段 × 270m × 50 ≈ 400km
  const eCn = new win.RoamEngine({
    provider: mkNull('CN_OUT'), cfg: {}, origin: GZ, scope: 'china',
    visitedRoads: [], onLog() {}, onUpdate() {}, onRoll() {},
  });
  let cnTotal = 0;
  for (let i = 0; i < 30; i++) {
    eCn.bearing = 0;   // 锁定大致向北，避免随机游走让净位移断言 flaky
    await eCn._planNext(true);
    if (!eCn.route) { console.log(`  [diag] 段${i + 1} 无路线，提前结束`); break; }
    if (i < 3) console.log(`  [diag] 段${i + 1}: dist=${(eCn.route.distance / 1000).toFixed(1)}km scale=${eCn._scale()} scope=${eCn.scope} isVirtual=${eCn.provider.isVirtual} streak=${eCn.blockedStreak}`);
    cnTotal += eCn.route.distance;
    eCn.traveled = eCn.route.distance;
    eCn._applyPosition();
  }
  ok('全国尺度 30 段累计位移 > 200km（直线兜底生效）', cnTotal > 200000, (cnTotal / 1000).toFixed(0) + ' km');
  const cnMoved = win.NetWalkGeo.haversine(GZ, eCn.pos);
  // ROLL100 方向随机，12 段的净位移有波动（累计路线 >200km 已在上一条验证"能走远"）
  ok('分身已离开广州市区（>15km）', cnMoved > 15000, (cnMoved / 1000).toFixed(0) + ' km');
  ok('真实里程统计不受时空压缩影响（<2km）', eCn.stats.distance < 2000, (eCn.stats.distance / 1000).toFixed(2) + ' km');
  eCn.stop();

  // 全球尺度 500×：单段 ≈ 600km，几段就能跨出国境（环游中国 / 世界玩法成立）
  const eW = new win.RoamEngine({
    provider: mkNull('WORLD_OUT'), cfg: {}, origin: GZ, scope: 'world',
    visitedRoads: [], onLog() {}, onUpdate() {}, onRoll() {},
  });
  let wTotal = 0;
  for (let i = 0; i < 20; i++) {
    eW.bearing = 0;   // 锁定大致向北：ROLL 仍会 ±90° 转向，这里验证"累计位移"而非方向
    await eW._planNext(true);
    if (!eW.route) { console.log(`  [diag] W 段${i + 1} 无路线`); break; }
    wTotal += eW.route.distance;
    eW.traveled = eW.route.distance;
    eW._applyPosition();
  }
  // 0.9.8 起每段约 240-300m：20 段 × 270m × 500 ≈ 2700km（旧规则单段更长、段数更少）
  ok('全球尺度 20 段累计位移 > 1500km（可跨出国境）', wTotal > 1500000, (wTotal / 1000).toFixed(0) + ' km');
  const wMoved = win.NetWalkGeo.haversine(GZ, eW.pos);
  // ROLL100 会随机转向，净位移是随机游走合成（20 段 × 130km，期望净位移 ≈ √20×130 ≈ 580km），
  // 断言取保守下限：只要明显离开广东（>80km）即视为"可走出中国"
  ok('净位移已离开广州都市圈（>80km）', wMoved > 80000, (wMoved / 1000).toFixed(0) + ' km');
  const cityDayKm = (5 / 3.6) * 3600 * 8 / 1000;
  // 一天(8h·5km/h)在 500× 下的地图距离 ≈ 2 万 km —— 环游世界一圈(4 万 km)约两天
  const worldDayKm = cityDayKm * 500;
  ok('全球尺度一天(8h)约 2 万 km（两天可环球一圈）', worldDayKm > 18000, worldDayKm.toFixed(0) + ' km');
  ok('城市尺度一天约 40km（在市内深耕）', cityDayKm > 35 && cityDayKm < 45, cityDayKm.toFixed(0) + ' km');
  eW.stop();

  console.log('\n== O. 顺路直走 + 远方引力 ==');
  const roadRoute = { points: [{ lat: 22.54, lng: 114.05 }, { lat: 22.545, lng: 114.06 }], steps: [{ road: '华景路', distance: 600 }], distance: 600 };
  const logsO = [];
  const mkRoad = () => {
    const p = mkProvider('ROADP');
    p.planRoute = () => Promise.resolve(JSON.parse(JSON.stringify(roadRoute)));
    return p;
  };
  const eR = new win.RoamEngine({
    provider: mkRoad('ROADP'), cfg: {}, origin: { lat: 22.54, lng: 114.05 }, scope: 'city',
    visitedRoads: [], onLog: (m) => logsO.push(m), onUpdate() {}, onRoll() {},
  });
  eR.road = '华景路';
  eR.route = { steps: [{ road: '华景路', distance: 600 }] };   // 上一段也在同一条路上
  eR._lastChoice = '直行'; eR._straightStreak = 2;             // 已连续两次直行
  const rollsO = eR.stats.rolls;
  await eR._planNext(false);
  ok('顺路直走：长路连击时不再掷点（不计 ROLL 统计）', eR.stats.rolls === rollsO,
    `${eR.stats.rolls}/${rollsO}`);
  ok('顺路直走：连击 +1（下一段更远）', eR._straightStreak === 3, 'streak=' + eR._straightStreak);
  ok('顺路直走：日志说明延伸', logsO.some((m) => m.indexOf('顺路直走') >= 0), logsO.join(' | ').slice(0, 100));

  // 路线里出现新路名 = 这条路到头了 → 恢复 ROLL100（当前段仍是直走段，下一段才重新掷点）
  eR.provider.planRoute = () => Promise.resolve({ points: roadRoute.points, steps: [{ road: '中山大道', distance: 600 }], distance: 600 });
  await eR._planNext(false);
  ok('走到路尽头（路线出现新路名）→ 连击清零', eR._straightStreak === 0, 'streak=' + eR._straightStreak);
  await eR._planNext(false);
  ok('下一段恢复掷点（计入 ROLL 统计）', eR.stats.rolls === rollsO + 1, `${eR.stats.rolls}/${rollsO + 1}`);
  eR.stop();

  // 远方引力：长期没出出发点 3km 圈 → 强制向城外远行
  let gravityRec = null;
  const eG = new win.RoamEngine({
    provider: mkRoad('GRAVP'), cfg: {}, origin: { lat: 22.54, lng: 114.05 }, scope: 'city',
    visitedRoads: [], onLog() {}, onUpdate() {}, onRoll: (r) => { gravityRec = r; },
  });
  eG._rollsSinceHome = 20;   // 模拟长期未出圈
  await eG._planNext(true);
  ok('远方引力：长期未出圈触发强制出城段', !!gravityRec && gravityRec.choice === '远方引力·出城',
    gravityRec && gravityRec.choice);
  ok('远方引力：按远行 1200m 规划', !!gravityRec && gravityRec.roll === 100, gravityRec && gravityRec.roll);
  eG.stop();

  // 新设备出发前提示「先同步存档」（0.9.22）
  console.log('\n== Q. 新设备出发前提示先同步 ==');
  ok('同步提示浮层元素齐全', !!$('maskSyncFirst') && !!$('btnSyncFirstGo') && !!$('btnSyncFirstSkip'));
  // 模拟新设备：本机无轨迹 + 已配置 IMAP
  MAILBOX_STATUS = { imapConfigured: true, hasArchive: true, count: 3 };
  TRACK_RANGE_DAYS = [];
  win.NetWalkDebug.resetSyncPrompt();
  $('btnStart').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  ok('新设备点出发 → 弹出「先同步存档」提示', shown('maskSyncFirst'));
  ok('提示时不会直接开始走（btnStart 仍可用）', $('btnStart').disabled === false);
  // 选「直接出发」→ 正常开始漫游
  $('btnSyncFirstSkip').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(700);
  ok('选直接出发后开始漫游', $('btnStart').disabled === true);
  ok('提示浮层已关闭', !shown('maskSyncFirst'));
  ok('日志说明会合并、不改续走点', $('logList').textContent.indexOf('两边会自动合并') >= 0);
  // 收尾：结束这次漫游，避免影响后续判定
  $('btnEnd').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(500);
  // 「先同步再出发」路径：点按钮应调用 /api/mailbox/pull
  win.NetWalkDebug.resetSyncPrompt();
  $('btnStart').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  $('btnSyncFirstGo').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(900);
  ok('点「先同步存档再出发」调用 /api/mailbox/pull', calls.some((c) => c.indexOf('/api/mailbox/pull') >= 0));
  ok('同步后自动开始漫游', $('btnStart').disabled === true);
  // 有本机数据时不再提示（老用户不受打扰）
  $('btnEnd').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(500);
  TRACK_RANGE_DAYS = [{ date: TODAY, path: FAKE_TRACK }];
  win.NetWalkDebug.resetSyncPrompt();
  $('btnStart').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(500);
  ok('本机已有轨迹时不再弹同步提示', !shown('maskSyncFirst') && $('btnStart').disabled === true);
  $('btnEnd').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);

  // C-1（移到此处）：断网自动结束行程（放在最后，不影响前面的行走状态测试）
  console.log('\n== C-1. 断网自动结束行程 ==');
  $('btnStart').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  win.dispatchEvent(new win.Event('offline'));
  await sleep(300);
  ok('断网后行程已结束（btnStart 恢复可点）', $('btnStart').disabled === false);
  ok('断网提示条出现', $('netBanner').classList.contains('show'));
  ok('日志说明断网结束原因', $('logList').textContent.indexOf('已自动结束行程') >= 0);
  win.dispatchEvent(new win.Event('online'));
  await sleep(200);
  ok('联网后提示条隐藏', !$('netBanner').classList.contains('show'));

  console.log('\n===== UI 测试结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  if (errors.length) { console.log('\n捕获到的错误：'); errors.slice(0, 10).forEach((e) => console.log('  - ' + e)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('\n[FATAL] ' + e.stack); process.exit(1); });
