/**
 * 分享卡片渲染（纯 Canvas，导出 PNG）
 */
(function (global) {
  'use strict';

  const W = 750;
  const H = 1000;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fmtBytes(n) {
    const b = Number(n) || 0;
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h${String(m).padStart(2, '0')}m`;
    return `${m}m${String(s % 60).padStart(2, '0')}s`;
  }

  function speedColor(spd) {
    const t = Math.max(0, Math.min(1, (Number(spd) || 0) / 16));
  const mix = (a, b, k) => Math.round(a + (b - a) * k);
  let r, g, b;
  if (t < 0.5) { const k = t / 0.5; r = mix(255, 255, k); g = mix(233, 130, k); b = mix(120, 60, k); }
  else { const k = (t - 0.5) / 0.5; r = mix(255, 224, k); g = mix(130, 32, k); b = mix(60, 32, k); }
  return `rgb(${r},${g},${b})`;
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} d { date, city, distance, duration, avgSpeed, maxSpeed, keys, rolls,
   *                     rxTotal, txTotal, litCells, uniqueRoads, track:[{lat,lng,spd}], badges:[{icon,level,name}] }
   */
  function draw(canvas, d) {
    const ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;

    // 背景
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1220');
    bg.addColorStop(0.55, '#0a0f1a');
    bg.addColorStop(1, '#0d1526');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部光晕
    const glow = ctx.createRadialGradient(W / 2, 60, 10, W / 2, 60, 420);
    glow.addColorStop(0, 'rgba(74,168,255,0.20)');
    glow.addColorStop(1, 'rgba(74,168,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 460);

    // 外框
    ctx.strokeStyle = '#1e2a3e';
    ctx.lineWidth = 2;
    roundRect(ctx, 12, 12, W - 24, H - 24, 26);
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';

    // 标题
    ctx.fillStyle = '#e6ecf7';
    ctx.font = '700 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('NetWalk', 52, 88);
    const tw = ctx.measureText('NetWalk').width;
    ctx.fillStyle = '#4aa8ff';
    ctx.font = '700 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('·', 52 + tw + 10, 88);

    ctx.fillStyle = '#8b98b5';
    ctx.font = '400 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('网速与打字速度替我走的路', 52, 122);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#4aa8ff';
    ctx.font = '600 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.date || '', W - 52, 88);
    ctx.fillStyle = '#8b98b5';
    ctx.font = '400 17px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.city || '', W - 52, 116);
    ctx.textAlign = 'left';

    // ---- 轨迹图 ----
    const mapX = 40, mapY = 150, mapW = W - 80, mapH = 380;
    ctx.fillStyle = '#0a0f1a';
    roundRect(ctx, mapX, mapY, mapW, mapH, 18);
    ctx.fill();
    ctx.strokeStyle = '#17223a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 网格
    ctx.strokeStyle = '#141d30';
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(mapX, mapY + (mapH / 6) * i);
      ctx.lineTo(mapX + mapW, mapY + (mapH / 6) * i);
      ctx.stroke();
    }
    for (let i = 1; i < 9; i++) {
      ctx.beginPath();
      ctx.moveTo(mapX + (mapW / 9) * i, mapY);
      ctx.lineTo(mapX + (mapW / 9) * i, mapY + mapH);
      ctx.stroke();
    }

    const track = (d.track || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (track.length >= 2) {
      const lats = track.map((p) => p.lat);
      const lngs = track.map((p) => p.lng);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1;
      const spanX = Math.max(1e-9, (maxLng - minLng) * cosLat);
      const spanY = Math.max(1e-9, maxLat - minLat);
      const pad = 34;
      const scale = Math.min((mapW - pad * 2) / spanX, (mapH - pad * 2) / spanY);
      const offX = mapX + (mapW - spanX * scale) / 2;
      const offY = mapY + (mapH - spanY * scale) / 2;
      const proj = (p) => [
        offX + (p.lng - minLng) * cosLat * scale,
        mapY + mapH - ((offY - mapY) + (p.lat - minLat) * scale),
      ];

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2;
      for (let i = 1; i < track.length; i++) {
        const a = proj(track[i - 1]);
        const b = proj(track[i]);
        ctx.strokeStyle = speedColor(track[i].spd || 0);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      // 起终点
      const s = proj(track[0]);
      const e = proj(track[track.length - 1]);
      ctx.fillStyle = '#3ddc97';
      ctx.beginPath(); ctx.arc(s[0], s[1], 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0a0f1a'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#ff5d5d';
      ctx.beginPath(); ctx.arc(e[0], e[1], 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0a0f1a'; ctx.stroke();
    } else {
      ctx.fillStyle = '#55627a';
      ctx.font = '400 18px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无轨迹', mapX + mapW / 2, mapY + mapH / 2);
      ctx.textAlign = 'left';
    }

    // ---- 数据 ----
    const km = (Number(d.distance) || 0) / 1000;
    const steps = Math.round((Number(d.distance) || 0) / 0.72);
    const cells = [
      { k: '总里程', v: km.toFixed(2), u: 'km' },
      { k: '漫游时长', v: fmtDur(d.duration), u: '' },
      { k: '平均速度', v: (Number(d.avgSpeed) || 0).toFixed(1), u: 'km/h' },
      { k: '折合步数', v: steps.toLocaleString(), u: '步' },
      { k: '总下载', v: fmtBytes(d.rxTotal), u: '' },
      { k: '总击键', v: (Number(d.keys) || 0).toLocaleString(), u: '键' },
      { k: '走过道路', v: String(d.uniqueRoads || 0), u: '条' },
      { k: '点亮街区', v: String(d.litCells || 0), u: '块' },
    ];
    const gx = 40, gy = 556, gw = W - 80, gh = 240;
    const cw = (gw - 12 * 3) / 4;
    const ch = (gh - 12) / 2;
    cells.forEach((c, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = gx + col * (cw + 12);
      const y = gy + row * (ch + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      roundRect(ctx, x, y, cw, ch, 14);
      ctx.fill();
      ctx.strokeStyle = '#1b2438';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#8b98b5';
      ctx.font = '400 15px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(c.k, x + cw / 2, y + 30);
      ctx.fillStyle = '#e6ecf7';
      ctx.font = '700 27px "PingFang SC","Microsoft YaHei",sans-serif';
      const vw = ctx.measureText(c.v).width;
      ctx.fillText(c.v, x + cw / 2 - (c.u ? 9 : 0), y + 66);
      if (c.u) {
        ctx.fillStyle = '#8b98b5';
        ctx.font = '400 14px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(c.u, x + cw / 2 + vw / 2 + 4, y + 66);
      }
      ctx.textAlign = 'left';
    });

    // ---- 成就 ----
    const badges = (d.badges || []).slice(0, 6);
    const by = 826;
    if (badges.length) {
      ctx.fillStyle = '#8b98b5';
      ctx.font = '400 16px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(`今日成就 · 共 ${d.badgeTotal || badges.length} 枚`, 52, by - 8);
      let bx = 52;
      for (const b of badges) {
        const col = { bronze: '#d08a4a', silver: '#c8cfdb', gold: '#ffd75e', diamond: '#8ef0ff', epic: '#e0a3ff' }[b.level] || '#d08a4a';
        ctx.beginPath();
        ctx.arc(bx + 22, by + 34, 22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(b.icon, bx + 22, by + 42);
        ctx.textAlign = 'left';
        bx += 56;
      }
    }

    // ---- 页脚 ----
    ctx.strokeStyle = '#1b2438';
    ctx.beginPath();
    ctx.moveTo(52, 928);
    ctx.lineTo(W - 52, 928);
    ctx.stroke();

    ctx.fillStyle = '#55627a';
    ctx.font = '400 16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('NetWalk · 用网速和打字速度去散步', 52, 962);
    ctx.textAlign = 'right';
    ctx.fillText('本机生成 · 数据不上传', W - 52, 962);
    ctx.textAlign = 'left';
  }

  /** 分享文案 */
  function buildText(d) {
    const km = ((Number(d.distance) || 0) / 1000).toFixed(2);
    const steps = Math.round((Number(d.distance) || 0) / 0.72);
    return [
      `NetWalk · ${d.date || ''}`,
      `今天我敲键盘和跑流量的手速，替我走了 ${km} 公里（${steps.toLocaleString()} 步），`,
      `耗时 ${fmtDur(d.duration)}，平均 ${(Number(d.avgSpeed) || 0).toFixed(1)} km/h，峰值 ${(Number(d.maxSpeed) || 0).toFixed(1)} km/h。`,
      `路过 ${d.uniqueRoads || 0} 条路，点亮 ${d.litCells || 0} 个街区，路口掷了 ${d.rolls || 0} 次骰子。`,
      `下载 ${fmtBytes(d.rxTotal)}、上传 ${fmtBytes(d.txTotal)}，敲了 ${(Number(d.keys) || 0).toLocaleString()} 次键盘。`,
      '',
      '#NetWalk #用数据替我走路',
    ].join('\n');
  }

  const api = { draw, buildText, fmtBytes, fmtDur, W, H };
  global.NetWalkShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
