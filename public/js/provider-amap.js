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
      return `netwalk-amap-month-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    _callsKey() {
      const d = new Date();
      return `netwalk-amap-calls-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      this._speedColors = speedGradientPalette();
      this._runs = [];       // 所有已创建的笔迹（清空轨迹时统一移除）
      this._curRun = {};     // 速度档 → 当前笔迹
      this._trackPts = [];

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
      return Math.floor(t * 10);
    }

    addTrackPoint(lat, lng, prev, spd) {
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
          // 直接用本段初始化：先给空 path 再 setPath 会让 AMap 每一帧都报 "error Polyline path"
          line = new this.AMap.Polyline({
            path: seg,
            strokeColor: this._speedColors[li],
            strokeWeight: 4,
            strokeOpacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round',
          });
          this.map.add(line);
          this._runs.push(line);
          this._curRun[li] = line;
          // 笔迹太多会拖垮渲染：超过上限就把最老的段整段移除
          if (this._runs.length > 2400) {
            const dropped = this._runs.splice(0, 600);
            for (const old of dropped) { try { this.map.remove(old); } catch (_) { /* noop */ } }
            // ⚠ 必须清掉指向已移除笔迹的引用：否则后续的点会追加进一条已经不在地图上的线里，
            // 表现为"长距离漫游到一定长度后轨迹突然断掉/消失"
            this._curRun = {};
          }
        } else {
          line.setPath(line.getPath().concat(seg));
        }
      }
      this._lastSpd = spd;
      this._trackPts.push(cur);
      if (this._trackPts.length > 5000) this._trackPts = this._trackPts.slice(-4000);
    }

    setTrack(points, { append = false } = {}) {
      if (!this._ready) return;
      if (!append) {
        this.clearStartMarkers();
        // 清空轨迹：移除全部笔迹
        this._runs.forEach((l) => { try { this.map.remove(l); } catch (_) { /* noop */ } });
        this._runs = [];
        this._trackPts = [];
        this._lastSpd = null;
      } else {
        // 追加新的一段：先"断笔"——关闭当前所有笔迹，
        // 下一段从新 Polyline 开始，绝不从上一段的末点连一条直线过来（飞线根源）
        this._curRun = {};
      }
      for (let i = 1; i < points.length; i++) {
        this.addTrackPoint(points[i].lat, points[i].lng, points[i - 1], points[i].spd, points[i].road);
      }
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
