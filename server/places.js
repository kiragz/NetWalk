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
      list.push(item);
      added++;
    }
    if (added) this.save(data);
    return added;
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
