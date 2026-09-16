/**
 * 地点收集册存储：路过医院/学校/标志性建筑等正式场所时，按天收录。
 * 独立文件 places.json（与轨迹数据分开，互不影响）：
 *   { "v": 1, "days": { "2026-09-15": [ { name, cat, lat, lng, t } ] } }
 * 同一天内同名地点只收录一次。
 */
const path = require('path');
const fs = require('fs');

class PlaceStore {
  constructor(dir) {
    this.dir = dir;
  }

  _file() { return path.join(this.dir, 'places.json'); }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      if (j && j.days && typeof j.days === 'object') return { v: 1, days: j.days };
    } catch (_) { /* 首次没有文件 */ }
    return { v: 1, days: {} };
  }

  save(data) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this._file(), JSON.stringify(data), 'utf8');
    } catch (e) { console.error('[places] 写入失败：', e.message); }
  }

  /** 收录一批地点；同一天内同名去重。返回实际新增数 */
  add(date, places) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('日期格式应为 YYYY-MM-DD');
    if (!Array.isArray(places)) throw new Error('places 必须是数组');
    const data = this.load();
    const list = data.days[date] || (data.days[date] = []);
    const seen = new Set(list.map((p) => p.name));
    let added = 0;
    const now = Date.now();
    for (const p of places) {
      const name = String((p && p.name) || '').trim().slice(0, 60);
      const cat = String((p && p.cat) || '其他').slice(0, 12);
      const lat = Number(p && p.lat), lng = Number(p && p.lng);
      let t = Number(p && p.t);
      if (!name || !cat || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -85 || lat > 85 || lng < -180 || lng > 180) continue;
      if (!Number.isFinite(t) || t <= 0 || t > now + 60000) t = now;
      if (seen.has(name)) continue;
      seen.add(name);
      const item = { name, cat, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), t: Math.round(t) };
      const road = String((p && p.road) || '').trim().slice(0, 30);
      if (road) item.road = road;   // 所在路名（收集册按路分组用，可选）
      const dist = Number(p && p.dist);
      if (Number.isFinite(dist) && dist >= 0 && dist <= 99999) item.dist = Math.round(dist);   // 到路的距离（米，100 米口径）
      list.push(item);
      added++;
    }
    if (added) this.save(data);
    return added;
  }

  /** 清空全部收录（重置 / 对端重置接管时用） */
  clearAll() {
    this.save({ v: 1, days: {} });
    try { this.saveScan({ v: 1, days: {} }); } catch (_) { /* 搜索记录一并清空 */ }
  }

  // ---------- 已搜索网格记录：省高德额度（同一天同一片区域只搜一次） ----------

  /** 记录文件路径（与 places.json 同目录） */
  _scanPath() { return path.join(this.dir, 'places-scan.json'); }

  loadScan() {
    try {
      const j = JSON.parse(fs.readFileSync(this._scanPath(), 'utf8'));
      if (j && typeof j === 'object' && j.days && typeof j.days === 'object') return { v: 1, days: j.days };
    } catch (_) { /* 没有/损坏就当空 */ }
    return { v: 1, days: {} };
  }

  saveScan(data) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this._scanPath(), JSON.stringify(data), 'utf8');
    } catch (_) { /* 写失败不影响行走 */ }
  }

  /**
   * 认领一片搜索网格：返回其中「今天还没搜过」的键，并把它们标记为已搜。
   * 客户端的沿路扫描/位置扫描都先来这里过滤 ——
   * 同一天重走同一条路、来回走、多设备同步后再走，都不会重复消耗高德额度。
   * @param {string} date
   * @param {string[]} keys
   * @returns {{fresh:string[], known:number, todayTotal:number}}
   */
  claimScan(date, keys) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : new Date().toISOString().slice(0, 10);
    const list = Array.isArray(keys) ? keys.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 200) : [];
    const data = this.loadScan();
    const cur = data.days[d] || (data.days[d] = []);
    const known = new Set(cur);
    const fresh = [];
    for (const k of list) {
      if (known.has(k)) continue;
      fresh.push(k);
      known.add(k);
    }
    if (fresh.length) {
      data.days[d] = Array.from(known).slice(0, 4000);   // 单日上限，防文件膨胀
      // 只保留最近 14 天
      const dates = Object.keys(data.days).sort();
      for (const old of dates.slice(0, Math.max(0, dates.length - 14))) delete data.days[old];
      this.saveScan(data);
    }
    return { fresh, known: list.length - fresh.length, todayTotal: (data.days[d] || []).length };
  }

  /** 今天已搜索的网格数（设置/收集册里展示，方便盯额度） */
  scanCount(date) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : new Date().toISOString().slice(0, 10);
    const data = this.loadScan();
    return ((data.days && data.days[d]) || []).length;
  }

  /**
   * 删除 t >= cutoff 的收录（回滚到某次出发时，把之后那几次出发收集到的地方一并清掉）。
   * @returns {number} 删掉的条数
   */
  removeSince(cutoff) {
    const c = Number(cutoff) || 0;
    if (!c) return 0;
    const data = this.load();
    let removed = 0;
    for (const d of Object.keys(data.days)) {
      const list = data.days[d] || [];
      const keep = list.filter((p) => Number(p.t) < c);
      removed += list.length - keep.length;
      if (keep.length) data.days[d] = keep; else delete data.days[d];
    }
    if (removed) this.save(data);
    return removed;
  }

  /**
   * 合并另一份按天收录（跨设备同步用）：
   * 同一天同名去重；本机已有条目优先保留，仅补上缺失的 road/dist。
   * @returns {{added:number, merged:number, days:number}}
   */
  mergeDays(days) {
    if (!days || typeof days !== 'object') return { added: 0, merged: 0, days: 0 };
    const data = this.load();
    let added = 0, merged = 0, touchedDays = 0;
    for (const [date, list] of Object.entries(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(list) || !list.length) continue;
      const cur = data.days[date] || (data.days[date] = []);
      const byName = new Map(cur.map((p) => [p.name, p]));
      if (!cur.length) touchedDays++;
      for (const p of list) {
        const name = String((p && p.name) || '').trim().slice(0, 60);
        if (!name) continue;
        const cat = String((p && p.cat) || '其他').slice(0, 12);
        const lat = Number(p && p.lat), lng = Number(p && p.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat < -85 || lat > 85 || lng < -180 || lng > 180) continue;
        const road = String((p && p.road) || '').trim().slice(0, 30);
        const dist = Number(p && p.dist);
        const exist = byName.get(name);
        if (exist) {
          let changed = false;
          if (!exist.road && road) { exist.road = road; changed = true; }
          if (Number.isFinite(dist) && (!Number.isFinite(Number(exist.dist)) || dist < Number(exist.dist))) {
            exist.dist = Math.round(dist); changed = true;
          }
          if (changed) merged++;
          continue;
        }
        const item = { name, cat, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), t: Math.round(Number(p && p.t) || Date.now()) };
        if (road) item.road = road;
        if (Number.isFinite(dist) && dist >= 0 && dist <= 99999) item.dist = Math.round(dist);
        cur.push(item);
        byName.set(name, item);
        added++;
      }
    }
    if (added || merged) this.save(data);
    return { added, merged, days: touchedDays };
  }

  /** 按日期范围返回（新日期在前） */
  range(from, to) {
    const data = this.load();
    const days = Object.keys(data.days)
      .filter((d) => d >= from && d <= to && (data.days[d] || []).length)
      .sort((a, b) => (a < b ? 1 : -1))
      .map((d) => ({ date: d, places: data.days[d] }));
    return { ok: true, days };
  }

  /** 删除某天的某个地点（按名称精确匹配）；返回删除的条数 */
  remove(date, name) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('日期格式应为 YYYY-MM-DD');
    const key = String(name || '').trim();
    if (!key) return 0;
    const data = this.load();
    const list = data.days[date];
    if (!Array.isArray(list)) return 0;
    const before = list.length;
    data.days[date] = list.filter((p) => p.name !== key);
    const removed = before - data.days[date].length;
    if (removed) this.save(data);
    return removed;
  }

  /** 汇总：总地点数 / 覆盖天数 / 各类别数量 */
  summary(from, to) {
    const { days } = this.range(from, to);
    let total = 0;
    const byCat = {};
    for (const d of days) for (const p of d.places) { total++; byCat[p.cat] = (byCat[p.cat] || 0) + 1; }
    return { ok: true, total, days: days.length, byCat, list: days };
  }
}

module.exports = { PlaceStore };
