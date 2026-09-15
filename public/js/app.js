/**
 * NetWalk 主应用
 */
(function () {
  'use strict';

  const CITIES = {
    北京: { lng: 116.397428, lat: 39.90923 },
    上海: { lng: 121.473701, lat: 31.230416 },
    广州: { lng: 113.264434, lat: 23.129162 },
    深圳: { lng: 114.057868, lat: 22.543099 },
    杭州: { lng: 120.15507, lat: 30.274084 },
    成都: { lng: 104.065735, lat: 30.659462 },
    武汉: { lng: 114.305393, lat: 30.593099 },
    西安: { lng: 108.948021, lat: 34.263161 },
    南京: { lng: 118.797329, lat: 32.060203 },
    重庆: { lng: 106.551643, lat: 29.562849 },
  };
  const SCOPE_LABEL = { city: '城市尺度 1×', china: '全中国 50×', world: '全世界 500×' };

  const $ = (id) => document.getElementById(id);

  /** 坐标是否是可用的经纬度 */
  function isFiniteLatLng(o) {
    return Boolean(o) && Number.isFinite(Number(o.lng)) && Number.isFinite(Number(o.lat))
      && Math.abs(Number(o.lng)) <= 180 && Math.abs(Number(o.lat)) <= 85;
  }

  function cityCenterOf(city) {
    return CITIES[city] || CITIES['深圳'];
  }
  const el = {
    map: $('map'), pillMap: $('pillMap'), pillNet: $('pillNet'), pillKey: $('pillKey'), pillScale: $('pillScale'),
    down: $('mDown'), up: $('mUp'), kpm: $('mKpm'),
    speed: $('mSpeed'), mode: $('mMode'), bar: $('mBar'), intensity: $('mIntensity'),
    road: $('mRoad'), dist: $('mDist'), dur: $('mDur'), rolls: $('mRolls'), avg: $('mAvg'),
    seg: $('mSeg'), rxTot: $('mRxTot'), txTot: $('mTxTot'), keysTot: $('mKeysTot'),
    rollTxt: $('mRollTxt'),
    btnStart: $('btnStart'), btnPause: $('btnPause'), btnEnd: $('btnEnd'),
    btnOverview: $('btnOverview'),
    btnPop: $('btnPop'), btnFold: $('btnFold'), btnUnfold: $('btnUnfold'),
    logList: $('logList'),
    maskSettings: $('maskSettings'), maskDone: $('maskDone'),
    maskOverview: $('maskOverview'),
    ovSummary: $('ovSummary'), ovSvg: $('ovSvg'),
    cfgKey: $('cfgKey'), cfgSec: $('cfgSec'), cfgCity: $('cfgCity'), cfgScope: $('cfgScope'),
    keyNotice: $('keyNotice'),
    btnSaveCfg: $('btnSaveCfg'), btnCloseCfg: $('btnCloseCfg'),
    // 老板键
    cfgBossKey: $('cfgBossKey'), cfgBossOn: $('cfgBossOn'), btnBossTest: $('btnBossTest'), bossHint: $('bossHint'),
    // 出发点
    orCurName: $('orCurName'), orCurCoord: $('orCurCoord'), orHint: $('orHint'),
    orSearch: $('orSearch'), orLng: $('orLng'), orLat: $('orLat'),
    btnOrSearch: $('btnOrSearch'), btnOrPick: $('btnOrPick'), btnOrGeo: $('btnOrGeo'), btnOrReset: $('btnOrReset'),
    pickBar: $('pickBar'), pbCoord: $('pbCoord'), btnPickCancel: $('btnPickCancel'),
    // 高德调用量
    rowAmap: $('rowAmap'), mAmap: $('mAmap'),
    doneStats: $('doneStats'), btnOpenReport: $('btnOpenReport'), btnRestart: $('btnRestart'),
    doneArc: $('doneArc'), btnDoneArcCopy: $('btnDoneArcCopy'),
    btnDoneMail: $('btnDoneMail'), doneHint: $('doneHint'), doneDesc: $('doneDesc'),
    btnOvClose: $('btnOvClose'),
    // 功能栏
    btnAch: $('btnAch'), btnStats: $('btnStats'), btnArchive: $('btnArchive'),
    btnSync: $('btnSync'), btnSettings: $('btnSettings'), btnReport: $('btnReport'), btnCopyArc: $('btnCopyArc'),
    btnShare: $('btnShare'),
    achDot: $('achDot'),
    maskAch: $('maskAch'), achBody: $('achBody'), btnAchClose: $('btnAchClose'),
    maskStats: $('maskStats'), statsTabs: $('statsTabs'), statsGrid: $('statsGrid'),
    statsDaily: $('statsDaily'), btnStatsClose: $('btnStatsClose'),
    maskArchive: $('maskArchive'), arCode: $('arCode'), arInput: $('arInput'), arHint: $('arHint'),
    btnArGen: $('btnArGen'), btnArCopy: $('btnArCopy'), btnArImport: $('btnArImport'), btnArClose: $('btnArClose'),
    btnArApplyCfg: $('btnArApplyCfg'),
    maskShare: $('maskShare'), shareCanvas: $('shareCanvas'),
    btnShareSave: $('btnShareSave'), btnShareCopy: $('btnShareCopy'), btnShareClose: $('btnShareClose'),
    // 版本号与更新概要
    btnVersion: $('btnVersion'), maskVersion: $('maskVersion'),
    verDesc: $('verDesc'), verBody: $('verBody'), btnVerClose: $('btnVerClose'),
    // 旅行者档案
    maskRegister: $('maskRegister'), rgName: $('rgName'), rgEmail: $('rgEmail'),
    rgCode: $('rgCode'), btnRgSend: $('btnRgSend'), rgHint: $('rgHint'),
    rgCity: $('rgCity'), btnRgDone: $('btnRgDone'), btnRgSkip: $('btnRgSkip'),
    maskReset: $('maskReset'), rsCity: $('rsCity'), rsConfirm: $('rsConfirm'),
    btnRsGo: $('btnRsGo'), btnRsCancel: $('btnRsCancel'),
    btnOpenReset: $('btnOpenReset'), profileInfo: $('profileInfo'), originLockHint: $('originLockHint'),
    // 账号与档案
    btnAccount: $('btnAccount'), maskAccount: $('maskAccount'), btnAccClose: $('btnAccClose'),
    accDesc: $('accDesc'), accLogged: $('accLogged'), accLogin: $('accLogin'),
    accCurName: $('accCurName'), accCurEmail: $('accCurEmail'),
    accNewName: $('accNewName'), btnAccRename: $('btnAccRename'),
    accResetText: $('accResetText'), btnAccReset: $('btnAccReset'), accResetHint: $('accResetHint'),
    btnAccLogout: $('btnAccLogout'),
    accEmailInput: $('accEmailInput'), accCode: $('accCode'), btnAccCode: $('btnAccCode'),
    accCodeHint: $('accCodeHint'), accNameInput: $('accNameInput'),
    btnAccRegister: $('btnAccRegister'), btnAccLogin: $('btnAccLogin'),
    // 邮件服务配置（存档码自动发邮箱）
    mailHost: $('mailHost'), mailPort: $('mailPort'), mailUser: $('mailUser'),
    mailPass: $('mailPass'), btnMailSave: $('btnMailSave'), mailHint: $('mailHint'),
    mailImapHost: $('mailImapHost'), mailImapPort: $('mailImapPort'),
    mailBoxStatus: $('mailBoxStatus'), btnMailStatus: $('btnMailStatus'), btnMailPush: $('btnMailPush'),
    autoMailArchive: $('autoMailArchive'), hourlyMailArchive: $('hourlyMailArchive'), btnMailClean: $('btnMailClean'),
    btnSnapTrack: $('btnSnapTrack'), btnFollow: $('btnFollow'),
    btnRepairUndo: $('btnRepairUndo'), btnAlbum: $('btnAlbum'), btnAlbumQuick: $('btnAlbumQuick'), maskAlbum: $('maskAlbum'), albumBody: $('albumBody'), albumSummary: $('albumSummary'), albumTabs: $('albumTabs'), btnAlbumClose: $('btnAlbumClose'),
    albumAddName: $('albumAddName'), albumAddCat: $('albumAddCat'), btnAlbumAdd: $('btnAlbumAdd'), btnAlbumBackfill: $('btnAlbumBackfill'),
    albumNav: $('albumNav'), albumPrev: $('albumPrev'), albumNext: $('albumNext'), albumDate: $('albumDate'),
    maskSyncFirst: $('maskSyncFirst'), btnSyncFirstGo: $('btnSyncFirstGo'), btnSyncFirstSkip: $('btnSyncFirstSkip'), syncFirstHint: $('syncFirstHint'),
    btnRepairArea: $('btnRepairArea'), btnRepairGo: $('btnRepairGo'), btnRepairCancel: $('btnRepairCancel'),
    repairInfo: $('repairInfo'), repairBar: $('repairBar'), pickBox: $('pickBox'), netBanner: $('netBanner'),
    mapBanner: $('mapBanner'), mapBannerText: $('mapBannerText'), btnMapRetry: $('btnMapRetry'), btnMapDiag: $('btnMapDiag'), btnMapSettings: $('btnMapSettings'), btnMapDismiss: $('btnMapDismiss'),
    btnRgLogin: $('btnRgLogin'),
    btnSecClear: $('btnSecClear'), secHint: $('secHint'),
    mVisited: $('mVisited'), mLit: $('mLit'),
  };

  const state = {
    cfg: null,
    provider: null,
    engine: null,
    ws: null,
    started: false,
    lastMail: null,           // 上次「结束漫游」的自动发信结果 { ok, to, error }
    syncPromptDone: false,    // 本次会话是否已问过「要不要先同步存档」
    poiTimer: null,           // 地点收集定时器
    albumRange: 'all',        // 收集册显示范围：all / day（按天回顾）
    albumDate: '',            // 「按天回顾」当前选中的日期
    lastCollectPos: null,     // 上次采集位置（避免原地重复采）
    lastRoad: '',             // 上一条走过的路（换路时立即采集）
    lastCollectAt: 0,         // 上次采集时间（换路触发的限流）
    netAvailable: false,
    keyMode: 'none',
    channel: ('BroadcastChannel' in window) ? new BroadcastChannel('netwalk') : null,
    reportUrl: '',
    reportDate: '',
    reportError: '',
    // 已保存的高德 Key / 安全密钥（输入框留空 = 保持不变，避免"看到空框就重填、填错"）
    savedKey: '',
    savedSec: '',
    pid: null,          // 当前服务进程号：重启后换 pid，用于判断"真的重启完成"
    lastImportedCode: '',   // 最近导入的存档码（用于一键恢复其中携带的本机配置）
    ach: null,
    achFilter: 'all',
    statsRange: 'day',
    shareData: null,
    // 出发点：pending 是设置弹窗里正在编辑的值，保存后才会生效
    pendingOrigin: null,
    picking: false,
  };

  // ---------- 工具 ----------
  function fmtBps(b) {
    const v = Math.max(0, Number(b) || 0);
    const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let i = 0; let n = v;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return { n: n.toFixed(n >= 100 || i === 0 ? 0 : 1), u: u[i] };
  }
  function fmtBpsFull(b) {
    const v = Math.max(0, Number(b) || 0);
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let n = v;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
  }
  function setMetric(node, bps) {
    const f = fmtBps(bps);
    node.innerHTML = `${f.n}<small>${f.u}</small>`;
  }
  function fmtDur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${ss}`;
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /** 邮箱脱敏显示：172805132@qq.com → 172***32@qq.com */
  function maskMail(s) {
    const v = String(s || '');
    const at = v.indexOf('@');
    if (at <= 2) return v;
    const name = v.slice(0, at), domain = v.slice(at);
    if (name.length <= 5) return name.slice(0, 1) + '***' + domain;
    return name.slice(0, 3) + '***' + name.slice(-2) + domain;
  }

  /** 带超时的 GET JSON：邮箱/网络卡住时别把流程一直堵着（返回 null 表示超时或失败） */
  async function fetchJson(url, ms) {
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    let timer = null;
    if (ctrl && ms) timer = setTimeout(() => { try { ctrl.abort(); } catch (_) { /* noop */ } }, ms);
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 带超时的 POST JSON */
  async function postJson(url, body, ms) {
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    let timer = null;
    if (ctrl && ms) timer = setTimeout(() => { try { ctrl.abort(); } catch (_) { /* noop */ } }, ms);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function log(msg) {
    const d = new Date();
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const item = document.createElement('div');
    item.className = 'log-item';
    const ts = document.createElement('span');
    ts.className = 't';
    ts.textContent = t;
    const tx = document.createElement('span');
    tx.textContent = msg;
    item.appendChild(ts);
    item.appendChild(tx);
    el.logList.insertBefore(item, el.logList.firstChild);
    while (el.logList.children.length > 60) el.logList.removeChild(el.logList.lastChild);
  }

  // ---------- 版本号 / 更新概要 ----------
  async function openVersion() {
    el.maskVersion.classList.add('show');
    el.verBody.innerHTML = '<div class="hint">加载中…</div>';
    try {
      const r = await fetch('/api/version');
      const j = await r.json();
      el.btnVersion.textContent = 'v' + (j.version || '0.0.0');
      el.verDesc.textContent = `当前版本 v${j.version} · 共 ${(j.changelog || []).length} 个版本的更新记录`;
      el.verBody.innerHTML = (j.changelog || []).map((c, i) => `
        <div class="ver-item">
          <div class="ver-head">
            <span class="ver-tag">v${c.version}</span>
            <span class="ver-date">${c.date || ''}</span>
            <span class="ver-title">${c.title || ''}</span>
          </div>
          <ul class="ver-list">${(c.items || []).map((t) => `<li>${t}</li>`).join('')}</ul>
        </div>`).join('');
    } catch (e) {
      el.verBody.innerHTML = '<div class="hint">加载失败：' + (e && e.message ? e.message : e) + '</div>';
    }
  }

  // ---------- 账号 / 档案 ----------
  let accountTimer = null;

  async function refreshAccount() {
    try {
      const r = await fetch('/api/account');
      const j = await r.json();
      state.account = j.current || null;
      if (j.pid) state.pid = j.pid;
      el.btnAccount.textContent = state.account ? `👤 ${state.account.name}` : '👤 未登录';
      return j;
    } catch (_) {
      return null;
    }
  }

  function renderAccount(j) {
    const cur = j && j.current;
    el.accLogged.style.display = cur ? 'block' : 'none';
    el.accLogin.style.display = cur ? 'none' : 'block';
    if (cur) {
      el.accCurName.textContent = cur.name;
      el.accCurEmail.textContent = cur.email;
      el.accDesc.textContent = '当前档案的数据（轨迹 / 成就 / 出发点）与其他账号完全隔离。';
    } else {
      el.accDesc.textContent = '每个账号是一份独立的漫游档案：轨迹、成就、出发点完全隔离。';
    }
  }

  /**
   * 回填邮件服务表单：SMTP 主机 / 端口 / 账号 / 授权码（只回显是否已配置）/ IMAP。
   * 每次打开设置都必须调用 —— 否则用户看到空白输入框，以为"没保存"，只好反复重填。
   */
  async function loadMailForm() {
    try {
      const cfg = await fetch('/api/config').then((r) => r.json());
      el.mailHost.value = cfg.mailSmtpHost || '';
      el.mailPort.value = cfg.mailSmtpPort || '';
      el.mailUser.value = cfg.mailUser || '';
      el.mailPass.value = '';
      el.mailPass.placeholder = cfg.mailPass === '***configured***' ? '已配置（填新值可覆盖）' : '授权码';
      if (el.mailImapHost) el.mailImapHost.value = cfg.mailImapHost || '';
      if (el.mailImapPort) el.mailImapPort.value = cfg.mailImapPort || '';
      if (el.autoMailArchive) el.autoMailArchive.checked = cfg.autoMailArchive !== false;
      if (el.hourlyMailArchive) el.hourlyMailArchive.checked = cfg.hourlyMailArchive !== false;   // 默认开
      el.mailHint.textContent = cfg.mailConfigured
        ? '已配置 ✓ 结束漫游 / 点「上传存档」时会把存档码发到邮箱'
        : '';
    } catch (_) { /* noop */ }
  }

  /**
   * 把 "Failed to fetch" 这类网络层报错翻译成人话。
   * 切换账号 / 登录会触发服务重启，重启窗口内的请求必然失败；
   * 直接把英文原样丢给用户，只会让人以为"登录系统坏了"。
   */
  function netErr(e) {
    const m = String((e && e.message) ? e.message : e);
    if (/Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED/i.test(m)) {
      return '与本机服务失去连接（通常是切换账号 / 登录后正在重启）。请等 3~5 秒后刷新页面；若一直如此，关掉 NetWalk 重开。';
    }
    return m;
  }

  /**
   * 回填高德 Key / 安全密钥：只提示"已配置"，输入框留空即保持不变。
   * 跟邮箱配置一个道理 —— 不回填的话用户看到空框会以为没保存，把 Key 粘进安全密钥框，
   * 结果安全密钥 == Key，高德签名失败，地图正常但地址解析一直超时。
   */
  async function loadKeyForm() {
    try {
      const mk = await fetch('/api/mapkey').then((r) => r.json()).catch(() => null);
      const key = (mk && mk.key) || '';
      const sec = (mk && typeof mk.securityJsCode === 'string') ? mk.securityJsCode : '';
      state.savedKey = key;
      state.savedSec = sec;
      el.cfgKey.value = '';
      el.cfgKey.placeholder = key ? '已配置（留空保持不变）' : '留空则使用演练模式（虚构路网）';
      el.cfgSec.value = '';
      el.cfgSec.placeholder = sec ? '已配置（留空保持不变）' : '启用静态安全密钥的 Key 必填（不是 Key 本身）';
    } catch (_) { /* noop */ }
  }

  /** 检查邮箱里有没有 NetWalk 存档邮件，更新状态指示灯 */
  async function checkMailBox() {
    if (!el.mailBoxStatus) return;
    el.mailBoxStatus.textContent = '邮箱存档状态：检查中…';
    el.mailBoxStatus.style.color = '';
    try {
      const j = await fetch('/api/mailbox/status').then((r) => r.json());
      if (!j.imapConfigured) {
        el.mailBoxStatus.textContent = '邮箱存档状态：未配置 IMAP（无法读取），填 imap.qq.com 后可用';
        el.mailBoxStatus.style.color = '#ffb020';
        return;
      }
      if (!j.ok) {
        el.mailBoxStatus.textContent = '邮箱存档状态：读取失败（' + (j.error || '') + '）';
        el.mailBoxStatus.style.color = '#ff5d5d';
        return;
      }
      if (j.hasArchive) {
        el.mailBoxStatus.textContent = `邮箱里已有 ${j.count} 封存档邮件 ✓ 换设备可一键续档`;
        el.mailBoxStatus.style.color = '#4bd06a';
      } else {
        el.mailBoxStatus.textContent = '邮箱里还没有存档邮件 ⚠ 点右边「⬆ 上传存档」发一封';
        el.mailBoxStatus.style.color = '#ffb020';
      }
    } catch (e) {
      el.mailBoxStatus.textContent = '邮箱存档状态：检查失败（' + (e && e.message ? e.message : e) + '）';
      el.mailBoxStatus.style.color = '#ff5d5d';
    }
  }

  async function openAccount() {
    el.maskAccount.classList.add('show');
    const j = await refreshAccount();
    renderAccount(j);
  }

  /** 账号变更后需要重启服务才能切到新数据目录；onReady 在确认新进程就绪后回调 */
  function restartForAccount(onReady) {
    const oldPid = state.pid || null;
    log('账号已切换，正在重启服务加载新档案…');
    el.btnAccount.textContent = '🔄 重启中';
    fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(() => { /* 这个请求本身失败也继续轮询 */ });
    clearInterval(accountTimer);
    let tries = 0;
    let fired = false;
    // 关键：必须等到「换了 pid 的新进程」才算重启成功 ——
    // 旧进程在让出端口前还会应答，只判断"有没有响应"会过早地以为已重启。
    accountTimer = setInterval(async () => {
      tries += 1;
      const j = await refreshAccount();
      if (j && j.pid && j.pid !== oldPid) {
        clearInterval(accountTimer);
        log(`服务已重启（pid ${j.pid}），档案加载完成`);
        if (!fired && typeof onReady === 'function') { fired = true; try { onReady(); } catch (_) { /* noop */ } }
        return;
      }
      if (tries >= 18) {
        clearInterval(accountTimer);
        el.btnAccount.textContent = '⚠ 需手动重开';
        log('⚠ 服务重启后一直没恢复响应。请关闭 NetWalk（含托盘图标）再重新双击 NetWalk.exe —— 数据已保存不会丢。');
      }
    }, 1200);
    setTimeout(() => clearInterval(accountTimer), 30000);
    // 兜底：若 10 秒还没连上（例如端口被重算、服务没能拉起），直接刷新页面自救，
    // 避免用户卡在"登录失败 Failed to fetch"却不知道该怎么办
    setTimeout(async () => {
      try {
        const r = await fetch('/api/status');
        if (!r.ok) location.reload();
      } catch (_) { location.reload(); }
    }, 10000);
  }

  // ---------- 旅行者档案 ----------
  function fillCitySelect(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    const src = el.cfgCity ? el.cfgCity.querySelectorAll('option') : [];
    src.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.value || o.textContent; op.textContent = o.textContent;
      sel.appendChild(op);
    });
  }

  function applyProfileToUi() {
    const p = state.profile;
    if (p && p.exists) {
      el.profileInfo.textContent = `旅行者：${p.name} · ${p.emailMasked} · 出发点：${p.originName || p.city || '未设定'}`;
      el.profileInfo.style.display = 'block';
      el.originLockHint.style.display = 'inline';   // 仅提示"改完要点保存"，不再锁死出发点
    } else {
      el.profileInfo.textContent = '尚未创建档案。首次出发前建议先在欢迎弹窗里注册（起名字 + 选出发点）。';
      el.originLockHint.style.display = 'none';
    }
    // 出发点始终可改（重置之后必然要重选）——确保搜索/点选/定位/重置按钮都是可用的
    ['orSearch', 'btnOrSearch', 'btnOrPick', 'btnOrGeo', 'btnOrReset'].forEach((id) => {
      if (el[id]) el[id].disabled = false;
    });
  }

  async function checkProfile() {
    try {
      const r = await fetch('/api/profile');
      state.profile = await r.json();
    } catch (_) { state.profile = { exists: false }; }
    applyProfileToUi();
    if (!state.profile.exists) {
      fillCitySelect(el.rgCity);
      el.maskRegister.classList.add('show');
    }
  }

  function bindProfileUi() {
    el.btnRgSend.addEventListener('click', async () => {
      const email = el.rgEmail.value.trim();
      if (!email) { el.rgHint.textContent = '请先填邮箱'; return; }
      el.btnRgSend.disabled = true; el.btnRgSend.textContent = '发送中…';
      try {
        const r = await fetch('/api/profile/sendcode', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
        });
        const j = await r.json();
        if (!j.ok) {
          el.rgHint.textContent = '发送失败：' + (j.error || '未知错误');
        } else if (j.delivery === 'local') {
          el.rgHint.innerHTML = `单机模式：验证码为 <b style="font-size:16px;letter-spacing:2px">${j.devCode}</b>（未接入邮件服务，直接输入即可，10 分钟内有效）`;
          el.rgCode.value = j.devCode;
        } else {
          el.rgHint.textContent = '验证码已发送到你的邮箱，请查收（10 分钟内有效）。';
        }
      } catch (e) {
        el.rgHint.textContent = '发送失败：' + (e && e.message ? e.message : e);
      } finally {
        el.btnRgSend.disabled = false; el.btnRgSend.textContent = '发送验证码';
      }
    });

    el.btnRgDone.addEventListener('click', async () => {
      const name = el.rgName.value.trim();
      const email = el.rgEmail.value.trim();
      const code = el.rgCode.value.trim();
      const city = el.rgCity.value || '深圳';
      if (!name) { el.rgHint.textContent = '先起个名字'; return; }
      if (!email || !code) { el.rgHint.textContent = '邮箱和验证码都要填'; return; }
      try {
        const r = await fetch('/api/profile/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, code, city, origin: cityCenterOf(city), originName: city }),
        });
        const j = await r.json();
        if (!j.ok) { el.rgHint.textContent = '注册失败：' + (j.error || '未知错误'); return; }
        el.maskRegister.classList.remove('show');
        state.profile = { exists: true, name, emailMasked: j.profile.emailMasked, city, originName: city };
        applyProfileToUi();
        log(`欢迎，${name}！出发点：${city}。之后每次出发都会从上次结束的位置继续。`);
        el.pillScale.insertAdjacentHTML('afterend', `<div class="pill" id="pillWho">${name}</div>`);
      } catch (e) {
        el.rgHint.textContent = '注册失败：' + (e && e.message ? e.message : e);
      }
    });

    el.btnRgSkip.addEventListener('click', () => {
      el.maskRegister.classList.remove('show');
      log('未注册也可以直接玩（演练模式）；「设置 → 档案」里随时可以注册。');
    });

    // 换设备 / 已有档案：走登录，而不是再注册一份新档案
    if (el.btnRgLogin) el.btnRgLogin.addEventListener('click', () => {
      el.maskRegister.classList.remove('show');
      openAccount();
      log('已打开「账号与档案」：填邮箱 → 获取验证码 → 点「用验证码登录」，登录后可一键同步旧存档。');
    });

    // 重置流程
    el.btnOpenReset.addEventListener('click', () => {
      fillCitySelect(el.rsCity);
      // 默认选中当前城市，而不是列表第一项（避免一不留神把出发点重置到别的城市）
      const cur = (el.cfgCity && el.cfgCity.value) || '';
      if (cur && el.rsCity.querySelector(`option[value="${cur}"]`)) el.rsCity.value = cur;
      el.rsConfirm.value = '';
      el.maskReset.classList.add('show');
    });
    el.btnRsCancel.addEventListener('click', () => el.maskReset.classList.remove('show'));
    el.btnRsGo.addEventListener('click', async () => {
      const confirm = el.rsConfirm.value.trim();
      if (confirm !== '我已知重置将删除全部漫游数据且不可恢复') {
        el.rsConfirm.value = '';
        el.rsConfirm.placeholder = '文字不一致，请一字不差输入';
        return;
      }
      const city = el.rsCity.value || '深圳';
      el.btnRsGo.disabled = true; el.btnRsGo.textContent = '重置中…';
      try {
        const r = await fetch('/api/profile/reset', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm, city, origin: cityCenterOf(city), originName: city }),
        });
        const j = await r.json();
        if (!j.ok) {
          el.rsConfirm.value = '';
          el.rsConfirm.placeholder = j.error || '重置失败';
          return;
        }
        el.maskReset.classList.remove('show');
        el.maskSettings.classList.remove('show');
        try { localStorage.setItem('netwalkJustReset', '1'); } catch (_) { /* noop */ }
        try { localStorage.setItem('netwalkNoAutoSync', '1'); } catch (_) { /* noop */ }
        log('已重置全部数据。刷新后请在「设置 → 出发点」重新选择出发位置，再点「保存并重启漫游」。');
        setTimeout(() => location.reload(), 900);
      } catch (e) {
        el.rsConfirm.placeholder = '重置失败：' + (e && e.message ? e.message : e);
      } finally {
        el.btnRsGo.disabled = false; el.btnRsGo.textContent = '我确认，重置';
      }
    });
  }

  // ---------- 老板键 / 托盘 ----------
  async function refreshBossHint() {
    if (!el.bossHint) return;
    try {
      const r = await fetch('/api/boss');
      const j = await r.json();
      if (!j.supported) el.bossHint.textContent = '提示：托盘图标只在 Windows 桌面版（打包后的 exe）启用。';
      else if (!j.available) el.bossHint.textContent = j.error ? `托盘未能启动：${j.error}` : '托盘正在启动，稍等几秒…';
      else el.bossHint.textContent = j.hidden ? '当前状态：窗口已隐藏，再按一次老板键（或双击小图标）恢复。' : '当前状态：托盘图标已就绪，随时可用。';
    } catch (_) {
      el.bossHint.textContent = '';
    }
  }

  async function toggleBoss() {
    try {
      const r = await fetch('/api/boss', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle' }),
      });
      const j = await r.json();
      if (!j.available) log('托盘还没准备好，稍等几秒再试');
      else log(j.hidden ? '窗口已隐藏，右下角托盘图标还在（游戏照常走）' : '窗口已恢复');
      refreshBossHint();
    } catch (_) {
      log('隐藏失败：托盘不可用');
    }
  }

  // ---------- 启动 ----------
  async function boot() {
    const res = await fetch('/api/config');
    state.cfg = await res.json();
    const city = CITIES[state.cfg.city] ? state.cfg.city : '深圳';
    // 真正采用配置里的出发点（此前 cfg.origin 被保存却从未被前端读取）
    const useCustom = Boolean(state.cfg.originCustom) && isFiniteLatLng(state.cfg.origin);
    state.origin = useCustom
      ? { lng: Number(state.cfg.origin.lng), lat: Number(state.cfg.origin.lat) }
      : Object.assign({}, cityCenterOf(city));
    el.cfgCity.value = city;
    el.cfgScope.value = state.cfg.scope || 'city';
    const boss = state.cfg.boss || { enabled: true, key: 67, mods: '' };
    el.cfgBossKey.value = `${boss.key}|${boss.mods || ''}`;
    el.cfgBossOn.checked = boss.enabled !== false;
    refreshBossHint();
    // 版本号胶囊：拿服务端的版本号填上去（点它可看更新概要）
    fetch('/api/version').then((r) => r.json()).then((j) => {
      if (j && j.version && el.btnVersion) el.btnVersion.textContent = 'v' + j.version;
    }).catch(() => { /* 拿不到就保留 HTML 里的默认值 */ });
    // 账号胶囊：刷新登录态（否则保存设置后刷新页面会错误显示"未登录"）
    refreshAccount();
    el.pillScale.textContent = SCOPE_LABEL[state.cfg.scope] || SCOPE_LABEL.city;

    await initProvider(state.origin);
    connectWs();
    bindUi();
    initNetWatch();
    // 供测试/外部调用的纯函数（区域修复的分段与判定逻辑）
    // 排障/自动化测试钩子：只读状态 + 重置「出发前同步提示」
    window.NetWalkDebug = {
      state,
      resetSyncPrompt() { state.syncPromptDone = false; },
      poiCat,
      pickFormalPois,
      normalizePlace,
      collectPlacesNow,
      showMapBanner,
      hideMapBanner,
      runAmapDiag,
      backfillDay,
      repairArea,
      loadAllDays,
      drawHistoryOnMap,
    };
    window.NetWalkRepairUtil = { splitByDistance, insideBounds, countInBounds, nextPieceIndex, bboxOf, pathLen, routeSane };
    bindProfileUi();
    setupLocalKeyFallback();
    checkProfile();
    // 刚重置过：自动打开设置、滚到「出发点」，引导用户重选起点（重置后必做的一步）
    try {
      if (localStorage.getItem('netwalkJustReset') === '1') {
        localStorage.removeItem('netwalkJustReset');
        setTimeout(() => {
          el.keyNotice.style.display = state.cfg.hasKey ? 'none' : 'block';
          renderOriginFields();
          loadMailForm();
          loadKeyForm();   // 必须回填！否则保存时 savedKey 为空，会把已配置的 Key 清掉（地图变虚拟路网）
          el.maskSettings.classList.add('show');
          const f = $('originField');
          if (f && f.scrollIntoView) f.scrollIntoView({ block: 'center' });
          log('重置完成：请在「出发点」里重新选择起始位置，然后点「保存并重启漫游」。');
        }, 600);
      }
    } catch (_) { /* noop */ }

    if (useCustom) log(`出发点：${state.cfg.originName || '自定义位置'}`);
    else log(`出发点：${city}市中心（可在设置里改成任意地点）`);

    // 打开软件时，地图中心 = 上次结束点（而不是出发点）——用户每天打开都该"接着上次看"
    findLastPosition().then((lp) => {
      if (!lp) return;
      try {
        const p = state.provider;
        if (p && p.map && typeof p.map.setCenter === 'function') {
          p.map.setCenter([lp.lng, lp.lat]);
        } else if (p && typeof p.setCenter === 'function') {
          p.setCenter(lp.lng, lp.lat);
        }
        log(`地图已定位到上次结束位置（${lp.lat.toFixed(4)}, ${lp.lng.toFixed(4)}）——出发也将从这里继续`);
      } catch (_) { /* 演练模式等没有 setCenter 的情况忽略 */ }
    });

    if (!state.cfg.hasKey) {
      el.pillMap.textContent = '演练路网（虚构）';
      el.pillMap.className = 'pill warn';
      log('未配置高德 Key，已进入演练模式，路名为虚构');
    }

    // 支持 ?autostart=1 打开即出发，便于开机自启或无人值守挂机
    if (new URLSearchParams(location.search).get('autostart') === '1') {
      log('自动出发');
      startWalk();
    }

    // 启动即结算一次成就（历史数据也算）
    refreshAchievements().then((r) => {
      if (r && r.got) log(`已解锁 ${r.got} / ${r.total} 个成就`);
    });
  }

  async function initProvider(origin) {
    try {
      if (state.cfg.hasKey && state.cfg.provider === 'amap') {
        // 真实 Key 由本机专用接口下发，/api/config 中为脱敏值
        const mk = await fetch('/api/mapkey').then((r) => r.json()).catch(() => ({ key: '' }));
        if (!mk.key) throw new Error('未取到高德 Key');
        const p = new window.AmapProvider({
          key: mk.key,
          securityJsCode: mk.securityJsCode || '',
          zoom: 16,
          maxCallsPerDay: Number(state.cfg.amapMaxCallsPerDay) || 4000,
        });
        p.onBudgetWarning = (st) => {
          log(`⚠ 高德今日调用已用 ${st.total}/${st.budget}，接近上限后会退化为直线推进（不影响玩法）`);
        };
        await p.init(el.map, { center: origin });
        state.provider = p;
        // 地图自由拖动：用户拖动 → 自动解除镜头跟踪；🎯 按钮一键回到分身并恢复跟踪
        if (p.map && p.map.on) {
          p.map.on('dragstart', () => { setMapFollowing(false); });
        }
        el.rowAmap.style.display = 'flex';
        updateAmapCalls();
        el.pillMap.textContent = '高德路网 · 加载中';
        el.pillMap.className = 'pill';
        log('已连接高德，正在加载地图首帧…');
        verifyAmapFrame(p);   // 不阻塞启动，出图后自己更新状态
        return;
      }
      throw new Error('no amap key');
    } catch (err) {
      const p = new window.DrillProvider({ origin, spacing: 165, extent: 34, ppm: 1.05 });
      await p.init(el.map, { center: origin });
      state.provider = p;
      el.rowAmap.style.display = 'none';
      el.pillMap.textContent = '演练路网（虚构）';
      el.pillMap.className = 'pill warn';
      const why = err && err.message && err.message !== 'no amap key' ? err.message : '';
      log(`演练模式已就绪${why ? '（' + why + '）' : ''}`);
      // 配了 Key 却加载不出高德 → 明确告诉用户并给出可点的下一步（换电脑最常见）
      if (why) {
        showMapBanner(`⚠ 高德地图加载失败：${why}　现用演练路网，可正常行走。`);
        log('　可点提示条上的「🔍 诊断」查清是网络还是 Key 的问题；修好后点「🔄 重试」。');
      }
    }
  }

  /** DOCK 里的高德调用量（按天累计，用于盯住免费额度） */
  function updateAmapCalls() {
    const p = state.provider;
    if (!p || typeof p.callStats !== 'function') return;
    const st = p.callStats();
    el.mAmap.textContent = `${st.total} / ${st.budget}`;
    el.mAmap.style.color = st.left <= 0 ? 'var(--hot)' : (st.left <= st.budget * 0.1 ? 'var(--warn)' : '');
  }

  /**
   * 高德 SDK 加载成功、但地图出不了图，基本是 Key 服务类型不对或缺少安全密钥。
   * 这种情况不会抛异常，只会留一张空白地图——必须主动告诉用户怎么修。
   */
  async function verifyAmapFrame(p) {
    const framed = await p.waitFirstFrame(8000);
    if (state.provider !== p) return;   // 期间已切换提供者
    if (framed) {
      el.pillMap.textContent = '高德真实路网';
      el.pillMap.className = 'pill on';
      log('高德真实路网已就绪');
      return;
    }
    el.pillMap.textContent = '高德地图未就绪';
    el.pillMap.className = 'pill warn';
    log('⚠ 高德地图 8 秒内未完成首次渲染');
    log('　请检查：① Key 是否已启用「Web 端 (JS API)」服务　② 控制台若要求安全密钥，请在设置里补填');
    showMapBanner('⚠ 高德脚本已加载，但地图 8 秒未出图 —— 多半是 Key 服务类型不对或缺安全密钥。');
  }

  // ---------- WebSocket ----------
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch (err) {
      setTimeout(connectWs, 3000);
      return;
    }
    state.ws = ws;
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type !== 'tick') return;
      state.netAvailable = Boolean(msg.net && msg.net.available);
      state.keyMode = (msg.key && msg.key.mode) || 'none';
      el.pillNet.textContent = state.netAvailable
        ? `网络 ${msg.net.iface || '—'}`
        : '网络采集不可用';
      el.pillNet.className = `pill ${state.netAvailable ? 'on' : 'warn'}`;
      el.pillKey.textContent = state.keyMode === 'global' ? '全局击键监听' : '仅窗口内击键';
      el.pillKey.className = `pill ${state.keyMode === 'global' ? 'on' : 'warn'}`;
      setMetric(el.down, msg.net.rx);
      setMetric(el.up, msg.net.tx);
      el.kpm.innerHTML = `${msg.key.kpm}<small>KPM</small>`;
      if (state.engine) state.engine.feed(msg.net, msg.key);
      if (state.channel) state.channel.postMessage({ type: 'tick', net: msg.net, key: msg.key });
    };
    ws.onclose = () => {
      el.pillNet.textContent = '连接中断，重连中';
      el.pillNet.className = 'pill warn';
      // 与服务端断开时无法写入轨迹 → 一律自动暂停（恢复后自动继续）
      autoEndForNet('与服务端连接中断');
      setTimeout(connectWs, 2500);
    };
    ws.onerror = () => { try { ws.close(); } catch (_) { /* noop */ } };
  }

  /** 后端无系统级钩子时，统计本窗口内的击键作为兜底 */
  function setupLocalKeyFallback() {
    let count = 0;
    let lastSend = 0;
    document.addEventListener('keydown', () => {
      if (state.keyMode === 'global') return;
      if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) {
        // 输入框内的击键同样计入，但避免与全局钩子重复计数
      }
      count++;
      const now = Date.now();
      if (now - lastSend > 400 && count > 0) {
        const n = count; count = 0; lastSend = now;
        fetch('/api/key', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: n }),
        }).catch(() => { /* noop */ });
      }
    });
  }

  // ---------- 引擎 ----------
  /**
   * 完整的一键同步：恢复配置（高德 Key / 邮箱 / 出发点）+ 拉回最新存档。
   * 登录后 / 「一键同步」按钮共用。返回摘要供 UI 展示。
   * skipData=true 时只恢复配置，不拉旧存档 —— 本机重置过、不想被旧轨迹污染时用。
   */
  async function syncFromMailbox({ skipData = false } = {}) {
    const res = { ok: false, restored: '', pulled: '', keyRestored: false, days: 0, skipped: skipData };
    const rc = await fetch('/api/mailbox/restore-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then((x) => x.json()).catch(() => null);
    if (rc && rc.ok) res.restored = '配置 ' + (rc.restored || []).length + ' 项';
    if (skipData) return res;
    const mp = await fetch('/api/mailbox/pull', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then((x) => x.json()).catch(() => null);
    if (mp && mp.ok) {
      res.ok = true;
      res.days = (mp.result && mp.result.days) || 0;
      res.pulled = '存档 ' + res.days + ' 天';
      if (mp.result && mp.result.resetTakeover) res.takeover = true;
      if (mp.keyRestored) res.keyRestored = true;
      // 收集册也跟着存档回来了（换电脑后不用重新采）
      const pm = mp.result && mp.result.places;
      if (pm && (pm.added || pm.merged)) {
        res.places = pm;
        res.pulled += '，收集册 +' + pm.added + ' 个地点';
      }
      // 明确告诉用户接下来会从哪里继续（跨设备同步后尤其重要，不然不知道有没有同步对）
      try {
        const lp = await fetch('/api/lastpos').then((x) => x.json()).catch(() => null);
        if (lp && lp.pos !== null && isFiniteLatLng(lp)) {
          res.resume = { lat: Number(lp.lat), lng: Number(lp.lng), date: lp.date };
        }
      } catch (_) { /* noop */ }
      // 出发次数（两台设备合并并全局重排后的总数）
      try {
        const ss = await fetch('/api/sessions').then((x) => x.json()).catch(() => null);
        if (ss && Array.isArray(ss.starts) && ss.starts.length) res.sessionCount = ss.starts.length;
      } catch (_) { /* noop */ }
    } else if (mp && mp.error) {
      res.pulled = mailErrorHint(mp.error);
    }
    return res;
  }

  /** 出发前从邮箱拉回最新存档码（配置了 IMAP 才可用；失败不影响本地出发） */
  async function pullArchiveFromMailbox() {
    try {
      // 重置过后不再自动同步：否则点一次「出发」就把邮箱里的旧存档（含重置前那些错误数据）
      // 又拉回来了，表现为"重置了没用、一点出发又飞回深圳"。想同步请到「账号与档案」点「一键同步」。
      if (localStorage.getItem('netwalkNoAutoSync') === '1') {
        log('已重置：本次不自动从邮箱同步（避免把旧存档拉回来）。需要同步请到「账号与档案」点「一键同步」。');
        return;
      }
      // 邮箱拉存档可能很慢（IMAP 握手），加 25 秒上限：超时就按本地数据继续，不耽误出发
      const j = await postJson('/api/mailbox/pull', {}, 25000);
      if (j && j.ok) {
        const imp = j.result || {};
        // 同步把高德 Key 也带回来了（新设备原本没有）→ 必须重载才能从虚拟路网切到真实地图
        if (j.keyRestored) {
          log('检测到本机没有高德 Key，已从邮箱存档自动恢复 —— 正在重新加载以启用真实地图…');
          setTimeout(() => location.reload(), 1500);
          return;
        }
        const extras = [];
        if (j.restoredKeys && j.restoredKeys.length) extras.push('配置 ' + j.restoredKeys.length + ' 项');
        const pm = imp.places;
        if (pm && (pm.added || pm.merged)) extras.push('收集册 ' + pm.added + ' 个新地点' + (pm.merged ? '（补齐 ' + pm.merged + ' 条路名/距离）' : ''));
        log(`已从邮箱同步最新存档（${imp.total != null ? imp.total + ' 天' : '完成'}）`
          + (extras.length ? '，并恢复' + extras.join('、') : '')
          + '，将从上次结束点继续');
      }
      // 失败静默：本地数据照常使用，具体原因在日志里（未配置 IMAP / 收件箱无存档邮件）
    } catch (_) { /* 离线时忽略 */ }
  }
  /** 找"最近一次走过的位置"：服务端 /api/lastpos 直接扫最近 90 天的数据，跨天续走 */
  async function findLastPosition() {
    try {
      const lp = await fetch('/api/lastpos').then((r) => r.json()).catch(() => null);
      if (lp && lp.pos !== null && isFiniteLatLng(lp)) {
        return { lng: Number(lp.lng), lat: Number(lp.lat), date: lp.date };
      }
    } catch (_) { /* 离线时忽略 */ }
    return null;
  }

  /**
   * 要不要在出发前问「先同步存档」：
   * 本机没有任何轨迹 + 已配置 IMAP 邮箱 + 不是重置后的免同步状态 + 不是脚本自动出发。
   */
  const SYNC_CHOICE_KEY = 'netwalkSyncPromptChoice';   // 本机已做过的选择：sync / skip（每台机器只问一次）
  async function shouldPromptSyncFirst() {
    if (state.syncPromptDone) return false;              // 本次会话已经问过/已选择
    if (localStorage.getItem('netwalkNoAutoSync') === '1') return false;   // 刚重置：明确不要再拉旧存档
    try {
      if (localStorage.getItem(SYNC_CHOICE_KEY)) return false;   // 这台机器已经选过（开机自启时不再反复打扰）
    } catch (_) { /* noop */ }
    // 注意：即使 ?autostart=1 开机自启也要问 —— 之前跳过它，导致新机器一开机就直接开走，邮箱里的旧存档没同步，两台机器各走各的
    // 两个请求都带超时：网络/邮箱卡住时不能把「出发」一直堵着
    try {
      const st = await fetchJson('/api/mailbox/status', 5000);
      if (!st || !st.imapConfigured || !st.hasArchive) return false;
      const r = await fetchJson('/api/track/range?from=0000-01-01&to=' + today(), 5000);
      const days = (r && r.days) || [];
      const pts = days.reduce((n, d) => n + ((d.path || []).length), 0);
      return pts < 10 || days.length <= 1;    // 本机几乎没数据 / 只有一天 → 很可能是一台新设备
    } catch (_) { return false; }
  }

  function openSyncPrompt() {
    state.syncPromptDone = true;
    if (el.maskSyncFirst) el.maskSyncFirst.classList.add('show');
  }

  async function startWalk() {
    if (!state.provider) return;
    // 断网时禁止出发（防循环：出发→断网→自动结束→再出发）
    if (navigator.onLine === false) { log('⚠ 当前无网络，无法规划路线。请联网后再出发'); return; }

    // 新设备忘了同步：本机没有任何轨迹但配了邮箱存档 → 先问一句
    if (await shouldPromptSyncFirst()) { openSyncPrompt(); return; }
    await pullArchiveFromMailbox();
    // 拉取今日已走过的路（本轮不再重复走）+ 上次结束位置（跨天也继续）
    let visitedRoads = [];
    try {
      const day = await fetch('/api/day/' + today()).then((r) => r.json());
      visitedRoads = day.visitedRoads || [];
    } catch (_) { /* 离线时忽略 */ }
    const resume = await findLastPosition();

    const origin = resume || state.origin;
    const engine = new window.RoamEngine({
      provider: state.provider,
      cfg: state.cfg.speed,
      origin,
      scope: state.cfg.scope || 'city',
      visitedRoads,
      onUpdate: onEngineUpdate,
      onRoll: onEngineRoll,
      onLog: log,
      // 连续 3 次路线规划失败（多为断网）→ 自动暂停，避免继续走出不贴路的直线段
      onPlanUnavailable: () => autoEndForNet('路线规划连续失败（网络似乎不可用）'),
    });

    if (resume) {
      const when = resume.date === today() ? '上次结束位置' : `${resume.date} 的结束位置`;
      log(`从${when}继续（${resume.lat.toFixed(4)}, ${resume.lng.toFixed(4)}）——出发点只在注册时设定一次`);
    } else {
      log('从出发点出发');
    }
    // 先拿本次出发的全局序号（轨迹点要带上它，绘制时按会话切分、杜绝跨设备飞线），再启动引擎
    let sessionNo = 0;
    try {
      const sj = await fetch('/api/session/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today(), city: state.cfg.city, scope: state.cfg.scope, lat: origin.lat, lng: origin.lng }),
      }).then((r) => r.json());
      if (sj && sj.sessionNo) sessionNo = sj.sessionNo;
    } catch (_) { /* 离线时忽略 */ }
    // 先画历史轨迹（setTrack 会清掉旧的出发点标记），再补本次出发的紫点，顺序不能反
    drawHistoryOnMap(origin);
    if (sessionNo && state.provider && state.provider.addStartMarker) {
      state.provider.addStartMarker(origin.lat, origin.lng, sessionNo);
      log(`第 ${sessionNo} 次出发（地图上已用紫点标出）`);
    }
    state.engine = engine;
    engine.sessionNo = sessionNo;
    engine.start();
    state.started = true;
    el.btnStart.disabled = true;
    startPlaceCollector();   // 路过正式场所自动收集
    el.btnPause.disabled = false;
    el.btnEnd.disabled = false;
    el.btnPause.textContent = '暂停';
  }

  /**
   * 把轨迹点切成"连续段"（杜绝飞线的统一规则，命中任一即断开）：
   * ① 跨会话：点的会话号不同，或跨过某次「出发」的时间点
   * ② 空间断：相邻点跳变 >250m（瞬移 / 直线兜底留下的跨块直线）
   * ③ 时间断档：>15 分钟（中间没走，连起来也是假线）
   */
  function splitTrackSegments(points, starts) {
    const st = (starts || []).map((x) => Number(x.t !== undefined ? x.t : x)).filter(Boolean).sort((a, b) => a - b);
    const segs = [];
    let cur = [];
    let si = 0;
    for (const p of points) {
      // 直线兜底的点不画（用户要求去掉飞线）：直接断开并跳过该点。
      // 这类段的缺口可以随时用「🧭 轨迹整备」重新沿真实道路补上。
      if (p.straight) {
        if (cur.length > 1) segs.push(cur);
        cur = [];
        continue;
      }
      while (si < st.length && st[si] <= (p.t || 0)) {
        si++;
        if (cur.length > 1) segs.push(cur);
        cur = [];
      }
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const noA = Number(prev.no) || 0, noB = Number(p.no) || 0;
        const m = haversineKm(prev, p);
        const dt = (p.t || 0) - (prev.t || 0);
        // 时间断档 >15 分钟：只有当断档期间位置还移动了 >100m 才切开 ——
        // 原地暂停（挂机/休息）位置没变，连起来是无害的零长度线，切开反而让轨迹断成两截（用户要求）。
        if (m > 250 || (dt > 15 * 60000 && m > 100) || (noA && noB && noA !== noB)) {
          if (cur.length > 1) segs.push(cur);
          cur = [];
        }
      }
      cur.push(p);
    }
    if (cur.length > 1) segs.push(cur);
    return segs;
  }

  /** 把历史上所有走过的轨迹画到主地图（按速度渐变分色），出发时调用 */
  async function drawHistoryOnMap(origin) {
    if (!state.provider || !state.provider.setTrack) return;
    try {
      const r = await fetch('/api/track/range?from=0000-01-01&to=' + today()).then((x) => x.json());
      const days = (r && r.days) || [];
      const flat = days.flatMap((d) => d.path || []);

      if (flat.length < 2) { log('地图上还没有历史轨迹，本次行走将开始画线'); }
      else {
        const segs = splitTrackSegments(flat, (r && r.starts) || []);
        segs.forEach((seg, idx) => {
          state.provider.setTrack(seg, { append: idx > 0 });
        });
        log(`已把历史轨迹画上地图：${days.length} 天、${flat.length} 个点、${segs.length} 段连续轨迹（已剔除跨设备/跨会话飞线）`);
      }
      for (const st of (r && r.starts) || []) {
        if (state.provider.addStartMarker) state.provider.addStartMarker(st.lat, st.lng, st.n);
      }
    } catch (_) { /* 离线时忽略，不影响行走 */ }
  }

  // ------------------------------------------------------------------
  // 断网自动暂停：离线时引擎无法规划路线，会退化成"直线兜底"走出不贴路的轨迹，
  // 所以断网立即暂停；恢复联网后自动继续（手动暂停过则不自动恢复）
  // ------------------------------------------------------------------
  function showNetBanner(text) {
    if (!el.netBanner) return;
    el.netBanner.textContent = text;
    el.netBanner.classList.add('show');
  }

  function hideNetBanner() {
    if (el.netBanner) el.netBanner.classList.remove('show');
  }

  /** 高德加载失败提示条（带 重试 / 诊断 / 设置 按钮） */
  function showMapBanner(text) {
    if (!el.mapBanner) return;
    if (el.mapBannerText) el.mapBannerText.textContent = text;
    el.mapBanner.classList.add('show');
  }
  function hideMapBanner() {
    if (el.mapBanner) el.mapBanner.classList.remove('show');
  }

  /** 高德加载失败诊断：分清「网络到不了高德」还是「Key 被高德拒绝」 */
  async function runAmapDiag() {
    log('🔍 正在诊断高德连通性…');
    let d = null;
    try {
      d = await fetch('/api/amapcheck').then((r) => r.json());
    } catch (e) {
      log('诊断失败：' + ((e && e.message) || e));
      return;
    }
    if (!d) { log('诊断没有返回结果'); return; }
    log(`　Key 已配置：${d.keyed ? '是' : '否'}`);
    if (d.keyed) {
      log(`　本机直连 webapi.amap.com：${d.reachable ? '通（' + d.ms + 'ms，HTTP ' + d.status + '）' : '不通（' + (d.error || '超时') + '）'}`);
      if (d.reachable) log(`　高德是否拒绝该 Key：${d.keyRejected ? '是（Key 无效/类型不对/被限流）' : '否'}`);
    }
    log('　结论：' + (d.hint || '无'));
    showMapBanner('🔍 ' + (d.hint || '诊断完成，详见日志'));
  }

  /** 断网 → 直接结束行程（联网后手动重新出发即可，存档码已有最新数据） */
  function autoEndForNet(reason) {
    if (!state.started || state.netEndInProgress) return;
    state.netEndInProgress = true;
    log(`⚠ ${reason} —— 已自动结束行程。断网时无法规划路线会走出不贴路的轨迹；联网后重新出发即可（存档码里已有最新数据）`);
    showNetBanner(`⚠ ${reason} · 已自动结束行程，联网后重新出发`);
    endWalk().catch(() => {}).finally(() => { state.netEndInProgress = false; });
  }

  function initNetWatch() {
    window.addEventListener('offline', () => autoEndForNet('检测到本机网络已断开'));
    window.addEventListener('online', () => { hideNetBanner(); log('✅ 网络已恢复，可以重新出发'); });
    // 兜底轮询：某些断网场景不触发 offline 事件（如只断外网、网卡还在）
    setInterval(() => {
      if (!state.started) return;
      if (navigator.onLine === false) autoEndForNet('检测到本机网络已断开');
    }, 5000);
  }

  // ------------------------------------------------------------------
  // 区域轨迹修复：框选一块区域 → 只把框内的轨迹重新沿真实道路规划
  // ------------------------------------------------------------------
  /** 按累计距离把点列切成 ≤maxM 米的小段（相邻段共享边界点，保证连续） */
  function splitByDistance(pts, maxM) {
    const out = [];
    let cur = [];
    for (let i = 0; i < pts.length; i++) {
      cur.push(pts[i]);
      if (cur.length >= 2 && i < pts.length - 1) {
        const d = haversineKm(cur[0], cur[cur.length - 1]);
        if (d >= maxM) { out.push(cur); cur = [pts[i]]; }
      }
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function insideBounds(p, b) {
    return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
  }

  /** 一段折线的包围盒 */
  function bboxOf(pts) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
    }
    return { minLat, maxLat, minLng, maxLng };
  }

  function pathLen(pts) {
    let d = 0;
    for (let k = 1; k < pts.length; k++) d += haversineKm(pts[k - 1], pts[k]);
    return d;
  }

  /** 规划结果是否可信：不能跑出原始范围 330m 以上，长度也不能超过原始的 3 倍（防止绕远把轨迹"修没了"） */
  function routeSane(route, piece) {
    if (!route || !Array.isArray(route.points) || route.points.length < 2) return false;
    const bb = bboxOf(piece);
    const pad = 0.003;   // ≈330m
    for (const q of route.points) {
      if (q.lat < bb.minLat - pad || q.lat > bb.maxLat + pad || q.lng < bb.minLng - pad || q.lng > bb.maxLng + pad) return false;
    }
    const rawLen = pathLen(piece) || 1;
    return pathLen(route.points) <= rawLen * 3 + 200;
  }

  /** 修复分段：从 i 出发按累计 ~stepM 米找本段终点下标（终点必定是原始轨迹点，保证修复后仍贴用户走向） */
  function nextPieceIndex(run, i, stepM) {
    let j = i + 1, acc = 0;
    while (j < run.length - 1) {
      acc += haversineKm(run[j - 1], run[j]);
      if (acc >= stepM) break;
      j++;
    }
    return j;
  }

  /** 用重新规划出的路线替换一段轨迹：时间按距离比例重排，路名按步骤里程映射重算 */
  function retimeChunk(route, ch) {
    const pts = route.points;
    const t0 = ch[0].t, t1 = ch[ch.length - 1].t || t0 + 60000;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1] || 1;
    const steps = route.steps || [];
    const stepSum = steps.reduce((s2, x) => s2 + (x.distance || 0), 0);
    const k = stepSum > 0 ? total / stepSum : 1;
    const roadAt = (d) => {
      let acc = 0;
      for (const st of steps) {
        acc += (st.distance || 0) * k;
        if (d <= acc) return st.road || '';
      }
      return steps.length ? (steps[steps.length - 1].road || '') : '';
    };
    const durSec = Math.max(1, (t1 - t0) / 1000);
    const spd = Math.round(((total / durSec) * 3.6) * 10) / 10;
    const mode = ch[0].mode || 'walk';
    const no = Number(ch[0].no) || 0;   // 修复后的点沿用原会话号（绘制切分依赖它）
    return pts.map((p, i) => ({
      t: Math.round(t0 + (cum[i] / total) * (t1 - t0)),
      lat: p.lat, lng: p.lng,
      road: roadAt(cum[i]) || (ch[0].road || ''),
      spd, mode,
      no,
      straight: 0,   // 修复后的点都贴路，不再是直线兜底
    }));
  }


  /** 统计框内点数/段数/涉及天数（用于确认条提示，不写盘） */
  function countInBounds(days, b) {
    let pts = 0, runs = 0, dayN = 0;
    for (const day of days) {
      const path = day.path || [];
      let hit = 0, run = 0, started = false;
      for (const p of path) {
        if (insideBounds(p, b)) { hit++; run++; if (!started) { runs++; started = true; } }
        else started = false;
      }
      if (hit) { pts += hit; dayN++; }
      void run;
    }
    return { pts, runs, dayN };
  }

  async function loadAllDays() {
    const r = await fetch('/api/track/range?from=0000-01-01&to=' + today()).then((x) => x.json());
    return (r && r.days) || [];
  }

  /**
   * 区域修复主流程：只替换落在框内的连续段，框外原样保留。
   * 关键：规划端点取「原始轨迹点」，按 ~200m 一段逐段规划后拼接 ——
   * ① 每段规划距离短、成功率高（以前整条一次规划，长距离容易失败或被绕远）
   * ② 端点锚定在原走向上，修复后仍贴合用户真实路径，不会跑到别的路上
   * ③ 失败的段保留原样（宁可不动，也不写坏数据），并如实汇报段数
   */
  async function repairArea(bounds) {
    const days = await loadAllDays();
    let daysFixed = 0, segOK = 0, segKeep = 0, segWild = 0, ptsIn = 0, skipped = 0;
    const planOne = async (a, b) => {
      try {
        const r = await Promise.race([
          state.provider.planRoute({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }),
          new Promise((res) => setTimeout(() => res(null), 8000)),
        ]);
        return (r && r.points && r.points.length >= 2) ? r : null;
      } catch (_) { return null; }
    };
    /** 把框内的一段轨迹重新沿道路规划（端点锚定原轨迹点；任何异常都保留原始点，绝不丢） */
    const repairRun = async (run, emit) => {
      ptsIn += run.length;
      if (run.length < 2) { emit(run); return; }   // 单点段原样保留（曾经会把这点删掉）
      const STEP_M = 200;          // 每 ~200m 一个规划单元
      let i = 0;
      let first = true;
      while (i < run.length - 1) {
        const j = nextPieceIndex(run, i, STEP_M);
        const piece = run.slice(i, j + 1);
        const route = await planOne(run[i], run[j]);
        if (route && routeSane(route, piece)) {
          const mapped = retimeChunk(route, piece);
          emit(first ? mapped : mapped.slice(1));   // 首点与上一段共享，避免重复
          segOK++;
        } else {
          if (route) segWild++;
          emit(first ? piece.slice(0, -1) : piece.slice(0, -1));   // 保留原样（端点归下一段）
          segKeep++;
        }
        first = false;
        i = j;
      }
      emit([run[run.length - 1]]);   // 段尾点
    };
    for (const day of days) {
      const path = day.path || [];
      if (path.length < 2) continue;
      if (!path.some((p) => insideBounds(p, bounds))) continue;
      const out = [];
      let i = 0, changed = false;
      while (i < path.length) {
        if (!insideBounds(path[i], bounds)) { out.push(path[i]); i++; continue; }
        let j = i;
        while (j < path.length && insideBounds(path[j], bounds)) j++;
        const run = path.slice(i, j);
        const before = segOK;
        await repairRun(run, (pts) => { out.push(...pts); });
        if (segOK > before) changed = true;
        i = j;
      }
      if (!changed) continue;
      // 安全校验：修复不能把框内轨迹弄没，也不能让全天点数塌掉一半以上
      const inBoxAfter = out.filter((p) => insideBounds(p, bounds)).length;
      const inBoxBefore = path.filter((p) => insideBounds(p, bounds)).length;
      if (inBoxBefore > 0 && inBoxAfter === 0) { skipped++; log(`⚠ ${day.date} 修复后框内轨迹会变空，已放弃这次修改（原数据未动）`); continue; }
      if (out.length < path.length * 0.5) { skipped++; log(`⚠ ${day.date} 修复后点数从 ${path.length} 掉到 ${out.length}，疑似异常，已放弃这次修改（原数据未动）`); continue; }
      const w = await fetch('/api/track/rewrite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: day.date, points: out }),
      }).then((x) => x.json());
      if (w.ok) daysFixed++;
    }
    drawHistoryOnMap(state.origin);
    return { daysFixed, segOK, segKeep, segWild, ptsIn, skipped };
  }

  let pickState = null;   // 框选进行中：{x0,y0,bounds}

  function exitPickMode() {
    document.body.classList.remove('picking');
    if (el.pickBox) { el.pickBox.classList.remove('show'); el.pickBox.style.display = 'none'; }
    if (el.repairBar) el.repairBar.classList.remove('show');
    const p = state.provider;
    if (p && p.map && p.map.setStatus) { try { p.map.setStatus({ dragEnable: true }); } catch (_) {} }
    pickState = null;
  }

  function startAreaRepair() {
    const p = state.provider;
    if (!p || p.name !== 'amap') { log('⚠ 区域修复需要高德模式（在线）——演练模式没有真实路网可吸附。'); return; }
    if (el.maskStats) el.maskStats.classList.remove('show');
    document.body.classList.add('picking');
    log('🩹 请在地图上拖拽框选要修复的区域（框内轨迹会被重新吸附到道路上）');
    try { p.map.setStatus({ dragEnable: false }); } catch (_) {}
    pickState = { x0: 0, y0: 0, bounds: null };
  }

  function bindAreaRepairUi() {
    if (!el.btnRepairArea) return;
    el.btnRepairArea.addEventListener('click', startAreaRepair);
    if (el.btnRepairUndo) {
      el.btnRepairUndo.addEventListener('click', async () => {
        el.btnRepairUndo.disabled = true;
        try {
          const r = await fetch('/api/track/range?from=0000-01-01&to=' + today()).then((x) => x.json());
          const days = (r && r.days) || [];
          let undone = 0;
          for (const day of days) {
            const w = await fetch('/api/track/restore-backup', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date: day.date }),
            }).then((x) => x.json());
            if (w && w.ok) undone++;
          }
          if (undone) { log(`↩ 已撤销 ${undone} 天的区域修复，恢复成修复前的轨迹`); drawHistoryOnMap(state.origin); }
          else log('没有可撤销的修复记录（只有修复过的当天才有备份）');
        } catch (e) { log('撤销失败：' + (e && e.message ? e.message : e)); }
        finally { el.btnRepairUndo.disabled = false; }
      });
    }
    if (el.btnRepairCancel) el.btnRepairCancel.addEventListener('click', () => { exitPickMode(); log('已取消区域修复'); });
    if (el.btnRepairGo) {
      el.btnRepairGo.addEventListener('click', async () => {
        const b = pickState && pickState.bounds;
        if (!b) return;
        el.btnRepairGo.disabled = true;
        const old = el.btnRepairGo.textContent;
        el.btnRepairGo.textContent = '修复中…';
        try {
          const r = await repairArea(b);
          log(`🩹 区域修复完成：${r.ptsIn} 个点在框内，重规划 ${r.segOK} 段；${r.segKeep} 段保留原样`
            + (r.segWild ? `（其中 ${r.segWild} 段规划结果绕远、已按原样保留）` : '')
            + (r.skipped ? `；${r.skipped} 天因安全校验放弃修改` : '')
            + `，涉及 ${r.daysFixed} 天；统计口径不变。`);
          if (r.daysFixed) log('↩ 修复不满意可以点「↩ 撤销修复」还原成修复前的轨迹。');
          if (!r.segOK) log('⚠ 框内没有可修复的轨迹段（可能是单点或规划全部失败）。');
        } catch (e) {
          log('区域修复失败：' + (e && e.message ? e.message : e));
        } finally {
          el.btnRepairGo.disabled = false;
          el.btnRepairGo.textContent = old;
          exitPickMode();
        }
      });
    }
    // 地图上拖拽框选
    const box = el.pickBox;
    const toGeo = (x, y) => {
      const p = state.provider;
      try {
        const px = window.AMap && window.AMap.Pixel ? new window.AMap.Pixel(x, y) : { x, y };
        const g = p.map.containerToLngLat(px);
        return { lat: Number(g.lat != null ? g.lat : g.getLat()), lng: Number(g.lng != null ? g.lng : g.getLng()) };
      } catch (_) { return null; }
    };
    const onDown = (ev) => {
      if (!pickState) return;
      const r = el.map.getBoundingClientRect();
      pickState.x0 = ev.clientX - r.left;
      pickState.y0 = ev.clientY - r.top;
      pickState.dragging = true;
      if (box) {
        box.style.left = ev.clientX + 'px';
        box.style.top = ev.clientY + 'px';
        box.style.width = '0px';
        box.style.height = '0px';
        box.style.display = 'block';
        box.classList.add('show');
      }
      ev.preventDefault();
    };
    const onMove = (ev) => {
      if (!pickState || !pickState.dragging) return;
      const r = el.map.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (box) {
        box.style.left = Math.min(ev.clientX, r.left + pickState.x0) + 'px';
        box.style.top = Math.min(ev.clientY, r.top + pickState.y0) + 'px';
        box.style.width = Math.abs(x - pickState.x0) + 'px';
        box.style.height = Math.abs(y - pickState.y0) + 'px';
      }
    };
    const onUp = async (ev) => {
      if (!pickState || !pickState.dragging) return;
      pickState.dragging = false;
      const r = el.map.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (Math.abs(x - pickState.x0) < 20 || Math.abs(y - pickState.y0) < 20) {
        log('框选区域太小，请拖拽出一个明显的矩形区域');
        exitPickMode();
        return;
      }
      const g1 = toGeo(pickState.x0, pickState.y0);
      const g2 = toGeo(x, y);
      if (!g1 || !g2) { log('无法解析框选区域坐标，请重试'); exitPickMode(); return; }
      pickState.bounds = {
        minLat: Math.min(g1.lat, g2.lat), maxLat: Math.max(g1.lat, g2.lat),
        minLng: Math.min(g1.lng, g2.lng), maxLng: Math.max(g1.lng, g2.lng),
      };
      if (el.btnRepairGo) el.btnRepairGo.disabled = true;
      if (el.repairInfo) el.repairInfo.textContent = '正在统计框内轨迹…';
      if (el.repairBar) el.repairBar.classList.add('show');
      let info = { pts: 0, runs: 0, dayN: 0 };
      try { info = countInBounds(await loadAllDays(), pickState.bounds); } catch (_) {}
      if (el.repairInfo) el.repairInfo.textContent = info.pts
        ? `框内 ${info.pts} 个轨迹点 · ${info.runs} 段 · 涉及 ${info.dayN} 天`
        : '框内没有轨迹点，请重新框选';
      if (el.btnRepairGo) el.btnRepairGo.disabled = !info.pts;
      const p = state.provider;
      try { p.map.setStatus({ dragEnable: true }); } catch (_) {}
      document.body.classList.remove('picking');
    };
    el.map.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** 地图镜头跟踪开关：拖动地图自动解除；🎯 按钮恢复跟踪 */
  // ---------- 地点收集册：路过正式场所自动收录 ----------
  const POI_CATS = [
    ['图书馆', /图书馆/],
    ['博物馆', /博物馆|科技馆|美术馆|展览馆|纪念馆|文化馆/],
    ['医院', /医疗保健|医院|卫生服务中心/],
    ['大学', /高等院校|大学|学院/],
    ['中学', /中学/],
    ['小学', /小学/],
    ['政府机关', /政府机关|人民政府|政府部门/],
    ['车站', /火车站|地铁站|长途汽车站/],
    ['体育场馆', /体育场|体育馆|运动场馆/],
    ['地标景点', /风景名胜|公园|广场|文物|标志性建筑/],
  ];
  const CAT_ICONS = { '医院': '🏥', '中学': '🏫', '小学': '🏫', '大学': '🎓', '图书馆': '📚', '博物馆': '🏛️', '政府机关': '🏢', '车站': '🚉', '体育场馆': '🏟️', '地标景点': '🏞️' };

  function poiCat(type) {
    const t = String(type || '');
    for (const [cat, re] of POI_CATS) if (re.test(t)) return cat;
    return '';
  }

  /**
   * 规整地点名/过滤（收集册口径）：
   * - 车站：只留站名 —— 截到最后一个「站」字，去掉出口/检票口/售票窗等；「X地铁站」归一为「X站」
   * - 体育场馆：只留真场馆（体育场/游泳/球场等，只看主名），滤掉健身房/瑜伽/电竞等商业设施
   * 返回规整后的名字，不该收录的返回 ''
   */
  function normalizePlace(name, cat) {
    let n = String(name || '').trim();
    if (!n) return '';
    if (cat === '车站') {
      n = n.replace(/[(（]地铁站[)）)]$/, '地铁站');   // 五山(地铁站) → 五山地铁站
      const i = n.lastIndexOf('站');
      if (i < 0) return '';
      n = n.slice(0, i + 1);                          // 广州东站公安制证窗11 → 广州东站
      if (/地铁站$/.test(n)) {                         // 广州东站地铁站 → 广州东站；龙口西地铁站 保持
        const before = n.slice(0, -3);
        n = before.endsWith('站') ? before : n;
      }
      n = n.replace(/站站$/, '站');                    // 兜底：广州东站站 → 广州东站
      return n.slice(0, 60);
    }
    if (cat === '体育场馆') {
      const core = n.replace(/[(（][^)）]*[)）]$/, '');   // 主名（去掉括号后缀，防止地址里带「体育」误命中）
      // 真场馆白名单：体育中心/体育场/体育馆/游泳/球场类
      if (!/(体育|运动场|游泳|泳馆|球场|足球|篮球|网球|羽毛球|乒乓|田径|滑冰|溜冰|武术)/.test(core)) return '';
      // 商业设施黑名单兜底
      if (/健身|瑜伽|普拉提|搏击|格斗|泰拳|柔术|射击|高尔夫|电竞|网咖|轮滑|蹦床|密室|桌游|拼豆|陶艺|DIY|会馆|体育会|剧本杀|公馆/.test(n)) return '';
      return n.slice(0, 60);
    }
    return n.slice(0, 60);
  }

  /** 从高德逆地理返回的 POI 里挑出正式场所，并按名称去重；road 为采集时所在路名（可选） */
  function pickFormalPois(pois, pos, road) {
    const out = [];
    const seen = new Set();
    const r = String(road || '').trim().slice(0, 30);
    for (const poi of (pois || [])) {
      const rawName = String(poi.name || '').trim();
      const cat = poiCat(poi.type);
      const name = normalizePlace(rawName, cat);
      if (!name || !cat || seen.has(name)) continue;
      seen.add(name);
      const loc = poi.location || {};
      let lat = Number(loc.lat != null ? loc.lat : (loc.getLat ? loc.getLat() : pos.lat));
      let lng = Number(loc.lng != null ? loc.lng : (loc.getLng ? loc.getLng() : pos.lng));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) { lat = pos.lat; lng = pos.lng; }
      const item = { name: name.slice(0, 60), cat, lat, lng, t: Date.now() };
      if (r) item.road = r;
      out.push(item);
    }
    return out;
  }

  /** 采集一次：以当前位置搜路两侧 100 米内的正式场所，归到当前所在路名下 */
  async function collectPlacesNow(force) {
    if (!state.started || !state.provider || state.provider.name !== 'amap') return;
    const pos = (state.engine && state.engine.pos) || null;
    if (!pos || !Number.isFinite(pos.lat)) return;
    if (!force && state.lastCollectPos) {
      const moved = haversineKm(state.lastCollectPos, pos) * 1000;
      if (moved < 100) return;   // 没走出 100 米就不重复采（换路时会 force 采一次）
    }
    const now = Date.now();
    if (force && state.lastCollectAt && now - state.lastCollectAt < 3000) return;   // 换路连续触发时限流
    state.lastCollectAt = now;
    state.lastCollectPos = { lat: pos.lat, lng: pos.lng };
    const road = (state.engine && state.engine.road) || '';   // 采集时所在路名
    try {
      const pois = await state.provider.nearbyPlaces(pos);
      const list = pickFormalPois(pois, pos, road);
      if (!list.length) return;
      const w = await postJson('/api/places/add', { date: today(), places: list }, 8000);
      if (w && w.added) {
        log(`📔 收集到 ${w.added} 个正式地点` + (road ? `（${road}）` : '') + `：` + list.slice(0, 3).map((p) => (CAT_ICONS[p.cat] || '📍') + p.name).join('、') + (list.length > 3 ? ' 等' : ''));
        albumCache = null;
        refreshAlbumIfOpen();   // 收集册正开着就实时刷新
      }
    } catch (_) { /* 采集失败不影响行走 */ }
  }

  /** 收集册开着时原地刷新内容（保留滚动位置） */
  let albumRefreshBusy = false;
  async function refreshAlbumIfOpen() {
    if (albumRefreshBusy) return;
    if (!el.maskAlbum || !el.maskAlbum.classList.contains('show')) return;
    albumRefreshBusy = true;
    const keep = el.albumBody ? el.albumBody.scrollTop : 0;
    try { await openAlbum(); } catch (_) { /* noop */ } finally {
      if (el.albumBody) el.albumBody.scrollTop = keep;
      albumRefreshBusy = false;
    }
  }

  function startPlaceCollector() {
    stopPlaceCollector();
    state.poiTimer = setInterval(() => collectPlacesNow(false), 20000);   // 每 20 秒采一次
    state.lastRoad = '';
    setTimeout(() => collectPlacesNow(true), 8000);                        // 出发后 8 秒先采一次
  }

  function stopPlaceCollector() {
    if (state.poiTimer) { clearInterval(state.poiTimer); state.poiTimer = null; }
    state.lastCollectPos = null;
    state.lastRoad = '';
  }

  // ---------- 地点收集册浮层 ----------
  let albumCache = null;
  function albumCatIcon(cat) { return CAT_ICONS[cat] || '📍'; }

  async function openAlbum() {
    if (el.maskAlbum) el.maskAlbum.classList.add('show');
    if (el.albumSummary) el.albumSummary.textContent = '加载中…';
    if (el.albumBody) el.albumBody.innerHTML = '<div class="hint">加载中…</div>';
    try {
      // 同时取「已收集地点」与「有轨迹的日期」：没有收录记录的日子也要列出来（可点 ↺ 重溯补采）
      const [sum, tr] = await Promise.all([
        fetchJson('/api/places/summary?from=0000-01-01&to=' + today(), 8000).catch(() => null),
        fetchJson('/api/track/range?from=0000-01-01&to=' + today(), 8000).catch(() => null),
      ]);
      const placeDays = ((sum && sum.list) || []).slice();
      const trackDates = ((tr && tr.days) || []).map((d) => d.date).filter((d, i, a) => a.indexOf(d) === i);
      // 有收录、但轨迹里没有的那天也要能回顾（比如手动添加过地点）
      for (const pd of placeDays) if (!trackDates.includes(pd.date) && pd.places && pd.places.length) trackDates.push(pd.date);
      // 每天的轨迹点数（顺带显示，方便判断这天走了多少）
      const trackInfo = {};
      for (const d of (tr && tr.days) || []) trackInfo[d.date] = Number(d.count) || 0;
      const merged = trackDates.slice().sort((a, b) => (a < b ? 1 : -1)).map((date) => ({
        date,
        places: ((placeDays.find((x) => x.date === date) || {}).places || []).slice(),
      }));
      albumCache = { list: merged, trackInfo };
      // 默认选中今天（今天没数据就选最近一天）
      if (!merged.some((d) => d.date === state.albumDate)) {
        state.albumDate = (merged.find((d) => d.date === today()) || merged[0] || {}).date || '';
      }
      fillAlbumDates(merged);
      setAlbumRange(state.albumRange);   // 内部会调 renderAlbum（并按需显示日期选择器）
    } catch (e) {
      if (el.albumSummary) el.albumSummary.textContent = '加载失败：' + (e && e.message ? e.message : e);
    }
  }

  /** 填充「按天回顾」的日期下拉（新日期在前），并显示当前选中项 */
  function fillAlbumDates(list) {
    if (!el.albumDate) return;
    const days = (list || (albumCache && albumCache.list) || []);
    const cur = days.some((d) => d.date === state.albumDate) ? state.albumDate : (days[0] && days[0].date) || '';
    state.albumDate = cur;
    el.albumDate.innerHTML = days.map((d) => {
      const n = (d.places || []).length;
      const mark = n ? `（${n} 个）` : '（无记录）';
      return `<option value="${d.date}"${d.date === cur ? ' selected' : ''}>📅 ${d.date}${mark}</option>`;
    }).join('') || '<option value="">（还没有任何数据）</option>';
    if (el.albumDate.value !== cur) el.albumDate.value = cur;
  }

  /** 翻到上/下一天（按日期列表顺序，新日期在前） */
  function stepAlbumDate(delta) {
    const days = (albumCache && albumCache.list) || [];
    if (!days.length) return;
    const i = days.findIndex((d) => d.date === state.albumDate);
    const next = days[Math.max(0, Math.min(days.length - 1, (i < 0 ? 0 : i) + delta))];
    if (!next) return;
    state.albumDate = next.date;
    fillAlbumDates(days);
    renderAlbum();
  }

  /** 切换「全部 / 按天回顾」 */
  function setAlbumRange(range) {
    state.albumRange = (range === 'day') ? 'day' : 'all';
    if (el.albumTabs) {
      for (const b of el.albumTabs.querySelectorAll('.ach-tab')) {
        b.classList.toggle('on', b.dataset.range === state.albumRange);
      }
    }
    if (el.albumNav) el.albumNav.style.display = (state.albumRange === 'day') ? 'flex' : 'none';
    if (state.albumRange === 'day') fillAlbumDates();
    renderAlbum();
  }

  function renderAlbum() {
    const days = (albumCache && albumCache.list) || [];
    const shown = (state.albumRange === 'day') ? days.filter((d) => d.date === state.albumDate) : days;
    let total = 0;
    const byCat = {};
    let roads = 0;
    for (const d of shown) {
      const set = new Set();
      for (const p of d.places) { total++; byCat[p.cat] = (byCat[p.cat] || 0) + 1; if (p.road) set.add(p.road); }
      roads += set.size;
    }
    const catTxt = Object.entries(byCat).map(([k, v]) => `${albumCatIcon(k)}${k} ${v}`).join(' · ');
    if (el.albumSummary) {
      if (total) {
        el.albumSummary.textContent = (state.albumRange === 'day')
          ? `📅 ${state.albumDate} · ${total} 个地点 · ${roads} 条路` + (catTxt ? ' · ' + catTxt : '')
          : `共 ${total} 个地点 · ${shown.length} 天` + (catTxt ? ' · ' + catTxt : '');
      } else if (state.albumRange === 'day') {
        el.albumSummary.textContent = `📅 ${state.albumDate} 还没有收录地点 —— 点下面的「↺ 重溯补采」按这天的轨迹补录。`;
      } else {
        el.albumSummary.textContent = '还没有收集到正式地点（高德模式下行走时自动收集；老数据可用「↺ 重溯补采」补录）';
      }
    }
    if (el.albumBody) {
      el.albumBody.innerHTML = shown.map((d) => {
        // 按路名分组：路名做小标题，该路上收集到的地点列在下面；没记路名的归到末尾
        const groups = new Map();
        for (const p of d.places) {
          const r = String(p.road || '').trim() || '未记录路名';
          if (!groups.has(r)) groups.set(r, []);
          groups.get(r).push(p);
        }
        const entries = [...groups.entries()].sort((a, b) => {
          if (a[0] === '未记录路名') return 1;
          if (b[0] === '未记录路名') return -1;
          return b[1].length - a[1].length;
        });
        const groupHtml = entries.map(([road, places]) => [
          `<div style="margin:8px 0 2px;padding:3px 8px;background:var(--bg-dim,rgba(127,127,127,.12));border-left:3px solid var(--accent,#7c6cf0);border-radius:4px;font-weight:700;display:flex;justify-content:space-between;align-items:center"><span>🛣️ ${road}</span><span style="opacity:.6;font-weight:400">${places.length} 个</span></div>`,
          places.map((p) => `<div style="padding:2px 0 2px 18px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="color:var(--txt-dim)">${albumCatIcon(p.cat)} <b style="color:var(--txt)">${p.name}</b> <span style="opacity:.7">· ${p.cat}</span></span><span class="album-del" data-date="${d.date}" data-name="${p.name}" title="从收集册删除" style="cursor:pointer;opacity:.45;font-weight:700">✕</span></div>`).join(''),
        ].join('')).join('');
        const tPts = ((albumCache && albumCache.trackInfo) || {})[d.date] || 0;
        return `<div style="margin:10px 0 4px;font-weight:700;display:flex;justify-content:space-between;align-items:center"><span>📅 ${d.date} · ${d.places.length} 个 · ${entries.length} 条路${tPts ? ' · 轨迹 ' + tPts + ' 点' : ''}</span><button class="btn sm" data-backfill="${d.date}" title="沿这天的实际轨迹按类别搜索，补录漏掉的正式地点" style="padding:2px 8px">↺ 重溯补采</button></div>` + groupHtml;
      }).join('') || '<div class="hint">暂无记录</div>';
    }
  }

  function setMapFollowing(on) {
    state.following = Boolean(on);
    if (state.provider && state.provider.setFollow) state.provider.setFollow(state.following);
    if (el.btnFollow) el.btnFollow.classList.toggle('on', state.following);
  }

  function onEngineUpdate(s) {


    const modes = window.NetWalkSpeed.MODES;
    const m = modes[s.mode] || modes.walk;
    el.speed.innerHTML = `${s.speedKmh.toFixed(1)}<small>km/h</small>`;    el.mode.textContent = `${m.icon} ${m.label}`;
    el.mode.style.color = m.color;
    const pct = Math.round(Math.min(100, (s.speedKmh / (state.cfg.speed.runMax * 1.35)) * 100));
    el.bar.style.width = `${pct}%`;
    el.intensity.textContent = `${pct}%`;
    el.road.textContent = s.road || '—';
    el.seg.textContent = s.road
      ? `在 ${s.road} 已走 ${Math.round(s.roadDone || 0)} m（剩 ${Math.round(s.roadRemain || 0)} m，全程 ${Math.round(s.roadLen || 0)} m）`
      : '—';
    el.dist.textContent = `${(s.distance / 1000).toFixed(2)} km`;
    el.dur.textContent = fmtDur(s.durationMs);
    el.rolls.textContent = `${s.rolls} 次`;
    el.avg.textContent = `${s.avgSpeed.toFixed(1)} km/h`;
    el.mVisited.textContent = `${s.visited || 0} 条路`;
    el.mLit.textContent = `${s.litCells || 0} 块`;
    updateAmapCalls();

    // 走到新的一条路 → 立刻按这条路采一次地点（收集册实时跟着走的路更新）
    if (state.started && s.road && s.road !== state.lastRoad) {
      state.lastRoad = s.road;
      collectPlacesNow(true);
    }

    const t = s.totals || { rx: 0, tx: 0, keys: 0 };
    el.rxTot.textContent = fmtBpsFull(t.rx);
    el.txTot.textContent = fmtBpsFull(t.tx);
    el.keysTot.textContent = `${(t.keys || 0).toLocaleString()} 键`;

    if (state.channel) {
      state.channel.postMessage({
        type: 'state',
        speedKmh: s.speedKmh, mode: s.mode, road: s.road,
        roadPct: s.roadPct || 0,
        distance: s.distance, durationMs: s.durationMs, rolls: s.rolls,
        totals: t,
      });
    }
  }

  function onEngineRoll(r) {
    el.rollTxt.textContent = `ROLL ${r.roll} → ${r.choice}`;
  }

  async function endWalk() {
    if (!state.engine) return;
    const stats = state.engine.finalStats();
    state.engine.stop();
    state.started = false;
    el.btnStart.disabled = false;
    el.btnPause.disabled = true;
    el.btnEnd.disabled = true;
    stopPlaceCollector();

    try {
      const endRes = await fetch('/api/session/end', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today(), stats, city: state.cfg.city, scope: state.cfg.scope }),
      }).then((r) => r.json());
      if (endRes && endRes.achievements) {
        state.ach = endRes.achievements;
        if (endRes.achievements.got) setAchDot(endRes.achievements.got > achSeenCount());
        if (endRes.achievements.newly && endRes.achievements.newly.length) {
          announceAchievements(endRes.achievements.newly);
        }
      }
      state.lastMail = (endRes && endRes.mail) || null;
      if (state.lastMail) {
        if (state.lastMail.ok) log(`📬 结束漫游：存档码已自动发送到 ${state.lastMail.to}（含本机配置）`);
        else log(`⚠ 结束漫游：存档邮件未自动发出 —— ${state.lastMail.error || '未知原因'}`);
      }
    } catch (err) {
      log('结束上报失败：' + (err && err.message ? err.message : err));
    }
    showDone(stats);
    ensureReport(today());   // 面板先弹出来，日报在后台生成 —— 不阻塞「打开今日日报」按钮
  }

  /**
   * 生成（或复用）某天的日报，返回可打开的 URL；失败返回 null 并把原因写进 state.reportError
   * 注意：调用方要负责给用户可见反馈，别让按钮"点了没反应"。
   */
  async function ensureReport(date) {
    state.reportDate = date;
    state.reportUrl = '';
    state.reportError = '';
    try {
      const r = await fetch('/api/report/' + date, { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (j && j.ok && j.url) { state.reportUrl = j.url; return j.url; }
      state.reportError = (j && j.error) || '服务器没有生成日报';
      return null;
    } catch (e) {
      state.reportError = (e && e.message) ? e.message : String(e);
      return null;
    }
  }

  /** 重溯补采：按当天走过的每条路搜索，只收「路两侧 100 米内」的正式场所（对齐周边设施口径，拒绝包围盒式的宽泛统计） */
  async function backfillDay(date) {
    if (!state.provider || state.provider.name !== 'amap') { log('⚠ 补采需要高德模式（在线）'); return; }
    const day = (await loadAllDays()).find((d) => d.date === date);
    const path = (day && day.path) || [];
    if (path.length < 2) { log(`${date} 没有轨迹可补采`); return; }

    // ① 按路名分组轨迹点（每条路一个点集）
    const roadPts = new Map();
    for (const q of path) {
      const r = String(q.road || '').trim();
      if (!r) continue;
      if (!roadPts.has(r)) roadPts.set(r, []);
      roadPts.get(r).push(q);
    }
    const roads = [...roadPts.keys()].sort((a, b) => roadPts.get(b).length - roadPts.get(a).length);
    if (!roads.length) { log(`${date} 轨迹没有路名信息，无法按路补采`); return; }

    // ② 每条路搜一次（合并全部正式类别，避免逐类×逐路爆调用量），结果只留 100 米内的
    const ALL_TYPES = '医疗保健服务|中学|小学|高等院校|图书馆|博物馆|展览馆|纪念馆|政府机关及社会团体|火车站|地铁站|体育休闲服务|风景名胜|标志性建筑';
    const NEAR_M = 100;
    const CALL_CAP = 45;
    const found = new Map();
    let calls = 0;
    log(`↺ ${date} 按路补采：${roads.length} 条路 · 只收路两侧 ${NEAR_M} 米内的正式场所`);
    for (const road of roads) {
      if (calls >= CALL_CAP) { log(`  （已达 ${CALL_CAP} 次搜索上限，剩余 ${roads.length - roads.indexOf(road)} 条路未搜，可再点一次补采）`); break; }
      const pts = roadPts.get(road);
      const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
      const pad = 0.0005;
      const bounds = new window.AMap.Bounds(
        [Math.min(...lngs) - pad, Math.min(...lats) - pad],
        [Math.max(...lngs) + pad, Math.max(...lats) + pad]
      );
      calls++;
      let pois = [];
      try {
        const result = await Promise.race([
          state.provider.searchFormalInBounds(bounds, ALL_TYPES),
          new Promise((r2) => setTimeout(() => r2([]), 10000)),
        ]);
        pois = (result && result.poiList && result.poiList.pois) || (Array.isArray(result) ? result : []);
      } catch (_) { pois = []; }
      let kept = 0;
      for (const poi of pois) {
        const rawName = String(poi.name || '').trim();
        const cat = poiCat(poi.type);
        const name = normalizePlace(rawName, cat);   // 车站去出口、体育场馆滤商业设施
        if (!name || !cat) continue;
        const loc = poi.location || {};
        const lat = Number(loc.lat), lng = Number(loc.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        // 到这条路轨迹点的最近距离（米）；超过 100 米的不要 —— 这就是「100 米口径」
        let bestM = Infinity;
        for (const q of pts) {
          const d = haversineKm(q, { lat, lng }) * 1000;
          if (d < bestM) bestM = d;
        }
        if (bestM > NEAR_M) continue;
        if (found.has(name)) { found.get(name).dist = Math.min(found.get(name).dist, Math.round(bestM)); continue; }
        found.set(name, { name: name.slice(0, 60), cat, lat, lng, road, dist: Math.round(bestM), t: Date.now() });
        kept++;
      }
      if (kept) log(`  🛣️ ${road}: ${kept} 个（100 米内）`);
    }
    const list = [...found.values()].map((p) => ({ ...p, t: Date.now() }));
    if (!list.length) { log(`↺ ${date} 沿途没有发现正式场所`); return; }
    try {
      const w = await postJson('/api/places/add', { date, places: list }, 10000);
      if (w && w.ok) {
        log(`↺ ${date} 补采完成：搜索到 ${list.length} 个正式场所，新增 ${w.added} 个`);
        albumCache = null;
        if (el.maskAlbum && el.maskAlbum.classList.contains('show')) openAlbum();
      } else log('补采写入失败：' + ((w && w.error) || '未知'));
    } catch (e) { log('补采写入失败：' + (e && e.message ? e.message : e)); }
  }

  function showDone(stats) {
    const km = (stats.distance / 1000).toFixed(2);
    const items = [
      { k: '总里程', v: km, u: 'km' },
      { k: '时长', v: fmtDur(stats.duration), u: '' },
      { k: '峰值', v: stats.maxSpeed.toFixed(1), u: 'km/h' },
      { k: '击键', v: stats.totalKeys.toLocaleString(), u: '键' },
      { k: '路口', v: String(stats.rolls), u: '次' },
      { k: '均速', v: stats.avgSpeed.toFixed(1), u: 'km/h' },
    ];
    el.doneStats.innerHTML = items.map((i) =>
      `<div class="done-stat"><div class="k">${i.k}</div><div class="v">${i.v}<small>${i.u}</small></div></div>`).join('');
    el.maskDone.classList.add('show');
    // 结束漫游是自动发存档邮件的（无需再点按钮）——把真实结果直接说清楚
    const mailInfo = state.lastMail;
    if (el.doneDesc) {
      el.doneDesc.textContent = (mailInfo && mailInfo.ok)
        ? `数据已保存到本机，日报已生成；存档码已自动发送到 ${maskMail(mailInfo.to)}。`
        : '数据已保存到本机，日报已生成。';
    }
    if (el.doneHint) {
      if (mailInfo && mailInfo.ok) el.doneHint.textContent = `📬 已自动发送到 ${maskMail(mailInfo.to)}（含存档码与本机配置，换设备登录该邮箱即可续档）`;
      else if (mailInfo && mailInfo.error) el.doneHint.textContent = `⚠ 存档邮件没有自动发出：${mailInfo.error} —— 可点下方「重新发送到邮箱」重试`;
      else el.doneHint.textContent = '';
    }

    // 存档码：结束后直接给出，方便复制到其他设备继承数据
    state.lastArchiveCode = '';
    el.doneArc.value = '';
    el.doneArc.placeholder = '生成中…';
    fetch('/api/archive/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((r) => r.json())
      .then((j) => {
        state.lastArchiveCode = (j && j.code) || '';
        el.doneArc.value = state.lastArchiveCode;
        el.doneArc.placeholder = '';
        if (state.lastArchiveCode) log(`存档码已生成（${j.days || '?'} 天数据），可复制到其他设备导入`);
      })
      .catch(() => {
        el.doneArc.placeholder = '生成失败，可到「存档」弹窗里重新生成';
      });
  }

  // ---------- 成就 ----------
  /** 成就红点：只在"有没看过的成就"时亮；打开成就墙后熄灭并记住已看数量 */
  function achSeenCount() {
    try { const v = parseInt(localStorage.getItem('netwalkAchSeen') || '0', 10); return Number.isFinite(v) ? v : 0; }
    catch (_) { return 0; }
  }
  function setAchDot(on) { if (el.achDot) el.achDot.classList.toggle('on', Boolean(on)); }
  function markAchSeen(count) {
    try { localStorage.setItem('netwalkAchSeen', String(count || 0)); } catch (_) { /* noop */ }
    setAchDot(false);
  }

  async function refreshAchievements({ silent = true } = {}) {
    try {
      const r = await fetch('/api/achievements').then((x) => x.json());
      state.ach = r;
      setAchDot((r.got || 0) > achSeenCount());   // 有新成就才亮，而不是"有成就就一直亮"
      if (!silent && r.newly && r.newly.length) announceAchievements(r.newly);
      return r;
    } catch (_) { return null; }
  }

  function announceAchievements(ids) {
    const names = ids.map((id) => {
      const a = window.NetWalkAch.byId(id);
      return a ? `${a.icon} ${a.name}` : id;
    });
    log(`🏆 解锁成就：${names.join('、')}`);
  }

  async function openAch() {
    if (!state.ach) await refreshAchievements();
    markAchSeen((state.ach && state.ach.got) || 0);   // 看过就熄灭红点
    state.achFilter = state.achFilter || 'all';
    el.achBody.innerHTML = window.NetWalkAch.wallHtml(
      (state.ach && state.ach.unlocked) || {},
      state.achFilter,
    );
    el.maskAch.classList.add('show');
  }

  function rerenderAch(group) {
    state.achFilter = group;
    el.achBody.innerHTML = window.NetWalkAch.wallHtml(
      (state.ach && state.ach.unlocked) || {},
      group,
    );
  }

  // ---------- 数据（日/月/年） ----------
  async function renderStats(range) {
    state.statsRange = range;
    el.statsGrid.innerHTML = '<div class="stat-cell" style="grid-column:1/-1"><div class="k">加载中</div></div>';
    let r;
    try {
      r = await fetch(`/api/stats?range=${encodeURIComponent(range)}`).then((x) => x.json());
    } catch (_) {
      el.statsGrid.innerHTML = '<div class="stat-cell" style="grid-column:1/-1"><div class="k">加载失败</div></div>';
      return;
    }
    const a = r.agg || {};
    const cells = [
      { k: '里程', v: ((a.totalDistance || 0) / 1000).toFixed(2), u: 'km' },
      { k: '时长', v: fmtDur(a.totalDuration || 0), u: '' },
      { k: '活跃天数', v: String(a.activeDays || 0), u: '天' },
      { k: '连续', v: String(a.streakDays || 0), u: '天' },
      { k: '峰值速度', v: (a.maxSpeed || 0).toFixed(1), u: 'km/h' },
      { k: '走过道路', v: String(a.uniqueRoads || 0), u: '条' },
      { k: '点亮街区', v: String(a.litCells || 0), u: '块' },
      { k: '路口决策', v: String(a.totalRolls || 0), u: '次' },
      { k: '下载总量', v: fmtBpsFull(a.totalRx || 0), u: '' },
      { k: '上传总量', v: fmtBpsFull(a.totalTx || 0), u: '' },
      { k: '击键总数', v: (a.totalKeys || 0).toLocaleString(), u: '键' },
      { k: '轨迹点', v: (a.totalPoints || 0).toLocaleString(), u: '个' },
    ];
    el.statsGrid.innerHTML = cells.map((c) =>
      `<div class="stat-cell"><div class="k">${c.k}</div><div class="v">${c.v}${c.u ? `<small>${c.u}</small>` : ''}</div></div>`).join('');

    const perDay = (a.perDay || []).slice().reverse();
    if (perDay.length) {
      el.statsDaily.innerHTML = `
        <div class="daily-wrap"><table class="daily-table">
          <thead><tr><th>日期</th><th>里程</th><th>时长</th><th>路口</th><th>击键</th></tr></thead>
          <tbody>${perDay.map((p) => `<tr>
            <td>${p.date}${p.city ? ` · ${p.city}` : ''}</td>
            <td>${(p.distance / 1000).toFixed(2)} km</td>
            <td>${fmtDur(p.duration)}</td>
            <td>${p.rolls}</td>
            <td>${(p.keys || 0).toLocaleString()}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } else {
      el.statsDaily.innerHTML = '<div style="color:var(--dim);font-size:13px">该区间还没有数据</div>';
    }
  }

  function openStats() {
    el.maskStats.classList.add('show');
    renderStats(state.statsRange || 'day');
  }

  // ---------- 存档码 ----------
  async function genArchive() {
    el.btnArGen.disabled = true;
    el.btnArGen.textContent = '生成中…';
    try {
      const r = await fetch('/api/archive/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '导出失败');
      el.arCode.value = r.code;
      el.arHint.textContent = `已生成 · 包含 ${r.days} 天数据 · 压缩后 ${(r.bytes / 1024).toFixed(1)} KB（原始 ${(r.rawBytes / 1024).toFixed(1)} KB）`;
      log(`存档码已生成（${r.days} 天数据）`);
    } catch (err) {
      el.arHint.textContent = '导出失败：' + err.message;
    } finally {
      el.btnArGen.disabled = false;
      el.btnArGen.textContent = '生成存档码';
    }
  }

  async function copyArchive() {
    const code = el.arCode.value.trim();
    if (!code) { el.arHint.textContent = '还没有存档码，先点「生成存档码」'; return; }
    try {
      await navigator.clipboard.writeText(code);
      el.arHint.textContent = '已复制到剪贴板，粘到另一台电脑的 NetWalk 里导入即可';
    } catch (_) {
      el.arCode.select();
      document.execCommand && document.execCommand('copy');
      el.arHint.textContent = '已选中，按 Ctrl+C 复制';
    }
  }

  async function doImport() {
    const code = el.arInput.value.trim();
    if (!code) { el.arHint.textContent = '请先粘贴存档码'; return; }
    el.btnArImport.disabled = true;
    el.btnArImport.textContent = '导入中…';
    try {
      const r = await fetch('/api/archive/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '导入失败');
      const pm = r.places;
      const pTxt = (pm && (pm.added || pm.merged)) ? `，收集册 +${pm.added} 个地点` : '';
      el.arHint.textContent = `导入成功：新增 ${r.added} 天，合并 ${r.merged} 天，当前共 ${r.days} 天${pTxt}`;
      log(`存档导入完成（新增 ${r.added} 天 / 合并 ${r.merged} 天${pTxt}）`);
      // 手动导入 = 明确要恢复这份数据，解除"重置后暂停自动同步"
      try { localStorage.removeItem('netwalkNoAutoSync'); } catch (_) { /* noop */ }
      // 存档码里带了本机配置（高德 Key / 邮箱）→ 提示可一键恢复（换设备免手填）
      state.lastImportedCode = code;
      if (el.btnArApplyCfg) {
        if (r.cfgAvailable) {
          el.btnArApplyCfg.style.display = '';
          el.arHint.textContent += '　这个存档码还带了本机配置（高德 Key / 邮箱），可点「恢复本机配置」一并恢复。';
        } else {
          el.btnArApplyCfg.style.display = 'none';
        }
      }
      await refreshAchievements({ silent: false });
      el.arInput.value = '';
    } catch (err) {
      el.arHint.textContent = '导入失败：' + err.message;
    } finally {
      el.btnArImport.disabled = false;
      el.btnArImport.textContent = '导入并合并';
    }
  }

  // ---------- 分享 ----------
  async function openShare() {
    el.maskShare.classList.add('show');
    await renderShare();
  }

  async function renderShare() {
    const snap = state.engine ? state.engine.snapshot() : null;
    let day = null;
    try { day = await fetch('/api/day/' + today()).then((r) => r.json()); } catch (_) { day = null; }
    const track = (day && day.path) || [];
    const aggAll = (state.ach && state.ach.agg) || {};
    const achIds = state.ach ? Object.keys(state.ach.unlocked || {}) : [];
    const badges = achIds.slice(-6).map((id) => {
      const a = window.NetWalkAch.byId(id);
      return a ? { icon: a.icon, level: a.level, name: a.name } : null;
    }).filter(Boolean);
    const roads = new Set(track.map((p) => p.road).filter(Boolean));

    state.shareData = {
      date: today(),
      city: (state.cfg && state.cfg.city) || '',
      distance: snap ? snap.distance : (day && day.stats ? day.stats.distance : 0),
      duration: snap ? snap.durationMs : (day && day.stats ? day.stats.duration : 0),
      avgSpeed: snap ? snap.avgSpeed : (day && day.stats ? day.stats.avgSpeed : 0),
      maxSpeed: snap ? snap.maxSpeed : 0,
      keys: snap && snap.totals ? snap.totals.keys : 0,
      rolls: snap ? snap.rolls : (day && day.rolls ? day.rolls.length : 0),
      rxTotal: snap && snap.totals ? snap.totals.rx : 0,
      txTotal: snap && snap.totals ? snap.totals.tx : 0,
      litCells: snap ? snap.litCells : 0,
      uniqueRoads: snap ? snap.visited : roads.size,
      track,
      badges,
      badgeTotal: achIds.length,
    };
    if (!state.shareData.distance && aggAll.totalDistance) {
      state.shareData.distance = aggAll.totalDistance;
    }
    window.NetWalkShare.draw(el.shareCanvas, state.shareData);
  }

  function saveShare() {
    try {
      const url = el.shareCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `netwalk-${today()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      log('分享图已保存');
    } catch (err) {
      log('保存失败：' + err.message);
    }
  }

  async function copyShareText() {
    if (!state.shareData) return;
    const txt = window.NetWalkShare.buildText(state.shareData);
    try {
      await navigator.clipboard.writeText(txt);
      log('分享文案已复制');
    } catch (_) {
      log('复制失败，请手动选择文本');
    }
  }

  // ---------- 今日总览 ----------
  function renderOverviewSvg(track, current, starts) {
    const W = 660, H = 360;
    if (!track || track.length < 2) {
      return `<svg viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0a0f1a" rx="12"/><text x="50%" y="50%" text-anchor="middle" fill="#8b98b5" font-size="14">暂无轨迹，先点「出发」开始漫游吧</text>${startsSvg}</svg>`;
    }
    const lats = track.map((p) => p.lat);
    const lngs = track.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1;
    const spanX = Math.max(1e-9, (maxLng - minLng) * cosLat);
    const spanY = Math.max(1e-9, maxLat - minLat);
    const pad = 36;
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    const proj = (p) => [
      offX + (p.lng - minLng) * cosLat * scale,
      H - (offY + (p.lat - minLat) * scale),
    ];
    const segs = [];
    // 按会话/跳变/断档切段后再画 —— 多设备合并的数据里不出现跨设备飞线
    for (const seg of splitTrackSegments(track, starts)) {
      for (let i = 1; i < seg.length; i++) {
        const [x1, y1] = proj(seg[i - 1]);
        const [x2, y2] = proj(seg[i]);
        const spd = seg[i].spd || 0;
        const color = speedGradientColor(spd);
        segs.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.92"/>`);
      }
    }
    let startsSvg = '';
    for (const st of (starts || [])) {
      const [px, py] = proj(st);
      startsSvg += '<g><circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="5" fill="#a06bff" stroke="#fff" stroke-width="1.5"/>'
        + '<text x="' + px.toFixed(1) + '" y="' + (py - 9).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" stroke="rgba(120,70,220,.92)" stroke-width="0.5">' + st.n + '</text></g>';
    }
    const [sx, sy] = proj(track[0]);
    const [ex, ey] = proj(track[track.length - 1]);
    const cp = current || (state.engine && state.engine.pos) || track[track.length - 1];
    const [cx, cy] = proj(cp);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="ovGlow"><stop offset="0%" stop-color="#ff5d5d" stop-opacity="0.55"/><stop offset="100%" stop-color="#ff5d5d" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#0a0f1a" rx="12"/>
      <g stroke="#1c2740" stroke-width="1">
        ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${(H / 7) * (i + 1)}" x2="${W}" y2="${(H / 7) * (i + 1)}"/>`).join('')}
        ${Array.from({ length: 11 }, (_, i) => `<line x1="${(W / 11) * (i + 1)}" y1="0" x2="${(W / 11) * (i + 1)}" y2="${H}"/>`).join('')}
      </g>
      ${segs.join('')}
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="#3ddc97" stroke="#0a0f1a" stroke-width="2"/>
      <text x="${(sx + 10).toFixed(1)}" y="${(sy - 8).toFixed(1)}" fill="#3ddc97" font-size="12">起点</text>
      <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="6" fill="#ff5d5d" stroke="#0a0f1a" stroke-width="2"/>
      <text x="${(ex + 10).toFixed(1)}" y="${(ey - 8).toFixed(1)}" fill="#ff5d5d" font-size="12">终点</text>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="34" fill="url(#ovGlow)"/>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="13" fill="none" stroke="#ff5d5d" stroke-width="2" opacity="0.7">
        <animate attributeName="r" values="11;20;11" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.7;0.15;0.7" dur="2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="#ff5d5d" stroke="#fff" stroke-width="2"/>
      <text x="${(cx + 11).toFixed(1)}" y="${(cy + 4).toFixed(1)}" fill="#ff5d5d" font-size="12" font-weight="700">当前位置</text>
    </svg>`;
  }

  async function openOverview() {
    el.maskOverview.classList.add('show');
    initOvRangeControls();
    await refreshOverview();
    if (state._ovTimer) clearInterval(state._ovTimer);
    state._ovTimer = setInterval(() => { if (ovMode === 'today') refreshOverview(); }, 1000);
  }
  function closeOverview() {
    el.maskOverview.classList.remove('show');
    if (state._ovTimer) { clearInterval(state._ovTimer); state._ovTimer = null; }
  }
  // ---------- 轨迹回看（今天 / 某一天 / 自定义时间段） ----------
  let ovMode = 'today';   // 'today' | 'day' | 'range'
  /** 速度渐变色：浅黄 → 橙 → 深红，越快越深（0~16 km/h 线性映射） */
  function speedGradientColor(spd) {
    const t = Math.max(0, Math.min(1, (Number(spd) || 0) / 16));
    const mix = (a, b, k) => Math.round(a + (b - a) * k);
    let r, g, b2;
    if (t < 0.5) {
      const k = t / 0.5;
      r = mix(255, 255, k); g = mix(233, 130, k); b2 = mix(120, 60, k);
    } else {
      const k = (t - 0.5) / 0.5;
      r = mix(255, 224, k); g = mix(130, 32, k); b2 = mix(60, 32, k);
    }
    return `rgb(${r},${g},${b2})`;
  }
  /** 初始化轨迹弹窗的回看控件（幂等，只在第一次绑事件） */
  function initOvRangeControls() {
    const ovDate = $('ovDate'), ovFrom = $('ovFrom'), ovTo = $('ovTo');
    if (ovDate && !ovDate.dataset.ready) {
      ovDate.dataset.ready = '1';
      fetch('/api/days').then((r) => r.json()).then((j) => {
        const days = ((j && j.days) || []).slice().sort().reverse();
        ovDate.innerHTML = '';
        for (const d of days) {
          const o = document.createElement('option');
          o.value = d; o.textContent = d;
          ovDate.appendChild(o);
        }
      }).catch(() => {});
    }
    if (!ovDate) return;
    const apply = () => {
      ovDate.style.display = ovMode === 'day' ? '' : 'none';
      ovFrom.style.display = ovMode === 'range' ? '' : 'none';
      ovTo.style.display = ovMode === 'range' ? '' : 'none';
      document.querySelectorAll('.ov-range-btn').forEach((b) => b.classList.toggle('on', b.dataset.ov === ovMode));
      const ovDesc = $('ovDesc');
      if (ovDesc) ovDesc.textContent = ovMode === 'today'
        ? '实时显示你今天走过的全部路径、起终点和当前位置'
        : ovMode === 'day' ? '回看某一天走过的完整轨迹（从下拉里挑日期）'
        : '回看一段时间内走过的全部轨迹（按起止日期）';
      refreshOverview();
    };
    document.querySelectorAll('.ov-range-btn').forEach((b) => {
      if (b.dataset.ready) return;
      b.dataset.ready = '1';
      b.addEventListener('click', () => { ovMode = b.dataset.ov; apply(); });
    });
    if (!ovDate.dataset.bound) { ovDate.dataset.bound = '1'; ovDate.addEventListener('change', () => refreshOverview()); }
    if (!ovFrom.dataset.bound) {
      ovFrom.dataset.bound = '1'; ovTo.dataset.bound = '1';
      ovFrom.addEventListener('change', () => refreshOverview());
      ovTo.addEventListener('change', () => refreshOverview());
      // 默认时间段：最近 7 天
      const d = new Date(); d.setDate(d.getDate() - 6);
      ovFrom.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      ovTo.value = ovDateStr();
    }
    apply();
  }
  function ovDateStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  async function refreshOverview() {
    const ovDate = $('ovDate'), ovFrom = $('ovFrom'), ovTo = $('ovTo');
    let path = [];
    let summaryExtra = '';
    ovStarts = [];
    try {
      if (ovMode === 'today') {
        const data = await fetch('/api/day/' + today()).then((r) => r.json()).catch(() => null);
        path = (data && data.path) || [];
        ovStarts = ((data && data.sessions) || []).slice();
      } else if (ovMode === 'day') {
        const d = (ovDate && ovDate.value) || ovDateStr();
        const data = await fetch('/api/day/' + d).then((r) => r.json()).catch(() => null);
        path = (data && data.path) || [];
        ovStarts = ((data && data.sessions) || []).slice();
        if (!path.length && !ovStarts.length) summaryExtra = d + ' 当天没有轨迹（可能没挂机）';
      } else {
        const from = (ovFrom && ovFrom.value) || ovDateStr();
        const to = (ovTo && ovTo.value) || from;
        const data = await fetch('/api/track/range?from=' + from + '&to=' + to).then((r) => r.json()).catch(() => null);
        const days = (data && data.days) || [];
        path = days.flatMap((x) => x.path || []);
        ovStarts = (data && data.starts) || [];
        if (!path.length && !ovStarts.length) summaryExtra = from + ' ~ ' + to + ' 这段时间没有轨迹';
        else summaryExtra = from + ' ~ ' + to + '：' + days.length + ' 天，共 ' + data.total + ' 个轨迹点';
      }
    } catch (_) { return; }
    const s = state.engine ? state.engine.snapshot() : null;
    const current = (ovMode === 'today' && s) ? s.pos : null;
    el.ovSvg.innerHTML = renderOverviewSvg(path, current, ovStarts);
    if (s && ovMode === 'today') {
      el.ovSummary.innerHTML = [
        { k: '里程', v: (s.distance / 1000).toFixed(2) + ' km' },
        { k: '时长', v: fmtDur(s.durationMs) },
        { k: '路口', v: s.rolls + ' 次' },
        { k: '当前路', v: s.road || '—' },
      ].map((i) => `<div class="ov-cell"><div class="k">${i.k}</div><div class="v">${i.v}</div></div>`).join('');
    } else {
      const km = path.length >= 2
        ? (path.reduce((sum, p, idx) => idx ? sum + haversineKm(path[idx - 1], p) : 0, 0) / 1000) : 0;
      el.ovSummary.innerHTML = [
        { k: '轨迹点', v: path.length + ' 个' },
        { k: '几何里程', v: km.toFixed(2) + ' km' },
        { k: '范围', v: summaryExtra || (ovMode === 'day' ? (ovDate && ovDate.value) : '今天') },
      ].map((i) => `<div class="ov-cell"><div class="k">${i.k}</div><div class="v">${i.v}</div></div>`).join('');
    }
  }
  /** 两个轨迹点的地表距离（米）—— 轨迹几何里程估算用 */
  function haversineKm(a, b) {
    const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /** 轨迹弹窗里画出发点：紫色小点 + 序号（回看模式用） */
  let ovStarts = [];
  function ovStartsSvg(proj) {
    if (ovMode === 'today' || !ovStarts.length) return '';
    return ovStarts.map((st) => {
      const [x, y] = proj(st);
      return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#a06bff" stroke="#fff" stroke-width="1.5"/>`
        + `<text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" stroke="rgba(120,70,220,.92)" stroke-width="0.5">${st.n}</text></g>`;
    }).join('');
  }

  // ---------- 出发点 ----------
  /** 把「当前生效的出发点」渲染到设置弹窗（pending 优先于已保存配置） */
  function renderOriginFields() {
    const cfg = state.cfg || {};
    const city = el.cfgCity.value || cfg.city || '深圳';
    const center = cityCenterOf(city);
    const pending = state.pendingOrigin;
    const custom = pending ? Boolean(pending.custom)
      : (Boolean(cfg.originCustom) && isFiniteLatLng(cfg.origin));
    const o = custom ? (pending || cfg.origin) : center;
    const name = custom
      ? ((pending && pending.name) || cfg.originName || '自定义位置')
      : `城市中心 · ${city}`;
    el.orCurName.textContent = name;
    el.orCurName.className = 'oc-name' + (custom ? ' custom' : '');
    el.orCurCoord.textContent = `${Number(o.lng).toFixed(6)}, ${Number(o.lat).toFixed(6)}`;
    el.orLng.value = Number(o.lng).toFixed(6);
    el.orLat.value = Number(o.lat).toFixed(6);
  }

  function setPendingOrigin(lat, lng, name) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      el.orHint.textContent = '坐标无效，请检查后重试';
      return false;
    }
    if (Math.abs(la) > 85 || Math.abs(ln) > 180) {
      el.orHint.textContent = '坐标超出有效范围（纬度 ±85、经度 ±180）';
      return false;
    }
    state.pendingOrigin = { lat: la, lng: ln, name: name || '自定义位置', custom: true };
    renderOriginFields();
    return true;
  }

  function startPickOrigin() {
    const p = state.provider;
    if (!p || typeof p.enablePick !== 'function') {
      el.orHint.textContent = '地图还没准备好，稍后再试';
      return;
    }
    el.maskSettings.classList.remove('show');   // 弹窗会挡住地图，先收起
    state.picking = true;
    el.pbCoord.textContent = '';
    el.pickBar.classList.add('show');
    const okPick = p.enablePick((lat, lng) => {
      el.pbCoord.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      finishPickOrigin();
      setPendingOrigin(lat, lng, `地图点选 ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      el.orHint.textContent = '已把点选位置设为出发点，点「保存并重启漫游」生效';
      el.maskSettings.classList.add('show');
    });
    if (!okPick) cancelPickOrigin('当前地图不支持点选，请手动填经纬度');
  }

  function finishPickOrigin() {
    state.picking = false;
    el.pickBar.classList.remove('show');   // 成功点选或取消，都要收起提示条
    if (state.provider && typeof state.provider.disablePick === 'function') state.provider.disablePick();
  }

  function cancelPickOrigin(msg) {
    finishPickOrigin();
    el.pickBar.classList.remove('show');
    if (msg) el.orHint.textContent = msg;
    el.maskSettings.classList.add('show');
  }

  async function searchOrigin() {
    const q = (el.orSearch.value || '').trim();
    if (!q) { el.orHint.textContent = '请输入地址或地点名'; return; }
    const p = state.provider;
    if (!p || typeof p.lookupAddress !== 'function') {
      el.orHint.textContent = '演练模式下无法按地址搜索，请用「在地图上点选」或手动填经纬度';
      return;
    }
    el.btnOrSearch.disabled = true;
    const old = el.btnOrSearch.textContent;
    el.btnOrSearch.textContent = '搜索中…';
    el.orHint.textContent = '正在解析地址…';
    try {
      const r = await p.lookupAddress(q);
      if (!r || r.error) {
        el.orHint.textContent = '搜索失败：' + ((r && r.error) || '未知错误');
        return;
      }
      if (setPendingOrigin(r.lat, r.lng, r.name || q)) {
        el.orHint.textContent = `已定位：${r.name || q}`;
        try { if (p.map && p.map.setCenter) p.map.setCenter([r.lng, r.lat]); } catch (_) { /* 可选 */ }
      }
    } finally {
      el.btnOrSearch.disabled = false;
      el.btnOrSearch.textContent = old;
      updateAmapCalls();
    }
  }

  function useGeolocation() {
    if (!navigator.geolocation) { el.orHint.textContent = '当前环境不支持定位'; return; }
    el.orHint.textContent = '正在获取当前位置…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const ln = pos.coords.longitude;
        if (setPendingOrigin(la, ln, '我的当前定位')) {
          el.orHint.textContent = `已获取定位：${la.toFixed(5)}, ${ln.toFixed(5)}`;
        }
      },
      (err) => {
        el.orHint.textContent = '定位失败：' + ((err && err.message) || '浏览器拒绝了定位请求（需要 HTTPS 或本机地址）');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  function resetOrigin() {
    state.pendingOrigin = { custom: false, name: '' };
    renderOriginFields();
    el.orHint.textContent = '已改回城市中心，点保存后生效';
  }

  /** 读出设置弹窗里最终的出发点配置 */
  function readOriginConfig() {
    const city = el.cfgCity.value || '深圳';
    const center = cityCenterOf(city);
    const pending = state.pendingOrigin;
    let custom = pending ? Boolean(pending.custom)
      : (Boolean(state.cfg.originCustom) && isFiniteLatLng(state.cfg.origin));

    const mLng = parseFloat(el.orLng.value);
    const mLat = parseFloat(el.orLat.value);
    let origin = { lng: center.lng, lat: center.lat };
    if (Number.isFinite(mLng) && Number.isFinite(mLat)) {
      origin = { lng: Math.max(-180, Math.min(180, mLng)), lat: Math.max(-85, Math.min(85, mLat)) };
    } else if (custom && isFiniteLatLng(state.cfg.origin)) {
      origin = { lng: Number(state.cfg.origin.lng), lat: Number(state.cfg.origin.lat) };
    }
    // 和城市中心重合就没必要标成自定义
    if (Math.abs(origin.lng - center.lng) < 1e-9 && Math.abs(origin.lat - center.lat) < 1e-9) custom = false;

    const originName = custom
      ? ((pending && pending.name) || state.cfg.originName || '自定义位置')
      : '';
    return { origin, originCustom: custom, originName };
  }

  // ---------- UI 事件 ----------
  function bindUi() {
    el.btnStart.addEventListener('click', () => { log('出发'); startWalk(); });
    el.btnPause.addEventListener('click', () => {
      if (!state.engine) return;
      if (state.engine.isPaused()) { state.engine.resume(); el.btnPause.textContent = '暂停'; }
      else { state.engine.pause(); el.btnPause.textContent = '继续'; }
    });
    el.btnEnd.addEventListener('click', endWalk);

    el.btnOverview.addEventListener('click', () => { if (state.engine) openOverview(); else log('请先点「出发」开始漫游'); });
    el.btnOvClose.addEventListener('click', closeOverview);
    el.maskOverview.addEventListener('click', (e) => { if (e.target === el.maskOverview) closeOverview(); });

    // 成就
    el.btnAch.addEventListener('click', openAch);
    el.btnAchClose.addEventListener('click', () => el.maskAch.classList.remove('show'));
    el.maskAch.addEventListener('click', (e) => { if (e.target === el.maskAch) el.maskAch.classList.remove('show'); });
    el.achBody.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.ach-tab');
      if (btn) rerenderAch(btn.dataset.group);
    });

    // 数据
    el.btnStats.addEventListener('click', openStats);
    el.btnAlbum.addEventListener('click', openAlbum);
    if (el.btnAlbumQuick) el.btnAlbumQuick.addEventListener('click', openAlbum);   // 主面板「复制码/分享」之间的直达按钮

    // 高德加载失败提示条：重试 / 诊断 / 设置 / 关闭
    if (el.btnMapRetry) el.btnMapRetry.addEventListener('click', async () => {
      el.btnMapRetry.disabled = true;
      hideMapBanner();
      log('🔄 重新加载高德地图…');
      try { await initProvider((state.engine && state.engine.pos) || state.origin); }
      finally { el.btnMapRetry.disabled = false; }
    });
    if (el.btnMapDiag) el.btnMapDiag.addEventListener('click', () => { runAmapDiag().catch(() => {}); });
    if (el.btnMapSettings) el.btnMapSettings.addEventListener('click', () => {
      hideMapBanner();
      if (el.maskSettings) el.maskSettings.classList.add('show');
      renderOriginFields();
      loadMailForm();
      loadKeyForm();   // 回填 Key / 安全密钥，避免用户以为没保存
    });
    if (el.btnMapDismiss) el.btnMapDismiss.addEventListener('click', hideMapBanner);
    el.btnAlbumClose.addEventListener('click', () => { if (el.maskAlbum) el.maskAlbum.classList.remove('show'); });
    if (el.albumTabs) el.albumTabs.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.ach-tab');
      if (!btn) return;
      setAlbumRange(btn.dataset.range || 'all');
    });
    // 「按天回顾」：日期下拉 + 前一天/后一天
    if (el.albumDate) el.albumDate.addEventListener('change', () => {
      state.albumDate = el.albumDate.value || '';
      renderAlbum();
    });
    if (el.albumPrev) el.albumPrev.addEventListener('click', () => stepAlbumDate(1));   // 列表新→旧，+1 是更早的一天
    if (el.albumNext) el.albumNext.addEventListener('click', () => stepAlbumDate(-1));
    el.maskAlbum.addEventListener('click', (e) => { if (e.target === el.maskAlbum) el.maskAlbum.classList.remove('show'); });
    // 收集册：删除 / 手动添加 / 重溯补采
    if (el.albumBody) el.albumBody.addEventListener('click', async (e) => {
      const del = e.target.closest && e.target.closest('.album-del');
      const bf = e.target.closest && e.target.closest('[data-backfill]');
      if (del) {
        del.style.opacity = '0.2';
        try {
          const w = await postJson('/api/places/remove', { date: del.dataset.date, name: del.dataset.name }, 8000);
          if (w && w.ok) { log(`🗑 已从收集册删除：${del.dataset.name}（${del.dataset.date}）`); openAlbum(); }
          else log('删除失败：' + ((w && w.error) || '未知'));
        } catch (err) { log('删除失败：' + (err && err.message ? err.message : err)); }
        return;
      }
      if (bf && bf.dataset.backfill) {
        bf.disabled = true;
        try { await backfillDay(bf.dataset.backfill); } finally { bf.disabled = false; }
      }
    });
    if (el.btnAlbumAdd) el.btnAlbumAdd.addEventListener('click', async () => {
      const inp = el.albumAddName;
      const name = inp ? String(inp.value || '').trim() : '';
      const cat = el.albumAddCat ? el.albumAddCat.value : '地标景点';
      if (!name) { log('请先填写地点名称'); return; }
      let pos = (state.engine && state.engine.pos) || null;
      try {
        if (!pos && state.provider && state.provider.map && state.provider.map.getCenter) {
          const c = state.provider.map.getCenter();
          pos = { lat: c.lat != null ? c.lat : c.getLat(), lng: c.lng != null ? c.lng : c.getLng() };
        }
      } catch (_) { /* noop */ }
      if (!pos || !Number.isFinite(pos.lat)) { log('拿不到当前位置（请在地图上先定位）'); return; }
      el.btnAlbumAdd.disabled = true;
      try {
        const roadNow = (state.engine && state.engine.road) || '';
        const addItem = { name, cat, lat: pos.lat, lng: pos.lng, t: Date.now() };
        if (String(roadNow).trim()) addItem.road = String(roadNow).trim().slice(0, 30);
        const w = await postJson('/api/places/add', { date: today(), places: [addItem] }, 8000);
        if (w && w.ok) { log(`📔 已手动添加：${name}（${cat}）`); if (inp) inp.value = ''; openAlbum(); }
        else log('添加失败：' + ((w && w.error) || '未知'));
      } catch (err) { log('添加失败：' + (err && err.message ? err.message : err)); }
      finally { el.btnAlbumAdd.disabled = false; }
    });
    if (el.btnAlbumBackfill) el.btnAlbumBackfill.addEventListener('click', async () => {
      el.btnAlbumBackfill.disabled = true;
      try { await backfillDay(today()); openAlbum(); } finally { el.btnAlbumBackfill.disabled = false; }
    });
    // 🎯 回到分身并恢复镜头跟踪（拖动地图后用）
    if (el.btnFollow) {
      el.btnFollow.addEventListener('click', () => {
        setMapFollowing(true);
        const pos = (state.engine && state.engine.pos) || state.origin;
        try {
          if (state.provider && state.provider.map && state.provider.map.setCenter) state.provider.map.setCenter([pos.lng, pos.lat]);
        } catch (_) { /* noop */ }
        log('已回到分身位置，恢复镜头跟踪');
      });
    }
    el.btnStatsClose.addEventListener('click', () => el.maskStats.classList.remove('show'));
    el.maskStats.addEventListener('click', (e) => { if (e.target === el.maskStats) el.maskStats.classList.remove('show'); });
    bindAreaRepairUi();
    // 新设备出发提示：先同步存档 or 直接出发
    if (el.btnSyncFirstGo) {
      el.btnSyncFirstGo.addEventListener('click', async () => {
        try { localStorage.setItem(SYNC_CHOICE_KEY, 'sync'); } catch (_) { /* noop */ }
        if (el.maskSyncFirst) el.maskSyncFirst.classList.remove('show');
        el.btnSyncFirstGo.disabled = true;
        const old = el.btnSyncFirstGo.textContent;
        el.btnSyncFirstGo.textContent = '同步中…';
        try {
          log('📥 先同步邮箱存档，再出发…');
          const r = await syncFromMailbox();
          if (r && r.ok) {
            log(`已同步${r.pulled ? '（' + r.pulled + '）' : ''}`
              + (r.sessionCount ? `，累计出发 ${r.sessionCount} 次` : '')
              + (r.resume ? `，将从 ${r.resume.date} 的结束点继续` : ''));
          } else if (r && r.error) {
            log('同步失败：' + r.error + '（仍可继续出发）');
          }
        } catch (e) {
          log('同步失败：' + (e && e.message ? e.message : e) + '（仍可继续出发）');
        } finally {
          el.btnSyncFirstGo.disabled = false;
          el.btnSyncFirstGo.textContent = old;
        }
        await startWalk();
      });
    }
    if (el.btnSyncFirstSkip) {
      el.btnSyncFirstSkip.addEventListener('click', () => {
        try { localStorage.setItem(SYNC_CHOICE_KEY, 'skip'); } catch (_) { /* noop */ }
        if (el.maskSyncFirst) el.maskSyncFirst.classList.remove('show');
        log('已选择直接出发（本次不再提示；想同步可在「账号与档案」点「一键同步」，两边会自动合并）');
        startWalk();
      });
    }
    // 手动暂停/继续：用户的意图优先，清掉断网自动暂停标记（避免联网后又被自动恢复）
    if (el.btnPause) {
    }
    // 注：全局「轨迹整备」已移除（会把小路整成直线）——改用「🩹 区域修复」按需修复
    el.statsTabs.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.ach-tab');
      if (!btn) return;
      [...el.statsTabs.children].forEach((c) => c.classList.toggle('on', c === btn));
      renderStats(btn.dataset.range);
    });

    // 存档
    el.btnArchive.addEventListener('click', () => el.maskArchive.classList.add('show'));
    // 把邮箱同步/恢复的错误翻译成更直白的话：特别区分「连不上」和「连上了但收件箱没存档邮件」
    function mailErrorHint(raw) {
      const s = String(raw || '');
      if (s.indexOf('还没有 NetWalk 存档邮件') >= 0) {
        return '邮箱已连上 ✓，但收件箱里还没有 NetWalk 存档邮件（首次使用、或旧设备从未发送过均属正常）。生成第一封：在旧设备「结束漫游」会自动发到本邮箱；或到旧设备「存档」弹窗复制存档码导入这里。';
      }
      if (s.indexOf('未配置 IMAP') >= 0) return '邮箱还没配好 IMAP：请到 ⚙ 设置 → 📮 邮件服务 填 imap.qq.com、邮箱账号与授权码。';
      if (s.indexOf('超时') >= 0 || s.indexOf('IMAP 错误') >= 0 || s.indexOf('拒绝连接') >= 0) return '连不上邮箱：' + s + '。请确认 IMAP 服务已开启、授权码正确，且能访问 imap.qq.com:993。';
      return s || '未知错误';
    }
        // 一键同步：恢复邮箱里保存的配置 + 拉回最新存档码（登录账号 / 换设备时用）
    el.btnSync.addEventListener('click', async () => {
      const btn = el.btnSync;
      const old = btn.innerHTML;
      btn.disabled = true; btn.textContent = '同步中…';
      // 用户主动点同步 = 明确要把邮箱数据取回来，解除"重置后暂停自动同步"。
      // 重置过的设备也不怕：导入时会按双方 resetAt 处理（对端更晚重置→接管本机；
      // 本机更晚重置→对端重置前的点按时间戳全部过滤，旧轨迹不会回来）。
      try { localStorage.removeItem('netwalkNoAutoSync'); } catch (_) { /* noop */ }
      try {
        const r = await syncFromMailbox();
        const parts = [];
        if (r.restored) parts.push(r.restored);
        if (r.ok) parts.push(r.pulled); else if (r.pulled) parts.push(r.pulled);
        log('🔄 一键同步：' + (parts.filter(Boolean).join('；') || '未完成'));
        if (!parts.filter(Boolean).length) log('同步未完成：请先在 ⚙ 设置 → 📮 配置邮件服务里填好 SMTP/IMAP 授权码');
        if (r.takeover) log('♻ 已执行对端的重置标记：本机旧轨迹已全部清空，采用同步来的全新数据。');
        if (r.keyRestored) {
          log('已恢复高德 Key，正在重新加载以启用真实地图…');
          setTimeout(() => location.reload(), 1500);
          return;
        }
        if (r.ok) {
          if (r.sessionCount) log(`出发记录已合并为 ${r.sessionCount} 次（已重新编号）`);
          if (r.resume) log(`出发时将从 ${r.resume.date} 的结束位置（${r.resume.lat.toFixed(4)}, ${r.resume.lng.toFixed(4)}）继续。`);
          else log('出发时将从上次结束位置继续。');
        }
      } catch (e) {
        log('同步失败：' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false; btn.innerHTML = old;
      }
    });

    // 登录后自动从邮箱同步（换设备首次登录）：登录流程写了一个待同步标记，服务重启后在这里执行
    try {
      if (localStorage.getItem('netwalkPendingSync') === '1') {
        localStorage.removeItem('netwalkPendingSync');
        setTimeout(async () => {
          log('检测到刚登录，正在从邮箱同步旧存档…');
          const rc = await fetch('/api/mailbox/restore-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch(() => null);
          const mp = await fetch('/api/mailbox/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch(() => null);
          if (rc && rc.ok) log('已从邮箱恢复 ' + (rc.restored || []).length + ' 项配置 ✓');
          if (mp && mp.ok) log('已从邮箱同步旧存档 ✓');
          else if (mp && mp.error) log('邮箱同步：' + mailErrorHint(mp.error));
        }, 2500);
      }
    } catch (_) { /* noop */ }

el.btnReport.addEventListener('click', () => {
      // 摸鱼外观的纯文字 Excel 报表（看起来像在工作）
      window.open('/report-excel.html', '_blank', 'noopener');
    });
    el.btnCopyArc.addEventListener('click', async () => {
      // 一键复制存档码（方便换设备导入）
      const oldText = el.btnCopyArc.innerHTML;
      try {
        const r = await fetch('/api/archive/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json();
        if (!j || !j.code) throw new Error('生成失败');
        const code = j.code;
        try { await navigator.clipboard.writeText(code); }
        catch (_) {
          const ta = document.createElement('textarea'); ta.value = code;
          ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e) { ta.remove(); throw e; }
          ta.remove();
        }
        el.btnCopyArc.innerHTML = '<span>✓</span>已复制';
        setTimeout(() => { el.btnCopyArc.innerHTML = oldText; }, 1600);
        log('存档码已复制到剪贴板（' + Math.round(code.length / 1024) + ' KB）');
      } catch (e) {
        el.btnCopyArc.innerHTML = '<span>✗</span>失败';
        setTimeout(() => { el.btnCopyArc.innerHTML = oldText; }, 1600);
        log('复制存档码失败：' + (e && e.message ? e.message : e) + '（请到「存档」弹窗手动复制）');
      }
    });
    el.btnArClose.addEventListener('click', () => el.maskArchive.classList.remove('show'));
    el.maskArchive.addEventListener('click', (e) => { if (e.target === el.maskArchive) el.maskArchive.classList.remove('show'); });
    el.btnArGen.addEventListener('click', genArchive);
    el.btnArCopy.addEventListener('click', copyArchive);
    el.btnArImport.addEventListener('click', doImport);
    // 恢复存档码里携带的本机配置（高德 Key / 邮箱）：换设备时免手填
    if (el.btnArApplyCfg) el.btnArApplyCfg.addEventListener('click', async () => {
      const code = state.lastImportedCode || el.arInput.value.trim() || el.arCode.value.trim();
      if (!code) { el.arHint.textContent = '请先粘贴并导入存档码'; return; }
      el.btnArApplyCfg.disabled = true;
      const old = el.btnArApplyCfg.textContent;
      el.btnArApplyCfg.textContent = '恢复中…';
      try {
        const r = await fetch('/api/archive/apply-config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
        }).then((x) => x.json());
        if (!r.ok) throw new Error(r.error || '恢复失败');
        el.arHint.textContent = `已恢复本机配置（${(r.restored || []).length} 项）。正在重新加载设置…`;
        log('已从存档码恢复本机配置：' + (r.restored || []).join(', '));
        setTimeout(() => location.reload(), 900);
      } catch (e) {
        el.arHint.textContent = '恢复失败：' + (e && e.message ? e.message : e);
      } finally {
        el.btnArApplyCfg.disabled = false;
        el.btnArApplyCfg.textContent = old;
      }
    });

    // 分享
    el.btnShare.addEventListener('click', openShare);
    el.btnShareClose.addEventListener('click', () => el.maskShare.classList.remove('show'));
    el.maskShare.addEventListener('click', (e) => { if (e.target === el.maskShare) el.maskShare.classList.remove('show'); });
    el.btnShareSave.addEventListener('click', saveShare);
    el.btnShareCopy.addEventListener('click', copyShareText);

    el.btnFold.addEventListener('click', () => {
      document.getElementById('dock').classList.add('collapsed');
      el.btnUnfold.style.display = 'flex';
    });
    el.btnUnfold.addEventListener('click', () => {
      document.getElementById('dock').classList.remove('collapsed');
      el.btnUnfold.style.display = 'none';
    });
    el.btnPop.addEventListener('click', () => {
      window.open('/dock.html', 'netwalk-dock', 'width=326,height=430,menubar=no,toolbar=no,location=no');
    });
    // 打开今日日报：有 URL 直接开；没有就现场生成一次；始终给可见反馈（不再"点了没反应/按不动"）
    el.btnOpenReport.addEventListener('click', async () => {
      const btn = el.btnOpenReport;
      const old = btn.textContent;
      let url = state.reportUrl;
      if (!url) {
        btn.disabled = true; btn.textContent = '日报生成中…';
        if (el.doneHint) el.doneHint.textContent = '正在生成日报…';
        url = await ensureReport(state.reportDate || today());
        btn.disabled = false; btn.textContent = old;
      }
      if (url) {
        if (el.doneHint) el.doneHint.textContent = '';
        window.open(url, '_blank');
      } else {
        const why = state.reportError || '当天还没有轨迹数据（先走一会儿再结束就能生成）';
        if (el.doneHint) el.doneHint.textContent = '日报打不开：' + why;
        log('日报打不开：' + why);
      }
    });
    el.btnRestart.addEventListener('click', () => {
      el.maskDone.classList.remove('show');
      startWalk();
    });
    // 结束面板：把存档码直接发到邮箱（换设备一键续档）
    if (el.btnDoneMail) el.btnDoneMail.addEventListener('click', async () => {
      const btn = el.btnDoneMail;
      const old = btn.textContent;
      btn.disabled = true; btn.textContent = '发送中…';
      if (el.doneHint) el.doneHint.textContent = '正在把存档码发送到你的邮箱…';
      try {
        const j = await fetch('/api/mailbox/push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }).then((r) => r.json());
        const msg = j.ok
          ? ('已把存档码发到 ' + (j.to || '你的邮箱') + ' ✓ 换设备登录后一键同步即可续档')
          : ('发送失败：' + (j.error || '未知错误'));
        if (el.doneHint) el.doneHint.textContent = msg;
        log(msg);
      } catch (e) {
        const msg = '发送失败：' + (e && e.message ? e.message : e);
        if (el.doneHint) el.doneHint.textContent = msg;
        log(msg);
      } finally {
        btn.disabled = false; btn.textContent = old;
      }
    });
    el.btnDoneArcCopy.addEventListener('click', async () => {
      const code = el.doneArc.value || state.lastArchiveCode || '';
      if (!code) { log('存档码还没生成好，稍等一秒再点'); return; }
      const oldText = el.btnDoneArcCopy.textContent;
      try {
        try { await navigator.clipboard.writeText(code); }
        catch (_) {
          const ta = document.createElement('textarea'); ta.value = code;
          ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e) { ta.remove(); throw e; }
          ta.remove();
        }
        el.btnDoneArcCopy.textContent = '✓ 已复制';
        setTimeout(() => { el.btnDoneArcCopy.textContent = oldText; }, 1600);
      } catch (_) {
        el.btnDoneArcCopy.textContent = '✗ 复制失败';
        setTimeout(() => { el.btnDoneArcCopy.textContent = oldText; }, 1600);
      }
    });

    // 设置
    const openSettings = () => {
      el.keyNotice.style.display = state.cfg.hasKey ? 'none' : 'block';
      renderOriginFields();
      loadMailForm();     // 回填已保存的邮箱配置（否则输入框空白，用户以为没保存，只好反复重填）
      loadKeyForm();      // 回填高德 Key / 安全密钥的"已配置"提示（否则会被误填成一样的值）
      checkMailBox();     // 顺带查一下邮箱里到底有没有存档
      el.maskSettings.classList.add('show');
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // 点选模式优先取消，不要连带把设置弹窗也关掉
        if (state.picking) { cancelPickOrigin('已取消点选'); return; }
        el.maskSettings.classList.remove('show');
        el.maskDone.classList.remove('show');
        el.maskOverview.classList.remove('show');
        el.maskAch.classList.remove('show');
        el.maskStats.classList.remove('show');
        el.maskArchive.classList.remove('show');
        el.maskShare.classList.remove('show');
      }
    });
    el.pillMap.addEventListener('click', openSettings);
    // 设置的显式入口（原来只能点地图状态胶囊，太隐蔽）
    el.btnSettings.addEventListener('click', openSettings);
    // 从邮箱恢复机器配置（Key / 安全密钥 / SMTP / IMAP）：换设备登录后点一次全填好
    const btnRestoreMail = $('btnMailRestore'), mailHintEl = $('mailHint');
    btnRestoreMail.addEventListener('click', async () => {
      const oldText = btnRestoreMail.textContent;
      btnRestoreMail.disabled = true; btnRestoreMail.textContent = '连接邮箱中…';
      try {
        const r = await fetch('/api/mailbox/restore-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json();
        if (!j.ok) {
          const noArchive = String(j.error || '').indexOf('还没有 NetWalk 存档邮件') >= 0;
          // 「没存档邮件」不算连接失败，不显示"恢复失败"，避免用户误以为授权没成功
          mailHintEl.textContent = (noArchive ? '' : '恢复失败：') + mailErrorHint(j.error || '未知错误');
          return;
        }
        mailHintEl.textContent = '已从邮箱恢复 ' + (j.restored || []).length + ' 项配置' + (j.hasKey ? '（高德 Key 已恢复 ✓）' : '（邮件里没有 Key）');
        log('机器配置已从邮箱恢复：' + (j.restored || []).join(', '));
        const c = await fetch('/api/config').then((x) => x.json());
        const fill = (id, v) => { const n2 = $(id); if (n2 && v) n2.value = v; };
        fill('mailHost', c.mailSmtpHost); fill('mailPort', c.mailSmtpPort);
        fill('mailUser', c.mailUser); if (c.mailPass) fill('mailPass', '***configured***');
        fill('mailImapHost', c.mailImapHost); fill('mailImapPort', c.mailImapPort);
      } catch (e) {
        mailHintEl.textContent = '恢复失败：' + (e && e.message ? e.message : e);
      } finally {
        btnRestoreMail.disabled = false; btnRestoreMail.textContent = oldText;
      }
    });
    el.btnVersion.addEventListener('click', openVersion);
    el.btnVerClose.addEventListener('click', () => el.maskVersion.classList.remove('show'));

    // 账号
    el.btnAccount.addEventListener('click', openAccount);
    el.btnAccClose.addEventListener('click', () => el.maskAccount.classList.remove('show'));
    el.btnAccCode.addEventListener('click', async () => {
      const email = el.accEmailInput.value.trim();
      el.accCodeHint.textContent = '';
      if (!email) { el.accCodeHint.textContent = '请先填邮箱'; return; }
      try {
        const r = await fetch('/api/account/code', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const j = await r.json();
        if (!j.ok) { el.accCodeHint.textContent = j.error || '发送失败'; return; }
        el.accCodeHint.textContent = j.sent
          ? '验证码已发送到邮箱，5 分钟内有效'
          : (j.hint || `验证码：${j.devCode}（仅本机可见，5 分钟内有效）`);
      } catch (e) { el.accCodeHint.textContent = '发送失败：' + netErr(e); }
    });
    const accPost = (url, body) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    }).then((r) => r.json());
    el.btnAccRegister.addEventListener('click', async () => {
      try {
        const j = await accPost('/api/account/register', {
          email: el.accEmailInput.value.trim(), code: el.accCode.value.trim(), name: el.accNameInput.value.trim(),
        });
        if (!j.ok) { el.accCodeHint.textContent = j.error || '注册失败'; return; }
        log(`档案「${j.account.name}」创建成功`);
        restartForAccount();
      } catch (e) { el.accCodeHint.textContent = '注册失败：' + netErr(e); }
    });
    el.btnAccLogin.addEventListener('click', async () => {
      try {
        const j = await accPost('/api/account/login', {
          email: el.accEmailInput.value.trim(), code: el.accCode.value.trim(), name: el.accNameInput.value.trim(),
        });
        if (!j.ok) { el.accCodeHint.textContent = j.error || '登录失败'; return; }
        el.accCodeHint.textContent = '登录成功 ✓ 正在重启并从邮箱同步该账号的数据…';
        log(j.createdHere
          ? `已在本机创建档案「${j.account.name}」（新设备首次登录），正在重启并同步…`
          : `已登录档案「${j.account.name}」，正在从邮箱同步数据…`);
        // 重启完成（确认新 pid）后立刻一键同步：配置 + 该邮箱账号的存档。
        // 本机若重置过也不必特殊处理：导入按双方 resetAt 处理
        // （对端更晚重置 → 接管本机；本机更晚重置 → 对端重置前的点按时间戳过滤）。
        restartForAccount(async () => {
          el.accCodeHint.textContent = '正在从邮箱同步数据与配置…';
          const r = await syncFromMailbox();
          if (r.keyRestored) {
            el.accCodeHint.textContent = '同步完成：已恢复高德 Key 与存档，正在重新加载…';
            setTimeout(() => location.reload(), 1500);
            return;
          }
          const parts = [];
          if (r.restored) parts.push(r.restored);
          if (r.ok) parts.push(r.pulled); else if (r.pulled) parts.push(r.pulled);
          if (r.sessionCount) parts.push('出发记录 ' + r.sessionCount + ' 次');
          let tail = '点「出发」将从上次结束位置继续。';
          if (r.resume) tail = `点「出发」将从 ${r.resume.date} 的结束位置（${r.resume.lat.toFixed(4)}, ${r.resume.lng.toFixed(4)}）继续。`;
          el.accCodeHint.textContent = parts.length
            ? ('同步完成 ✓ ' + parts.join('，') + '。' + tail)
            : '同步未完成：请先在 ⚙ 设置 → 📮 邮件服务 填好 SMTP/IMAP，再点「一键同步」。';
          log('🔄 登录后同步：' + (parts.join('；') || '未完成'));
          if (r.takeover) log('♻ 已执行对端的重置标记：本机旧轨迹已全部清空，采用同步来的全新数据。');
        });
      } catch (e) { el.accCodeHint.textContent = '登录失败：' + netErr(e); }
    });
    el.btnAccRename.addEventListener('click', async () => {
      const name = el.accNewName.value.trim();
      if (!name) return;
      const j = await accPost('/api/account/rename', { name });
      if (j.ok) { log(`档案已改名为「${j.account.name}」`); refreshAccount(); renderAccount(j); el.accNewName.value = ''; }
      else el.accResetHint.textContent = j.error || '改名失败';
    });
    el.btnAccReset.addEventListener('click', async () => {
      if (el.accResetText.value.trim() !== '重置') {
        el.accResetHint.textContent = '请输入「重置」两个字确认（这是防止误点的最后一步）';
        return;
      }
      const j = await accPost('/api/account/reset', { confirmText: el.accResetText.value.trim() });
      if (j.ok) {
        el.accResetHint.textContent = `已重置：清了 ${j.removed} 项数据。${j.note}`;
        log('⚠ 档案已重置：轨迹与成就清空（出发点保持不变）。已暂停自动同步，避免把邮箱里的旧存档拉回来；需要时点「一键同步」。');
        try { localStorage.setItem('netwalkNoAutoSync', '1'); } catch (_) { /* noop */ }
        el.accResetText.value = '';
        if (j.needRestart) restartForAccount();
      } else {
        el.accResetHint.textContent = j.error || '重置失败';
      }
    });
    el.btnAccLogout.addEventListener('click', async () => {
      const j = await accPost('/api/account/logout');
      if (j.ok) { log('已退出账号，将回到默认档案'); restartForAccount(); }
    });
    el.btnMailSave.addEventListener('click', async () => {
      const body = {
        mailSmtpHost: el.mailHost.value.trim(),
        mailSmtpPort: el.mailPort.value.trim(),
        mailUser: el.mailUser.value.trim(),
      };
      const imapHost = ($('mailImapHost') || {}).value;
      if (imapHost) body.mailImapHost = imapHost.trim();
      const imapPort = ($('mailImapPort') || {}).value;
      if (imapPort) body.mailImapPort = imapPort.trim();
      const pass = el.mailPass.value.trim();
      if (pass) body.mailPass = pass;   // 留空 = 保持原配置
      if (el.autoMailArchive) body.autoMailArchive = el.autoMailArchive.checked;
      if (el.hourlyMailArchive) body.hourlyMailArchive = el.hourlyMailArchive.checked;
      if (!body.mailSmtpHost || !body.mailUser || (!pass && el.mailPass.placeholder.indexOf('已配置') < 0)) {
        el.mailHint.textContent = '服务器、账号、授权码都要填（端口默认 465）';
        return;
      }
      try {
        const r = await fetch('/api/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (r.ok) {
          el.mailHint.textContent = '已保存 ✓ 结束漫游 / 上传时会自动发存档码到邮箱' + (body.mailImapHost ? '，出发时还会自动从邮箱续档' : '');
          log('邮件服务已配置：存档码将自动发到邮箱' + (body.mailImapHost ? '，且出发时自动从邮箱续档' : ''));
          checkMailBox();   // 保存后立刻刷新「邮箱里有没有存档」指示灯
        } else el.mailHint.textContent = '保存失败';
      } catch (e) { el.mailHint.textContent = '保存失败：' + (e && e.message ? e.message : e); }
    });

    // 检查邮箱里有没有存档邮件
    el.btnMailStatus.addEventListener('click', checkMailBox);
    // 立即把当前存档码上传到邮箱（换设备续档用）
    el.btnMailPush.addEventListener('click', async () => {
      const btn = el.btnMailPush;
      const old = btn.textContent;
      btn.disabled = true; btn.textContent = '发送中…';
      el.mailHint.textContent = '正在生成存档码并发送到邮箱…';
      try {
        const j = await fetch('/api/mailbox/push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }).then((r) => r.json());
        el.mailHint.textContent = j.ok
          ? ('已把存档码发到 ' + (j.to || '你的邮箱') + ' ✓ 可到邮箱确认')
          : ('上传失败：' + (j.error || '未知错误'));
        if (j.ok) { log('存档码已上传到邮箱，换设备可一键续档'); checkMailBox(); }
      } catch (e) {
        el.mailHint.textContent = '上传失败：' + (e && e.message ? e.message : e);
      } finally {
        btn.disabled = false; btn.textContent = old;
      }
    });

    // 清理旧存档邮件：只保留最新一封（同步只需要最新那封）。两步确认，防误删。
    if (el.btnMailClean) {
      let cleanArmed = false, cleanTimer = null;
      el.btnMailClean.addEventListener('click', async () => {
        const btn = el.btnMailClean;
        if (!cleanArmed) {
          cleanArmed = true;
          btn.textContent = '再点一次确认删除';
          if (el.mailHint) el.mailHint.textContent = '将删除除最新一封外的全部 NetWalk 邮件（不影响其他邮件）。再点一次执行。';
          clearTimeout(cleanTimer);
          cleanTimer = setTimeout(() => { cleanArmed = false; btn.textContent = '🧹 清理旧邮件'; }, 6000);
          return;
        }
        cleanArmed = false;
        clearTimeout(cleanTimer);
        btn.disabled = true; btn.textContent = '清理中…';
        if (el.mailHint) el.mailHint.textContent = '正在连接邮箱并清理旧 NetWalk 邮件…（邮件多时会慢一点）';
        try {
          const j = await fetch('/api/mailbox/cleanup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
          }).then((r) => r.json());
          if (j.ok) {
            const msg = j.deleted > 0 ? `已清理 ${j.deleted} 封旧 NetWalk 邮件，保留最新一封 ✓` : '没有需要清理的旧邮件 ✓';
            if (el.mailHint) el.mailHint.textContent = msg;
            log('🧹 ' + msg);
            checkMailBox();
          } else {
            if (el.mailHint) el.mailHint.textContent = '清理失败：' + (j.error || '未知错误');
          }
        } catch (e) {
          if (el.mailHint) el.mailHint.textContent = '清理失败：' + (e && e.message ? e.message : e);
        } finally {
          btn.disabled = false; btn.textContent = '🧹 清理旧邮件';
        }
      });
    }

    el.btnCloseCfg.addEventListener('click', () => el.maskSettings.classList.remove('show'));
    el.btnBossTest.addEventListener('click', toggleBoss);
    el.btnSaveCfg.addEventListener('click', async () => {
      const og = readOriginConfig();
      const effKey = el.cfgKey.value.trim() || state.savedKey || '';
      const effSec = el.cfgSec.value.trim() || state.savedSec || '';
      const body = {
        city: el.cfgCity.value,
        scope: el.cfgScope.value,
        origin: og.origin,
        originCustom: og.originCustom,
        originName: og.originName,
      };
      // 只有确定有 Key 才下发 amapKey/provider：
      // 否则"输入框为空 + savedKey 还没回填完成"时会把 Key 清成空串、provider 打回 drill，
      // 表现为"重置/保存设置后地图变虚拟路网"。
      if (effKey) {
        body.amapKey = effKey;
        body.amapSecurityJsCode = effSec;
        body.provider = 'amap';
      }
      // 老板键：下拉里是 "键码|修饰键"
      const bossSel = String(el.cfgBossKey.value || '67|').split('|');
      body.boss = {
        enabled: Boolean(el.cfgBossOn.checked),
        key: Number(bossSel[0]) || 67,
        mods: bossSel[1] || '',
      };
      await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      el.maskSettings.classList.remove('show');
      log('设置已保存，正在重新加载…');
      setTimeout(() => location.reload(), 600);
    });

    // 清除安全密钥：地址解析一直超时时的排查手段（若 Key 没开「静态安全密钥」，填了反而被拒）
    if (el.btnSecClear) el.btnSecClear.addEventListener('click', async () => {
      el.btnSecClear.disabled = true;
      try {
        await fetch('/api/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amapKey: state.savedKey || '', amapSecurityJsCode: '__CLEAR__' }),
        });
        const msg = '安全密钥已清除。请点「保存并重启漫游」，然后再试一次地址搜索。';
        if (el.secHint) el.secHint.textContent = msg;
        log(msg);
      } catch (e) {
        if (el.secHint) el.secHint.textContent = '清除失败：' + (e && e.message ? e.message : e);
      } finally {
        el.btnSecClear.disabled = false;
      }
    });

    // 出发点
    el.btnOrSearch.addEventListener('click', searchOrigin);
    el.orSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchOrigin(); });
    el.btnOrPick.addEventListener('click', startPickOrigin);
    el.btnOrGeo.addEventListener('click', useGeolocation);
    el.btnOrReset.addEventListener('click', resetOrigin);
    el.btnPickCancel.addEventListener('click', () => cancelPickOrigin('已取消点选'));
    el.orLng.addEventListener('change', () => {
      const ln = parseFloat(el.orLng.value);
      const la = parseFloat(el.orLat.value);
      if (Number.isFinite(ln) && Number.isFinite(la)) setPendingOrigin(la, ln, '手动输入坐标');
    });
    el.orLat.addEventListener('change', () => {
      const ln = parseFloat(el.orLng.value);
      const la = parseFloat(el.orLat.value);
      if (Number.isFinite(ln) && Number.isFinite(la)) setPendingOrigin(la, ln, '手动输入坐标');
    });
    el.cfgCity.addEventListener('change', () => {
      // 换城市时，若出发点还是「城市中心」，跟着一起更新
      if (!state.pendingOrigin || !state.pendingOrigin.custom) {
        state.pendingOrigin = { custom: false, name: '' };
        renderOriginFields();
      }
    });

    window.addEventListener('resize', () => {
      if (state.provider && state.provider.name === 'drill' && state.engine) {
        // 演练模式随窗口尺寸重绘
        const p = state.provider;
        if (p.svg) {
          p.W = el.map.clientWidth; p.H = el.map.clientHeight;
          p.svg.setAttribute('viewBox', `0 0 ${p.W} ${p.H}`);
          p._render();
        }
      }
    });
  }

  boot().catch((err) => {
    log('启动失败：' + (err && err.message ? err.message : err));
    console.error(err);
  });
})();
