/**
 * 高德地图提供者（真实路网）
 * Key 需由使用人在高德开放平台自行申请，本文件不内置任何可用 Key。
 */
(function (global) {
  'use strict';

  const SDK = 'https://webapi.amap.com/maps';

  /**
   * 加载高德 JS API 2.0。
   * 2.0 推荐用 AMap.plugin() 显式加载插件——只靠 URL 的 plugin 参数时，
   * 插件可能还没挂到 AMap 上就被 new 出来，会直接抛错并被上层误判成「Key 不可用」而降级。
   */
  function loadAmap(key, securityJsCode, plugins) {
    return new Promise((resolve, reject) => {
      if (securityJsCode) {
        global._AMapSecurityConfig = { securityJsCode };
      }
      const loadPlugins = (AMap) => {
        if (typeof AMap.plugin !== 'function') return resolve(AMap);
        try {
          AMap.plugin(plugins, () => resolve(AMap));
        } catch (_) {
          resolve(AMap); // 插件加载异常不阻断地图本身
        }
      };
      if (global.AMap) return loadPlugins(global.AMap);
      const s = document.createElement('script');
      s.src = `${SDK}?v=2.0&key=${encodeURIComponent(key)}`;
      s.async = true;
      // 超时兜底：网络被代理/防火墙拦掉时 onerror 不一定触发，会让页面一直「加载中」
      const timer = setTimeout(() => {
        reject(new Error('高德 SDK 加载超时（12 秒）—— 网络可能被代理/防火墙拦截'));
      }, 12000);
      const done = (fn) => { clearTimeout(timer); fn(); };
      s.onload = () => done(() => (global.AMap ? loadPlugins(global.AMap) : reject(new Error('高德 SDK 加载失败（脚本已返回但未挂载 AMap）'))));
      s.onerror = () => done(() => reject(new Error('高德 SDK 加载失败 —— 到不了 webapi.amap.com（网络/代理问题，或 Key 被高德拒绝）')));
      document.head.appendChild(s);
    });
  }

  /** 行进方向箭头需要拿到真实 DOM 节点才能旋转，所以用元素而不是 HTML 字符串 */
  function buildAvatar() {
    const wrap = document.createElement('div');
    wrap.className = 'nw-avatar';
    wrap.innerHTML = '<div class="nw-avatar-glow"></div>'
      + '<div class="nw-avatar-arrow"></div>'
      + '<div class="nw-avatar-dot"></div>';
    return wrap;
  }

  class AmapProvider {
    constructor(opts = {}) {
      this.name = 'amap';
      this.isVirtual = false;
      this.key = opts.key;
      this.securityJsCode = opts.securityJsCode || '';
      this.zoom = opts.zoom || 16;
      this._trackPts = [];
      this._lastRoad = '';
      this._roadAt = 0;
      this._ready = false;
      this._pickHandler = null;
      // 按「额度桶」分别设上限（高德是按服务类型分开计减免额度的）：
      //   route  = 步行路径规划（走路必需，给足）
      //   search = 基础搜索服务（周边/多边形搜索 POI）—— 只有收集册用，给得很紧
      //   geocode= 地理/逆地理编码（路名兜底、地址搜索）
      const q = opts.quota || {};
      this._budgets = {
        route: Math.max(50, Number(q.route) || 2000),
        search: Math.max(0, Number(q.search) || 30),      // 默认很保守：避免再触到月额度
        geocode: Math.max(0, Number(q.geocode) || 200),
      };
      // 月度硬闸：高德提醒/计费是按「月消耗量」，所以除了日上限，再加一道月度上限。
      //   search 默认 800/月（约合高德个人认证减免额度的 1/6，留足余量给别的用途或别的程序）
      //   0 = 不限
      this._monthBudgets = {
        route: Math.max(0, Number(q.routeMonth) || 0),
        search: Math.max(0, Number(q.searchMonth) || 800),
        geocode: Math.max(0, Number(q.geocodeMonth) || 0),
      };
      this._calls = { route: 0, search: 0, geocode: 0 };
      this._monthCalls = { route: 0, search: 0, geocode: 0 };
      this._budgetWarned = false;
      this._monthWarned = { route: false, search: false, geocode: false };
      this._searchFallbackWarned = false;
      this.onBudgetWarning = null;
      this._loadCalls();
      this._loadMonth();
    }

    // ---------- 月度计数（月额度才是被计费的那个，单独记一份） ----------
    _monthKey() {
      const d = new Date();
      return `netwalk-amap-month-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${this._keyTag()}`;
    }

    _loadMonth() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(this._monthKey());
        const s = raw ? JSON.parse(raw) : {};
        this._monthCalls = {
          route: Number(s.route) || 0,
          search: Number(s.search) || 0,
          geocode: Number(s.geocode) || 0,
        };
      } catch (_) { /* 读不到就从零算 */ }
    }

    _saveMonth() {
      try {
        global.localStorage && global.localStorage.setItem(this._monthKey(), JSON.stringify(this._monthCalls));
      } catch (_) { /* 忽略写入失败 */ }
    }

    monthUsed(kind) { return Number(this._monthCalls[kind]) || 0; }

    monthLeft(kind) {
      const b = Number(this._monthBudgets[kind]);
      if (!Number.isFinite(b) || b <= 0) return Infinity;   // 0 = 不限
      return Math.max(0, b - this.monthUsed(kind));
    }

    // ---------- 调用量计数（按天持久化，防止打爆高德免费额度） ----------
    /**
     * Key 指纹：计数必须按 Key 分开存 —— 换了新 Key 却沿用旧 Key 的累计用量，
     * 会让新额度凭空少一大截（用户刚申请的 Key 一上来就被自己的限额挡住）。
     */
    _keyTag() {
      const k = String(this.key || 'none');
      let h = 0;
      for (let i = 0; i < k.length; i++) h = ((h * 31) + k.charCodeAt(i)) >>> 0;
      return h.toString(36).slice(0, 6);
    }

    _callsKey() {
      const d = new Date();
      return `netwalk-amap-calls-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${this._keyTag()}`;
    }

    _loadCalls() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(this._callsKey());
        const s = raw ? JSON.parse(raw) : {};
        this._calls = {
          route: Number(s.route) || 0,
          search: Number(s.search) || 0,
          geocode: Number(s.geocode) || 0,
        };
      } catch (_) { /* 无 localStorage 时从 0 开始 */ }
    }

    _saveCalls() {
      try {
        if (global.localStorage) global.localStorage.setItem(this._callsKey(), JSON.stringify(this._calls));
      } catch (_) { /* 忽略写入失败 */ }
    }

    totalCalls() { return this._calls.route + this._calls.search + this._calls.geocode; }

    /** 某个额度桶还剩多少（route / search / geocode） */
    kindLeft(kind) {
      const b = Number(this._budgets[kind]);
      const used = Number(this._calls[kind]) || 0;
      if (!Number.isFinite(b)) return 0;
      return Math.max(0, b - used);
    }

    budgetLeft() { return this.kindLeft('route') + this.kindLeft('search') + this.kindLeft('geocode'); }

    callStats() {
      const out = { total: this.totalCalls(), budget: this._budgets.route + this._budgets.search + this._budgets.geocode, left: this.budgetLeft() };
      for (const k of ['route', 'search', 'geocode']) {
        out[k] = this._calls[k] || 0;
        out[k + 'Budget'] = this._budgets[k];
        out[k + 'Left'] = this.kindLeft(k);
        out[k + 'Month'] = this.monthUsed(k);
        out[k + 'MonthBudget'] = this._monthBudgets[k];
      }
      return out;
    }

    /** 一句话说明当前调用量（给日志/设置面板用） */
    quotaSummary() {
      const st = this.callStats();
      return `今日 路径 ${st.route}/${st.routeBudget} · 基础搜索 ${st.search}/${st.searchBudget} · 地理编码 ${st.geocode}/${st.geocodeBudget}`
        + `；本月 基础搜索 ${st.searchMonth}${st.searchMonthBudget ? '/' + st.searchMonthBudget : ''}`;
    }

    /** 记一次调用；返回 false 表示这个额度桶（日或月）今天用完了，调用方应跳过真实请求 */
    _charge(kind) {
      const k = (kind === 'route') ? 'route' : (kind === 'search' ? 'search' : 'geocode');
      if (this.kindLeft(k) <= 0) return false;      // 按桶分别限制：搜索用完了不会连累路线规划
      if (this.monthLeft(k) <= 0) {                 // 月度硬闸：到量就彻底停，避免撞高德月度额度
        if (!this._monthWarned[k]) {
          this._monthWarned[k] = true;
          const label = { route: '路径规划', search: '基础搜索', geocode: '地理编码' }[k] || k;
          if (typeof this.onBudgetWarning === 'function') this.onBudgetWarning(this.callStats(), k, 'month');
          else if (typeof console !== 'undefined') console.warn(`[NetWalk] 本月「${label}」调用已达自设上限，已停止该类调用`);
        }
        return false;
      }
      this._calls[k] = (this._calls[k] || 0) + 1;
      this._monthCalls[k] = (this._monthCalls[k] || 0) + 1;
      this._saveCalls();
      this._saveMonth();
      const left = this.kindLeft(k);
      if (!this._budgetWarned && left <= Math.max(3, Math.round(this._budgets[k] * 0.1))) {
        this._budgetWarned = true;
        if (typeof this.onBudgetWarning === 'function') this.onBudgetWarning(this.callStats(), k);
      }
      return true;
    }

    async init(container, opts = {}) {
      const AMap = await loadAmap(this.key, this.securityJsCode, ['AMap.Walking', 'AMap.Geocoder', 'AMap.PlaceSearch']);
      this.AMap = AMap;
      const center = opts.center || { lng: 116.397428, lat: 39.90923 };
      this.map = new AMap.Map(container, {
        zoom: opts.zoom || this.zoom,
        center: [center.lng, center.lat],
        viewMode: '2D',
        mapStyle: 'amap://styles/dark',
        resizeEnable: true,
      });

      // 首帧渲染完成信号：Key 无效 / 缺少安全密钥时这个事件不会触发，
      // 用来把「空白地图」变成一条能看懂的提示
      this._frameReady = false;
      try { this.map.on('complete', () => { this._frameReady = true; }); } catch (_) { /* noop */ }

      this.geocoder = new AMap.Geocoder({ radius: 200, extensions: 'all' });
      this.walking = new AMap.Walking({ autoFitView: false });
      this.placeSearch = new AMap.PlaceSearch({ pageSize: 50, extensions: 'all', autoFitView: false });

      // 主地图轨迹按速度分色（与轨迹弹窗/日报同一套配色）：
      // ⚠ 不能用"每个速度档一条累计 Polyline"——同档 Polyline 会把它持有的所有点
      // 按顺序连起来，两段不相邻的轨迹（换设备/换会话/跳变）就会被一条直线连上，
      // 这就是"直线飞线"的真正来源（数据再干净也拦不住，因为它发生在绘制层）。
      // 现改为"笔迹"模型：连续的同色相邻点共用一条 Polyline（一条 run），
      // 遇到断笔（换会话/跳变/断档/直线剔除）就换新 Polyline，段与段之间绝不相连。
      //
      // ⚠⚠ 核心原则（v0.9.56）：**任何情况下都不允许为了性能删掉用户走过的轨迹**。
      // 旧实现有个 FIFO 上限（超 2400 就 splice 掉最老的 600 条），历史重放时会
      // 把「第 N 次出发之前」的轨迹成批删掉 —— 那是数据渲染层的静默丢失，绝不可取。
      // 现在的做法是「先省着画，再按需分层」：
      //   ① 颜色合并 + 换色抽稀   → 同样里程产生的笔迹数少一个数量级（见 _runTolKm）
      //   ② 日期分层 + 视口裁剪   → 地图上只保留「当前可见区域」的笔迹，总量恒定
      //   ③ 上限只作安全网，且触发时**优先卸载离视口最远/最老的层**并登记待回填，
      //      绝不静默丢弃；`unloadedRuns` 记着被卸载了哪些，回到视野会自动补画。
      this._speedColors = speedGradientPalette();
      this._colorLevels = this._speedColors.length;   // 档数（可由 setColorLevels 调低）
      this._runs = [];       // 所有**当前已挂到地图上**的笔迹
      this._curRun = {};     // 速度档 → 当前笔迹
      this._trackPts = [];
      // 笔迹的来源信息（与 _runs 一一对应）：用于分层卸载 / 回填
      // { line, day, anchor:{lat,lng}, color }
      this._runMeta = [];
      // 被卸载（离开视口或超安全网）的笔迹记录，回填时按 day 聚合重画
      this._unloaded = new Map();   // day -> [segPoints...]
      this._segCache = new Map();   // day -> segments（原始切段，避免反复重算）
      this._activeDays = null;      // null = 全画；数组 = 只画这些天
      this._safetyCap = 6000;       // 安全网：正常永远碰不到（分层后总量恒定）
      this._droppedStatic = 0;      // 因安全网卸载的笔迹数（非删除，可回填）
      this._dayOfRun = [];          // 与 _runs 对齐的日期
      this._runTolKm = 0.10;        // 默认换色抽稀 100m（A 方案，把笔迹数压一个数量级）

      this._avatarEl = buildAvatar();
      this._arrowEl = this._avatarEl.querySelector('.nw-avatar-arrow');
      this.marker = new AMap.Marker({
        position: [center.lng, center.lat],
        content: this._avatarEl,
        anchor: 'center',
        zIndex: 300,
      });
      this.map.add(this.marker);
      this._follow = true;
      this._ready = true;
      return this;
    }

    /**
     * 等待高德地图首帧渲染完成。
     * 返回 false 说明 SDK 起来了但地图没能出图 —— 通常是 Key 未开启
     * 「Web端(JS API)」服务，或控制台要求安全密钥而配置里没填。
     */
    waitFirstFrame(timeoutMs = 8000) {
      if (this._frameReady) return Promise.resolve(true);
      if (!this._ready || !this.map) return Promise.resolve(false);
      return new Promise((resolve) => {
        const t0 = Date.now();
        const timer = setInterval(() => {
          if (this._frameReady) { clearInterval(timer); resolve(true); }
          else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); resolve(false); }
        }, 200);
        if (timer.unref) timer.unref();
      });
    }

    setFollow(on) { this._follow = Boolean(on); }

    moveTo(lat, lng, bearing) {
      if (!this._ready) return;
      const pos = new this.AMap.LngLat(lng, lat);
      this.marker.setPosition(pos);
      if (this._follow) this.map.setCenter(pos);
      // 箭头旋转：直接用我们持有的元素引用，不依赖 marker.getContent()
      if (this._arrowEl) this._arrowEl.style.transform = `rotate(${(bearing || 0).toFixed(1)}deg)`;
    }

    speedColorIndex(spd) {
      const t = Math.max(0, Math.min(0.999, (Number(spd) || 0) / 16));
      const lv = this._colorLevels || 10;
      return Math.floor(t * lv);
    }

    /**
     * 调低速度着色档数（A 方案的"颜色合并"）：10 档 → 5 档，笔迹数直接减半。
     * 档数越少笔迹越省，但速度的视觉区分越粗；5 档在实际观感上几乎无损。
     */
    setColorLevels(n) {
      const lv = Math.max(3, Math.min(10, Math.round(Number(n) || 10)));
      if (lv === this._colorLevels) return;
      this._colorLevels = lv;
      this._curRun = {};   // 档数变了，旧的档位索引失效，下一笔重开
    }

    /**
     * 设置"换色抽稀"容差（km）：换速度档时，若离当前笔迹的锚点位移小于该值，
     * **不新起一笔**，继续沿用当前 Polyline。
     *
     * 原理：笔迹数主要由"换档频率"决定，而不是点数。走路的瞬时速度抖动很频繁，
     * 若每换一次档就 new 一条 Polyline，一天能产生上千条（每条都是独立地图对象）；
     * 而同一段路上 100m 内的速度差异肉眼根本分不出来 —— 用它换一个数量级的对象数，
     * 非常划算。设为 0 表示关闭抽稀（回到逐档切笔）。
     */
    setRunTolerance(km) {
      this._runTolKm = Math.max(0, Number(km) || 0);
    }

    /** 计算两个点之间的近似距离（km），仅用于抽稀判定 */
    _distKm(a, b) {
      const R = 6371, toR = Math.PI / 180;
      const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    }

    /**
     * 卸载一笔（从地图上移除，但把它的来源记进 _unloaded 以便回填）。
     * ⚠ 与旧实现的本质区别：旧代码 splice 掉就再也回不来了（不可逆）；
     * 这里是**可逆卸载** —— 只要用户再看回那个区域/那一天，笔迹会重新画出来。
     */
    _unloadRun(i, reason) {
      const line = this._runs[i];
      const meta = this._runMeta[i];
      if (line) { try { this.map.remove(line); } catch (_) { /* noop */ } }
      if (meta) {
        const key = meta.day || '未知日期';
        if (!this._unloaded.has(key)) this._unloaded.set(key, []);
        this._unloaded.get(key).push(meta.pts || null);
        meta.unloaded = reason;
      }
      this._runs.splice(i, 1);
      this._runMeta.splice(i, 1);
      this._dayOfRun.splice(i, 1);
      this._curRun = {};
    }

    /**
     * 安全网：万一笔迹数真的超过上限（正常分层后不可能发生），
     * **优先卸载离地图中心最远、且最老的笔迹**，并登记待回填。
     * 绝不静默丢弃 —— `droppedUnloaded()` 能报出卸载了多少条、涉及哪些天。
     */
    _enforceCap(center) {
      const cap = this._safetyCap;
      if (!cap || this._runs.length <= cap) return;
      const excess = this._runs.length - cap;
      // 距离中心越远越先卸载（同距离时越老越先卸载）
      const scored = this._runMeta.map((m, i) => {
        const a = m && m.anchor ? m.anchor : null;
        const d = a && center ? this._distKm(a, center) : 9999;
        return { i, d, t: (m && m.t) || 0 };
      }).sort((x, y) => (y.d - x.d) || (x.t - y.t));
      // 从后往前删，避免下标错位
      const victims = scored.slice(0, excess).map((x) => x.i).sort((a, b) => b - a);
      for (const i of victims) { this._unloadRun(i, 'cap'); this._droppedStatic++; }
    }

    /** 自检：当前挂在地图上的笔迹 / 被卸载待回填的笔迹 / 因安全网卸载过多少次 */
    runStats() {
      let pending = 0;
      for (const arr of this._unloaded.values()) pending += arr.length;
      return {
        onMap: this._runs.length,
        unloadedPending: pending,
        capUnloaded: this._droppedStatic,
        colorLevels: this._colorLevels || 10,
        tolKm: this._runTolKm || 0,
        safetyCap: this._safetyCap,
        neverDropped: this._droppedStatic === 0 || pending > 0,  // 关键不变式：卸载的一定可回填
      };
    }

    addTrackPoint(lat, lng, prev, spd, day) {
      if (!this._ready) return;
      const cur = new this.AMap.LngLat(lng, lat);
      const li = this.speedColorIndex(spd);
      if (prev) {
        // 关键不变式：一条笔迹（Polyline）里只允许「原始点序上相邻」的线段。
        // 判据：该笔迹的末点必须恰好等于本段起点（prev）；不等就另起一笔。
        // 同一颜色的连续段继续追加（折线对象最少、渲染最稳），绝不连飞线。
        const seg = [new this.AMap.LngLat(prev.lng, prev.lat), cur];
        let line = this._curRun[li];
        let lastPt = null;
        if (line) {
          const path = line.getPath();
          lastPt = path.length ? path[path.length - 1] : null;
        }
        const connected = lastPt && Math.abs(lastPt.lng - prev.lng) < 1e-9 && Math.abs(lastPt.lat - prev.lat) < 1e-9;
        if (!connected) {
          // ① 抽稀：换色时若离锚点位移很小，说明还在同一段路上，继续沿用当前笔迹。
          //    遍历所有档位找"锚点附近、且末点接得上"的笔迹来复用（通常是刚画过的那条）。
          if (this._runTolKm > 0) {
            for (const k of Object.keys(this._curRun)) {
              const cand = this._curRun[k];
              if (!cand) continue;
              const p2 = cand.getPath();
              const lp = p2.length ? p2[p2.length - 1] : null;
              if (!lp) continue;
              if (Math.abs(lp.lng - prev.lng) > 1e-9 || Math.abs(lp.lat - prev.lat) > 1e-9) continue;
              const m0 = cand.__nwAnchor || { lat: prev.lat, lng: prev.lng };
              if (this._distKm(m0, { lat, lng }) > this._runTolKm) continue;
              cand.setPath(p2.concat(seg));
              this._lastSpd = spd;
              this._trackPts.push(cur);
              if (this._trackPts.length > 5000) this._trackPts = this._trackPts.slice(-4000);
              return;
            }
          }
          // 直接用本段初始化：先给空 path 再 setPath 会让 AMap 每一帧都报 "error Polyline path"
          line = new this.AMap.Polyline({
            path: seg,
            strokeColor: this._speedColors[Math.min(li, this._speedColors.length - 1)],
            strokeWeight: 4,
            strokeOpacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round',
          });
          line.__nwAnchor = { lat, lng };   // 抽稀锚点
          this.map.add(line);
          this._runs.push(line);
          this._runMeta.push({ line, anchor: { lat, lng }, t: Date.now(), pts: null });
          this._curRun[li] = line;
          // ② 安全网：正常分层后碰不到；真触发也只做"可回填卸载"，不丢轨迹。
          this._enforceCap(this.map.getCenter && this.map.getCenter());
        } else {
          line.setPath(line.getPath().concat(seg));
        }
      }
      this._lastSpd = spd;
      this._trackPts.push(cur);
      if (this._trackPts.length > 5000) this._trackPts = this._trackPts.slice(-4000);
    }

    /**
     * 画一段轨迹。
     * @param {Array} points 轨迹点（按时间顺序）
     * @param {Object} opts
     *   - append: 是否追加（不先清空）
     *   - day:    这段轨迹属于哪一天（用于日期分层卸载/回填）
     *
     * ⚠ 这里**不再有"画不下就删最老"的逻辑**：笔迹的对象数由抽稀（setRunTolerance）
     * 与颜色合并（setColorLevels）压到很低，再配合日期分层，正常永远够用。
     * 真到安全网也只做"可回填卸载"。
     */
    setTrack(points, { append = false, day = null, keepPending = false } = {}) {
      if (!this._ready) return;
      if (!append) {
        this.clearStartMarkers();
        // 清空轨迹：移除全部笔迹（并清掉回填登记，避免串台）
        this._runs.forEach((l) => { try { this.map.remove(l); } catch (_) { /* noop */ } });
        this._runs = [];
        this._runMeta = [];
        this._dayOfRun = [];
        // ⚠ 只有"用户主动重画全部"才清空待回填登记；回填自己调用时必须保留
        // （keepPending=true），否则 _replayDay 的第一段就会把登记清掉，导致其余天永远回不来。
        if (!keepPending) this._unloaded.clear();
        this._trackPts = [];
        this._lastSpd = null;
      } else {
        // 追加新的一段：先"断笔"——关闭当前所有笔迹，
        // 下一段从新 Polyline 开始，绝不从上一段的末点连一条直线过来（飞线根源）
        this._curRun = {};
      }
      this._curDay = day;
      for (let i = 1; i < points.length; i++) {
        this.addTrackPoint(points[i].lat, points[i].lng, points[i - 1], points[i].spd, day);
      }
      // 标记这一段里新建的笔迹属于哪一天（供分层卸载/回填）
      for (let i = 0; i < this._runMeta.length; i++) {
        if (!this._runMeta[i].day) this._runMeta[i].day = day;
      }
    }

    /**
     * 兼容旧调用：原来的"历史重放模式"用于临时放宽 FIFO 上限，
     * 现在已无上限淘汰（改为可回填卸载），这两个方法保留为空操作以免调用点报错。
     */
    beginReplay() { /* v0.9.56 起：不再需要放宽上限，保留空实现兼容旧调用 */ }
    endReplay() { this._replaying = false; }

    /**
     * 【C 方案】日期分层：只保留指定日期集合的笔迹挂在地图上，其余卸载（可回填）。
     *
     * 为什么这是"永不删轨迹"的关键：笔迹总量只取决于**同时展示的天数**，
     * 与历史总长度无关 —— 走一年和走三天，地图上的对象数一样多。
     * 因此不需要（也不允许）为了省性能而永久丢弃历史。
     *
     * @param {Set<string>|Array<string>|null} days 要保留的日期；null/空 = 全部保留
     * @param {Object} segCache day -> segments（重新挂载时用它回填）
     */
    applyDayFilter(days, segCache) {
      if (!this._ready) return { kept: this._runs.length, unloaded: 0 };
      const keep = days ? new Set(Array.from(days)) : null;
      if (!keep || !keep.size) { this._activeDays = null; return this.restoreAll(segCache); }
      this._activeDays = keep;
      this._segCache = this._isMap(segCache) ? segCache : this._segCache;
      let unloaded = 0;
      // 从后往前卸载不在日期集合里的笔迹
      for (let i = this._runs.length - 1; i >= 0; i--) {
        const d = this._runMeta[i] ? this._runMeta[i].day : null;
        if (d && !keep.has(d)) { this._unloadRun(i, 'layer'); unloaded++; }
      }
      return { kept: this._runs.length, unloaded, total: this._runs.length + unloaded };
    }

    /**
     * 判断是否"像 Map"：不依赖 instanceof（跨 realm / jsdom / iframe 下
     * instanceof Map 会失败，导致缓存被判为无效、回填全空）。
     */
    _isMap(x) {
      return !!x && typeof x.get === 'function' && typeof x.has === 'function' && typeof x.keys === 'function';
    }

    /** 取消日期过滤，把之前卸载过的天全部回填重画 */
    restoreAll(segCache) {
      if (!this._ready) return { restored: 0 };
      if (this._isMap(segCache)) this._segCache = segCache;
      const pending = Array.from(this._unloaded.keys());   // 先快照：回填过程中 _unloaded 会变动
      this._activeDays = null;
      let restored = 0;
      for (const day of pending) {
        const segs = this._segCache && this._segCache.get ? this._segCache.get(day) : null;
        if (!segs || !segs.length) continue;
        // 该天已经有笔迹在图上就跳过（避免重复画）
        const has = this._runMeta.some((m) => m && m.day === day);
        if (has) { this._unloaded.delete(day); continue; }
        this._replayDay(day, segs);
        this._unloaded.delete(day);
        restored++;
      }
      return { restored };
    }

    /**
     * 把某一天的 segments 重新画出来（回填）。
     * ⚠ 一律用 append=true：回填是"往现有地图上补画"，绝不能用 append=false
     * （那会清空整张地图的笔迹，把先前回填好的天又抹掉）。
     * keepPending=true 是为了不清空"待回填登记"。
     */
    _replayDay(day, segs) {
      let n = 0;
      for (const seg of segs) {
        this.setTrack(seg, { append: true, day, keepPending: true });
        n++;
      }
      return n;
    }

    /** 补画某些天（用于日期切换 / 视口回填） */
    restoreDays(days, segCache) {
      if (!this._ready) return 0;
      if (this._isMap(segCache)) this._segCache = segCache;
      let n = 0;
      for (const day of days) {
        const segs = this._segCache && this._segCache.get ? this._segCache.get(day) : null;
        if (!segs || !segs.length) continue;
        // 该天已经有笔迹在图上就跳过
        const has = this._runMeta.some((m) => m && m.day === day);
        if (has) continue;
        this._replayDay(day, segs);
        this._unloaded.delete(day);
        n++;
      }
      return n;
    }

    /**
     * 【C 方案】视口裁剪：把"已经在图上、但完全离开当前可视范围"的笔迹卸载掉。
     * 注意这是**可逆**的 —— 平移回来时由 restoreDays / restoreAll 补画。
     * 只卸载"整条笔迹的所有点都在视口外"的，避免把穿过视口的线切碎。
     */
    cullOutsideViewport(marginRatio = 0.25) {
      if (!this._ready) return { culled: 0 };
      let b = null;
      try { b = this.map.getBounds(); } catch (_) { return { culled: 0 }; }
      if (!b) return { culled: 0 };
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      const dLat = (ne.lat - sw.lat) * marginRatio, dLng = (ne.lng - sw.lng) * marginRatio;
      const minLat = sw.lat - dLat, maxLat = ne.lat + dLat;
      const minLng = sw.lng - dLng, maxLng = ne.lng + dLng;
      let culled = 0;
      for (let i = this._runs.length - 1; i >= 0; i--) {
        const line = this._runs[i];
        if (!line || typeof line.getPath !== 'function') continue;
        let path = [];
        try { path = line.getPath() || []; } catch (_) { continue; }
        if (!path.length) continue;
        let inside = false;
        for (const p of path) {
          const la = p.lat !== undefined ? p.lat : p.getLat && p.getLat();
          const ln = p.lng !== undefined ? p.lng : p.getLng && p.getLng();
          if (la >= minLat && la <= maxLat && ln >= minLng && ln <= maxLng) { inside = true; break; }
        }
        if (!inside) { this._unloadRun(i, 'viewport'); culled++; }
      }
      return { culled };
    }

    /** 点亮一个街区块（约 150m 网格） */
    lightCell(lat, lng) {
      if (!this._ready) return;
      if (!this._litLayer) {
        // OverlayGroup 在 2.0 里可用；万一没有就退回直接挂到地图上
        this._litLayer = (typeof this.AMap.OverlayGroup === 'function')
          ? new this.AMap.OverlayGroup()
          : this.map;
        if (this._litLayer !== this.map) this.map.add(this._litLayer);
      }
      if (this._litCount >= 2500) return;
      this._litCount = (this._litCount || 0) + 1;
      const c = new this.AMap.Circle({
        center: new this.AMap.LngLat(lng, lat),
        radius: 78,
        strokeColor: '#4aa8ff',
        strokeOpacity: 0.22,
        strokeWeight: 1,
        fillColor: '#4aa8ff',
        fillOpacity: 0.13,
        bubble: false,
        zIndex: 10,
      });
      if (this._litLayer === this.map) this.map.add(c);
      else this._litLayer.addOverlay(c);
    }

    /** 步行路径规划；失败返回 null，由引擎重新掷点 */
    planRoute(from, to) {
      return new Promise((resolve) => {
        if (!this._ready) return resolve(null);
        if (!this._charge('route')) return resolve(null);   // 已达今日软上限，交给引擎直线兜底
        const origin = new this.AMap.LngLat(from.lng, from.lat);
        const dest = new this.AMap.LngLat(to.lng, to.lat);
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const timer = setTimeout(() => finish(null), 8000);
        try {
          this.walking.search(origin, dest, (status, result) => {
            clearTimeout(timer);
            if (status !== 'complete' || !result || !result.routes || !result.routes.length) {
              return finish(null);
            }
            const route = result.routes[0];
            const pts = [];
            const steps = [];
            for (const st of (route.steps || [])) {
              for (const p of (st.path || [])) pts.push({ lng: p.lng, lat: p.lat });
              // 关键：没有路名的步骤也必须计入 steps！
              // 以前直接跳过，导致 steps 的累计里程与折线几何错位 ——
              // 分身走在 A 路上，界面却显示 B 路（"走的路显示不对"的根因）。
              // 没有路名的步骤（高架引道 / 匝道 / 连接线）用空字符串占位，
              // 引擎遇到空路名会沿用上一个路名显示。
              const road = st.road || '';
              const last = steps[steps.length - 1];
              if (last && last.road === road) last.distance += st.distance || 0;
              else steps.push({ road, distance: st.distance || 0 });
            }
            if (pts.length < 2) return finish(null);
            finish({ points: pts, steps, distance: route.distance || 0 });
          });
        } catch (err) {
          clearTimeout(timer);
          finish(null);
        }
      });
    }

    /** 逆地理编码取路名（带 5 秒节流，避免频繁请求） */
    roadAt(lat, lng, { force = false } = {}) {
      const now = Date.now();
      if (!force && now - this._roadAt < 5000 && this._lastRoad) {
        return Promise.resolve(this._lastRoad);
      }
      // 同一片 ~55 米网格 20 分钟内不重复逆地理（逆地理编码有额度，来回走别重复烧）
      const gk = `${Math.round(Number(lat) * 2000)}_${Math.round(Number(lng) * 2000)}`;
      if (!force && this._roadCache && this._roadCache.has(gk)) {
        const hit = this._roadCache.get(gk);
        if (now - hit.t < 20 * 60 * 1000) {
          this._lastRoad = hit.road || this._lastRoad;
          return Promise.resolve(this._lastRoad);
        }
      }
      this._roadAt = now;
      return new Promise((resolve) => {
        if (!this._ready) return resolve(this._lastRoad || '');
        if (!this._charge('geocode')) return resolve(this._lastRoad || '');
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        setTimeout(() => finish(this._lastRoad || ''), 6000);
        try {
          this.geocoder.getAddress([lng, lat], (status, result) => {
            if (status !== 'complete' || !result || !result.regeocode) return finish(this._lastRoad || '');
            const ac = result.regeocode.addressComponent || {};
            const road = (ac.streetNumber && ac.streetNumber.street)
              || (result.regeocode.roads && result.regeocode.roads[0] && result.regeocode.roads[0].name)
              || ac.township || '';
            this._lastRoad = road || this._lastRoad;
            if (road) {
              if (!this._roadCache) this._roadCache = new Map();
              if (this._roadCache.size > 600) this._roadCache.clear();
              this._roadCache.set(gk, { road, t: Date.now() });
            }
            finish(this._lastRoad || '');
          });
        } catch (err) {
          finish(this._lastRoad || '');
        }
      });
    }

    /**
     * 备用通道：用「逆地理编码」取附近 POI（走的是另一个额度桶）。
     * 基础搜索服务额度用完时，收集册自动降级用它 —— 至少不至于完全采不到。
     */
    nearbyPlacesViaGeocode(pos) {
      return new Promise((resolve) => {
        if (!this._ready || !this.geocoder) return resolve([]);
        if (!this._charge('geocode')) return resolve([]);
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const timer = setTimeout(() => finish([]), 8000);
        try {
          this.geocoder.getAddress([pos.lng, pos.lat], (status, result) => {
            clearTimeout(timer);
            if (status !== 'complete' || !result || !result.regeocode) return finish([]);
            finish(result.regeocode.pois || []);
          });
        } catch (err) { clearTimeout(timer); finish([]); }
      });
    }

    /** 取附近的正式场所 POI（基础搜索服务）。额度用完就停，**不自动改烧其他额度桶** */
    async nearbyPlaces(pos) {
      if (!this._ready || !this.placeSearch) return [];
      if (this.kindLeft('search') <= 0 || this.monthLeft('search') <= 0) {
        // 以前这里会自动降级去调「逆地理编码」——额度是省不下来的，只是换了个桶继续烧，
        // 而且用户完全看不见。现在直接停，并只提示一次。
        if (!this._searchFallbackWarned) {
          this._searchFallbackWarned = true;
          if (typeof this.onBudgetWarning === 'function') this.onBudgetWarning(this.callStats(), 'search', 'stop');
        }
        return [];
      }
      return new Promise((resolve) => {
        if (!this._charge('search')) return resolve([]);
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const timer = setTimeout(() => finish([]), 8000);
        try {
          const c = new this.AMap.LngLat(pos.lng, pos.lat);
          this.placeSearch.searchNearBy('', c, 100, (status, result) => {
            clearTimeout(timer);
            if (status !== 'complete' || !result || !result.poiList || !result.poiList.pois) return finish([]);
            finish(result.poiList.pois);
          });
        } catch (err) { clearTimeout(timer); finish([]); }
      });
    }

    /** 按类型 + 范围搜索正式场所（区域补采用，一次返回一批） */
    searchFormalInBounds(bounds, type) {
      return new Promise((resolve) => {
        if (!this._ready || !this.placeSearch) return resolve([]);
        if (!this._charge('search')) return resolve([]);   // 补采也是基础搜索服务，受同一额度限制
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const timer = setTimeout(() => finish([]), 10000);
        try {
          this.placeSearch.setType(type);
          this.placeSearch.searchInBounds('', bounds, (status, result) => {
            clearTimeout(timer);
            if (status !== 'complete' || !result || !result.poiList || !result.poiList.pois) return finish([]);
            finish(result.poiList.pois);
          });
        } catch (err) { clearTimeout(timer); finish([]); }
      });
    }

    /** 单次地理编码（内部用）：严格用 2 参数调用，与早期可用写法保持一致 */
    _geocodeOnce(text, timeoutMs) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
        const timer = setTimeout(() => finish({ error: '__TIMEOUT__' }), timeoutMs);
        try {
          this.geocoder.getLocation(text, (status, result) => {
            const info = result && result.info ? String(result.info) : '';
            if (status !== 'complete' || !result || !result.geocodes || !result.geocodes.length) {
              return finish({ error: info ? `高德返回「${info}」` : '没有找到这个地点' });
            }
            const g = result.geocodes[0];
            const loc = g.location;
            if (!loc) return finish({ error: '地址解析结果缺少坐标' });
            finish({
              lat: Number(typeof loc.getLat === 'function' ? loc.getLat() : loc.lat),
              lng: Number(typeof loc.getLng === 'function' ? loc.getLng() : loc.lng),
              name: g.formattedAddress || text,
            });
          });
        } catch (err) {
          finish({ error: (err && err.message) || '地址解析失败' });
        }
      });
    }

    /**
     * 地址 / 地点名 → 经纬度（供「选择出发点」的地址搜索使用）
     * 超时放宽到 15 秒并自动重试一次；失败时带出高德返回的真实原因。
     */
    async lookupAddress(address) {
      const text = String(address || '').trim();
      if (!text) return { error: '请输入地址或地点名' };
      if (!this._ready) return { error: '地图尚未就绪，请稍后再试' };

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (!this._charge('geocode')) return { error: '已达今日高德调用上限，明天再试或直接在地图上点选' };
        const r = await this._geocodeOnce(text, 15000);
        if (r.error !== '__TIMEOUT__') return r;   // 有明确结果（成功或报错）立即返回
        if (attempt === 2) {
          return {
            error: '地址解析超时（已重试一次）。常见原因：① 安全密钥不对或你的 Key 没开「静态安全密钥」——可在设置里点「清除安全密钥」再试；② 网络较慢。也可以直接点「在地图上点选」',
          };
        }
      }
      return { error: '地址解析失败' };
    }

    /** 进入「点地图选点」模式 */
    enablePick(cb) {
      if (!this._ready) return false;
      this.disablePick();
      this._pickHandler = (ev) => {
        const ll = ev && (ev.lnglat || ev.lngLat);
        if (!ll) return;
        const lat = typeof ll.getLat === 'function' ? ll.getLat() : ll.lat;
        const lng = typeof ll.getLng === 'function' ? ll.getLng() : ll.lng;
        if (Number.isFinite(lat) && Number.isFinite(lng)) cb(lat, lng);
      };
      try { this.map.on('click', this._pickHandler); } catch (_) { return false; }
      try { this.map.setDefaultCursor('crosshair'); } catch (_) { /* 可选 API */ }
      return true;
    }

    disablePick() {
      if (this.map && this._pickHandler) {
        try { this.map.off('click', this._pickHandler); } catch (_) { /* noop */ }
      }
      try { if (this.map) this.map.setDefaultCursor(''); } catch (_) { /* noop */ }
      this._pickHandler = null;
    }

    fit() {
      if (!this._ready || !this._trackPts.length) return;
      this.map.setFitView(this._runs, false, [60, 60, 60, 60], 17);
    }

    /** 每次出发点：紫色小点 + 序号数字（第 N 次出发） */
    addStartMarker(lat, lng, n) {
      if (!this._ready) return;
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:22px;height:22px;transform:translate(-50%,-50%)';
      el.innerHTML = '<div style="position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;'
        + 'border-radius:50%;background:#a06bff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>'
        + '<div style="position:absolute;left:50%;top:-8px;transform:translateX(-50%);font-size:10px;font-weight:700;'
        + 'color:#fff;background:rgba(120,70,220,.92);padding:0 4px;border-radius:7px;line-height:13px;white-space:nowrap">' + n + '</div>';
      const m = new this.AMap.Marker({
        position: new this.AMap.LngLat(lng, lat),
        content: el,
        anchor: 'center',
        zIndex: 260,
      });
      this.map.add(m);
      (this._startMarkers = this._startMarkers || []).push(m);
    }

    clearStartMarkers() {
      for (const m of (this._startMarkers || [])) { try { this.map.remove(m); } catch (_) { /* noop */ } }
      this._startMarkers = [];
    }

    destroy() {
      this.disablePick();
      try { if (this.map) this.map.destroy(); } catch (_) { /* noop */ }
      this._ready = false;
      this._frameReady = false;
      this._avatarEl = null;
      this._arrowEl = null;
      this._litLayer = null;
      this._trackPts = [];
    }
  }

  global.AmapProvider = AmapProvider;
})(window);

/** 速度渐变 10 档调色板：浅黄 → 橙 → 深红（与弹窗/日报同一套插值） */
function speedGradientPalette() {  const mix = (x, y, k) => Math.round(x + (y - x) * k);
  const colors = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    let r, g, b;
    if (t < 0.5) { const k = t / 0.5; r = mix(255, 255, k); g = mix(233, 130, k); b = mix(120, 60, k); }
    else { const k = (t - 0.5) / 0.5; r = mix(255, 224, k); g = mix(130, 32, k); b = mix(60, 32, k); }
    colors.push('rgb(' + r + ',' + g + ',' + b + ')');
  }
  return colors;
}
