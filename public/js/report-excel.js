/**
 * 纯文字 Excel 风格报表 —— 数据其实是 NetWalk 的漫游统计
 * 摸鱼专用：看起来像工作日报表，老板扫一眼以为你在做表
 *
 * 支持：按日期查看 / 导出本日 .xls / 导出全部日期的按日汇总（方便做统计图）
 */
(function () {
  'use strict';

  const COLS = 9;                              // A..I
  const COL_LABELS = ['编号', '任务名称', '起始时间', '工时(h)', '巡检里程(km)', '工单数(次)', '流量(MB)', '操作(次)', '备注'];
  const TASKS = ['外勤巡检', '设备测试', '网络维护', '信号巡线', '设备调试', '隐患排查', '现场支持', '例行检查', '应急处置', '数据采集'];
  const PLACE = ['总部园区', 'A 区车间', 'B 区厂房', 'C 区配电室', 'D 区光交箱', 'E 区基站', 'F 区弱电井', '客户现场', '维护点 03', '维护点 07'];
  const NUM_COLS = new Set([0, 3, 4, 5, 6, 7]);
  const STARTS = ['08:30', '09:45', '11:00', '13:30', '14:45', '15:55', '17:00', '18:15', '19:30'];

  let archiveCode = '';
  let currentDate = today();
  let allDays = [];

  function el(id) { return document.getElementById(id); }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ===== 数据 =====
  async function loadDay(date) {
    const [day, stats] = await Promise.all([
      fetch('/api/day/' + date).then((r) => r.json()).catch(() => ({})),
      fetch('/api/stats?range=day&date=' + date).then((r) => r.json()).catch(() => ({})),
    ]);
    return { day: day || {}, stats: (stats && stats.agg) || {} };
  }

  async function loadDays() {
    const r = await fetch('/api/days').then((r) => r.json()).catch(() => ({}));
    return (r && r.days) || [];
  }

  async function loadArchive() {
    const r = await fetch('/api/archive/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).catch(() => ({}));
    return (r && r.code) || '';
  }

  /** 从某天的数据里取出统计口径（day 优先，stats 兜底） */
  function pickStats(day, stats) {
    const s = (day && day.stats) || {};
    const t = (day && day.totals) || {};
    return {
      distance: s.distance || stats.distance || 0,
      durationMs: s.durationMs || stats.durationMs || 0,
      rolls: s.rolls || stats.rolls || 0,
      keys: t.keys || stats.keys || 0,
      rx: t.rx || stats.rx || 0,
      tx: t.tx || stats.tx || 0,
    };
  }

  // ===== 行生成：把当天数据拆成 3~9 条「任务」 =====
  function buildRows(st, label) {
    const distance = st.distance;
    const durationH = st.durationMs / 3600000;

    let rowCount = Math.max(2, Math.min(9, Math.round(distance / 8000) + 3));
    if (st.rolls < 5) rowCount = Math.max(2, rowCount - 2);
    if (durationH <= 0 && distance <= 0) rowCount = 1;

    const rows = [COL_LABELS.slice()];      // 第 1 行为表头
    let remain = {
      hour: durationH, km: distance / 1000, rolls: st.rolls,
      keys: st.keys, bytes: (st.rx + st.tx),
    };

    for (let i = 0; i < rowCount; i++) {
      const left = rowCount - i;
      const ratio = 0.4 + Math.random() * 0.5;
      const hour = +(remain.hour / left * (ratio + (1 - ratio) / 2)).toFixed(2);
      const km = +(remain.km / left * (ratio + (1 - ratio) / 2)).toFixed(2);
      const r = Math.max(0, Math.round(remain.rolls / left * (ratio + (1 - ratio) / 2)));
      const k = Math.max(0, Math.round(remain.keys / left * (ratio + (1 - ratio) / 2)));
      const mb = Math.max(0, +(remain.bytes / 1048576 / left * (ratio + (1 - ratio) / 2)).toFixed(1));
      const note = i === rowCount - 1
        ? '收尾数据已上报系统'
        : (Math.random() < 0.25 ? '工单已归档' : (Math.random() < 0.4 ? '设备正常' : ''));

      rows.push([
        String(i + 1).padStart(2, '0'),
        TASKS[(i * 3) % TASKS.length] + '@' + PLACE[(i * 5) % PLACE.length],
        STARTS[i] || (13 + i) + ':00',
        hour.toFixed(2), km.toFixed(2), String(r), mb.toFixed(1), String(k), note,
      ]);

      remain.hour -= hour; remain.km -= km; remain.rolls -= r;
      remain.keys -= k; remain.bytes -= mb * 1048576;
    }

    rows.push([
      '', label || '今日合计', '', durationH.toFixed(2), (distance / 1000).toFixed(2),
      String(st.rolls), ((st.rx + st.tx) / 1048576).toFixed(1), String(st.keys), '',
    ]);
    return rows;
  }

  /** 存档码拆成多行追加在末尾 */
  function appendArchiveRows(rows) {
    const code = archiveCode || '（暂未生成存档码，可在 NetWalk 主面板点「复制码」生成）';
    const chunks = chunkString(code, 58);
    rows.push(['', '存档码（可复制到其他设备导入）', '', '', '', '', '', '', chunks[0] || '']);
    for (let i = 1; i < chunks.length; i++) rows.push(['', '', '', '', '', '', '', '', chunks[i]]);
    return rows;
  }

  function chunkString(s, n) {
    if (!s || s.length <= n) return [s];
    const out = [];
    for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
    return out;
  }

  // ===== 渲染 =====
  function renderHeaders() {
    const colEl = el('colHeaders'); colEl.innerHTML = '';
    for (let c = 0; c < COLS; c++) {
      const d = document.createElement('div');
      d.className = 'col-h';
      d.textContent = String.fromCharCode(65 + c);
      colEl.appendChild(d);
    }
  }

  function renderSheet(rows) {
    const sheet = el('sheet'); sheet.innerHTML = '';
    const rowH = el('rowHeaders'); rowH.innerHTML = '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const isHead = i === 0;
      const isTotalRow = r[1] === '今日合计' || r[1] === '本日合计' || (r[1] && r[1].indexOf('合计') >= 0);
      const isArcRow = r[1] && String(r[1]).indexOf('存档码') >= 0;

      const rh = document.createElement('div');
      rh.className = 'row-h'; rh.textContent = i + 1;
      rowH.appendChild(rh);

      const row = document.createElement('div'); row.className = 'row';
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        if (isHead) cell.className = 'cell head';
        else if (isTotalRow) cell.className = 'cell total';
        else cell.className = 'cell' + (NUM_COLS.has(c) ? ' num' : '');
        if (isArcRow && c === 8) cell.className += ' archive';
        cell.textContent = r[c] == null ? '' : String(r[c]);
        cell.addEventListener('click', () => selectCell(i, c, cell, cell.textContent));
        row.appendChild(cell);
      }
      sheet.appendChild(row);
    }
  }

  function selectCell(r, c, node, value) {
    document.querySelectorAll('.cell.selected').forEach((n) => n.classList.remove('selected'));
    node.classList.add('selected');
    el('fbName').textContent = String.fromCharCode(65 + c) + (r + 1);
    el('fbInput').textContent = value;
  }

  function renderDateOptions() {
    const sel = el('selDate');
    if (!sel) return;
    sel.innerHTML = '';
    // 有数据的最新日期优先；今天若没数据也要能选（只是没内容）
    const dates = allDays.slice().sort().reverse();
    if (dates.indexOf(currentDate) < 0) dates.unshift(currentDate);
    for (const d of dates) {
      const o = document.createElement('option');
      o.value = d; o.textContent = d;
      sel.appendChild(o);
    }
    sel.value = currentDate;
  }

  function updateTitle(date) {
    const name = '工作日报表 - ' + date + '.xlsx - Excel';
    document.title = name;
    const t = document.querySelector('.titlebar .tb-name');
    if (t) t.textContent = '📊 ' + name;
  }

  // ===== 下载 .xls（Excel 兼容的纯 HTML 表格） =====
  function buildXlsHtml(title, rows) {
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"'
      + ' xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><style>'
      + 'table{border-collapse:collapse}td{border:1px solid #888;padding:3px 6px;'
      + 'font-family:Calibri,Microsoft YaHei,sans-serif;font-size:11pt;mso-number-format:"\\@"}'
      + '.h{background:#f3f2f1;font-weight:700}.t{background:#fff2cc;font-weight:700}'
      + '.n{text-align:right;mso-number-format:"General"}.a{color:#555;font-family:Consolas,monospace;font-size:9pt}'
      + 'td.nw{border:0;font-size:14pt;font-weight:700}'
      + '</style></head><body><table>';
    html += '<tr><td class="nw" colspan="' + COLS + '">' + esc(title) + '</td></tr>';
    for (const r of rows) {
      const isTotalRow = r[1] && String(r[1]).indexOf('合计') >= 0;
      const isArcRow = r[1] && String(r[1]).indexOf('存档码') >= 0;
      html += '<tr>' + r.map((v, c) => {
        let cls = '';
        if (isTotalRow) cls = 't';
        else if (NUM_COLS.has(c)) cls = 'n';
        if (isArcRow && c === 8) cls += ' a';
        return '<td class="' + cls.trim() + '">' + esc(v == null ? '' : v) + '</td>';
      }).join('') + '</tr>';
    }
    html += '</table></body></html>';
    return html;
  }

  function saveXls(filename, title, rows) {
    const blob = new Blob(['\uFEFF' + buildXlsHtml(title, rows)], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /** 采集「按日汇总」数据（xls 与 CSV 共用） */
  async function collectDailyRows() {
    const dates = allDays.slice().sort();
    if (!dates.length) dates.push(currentDate);
    const rows = [['日期', '工时(h)', '里程(km)', '路口(次)', '流量(MB)', '击键(次)', '平均速度(km/h)', '最高速度(km/h)', '备注']];
    for (const d of dates) {
      const { day, stats } = await loadDay(d);
      const st = pickStats(day, stats);
      const avg = (day && day.stats && day.stats.avgSpeed) || stats.avgSpeed || 0;
      const max = (day && day.stats && day.stats.maxSpeed) || stats.maxSpeed || 0;
      rows.push([
        d,
        (st.durationMs / 3600000).toFixed(2),
        (st.distance / 1000).toFixed(2),
        String(st.rolls),
        ((st.rx + st.tx) / 1048576).toFixed(1),
        String(st.keys),
        Number(avg || 0).toFixed(2),
        Number(max || 0).toFixed(2),
        '',
      ]);
    }
    const sum = rows.slice(1).reduce((a, r) => ({
      h: a.h + Number(r[1]), km: a.km + Number(r[2]), rolls: a.rolls + Number(r[3]),
      mb: a.mb + Number(r[4]), keys: a.keys + Number(r[5]),
    }), { h: 0, km: 0, rolls: 0, mb: 0, keys: 0 });
    rows.push(['合计', sum.h.toFixed(2), sum.km.toFixed(2), String(sum.rolls), sum.mb.toFixed(1), String(sum.keys), '', '', dates.length + ' 天']);
    return rows;
  }

  /** 导出全部日期的按日汇总（做统计图用） */
  async function downloadAll() {
    const btn = el('btnDownloadAll');
    const old = btn.textContent;
    btn.textContent = '汇总中…'; btn.disabled = true;
    try {
      const rows = await collectDailyRows();
      const dates = allDays.slice().sort();
      if (!dates.length) dates.push(currentDate);
      saveXls('NetWalk_按日汇总_' + today().replace(/-/g, '') + '.xls', 'NetWalk 按日汇总（' + dates.length + ' 天）', rows);
      showOk('已导出 ' + dates.length + ' 天');
    } catch (e) {
      alert('导出失败：' + (e && e.message ? e.message : e));
    } finally {
      btn.textContent = old; btn.disabled = false;
    }
  }

  /** 导出 CSV（UTF-8 BOM）：给其他 AI / 工具处理数据最方便的格式 */
  async function downloadCsv() {
    const btn = el('btnCsv');
    const old = btn.textContent;
    btn.textContent = '生成中…'; btn.disabled = true;
    try {
      const rows = await collectDailyRows();
      const csv = rows.map((r) => r.map((v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'NetWalk_按日汇总_' + today().replace(/-/g, '') + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      showOk('CSV 已导出');
    } catch (e) {
      alert('导出失败：' + (e && e.message ? e.message : e));
    } finally {
      btn.textContent = old; btn.disabled = false;
    }
  }

  // ===== 复制存档码 =====
  async function copyArchive() {
    if (!archiveCode) archiveCode = await loadArchive();
    if (!archiveCode) { alert('生成存档码失败，请稍后再试'); return; }
    try {
      await navigator.clipboard.writeText(archiveCode);
      showOk('已复制 ✓');
    } catch (_) {
      const ta = document.createElement('textarea'); ta.value = archiveCode;
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showOk('已复制 ✓'); } catch (e) { alert('复制失败，请手动从表格里复制'); }
      ta.remove();
    }
  }

  let okTimer = null;
  function showOk(msg) {
    const b = el('okBadge');
    if (!b) return;
    b.textContent = msg; b.style.display = 'inline';
    if (okTimer) clearTimeout(okTimer);
    okTimer = setTimeout(() => { b.style.display = 'none'; }, 2200);
  }

  // ===== 主流程 =====
  let curRows = [];

  async function reload(date) {
    currentDate = date;
    updateTitle(date);
    el('rbnHint').textContent = '正在加载 ' + date + ' …';
    const { day, stats } = await loadDay(date);
    const st = pickStats(day, stats);
    curRows = appendArchiveRows(buildRows(st, '本日合计'));
    renderSheet(curRows);
    el('sbStatus').textContent = '就绪';
    el('sbCount').textContent = '共 ' + (curRows.length - 2) + ' 条记录';
    el('sbSum').textContent = '工时合计 ' + (st.durationMs / 3600000).toFixed(2) + ' h';
    el('rbnHint').textContent = '工作簿：' + date + '   |   ' + (curRows.length - 2) + ' 行';
    if (!st.distance && !st.durationMs) {
      el('sbTip').textContent = date + ' 暂无漫游数据（这天可能没走过）。换个日期看看？';
    } else {
      el('sbTip').textContent = '数据为 ' + date + ' 的漫游统计（已伪装为外勤巡检）。点「复制存档码」可快速复制到新设备。';
    }
  }

  async function main() {
    renderHeaders();
    try {
      allDays = await loadDays();
      archiveCode = await loadArchive();
      renderDateOptions();
      await reload(currentDate);

      const sel = el('selDate');
      if (sel) sel.addEventListener('change', () => reload(sel.value));
      el('btnDownload').addEventListener('click', () => {
        saveXls('NetWalk_' + currentDate + '.xls', '工作日报表 ' + currentDate, curRows);
      });
      el('btnDownloadAll').addEventListener('click', downloadAll);
      el('btnCsv').addEventListener('click', downloadCsv);
      el('btnCopyArc').addEventListener('click', copyArchive);
      el('btnBack').addEventListener('click', () => { location.href = '/'; });
    } catch (e) {
      el('rbnHint').textContent = '加载失败：' + (e && e.message ? e.message : e);
    }
  }

  // 支持 ?date=2026-09-10 直接打开指定日期
  const m = location.search.match(/[?&]date=([\d-]+)/);
  if (m) currentDate = m[1];

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
