/**
 * 生成每日漫游日报（自包含 HTML，内置 SVG 轨迹图，离线可打开）
 */
const path = require('path');

const EARTH_R = 6371000;

function haversine(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtBytes(n) {
  const b = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtDur(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${ss} 秒`;
  return `${ss} 秒`;
}

/** 由轨迹点推导统计（当客户端未上报 stats 时兜底） */
function computeStats(data) {
  const pts = data.path || [];
  let geomDistance = 0;
  let maxSpeed = 0;
  let sumSpeed = 0;
  let runMs = 0;
  let walkMs = 0;
  for (let i = 1; i < pts.length; i++) {
    geomDistance += haversine(pts[i - 1], pts[i]);
  }
  for (const p of pts) {
    maxSpeed = Math.max(maxSpeed, p.spd || 0);
    sumSpeed += p.spd || 0;
  }
  // 按相邻点时间差估算各模式时长
  for (let i = 1; i < pts.length; i++) {
    const dt = Math.max(0, (pts[i].t || 0) - (pts[i - 1].t || 0));
    if ((pts[i].spd || 0) > 6.5) runMs += dt; else walkMs += dt;
  }
  const samples = data.samples || [];
  // 地图尺度会放大坐标位移，几何长度不等于真实里程；
  // 优先采用采样中上报的引擎累计里程
  let sampleDistance = 0;
  for (const x of samples) {
    if (Number.isFinite(x.dist) && x.dist > sampleDistance) sampleDistance = x.dist;
  }
  const distance = sampleDistance > 0 ? sampleDistance : geomDistance;

  const t0 = pts.length ? pts[0].t : data.startedAt;
  const t1 = pts.length ? pts[pts.length - 1].t : (data.endedAt || data.startedAt);
  const duration = Math.max(0, t1 - t0);
  const avgSpeed = duration > 0 ? distance / (duration / 1000) * 3.6 : 0;

  let rxSum = 0; let rxPeak = 0; let txSum = 0; let txPeak = 0;
  let kpmSum = 0; let kpmPeak = 0;
  for (const s of samples) {
    rxSum += s.rx || 0; rxPeak = Math.max(rxPeak, s.rx || 0);
    txSum += s.tx || 0; txPeak = Math.max(txPeak, s.tx || 0);
    kpmSum += s.kpm || 0; kpmPeak = Math.max(kpmPeak, s.kpm || 0);
  }
  const n = Math.max(1, samples.length);

  return {
    distance: Number(distance.toFixed(1)),
    duration,
    avgSpeed: Number((avgSpeed || (sumSpeed / Math.max(1, pts.length))).toFixed(2)),
    maxSpeed: Number(maxSpeed.toFixed(2)),
    runMs,
    walkMs,
    rxAvg: rxSum / n, rxPeak,
    txAvg: txSum / n, txPeak,
    rxTotal: rxSum, txTotal: txSum,
    kpmAvg: Math.round(kpmSum / n), kpmPeak,
    rolls: (data.rolls || []).length,
    points: pts.length,
  };
}

/** 生成 SVG 轨迹图 */
/** 速度渐变色：浅黄 → 橙 → 深红，越快越深（0~16 km/h） */
function speedGradientColor(spd) {
  const t = Math.max(0, Math.min(1, (Number(spd) || 0) / 16));
  const mix = (a, b, k) => Math.round(a + (b - a) * k);
  let r, g, b;
  if (t < 0.5) { const k = t / 0.5; r = mix(255, 255, k); g = mix(233, 130, k); b = mix(120, 60, k); }
  else { const k = (t - 0.5) / 0.5; r = mix(255, 224, k); g = mix(130, 32, k); b = mix(60, 32, k); }
  return `rgb(${r},${g},${b})`;
}

function buildSvg(data, width = 900, height = 460) {
  const pts = data.path || [];
  if (pts.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" class="track-svg"><text x="50%" y="50%" text-anchor="middle" fill="#8b98b5" font-size="18">轨迹点不足，无法绘制</text></svg>`;
  }
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1;
  const pad = 46;
  const spanX = Math.max(1e-6, (maxLng - minLng) * cosLat);
  const spanY = Math.max(1e-6, maxLat - minLat);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const proj = (p) => [
    offX + (p.lng - minLng) * cosLat * scale,
    height - (offY + (p.lat - minLat) * scale),
  ];

  // 渐变路径：按速度着色。
  // 切段规则：换会话(no) / 空间跳变>250m / 时间断档>15min —— 多设备合并的数据里杜绝飞线
  const distM = (a, b) => {
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const chunks = [];
  let cur = [];
  for (const p of pts) {
    if (p.straight) { // 直线兜底的点不画（与前端 splitTrackSegments 同规则）
      if (cur.length > 1) chunks.push(cur);
      cur = [];
      continue;
    }
    if (cur.length) {
      const a = cur[cur.length - 1];
      const noA = Number(a.no) || 0, noB = Number(p.no) || 0;
      if (distM(a, p) > 250 || ((p.t || 0) - (a.t || 0)) > 15 * 60000 || (noA && noB && noA !== noB)) {
        if (cur.length > 1) chunks.push(cur);
        cur = [];
      }
    }
    cur.push(p);
  }
  if (cur.length > 1) chunks.push(cur);

  const segs = [];
  for (const chunk of chunks) {
    for (let i = 1; i < chunk.length; i++) {
      const [x1, y1] = proj(chunk[i - 1]);
      const [x2, y2] = proj(chunk[i]);
      const spd = chunk[i].spd || 0;
      const color = speedGradientColor(spd);
      segs.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.92"/>`);
    }
  }
  const [sx, sy] = proj(pts[0]);
  const [ex, ey] = proj(pts[pts.length - 1]);

  return `<svg viewBox="0 0 ${width} ${height}" class="track-svg" preserveAspectRatio="xMidYMid meet">
    <defs>
      <radialGradient id="glow"><stop offset="0%" stop-color="#4aa8ff" stop-opacity="0.16"/><stop offset="100%" stop-color="#4aa8ff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="#0d1220" rx="14"/>
    <g stroke="#1c2740" stroke-width="1">
      ${Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${(height / 9) * (i + 1)}" x2="${width}" y2="${(height / 9) * (i + 1)}"/>`).join('')}
      ${Array.from({ length: 15 }, (_, i) => `<line x1="${(width / 15) * (i + 1)}" y1="0" x2="${(width / 15) * (i + 1)}" y2="${height}"/>`).join('')}
    </g>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="26" fill="url(#glow)"/>
    ${segs.join('')}
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="#3ddc97" stroke="#0d1220" stroke-width="2"/>
    <text x="${(sx + 10).toFixed(1)}" y="${(sy - 10).toFixed(1)}" fill="#3ddc97" font-size="12">起点</text>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="6" fill="#ff5d5d" stroke="#0d1220" stroke-width="2"/>
    <text x="${(ex + 10).toFixed(1)}" y="${(ey - 10).toFixed(1)}" fill="#ff5d5d" font-size="12">终点</text>
  </svg>`;
}

function topRoads(data, n = 8) {
  const cnt = new Map();
  for (const p of data.path || []) {
    const r = (p.road || '').trim();
    if (!r) continue;
    cnt.set(r, (cnt.get(r) || 0) + 1);
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function rollBuckets(data) {
  const b = [0, 0, 0, 0];
  for (const r of data.rolls || []) {
    const v = Number(r.roll) || 0;
    if (v <= 25) b[0]++; else if (v <= 50) b[1]++; else if (v <= 75) b[2]++; else b[3]++;
  }
  return b;
}

function buildReportHtml(data, config) {
  const s = data.stats || computeStats(data);
  const declared = data.stats || {};
  const distance = Number(s.distance) || 0;
  const duration = Number(s.duration) || 0;
  const km = distance / 1000;
  const steps = Math.round(distance / 0.72);
  // 卡路里粗估：走路 0.62 kcal/kg/km，跑步 1.03 kcal/kg/km，体重按 65kg
  const runKm = ((s.runMs || 0) / Math.max(1, (s.runMs || 0) + (s.walkMs || 0))) * km;
  const walkKm = km - runKm;
  const kcal = Math.round((walkKm * 0.62 + runKm * 1.03) * 65);
  const roads = topRoads(data);
  const buckets = rollBuckets(data);
  const maxBucket = Math.max(1, ...buckets);
  const totalKeys = Number(declared.totalKeys) || 0;
  const avgSpeed = duration > 0 ? (distance / (duration / 1000)) * 3.6 : (Number(s.avgSpeed) || 0);

  const cards = [
    { k: '总里程', v: km.toFixed(2), u: 'km', sub: `${steps.toLocaleString()} 步` },
    { k: '漫游时长', v: fmtDur(duration).replace(' 小时', 'h').replace(' 分', 'm').replace(' 秒', 's'), u: '', sub: `${Math.round((s.runMs || 0) / 60000)} 分钟在跑` },
    { k: '平均速度', v: avgSpeed.toFixed(1), u: 'km/h', sub: `峰值 ${(Number(s.maxSpeed) || 0).toFixed(1)} km/h` },
    { k: '消耗估算', v: String(kcal), u: 'kcal', sub: '按 65kg 体重估算' },
    { k: '下载总量', v: fmtBytes(s.rxTotal), u: '', sub: `峰值 ${fmtBytes(s.rxPeak)}/s` },
    { k: '上传总量', v: fmtBytes(s.txTotal), u: '', sub: `峰值 ${fmtBytes(s.txPeak)}/s` },
    { k: '击键总数', v: totalKeys.toLocaleString(), u: '键', sub: `峰值 ${s.kpmPeak || 0} KPM` },
    { k: '路口决策', v: String(s.rolls || 0), u: '次', sub: 'ROLL100 判定' },
  ];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>NetWalk 日报 · ${esc(data.date)}</title>
<style>
  :root{ --bg:#080c16; --panel:#111827; --line:#1f2a3d; --txt:#e6ecf7; --dim:#8b98b5;
         --acc:#4aa8ff; --ok:#3ddc97; --warn:#ffb020; --hot:#ff5d5d; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:32px 20px}
  .wrap{max-width:1040px;margin:0 auto}
  h1{font-size:28px;margin:0 0 6px;letter-spacing:.5px}
  .sub{color:var(--dim);font-size:14px;margin-bottom:26px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .stat .k{color:var(--dim);font-size:12px;letter-spacing:1px}
  .stat .v{font-size:26px;font-weight:700;margin:6px 0 2px;font-variant-numeric:tabular-nums}
  .stat .v span{font-size:13px;color:var(--dim);margin-left:4px;font-weight:400}
  .stat .s{color:var(--dim);font-size:12px}
  h2{font-size:16px;margin:0 0 14px;color:var(--txt);display:flex;align-items:center;gap:8px}
  h2::before{content:"";width:3px;height:14px;background:var(--acc);border-radius:2px}
  .track-svg{width:100%;height:auto;border-radius:12px;display:block}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--dim);font-weight:500;font-size:12px;letter-spacing:1px}
  td:last-child{text-align:right;font-variant-numeric:tabular-nums}
  .bars{display:flex;align-items:flex-end;gap:14px;height:130px;padding-top:10px}
  .bar{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end}
  .bar .fill{width:100%;border-radius:8px 8px 0 0;background:linear-gradient(180deg,var(--acc),#2b6cd4);min-height:4px}
  .bar .lb{color:var(--dim);font-size:12px}
  .bar .ct{font-size:13px;font-variant-numeric:tabular-nums}
  .legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--dim);font-size:12px;margin-top:14px}
  .legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
  .foot{color:var(--dim);font-size:12px;text-align:center;padding:20px 0 0}
  .story{line-height:1.9;font-size:15px;color:#cfd8ea}
  .story b{color:var(--acc)}
</style>
</head>
<body>
<div class="wrap">
  <h1>NetWalk 今日漫游日报</h1>
  <div class="sub">${esc(data.date)} · ${esc(data.city || config.city || '')} · ${(data.rolls || []).length} 次路口抉择</div>

  <div class="grid" style="margin-bottom:18px">
    ${cards.map((c) => `<div class="stat"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}<span>${esc(c.u)}</span></div><div class="s">${esc(c.sub)}</div></div>`).join('')}
  </div>

  <div class="card">
    <h2>今日轨迹</h2>
    ${buildSvg(data)}
    <div class="legend">
      <span>慢</span><i style="display:inline-block;width:120px;height:8px;border-radius:4px;background:linear-gradient(90deg,#ffe978,#ff823c,#e02020);vertical-align:middle"></i><span>快（颜色越深速度越快）</span>
    </div>
  </div>

  <div class="card">
    <h2>走过的路 TOP ${roads.length}</h2>
    ${roads.length ? `<table><thead><tr><th>路名</th><th style="text-align:right">经过采样点</th></tr></thead><tbody>
      ${roads.map(([r, c]) => `<tr><td>${esc(r)}</td><td>${c}</td></tr>`).join('')}
    </tbody></table>` : '<div style="color:var(--dim);font-size:14px">今天没有记录到路名</div>'}
  </div>

  <div class="card">
    <h2>路口 ROLL100 分布</h2>
    <div class="bars">
      ${['01-25', '26-50', '51-75', '76-100'].map((lb, i) => `
        <div class="bar">
          <div class="ct">${buckets[i]}</div>
          <div class="fill" style="height:${Math.round((buckets[i] / maxBucket) * 88)}%"></div>
          <div class="lb">${lb}</div>
        </div>`).join('')}
    </div>
  </div>

  <div class="card">
    <h2>今日小结</h2>
    <div class="story">
      今天你的数据流把你带出去走了 <b>${km.toFixed(2)} 公里</b>，
      相当于 <b>${steps.toLocaleString()}</b> 步，累计 <b>${fmtDur(duration)}</b>。
      平均配速 <b>${avgSpeed.toFixed(1)} km/h</b>，最快冲到了 <b>${(Number(s.maxSpeed) || 0).toFixed(1)} km/h</b>${(Number(s.maxSpeed) || 0) > 9.5 ? ' —— 那会儿你肯定在疯狂下载什么东西。' : '。'}
      ${totalKeys ? `你敲了 <b>${totalKeys.toLocaleString()}</b> 次键盘，峰值 <b>${s.kpmPeak || 0} KPM</b>，约合 <b>${Math.round(totalKeys / 5).toLocaleString()}</b> 个字。` : ''}
      期间网络吞吐下载 <b>${fmtBytes(s.rxTotal)}</b>、上传 <b>${fmtBytes(s.txTotal)}</b>。
      ${roads.length ? `走过最多的路是 <b>${esc(roads[0][0])}</b>。` : ''}
      估算消耗 <b>${kcal}</b> 千卡 —— 虽然身体没动，但数据替你跑完了全程。
    </div>
  </div>

  <div class="foot">NetWalk · 数据仅保存在本机 · ${new Date().toLocaleString('zh-CN')}</div>
</div>
</body>
</html>`;
}

module.exports = { buildReportHtml, computeStats, haversine };
