/**
 * 运行形态感知的路径解析。
 *
 * 源码运行：数据在 <项目>/data，静态资源在 <项目>/public。
 * 打包运行（pkg）：__dirname 指向只读快照 /snapshot/...，
 *   因此数据目录必须落到 exe 旁边，静态资源仍从快照读取。
 */
const path = require('path');

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

/** 数据目录：环境变量 > 打包时 exe 旁 > 项目 data */
const DATA_DIR = process.env.NETWALK_DATA
  ? path.resolve(process.env.NETWALK_DATA)
  : path.join(APP_ROOT, IS_PACKAGED ? 'NetWalk-data' : 'data');

/** 前端静态资源目录（快照内也能被 fs.readFileSync 读到） */
const PUBLIC_DIR = path.join(BUNDLE_ROOT, 'public');

/** 原生模块（uiohook-napi）释放目录 */
const NATIVE_DIR = process.env.NETWALK_NATIVE_DIR
  ? path.resolve(process.env.NETWALK_NATIVE_DIR)
  : path.join(APP_ROOT, 'NetWalk-native');

module.exports = { IS_PACKAGED, APP_ROOT, BUNDLE_ROOT, DATA_DIR, PUBLIC_DIR, NATIVE_DIR };
