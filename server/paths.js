/**
 * 运行形态感知的路径解析。
 *
 * 数据目录策略（v0.8.3 起）：
 *   打包运行时，数据**固定**放在用户目录 `%LOCALAPPDATA%\NetWalk-data`，
 *   **不再紧贴 exe**。原因：exe 只要换个文件夹 / 多存一份，数据目录就跟着变，
 *   于是出现好几个空的 NetWalk-data —— 表现为「邮箱配置丢了、存档看不到了，
 *   每次都要重设」。固定后无论从哪个副本启动，读写的都是同一份数据。
 *
 *   首次启动若固定目录还没有数据，会自动从「exe 旁 / 上一级目录旁」的旧
 *   NetWalk-data 里迁移一份（复制，不删原目录）。
 *
 *   需要自定义时用环境变量 NETWALK_DATA 覆盖。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

/** 是否运行在 Node SEA（Single Executable Application）里 */
let IS_SEA = false;
try { IS_SEA = Boolean(require('node:sea').isSea()); } catch (_) { IS_SEA = false; }

/** 是否运行在打包后的单文件 exe 里（pkg 或 SEA 都算） */
const IS_PACKAGED = typeof process.pkg !== 'undefined' || IS_SEA || process.env.NETWALK_PACKAGED === '1';

/** exe 所在目录（打包）/ 项目根目录（源码） */
const APP_ROOT = IS_PACKAGED
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..');

/** 代码与静态资源所在根（打包后是快照路径，只读） */
const BUNDLE_ROOT = path.resolve(__dirname, '..');

/** 固定的数据目录（打包运行）：%LOCALAPPDATA%\NetWalk-data */
const STABLE_DATA_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'NetWalk-data')
  : path.join(os.homedir(), '.netwalk-data');

/** exe 旁边的旧数据目录（兼容 / 迁移来源） */
const ADJACENT_DATA_DIR = path.join(APP_ROOT, 'NetWalk-data');

/** 某个目录里是否已经有"真数据" */
function looksLikeData(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    if (fs.existsSync(path.join(dir, 'config.json'))) return true;
    if (fs.existsSync(path.join(dir, 'accounts.json'))) return true;
    if (fs.existsSync(path.join(dir, 'profile.json'))) return true;
    const t = path.join(dir, 'tracks');
    if (fs.existsSync(t) && fs.readdirSync(t).some((x) => x.endsWith('.json'))) return true;
  } catch (_) { /* noop */ }
  return false;
}

/** 递归统计某目录内 json 数据量（字节），用于挑"数据最多"的来源 */
function dataSize(dir) {
  let n = 0;
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    let items = [];
    try { items = fs.readdirSync(d); } catch (_) { return; }
    for (const name of items) {
      const p = path.join(d, name);
      let st;
      try { st = fs.statSync(p); } catch (_) { continue; }
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.json')) n += st.size;
    }
  };
  walk(dir);
  return n;
}

/** 递归复制（目标已存在的文件不覆盖，避免盖掉更新的一份） */
function copyDirIfAbsent(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let items = [];
  try { items = fs.readdirSync(src); } catch (_) { return; }
  for (const name of items) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    let st;
    try { st = fs.statSync(s); } catch (_) { continue; }
    if (st.isDirectory()) copyDirIfAbsent(s, d);
    else if (!fs.existsSync(d)) { try { fs.copyFileSync(s, d); } catch (_) { /* noop */ } }
  }
}

/** 打包运行时的数据目录：固定目录优先；还没有就从旧位置迁移一次 */
function resolvePackagedDataDir() {
  if (looksLikeData(STABLE_DATA_DIR)) return STABLE_DATA_DIR;

  const candidates = [
    ADJACENT_DATA_DIR,
    path.join(path.dirname(APP_ROOT), 'NetWalk-data'),
  ].filter((d) => path.resolve(d) !== path.resolve(STABLE_DATA_DIR));

  // 多个候选都有数据时，挑 json 体积最大的那个
  let best = null;
  let bestSize = -1;
  for (const c of candidates) {
    if (!looksLikeData(c)) continue;
    const size = dataSize(c);
    if (size > bestSize) { best = c; bestSize = size; }
  }
  if (best) {
    try { copyDirIfAbsent(best, STABLE_DATA_DIR); } catch (_) { /* noop */ }
    try {
      fs.writeFileSync(path.join(STABLE_DATA_DIR, 'MIGRATED_FROM.txt'),
        '数据已从旧的 exe 旁目录迁移到固定目录（原目录未删除，可自行清理）：\r\n'
        + best + '\r\n迁移时间：' + new Date().toISOString() + '\r\n', 'utf8');
    } catch (_) { /* noop */ }
  }
  return STABLE_DATA_DIR;
}

/** 数据目录：环境变量 > 打包固定目录 > 项目 data */
const DATA_DIR = process.env.NETWALK_DATA
  ? path.resolve(process.env.NETWALK_DATA)
  : (IS_PACKAGED ? resolvePackagedDataDir() : path.join(APP_ROOT, 'data'));

/** 前端静态资源目录（快照内也能被 fs.readFileSync 读到） */
const PUBLIC_DIR = path.join(BUNDLE_ROOT, 'public');

/** 原生模块（uiohook-napi）释放目录 */
const NATIVE_DIR = process.env.NETWALK_NATIVE_DIR
  ? path.resolve(process.env.NETWALK_NATIVE_DIR)
  : path.join(APP_ROOT, 'NetWalk-native');

module.exports = {
  IS_PACKAGED, APP_ROOT, BUNDLE_ROOT, DATA_DIR,
  STABLE_DATA_DIR, ADJACENT_DATA_DIR, PUBLIC_DIR, NATIVE_DIR,
  looksLikeData, dataSize, copyDirIfAbsent,
};
