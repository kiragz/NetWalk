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
const net = require('net');
const zlib = require('zlib');

const IS_WIN = process.platform === 'win32';
const PROJECT_ROOT = path.resolve(__dirname, '..');
// 0 = 运行时自动挑一个空闲端口，避免被上一轮遗留的实例占住 8788 后，
// 测试打到旧数据上（表现为"合并后轨迹翻倍 n=120/180"这种假故障）。
let PORT = Number(process.env.NETWALK_E2E_PORT) || 0;

let child = null;
let tmpData = null;
let B = process.env.NETWALK_BASE || '';

/** 问操作系统要一个当前空闲的端口 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

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
    if (!PORT) PORT = await freePort();
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
  const sc = await J('/api/selfcheck');
  ok('自检页可用且含关键字段',
    sc.ok === true && typeof sc.pid === 'number' && typeof sc.smtpConfigured === 'boolean' && typeof sc.imapConfigured === 'boolean' && !!sc.dataDir,
    JSON.stringify({ pid: sc.pid, smtp: sc.smtpConfigured, imap: sc.imapConfigured }));
  ok('自检页不泄露密钥明文', !JSON.stringify(sc).match(/[0-9a-f]{32}|(pass|token|code)"\s*:\s*"[^"]{8,}/i), '');
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

  console.log('\n== 10. 高德安全密钥防误填 ==');
  // 回归：安全密钥被填成和高德 Key 一样 → 高德签名失败 → 地址解析一直超时
  await post('/api/config', { amapKey: 'TESTKEY123456', amapSecurityJsCode: 'TESTKEY123456' });
  const mk1 = await J('/api/mapkey');
  ok('安全密钥与 Key 相同时被忽略', mk1.key === 'TESTKEY123456' && mk1.securityJsCode !== 'TESTKEY123456',
    JSON.stringify(mk1));
  await post('/api/config', { amapKey: 'TESTKEY123456', amapSecurityJsCode: 'REAL_SEC_999' });
  const mk2 = await J('/api/mapkey');
  ok('安全密钥与 Key 不同时正常保存', mk2.securityJsCode === 'REAL_SEC_999', JSON.stringify(mk2));

  console.log('\n== 11. 存档码携带本机配置（换设备免手填） ==');
  await post('/api/config', {
    amapKey: 'CARRYKEY_AAA', amapSecurityJsCode: 'CARRYSEC_BBB',
    mailSmtpHost: 'smtp.qq.com', mailSmtpPort: '465', mailUser: 'carry@qq.com', mailPass: 'pw123',
    mailImapHost: 'imap.qq.com', mailImapPort: '993',
    city: '广州', origin: { lng: 113.356426, lat: 23.135343 }, originCustom: true, originName: '测试出发点',
  });
  const exp = await post('/api/archive/export', {});
  ok('导出成功且带出配置字段', exp.ok === true && !!exp.code);
  // 把本机配置改掉，模拟"新设备"上的另一套配置
  await post('/api/config', { amapKey: 'OTHERKEY_CCC', mailUser: 'other@qq.com' });
  const imp = await post('/api/archive/import', { code: exp.code });
  ok('导入后提示存档码带配置', imp.ok === true && imp.cfgAvailable === true && imp.cfgKeys.indexOf('amapKey') >= 0, JSON.stringify(imp.cfgKeys));
  const mkAfterImport = await J('/api/mapkey');
  ok('导入不会自动覆盖本机配置（安全）', mkAfterImport.key === 'OTHERKEY_CCC', mkAfterImport.key);
  const applied = await post('/api/archive/apply-config', { code: exp.code });
  ok('显式应用后配置被恢复', applied.ok === true && applied.restored.indexOf('amapKey') >= 0, JSON.stringify(applied.restored));
  ok('出发点也随存档码恢复（不再跳回默认城市）',
    applied.ok === true && applied.city === '广州' && applied.originCustom === true
    && Math.abs(Number(applied.origin.lng) - 113.356426) < 1e-6,
    JSON.stringify({ city: applied.city, origin: applied.origin, custom: applied.originCustom }));
  const mkAfterApply = await J('/api/mapkey');
  ok('恢复生效：Key / 邮箱都回来了',
    mkAfterApply.key === 'CARRYKEY_AAA' && mkAfterApply.securityJsCode === 'CARRYSEC_BBB', JSON.stringify(mkAfterApply));
  const applied2 = await post('/api/archive/apply-config', { code: 'NW1.bogus' });
  ok('非法存档码应用配置被拒绝', applied2.ok === false && !!applied2.error);

  console.log('\n== 12. 出发次数合并与全局重排 ==');
  // 本机先出发 3 次（n=1,2,3）→ 导出存档 → 本机又出发 2 次（n=4,5）→ 导入存档（模拟另一台设备的数据回来）
  // 合并后出发记录应去重并全局重排为 1..5，下一次出发 = 6
  // 注意：必须带 lat/lng 才会被记为一次出发（第 2 节那次没带坐标，本来就不该计入）；
  // 且每次要换个位置 —— 同一位置短时间内重复出发已按"重复起步"去重，不再新增序号。
  for (let i = 0; i < 3; i++) await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 22.54 + i * 0.01, lng: 114.05 + i * 0.01 });
  const expS = await post('/api/archive/export', {});
  for (let i = 0; i < 2; i++) await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 22.57 + i * 0.01, lng: 114.08 + i * 0.01 });
  const impS = await post('/api/archive/import', { code: expS.code });
  const ss = await J('/api/sessions');
  const ns = (ss.starts || []).map((x) => x.n).sort((a, b) => a - b);
  ok('导入后出发记录被合并（不丢）', (ss.starts || []).length === 5, 'count=' + (ss.starts || []).length);
  ok('出发序号全局重排为 1..N', ns.join(',') === '1,2,3,4,5', ns.join(','));
  const sn = await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 22.59, lng: 114.12 });
  ok('下一次出发序号 = 总次数 + 1', sn.sessionNo === 6, 'sessionNo=' + sn.sessionNo);

  console.log('\n== 13. 重置传播：按时间戳过滤 + 接管 ==');
  // 本机走一个"旧世界"的点 → 导出（resetAt=0）→ 重置（记录 resetAt=T1）→ 再导入旧存档：
  // 旧点的时间戳全部早于重置时刻，应被逐点过滤，一条也回不来
  await post('/api/track/path', { date: today, points: [ { t: Date.now() - 60000, lat: 22.54, lng: 114.05, road: '旧路', spd: 5, mode: 'walk' } ] });
  const expOld = await post('/api/archive/export', {});
  const pr13 = await post('/api/profile/reset', { confirm: '我已知重置将删除全部漫游数据且不可恢复', city: '深圳' });
  ok('13.1 档案重置成功（已记录重置时间戳）', pr13.ok === true);
  const impOld = await post('/api/archive/import', { code: expOld.code });
  const rng13 = await J('/api/track/range?from=0000-01-01&to=' + today);
  const pts13 = (rng13.days || []).reduce((s, d) => s + (d.path || []).length, 0);
  ok('13.2 重置后导入旧存档：旧轨迹点按时间戳过滤，不会回来', pts13 === 0, 'points=' + pts13 + ' (added=' + impOld.added + ')');

  // 构造一个"对端重置得更晚（resetAt=T2）"的存档 → 导入应触发接管：清空本机旧轨迹并采用对端数据
  const T2 = Date.now();
  const payload13 = {
    v: 1, at: T2, resetAt: T2,
    tracks: { [today]: { date: today, startedAt: T2, endedAt: null, city: '广州',
      path: [ { t: T2 + 1000, lat: 23.13, lng: 113.35, road: '新路', spd: 5, mode: 'walk' } ],
      samples: [], rolls: [], sessions: [ { n: 1, lat: 23.13, lng: 113.35, t: T2 + 500 } ], stats: null } },
    achievements: { unlocked: {} },
  };
  const codeT2 = 'NW1.' + zlib.deflateRawSync(Buffer.from(JSON.stringify(payload13), 'utf8')).toString('base64url');
  const impT2 = await post('/api/archive/import', { code: codeT2 });
  ok('13.3 对端重置更新 → 触发接管', impT2.resetTakeover === true, JSON.stringify(impT2).slice(0, 100));
  const rng13b = await J('/api/track/range?from=0000-01-01&to=' + today);
  const flat13 = (rng13b.days || []).flatMap((d) => d.path || []);
  ok('13.4 接管后本机只剩对端的新数据', flat13.length === 1 && Math.abs(Number(flat13[0].lat) - 23.13) < 1e-6,
    'points=' + flat13.length);
  const ss13 = await J('/api/sessions');
  ok('13.5 出发记录也随接管更新为对端的', (ss13.starts || []).length === 1, 'starts=' + (ss13.starts || []).length);

  console.log('\n== 14. 新设备忘按同步就先走一段，之后再同步 ==');
  // 场景：本机（新设备）忘了同步就出发走了一段 → 之后点「一键同步」导入邮箱存档。
  // 期望：两边数据都在（合并，不丢）；续走点按【时间戳】取最新而不是导入顺序；出发序号全局重排。
  const sn14 = await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 22.60, lng: 114.10 });
  const tLocal = Date.now() + 60000;   // 本机这段比存档里的点更新
  await post('/api/track/path', { date: today, points: [
    { t: tLocal, lat: 22.60, lng: 114.10, road: '新设备路', spd: 5, mode: 'walk', no: sn14.sessionNo },
    { t: tLocal + 1000, lat: 22.6005, lng: 114.10, road: '新设备路', spd: 5, mode: 'walk', no: sn14.sessionNo },
  ] });
  // 「另一台设备」的存档码：另一天的数据，时间戳早于本机这段（晚于本机 resetAt 才会被保留）
  const oldDate14 = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const tPeer = Date.now() + 1000;
  const payload14 = {
    v: 1, at: tPeer, resetAt: 0,
    tracks: {
      [oldDate14]: { date: oldDate14, startedAt: tPeer, endedAt: null, city: '广州',
        path: [ { t: tPeer, lat: 23.10, lng: 113.30, road: '旧设备路', spd: 5, mode: 'walk' },
                { t: tPeer + 1000, lat: 23.1005, lng: 113.30, road: '旧设备路', spd: 5, mode: 'walk' } ],
        samples: [], rolls: [], sessions: [ { n: 1, lat: 23.10, lng: 113.30, t: tPeer } ], stats: null } },
    achievements: { unlocked: {} },
  };
  const code14 = 'NW1.' + zlib.deflateRawSync(Buffer.from(JSON.stringify(payload14), 'utf8')).toString('base64url');
  const imp14 = await post('/api/archive/import', { code: code14 });
  ok('14.1 同步（导入存档码）成功', imp14.ok === true, JSON.stringify(imp14).slice(0, 90));
  const rng14 = await J('/api/track/range?from=0000-01-01&to=' + today);
  const flat14 = (rng14.days || []).flatMap((d) => d.path || []);
  const local14 = flat14.filter((p) => Math.abs(Number(p.lat) - 22.60) < 0.01).length;
  const peer14 = flat14.filter((p) => Math.abs(Number(p.lat) - 23.10) < 0.01).length;
  ok('14.2 新设备先走的那段没有丢（合并保留）', local14 === 2, 'local=' + local14);
  ok('14.3 邮箱里另一台设备的数据也并进来了', peer14 === 2 && (rng14.days || []).length === 2,
    'peer=' + peer14 + ' days=' + (rng14.days || []).length);
  const lp14 = await J('/api/lastpos');
  ok('14.4 续走点按时间戳取最新（=本机先走的那段）', lp14.pos !== null && Math.abs(Number(lp14.lat) - 22.60) < 0.01,
    JSON.stringify(lp14).slice(0, 90));
  const ss14 = await J('/api/sessions');
  const ns14 = (ss14.starts || []).map((x) => x.n).sort((a, b) => a - b);
  ok('14.5 出发序号合并后全局重排（连续且无重复）', ns14.length >= 2 && ns14[0] === 1 && ns14.every((v, i) => v === i + 1), ns14.join(','));
  const sn14b = await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 22.70, lng: 114.20 });
  ok('14.6 下一次出发序号 = 合并后总数 + 1', sn14b.sessionNo === ns14.length + 1, 'sessionNo=' + sn14b.sessionNo + ' total=' + ns14.length);

  console.log('\n== 16. 区域修复可撤销（覆写前留备份） ==');
  const before16 = await J('/api/track/range?from=0000-01-01&to=' + today);
  const ptsBefore16 = (before16.days || []).reduce((n, d) => n + (d.path || []).length, 0);
  await post('/api/track/rewrite', { date: today, points: [
    { t: Date.now() - 5000, lat: 23.20, lng: 113.40, road: '修复路', spd: 5, mode: 'walk' },
    { t: Date.now() - 4000, lat: 23.2005, lng: 113.40, road: '修复路', spd: 5, mode: 'walk' },
  ] });
  const mid16 = await J('/api/track/range?from=0000-01-01&to=' + today);
  const today16 = (mid16.days || []).find((d) => d.date === today) || { path: [] };
  ok('16.1 修复覆写已生效（当天只剩修复后的 2 个点）', (today16.path || []).length === 2, 'today=' + (today16.path || []).length);
  const undo16 = await post('/api/track/restore-backup', { date: today });
  ok('16.2 撤销成功', undo16.ok === true, JSON.stringify(undo16).slice(0, 80));
  const after16 = await J('/api/track/range?from=0000-01-01&to=' + today);
  const ptsAfter16 = (after16.days || []).reduce((n, d) => n + (d.path || []).length, 0);
  ok('16.3 撤销后恢复到修复前的点数', ptsAfter16 === ptsBefore16, 'restored=' + ptsAfter16 + ' want=' + ptsBefore16);
  const undo16b = await post('/api/track/restore-backup', { date: today });
  ok('16.4 无备份时撤销给出提示', undo16b.ok === false && !!undo16b.error, JSON.stringify(undo16b).slice(0, 80));

  console.log('\n== 18. 汇总统计重算（修「日报只剩几百米」） ==');
  // 造一段全天轨迹 + 用「一小段」的 stats 结束漫游（模拟行进中重复起步被覆盖）
  const day18 = today;
  for (let i = 0; i < 3; i++) {
    await post('/api/session/start', { date: day18, city: '深圳', scope: 'city', lat: 23.30 + i * 0.001, lng: 113.45 });
  }
  const pts18 = [];
  // 直接算坐标（每点约 40m 向东偏北，累计约 9.6km），不依赖 Geo 模块
  for (let i = 0; i < 240; i++) {
    pts18.push({
      t: Date.now() - (240 - i) * 30000,
      lat: 23.30 + i * 0.00012 + (i % 5) * 0.00004,
      lng: 113.45 + i * 0.00032,
      road: '重算路' + (i % 4), spd: 5, mode: 'walk', no: i < 200 ? 1 : 2,
    });
  }
  await post('/api/track/path', { date: day18, points: pts18 });
  // 关键：只上报"一小段"的 stats（模拟被小段覆盖）
  const end18 = await post('/api/session/end', { date: day18, stats: { distance: 200, duration: 30000, totalKeys: 5, rolls: 1 } });
  ok('18.1 结束漫游返回的 stats 已是全天口径（不被小段覆盖）', Number(end18.stats && end18.stats.distance) > 5000,
    'distance=' + (end18.stats && end18.stats.distance));
  const re18 = await post('/api/stats/recompute', { date: day18 });
  ok('18.2 重算接口成功返回', re18.ok === true, JSON.stringify(re18).slice(0, 80));
  ok('18.3 重算后里程与原始轨迹一致（>5km）', Number((re18.stats || {}).distance) > 5000, 'distance=' + (re18.stats || {}).distance);
  const rng18 = await J('/api/track/range?from=' + day18 + '&to=' + day18);
  const ptsNow18 = ((rng18.days || [])[0] || { path: [] }).path || [];
  const re18b = await post('/api/stats/recompute', { date: day18 });
  const rng18b = await J('/api/track/range?from=' + day18 + '&to=' + day18);
  const ptsAfter18 = ((rng18b.days || [])[0] || { path: [] }).path || [];
  ok('18.4 重算不动轨迹点（点数前后一致）', ptsAfter18.length === ptsNow18.length && ptsNow18.length > 200,
    `before=${ptsNow18.length} after=${ptsAfter18.length} fwd=${JSON.stringify((re18b.days || [])[0] || {}).slice(0, 60)}`);
  const reAll18 = await post('/api/stats/recompute', {});
  ok('18.5 不传日期时重算全部日期', reAll18.ok === true && Array.isArray(reAll18.days) && reAll18.days.length >= 1,
    'days=' + ((reAll18.days || []).length));
  const rep18 = await post('/api/report/' + day18);
  ok('18.6 生成日报时自动校正（接口返回 stats 为全天口径）',
    rep18.ok === true && Number((rep18.stats || {}).distance) > 5000, 'distance=' + (rep18.stats || {}).distance);

  console.log('\n== 19. 重复起步闸门（接口层） ==');
  // 「第 13 次出发点」故障的源头：行进中重复点出发 → 引擎清零累计 → 结束上报几百米。
  // 这里验证接口层确实把同一位置的重复出发挡住，并且极小段上报会被标记为"已忽略"。
  const dupA = await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 24.10, lng: 115.10 });
  const dupB = await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 24.10, lng: 115.10 });
  ok('19.1 同位置连续两次出发只算一次（接口返回 reused）',
    dupB.reused === true && dupB.sessionNo === dupA.sessionNo,
    JSON.stringify({ a: dupA.sessionNo, b: dupB.sessionNo, reused: dupB.reused }));
  const dupForce = await post('/api/session/start', { date: today, city: '深圳', scope: 'city', lat: 24.10, lng: 115.10, forceStart: true });
  ok('19.2 forceStart=true 时允许显式新增一次出发',
    dupForce.reused === false && dupForce.sessionNo === dupA.sessionNo + 1,
    JSON.stringify({ n: dupForce.sessionNo }));

  // 极小段上报被明确标记（前端据此给日志提示，不再让用户以为数据丢了）
  const stBefore19 = await J('/api/stats?range=day');
  const distBefore19 = Number(stBefore19.agg.totalDistance) || 0;
  const endMin = await post('/api/session/end', { date: today, stats: { distance: 60, duration: 20000, totalKeys: 3, rolls: 0 } });
  ok('19.3 极小段上报被标记为未采纳', endMin.statsAccepted === false, JSON.stringify(endMin).slice(0, 80));
  const stAfter19 = await J('/api/stats?range=day');
  ok('19.4 极小段上报没有把当天汇总打回小值',
    Number(stAfter19.agg.totalDistance) >= distBefore19,
    `${distBefore19} → ${stAfter19.agg.totalDistance}`);

  console.log('\n== 20. 轨迹归属自愈（修「某次出发 0 点 / 某段轨迹没画出来」） ==');
  // 历史 bug：renumberSessions 只改 sessions[].n 没同步改 path[].no，
  // 于是同步合并/回滚后轨迹点的会话号成了孤儿 → 出发记录显示 0 点、地图断笔。
  // 这里直接造出「点的 no 是孤儿」的数据，再调自愈接口，验证能修回来。
  const fixDay = '2026-08-20';
  const start20 = await post('/api/session/start', { date: fixDay, city: '深圳', scope: 'city', lat: 24.20, lng: 115.20 });
  // 点的 t 必须晚于出发瞬间（否则归属逻辑会把它们算到更早的那次出发上）
  const fixT0 = Date.now();
  await post('/api/track/path', { date: fixDay, points: [
    { t: fixT0 + 1000, lat: 24.2001, lng: 115.2001, spd: 5, no: 999 },
    { t: fixT0 + 2000, lat: 24.2002, lng: 115.2002, spd: 5, no: 999 },
  ] });
  const before20 = await J('/api/sessions');
  const orphanEntry = (before20.starts || []).find((s) => Number(s.n) === Number(start20.sessionNo));
  const ptsBefore20 = (orphanEntry && orphanEntry.points) || 0;
  ok('20.1 两个孤儿会话号的点没被计入该次出发',
    Boolean(orphanEntry) && ptsBefore20 <= 1,
    `#${start20.sessionNo} 修前 points=${ptsBefore20}（2 个孤儿点 no=999 未被计入）`);
  const rep20 = await post('/api/track/repair-links', {});
  ok('20.2 自愈接口执行成功且报告修正数',
    rep20.ok === true && Number(rep20.fixed) >= 2,
    JSON.stringify({ fixed: rep20.fixed, days: rep20.days, orphan: rep20.orphanBefore }).slice(0, 120));
  // 断言"归属已对齐"：不再有孤儿点，且该天的点都归到了某次真实存在的出发上
  const after20 = await J('/api/sessions');
  const realNs = new Set((after20.starts || []).map((s) => Number(s.n)));
  const rep20c = await post('/api/track/repair-links', {});
  ok('20.3 自愈后不再有孤儿点（幂等，二次修正 0 个）',
    rep20c.ok === true && Number(rep20c.fixed) === 0,
    JSON.stringify({ fixed: rep20c.fixed }));
  const tr20 = await J('/api/track/range?from=' + fixDay + '&to=' + fixDay);
  const pts20 = ((tr20.days || [])[0] || {}).path || [];
  ok('20.4 轨迹点本身一个没丢、坐标未变、且都归属到真实出发',
    pts20.length === 2 && Math.abs(pts20[0].lat - 24.2001) < 1e-6
      && pts20.every((p) => realNs.has(Number(p.no))),
    'path=' + pts20.length + ' 归属=' + JSON.stringify(pts20.map((p) => p.no)));
  const totalPts20 = (after20.starts || []).reduce((a, s) => a + (Number(s.points) || 0), 0);
  ok('20.5 修复后出发点数总和覆盖了全部轨迹点',
    totalPts20 >= pts20.length,
    `出发点数总和=${totalPts20} 当日轨迹=${pts20.length}`);

  console.log('\n== 15. 每小时自动存档配置 ==');
  const cfg15 = await J('/api/config');
  ok('15.1 hourlyMailArchive 默认开启', cfg15.hourlyMailArchive !== false, 'value=' + cfg15.hourlyMailArchive);
  await post('/api/config', { hourlyMailArchive: false });
  const cfg15b = await J('/api/config');
  ok('15.2 可以关掉每小时自动存档', cfg15b.hourlyMailArchive === false, 'value=' + cfg15b.hourlyMailArchive);
  await post('/api/config', { hourlyMailArchive: true });
  const cfg15c = await J('/api/config');
  ok('15.3 可以再打开', cfg15c.hourlyMailArchive === true, 'value=' + cfg15c.hourlyMailArchive);

  console.log('\n== 17. 收集册删除 ==');
  const add17a = await post('/api/places/add', { date: today, places: [ { name: '待删医院', cat: '医院', lat: 23.2, lng: 113.4 } ] });
  ok('17.1 收录待删地点', add17a.ok && add17a.added === 1, JSON.stringify(add17a).slice(0,80));
  const rm17 = await post('/api/places/remove', { date: today, name: '待删医院' });
  ok('17.2 删除成功', rm17.ok && rm17.removed === 1, JSON.stringify(rm17).slice(0,80));
  const sum17b = await J('/api/places/summary?from=0000-01-01&to=' + today);
  ok('17.3 删除后汇总不再包含', !(sum17b.byCat || {})['医院'], JSON.stringify(sum17b).slice(0,100));
  const rm17b = await post('/api/places/remove', { date: today, name: '不存在的地点' });
  ok('17.4 删除不存在的地点返回 0', rm17b.ok && rm17b.removed === 0, JSON.stringify(rm17b).slice(0,80));
  // 18. Key / 安全密钥：空串必须解释为"保持不变"（不能把已存的 Key 清掉）
  await post('/api/config', { amapKey: 'E2EKEY_aaaaaaaaaaaaaaaaaaaaaaaa', amapSecurityJsCode: 'E2ESEC_bbbbbbbbbbbbbbbbbbbbbbbb' });
  const cfg18 = await J('/api/config');
  ok('18.1 成对写入成功', cfg18.hasKey === true && cfg18.amapKeyMasked.indexOf('E2EKEY') === 0,
    JSON.stringify({ hasKey: cfg18.hasKey, mask: cfg18.amapKeyMasked }));
  // 只提交安全密钥、Key 留空 → Key 必须保持原值（用户就是在这一步把 Key 弄丢的）
  await post('/api/config', { amapSecurityJsCode: 'E2ESEC_cccccccccccccccccccccccc' });
  const cfg18b = await J('/api/config');
  ok('18.2 Key 留空 = 保持不变（不被清空）', cfg18b.hasKey === true && cfg18b.amapKeyMasked.indexOf('E2EKEY') === 0,
    JSON.stringify({ hasKey: cfg18b.hasKey, mask: cfg18b.amapKeyMasked }));
  ok('18.3 安全密钥已更新', cfg18b.amapSecurityJsCodeMasked.indexOf('E2ESEC') === 0
    && cfg18b.amapSecurityJsCodeMasked.slice(-2) === 'cc', cfg18b.amapSecurityJsCodeMasked);
  // Key 与密钥相同 → 忽略（多半是粘错了）
  await post('/api/config', { amapSecurityJsCode: 'E2EKEY_aaaaaaaaaaaaaaaaaaaaaaaa' });
  const cfg18c = await J('/api/config');
  ok('18.4 安全密钥与 Key 相同时被忽略', cfg18c.amapSecurityJsCodeMasked.slice(-2) === 'cc', cfg18c.amapSecurityJsCodeMasked);
  // 显式清除
  await post('/api/config', { amapKey: '__CLEAR__', amapSecurityJsCode: '__CLEAR__' });
  const cfg18d = await J('/api/config');
  ok('18.5 显式 __CLEAR__ 才清除', cfg18d.hasKey === false, JSON.stringify({ hasKey: cfg18d.hasKey }));

  console.log(`\n===== 端到端结果：${pass} 通过 / ${fail} 失败 =====\n`);
  return fail ? 1 : 0;
}

main()
  .then((code) => { cleanup(); process.exit(code); })
  .catch((e) => { console.log('[FATAL] ' + e.stack); cleanup(); process.exit(1); });
