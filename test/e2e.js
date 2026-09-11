/**
 * NetWalk 端到端集成测试
 *
 * 默认自带一个隔离实例：独立端口 + 临时数据目录 + 关闭真实采集，
 * 测试结束回收整棵进程树并删除临时目录，**不会污染 data/**。
 *
 * 也可以打一个已经在跑的实例：
 *   NETWALK_BASE=http://127.0.0.1:8787 node test/e2e.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.NETWALK_E2E_PORT) || 8788;

let child = null;
let tmpData = null;
let B = process.env.NETWALK_BASE || '';

let pass = 0, fail = 0;
function ok(n, c, e) { c ? (pass++, console.log('  [OK]   ' + n)) : (fail++, console.log('  [FAIL] ' + n + (e !== undefined ? ' → ' + e : ''))); }
const J = async (u, o) => (await fetch(B + u, o)).json();
const post = (u, body) => J(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等待隔离实例就绪 */
async function waitReady(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(B + '/api/config');
      if (r.ok) return true;
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  return false;
}

/** 回收整棵进程树（Windows 上可能还有 PowerShell / 钩子子进程） */
function killTree() {
  if (!child) return;
  const pid = child.pid;
  try {
    if (IS_WIN) spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch (_) { /* noop */ }
  try { child.kill('SIGKILL'); } catch (_) { /* noop */ }
  child = null;
}

function cleanup() {
  killTree();
  if (tmpData) {
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (_) { /* noop */ }
    tmpData = null;
  }
}

async function main() {
  if (!B) {
    tmpData = path.join(os.tmpdir(), `netwalk-e2e-${process.pid}`);
    fs.rmSync(tmpData, { recursive: true, force: true });
    B = `http://127.0.0.1:${PORT}`;
    console.log(`[e2e] 启动隔离实例：端口 ${PORT}，数据目录 ${tmpData}`);
    child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server', 'index.js')], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NETWALK_PORT: String(PORT),
        NETWALK_DATA: tmpData,
        NETWALK_NO_COLLECT: '1',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', (e) => console.log('[e2e] 子进程启动失败: ' + e.message));
    if (!await waitReady()) {
      console.log('[e2e] 隔离实例未能在 20 秒内就绪，中止');
      cleanup();
      process.exit(1);
    }
    console.log('[e2e] 实例就绪\n');
  } else {
    console.log(`[e2e] 使用已有实例 ${B}\n`);
  }

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  console.log('== 1. 配置与首页 ==');
  const cfg = await J('/api/config');
  ok('config 返回城市', !!cfg.city, cfg.city);
  ok('config 不泄露明文 Key', cfg.amapKey === '' || cfg.amapKey === '***configured***', cfg.amapKey);
  const home = await fetch(B + '/');
  const homeHtml = await home.text();
  ok('首页可访问且含全部脚本', home.status === 200 && homeHtml.includes('/js/achievements.js') && homeHtml.includes('/js/share.js'));

  console.log('\n== 2. 会话生命周期 ==');
  ok('session/start', (await post('/api/session/start', { date: today, city: '深圳', scope: 'city' })).ok);

  const pts = Array.from({ length: 60 }, (_, i) => ({
    t: Date.now() - (60 - i) * 1000,
    lat: 22.543099 + i * 0.00035, lng: 114.057868 + i * 0.00042,
    road: '测试路' + (i % 4), spd: 2 + (i % 10), mode: 'walk',
  }));
  ok('track/path 写入轨迹点', (await post('/api/track/path', { date: today, points: pts })).total >= 60);
  await post('/api/track/roll', { date: today, lat: 22.543, lng: 114.057, roll: 47, choice: '左转', fresh: 1 });
  await post('/api/track/sample', {
    date: today,
    sample: { t: Date.now(), rx: 1000, tx: 200, kpm: 120, spd: 5, mode: 'walk', dist: 3400 },
  });

  const day = await J('/api/day/' + today);
  ok('day 返回轨迹', (day.path || []).length >= 60, 'n=' + (day.path || []).length);
  ok('day 返回 visitedRoads', Array.isArray(day.visitedRoads) && day.visitedRoads.length === 4, JSON.stringify(day.visitedRoads));
  ok('visitedRoads 已去重', new Set(day.visitedRoads).size === day.visitedRoads.length);

  console.log('\n== 3. 结束并结算成就 ==');
  const end = await post('/api/session/end', {
    date: today, city: '深圳', scope: 'city',
    stats: { distance: 12000, duration: 3600000, avgSpeed: 12, maxSpeed: 16.5, rxTotal: 2e9, txTotal: 3e8, totalKeys: 30000, rolls: 12, runMs: 600000, walkMs: 3000000 },
  });
  ok('session/end ok', end.ok);
  ok('返回成就结算', !!end.achievements);
  ok('已解锁成就数 > 0', end.achievements.got > 0, 'got=' + end.achievements.got);
  ok('成就总数为 36', end.achievements.total === 36, 'total=' + end.achievements.total);

  console.log('\n== 4. 成就接口 ==');
  const ach = await J('/api/achievements');
  ok('achievements ok', ach.ok === true);
  ok('含 agg 聚合数据', !!ach.agg);
  ok('agg.totalDistance > 0', ach.agg.totalDistance > 0, 'd=' + ach.agg.totalDistance);
  ok('agg 含 perDay', Array.isArray(ach.agg.perDay) && ach.agg.perDay.length >= 1);
  ok('agg 含 uniqueRoads', ach.agg.uniqueRoads >= 4, 'r=' + ach.agg.uniqueRoads);
  ok('agg 含 litCells', ach.agg.litCells >= 1, 'lit=' + ach.agg.litCells);
  const firstGot = Object.keys(ach.unlocked)[0];
  ok('unlocked 值为时间戳', Number.isFinite(ach.unlocked[firstGot]), String(ach.unlocked[firstGot]));

  console.log('\n== 5. 日 / 月 / 年 统计 ==');
  for (const r of ['day', 'month', 'year', 'all']) {
    const s = await J('/api/stats?range=' + r);
    ok('stats range=' + r + ' 可用', s.ok === true && !!s.agg, JSON.stringify({ from: s.from, to: s.to }));
  }
  const sd = await J('/api/stats?range=day');
  // 回归：里程必须取 stats 上报值，而不是轨迹几何长度（地图尺度会放大坐标位移）
  ok('本日里程取 stats 上报值', Math.round(sd.agg.totalDistance) === 12000, 'd=' + sd.agg.totalDistance);
  const sy = await J('/api/stats?range=year');
  ok('本年含本日数据', sy.agg.totalDistance >= 12000, 'd=' + sy.agg.totalDistance);
  ok('本日 perDay 为 1 天', sd.agg.perDay.length === 1, 'n=' + sd.agg.perDay.length);

  console.log('\n== 6. 存档码导出 ==');
  const ex = await post('/api/archive/export');
  ok('导出 ok', ex.ok === true);
  ok('存档码前缀 NW1.', typeof ex.code === 'string' && ex.code.indexOf('NW1.') === 0, (ex.code || '').slice(0, 10));
  ok('存档码天数 >= 1', ex.days >= 1, 'days=' + ex.days);
  ok('压缩有效（< 90% 原始）', ex.bytes < ex.rawBytes * 0.9, `${ex.bytes}/${ex.rawBytes} = ${(100 * ex.bytes / ex.rawBytes).toFixed(1)}%`);
  ok('存档码仅含 URL 安全字符', /^NW1\.[A-Za-z0-9_-]+$/.test(ex.code));
  console.log(`     压缩率 ${(100 * ex.bytes / ex.rawBytes).toFixed(1)}%（${(ex.rawBytes / 1024).toFixed(1)} KB → ${(ex.bytes / 1024).toFixed(1)} KB）`);

  console.log('\n== 7. 存档码导入（幂等 / 合并） ==');
  const im1 = await post('/api/archive/import', { code: ex.code });
  ok('导入自己的存档 ok', im1.ok === true);
  ok('重复导入不新增天数（走合并）', im1.added === 0 && im1.merged >= 1, JSON.stringify({ added: im1.added, merged: im1.merged }));
  const im2 = await post('/api/archive/import', { code: 'NW1.this-is-not-valid' });
  ok('非法存档码被拒绝', im2.ok === false && !!im2.error);
  const im3 = await post('/api/archive/import', { code: 'NW2.abcdef' });
  ok('错误前缀被拒绝', im3.ok === false);

  console.log('\n== 8. 日报生成 ==');
  const rep = await post('/api/report/' + today);
  ok('日报生成 ok', rep.ok === true && !!rep.url, JSON.stringify(rep).slice(0, 120));
  const repHtml = await (await fetch(B + rep.url)).text();
  ok('日报可访问且是完整 HTML', repHtml.includes('<!DOCTYPE html>') && repHtml.includes('NetWalk'));
  ok('日报无 undefined/NaN', !repHtml.includes('undefined') && !repHtml.includes('NaN'));

  console.log('\n== 9. 合并后轨迹不翻倍 ==');
  const day2 = await J('/api/day/' + today);
  ok('合并后轨迹点未翻倍', day2.path.length < 120, 'n=' + day2.path.length);

  console.log(`\n===== 端到端结果：${pass} 通过 / ${fail} 失败 =====\n`);
  return fail ? 1 : 0;
}

main()
  .then((code) => { cleanup(); process.exit(code); })
  .catch((e) => { console.log('[FATAL] ' + e.stack); cleanup(); process.exit(1); });
