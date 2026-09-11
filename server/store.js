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
    this._flushTimer = setInterval(() => this.flush(), 8000);
    if (this._flushTimer.unref) this._flushTimer.unref();
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

  flush() {
    for (const date of this.dirty) {
      const data = this.cache.get(date);
      if (!data) continue;
      try {
        const f = this.file(date);
        const tmp = `${f}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
        fs.renameSync(tmp, f);
      } catch (err) {
        console.error('[store] 写入失败', date, err.message);
      }
    }
    this.dirty.clear();
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

  /** 全部出发点（按出发顺序），主地图/轨迹回看画紫点用 */
  allSessionStarts() {
    const out = [];
    for (const d of this.listDates().sort()) {
      for (const s of (this.load(d).sessions || [])) out.push({ date: d, n: s.n, lat: s.lat, lng: s.lng, t: s.t });
    }
    return out;
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
    data.path = clean;
    this.markDirty(date);
    this.flush();
    return clean.length;
  }

  /** 结束当天漫游，写入汇总统计 */
  finish(date, stats) {
    const data = this.load(date);
    data.endedAt = Date.now();
    data.stats = stats || null;
    this.markDirty(date);
    this.flush();
    return data;
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

module.exports = { TrackStore, todayStr };
