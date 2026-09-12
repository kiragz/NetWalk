/**
 * 漫游引擎
 * 负责：速度换算 → 沿路径推进 → 路口 ROLL100 → 轨迹与统计上报
 */
(function (global) {
  'use strict';

  const { convert, createSmoother, rollJunction } = global.NetWalkSpeed;

  const SCOPE_SCALE = { city: 1, china: 50, world: 500 };
  const TICK_MS = 200;
  const MIN_POINT_GAP = 8;       // 轨迹点最小间隔（米）
  const SAMPLE_EVERY = 10000;    // 环境采样间隔（毫秒）
  const FLUSH_EVERY = 5000;      // 轨迹点批量上报间隔（毫秒）

  // 防卡死：路口抉择的时间预算与「不走重复路」的宽松度
  const PLAN_TIMEOUT = 6000;     // 单次路径规划超时
  const PLAN_BUDGET = 7000;      // 一次路口抉择的总预算，超出就用已拿到的最好结果
  const FRESH_MIN = 0.05;        // 新路占比达到该值即接受（再次放宽：只要不是 100% 旧路就往前走，宁可绕旧路也不原地打转）
  const MAX_BACKTRACK = 3;       // 连续原路返回上限，超过就强制大转向
  const JUNCTION_KEEP = 12;      // 路口栈深度（用于前方不通时原路返回）

  function haversine(a, b) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearingOf(a, b) {
    const toRad = (x) => (x * Math.PI) / 180;
    const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
      - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
    let deg = (Math.atan2(y, x) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  function destPoint(from, bearingDeg, distM) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const br = toRad(bearingDeg);
    const lat1 = toRad(from.lat);
    const lng1 = toRad(from.lng);
    const dr = distM / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: (lat2 * 180) / Math.PI, lng: ((lng2 * 180) / Math.PI + 540) % 360 - 180 };
  }

  class RoamEngine {
    constructor(opts) {
      this.provider = opts.provider;
      this.cfg = Object.assign({}, global.NetWalkSpeed.DEFAULTS, opts.cfg || {});
      this.origin = opts.origin;
      this.scope = opts.scope || 'city';
      this.onUpdate = opts.onUpdate || function () {};
      this.onRoll = opts.onRoll || function () {};
      this.onLog = opts.onLog || function () {};

      this.pos = Object.assign({}, this.origin);
      this.bearing = Math.random() * 360;
      this.route = null;
      this.traveled = 0;
      this.planning = false;
      this.running = false;
      this.paused = false;

      this.smooth = createSmoother(2500);
      this.speedKmh = 0;
      this.mode = 'idle';
      this.road = '';

      // 探索相关：已走过的路（不参与 ROLL 抉择）与已点亮的街区块
      this.visitedRoads = new Set(opts.visitedRoads || []);
      this.litCells = new Set();
      this._litEmitted = new Set();
      this.repeatSkips = 0;   // 因重复而重掷的次数
      this.freshRoads = 0;    // 本轮新走到的路数
      this.junctionStack = [];  // 走过的路口（前方不通时原路返回到这里重掷）
      this.blockedStreak = 0;   // 连续受阻次数
      this.backtracks = 0;      // 原路返回次数（ROLL100 重来）
      this.roadPct = 0;
      this.roadRemain = 0;
      this.roadDone = 0;        // 已在当前这条路走了多少米（0.9.8 起 HUD 显示米数而不是百分比）
      this.sessionNo = 0;       // 本次出发的全局序号：轨迹点带上它，绘制时按会话切分（多设备不连飞线）
      this.roadLen = 0;
      this.totals = { rx: 0, tx: 0, keys: 0 };

      // 统计
      this.stats = {
        distance: 0, durationMs: 0, runMs: 0, walkMs: 0,
        maxSpeed: 0, speedSum: 0, speedCount: 0,
        rxTotal: 0, txTotal: 0, rxPeak: 0, txPeak: 0,
        kpmSum: 0, kpmPeak: 0, kpmCount: 0, totalKeys: 0,
        rolls: 0,
      };

      this._pending = [];
      this._lastPoint = null;
      this._lastFlush = 0;
      this._lastSample = 0;
      this._startedAt = 0;
      this._lastTick = 0;
      this._lastKeysTotal = 0;
      this._roadQueriedAt = 0;
    }

    async start() {
      if (this.running) return;
      this.running = true;
      this._startedAt = Date.now();
      this._lastTick = Date.now();
      this._lastFlush = Date.now();
      this._lastSample = Date.now();
      this._lastPoint = Object.assign({}, this.pos);
      this.provider.moveTo(this.pos.lat, this.pos.lng, this.bearing);
      this.provider.addTrackPoint(this.pos.lat, this.pos.lng, null, this.speedKmh);
      await this._planNext(true);
      this._ticker = setInterval(() => this._tick(), TICK_MS);
      this.onLog('出发，开始今天的漫游');
    }

    pause() { this.paused = true; this.onLog('已暂停'); }
    resume() { if (this.paused) { this.paused = false; this._lastTick = Date.now(); this.onLog('继续前进'); } }
    isPaused() { return this.paused; }

    stop() {
      this.running = false;
      if (this._ticker) clearInterval(this._ticker);
      this._ticker = null;
      // 收尾采样一次，保证最后一段累计里程也落盘
      if (this.stats.distance > 0) this._sample();
      this.flush(true);
    }

    /** 当前生效的时空压缩比；演练路网范围固定，强制 1× */
    _scale() {
      if (this.provider && this.provider.isVirtual) return 1;
      return SCOPE_SCALE[this.scope] || 1;
    }

    /** 接收一次环境数据（网速 + 打字 + 累计量） */
    feed(net, key, totals) {
      if (typeof totals === 'object' && totals) this.totals = totals;
      if (!this.running) return;
      const rx = (net && net.rx) || 0;
      const tx = (net && net.tx) || 0;
      const kpm = (key && key.kpm) || 0;
      const r = convert({ rx, tx, kpm }, this.cfg);
      this.speedKmh = this.smooth(r.speedKmh, Date.now());
      const snap = convert({ rx, tx, kpm }, this.cfg);
      this.mode = this.speedKmh > 9.5 ? 'run' : this.speedKmh > 6.5 ? 'brisk' : this.speedKmh > 3 ? 'walk' : this.speedKmh > 1 ? 'stroll' : 'idle';

      const s = this.stats;
      s.rxTotal += rx; s.txTotal += tx;
      s.rxPeak = Math.max(s.rxPeak, rx); s.txPeak = Math.max(s.txPeak, tx);
      s.kpmSum += kpm; s.kpmCount++; s.kpmPeak = Math.max(s.kpmPeak, kpm);
      if (key && typeof key.total === 'number') {
        if (this._lastKeysTotal && key.total > this._lastKeysTotal) {
          s.totalKeys += key.total - this._lastKeysTotal;
        }
        this._lastKeysTotal = key.total;
      }
      this._lastNet = { rx, tx, kpm };
      this._lastConv = r;
    }

    _tick() {
      if (!this.running || this.paused) return;
      const now = Date.now();
      let dt = (now - this._lastTick) / 1000;
      this._lastTick = now;
      if (dt <= 0 || dt > 3) dt = TICK_MS / 1000;

      const s = this.stats;
      s.durationMs += dt * 1000;
      if (this.speedKmh > 6.5) s.runMs += dt * 1000; else s.walkMs += dt * 1000;
      s.maxSpeed = Math.max(s.maxSpeed, this.speedKmh);
      s.speedSum += this.speedKmh; s.speedCount++;

      const mps = this.speedKmh / 3.6;
      const scale = this._scale();
      let remain = mps * dt * scale;

      let guard = 0;
      while (remain > 0 && guard++ < 8) {
        if (!this.route) { this._planNext(); break; }
        const left = this.route.distance - this.traveled;
        if (remain < left) {
          this.traveled += remain;
          s.distance += remain / scale;   // 统计按真实步行里程计
          remain = 0;
        } else {
          remain -= left;
          this.traveled = this.route.distance;
          s.distance += left / scale;
          this._planNext();
          break;
        }
      }

      if (this.route) this._applyPosition();

      // 轨迹点节流：同时画到地图并入队上报
      if (this._lastPoint) {
        const d = haversine(this._lastPoint, this.pos);
        if (d >= MIN_POINT_GAP) {
          const onStraight = Boolean(this.route && this.route.straight);
          this._pending.push({
            t: Date.now(), lat: this.pos.lat, lng: this.pos.lng,
            road: this.road, spd: this.speedKmh, mode: this.mode,
            no: this.sessionNo || 0,   // 会话号：多设备合并后绘制按它切分，杜绝跨设备飞线
            straight: onStraight ? 1 : 0,   // 直线兜底标记：绘制时剔除，不画飞线
          });
          // 顺序不能反：先用旧的 _lastPoint 画「上一点 → 当前点」，再更新 _lastPoint
          // （以前先更新再传参，画出来是零长度线段，行走中的轨迹根本不会实时生长）
          this.provider.addTrackPoint(this.pos.lat, this.pos.lng, this._lastPoint, this.speedKmh);
          this._lastPoint = Object.assign({}, this.pos);
        }
      }
      if (now - this._lastFlush > FLUSH_EVERY) this.flush();
      if (now - this._lastSample > SAMPLE_EVERY) this._sample();

      this.onUpdate(this.snapshot());
    }

    _applyPosition() {
      const r = this.route;
      if (!r.cum) return;
      let t = this.traveled;
      const cum = r.cum;
      const pts = r.points;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < t) i++;
      const segLen = cum[i] - cum[i - 1] || 1;
      const f = Math.max(0, Math.min(1, (t - cum[i - 1]) / segLen));
      const a = pts[i - 1];
      const b = pts[i];
      this.pos = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
      this.bearing = bearingOf(a, b);
      this.provider.moveTo(this.pos.lat, this.pos.lng, this.bearing);
      this._updateRoad(t);
      this._lightCell();
    }

    /** 点亮所在街区块（约 150m 网格），用于地图点亮区与「点亮数」统计 */
    _lightCell() {
      const key = `${Math.round(this.pos.lat / 0.00135)},${Math.round(this.pos.lng / 0.00135)}`;
      if (this.litCells.has(key)) return;
      this.litCells.add(key);
      if (this._litEmitted.size < 6000 && this.provider.lightCell) {
        this._litEmitted.add(key);
        this.provider.lightCell(this.pos.lat, this.pos.lng);
      }
    }

    _updateRoad(traveled) {
      const steps = this.route && this.route.steps;
      if (steps && steps.length) {
        let acc = 0;
        for (const st of steps) {
          const start = acc;
          acc += st.distance;
          if (traveled <= acc) {
            if (st.road && st.road !== this.road) {
            this.road = st.road;
            // 记录走过的路：已走过的路不再参与后续路口抉择
            if (!this.visitedRoads.has(st.road)) {
              this.visitedRoads.add(st.road);
              this.freshRoads++;
            }
            this.onLog(`走上 ${st.road}`);
          }
            // 当前这条路的推进：0.9.8 起以「已走多少米」呈现（而不是百分比）
            const done = traveled - start;
            this.roadDone = Math.max(0, done);
            this.roadPct = st.distance > 0
              ? Math.max(0, Math.min(100, (done / st.distance) * 100))
              : 0;
            this.roadRemain = Math.max(0, st.distance - done);
            this.roadLen = st.distance;
            return;
          }
        }
      }
      // 路网未提供路名时用逆地理兜底（节流 8 秒）
      const now = Date.now();
      if (now - this._roadQueriedAt > 8000) {
        this._roadQueriedAt = now;
        this.provider.roadAt(this.pos.lat, this.pos.lng).then((road) => {
          if (road && road !== this.road) { this.road = road; this.onLog(`走上 ${road}`); }
        });
      }
    }

    /** 带超时的路径规划：路网服务迟迟不返回时不会把引擎永久挂住 */
    _planRouteSafe(from, to, timeout) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v || null); } };
        const t = setTimeout(() => finish(null), timeout || PLAN_TIMEOUT);
        try {
          Promise.resolve(this.provider.planRoute(from, to)).then(finish).catch(() => finish(null));
        } catch (_) {
          finish(null);
        }
      });
    }

    /** 直线兜底路线：任何情况下都保证有路可走，绝不停在原地。
     *  straight=true 标记：这段点绘制时会被剔除（用户要求"去掉错误的直线飞线"），
     *  且 🧭 轨迹整备会优先把这类段重新规划成真实道路。 */
    _straightRoute(bearing, distance) {
      const end = destPoint(this.pos, bearing, distance);
      return {
        straight: true,
        points: [Object.assign({}, this.pos), end],
        steps: [{ road: this.road || '', distance }],
        distance,
      };
    }

    _pushJunction(pos, bearing) {
      this.junctionStack.push({ pos: { lat: pos.lat, lng: pos.lng }, bearing });
      if (this.junctionStack.length > JUNCTION_KEEP) this.junctionStack.shift();
    }

    _popJunction() {
      return this.junctionStack.length ? this.junctionStack.pop() : null;
    }

    /** 走到路口：ROLL100 决定下一段方向（已走过的路不参与抉择） */
    async _planNext(first = false) {
      if (this.planning) return;
      this.planning = true;
      try {
        const scale = this._scale();
        const isDrill = this.provider.name === 'drill';
        // 演练模式路网在本地计算，可以多试一次；高德模式要走网络，保守一些
        const maxTry = isDrill ? 3 : 2;
        // 一次抉择的时间预算，到了点就用已拿到的最好结果，避免分身长时间静止
        const deadline = Date.now() + PLAN_BUDGET;

        // —— 顺路直走（0.9.15，采纳玩家提案）：连续两次直行且还在同一条路上 → 停止 ROLL，
        // 沿当前方向继续延伸，距离随连击放大（300→600→900→1200 封顶），
        // 直到规划出的路线里出现新的路名（这条路到头了）才恢复路口 ROLL ——
        const streak = this._straightStreak || 0;
        const onSameRoad = Boolean(this.road) && Boolean((this.route || {}).steps)
          && this.route.steps.some((s) => s.road === this.road);
        const cruise = !first && this._lastChoice === '直行' && streak >= 2 && onSameRoad;

        // —— 出城保障（0.9.15）：随机游走的净位移是 √N×段长，纯靠概率永远走不出城 ——
        // 出发后走了很多段仍未离开出发点 3km → 强制"背离出发点"的远行（1200m），直到出圈
        this._rollsSinceHome = (this._rollsSinceHome || 0) + 1;
        const homeDist = this.origin ? haversine(this.origin, this.pos) : Infinity;
        if (homeDist > 3000) this._rollsSinceHome = 0;
        const gravity = !cruise && this._rollsSinceHome > 12 && homeDist < 3000;
        const stuck = this._rollsSinceHome;

        let roll = 0;
        let d;
        if (cruise) {
          d = { roll: 0, choice: '顺路直走', bearing: this.bearing, distance: Math.min(300 + streak * 300, 1200) };
        } else if (gravity) {
          let away = 0;
          try { away = global.NetWalkGeo.bearingOf(this.origin, this.pos); } catch (_) { away = this.bearing; }
          away = (away + (Math.random() - 0.5) * 60 + 360) % 360;
          d = { roll: 100, choice: '远方引力·出城', bearing: away, distance: 1200 };
          this._rollsSinceHome = 0;   // 这次强制出城后重新计数（12 段 ≈ 3.6km 足以出圈）
        } else {
          roll = 1 + Math.floor(Math.random() * 100);
          d = rollJunction(roll, this.bearing);
        }
        let route = null;
        let freshRatio = 1;
        let backtracked = false;

        for (let attempt = 1; attempt <= maxTry; attempt++) {
          if (Date.now() > deadline) break;
          if (attempt > 1) {
            // 上一条路线大多是走过的路，重新掷点换个方向（顺路直走/引力段不重掷，方向是既定的）
            if (!cruise && !gravity) {
              roll = 1 + Math.floor(Math.random() * 100);
              d = rollJunction(roll, this.bearing);
              this.repeatSkips++;
            }
          }
          let target = destPoint(this.pos, d.bearing, d.distance * scale);
          let r = null;
          for (let sub = 0; sub < 2 && !r; sub++) {
            // 单次超时按剩余预算收窄，保证整次抉择不会超过 PLAN_BUDGET
            const left = deadline - Date.now();
            if (left <= 200) break;
            r = await this._planRouteSafe(this.pos, target, Math.min(PLAN_TIMEOUT, left));
            if (!r) target = destPoint(this.pos, (d.bearing + 41 * (sub + 1)) % 360, d.distance * scale * 0.7);
          }
          if (!r) continue;

          const roads = (r.steps || []).map((s) => s.road).filter(Boolean);
          freshRatio = roads.length
            ? roads.filter((x) => !this.visitedRoads.has(x)).length / roads.length
            : 1;
          route = r;
          if (freshRatio >= FRESH_MIN || cruise || gravity) break;
          // 新路够多就接受（阈值已放宽，宁可走点旧路也不卡住）；顺路直走/引力段方向既定，不因走旧路重掷
        }

        if (!route) {
          // 前方道路不通：原路返回上一个路口，ROLL100 重掷
          const back = this.blockedStreak < MAX_BACKTRACK ? this._popJunction() : null;
          this.blockedStreak++;
          if (back) {
            this.pos = Object.assign({}, back.pos);
            this.backtracks++;
            backtracked = true;
            // 退回来后换个明显不同的朝向再掷，避免又撞同一堵墙
            const base = (back.bearing + 90 + Math.random() * 180) % 360;
            roll = 1 + Math.floor(Math.random() * 100);
            d = rollJunction(roll, base);
            this.bearing = d.bearing;
            this.onLog(`前方不通，原路返回路口 ROLL ${roll} → ${d.choice}`);
            const target = destPoint(this.pos, d.bearing, d.distance * scale);
            const r2 = await this._planRouteSafe(this.pos, target, 4000);
            if (r2) {
              route = r2;
            } else {
              // 直线兜底要明说：否则用户只看到"分身不沿路走"却不知道原因
              this.onLog('⚠ 规划不可用（调用达上限 / 超时 / 前方无路），本段直线推进');
              route = this._straightRoute(d.bearing, Math.max(120, d.distance * scale));
            }
          } else {
            // 退无可退（栈空或连续受阻）：随机大转向强行推进
            this.blockedStreak = 0;
            this.junctionStack.length = 0;
            roll = 1 + Math.floor(Math.random() * 100);
            d = rollJunction(roll, this.bearing + 120 + Math.random() * 120);
            this.bearing = d.bearing;
            this.onLog(`附近无路可走，本段直线推进（转向 ${d.choice}）`);
            route = this._straightRoute(d.bearing, Math.max(150, d.distance * scale));
          }
          freshRatio = 0;
        } else {
          this.blockedStreak = 0;
          // 记住这个路口，下次前方不通就退回到这里重掷
          this._pushJunction(this.pos, this.bearing);
        }

        const cum = [0];
        for (let i = 1; i < route.points.length; i++) {
          cum.push(cum[i - 1] + haversine(route.points[i - 1], route.points[i]));
        }
        route.cum = cum;
        route.distance = cum[cum.length - 1] || route.distance || 1;
        // steps 里程来自路网服务，与按坐标算出的总长可能有偏差，按比例归一，
        // 否则「这条路走了百分之多少」会算歪
        const steps = route.steps || [];
        const stepSum = steps.reduce((sum, x) => sum + (x.distance || 0), 0);
        if (steps.length && stepSum > 0 && route.distance > 0) {
          const k = route.distance / stepSum;
          if (Math.abs(k - 1) > 0.001) steps.forEach((x) => { x.distance *= k; });
        }
        route.points[0] = Object.assign({}, this.pos);
        this.route = route;
        this.traveled = 0;

        // 顺路直走的连击记账：路线里出现别的路名 → 这条路到头了，恢复 ROLL；
        // 还在同一条路上 → 连击 +1（下一段更远）。普通直行也累计连击。
        if (cruise) {
          const names = (route.steps || []).map((s) => s.road).filter(Boolean);
          if (this.road && names.some((x) => x !== this.road)) {
            this._straightStreak = 0;
            this.onLog(`走到 ${this.road} 尽头，恢复路口 ROLL100`);
          } else {
            this._straightStreak = streak + 1;
          }
        } else {
          this._straightStreak = d.choice === '直行' ? (this._straightStreak || 0) + 1 : 0;
          this._lastChoice = d.choice;
        }

        // 顺路直走不是掷点：不计入 ROLL 统计、不写 ROLL 记录
        if (!cruise) {
          this.stats.rolls++;
          const rec = {
            t: Date.now(), lat: this.pos.lat, lng: this.pos.lng,
            road: this.road, roll: d.roll, choice: d.choice, bearing: d.bearing,
            fresh: Number(freshRatio.toFixed(2)),
            backtrack: backtracked,
          };
          this.onRoll(rec);
          fetch('/api/track/roll', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rec),
          }).catch(() => { /* 离线时忽略 */ });
        }
        // 原路返回时上面已经打过一条更具体的日志，这里不重复
        if (!first && !backtracked) {
          if (cruise) this.onLog(`顺路直走：继续沿 ${this.road || '当前道路'}（连击 ${streak + 1}，本段 ${Math.round(d.distance)} m）`);
          else if (gravity) this.onLog(`远方引力：已 ${stuck} 段未离开出发点 3km，向城外远行 ${Math.round(d.distance)} m`);
          else this.onLog(`路口 ROLL ${d.roll} → ${d.choice}`);
        }
      } finally {
        this.planning = false;
      }
    }

    _sample() {
      this._lastSample = Date.now();
      const n = this._lastNet || { rx: 0, tx: 0, kpm: 0 };
      fetch('/api/track/sample', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sample: {
            t: Date.now(), rx: n.rx, tx: n.tx, kpm: n.kpm,
            spd: this.speedKmh, mode: this.mode,
            // 真实步行里程（米）：地图尺度 != 1 时坐标位移被放大，
            // 后端聚合里程必须用这个值而不是轨迹几何长度
            dist: Math.round(this.stats.distance),
          },
        }),
      }).catch(() => { /* 离线时忽略 */ });
    }

    flush(force = false) {
      if (!this._pending.length && !force) return;
      const points = this._pending.slice();
      this._pending = [];
      this._lastFlush = Date.now();
      if (!points.length) return;
      fetch('/api/track/path', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
      }).catch(() => { /* 离线时忽略 */ });
    }

    snapshot() {
      const s = this.stats;
      return {
        pos: Object.assign({}, this.pos),
        bearing: this.bearing,
        speedKmh: this.speedKmh,
        mode: this.mode,
        road: this.road,
        roadPct: this.roadPct || 0,
        roadRemain: this.roadRemain || 0,
        roadLen: this.roadLen || 0,
        roadDone: this.roadDone || 0,
        distance: s.distance,
        durationMs: s.durationMs,
        rolls: s.rolls,
        avgSpeed: s.speedCount ? s.speedSum / s.speedCount : 0,
        maxSpeed: s.maxSpeed,
        net: this._lastNet || { rx: 0, tx: 0, kpm: 0 },
        totals: {
          rx: s.rxTotal,
          tx: s.txTotal,
          keys: s.totalKeys,
        },
        visited: this.visitedRoads.size,
        litCells: this.litCells.size,
        repeatSkips: this.repeatSkips,
        freshRoads: this.freshRoads,
        backtracks: this.backtracks,
      };
    }

    finalStats() {
      const s = this.stats;
      return {
        distance: Math.round(s.distance),
        duration: Math.round(s.durationMs),
        avgSpeed: Number((s.speedCount ? s.speedSum / s.speedCount : 0).toFixed(2)),
        maxSpeed: Number(s.maxSpeed.toFixed(2)),
        runMs: Math.round(s.runMs),
        walkMs: Math.round(s.walkMs),
        rxTotal: Math.round(s.rxTotal),
        txTotal: Math.round(s.txTotal),
        rxPeak: Math.round(s.rxPeak),
        txPeak: Math.round(s.txPeak),
        rxAvg: Math.round(s.rxTotal / Math.max(1, s.speedCount ? 1 : 1)),
        kpmAvg: s.kpmCount ? Math.round(s.kpmSum / s.kpmCount) : 0,
        kpmPeak: s.kpmPeak,
        totalKeys: s.totalKeys,
        rolls: s.rolls,
        points: 0,
      };
    }
  }

  global.RoamEngine = RoamEngine;
  global.NetWalkGeo = { haversine, bearingOf, destPoint };
})(window);
