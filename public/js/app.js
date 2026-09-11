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
    mVisited: $('mVisited'), mLit: $('mLit'),
  };

  const state = {
    cfg: null,
    provider: null,
    engine: null,
    ws: null,
    started: false,
    netAvailable: false,
    keyMode: 'none',
    channel: ('BroadcastChannel' in window) ? new BroadcastChannel('netwalk') : null,
    reportUrl: '',
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

  async function openAccount() {
    el.maskAccount.classList.add('show');
    const j = await refreshAccount();
    renderAccount(j);
    // 回填邮件服务配置（密码只回显是否已配置）
    try {
      const cfg = await fetch('/api/config').then((r) => r.json());
      el.mailHost.value = cfg.mailSmtpHost || '';
      el.mailPort.value = cfg.mailSmtpPort || '';
      el.mailUser.value = cfg.mailUser || '';
      el.mailPass.value = '';
      el.mailPass.placeholder = cfg.mailPass === '***configured***' ? '已配置（填新值可覆盖）' : '授权码';
      el.mailHint.textContent = cfg.mailConfigured ? '已配置 ✓ 注册/登录时会自动发存档码到邮箱' : '';
    } catch (_) { /* noop */ }
  }

  /** 账号变更后需要重启服务才能切到新数据目录 */
  function restartForAccount() {
    log('账号已切换，正在重启服务加载新档案…');
    el.btnAccount.textContent = '🔄 重启中';
    fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(() => { /* noop */ });
    // 新进程起来后页面照常自动重连 WS；2.5 秒后刷新一次账号状态
    clearInterval(accountTimer);
    accountTimer = setInterval(async () => {
      const j = await refreshAccount();
      if (j) { clearInterval(accountTimer); log('服务已重启，档案加载完成'); }
    }, 1500);
    setTimeout(() => clearInterval(accountTimer), 30000);
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
      el.originLockHint.style.display = 'inline';
      el.profileInfo.style.display = 'block';
      // 出发点编辑收起来：修改 = 重置
      ['orSearch', 'btnOrSearch', 'btnOrPick', 'btnOrGeo', 'btnOrReset'].forEach((id) => {
        if (el[id]) el[id].disabled = true;
      });
    } else {
      el.profileInfo.textContent = '尚未创建档案。首次出发前建议先在欢迎弹窗里注册（起名字 + 选出发点）。';
    }
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

    // 重置流程
    el.btnOpenReset.addEventListener('click', () => {
      fillCitySelect(el.rsCity);
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
        log('已重置全部数据，出发点改为 ' + city + '。页面即将刷新…');
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
    bindProfileUi();
    setupLocalKeyFallback();
    checkProfile();

    if (useCustom) log(`出发点：${state.cfg.originName || '自定义位置'}`);
    else log(`出发点：${city}市中心（可在设置里改成任意地点）`);

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
      log(`演练模式已就绪${err && err.message && err.message !== 'no amap key' ? '（' + err.message + '）' : ''}`);
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
  /** 出发前从邮箱拉回最新存档码（配置了 IMAP 才可用；失败不影响本地出发） */
  async function pullArchiveFromMailbox() {
    try {
      const r = await fetch('/api/mailbox/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (j.ok) {
        const imp = j.result || {};
        log(`已从邮箱同步最新存档（${imp.mergedDays != null ? imp.mergedDays + ' 天' : '完成'}），将从上次结束点继续`);
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

  async function startWalk() {
    if (!state.provider) return;
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
    });
    state.engine = engine;
    engine.start();
    state.started = true;
    el.btnStart.disabled = true;
    el.btnPause.disabled = false;
    el.btnEnd.disabled = false;
    el.btnPause.textContent = '暂停';

    if (resume) {
      const when = resume.date === today() ? '上次结束位置' : `${resume.date} 的结束位置`;
      log(`从${when}继续（${resume.lat.toFixed(4)}, ${resume.lng.toFixed(4)}）——出发点只在注册时设定一次`);
    } else {
      log('从出发点出发');
    }
    // 主地图先画上历史轨迹（走过的所有路，按速度渐变色），再画全部出发点（紫点 + 序号）
    drawHistoryOnMap(origin);
    fetch('/api/session/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today(), city: state.cfg.city, scope: state.cfg.scope, lat: origin.lat, lng: origin.lng }),
    }).then((r) => r.json()).then((j) => {
      if (state.provider && state.provider.addStartMarker && j.sessionNo) {
        state.provider.addStartMarker(origin.lat, origin.lng, j.sessionNo);
        log(`第 ${j.sessionNo} 次出发（地图上已用紫点标出）`);
      }
    }).catch(() => { /* 离线时忽略 */ });
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
        state.provider.setTrack(flat);
        log(`已把历史轨迹画上地图：${days.length} 天、${flat.length} 个轨迹点`);
      }
      for (const st of (r && r.starts) || []) {
        if (state.provider.addStartMarker) state.provider.addStartMarker(st.lat, st.lng, st.n);
      }
    } catch (_) { /* 离线时忽略，不影响行走 */ }
  }

  function onEngineUpdate(s) {
    const modes = window.NetWalkSpeed.MODES;
    const m = modes[s.mode] || modes.walk;
    el.speed.innerHTML = `${s.speedKmh.toFixed(1)}<small>km/h</small>`;
    el.mode.textContent = `${m.icon} ${m.label}`;
    el.mode.style.color = m.color;
    const pct = Math.round(Math.min(100, (s.speedKmh / (state.cfg.speed.runMax * 1.35)) * 100));
    el.bar.style.width = `${pct}%`;
    el.intensity.textContent = `${pct}%`;
    el.road.textContent = s.road || '—';
    el.seg.textContent = s.road
      ? `在 ${s.road} 走 ${(s.roadPct || 0).toFixed(0)}%（剩 ${(s.roadRemain || 0).toFixed(0)} m）`
      : '—';
    el.dist.textContent = `${(s.distance / 1000).toFixed(2)} km`;
    el.dur.textContent = fmtDur(s.durationMs);
    el.rolls.textContent = `${s.rolls} 次`;
    el.avg.textContent = `${s.avgSpeed.toFixed(1)} km/h`;
    el.mVisited.textContent = `${s.visited || 0} 条路`;
    el.mLit.textContent = `${s.litCells || 0} 块`;
    updateAmapCalls();

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

    try {
      const endRes = await fetch('/api/session/end', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today(), stats, city: state.cfg.city, scope: state.cfg.scope }),
      }).then((r) => r.json());
      if (endRes && endRes.achievements) {
        state.ach = endRes.achievements;
        if (endRes.achievements.got) el.achDot.classList.add('on');
        if (endRes.achievements.newly && endRes.achievements.newly.length) {
          announceAchievements(endRes.achievements.newly);
        }
      }
      const r = await fetch(`/api/report/${today()}`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) state.reportUrl = j.url;
    } catch (err) {
      log('日报生成失败：' + err.message);
    }
    showDone(stats);
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
  async function refreshAchievements({ silent = true } = {}) {
    try {
      const r = await fetch('/api/achievements').then((x) => x.json());
      state.ach = r;
      if (r.got) el.achDot.classList.add('on');
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
      el.arHint.textContent = `导入成功：新增 ${r.added} 天，合并 ${r.merged} 天，当前共 ${r.days} 天`;
      log(`存档导入完成（新增 ${r.added} 天 / 合并 ${r.merged} 天）`);
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
    for (let i = 1; i < track.length; i++) {
      const [x1, y1] = proj(track[i - 1]);
      const [x2, y2] = proj(track[i]);
      const spd = track[i].spd || 0;
      const color = speedGradientColor(spd);
      segs.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.92"/>`);
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
    el.btnStatsClose.addEventListener('click', () => el.maskStats.classList.remove('show'));
    el.maskStats.addEventListener('click', (e) => { if (e.target === el.maskStats) el.maskStats.classList.remove('show'); });
    el.statsTabs.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.ach-tab');
      if (!btn) return;
      [...el.statsTabs.children].forEach((c) => c.classList.toggle('on', c === btn));
      renderStats(btn.dataset.range);
    });

    // 存档
    el.btnArchive.addEventListener('click', () => el.maskArchive.classList.add('show'));
        // 一键同步：恢复邮箱里保存的配置 + 拉回最新存档码（登录账号 / 换设备时用）
    el.btnSync.addEventListener('click', async () => {
      const btn = el.btnSync;
      const old = btn.innerHTML;
      btn.disabled = true; btn.textContent = '同步中…';
      let restored = '', pulled = '';
      try {
        const rc = await fetch('/api/mailbox/restore-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch(() => null);
        if (rc && rc.ok) restored = '配置已恢复（' + (rc.restored || []).length + ' 项）'; else if (rc) restored = rc.error || '';
        const mp = await fetch('/api/mailbox/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch(() => null);
        if (mp && mp.ok) pulled = '存档已同步'; else if (mp) pulled = mp.error || '';
        log('🔄 一键同步：' + [restored, pulled].filter(Boolean).join('；'));
        if (!restored && !pulled) log('同步未完成：请先在 ⚙ 设置 → 📮 配置邮件服务里填好 SMTP/IMAP 授权码');
      } catch (e) {
        log('同步失败：' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false; btn.innerHTML = old;
      }
    });
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
    $('btnOpenReport') && el.btnOpenReport.addEventListener('click', () => {
      if (state.reportUrl) window.open(state.reportUrl, '_blank');
    });
    el.btnRestart.addEventListener('click', () => {
      el.maskDone.classList.remove('show');
      startWalk();
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
        if (!j.ok) { mailHintEl.textContent = '恢复失败：' + (j.error || '未知错误'); return; }
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
          : `验证码：${j.devCode}（未配置邮件服务，仅本机可见，5 分钟内有效）`;
      } catch (e) { el.accCodeHint.textContent = '发送失败：' + (e && e.message ? e.message : e); }
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
      } catch (e) { el.accCodeHint.textContent = '注册失败：' + (e && e.message ? e.message : e); }
    });
    el.btnAccLogin.addEventListener('click', async () => {
      try {
        const j = await accPost('/api/account/login', { email: el.accEmailInput.value.trim(), code: el.accCode.value.trim() });
        if (!j.ok) { el.accCodeHint.textContent = j.error || '登录失败'; return; }
        log(`已登录档案「${j.account.name}」`);
        restartForAccount();
      } catch (e) { el.accCodeHint.textContent = '登录失败：' + (e && e.message ? e.message : e); }
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
        log('⚠ 档案已重置：轨迹与成就清空，出发点回到城市中心');
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
      if (!body.mailSmtpHost || !body.mailUser || (!pass && el.mailPass.placeholder.indexOf('已配置') < 0)) {
        el.mailHint.textContent = '服务器、账号、授权码都要填（端口默认 465）';
        return;
      }
      try {
        const r = await fetch('/api/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (r.ok) {
          el.mailHint.textContent = '已保存 ✓ 存档码自动发邮箱；配了 IMAP 后出发时还会自动从邮箱续存档';
          log('邮件服务已配置：存档码将自动发到邮箱' + (body.mailImapHost ? '，且出发时自动从邮箱续档' : ''));
        } else el.mailHint.textContent = '保存失败';
      } catch (e) { el.mailHint.textContent = '保存失败：' + (e && e.message ? e.message : e); }
    });

    el.btnCloseCfg.addEventListener('click', () => el.maskSettings.classList.remove('show'));
    el.btnBossTest.addEventListener('click', toggleBoss);
    el.btnSaveCfg.addEventListener('click', async () => {
      const og = readOriginConfig();
      const body = {
        amapKey: el.cfgKey.value.trim(),
        amapSecurityJsCode: el.cfgSec.value.trim(),
        city: el.cfgCity.value,
        scope: el.cfgScope.value,
        origin: og.origin,
        originCustom: og.originCustom,
        originName: og.originName,
      };
      // 老板键：下拉里是 "键码|修饰键"
      const bossSel = String(el.cfgBossKey.value || '67|').split('|');
      body.boss = {
        enabled: Boolean(el.cfgBossOn.checked),
        key: Number(bossSel[0]) || 67,
        mods: bossSel[1] || '',
      };
      if (body.amapKey) body.provider = 'amap';
      else body.provider = 'drill';
      await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      el.maskSettings.classList.remove('show');
      log('设置已保存，正在重新加载…');
      setTimeout(() => location.reload(), 600);
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
