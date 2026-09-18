/**
 * 轨迹与日报持久化（本地 JSON，按天分文件）
 */
const fs = require('fs');
const path = require('path');

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EARTH_R = 6371000;
const CELL_DEG = 0.00135; // 约 150m 网格，用于「点亮街区」统计

let TMP_SEQ = 0;

/** 同步等待（Node 主线程里也能用） */
function sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (_) { const t = Date.now(); while (Date.now() - t < ms) { /* 兜底忙等 */ } }
}

/**
 * 原子写文件（写 tmp → rename），带三重加固（都是踩过的坑）：
 *  ① tmp 名必须带 pid + 序号：两个实例写同一个数据目录时，固定 `<file>.tmp` 会被对方 rename 走 → ENOENT
 *  ② rename 到被占用的目标会 EPERM/EBUSY（Windows 上杀毒软件或另一实例持有句柄）→ 短暂重试
 *  ③ 重试用尽就直写目标文件兜底：宁可少一点原子性，也不能把内存里的轨迹丢掉
 * @returns {{ok:boolean, mode?:string, code?:string, error?:string}}
 */
function atomicWrite(file, text, dir) {
  const d = dir || path.dirname(file);
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) { /* 目录被删过就重建 */ }
  const tmp = `${file}.${process.pid}.${++TMP_SEQ}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
  } catch (e) {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
      return { ok: true, mode: 'direct' };
    } catch (e2) { return { ok: false, code: e2.code || '', error: e2.message }; }
  }
  const delays = [0, 40, 90, 180, 320];
  let last = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) sleepMs(delays[i]);
    try {
      fs.renameSync(tmp, file);
      return { ok: true, mode: i ? 'retry' : 'rename' };
    } catch (e) {
      last = e;
      if (!['ENOENT', 'EPERM', 'EACCES', 'EBUSY', 'EMFILE'].includes(e.code)) break;
    }
  }
  try {
    fs.writeFileSync(file, text, 'utf8');
    try { fs.unlinkSync(tmp); } catch (_) { /* 清理临时文件 */ }
    return { ok: true, mode: 'fallback', code: last && last.code };
  } catch (e2) { return { ok: false, code: e2.code || '', error: e2.message }; }
}

function haversine(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function cellKey(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${Math.round(lat / CELL_DEG)},${Math.round(lng / CELL_DEG)}`;
}

/**
 * 从一天的原始数据（path / samples）重算里程与时长 —— 汇总字段的**唯一权威口径**。
 *
 * 存在的理由（踩过的坑）：stats 曾被「结束漫游」用引擎内存里的即时累计值整体覆盖，
 * 于是「第 N 次出发进行中又开了一次出发」时，全天汇总会被那几秒钟的小段覆盖，
 * 日报变成「0.05km / 69 步 / 43s」，看起来像前面几个小时的轨迹全没了
 * （实际 path/samples 一个点都没丢，只是汇总字段被改写）。
 *
 * 里程优先级与 aggregate() 保持一致：
 *   ① samples 里上报的累计真实里程（引擎自己算的真实位移）
 *   ② path 的几何长度（地图位移，兜底）
 *   ③ 已有的 stats.distance —— 只要它不"明显失真"就尊重它
 *
 * 「明显失真」的判定很关键：只有当几何量比旧值大到 **1.5 倍以上**（远超坐标抖动幅度，
 * 说明旧值确实是被一小段覆盖了）才推翻旧值；否则保留引擎上报的权威值，
 * 免得把「地图尺度放大坐标位移」多算出来的几百米当成真实里程灌进去。
 */
function recomputeDayStats(data) {
  const path = data.path || [];
  const samples = data.samples || [];
  let geomDist = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const seg = haversine(a, b);
    // 断点（换会话/定位跳变）不计入几何长度，否则会凭空多出几公里的"飞线"
    if (Number.isFinite(seg) && seg <= 300) geomDist += seg;
  }
  let sampleDist = 0;
  for (const s of samples) {
    const v = Number(s && s.dist);
    if (Number.isFinite(v) && v > sampleDist) sampleDist = v;
  }
  const oldDist = Number(data.stats && data.stats.distance) || 0;
  const measured = Math.max(sampleDist, geomDist);
  // 旧值明显小于实测值（< 2/3）→ 判定为被小段覆盖，用实测值修回；
  // 否则以旧值为准（引擎上报的真实里程比几何推算可靠，不因抖动改写）
  const dist = (oldDist > 0 && measured < oldDist * 1.5) ? oldDist : measured;

  // 时长：优先按 samples 首尾推算（覆盖全天），其次 path 首尾
  let first = 0;
  let last = 0;
  for (const s of samples) {
    const t = Number(s && s.t) || 0;
    if (!first || (t && t < first)) first = t;
    if (t > last) last = t;
  }
  if (!first || !last) {
    for (const p of path) {
      const t = Number(p && p.t) || 0;
      if (!first || (t && t < first)) first = t;
      if (t > last) last = t;
    }
  }
  const spanDur = first && last ? Math.max(0, last - first) : 0;
  const oldDur = Number(data.stats && data.stats.duration) || 0;
  // 同上：旧时长明显短于实测跨度（< 2/3）才修正，否则保留引擎值
  const duration = (oldDur > 0 && spanDur < oldDur * 1.5) ? oldDur : Math.max(spanDur, oldDur);

  // 速度：从 path 的 spd 取，缺就按 里程/时长 估
  let maxSpeed = 0;
  for (const p of path) {
    const v = Number(p && p.spd) || 0;
    if (v > maxSpeed) maxSpeed = v;
  }
  const prev = (data.stats && typeof data.stats === 'object') ? data.stats : {};
  const prevAvg = Number(prev.avgSpeed) || 0;
  let avgSpeed = duration > 0 ? (dist / 1000) / (duration / 3600000) : 0;
  // 引擎上报的均速更贴近真实（它按速度档累计），只在明显失真时改用推算值
  if (prevAvg > 0 && Math.abs(avgSpeed - prevAvg) < prevAvg * 0.5) avgSpeed = prevAvg;

  return {
    ...prev,
    distance: Math.round(dist),
    duration: Math.round(duration),
    avgSpeed: Number(avgSpeed.toFixed(2)),
    maxSpeed: Number((maxSpeed || avgSpeed || prevAvg || 0).toFixed(2)),
    // 跑步/走路时长与网络量只在旧值更大时保留（引擎结束时会给出准值）
    runMs: Math.max(Number(prev.runMs) || 0, 0),
    walkMs: Math.max(Number(prev.walkMs) || 0, 0),
    rolls: Math.max(Number(prev.rolls) || 0, (data.rolls || []).length),
  };
}

/** 从最后一天往前数连续活跃天数 */
function streak(dates) {
  if (!dates.length) return 0;
  const sorted = [...dates].sort();
  let n = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const cur = new Date(`${sorted[i]}T00:00:00`);
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    const diffDays = Math.round((cur - prev) / 86400000);
    if (diffDays === 1) n++;
    else break;
  }
  return n;
}

class TrackStore {
  constructor(baseDir) {
    this.dir = path.join(baseDir, 'tracks');
    fs.mkdirSync(this.dir, { recursive: true });
    this.cache = new Map(); // date -> data
    this.dirty = new Set();
    this._logState = new Map();
    this._flushTimer = setInterval(() => this.flush(), 8000);
    if (this._flushTimer.unref) this._flushTimer.unref();
    this._claimInstanceLock(baseDir);
  }

  /**
   * 同数据目录多实例检测：两个 NetWalk 同时写同一个 <date>.json 会互相 rename 失败、
   * 甚至互相覆盖轨迹 —— 启动时检查锁文件，发现同目录已有活着的实例就明确提示用户。
   */
  _claimInstanceLock(baseDir) {
    try {
      this._lockFile = path.join(baseDir, 'instance.lock');
      let prev = null;
      try { prev = JSON.parse(fs.readFileSync(this._lockFile, 'utf8')); } catch (_) { /* 首次启动 */ }
      if (prev && Number(prev.pid) && Number(prev.pid) !== process.pid) {
        let alive = false;
        try { process.kill(Number(prev.pid), 0); alive = true; } catch (_) { alive = false; }
        if (alive && Date.now() - (Number(prev.at) || 0) < 24 * 3600 * 1000) {
          console.error(`[store] ⚠ 另一个 NetWalk 实例（pid ${prev.pid}${prev.port ? '，端口 ' + prev.port : ''}）正在使用同一个数据目录：`);
          console.error(`        ${baseDir}`);
          console.error('        两个实例同时写同一天的轨迹会互相覆盖并报 rename 失败（ENOENT/EPERM）——请只保留一个实例。');
        }
      }
      fs.writeFileSync(this._lockFile, JSON.stringify({
        pid: process.pid, port: Number(process.env.NETWALK_PORT) || null, at: Date.now(),
      }), 'utf8');
      const drop = () => { try { if (this._lockFile) fs.unlinkSync(this._lockFile); } catch (_) { /* noop */ } };
      process.once('exit', drop);
    } catch (_) { /* 锁文件写不了不影响主体功能 */ }
  }

  file(date) {
    return path.join(this.dir, `${date}.json`);
  }

  load(date) {
    if (this.cache.has(date)) return this.cache.get(date);
    let data = null;
    const f = this.file(date);
    if (fs.existsSync(f)) {
      try {
        data = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (_) {
        data = null;
      }
    }
    if (!data) {
      data = {
        date,
        startedAt: Date.now(),
        endedAt: null,
        city: '',
        path: [],
        samples: [],
        rolls: [],
        stats: null,
      };
    }
    this.cache.set(date, data);
    return data;
  }

  markDirty(date) {
    this.dirty.add(date);
  }

  /** 写失败日志去重：同一日期每分钟最多一条，恢复时再报一次（避免日志刷屏） */
  _logWrite(kind, date, msg) {
    const key = 'w|' + date;
    if (kind === 'err') {
      const last = this._logState.get(key) || 0;
      if (Date.now() - last < 60000) return;
      this._logState.set(key, Date.now());
      console.error('[store] 写入失败', date, msg);
      console.error('        ↳ 常见原因：① 有两个 NetWalk 实例在用同一数据目录（关掉多余的那个）'
        + ' ② 目录/文件被其它程序（杀毒、同步盘）占用或删除');
      return;
    }
    if (this._logState.has(key)) {
      this._logState.delete(key);
      console.error('[store] 写入已恢复正常', date, msg ? '（' + msg + '）' : '');
    }
  }

  flush() {
    const stillDirty = new Set();
    for (const date of this.dirty) {
      const data = this.cache.get(date);
      if (!data) continue;
      const r = atomicWrite(this.file(date), JSON.stringify(data), this.dir);
      if (r.ok) {
        // rename 不成功但兜底写成功了 → 说明目标被占用过，提示一次原因
        if (r.mode === 'fallback' || r.mode === 'direct') {
          this._logWrite('err', date, `${r.code || 'rename'} → 已改用直接写入`);
          this._logWrite('ok', date, '后续写入恢复正常');
        } else if (r.mode.startsWith('retry')) {
          this._logWrite('ok', date, '目标文件曾被短暂占用');
        } else {
          this._logWrite('ok', date);
        }
      } else {
        // 关键：失败必须保留 dirty，下个 tick 再试 —— 以前直接 clear，内存里的轨迹会永久丢失
        stillDirty.add(date);
        this._logWrite('err', date, `${r.code} ${r.error}`);
      }
    }
    this.dirty = stillDirty;
  }

  /** 追加轨迹点（前端已按距离节流） */
  appendPath(date, points) {
    if (!Array.isArray(points) || points.length === 0) return 0;
    const data = this.load(date);
    for (const p of points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      data.path.push({
        t: p.t || Date.now(),
        lat: Number(p.lat.toFixed(6)),
        lng: Number(p.lng.toFixed(6)),
        road: p.road || '',
        spd: Number((p.spd || 0).toFixed(2)),
        mode: p.mode || 'walk',
        no: Number(p.no) || 0,        // 会话号：绘制时按它切分，多设备合并后不连飞线
        straight: p.straight ? 1 : 0, // 直线兜底标记：绘制时剔除这类点，不画飞线
      });
    }
    this.markDirty(date);
    return data.path.length;
  }

  /** 追加一条环境采样（网速/打字/换算速度），用于报告统计 */
  appendSample(date, s) {
    const data = this.load(date);
    data.samples.push({
      t: s.t || Date.now(),
      rx: Math.round(s.rx || 0),
      tx: Math.round(s.tx || 0),
      kpm: Math.round(s.kpm || 0),
      spd: Number((s.spd || 0).toFixed(2)),
      mode: s.mode || 'walk',
      // 引擎累计的「真实步行里程」（米）。地图尺度会放大坐标位移，
      // 因此不能用轨迹几何长度当作里程，必须由前端上报。
      dist: Math.round(s.dist || 0),
    });
    // 采样上限保护：单日最多保留 2 万条
    if (data.samples.length > 20000) data.samples.splice(0, data.samples.length - 20000);
    this.markDirty(date);
    return data.samples.length;
  }

  /** 记录一次路口 ROLL100 决策 */
  appendRoll(date, r) {
    const data = this.load(date);
    data.rolls.push({
      t: r.t || Date.now(),
      lat: Number((r.lat || 0).toFixed(6)),
      lng: Number((r.lng || 0).toFixed(6)),
      road: r.road || '',
      roll: Number(r.roll) || 0,
      choice: r.choice || '',
      bearing: Number(r.bearing) || 0,
      // 新路占比 / 是否原路返回：诊断"为什么老走同一条路"用
      fresh: (r.fresh === undefined || r.fresh === null) ? undefined : Number(r.fresh),
      backtrack: Boolean(r.backtrack),
    });
    this.markDirty(date);
    return data.rolls.length;
  }

  setCity(date, city) {
    const data = this.load(date);
    data.city = city;
    this.markDirty(date);
  }

  /** 记录当天走过的城市与地图尺度（用于城市/国家成就） */
  setContext(date, { city, scope } = {}) {
    const data = this.load(date);
    if (city) data.city = city;
    if (scope) {
      if (!Array.isArray(data.scopes)) data.scopes = [];
      if (!data.scopes.includes(scope)) data.scopes.push(scope);
    }
    this.markDirty(date);
  }

  /**
   * 记录一次出发的起点，返回全局序号（第 N 次出发，跨天累加）
   * 前端在主地图上为每个出发点画紫色小点 + 序号
   */
  addSessionStart(date, lat, lng) {
    let maxN = 0;
    for (const d of this.listDates()) {
      for (const s of (this.load(d).sessions || [])) maxN = Math.max(maxN, s.n || 0);
    }
    const data = this.load(date);
    if (!Array.isArray(data.sessions)) data.sessions = [];
    const n = maxN + 1;
    data.sessions.push({ n, lat: Number(Number(lat).toFixed(6)), lng: Number(Number(lng).toFixed(6)), t: Date.now() });
    this.markDirty(date);
    return n;
  }

  /**
   * 某天走过的路名清单 —— **纯本地计算，不调用任何高德接口**。
   * 路名来自路径规划返回的 steps[].road（免费附带），按时间顺序统计首次/最后经过、点数与估算里程。
   * @returns {{date:string, roads:Array<{name:string, firstT:number, lastT:number, points:number, meters:number, sessions:number[]}>}}
   */
  roadsOn(date) {
    const data = this.load(date);
    const path = (data && data.path) || [];
    const map = new Map();
    let prev = null;
    for (const p of path) {
      const name = String(p.road || '').trim();
      const t = Number(p.t) || 0;
      let stepM = 0;
      if (prev) {
        const d = haversine(prev, p);            // 单位：米
        if (d < 2000) stepM = d;                 // 跳变(>2km，换会话/兜底直线)不算里程
      }
      prev = p;
      if (!name) continue;
      let it = map.get(name);
      if (!it) {
        it = { name, firstT: t, lastT: t, points: 0, meters: 0, sessions: new Set() };
        map.set(name, it);
      }
      it.points++;
      if (t && (!it.firstT || t < it.firstT)) it.firstT = t;
      if (t > it.lastT) it.lastT = t;
      it.meters += stepM;
      if (Number(p.no)) it.sessions.add(Number(p.no));
    }
    const roads = Array.from(map.values())
      .map((x) => ({
        name: x.name, firstT: x.firstT, lastT: x.lastT, points: x.points,
        meters: Math.round(x.meters), sessions: Array.from(x.sessions).slice(0, 20),
      }))
      .sort((a, b) => a.firstT - b.firstT);   // 按"第一次走上"的时间排序 = 当天走过的顺序
    return { date, roads };
  }

  /** 一段日期范围的路过记录（新日期在前），同样不调用高德 */
  roadsRange(from, to) {
    const dates = this.listDates().filter((d) => (!from || d >= from) && (!to || d <= to));
    return dates.sort().reverse().map((d) => this.roadsOn(d));
  }

  /** 全部出发点（按出发顺序），主地图/轨迹回看画紫点用；顺带统计每次出发的轨迹点数 */
  allSessionStarts() {
    const out = [];
    const counts = new Map();
    for (const d of this.listDates()) {
      for (const p of (this.load(d).path || [])) {
        const n = Number(p.no) || 0;
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }
    for (const d of this.listDates().sort()) {
      for (const s of (this.load(d).sessions || [])) {
        out.push({ date: d, n: s.n, lat: s.lat, lng: s.lng, t: s.t, points: counts.get(Number(s.n)) || 0 });
      }
    }
    return out;
  }

  /**
   * 删除「第 n 次出发」产生的全部数据：该次出发的轨迹点、当次时间窗内的采样与路口记录、出发记录本身。
   * 剩下的出发会重新编号 1..N（轨迹点上的会话号同步重映射，绘制切分才不会错）。
   * @returns {{ok:boolean, removed?:number, error?:string}}
   */
  deleteSession(n) {
    const want = Number(n);
    if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '出发序号不合法' };
    const all = [];
    for (const d of this.listDates()) {
      for (const s of (this.load(d).sessions || [])) all.push({ date: d, s });
    }
    all.sort((a, b) => (Number(a.s.t) || 0) - (Number(b.s.t) || 0));
    const idx = all.findIndex((x) => Number(x.s.n) === want);
    if (idx < 0) return { ok: false, error: `没有第 ${want} 次出发的记录` };
    const start = Number(all[idx].s.t) || 0;
    const nextT = all[idx + 1] ? (Number(all[idx + 1].s.t) || Infinity) : Infinity;
    // 旧 → 新 的会话号映射（被删的那个不参与重排）
    const mapping = new Map();
    let k = 0;
    for (const x of all) {
      if (x === all[idx]) continue;
      k++;
      mapping.set(Number(x.s.n), k);
    }
    const inWindow = (t) => {
      const v = Number(t) || 0;
      return v >= start && v < nextT;
    };
    let removed = 0;
    let touched = 0;
    for (const d of this.listDates()) {
      const data = this.load(d);
      let changed = false;
      // ① 轨迹点：会话号匹配的直接删；老数据没有 no 的按时间窗兜底
      const pBefore = data.path.length;
      data.path = (data.path || []).filter((p) => {
        const pn = Number(p.no) || 0;
        if (pn === want) return false;
        if (pn === 0 && inWindow(p.t)) return false;
        return true;
      });
      if (data.path.length !== pBefore) { removed += pBefore - data.path.length; changed = true; }
      for (const p of data.path) {
        const m = mapping.get(Number(p.no));
        if (m && m !== Number(p.no)) { p.no = m; changed = true; }
      }
      // ② 采样 / 路口记录：按当次出发的时间窗删除
      const sBefore = (data.samples || []).length;
      data.samples = (data.samples || []).filter((s) => !inWindow(s.t));
      if (data.samples.length !== sBefore) changed = true;
      const rBefore = (data.rolls || []).length;
      data.rolls = (data.rolls || []).filter((r) => !inWindow(r.t));
      if (data.rolls.length !== rBefore) changed = true;
      // ③ 出发记录：删掉并重编号
      const sessBefore = (data.sessions || []).length;
      data.sessions = (data.sessions || []).filter((s) => Number(s.n) !== want);
      if (data.sessions.length !== sessBefore) changed = true;
      for (const s of data.sessions) {
        const m = mapping.get(Number(s.n));
        if (m && m !== Number(s.n)) { s.n = m; changed = true; }
      }
      // ④ 当天统计按剩余数据重算：统一走 recomputeDayStats（不再只取 samples 的 dist 最大值）
      if (changed) {
        data.stats = recomputeDayStats(data);
        this.markDirty(d);
        touched++;
      }
    }
    this.flush();
    return { ok: true, removed, days: touched, sessions: k };
  }

  /**
   * 回滚：保留第 n 次出发及之前的所有数据，删掉第 n 次之后每一次出发产生的轨迹
   * （多次调用 deleteSession，从序号最大的往回删，避免重编号互相影响）。
   * @returns {{ok:boolean, removedPoints?:number, removedSessions?:number, removedDays?:number,
   *            cutoff?:number, resumeCandidate?:object, kept?:number, error?:string}}
   */
  rollbackFrom(n) {
    const want = Number(n);
    if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '出发序号不合法' };
    const all = [];
    for (const d of this.listDates()) {
      for (const s of (this.load(d).sessions || [])) all.push({ date: d, s });
    }
    all.sort((a, b) => (Number(a.s.t) || 0) - (Number(b.s.t) || 0));
    const idx = all.findIndex((x) => Number(x.s.n) === want);
    if (idx < 0) return { ok: false, error: `没有第 ${want} 次出发的记录` };
    const later = all.slice(idx + 1);   // 旧 → 新
    if (!later.length) {
      return { ok: true, removedPoints: 0, removedSessions: 0, removedDays: 0, cutoff: 0, resumeCandidate: null, kept: all.length };
    }
    // 第一次被删的那次出发的时间 = 分界线（之前的数据留着，之后的清掉）
    const cutoff = Number(later[0].s.t) || 0;
    // 「从这里继续」= 第 n 次结束的位置（也就是被删的第一次出发的起点）
    const resumeCandidate = {
      n: want, date: later[0].date,
      lat: Number(later[0].s.lat), lng: Number(later[0].s.lng), t: cutoff,
    };
    let removedPoints = 0, removedSessions = 0, removedDays = 0;
    for (let i = later.length - 1; i >= 0; i--) {
      const r = this.deleteSession(Number(later[i].s.n));
      if (r && r.ok) { removedPoints += r.removed || 0; removedSessions++; removedDays += r.days || 0; }
    }
    this.renumberSessions();
    return { ok: true, removedPoints, removedSessions, removedDays, cutoff, resumeCandidate, kept: all.length - removedSessions };
  }

  /**
   * 重置时间戳（持久化在数据目录根部，随存档码传播；0 = 从未重置过）。
   * 重置语义：本机 resetAt 之后的轨迹才是有效数据；同步时双方比较 resetAt，
   * 更晚的重置会"接管"更早的设备（清空其旧轨迹并采用接管方的数据）。
   */
  _resetFile() { return path.join(path.dirname(this.dir), 'reset.json'); }
  getResetAt() {
    try { return Number(JSON.parse(fs.readFileSync(this._resetFile(), 'utf8')).t) || 0; }
    catch (_) { return 0; }
  }
  setResetAt(t) {
    const f = this._resetFile();
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ t: Number(t) || Date.now() }), 'utf8');
    } catch (_) { /* 写不进就算了，重置标记只影响同步 */ }
  }

  /** 清空全部日期的轨迹数据（覆写为空结构），供"重置接管"使用 */
  clearAllDays() {
    for (const d of this.listDates()) {
      try {
        fs.writeFileSync(path.join(this.dir, d + '.json'), JSON.stringify({
          date: d, startedAt: Date.now(), endedAt: null, city: '',
          path: [], samples: [], rolls: [], sessions: [], stats: null,
        }), 'utf8');
      } catch (_) { /* 忽略单个日期的失败 */ }
    }
    this.forgetAll();
  }

  /**
   * 全局重排出发序号：把所有日期的出发记录按时间排序后重新编号 1..N。
   * 多设备同步合并后，各设备各自的序号都从 1 开始会互相冲突，
   * 必须全局重排，两台设备的「第 N 次出发」才能对得上；重排后最大值就是总次数。
   */
  renumberSessions() {
    const all = [];
    for (const d of this.listDates()) {
      const data = this.load(d);
      if (!Array.isArray(data.sessions) || !data.sessions.length) continue;
      for (const s of data.sessions) all.push({ date: d, s });
    }
    if (!all.length) return 0;
    all.sort((a, b) => (Number(a.s.t) || 0) - (Number(b.s.t) || 0));
    all.forEach((x, i) => { x.s.n = i + 1; this.markDirty(x.date); });
    this.flush();
    return all.length;
  }

  /**
   * 全局聚合指标（用于成就判定与日/月/年统计）
   * @param {{from?:string,to?:string}} range 日期闭区间，缺省表示全部
   */
  aggregate(range = {}) {
    const dates = this.listDates().filter((d) => {
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      return true;
    });

    let totalDistance = 0;
    let maxDayDistance = 0;
    let totalDuration = 0;
    let totalKeys = 0;
    let totalRolls = 0;
    let totalRx = 0;
    let totalTx = 0;
    let totalPoints = 0;
    let maxSpeed = 0;
    const roads = new Set();
    const cities = new Set();
    const scopes = new Set();
    const cells = new Set();
    const perDay = [];

    for (const date of dates) {
      const d = this.load(date);
      const path = d.path || [];
      // 轨迹几何长度：仅作为兜底（地图尺度 != 1 时它等于「地图位移」，不是真实里程）
      let geomDist = 0;
      let dayMax = 0;
      for (let i = 1; i < path.length; i++) geomDist += haversine(path[i - 1], path[i]);
      for (const p of path) {
        dayMax = Math.max(dayMax, p.spd || 0);
        if (p.road) roads.add(p.road.trim());
        cells.add(cellKey(p.lat, p.lng));
      }
      // 里程优先级：结束时的权威汇总 > 采样里上报的累计真实里程 > 轨迹几何长度
      const statDist = (d.stats && Number.isFinite(d.stats.distance)) ? d.stats.distance : 0;
      let sampleDist = 0;
      for (const s of (d.samples || [])) {
        if (Number.isFinite(s.dist) && s.dist > sampleDist) sampleDist = s.dist;
      }
      const dist = statDist > 0 ? statDist : (sampleDist > 0 ? sampleDist : geomDist);

      const t0 = path.length ? path[0].t : d.startedAt;
      const t1 = path.length ? path[path.length - 1].t : (d.endedAt || d.startedAt);
      const dur = (d.stats && d.stats.duration) || Math.max(0, (t1 || 0) - (t0 || 0));
      const dRx = (d.stats && d.stats.rxTotal) || 0;
      const dTx = (d.stats && d.stats.txTotal) || 0;
      const dKeys = (d.stats && d.stats.totalKeys) || 0;

      if (d.city) cities.add(d.city);
      for (const s of (d.scopes || [])) scopes.add(s);
      if (d.stats && d.stats.scope) scopes.add(d.stats.scope);

      totalDistance += dist;
      maxDayDistance = Math.max(maxDayDistance, dist);
      totalDuration += dur;
      totalKeys += dKeys;
      totalRolls += (d.rolls || []).length;
      totalRx += dRx;
      totalTx += dTx;
      totalPoints += path.length;
      maxSpeed = Math.max(maxSpeed, (d.stats && d.stats.maxSpeed) || dayMax);
      if (path.length || d.stats || (d.samples || []).length) {
        perDay.push({
          date,
          distance: Math.round(dist),
          duration: dur,
          keys: dKeys,
          rolls: (d.rolls || []).length,
          rx: dRx,
          tx: dTx,
          maxSpeed: (d.stats && d.stats.maxSpeed) || dayMax,
          city: d.city || '',
          points: path.length,
        });
      }
    }

    return {
      from: range.from || (dates[0] || ''),
      to: range.to || (dates[dates.length - 1] || ''),
      days: dates.length,
      activeDays: perDay.filter((p) => p.points > 0).length,
      streakDays: streak(dates),
      totalDistance: Math.round(totalDistance),
      maxDayDistance: Math.round(maxDayDistance),
      totalDuration,
      totalKeys,
      totalRolls,
      totalRx,
      totalTx,
      totalPoints,
      maxSpeed: Number(maxSpeed.toFixed(2)),
      uniqueRoads: roads.size,
      litCells: cells.size,
      cities: [...cities],
      scopes: [...scopes],
      roads: [...roads],
      perDay,
    };
  }

  /** 删除某天数据（用于测试/重置） */
  remove(date) {
    const f = this.file(date);
    this.cache.delete(date);
    this.dirty.delete(date);
    if (!fs.existsSync(f)) return false;
    try {
      fs.unlinkSync(f);
      return true;
    } catch (err) {
      // 某些环境里删除会被重定向到回收站并失败；内存里已经移除，
      // 这里不抛错，避免调用方（测试/重置流程）被牵连
      console.error('[store] 删除文件失败（内存数据已移除）：', date, err.message);
      return false;
    }
  }

  /** 整日覆盖（导入存档且本地为空时） */
  replace(date, data) {
    this.cache.set(date, data);
    this.markDirty(date);
    this.flush();
    return data;
  }

  /** 合并导入的某日数据（按时间戳去重，保留双方轨迹） */
  mergeDate(date, incoming) {
    if (!incoming) return null;
    const cur = this.load(date);
    const dedupe = (a, b) => {
      const seen = new Set((a || []).map((x) => x.t));
      for (const x of (b || [])) if (!seen.has(x.t)) a.push(x);
      a.sort((p, q) => p.t - q.t);
      return a;
    };
    cur.path = dedupe(cur.path || [], incoming.path);
    cur.rolls = dedupe(cur.rolls || [], incoming.rolls);
    cur.samples = dedupe(cur.samples || [], incoming.samples);
    // 出发记录也要合并：否则另一台设备上"第 7、8 次出发"同步过来就丢了，
    // 本机还停留在自己的 3、4 —— 两台设备的出发次数对不上。
    cur.sessions = dedupe(cur.sessions || [], incoming.sessions);
    if (incoming.stats) {
      if (!cur.stats || (incoming.stats.distance || 0) > (cur.stats.distance || 0)) cur.stats = incoming.stats;
    }
    if (!cur.city && incoming.city) cur.city = incoming.city;
    if (Array.isArray(incoming.scopes)) cur.scopes = [...new Set([...(cur.scopes || []), ...incoming.scopes])];
    if (incoming.endedAt && !cur.endedAt) cur.endedAt = incoming.endedAt;
    this.markDirty(date);
    this.flush();
    return cur;
  }

  /**
   * 轨迹整备：用吸附到道路后的点集整体替换某天的轨迹。
   * 只替换 path（形状 + 路名），rolls/samples/sessions/stats 全部保留 —— 统计口径不变。
   */
  rewritePath(date, points) {
    if (!Array.isArray(points)) throw new Error('points 必须是数组');
    const clean = [];
    const now = Date.now();
    for (const p of points) {
      const lat = Number(p && p.lat), lng = Number(p && p.lng), t = Number(p && p.t);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -85 || lat > 85 || lng < -180 || lng > 180) continue;
      clean.push({
        t: (Number.isFinite(t) && t > 0 && t <= now + 60000) ? Math.round(t) : now,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        road: String((p && p.road) || ''),
        spd: Number(p && p.spd) || 0,
        mode: (p && p.mode) || 'walk',
        no: Number(p && p.no) || 0,       // 会话号：整备后也要保留，绘制切分依赖它
        straight: (p && p.straight) ? 1 : 0,
      });
    }
    if (clean.length < 2) throw new Error('有效轨迹点不足 2 个，已放弃替换');
    const data = this.load(date);
    // 覆写前留一份原始轨迹（区域修复是破坏性操作，出问题要能一键撤销）
    if (Array.isArray(data.path) && data.path.length >= 2) {
      data.pathBackup = { at: now, path: data.path };
    }
    data.path = clean;
    this.markDirty(date);
    this.flush();
    return clean.length;
  }

  /** 撤销上一次 rewritePath（恢复 pathBackup），返回恢复后的点数；无可恢复则返回 null */
  restorePathBackup(date) {
    const data = this.load(date);
    const bk = data && data.pathBackup;
    if (!bk || !Array.isArray(bk.path) || bk.path.length < 2) return null;
    data.path = bk.path;
    delete data.pathBackup;
    this.markDirty(date);
    this.flush();
    return data.path.length;
  }

  /**
   * 结束当天漫游，写入汇总统计。
   *
   * ⚠ 这里**不能**直接 `data.stats = stats`（踩过的坑）：stats 是引擎内存里的
   * 即时累计值，只覆盖"本次出发"这一小段。若当天已经走过很久（或者用户在第 N 次
   * 行进中又开了一次出发），直接覆盖会把全天汇总抹成几秒钟的小值 ——
   * 日报变成「0.05km / 69 步 / 43s」，让人以为前面几小时的轨迹全丢了。
   *
   * 现在的口径：① 传入的 stats 只用于**补全新数据**（更大的值才采纳）
   *            ② 里程/时长再按 path + samples 全量重算一次，取较大者兜底
   */
  finish(date, stats) {
    const data = this.load(date);
    data.endedAt = Date.now();
    if (stats && typeof stats === 'object') {
      const prev = (data.stats && typeof data.stats === 'object') ? data.stats : {};
      const merged = { ...prev };
      for (const [k, v] of Object.entries(stats)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' || typeof v === 'boolean') { merged[k] = v; continue; }
        const nv = Number(v);
        if (!Number.isFinite(nv)) continue;
        const pv = Number(merged[k]);
        // 数值字段取较大者：既避免「小段覆盖大段」，也保留引擎上报的准值
        merged[k] = Number.isFinite(pv) ? Math.max(pv, nv) : nv;
      }
      data.stats = merged;
    } else if (!data.stats) {
      data.stats = null;
    }
    // 兜底：若合并后的里程/时长仍明显小于原始轨迹能支撑的量（说明旧 stats 本就被小段覆盖过），
    // 这里会按 path/samples 把它修正回来 —— 修不动就原样保留引擎值。
    data.stats = recomputeDayStats(data);
    this.markDirty(date);
    this.flush();
    return data;
  }

  /** 按当日原始数据（path/samples）重算汇总统计并落盘；返回重算后的 stats */
  recomputeStats(date) {
    const data = this.load(date);
    data.stats = recomputeDayStats(data);
    this.markDirty(date);
    this.flush();
    return data.stats;
  }

  isFinished(date) {
    const data = this.load(date);
    return Boolean(data.endedAt);
  }

  listDates() {
    const dates = fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
    const seen = new Set(dates);
    // 已产生数据但尚未落盘的当天（写入是每 8 秒批量 flush）也要算进来，
    // 否则「刚开走就打开数据面板」会漏掉今天
    for (const [date, data] of this.cache) {
      if (seen.has(date) || !data) continue;
      const hasData = Boolean(data.endedAt)
        || (data.path || []).length > 0
        || (data.samples || []).length > 0
        || (data.rolls || []).length > 0
        || (data.sessions || []).length > 0;
      if (hasData) { dates.push(date); seen.add(date); }
    }
    return dates.sort();
  }

  get(date) {
    return this.load(date);
  }

  /** 抛弃全部内存缓存与脏标记（重置账号数据时用，防止 flush 把删掉的文件写回去） */
  forgetAll() {
    this.cache.clear();
    this.dirty.clear();
  }

  dispose() {
    clearInterval(this._flushTimer);
    this.flush();
  }
}

module.exports = { TrackStore, todayStr, atomicWrite };
