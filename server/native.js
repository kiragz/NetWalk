/**
 * 原生模块（uiohook-napi）运行时释放。
 *
 * 为什么需要它：pkg 快照里的文件是在内存/只读区里的，
 * 进程无法从快照直接 dlopen 一个 .node 原生模块。
 * 所以构建时把「uiohook-napi + node-gyp-build + win32-x64 prebuild」
 * 压成 base64 载荷内嵌进 exe，首次运行时释放到 exe 旁边，再按真实路径 require。
 *
 * 源码模式下 node_modules 就在磁盘上，直接返回 null 让调用方走正常解析。
 */
const fs = require('fs');
const path = require('path');
const { IS_PACKAGED, NATIVE_DIR } = require('./paths');

let cachedDir = null;

/** 释放原生模块，返回可 require 的 node_modules 目录；失败返回 '' */
function ensureUiohook() {
  if (cachedDir !== null) return cachedDir;
  if (!IS_PACKAGED) { cachedDir = ''; return cachedDir; }

  let payload;
  try {
    payload = require('./native-payload');
  } catch (err) {
    console.error('[native] 未找到内嵌原生载荷：' + err.message);
    cachedDir = '';
    return cachedDir;
  }

  const stampFile = path.join(NATIVE_DIR, 'STAMP');
  // 载荷里的键形如 uiohook-napi/package.json，要落到 node_modules/ 下，
  // 这样 Node 的模块解析与 node-gyp-build 的相对查找才都能工作。
  const modulesDir = path.join(NATIVE_DIR, 'node_modules');
  const want = String(payload.version || '1');
  try {
    if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8').trim() === want) {
      cachedDir = modulesDir;
      return cachedDir;
    }
  } catch (_) { /* 重新释放 */ }

  try {
    const files = payload.files || {};
    let wroteAll = true;
    let lastErr = null;
    for (const rel of Object.keys(files)) {
      const dest = path.join(modulesDir, rel);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(files[rel], 'base64'));
      } catch (err) {
        // 单个文件被占用（例如旧版本正在运行）不该让整次释放失败
        wroteAll = false;
        lastErr = err;
      }
    }
    if (wroteAll) {
      try { fs.mkdirSync(NATIVE_DIR, { recursive: true }); fs.writeFileSync(stampFile, want, 'utf8'); } catch (_) { /* 下次再来 */ }
    }
    const usable = fs.existsSync(path.join(modulesDir, 'uiohook-napi', 'package.json'));
    if (!usable && lastErr) console.error('[native] 释放原生模块失败：' + lastErr.message);
    cachedDir = usable ? modulesDir : '';
    return cachedDir;
  } catch (err) {
    console.error('[native] 释放原生模块失败：' + err.message);
    cachedDir = '';
    return cachedDir;
  }
}

/** 给子进程用的环境变量：告诉它去哪儿 require uiohook-napi */
function uiohookEnv() {
  const dir = ensureUiohook();
  return dir ? { NETWALK_UIOHOOK_DIR: dir } : {};
}

module.exports = { ensureUiohook, uiohookEnv };
