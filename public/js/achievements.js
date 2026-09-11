/**
 * 成就系统：定义、判定与勋章渲染
 * 前后端共用（浏览器挂到 window，Node 通过 module.exports 引入）
 *
 * agg 聚合指标结构：
 *   totalDistance  累计里程(米)      maxDayDistance 单日最远(米)
 *   totalDuration  累计时长(ms)      totalKeys      累计击键
 *   totalRolls     累计路口决策      totalRx/totalTx 累计流量(字节)
 *   uniqueRoads    走过的不同路名数   activeDays     活跃天数
 *   maxSpeed       历史最高速(km/h)   streakDays     连续漫游天数
 *   cities         走过的城市数组     scopes         用过的地图尺度数组
 *   litCells       点亮的网格数       totalPoints    轨迹点数
 */
(function (global) {
  'use strict';

  const LEVELS = {
    bronze: { name: '铜', from: '#d08a4a', to: '#8a5424', ring: '#e0a86a', text: '#3a2410' },
    silver: { name: '银', from: '#d8dde6', to: '#8d97a8', ring: '#eef2f8', text: '#2b3140' },
    gold: { name: '金', from: '#ffd75e', to: '#c8901a', ring: '#ffe89a', text: '#3d2a05' },
    diamond: { name: '钻', from: '#8ef0ff', to: '#2b9fd4', ring: '#c8f8ff', text: '#04283a' },
    epic: { name: '史诗', from: '#e0a3ff', to: '#8b3fd4', ring: '#f0d0ff', text: '#2a0a3d' },
  };

  const ACHIEVEMENTS = [
    // ---- 里程 ----
    { id: 'dist_first', group: '里程', name: '初次出门', desc: '单日走过 1 公里', level: 'bronze', icon: '👟', check: (a) => a.maxDayDistance >= 1000 },
    { id: 'dist_5k', group: '里程', name: '晨间散步', desc: '单日走过 5 公里', level: 'bronze', icon: '🌤️', check: (a) => a.maxDayDistance >= 5000 },
    { id: 'dist_10k', group: '里程', name: '半马预备', desc: '单日走过 10 公里', level: 'silver', icon: '🏃', check: (a) => a.maxDayDistance >= 10000 },
    { id: 'dist_21k', group: '里程', name: '半程马拉松', desc: '单日走过 21 公里', level: 'gold', icon: '🏅', check: (a) => a.maxDayDistance >= 21000 },
    { id: 'dist_42k', group: '里程', name: '全程马拉松', desc: '单日走过 42 公里', level: 'diamond', icon: '🏆', check: (a) => a.maxDayDistance >= 42000 },
    { id: 'dist_total_100', group: '里程', name: '百公里俱乐部', desc: '累计走过 100 公里', level: 'gold', icon: '🛣️', check: (a) => a.totalDistance >= 100000 },
    { id: 'dist_total_1000', group: '里程', name: '千里之行', desc: '累计走过 1000 公里', level: 'epic', icon: '🌏', check: (a) => a.totalDistance >= 1000000 },

    // ---- 探索 ----
    { id: 'road_10', group: '探索', name: '认路开始', desc: '走过 10 条不同的路', level: 'bronze', icon: '🧭', check: (a) => a.uniqueRoads >= 10 },
    { id: 'road_50', group: '探索', name: '街巷通', desc: '走过 50 条不同的路', level: 'silver', icon: '🗺️', check: (a) => a.uniqueRoads >= 50 },
    { id: 'road_200', group: '探索', name: '活地图', desc: '走过 200 条不同的路', level: 'gold', icon: '📖', check: (a) => a.uniqueRoads >= 200 },
    { id: 'road_500', group: '探索', name: '城市百科', desc: '走过 500 条不同的路', level: 'diamond', icon: '🏙️', check: (a) => a.uniqueRoads >= 500 },
    { id: 'lit_50', group: '探索', name: '点亮街区', desc: '点亮 50 个街区块', level: 'bronze', icon: '💡', check: (a) => a.litCells >= 50 },
    { id: 'lit_300', group: '探索', name: '灯火通明', desc: '点亮 300 个街区块', level: 'silver', icon: '🔦', check: (a) => a.litCells >= 300 },
    { id: 'lit_1000', group: '探索', name: '不夜城', desc: '点亮 1000 个街区块', level: 'gold', icon: '🌃', check: (a) => a.litCells >= 1000 },

    // ---- 速度 ----
    { id: 'spd_run', group: '速度', name: '跑起来了', desc: '速度突破 9.5 km/h', level: 'bronze', icon: '💨', check: (a) => a.maxSpeed >= 9.5 },
    { id: 'spd_15', group: '速度', name: '风驰电掣', desc: '速度突破 15 km/h', level: 'silver', icon: '⚡', check: (a) => a.maxSpeed >= 15 },
    { id: 'spd_20', group: '速度', name: '突破音障', desc: '速度突破 20 km/h', level: 'gold', icon: '🌪️', check: (a) => a.maxSpeed >= 20 },
    { id: 'spd_25', group: '速度', name: '数据洪流', desc: '速度突破 25 km/h', level: 'diamond', icon: '🚀', check: (a) => a.maxSpeed >= 25 },

    // ---- 流量与打字 ----
    { id: 'net_1g', group: '数据', name: '数据消费者', desc: '累计下载 1 GB', level: 'bronze', icon: '📥', check: (a) => a.totalRx >= 1024 ** 3 },
    { id: 'net_10g', group: '数据', name: '流量大户', desc: '累计下载 10 GB', level: 'silver', icon: '📦', check: (a) => a.totalRx >= 10 * 1024 ** 3 },
    { id: 'net_100g', group: '数据', name: '数据黑洞', desc: '累计下载 100 GB', level: 'gold', icon: '🕳️', check: (a) => a.totalRx >= 100 * 1024 ** 3 },
    { id: 'keys_1w', group: '数据', name: '手速初成', desc: '累计击键 1 万次', level: 'bronze', icon: '⌨️', check: (a) => a.totalKeys >= 10000 },
    { id: 'keys_10w', group: '数据', name: '键盘侠', desc: '累计击键 10 万次', level: 'silver', icon: '💻', check: (a) => a.totalKeys >= 100000 },
    { id: 'keys_100w', group: '数据', name: '钢铁手指', desc: '累计击键 100 万次', level: 'epic', icon: '🦾', check: (a) => a.totalKeys >= 1000000 },

    // ---- 路口 ----
    { id: 'roll_10', group: '路口', name: '第一次选择', desc: '路口 ROLL100 累计 10 次', level: 'bronze', icon: '🎲', check: (a) => a.totalRolls >= 10 },
    { id: 'roll_100', group: '路口', name: '选择困难症', desc: '路口 ROLL100 累计 100 次', level: 'silver', icon: '🔀', check: (a) => a.totalRolls >= 100 },
    { id: 'roll_1000', group: '路口', name: '命运主宰', desc: '路口 ROLL100 累计 1000 次', level: 'gold', icon: '🎯', check: (a) => a.totalRolls >= 1000 },

    // ---- 坚持 ----
    { id: 'days_3', group: '坚持', name: '三天打鱼', desc: '连续漫游 3 天', level: 'bronze', icon: '📅', check: (a) => a.streakDays >= 3 },
    { id: 'days_7', group: '坚持', name: '一周不断', desc: '连续漫游 7 天', level: 'silver', icon: '🔥', check: (a) => a.streakDays >= 7 },
    { id: 'days_30', group: '坚持', name: '月度旅人', desc: '连续漫游 30 天', level: 'gold', icon: '🌙', check: (a) => a.streakDays >= 30 },
    { id: 'days_100', group: '坚持', name: '百日行者', desc: '连续漫游 100 天', level: 'epic', icon: '💎', check: (a) => a.streakDays >= 100 },

    // ---- 城市 / 国家 ----
    { id: 'city_2', group: '城市', name: '双城记', desc: '在 2 个城市留下足迹', level: 'bronze', icon: '🏘️', check: (a) => (a.cities || []).length >= 2 },
    { id: 'city_5', group: '城市', name: '五城巡回', desc: '在 5 个城市留下足迹', level: 'silver', icon: '🌆', check: (a) => (a.cities || []).length >= 5 },
    { id: 'city_10', group: '城市', name: '十城漫游', desc: '在 10 个城市留下足迹', level: 'gold', icon: '🏙️', check: (a) => (a.cities || []).length >= 10 },
    { id: 'nat_china', group: '国家', name: '走遍中国', desc: '使用「全中国」尺度漫游过', level: 'silver', icon: '🇨🇳', check: (a) => (a.scopes || []).includes('china') },
    { id: 'nat_world', group: '国家', name: '环游世界', desc: '使用「全世界」尺度漫游过', level: 'gold', icon: '🌐', check: (a) => (a.scopes || []).includes('world') },
  ];

  /** 判定：返回所有达成条件的成就 id */
  function evaluate(agg) {
    const hit = [];
    for (const a of ACHIEVEMENTS) {
      try {
        if (a.check(agg)) hit.push(a.id);
      } catch (_) { /* 单条判定失败不影响其他 */ }
    }
    return hit;
  }

  function byId(id) {
    return ACHIEVEMENTS.find((a) => a.id === id) || null;
  }

  function levelStyle(level) {
    return LEVELS[level] || LEVELS.bronze;
  }

  /**
   * 渲染勋章 SVG
   * @param {object} def 成就定义
   * @param {boolean} unlocked 是否已解锁
   * @param {number} size 像素尺寸
   */
  function badgeSvg(def, unlocked = true, size = 72) {
    const L = levelStyle(def.level);
    const uid = `bg_${def.id}`;
    const dim = unlocked ? '' : 'filter="grayscale(1)" opacity="0.32"';
    const petal = def.level === 'epic' ? 16 : def.level === 'diamond' ? 12 : def.level === 'gold' ? 10 : 8;
    let spikes = '';
    for (let i = 0; i < petal; i++) {
      const ang = (360 / petal) * i;
      spikes += `<rect x="46" y="3" width="8" height="13" rx="3" fill="url(#${uid}_g)" transform="rotate(${ang} 50 50)"/>`;
    }
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="badge-svg">
      <defs>
        <linearGradient id="${uid}_g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${L.from}"/><stop offset="100%" stop-color="${L.to}"/>
        </linearGradient>
        <radialGradient id="${uid}_inner" cx="35%" cy="28%">
          <stop offset="0%" stop-color="#2a3448"/><stop offset="100%" stop-color="#121a29"/>
        </radialGradient>
      </defs>
      <g ${dim}>
        ${spikes}
        <circle cx="50" cy="50" r="40" fill="url(#${uid}_g)"/>
        <circle cx="50" cy="50" r="32" fill="url(#${uid}_inner)" stroke="${L.ring}" stroke-width="2.5"/>
        <text x="50" y="61" text-anchor="middle" font-size="26">${def.icon}</text>
      </g>
    </svg>`;
  }

  /** 渲染完整成就墙 HTML */
  function wallHtml(unlockedMap, filterGroup) {
    const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
    const list = filterGroup && filterGroup !== 'all'
      ? ACHIEVEMENTS.filter((a) => a.group === filterGroup)
      : ACHIEVEMENTS;
    const total = ACHIEVEMENTS.length;
    const got = ACHIEVEMENTS.filter((a) => unlockedMap[a.id]).length;

    const tabs = ['all', ...groups].map((g) =>
      `<button class="ach-tab${(filterGroup || 'all') === g ? ' on' : ''}" data-group="${g}">${g === 'all' ? '全部' : g}</button>`,
    ).join('');

    const cards = list.map((a) => {
      const on = Boolean(unlockedMap[a.id]);
      const at = unlockedMap[a.id];
      const time = at ? new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="ach-card${on ? ' on' : ''}" title="${a.desc}">
        <div class="ach-badge">${badgeSvg(a, on, 64)}</div>
        <div class="ach-meta">
          <div class="ach-name">${a.name}</div>
          <div class="ach-desc">${a.desc}</div>
          <div class="ach-foot">
            <span class="ach-lv lv-${a.level}">${levelStyle(a.level).name}</span>
            <span class="ach-time">${on ? '已解锁 · ' + time : '未解锁'}</span>
          </div>
        </div>
      </div>`;
    }).join('');

    return `
      <div class="ach-head">
        <div class="ach-progress">
          <strong>${got}</strong> / ${total} 已解锁
          <div class="ach-bar"><i style="width:${(got / total * 100).toFixed(0)}%"></i></div>
        </div>
      </div>
      <div class="ach-tabs">${tabs}</div>
      <div class="ach-grid">${cards}</div>
    `;
  }

  const api = { ACHIEVEMENTS, LEVELS, evaluate, byId, badgeSvg, wallHtml, levelStyle };
  global.NetWalkAch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
