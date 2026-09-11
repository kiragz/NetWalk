// 临时冒烟测试：验证速度换算、演练路网、路径规划与日报生成
const path = require('path');
const fs = require('fs');
const os = require('os');

/** 目录统一放系统临时目录，且删除失败不影响测试结果
 *  （有些环境会把删除重定向到回收站，可能失败或超时） */
const SMOKE_DIR = path.join(os.tmpdir(), `netwalk-smoke-${process.pid}`);
function rmBestEffort(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
}

global.window = global;
require(path.join(__dirname, '..', 'public', 'js', 'speed.js'));
require(path.join(__dirname, '..', 'public', 'js', 'provider-drill.js'));
require(path.join(__dirname, '..', 'public', 'js', 'engine.js'));

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  [OK]   ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra !== undefined ? '→ ' + extra : ''}`); }
}

console.log('\n== 1. 速度换算 ==');
const S = global.NetWalkSpeed;
const cases = [
  { in: { rx: 0, tx: 0, kpm: 0 }, name: '完全静止' },
  { in: { rx: 50 * 1024, tx: 10 * 1024, kpm: 0 }, name: '低速下载' },
  { in: { rx: 2 * 1024 * 1024, tx: 300 * 1024, kpm: 60 }, name: '常见办公' },
  { in: { rx: 10 * 1024 * 1024, tx: 2 * 1024 * 1024, kpm: 200 }, name: '高速下载+打字' },
  { in: { rx: 50 * 1024 * 1024, tx: 10 * 1024 * 1024, kpm: 400 }, name: '满速狂飙' },
];
let prev = -1;
for (const c of cases) {
  const r = S.convert(c.in);
  console.log(`  ${c.name.padEnd(14)} ${String(r.speedKmh).padStart(6)} km/h  ${r.icon}${r.label}  强度${(r.intensity * 100).toFixed(0)}%`);
  ok(r.speedKmh >= 0 && r.speedKmh <= 25, `${c.name} 速度在合理区间`, r.speedKmh);
  ok(r.speedKmh >= prev, `${c.name} 速度单调不降`);
  prev = r.speedKmh;
}

console.log('\n== 2. ROLL100 路口决策 ==');
const dist = {};
for (let i = 0; i < 3000; i++) {
  const r = S.rollJunction(1 + Math.floor(Math.random() * 100), 45);
  dist[r.choice] = (dist[r.choice] || 0) + 1;
  if (r.roll < 1 || r.roll > 100) { ok(false, 'roll 越界', r.roll); break; }
  if (!Number.isFinite(r.bearing) || r.bearing < 0 || r.bearing >= 360) { ok(false, 'bearing 越界', r.bearing); break; }
  if (!(r.distance > 0)) { ok(false, 'distance 非正', r.distance); break; }
}
console.log('  分布:', JSON.stringify(dist));
ok(Object.keys(dist).length >= 4, '至少出现 4 种决策');
ok((dist['直行'] || 0) > (dist['掉头'] || 0), '直行概率高于掉头');

console.log('\n== 3. 演练路网与路径规划 ==');
const p = new global.DrillProvider({ origin: { lng: 114.057868, lat: 22.543099 }, spacing: 165, extent: 34 });
p._build();
console.log(`  节点 ${p.nodes.length} 个，道路 ${p.edges.length} 条`);
ok(p.nodes.length === 34 * 34, '节点数正确', p.nodes.length);
ok(p.edges.length > 34 * 33, '道路数合理', p.edges.length);

// 连通性：从中心能到达所有节点
const center = p.nodes[Math.floor(p.nodes.length / 2)];
const from = { lat: center.lat, lng: center.lng };
let reachable = 0;
const far = p.nodes[p.nodes.length - 1];
p.planRoute(from, { lat: far.lat, lng: far.lng }).then(async (route) => {
  ok(route !== null, '最远点可达（路网连通）');
  if (route) {
    console.log(`  路径 ${route.points.length} 个点，${(route.distance / 1000).toFixed(2)} km，途经 ${route.steps.length} 条路`);
    ok(route.points.length >= 2, '路径点数 >= 2');
    ok(route.distance > 0, '路径长度 > 0');
    ok(route.steps.length > 0 && route.steps.every((s) => s.road), '每段都有路名');
    console.log('  途经路名样例:', route.steps.slice(0, 5).map((s) => s.road).join(' → '));
  }

  const road = await p.roadAt(center.lat, center.lng);
  ok(typeof road === 'string' && road.length > 0, '可取到路名', road);
  console.log('  当前路名:', road);

  console.log('\n== 4. 地理计算 ==');
  const G = global.NetWalkGeo;
  const a = { lat: 22.543099, lng: 114.057868 };
  const d = G.haversine(a, G.destPoint(a, 0, 1000));
  ok(Math.abs(d - 1000) < 5, '正北 1000m 距离正确', d.toFixed(2));
  const b = G.destPoint(a, 90, 1000);
  ok(Math.abs(G.haversine(a, b) - 1000) < 5, '正东 1000m 距离正确');
  ok(Math.abs(G.bearingOf(a, b) - 90) < 1, '正东方位角 = 90°', G.bearingOf(a, b).toFixed(2));

  console.log('\n== 5. 日报生成 ==');
  const { buildReportHtml } = require(path.join(__dirname, 'report.js'));
  const now = Date.now();
  const track = [];
  let cur = { lat: 22.543099, lng: 114.057868 };
  for (let i = 0; i < 120; i++) {
    cur = G.destPoint(cur, (i * 37) % 360, 25 + (i % 7) * 6);
    track.push({ t: now + i * 2000, lat: cur.lat, lng: cur.lng, road: `测试路${i % 9}`, spd: 3 + (i % 5), mode: 'walk' });
  }
  const data = {
    date: '2026-09-10', startedAt: now, endedAt: now + 240000, city: '深圳',
    path: track,
    samples: Array.from({ length: 40 }, (_, i) => ({ t: now + i * 6000, rx: 1024 * (100 + i * 30), tx: 1024 * (20 + i * 5), kpm: 40 + i * 4, spd: 3 + (i % 5), mode: 'walk' })),
    rolls: Array.from({ length: 22 }, (_, i) => ({ t: now + i * 11000, lat: cur.lat, lng: cur.lng, road: `测试路${i % 9}`, roll: 1 + ((i * 13) % 100), choice: '直行', bearing: 90 })),
    stats: null,
  };
  const html = buildReportHtml(data, { city: '深圳' });
  ok(html.includes('<!DOCTYPE html>'), '日报是完整 HTML');
  ok(html.includes('NetWalk 今日漫游日报'), '日报含标题');
  ok(html.includes('2026-09-10'), '日报含日期');
  ok(html.includes('<svg'), '日报含 SVG 轨迹图');
  ok(html.includes('测试路'), '日报含路名排行');
  ok(html.includes('路口 ROLL100'), '日报含 ROLL 分布');
  ok(!html.includes('undefined') && !html.includes('NaN'), '日报无 undefined/NaN');
  const out = path.join(SMOKE_DIR, '_smoke.html');
  fs.mkdirSync(SMOKE_DIR, { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  console.log('  日报已写出:', out, `(${html.length} 字节)`);

  console.log('\n== 6. 成就判定 ==');
  const achMod = require('./achievements.js');
  const achDef = require('../public/js/achievements.js');
  const fakeAgg = {
    totalDistance: 200000, maxDayDistance: 22000, totalDuration: 3600000,
    totalKeys: 50000, totalRolls: 300, totalRx: 5 * 1024 ** 3, totalTx: 1024 ** 3,
    uniqueRoads: 120, activeDays: 10, maxSpeed: 16, streakDays: 5,
    cities: ['深圳', '北京'], scopes: ['china'], litCells: 400, totalPoints: 1000,
  };
  const hitIds = achDef.evaluate(fakeAgg);
  ok(hitIds.length >= 8, '成就命中数量合理', hitIds.length);
  ok(hitIds.includes('dist_10k'), '命中「单日 10km」');
  ok(hitIds.includes('city_2'), '命中「双城记」');
  ok(hitIds.includes('nat_china'), '命中「走遍中国」');
  ok(!hitIds.includes('dist_42k'), '未达成的高门槛成就未误判');
  ok(!hitIds.includes('days_30'), '未达成的连续成就未误判');
  ok(achDef.ACHIEVEMENTS.length >= 30, '成就总数 >= 30', achDef.ACHIEVEMENTS.length);
  const badge = achDef.badgeSvg(achDef.byId('dist_10k'), true, 64);
  ok(badge.includes('<svg') && badge.includes('🏃'), '勋章 SVG 正常生成');
  const locked = achDef.badgeSvg(achDef.byId('dist_42k'), false, 64);
  ok(locked.includes('grayscale'), '未解锁勋章灰显');
  ok(achDef.wallHtml({ dist_10k: Date.now() }, 'all').includes('ach-grid'), '成就墙 HTML 渲染正常');

  console.log('\n== 7. 存档码往返 ==');
  const { exportArchive, importArchive } = require('./archive.js');
  const { TrackStore } = require('./store.js');
  const { AchievementStore } = require('./achievements.js');
  const tmpDir = path.join(SMOKE_DIR, 'archive');
  rmBestEffort(tmpDir);
  const s1 = new TrackStore(tmpDir);
  const a1 = new AchievementStore(tmpDir);
  s1.appendPath('2026-09-10', track);
  s1.appendRoll('2026-09-10', { t: Date.now(), lat: 22.5, lng: 114.0, road: '测试路', roll: 50, choice: '直行' });
  s1.setContext('2026-09-10', { city: '深圳', scope: 'city' });
  s1.finish('2026-09-10', { distance: 5000, duration: 3600000, totalKeys: 1200 });
  const exp = exportArchive(s1, a1);
  ok(exp.code.startsWith('NW1.'), '存档码前缀正确');
  ok(exp.bytes < exp.rawBytes, '存档码体积已压缩', `${exp.bytes} < ${exp.rawBytes}`);
  ok(exp.days === 1, '存档天数正确', exp.days);

  const s2 = new TrackStore(path.join(tmpDir, 'b'));
  const a2 = new AchievementStore(path.join(tmpDir, 'b'));
  const imp = importArchive(exp.code, s2, a2);
  ok(imp.added === 1, '导入新增 1 天', imp.added);
  const back = s2.get('2026-09-10');
  ok(back.path.length === track.length, '往返后轨迹点数一致', `${back.path.length} vs ${track.length}`);
  ok(back.rolls.length === 1, '往返后路口记录一致');
  ok(back.city === '深圳', '往返后城市信息保留');
  const imp2 = importArchive(exp.code, s2, a2);
  ok(imp2.merged === 1, '重复导入走合并分支', imp2.merged);
  ok(s2.get('2026-09-10').path.length === track.length, '重复导入未产生重复点');
  try { importArchive('THIS_IS_NOT_A_CODE', s2, a2); ok(false, '非法存档码应报错'); }
  catch (_) { ok(true, '非法存档码被拒绝'); }
  try { importArchive('NW2.abcdef', s2, a2); ok(false, '错误前缀应报错'); }
  catch (_) { ok(true, '错误前缀被拒绝'); }

  console.log('\n== 8. 聚合统计 ==');
  const agg = s2.aggregate();
  ok(agg.days === 1, '聚合天数正确', agg.days);
  ok(agg.totalDistance > 0, '聚合里程 > 0', Math.round(agg.totalDistance));
  ok(agg.uniqueRoads > 0, '路名去重 > 0', agg.uniqueRoads);
  ok(agg.litCells > 0, '点亮网格 > 0', agg.litCells);
  ok(agg.perDay.length === 1, 'perDay 明细存在');
  ok(Array.isArray(agg.cities) && agg.cities.includes('深圳'), '城市聚合正确');
  const monthAgg = s2.aggregate({ from: '2026-09-01', to: '2026-09-30' });
  ok(monthAgg.days === 1, '按月区间过滤正确');
  const emptyAgg = s2.aggregate({ from: '2020-01-01', to: '2020-12-31' });
  ok(emptyAgg.days === 0, '空区间返回 0 天');

  // 里程口径回归：地图尺度会放大坐标位移，几何长度 ≠ 真实里程，
  // 必须优先采用 stats.distance / 采样中的 dist
  ok(Math.round(agg.totalDistance) === 5000, '里程优先取 stats 上报值（而非几何长度）', agg.totalDistance);
  s2.setContext('2026-09-11', { city: '深圳', scope: 'china' });
  s2.appendSample('2026-09-11', { t: Date.now(), rx: 0, tx: 0, kpm: 0, spd: 5, mode: 'walk', dist: 8888 });
  const agg2 = s2.aggregate();
  ok(agg2.days === 2, '加入仅采样的天数', agg2.days);
  ok(Math.round(agg2.totalDistance) === 13888, '无 stats 时回退到采样 dist', agg2.totalDistance);
  const d11 = agg2.perDay.find((x) => x.date === '2026-09-11');
  ok(d11 && d11.distance === 8888, '仅采样日也进入 perDay 明细', d11 && d11.distance);
  s2.remove('2026-09-11');

  console.log('\n== 9. 分享卡片数据 ==');
  const shareMod = require('../public/js/share.js');
  const shareTxt = shareMod.buildText({
    date: '2026-09-10', distance: 12000, duration: 7200000, avgSpeed: 6,
    maxSpeed: 14, keys: 3000, rolls: 30, rxTotal: 2 * 1024 ** 3, txTotal: 1024 ** 2,
    litCells: 88, uniqueRoads: 24,
  });
  ok(shareTxt.includes('12.00 公里'), '分享文案含里程');
  ok(shareTxt.includes('#NetWalk'), '分享文案含话题标签');
  ok(shareMod.fmtBytes(1536) === '1.5 KB', '字节格式化正确', shareMod.fmtBytes(1536));

  console.log('\n== 10. 老板键判定 ==');
  const { parseBossEnv, normalizeBoss, isBossEvent, KEYS } = require('./bosskey');
  const def = parseBossEnv({});
  ok(def.enabled === true && def.key === 67, '老板键默认 F9(67) 且启用', def.key);
  ok(parseBossEnv({ NETWALK_BOSS_ENABLED: '0' }).enabled === false, '可用环境变量关闭老板键');
  ok(parseBossEnv({ NETWALK_BOSS_MODS: 'ctrl,shift,xxx' }).mods.join(',') === 'ctrl,shift', '修饰键只保留合法值');
  ok(normalizeBoss({ key: 35, mods: 'ctrl,shift' }).key === 35, '配置里的键码原样保留');
  ok(normalizeBoss(undefined).key === KEYS.F9, '空配置回落到 F9');
  ok(isBossEvent({ keycode: 67 }, def) === true, 'F9 命中老板键');
  ok(isBossEvent({ keycode: 68 }, def) === false, 'F10 不误触');
  ok(isBossEvent({ keycode: 67 }, { ...def, enabled: false }) === false, '关闭后不触发');
  const combo = normalizeBoss({ key: 35, mods: 'ctrl,shift' });
  ok(isBossEvent({ keycode: 35, ctrlKey: true, shiftKey: true }, combo) === true, '组合键同时按下才命中');
  ok(isBossEvent({ keycode: 35, ctrlKey: true }, combo) === false, '少按一个修饰键不触发');
  ok(isBossEvent(null, def) === false, '空事件不触发');

  console.log('\n== 11. 老板键事件透传 ==');
  const { KeyMonitor } = require('./keymon');
  const km = new KeyMonitor();
  let bossFired = 0;
  km.on('boss', () => { bossFired += 1; });
  km._onChildMessage({ type: 'boss' });
  km._onChildMessage({ type: 'snapshot', kpm: 120, wpm: 24, total: 5, peakKpm: 200, activeMs: 100, lastKeyAt: 1 });
  km._onChildMessage(null);
  ok(bossFired === 1, '子进程 boss 消息触发一次事件', bossFired);
  ok(km._global.kpm === 120, '快照照常被吸收（不受老板键影响）', km._global.kpm);

  s1.dispose(); s2.dispose();
  rmBestEffort(SMOKE_DIR);

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====\n`);
  process.exit(fail ? 1 : 0);
});
