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
  // 契约：importArchive 不返回 ok 字段（调用方别写 Boolean(imp.ok)，否则成功也判失败）
  ok(imp.ok === undefined && typeof imp.added === 'number', 'importArchive 不返回 ok 字段（调用方按异常判断成败）');
  // 存档码可携带本机配置，且导入时不自动应用
  const exp2 = exportArchive(s1, a1, { amapKey: 'K1', mailUser: 'u@qq.com', mailPass: 'p' });
  const imp3 = importArchive(exp2.code, s2, a2);
  ok('存档码能携带本机配置', imp3.cfg && imp3.cfg.amapKey === 'K1' && imp3.cfg.mailPass === 'p', JSON.stringify(imp3.cfg));
  ok('导出的存档码未带配置时 cfg 为 null',
    importArchive(exp.code, s2, a2).cfg === null);
  ok('importArchive 返回存档打包时间（供"谁更新"判断）',
    typeof importArchive(exp.code, s2, a2).at === 'number' && importArchive(exp.code, s2, a2).at > 0,
    String(importArchive(exp.code, s2, a2).at));
  try { importArchive('NW2.abcdef', s2, a2); ok(false, '错误前缀应报错'); }
  catch (_) { ok(true, '错误前缀被拒绝'); }

  console.log('\n== 7.5 收集册随存档同步 ==');
  const { PlaceStore } = require('./places.js');
  const p1 = new PlaceStore(tmpDir);
  p1.add('2026-09-10', [
    { name: '广州东站', cat: '车站', lat: 23.1492, lng: 113.3245, road: '东站路', t: 1789000000000 },
    { name: '测试人民医院', cat: '医院', lat: 23.1490, lng: 113.3240, road: '东站路', t: 1789000001000 },
  ]);
  const expP = exportArchive(s1, a1, null, p1);
  const p2 = new PlaceStore(path.join(tmpDir, 'b'));
  const impP = importArchive(expP.code, s2, a2, p2);
  ok(impP.places && impP.places.added === 2, '收集册随存档带走并合并（+2）', JSON.stringify(impP.places));
  const backPlaces = (p2.load().days['2026-09-10'] || []);
  ok(backPlaces.length === 2 && backPlaces[0].road === '东站路', '地点带着路名回来了',
    JSON.stringify(backPlaces.map((x) => x.name + '/' + x.road)));
  const impP2 = importArchive(expP.code, s2, a2, p2);
  ok(impP2.places && impP2.places.added === 0, '重复导入不产生重复地点（幂等）', JSON.stringify(impP2.places));
  ok((p2.load().days['2026-09-10'] || []).length === 2, '重复导入后地点总数不变');
  // 本机已有条目优先：只补缺失的 road
  p2.save({ v: 1, days: { '2026-09-10': [{ name: '测试人民医院', cat: '医院', lat: 23.149, lng: 113.324, t: 1789000001000 }] } });
  const impP3 = importArchive(expP.code, s2, a2, p2);
  const filled = (p2.load().days['2026-09-10'] || []).find((x) => x.name === '测试人民医院');
  ok(impP3.places.merged >= 1 && filled && filled.road === '东站路', '已有条目只补 road 不重复添加',
    JSON.stringify(filled));
  // 对端更晚重置 → 接管并清空本机收集册
  const dirD = path.join(tmpDir, 'd');
  const s4 = new TrackStore(dirD);
  s4.appendPath('2026-09-11', track);
  s4.setResetAt(1790000000000);                       // 对端重置得更晚
  const p4 = new PlaceStore(dirD);
  p4.add('2026-09-11', [{ name: '新的地点', cat: '医院', lat: 23.2, lng: 113.2, t: 1790000001000 }]);
  const expNew = exportArchive(s4, new AchievementStore(dirD), null, p4);
  const dirC = path.join(tmpDir, 'c');
  const p3 = new PlaceStore(dirC);
  p3.add('2026-09-10', [{ name: '旧地点', cat: '医院', lat: 23.1, lng: 113.1, t: 1700000000000 }]);
  const s3 = new TrackStore(dirC);
  s3.setResetAt(1700000000000);                       // 本机重置得更早
  const impTake = importArchive(expNew.code, s3, new AchievementStore(dirC), p3);
  const after = p3.load().days['2026-09-11'] || [];
  const oldLeft = Object.values(p3.load().days).flat().some((x) => x.name === '旧地点');
  ok(!oldLeft && after.some((x) => x.name === '新的地点'),
    '对端重置接管 → 本机旧收集册被清空并换成对端数据',
    JSON.stringify(Object.values(p3.load().days).flat().map((x) => x.name)));
  ok(impTake.resetTakeover === true, '接管标记为 true');

  console.log('\n== 7.6 回滚到某次出发（保留 ≤N，删掉之后几次） ==');
  const dirR = path.join(SMOKE_DIR, 'rollback');
  rmBestEffort(dirR);
  const sr = new TrackStore(dirR);
  const RD = '2026-09-15';
  {
    // 三次出发，直接写 sessions 保证时间戳递增（addSessionStart 用 Date.now() 会同毫秒）
    const d0 = sr.load(RD);
    d0.sessions = [
      { n: 1, lat: 23.10, lng: 113.30, t: 1000 },
      { n: 2, lat: 23.11, lng: 113.31, t: 2000 },
      { n: 3, lat: 23.12, lng: 113.32, t: 3000 },
    ];
    sr.markDirty(RD);
    sr.appendPath(RD, [
      { lat: 23.10, lng: 113.30, t: 1100, no: 1, road: 'A路' },
      { lat: 23.105, lng: 113.305, t: 1200, no: 1, road: 'A路' },
      { lat: 23.11, lng: 113.31, t: 2100, no: 2, road: 'B路' },
      { lat: 23.115, lng: 113.315, t: 2200, no: 2, road: 'B路' },
      { lat: 23.12, lng: 113.32, t: 3100, no: 3, road: 'C路' },
    ]);
    sr.appendRoll(RD, { t: 2100, lat: 23.11, lng: 113.31, road: 'B路', roll: 50, choice: '直行' });
    sr.appendRoll(RD, { t: 1100, lat: 23.10, lng: 113.30, road: 'A路', roll: 20, choice: '左转' });
    sr.flush();
  }
  ok(sr.allSessionStarts().length === 3, '准备：3 次出发', sr.allSessionStarts().length);
  const rb = sr.rollbackFrom(1);
  ok(rb.ok === true, '回滚成功');
  ok(rb.removedSessions === 2, '删掉 2 次出发（#2 #3）', rb.removedSessions);
  ok(rb.removedPoints === 3, '删掉 3 个轨迹点', rb.removedPoints);
  ok(sr.get(RD).path.length === 2 && sr.get(RD).path.every((p) => Number(p.no) === 1),
    '只剩第 1 次出发的轨迹', JSON.stringify(sr.get(RD).path.map((p) => p.no)));
  ok(sr.allSessionStarts().length === 1, '只剩 1 条出发记录');
  ok(sr.get(RD).rolls.length === 1, '被删那次的窗口内路口记录一并清掉', sr.get(RD).rolls.length);
  ok(Math.abs(rb.resumeCandidate.lat - 23.11) < 1e-6 && Math.abs(rb.resumeCandidate.lng - 113.31) < 1e-6,
    '继续点 = 第 1 次结束的位置', JSON.stringify(rb.resumeCandidate));
  ok(rb.cutoff === 2000, '分界线 = 第一次被删出发的时间', rb.cutoff);
  ok(rb.resumeCandidate.n === 1, '继续点记的是保留的那一次');
  const rb2 = sr.rollbackFrom(1);
  ok(rb2.ok === true && rb2.removedSessions === 0 && rb2.removedPoints === 0, '已是最新一次时不删任何数据');
  ok(rb2.resumeCandidate === null, '没有可删的就没有"继续点候选"');
  ok(sr.rollbackFrom(9).ok === false, '不存在的出发序号被拒绝');
  // 收集册：回滚时清掉之后那段时间收集的地点
  const pr = new PlaceStore(dirR);
  pr.add('2026-09-15', [
    { name: '早收录', cat: '医院', lat: 23.1, lng: 113.3, t: 1500 },
    { name: '晚收录', cat: '医院', lat: 23.1, lng: 113.3, t: 2500 },
  ]);
  ok(pr.removeSince(2000) === 1, '收集册按时间清掉回滚点之后的地点');
  ok((pr.load().days['2026-09-15'] || []).every((p) => p.name === '早收录'), '保留的是回滚点之前的地点');
  ok(pr.removeSince(0) === 0, 'cutoff 为 0 时不动数据（防误删）');
  // 搜索网格认领：同一片区域当天只认领一次（省高德额度）
  const c1 = pr.claimScan('2026-09-15', ['a', 'b', 'c']);
  ok(c1.fresh.length === 3 && c1.known === 0, '首次认领全部为新', JSON.stringify(c1));
  const c2 = pr.claimScan('2026-09-15', ['a', 'b', 'd']);
  ok(c2.fresh.length === 1 && c2.fresh[0] === 'd' && c2.known === 2, '已认领过的不再返回', JSON.stringify(c2));
  ok(pr.scanCount('2026-09-15') === 4, '今日已搜网格数累计正确', String(pr.scanCount('2026-09-15')));
  ok(pr.claimScan('2026-09-16', ['a']).fresh.length === 1, '换一天重新认领');
  pr.clearAll();
  ok(pr.scanCount('2026-09-15') === 0, '清空收集册时搜索记录一并清空');

  console.log('\n== 7.65 汇总统计不被「小段出发」覆盖（历史故障回归） ==');
  // 故障场景：全天走了很久，用户在行进中又开了一次出发（重复起步 / 设置继续点），
  // 结束时引擎只上报那一小段的 stats，旧代码直接 data.stats = stats → 全天汇总被打回小值，
  // 表现成「日报只剩几百米，看着像前面的轨迹全没了」。
  const dirStats = path.join(SMOKE_DIR, 'statsfix');
  const sStats = new TrackStore(dirStats);
  const t0 = Date.now() - 8 * 3600 * 1000;           // 8 小时前出发
  const longPath = [];
  let cur2 = { lat: 23.13, lng: 113.35 };
  for (let i = 0; i < 600; i++) {                    // 600 点 × ~30m ≈ 18km
    cur2 = G.destPoint(cur2, (i * 53) % 360, 30);
    longPath.push({ t: t0 + i * 40000, lat: cur2.lat, lng: cur2.lng, road: `长路${i % 5}`, spd: 5 + (i % 4), mode: 'walk', no: i < 500 ? 1 : 2 });
  }
  sStats.appendPath('2026-09-10', longPath);
  sStats.addSessionStart('2026-09-10', 23.13, 113.35);
  // 全天结束时引擎上报的是「一直走」的权威汇总
  sStats.finish('2026-09-10', { distance: 18000, duration: 8 * 3600 * 1000, totalKeys: 5000, rolls: 20 });
  const goodStats = sStats.get('2026-09-10').stats;
  ok(Math.round(goodStats.distance) === 18000, '正常结束：全天汇总=引擎上报值', goodStats.distance);

  // 旧数据被小段覆盖后的样子：distance 只剩刚起步那点
  sStats.get('2026-09-10').stats.distance = 320;
  sStats.get('2026-09-10').stats.duration = 41000;
  sStats.markDirty('2026-09-10');
  sStats.flush();
  const fixed = sStats.recomputeStats('2026-09-10');
  ok(fixed.distance > 15000, '被小段覆盖的里程能按原始轨迹修回来', `${fixed.distance}m`);
  ok(fixed.duration > 4 * 3600 * 1000, '被截断的时长能修回来', `${(fixed.duration / 3600000).toFixed(1)}h`);
  ok(fixed.rolls === 20, '路口次数取 stats 与 rolls 记录的较大者', String(fixed.rolls));
  ok(sStats.get('2026-09-10').path.length === 600, '重算不动轨迹点', String(sStats.get('2026-09-10').path.length));
  // 幂等：重算两次结果一致
  const again = sStats.recomputeStats('2026-09-10');
  ok(Math.round(again.distance) === Math.round(fixed.distance), '重算是幂等的', `${again.distance}`);

  // 不会再被"小段 stats"打回去：小值进 finish 也不会把大值覆盖掉
  sStats.finish('2026-09-10', { distance: 320, duration: 41000 });
  const afterSmall = sStats.get('2026-09-10').stats;
  ok(afterSmall.distance > 15000, '结束时上报小段 stats 不会覆盖全天汇总（本次修复的核心）', `${afterSmall.distance}m`);

  // 引擎上报的权威值仍被尊重：几何量没明显超出的情况不擅自改写
  const dirKeep = path.join(SMOKE_DIR, 'statkeep');
  const sKeep = new TrackStore(dirKeep);
  let cur3 = { lat: 23.13, lng: 113.35 };
  const shortPath = [];
  for (let i = 0; i < 100; i++) {
    cur3 = G.destPoint(cur3, (i * 31) % 360, 25);
    shortPath.push({ t: t0 + i * 6000, lat: cur3.lat, lng: cur3.lng, road: '短路', spd: 4, mode: 'walk' });
  }
  sKeep.appendPath('2026-09-10', shortPath);
  sKeep.finish('2026-09-10', { distance: 9999, duration: 600000 });
  const kept = sKeep.recomputeStats('2026-09-10');
  ok(Math.round(kept.distance) === 9999, '引擎上报的权威里程不被几何抖动改写', `${kept.distance}m`);

  console.log('\n== 7.7 今日路过：路名清单（不调用高德） ==');
  const dirRoad = path.join(SMOKE_DIR, 'roads');
  rmBestEffort(dirRoad);
  const sRd = new TrackStore(dirRoad);
  sRd.appendPath('2026-09-16', [
    { lat: 23.10, lng: 113.30, t: 1000, road: '天润路', no: 1 },
    { lat: 23.1005, lng: 113.3005, t: 2000, road: '天润路', no: 1 },   // ~70m
    { lat: 23.101, lng: 113.301, t: 3000, road: '广园快速路辅路', no: 1 },
    { lat: 23.1015, lng: 113.3015, t: 4000, road: '天润路', no: 2 },   // 又走回天润路
    { lat: 23.102, lng: 113.302, t: 5000, road: '', no: 2 },           // 无路名：不计入
  ]);
  const rd = sRd.roadsOn('2026-09-16');
  ok(rd.roads.length === 2, '按天聚合出路名（无路名的点跳过）', rd.roads.map((r) => r.name).join(','));
  ok(rd.roads[0].name === '天润路' && rd.roads[0].points === 3, '同一路名跨会话合并计数', JSON.stringify(rd.roads[0]));
  ok(rd.roads[0].firstT === 1000 && rd.roads[0].lastT === 4000, '记录首次/最后经过时间');
  ok(rd.roads[0].meters > 100 && rd.roads[0].meters < 200, '累计里程在合理范围（米）', String(rd.roads[0].meters));
  ok(rd.roads[1].name === '广园快速路辅路' && rd.roads[1].points === 1, '第二条路单独统计');
  ok(rd.roads.map((r) => r.name).join(',') === '天润路,广园快速路辅路', '按"第一次走上"的时间排序（当天走过的顺序）');
  const rr = sRd.roadsRange('2026-09-16', '2026-09-16');
  ok(rr.length === 1 && rr[0].date === '2026-09-16' && rr[0].roads.length === 2, '按天范围查询正常');
  ok(sRd.roadsOn('2026-01-01').roads.length === 0, '没有轨迹的日期返回空清单');

  console.log('\n== 7.8 原子写加固（多实例 rename 冲突 / 不丢数据） ==');
  const { atomicWrite } = require('./store.js');
  const dirW = path.join(SMOKE_DIR, 'atomic');
  rmBestEffort(dirW);
  fs.mkdirSync(dirW, { recursive: true });
  const fW = path.join(dirW, 'a.json');
  // ① 正常写入
  let r1 = atomicWrite(fW, JSON.stringify({ v: 1 }));
  ok(r1.ok === true && r1.mode === 'rename', '正常路径走 rename', JSON.stringify(r1));
  ok(JSON.parse(fs.readFileSync(fW, 'utf8')).v === 1, '内容写入正确');
  // ② 目录被删掉也能自愈（以前会 ENOENT）
  fs.rmSync(dirW, { recursive: true, force: true });
  const r2 = atomicWrite(fW, JSON.stringify({ v: 2 }));
  ok(r2.ok === true && fs.existsSync(fW), '目录被删后自动重建并写入', JSON.stringify(r2));
  // ③ 临时文件名必须唯一（多实例同时写时不能撞同一个 tmp —— 这就是用户遇到的 ENOENT）
  const names = [];
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (p, ...rest) => { if (String(p).endsWith('.tmp')) names.push(String(p)); return realWrite(p, ...rest); };
  atomicWrite(fW, JSON.stringify({ v: 3 }));
  atomicWrite(fW, JSON.stringify({ v: 4 }));
  fs.writeFileSync = realWrite;
  ok(names.length === 2 && names[0] !== names[1] && /\.\d+\.\d+\.tmp$/.test(names[0]),
    '临时文件名带 pid+序号（不会与另一个实例撞名）', names.join(' / '));
  ok(fs.readdirSync(dirW).filter((x) => x.endsWith('.tmp')).length === 0, '写完不留残 tmp');
  // ④ rename 短暂失败（被占用）→ 重试后成功
  const store2 = new TrackStore(path.join(SMOKE_DIR, 'atomic2'));
  store2.appendPath('2026-09-17', [{ lat: 23.1, lng: 113.3, t: 1000 }]);
  const realRename = fs.renameSync;
  let fails = 2;
  fs.renameSync = (a, b) => { if (fails-- > 0) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } return realRename(a, b); };
  store2.flush();
  fs.renameSync = realRename;
  ok(fails < 0 && fs.existsSync(store2.file('2026-09-17')), 'rename 被占用时重试成功', '剩余重试 ' + fails);
  ok(store2.dirty.size === 0, '成功写入后 dirty 清空');
  // ⑤ 一直失败 → dirty 必须保留（否则内存里的轨迹永久丢失）
  const store3 = new TrackStore(path.join(SMOKE_DIR, 'atomic3'));
  store3.appendPath('2026-09-17', [{ lat: 23.1, lng: 113.3, t: 2000 }]);
  fs.renameSync = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };
  const realWF = fs.writeFileSync;
  fs.writeFileSync = (p, ...rest) => { if (!String(p).endsWith('.tmp')) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; } return realWF(p, ...rest); };
  store3.flush();
  fs.renameSync = realRename;
  fs.writeFileSync = realWF;
  ok(store3.dirty.size === 1, '写不出去时保留 dirty（下个 tick 重试，不丢数据）', String(store3.dirty.size));
  ok(store3.get('2026-09-17').path.length === 1, '内存数据仍在');
  // ⑥ 实例锁：第二个实例在同目录启动要留下锁文件（用于提示多实例）
  ok(fs.existsSync(path.join(SMOKE_DIR, 'atomic3', 'instance.lock')), '启动时写入 instance.lock（多实例提示用）');
  ok(fs.existsSync(path.join(SMOKE_DIR, 'atomic3', 'tracks')), 'tracks 目录自动创建');

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

  console.log('\n== 9.5 高德诊断判定（换电脑加载失败排查） ==');
  const { classifyAmapProbe } = require('./amapcheck.js');
  ok(classifyAmapProbe({ keyed: false }).indexOf('没有配置高德 Key') >= 0, '无 Key → 提示去配置/同步');
  ok(classifyAmapProbe({ keyed: true, reachable: false, error: 'timeout', ms: 8000 }).indexOf('*.amap.com 设为直连') >= 0,
    '网络不通 → 提示代理直连');
  ok(classifyAmapProbe({ keyed: true, reachable: true, ms: 200, keyRejected: true }).indexOf('Web端(JS API)') >= 0,
    'Key 被拒 → 提示服务类型/白名单');
  ok(classifyAmapProbe({ keyed: true, reachable: true, ms: 285 }).indexOf('浏览器') >= 0,
    '一切正常 → 指向浏览器侧（代理/扩展/安全密钥）');

  console.log('\n== 10. 老板键判定 ==');  const { parseBossEnv, normalizeBoss, isBossEvent, KEYS } = require('./bosskey');
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

  // ---------- 邮箱正文解码（一键同步"找不到存档码"的根治点） ----------
  console.log('\n== N. 邮箱正文解码与存档码提取 ==');
  const mailbox = require(path.join(__dirname, 'mailbox'));
  const CODE = 'NW1.' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-'.repeat(2);   // 合法 base64url 形态
  const plainMail = 'NetWalk 存档码\r\n\r\n----- 存档码开始 -----\r\n' + CODE + '\r\n----- 存档码结束 -----\r\nmailUser=x@qq.com';
  const b64 = Buffer.from(plainMail, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const fetchResp = '* 42 FETCH (BODY[TEXT] {' + Buffer.byteLength(b64, 'utf8') + '}\r\n' + b64 + ')\r\nNW5 OK FETCH completed';

  ok('明文正文可直接提取存档码', mailbox.extractCode(plainMail) === CODE);
  ok('base64 密文直接提取会失败（复现旧 bug）', mailbox.extractCode(b64) === null);
  ok('decodeBody 能把 base64 正文解回明文',
    mailbox.decodeBody(fetchResp).indexOf('存档码开始') >= 0, mailbox.decodeBody(fetchResp).slice(0, 24));
  const ex = mailbox.extractCodeFromFetch(fetchResp);
  ok('extractCodeFromFetch 能从 base64 邮件里取出存档码', ex.code === CODE, ex.code);
  ok('非 base64 的普通正文原样返回', mailbox.decodeBody('* 7 FETCH (BODY[TEXT] {11}\r\nhello world)\r\nNW5 OK') === 'hello world');
  ok('没有存档码时 extractCodeFromFetch 返回 null',
    mailbox.extractCodeFromFetch('* 9 FETCH (BODY[TEXT] {5}\r\nhello)\r\nNW5 OK').code === null);
  // verify码邮件（也有 NetWalk 主题，但不含存档码）不能被误当成存档
  const codeMail = '你的 NetWalk 登录验证码是：123456';
  ok('验证码邮件不会被误认成存档', mailbox.extractCode(codeMail) === null);

  console.log('\n== N2. 存档邮件主题解析与候选排序（同步要选对存档） ==');
  const subjNew = '=?UTF-8?B?' + Buffer.from('NetWalk 存档 2026-09-16 17:23 · 客厅电脑', 'utf8').toString('base64') + '?=';
  const pNew = mailbox.parseArchiveSubject(subjNew);
  ok(pNew.dataAt === new Date(2026, 8, 16, 17, 23, 0, 0).getTime(), '能解析新格式主题的数据时间', new Date(pNew.dataAt).toISOString());
  ok(pNew.machine === '客厅电脑', '能解析机器名（MIME 编码中文）', pNew.machine);
  ok(pNew.label.indexOf('2026-09-16 17:23') === 0 && pNew.label.indexOf('客厅电脑') > 0, 'label 同时含时间与机器名', pNew.label);
  const pOld = mailbox.parseArchiveSubject('NetWalk 存档码（2026-09-15）');
  ok(pOld.legacy === true && pOld.machine === '' && pOld.dataAt === 0, '旧格式主题的数据时间视为未知（→ 会去读正文）', pOld.label);
  const pQ = mailbox.parseArchiveSubject('=?utf-8?Q?NetWalk_=E5=AD=98=E6=A1=A3_2026-09-16_08:05_=C2=B7_=E5=8A=9E=E5=85=AC=E5=AE=A4=E7=94=B5=E8=84=91?=');
  ok(pQ.machine === '办公室电脑', '能解码 Q 编码主题里的机器名', pQ.machine);
  const ranked = mailbox.rankArchiveCandidates([
    { mailId: 11, label: '数据旧但打包晚', dataAt: new Date(2026, 8, 16, 18, 44).getTime(), dataEndAt: new Date(2026, 8, 16, 12, 0).getTime(), mailDate: 1789000000000 },
    { mailId: 10, label: '数据新但打包早', dataAt: new Date(2026, 8, 16, 17, 23).getTime(), dataEndAt: new Date(2026, 8, 16, 17, 20).getTime(), mailDate: 1788000000000 },
    { mailId: 9, label: '旧版无时间', dataAt: 0, dataEndAt: 0, mailDate: 1787000000000 },
  ]);
  ok(ranked[0].mailId === 10, '排序优先「数据实际覆盖到的最新时刻」而不是打包/邮件时间', ranked.map((x) => x.mailId).join(','));
  ok(ranked[2].mailId === 9, '无数据时间的排最后', ranked.map((x) => x.mailId).join(','));
  // 数据覆盖时刻缺失时退到打包时间
  const ranked2 = mailbox.rankArchiveCandidates([
    { mailId: 21, dataAt: new Date(2026, 8, 16, 12, 0).getTime(), mailDate: 1 },
    { mailId: 22, dataAt: new Date(2026, 8, 16, 18, 0).getTime(), mailDate: 2 },
  ]);
  ok(ranked2[0].mailId === 22, '没有数据覆盖时刻时按打包时间排', ranked2.map((x) => x.mailId).join(','));
  const hdrText = 'Subject: ' + subjNew + '\r\nDate: Wed, 16 Sep 2026 17:25:00 +0800\r\n\r\n';
  const hdr = mailbox.parseHeaderFetch('* 12 FETCH (BODY[HEADER.FIELDS (SUBJECT DATE)] {' + Buffer.byteLength(hdrText) + '}\r\n' + hdrText + ')');
  const hp = mailbox.parseArchiveSubject(hdr.subject);
  ok(hp.machine === '客厅电脑' && hp.dataAt > 0 && hdr.mailDate > 0,
    '能从 header FETCH 响应解析主题（解码后）与邮件时间',
    hp.label + ' / ' + hdr.mailDate);

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====\n`);
  process.exit(fail ? 1 : 0);
});
