/**
 * 演练模式地图提供者
 * 说明：使用程序化生成的虚构城市路网，不依赖任何外部地图服务，
 *      用于未配置高德 Key 时完整体验玩法。路名均为虚构。
 */
(function (global) {
  'use strict';

  const M_PER_DEG_LAT = 111320;
  const EW_NAMES = ['长江', '黄河', '人民', '复兴', '建设', '解放', '中山', '和平', '新华', '胜利',
    '光明', '幸福', '友谊', '环城', '滨江', '科技', '创新', '文化', '工业', '朝阳'];
  const NS_NAMES = ['平安', '富强', '民主', '文明', '和谐', '自由', '平等', '公正', '法治', '爱国',
    '敬业', '诚信', '友善', '康庄', '青云', '锦绣', '梧桐', '银杏', '玉兰', '芙蓉'];
  const EW_SUFFIX = ['路', '路', '大道', '路'];
  const NS_SUFFIX = ['街', '街', '大街', '巷'];

  function pick(arr, i) { return arr[((i % arr.length) + arr.length) % arr.length]; }

  class DrillProvider {
    constructor(opts = {}) {
      this.name = 'drill';
      this.isVirtual = true;
      this.spacing = opts.spacing || 165;      // 路网间距（米）
      this.extent = opts.extent || 34;         // 网格行列数
      this.ppm = opts.ppm || 1.05;             // 每米像素
      this.origin = opts.origin;
      this.nodes = [];
      this.edges = [];
      this.adj = new Map();
      this._built = false;
      this._trackD = '';
      this._trackCount = 0;
    }

    // ---------- 路网构建 ----------
    _build() {
      if (this._built) return;
      const n = this.extent;
      const half = (n - 1) / 2;
      const oLat = this.origin.lat;
      const oLng = this.origin.lng;
      const dLat = this.spacing / M_PER_DEG_LAT;
      const dLng = this.spacing / (M_PER_DEG_LAT * Math.cos((oLat * Math.PI) / 180));

      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          this.nodes.push({
            id: j * n + i,
            i, j,
            lat: oLat + (j - half) * dLat,
            lng: oLng + (i - half) * dLng,
            x: (i - half) * this.spacing,
            y: -(j - half) * this.spacing,
          });
        }
      }
      const at = (i, j) => (i < 0 || j < 0 || i >= n || j >= n) ? null : this.nodes[j * n + i];

      const addEdge = (a, b, horizontal) => {
        const row = horizontal ? a.j : a.i;
        const name = horizontal
          ? pick(EW_NAMES, row) + pick(EW_SUFFIX, row)
          : pick(NS_NAMES, row) + pick(NS_SUFFIX, row);
        const e = { id: this.edges.length, a: a.id, b: b.id, name, len: this.spacing };
        this.edges.push(e);
        if (!this.adj.has(a.id)) this.adj.set(a.id, []);
        if (!this.adj.has(b.id)) this.adj.set(b.id, []);
        this.adj.get(a.id).push({ to: b.id, edge: e.id });
        this.adj.get(b.id).push({ to: a.id, edge: e.id });
      };

      // 先铺满网格，再随机打断部分道路，最后补齐孤点，保证连通
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = at(i, j);
          const r = at(i + 1, j);
          const d = at(i, j + 1);
          if (r && Math.random() > 0.09) addEdge(a, r, true);
          if (d && Math.random() > 0.09) addEdge(a, d, false);
        }
      }
      for (const nd of this.nodes) {
        const list = this.adj.get(nd.id);
        if (!list || list.length === 0) {
          const r = at(nd.i + 1, nd.j) || at(nd.i - 1, nd.j);
          if (r) addEdge(nd, r, true);
          const d = at(nd.i, nd.j + 1) || at(nd.i, nd.j - 1);
          if (d) addEdge(nd, d, false);
        }
      }
      this._built = true;
    }

    // ---------- 坐标换算 ----------
    toWorld(lat, lng) {
      const oLat = this.origin.lat;
      const oLng = this.origin.lng;
      return {
        x: (lng - oLng) * M_PER_DEG_LAT * Math.cos((oLat * Math.PI) / 180),
        y: (lat - oLat) * M_PER_DEG_LAT,
      };
    }

    toLatLng(x, y) {
      const oLat = this.origin.lat;
      const oLng = this.origin.lng;
      return {
        lat: oLat + y / M_PER_DEG_LAT,
        lng: oLng + x / (M_PER_DEG_LAT * Math.cos((oLat * Math.PI) / 180)),
      };
    }

    nearestNode(lat, lng) {
      this._build();
      const w = this.toWorld(lat, lng);
      let best = null;
      let bd = Infinity;
      for (const nd of this.nodes) {
        const d = (nd.x - w.x) ** 2 + (nd.y - w.y) ** 2;
        if (d < bd) { bd = d; best = nd; }
      }
      return best;
    }

    // ---------- 渲染 ----------
    async init(container, opts = {}) {
      this._build();
      const W = container.clientWidth || 900;
      const H = container.clientHeight || 560;
      this.W = W; this.H = H;
      container.innerHTML = '';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'drill-svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = `
        <defs>
          <radialGradient id="dGlow"><stop offset="0%" stop-color="#4aa8ff" stop-opacity="0.18"/><stop offset="100%" stop-color="#4aa8ff" stop-opacity="0"/></radialGradient>
          <filter id="dShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/>
          </filter>
        </defs>
        <rect width="${W}" height="${H}" fill="#0a0f1a"/>
        <g id="dWorld">
          <g id="dLit"></g>
          <g id="dBlocks"></g>
          <g id="dRoads"></g>
          <path id="dTrack0" fill="none" stroke="rgb(255,233,120)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack1" fill="none" stroke="rgb(255,210,107)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack2" fill="none" stroke="rgb(255,187,93)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack3" fill="none" stroke="rgb(255,164,80)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack4" fill="none" stroke="rgb(255,141,67)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack5" fill="none" stroke="rgb(252,119,57)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack6" fill="none" stroke="rgb(245,97,51)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack7" fill="none" stroke="rgb(238,76,44)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack8" fill="none" stroke="rgb(231,54,38)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path id="dTrack9" fill="none" stroke="rgb(224,32,32)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
        </g>
        <g id="dAvatar"></g>
        <g id="dLabels"></g>
      `;
      container.appendChild(svg);
      this.svg = svg;
      this.gWorld = svg.querySelector('#dWorld');
      this.gRoads = svg.querySelector('#dRoads');
      this.gBlocks = svg.querySelector('#dBlocks');
      this.gLit = svg.querySelector('#dLit');
      this.gAvatar = svg.querySelector('#dAvatar');
      this.gLabels = svg.querySelector('#dLabels');
      this.trackEl = svg.querySelector('#dTrack');

      // 街区底色
      const s = this.spacing;
      const half = ((this.extent - 1) / 2) * s + s;
      let blocks = '';
      for (let j = 0; j < this.extent - 1; j++) {
        for (let i = 0; i < this.extent - 1; i++) {
          const x = (i - (this.extent - 1) / 2) * s;
          const y = -(j - (this.extent - 1) / 2) * s;
          blocks += `<rect x="${(x - s * 0.42).toFixed(1)}" y="${(y - s * 0.42).toFixed(1)}" width="${(s * 0.84).toFixed(1)}" height="${(s * 0.84).toFixed(1)}" rx="3" fill="#111a2b" stroke="#16223a" stroke-width="1"/>`;
        }
      }
      this.gBlocks.innerHTML = blocks;

      // 道路
      let roads = '';
      for (const e of this.edges) {
        const a = this.nodes[e.a];
        const b = this.nodes[e.b];
        roads += `<line x1="${(a.x * this.ppm).toFixed(1)}" y1="${(a.y * this.ppm).toFixed(1)}" x2="${(b.x * this.ppm).toFixed(1)}" y2="${(b.y * this.ppm).toFixed(1)}" stroke="#24344f" stroke-width="${Math.max(3, s * this.ppm * 0.16).toFixed(1)}" stroke-linecap="round"/>`;
      }
      this.gRoads.innerHTML = roads;

      this.gAvatar.innerHTML = `
        <circle r="30" fill="url(#dGlow)"/>
        <circle r="9" fill="#ff5d5d" stroke="#fff" stroke-width="2.5" filter="url(#dShadow)"/>
        <polygon id="dArrow" points="0,-16 5,-7 -5,-7" fill="#ff5d5d" opacity="0.9"/>
      `;
      this.avatar = this.gAvatar;
      this.arrow = svg.querySelector('#dArrow');
      this._center = opts.center || this.origin;
      this._render();
      return this;
    }

    _render() {
      if (!this.svg) return;
      const c = this.toWorld(this._center.lat, this._center.lng);
      const tx = this.W / 2 - c.x * this.ppm;
      const ty = this.H / 2 - c.y * this.ppm;
      this.gWorld.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
      this.gAvatar.setAttribute('transform', `translate(${(this.W / 2).toFixed(1)},${(this.H / 2).toFixed(1)})`);
    }

    setFollow(on) { this._follow = Boolean(on); }

    moveTo(lat, lng, bearing) {
      this._center = { lat, lng };
      this._render();
      if (this.arrow) this.arrow.setAttribute('transform', `rotate(${(bearing || 0).toFixed(1)})`);
    }

    speedColorIndex(spd) {
      const t = Math.max(0, Math.min(0.999, (Number(spd) || 0) / 16));
      return Math.floor(t * 10);
    }

    addTrackPoint(lat, lng, prev, spd) {
      if (!this.trackEl) return;
      const w = this.toWorld(lat, lng);
      const x = (w.x * this.ppm).toFixed(1);
      const y = (w.y * this.ppm).toFixed(1);
      // 每段按速度独立上色：段 = [上一点, 当前点]，交界处重叠补缝
      if (prev) {
        const pw = this.toWorld(prev.lat, prev.lng);
        const px = (pw.x * this.ppm).toFixed(1);
        const py = (pw.y * this.ppm).toFixed(1);
        const li = this.speedColorIndex(spd);
        const lo = this.speedColorIndex(this._lastSpd != null ? this._lastSpd : spd);
        for (let k = Math.min(li, lo); k <= Math.max(li, lo); k++) {
          const el = this.svg.querySelector('#dTrack' + k);
          if (el) el.setAttribute('d', (el.getAttribute('d') || '') + ` M${px},${py} L${x},${y}`);
        }
      }
      this._lastSpd = spd;
      this._trackCount++;
      if (this._trackCount > 6000) {
        // 轨迹过长时截断，避免 DOM 无限膨胀（各色 path 只保留最近 4000 段）
        for (let k = 0; k < 10; k++) {
          const el = this.svg.querySelector('#dTrack' + k);
          if (!el) continue;
          const parts = (el.getAttribute('d') || '').split(' M').filter(Boolean);
          if (parts.length > 4000) el.setAttribute('d', 'M' + parts.slice(-4000).join(' M'));
        }
      }
    }

    addStartMarker(lat, lng, n) {
      const g = this.svg && this.svg.querySelector('#dLabels');
      if (!g) return;
      const w = this.toWorld(lat, lng);
      const x = w.x * this.ppm, y = w.y * this.ppm;
      const frag = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      frag.innerHTML = '<circle cx="' + x + '" cy="' + y + '" r="5" fill="#a06bff" stroke="#fff" stroke-width="1.5"/>'
        + '<text x="' + x + '" y="' + (y - 9) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" stroke="rgba(120,70,220,.92)" stroke-width="0.5">' + n + '</text>';
      g.appendChild(frag);
      (this._startNodes = this._startNodes || []).push(frag);
    }

    clearStartMarkers() {
      for (const n of (this._startNodes || [])) { try { n.remove(); } catch (_) { /* noop */ } }
      this._startNodes = [];
    }

    setTrack(points, { append = false } = {}) {
      if (!append) {
        this.clearStartMarkers();
        this._trackCount = 0;
        for (let k = 0; k < 10; k++) {
          const el = this.svg.querySelector('#dTrack' + k);
          if (el) el.setAttribute('d', '');
        }
        this._lastSpd = null;
        if (this.trackEl) this.trackEl.setAttribute('d', '');
      }
      // append=true：追加新的一段（不断笔也绝不与上一段相连 —— 每对点都是独立的 M+L 子路径）
      for (let i = 1; i < (points || []).length; i++) {
        this.addTrackPoint(points[i].lat, points[i].lng, points[i - 1], points[i].spd);
      }
    }

    /** 点亮一个街区块（约 150m 网格） */
    lightCell(lat, lng) {
      if (!this.gLit) return;
      const w = this.toWorld(lat, lng);
      const s = 150 * this.ppm;
      const x = (w.x * this.ppm - s / 2).toFixed(1);
      const y = (w.y * this.ppm - s / 2).toFixed(1);
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', s.toFixed(1));
      rect.setAttribute('height', s.toFixed(1));
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', '#4aa8ff');
      rect.setAttribute('fill-opacity', '0.13');
      rect.setAttribute('stroke', '#4aa8ff');
      rect.setAttribute('stroke-opacity', '0.22');
      rect.setAttribute('stroke-width', '1');
      this.gLit.appendChild(rect);
    }

    // ---------- 路径规划（网格 BFS） ----------
    async planRoute(from, to) {
      this._build();
      const start = this.nearestNode(from.lat, from.lng);
      const goal = this.nearestNode(to.lat, to.lng);
      if (!start || !goal) return null;
      if (start.id === goal.id) return null;

      const prev = new Map();
      const seen = new Set([start.id]);
      const queue = [start.id];
      let found = false;
      while (queue.length) {
        const cur = queue.shift();
        if (cur === goal.id) { found = true; break; }
        for (const link of (this.adj.get(cur) || [])) {
          if (seen.has(link.to)) continue;
          seen.add(link.to);
          prev.set(link.to, { from: cur, edge: link.edge });
          queue.push(link.to);
        }
      }
      if (!found) return null;

      const nodeSeq = [];
      const edgeSeq = [];
      let cur = goal.id;
      while (cur !== start.id) {
        nodeSeq.unshift(cur);
        const p = prev.get(cur);
        if (!p) break;
        edgeSeq.unshift(this.edges[p.edge]);
        cur = p.from;
      }
      nodeSeq.unshift(start.id);

      const points = [{ lat: from.lat, lng: from.lng }];
      for (const id of nodeSeq.slice(1)) {
        const nd = this.nodes[id];
        if (nd === goal) break;
        points.push({ lat: nd.lat, lng: nd.lng });
      }
      points.push({ lat: to.lat, lng: to.lng });

      // 按路名切分 steps
      const steps = [];
      for (const e of edgeSeq) {
        const last = steps[steps.length - 1];
        if (last && last.road === e.name) last.distance += e.len;
        else steps.push({ road: e.name, distance: e.len });
      }
      const distance = edgeSeq.reduce((s, e) => s + e.len, 0);
      return { points, steps, distance };
    }

    /** 当前所在道路名（取最近边的路名） */
    async roadAt(lat, lng) {
      this._build();
      const w = this.toWorld(lat, lng);
      let best = null;
      let bd = Infinity;
      for (const e of this.edges) {
        const a = this.nodes[e.a];
        const b = this.nodes[e.b];
        const vx = b.x - a.x; const vy = b.y - a.y;
        const wx = w.x - a.x; const wy = w.y - a.y;
        const len2 = vx * vx + vy * vy || 1;
        let t = (wx * vx + wy * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + vx * t; const py = a.y + vy * t;
        const d = (w.x - px) ** 2 + (w.y - py) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      return best ? best.name : '';
    }

    /** 把一次鼠标事件换算成经纬度（世界层做过 translate，这里反向还原） */
    _eventToLatLng(ev) {
      if (!this.svg) return null;
      const rect = this.svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const sx = ((ev.clientX - rect.left) / rect.width) * this.W;
      const sy = ((ev.clientY - rect.top) / rect.height) * this.H;
      const c = this.toWorld(this._center.lat, this._center.lng);
      const tx = this.W / 2 - c.x * this.ppm;
      const ty = this.H / 2 - c.y * this.ppm;
      return this.toLatLng((sx - tx) / this.ppm, (sy - ty) / this.ppm);
    }

    /** 进入「点地图选点」模式 */
    enablePick(cb) {
      if (!this.svg) return false;
      this.disablePick();
      this._pickHandler = (ev) => {
        const p = this._eventToLatLng(ev);
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) cb(p.lat, p.lng);
      };
      this.svg.style.cursor = 'crosshair';
      this.svg.addEventListener('click', this._pickHandler);
      return true;
    }

    disablePick() {
      if (this.svg && this._pickHandler) {
        this.svg.removeEventListener('click', this._pickHandler);
      }
      if (this.svg) this.svg.style.cursor = '';
      this._pickHandler = null;
    }

    destroy() {
      this.disablePick();
      if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
    }
  }

  global.DrillProvider = DrillProvider;
})(window);
