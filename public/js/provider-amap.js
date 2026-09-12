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
      s.onload = () => (global.AMap ? loadPlugins(global.AMap) : reject(new Error('高德 SDK 加载失败')));
      s.onerror = () => reject(new Error('高德 SDK 加载失败，请检查网络或 Key 配置'));
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
      // 每日调用软上限：个人认证开发者日配额 5000，留出余量
      this._budget = Math.max(100, Number(opts.maxCallsPerDay) || 4000);
      this._calls = { route: 0, geocode: 0 };
      this._budgetWarned = false;
      this.onBudgetWarning = null;
      this._loadCalls();
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
        this._calls = { route: Number(s.route) || 0, geocode: Number(s.geocode) || 0 };
      } catch (_) { /* 无 localStorage 时从 0 开始 */ }
    }

    _saveCalls() {
      try {
        if (global.localStorage) global.localStorage.setItem(this._callsKey(), JSON.stringify(this._calls));
      } catch (_) { /* 忽略写入失败 */ }
    }

    totalCalls() { return this._calls.route + this._calls.geocode; }
    budgetLeft() { return Math.max(0, this._budget - this.totalCalls()); }

    callStats() {
      return {
        route: this._calls.route, geocode: this._calls.geocode,
        total: this.totalCalls(), budget: this._budget, left: this.budgetLeft(),
      };
    }

    /** 记一次调用；返回 false 表示已达今日软上限，调用方应跳过真实请求 */
    _charge(kind) {
      if (this.budgetLeft() <= 0) return false;
      this._calls[kind] = (this._calls[kind] || 0) + 1;
      this._saveCalls();
      if (!this._budgetWarned && this.budgetLeft() <= this._budget * 0.1) {
        this._budgetWarned = true;
        if (typeof this.onBudgetWarning === 'function') this.onBudgetWarning(this.callStats());
      }
      return true;
    }

    async init(container, opts = {}) {
      const AMap = await loadAmap(this.key, this.securityJsCode, ['AMap.Walking', 'AMap.Geocoder']);
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

      this.geocoder = new AMap.Geocoder({ radius: 200 });
      this.walking = new AMap.Walking({ autoFitView: false });

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
        // 每段按速度独立上色：段 = [上一点, 当前点]，交界处两点重叠补缝。
        // 线段写进「当前笔迹」——同一笔迹内的相邻点才相连。
        const plo = this.speedColorIndex(this._lastSpd != null ? this._lastSpd : spd);
        // ⚠ 速度档变化必须"提笔"（关闭全部当前笔迹再画边界段）：
        // 否则速度回到旧档时，线段会追加进旧档那条笔迹的末尾，
        // 把相距很远的两部分连进同一条线 —— 飞线的第二个来源（与换会话无关，纯速度波动就会触发）。
        if (plo !== li) this._curRun = {};
        const seg = [new this.AMap.LngLat(prev.lng, prev.lat), cur];
        for (let k = Math.min(plo, li); k <= Math.max(plo, li); k++) {
          let line = this._curRun[k];
          if (!line) {
            line = new this.AMap.Polyline({
              path: [],
              strokeColor: this._speedColors[k],
              strokeWeight: 4,
              strokeOpacity: 0.9,
              lineJoin: 'round',
              lineCap: 'round',
            });
            this.map.add(line);
            this._runs.push(line);
            this._curRun[k] = line;
          }
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
        this.addTrackPoint(points[i].lat, points[i].lng, points[i - 1], points[i].spd);
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
            finish(this._lastRoad || '');
          });
        } catch (err) {
          finish(this._lastRoad || '');
        }
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
function speedGradientPalette() {
  const mix = (x, y, k) => Math.round(x + (y - x) * k);
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
