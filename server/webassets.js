/**
 * 前端静态资源的运行时释放。
 *
 * 打包后 exe 里没有真实文件系统，而页面需要 index.html / css / js 这些真实文件
 * （另外释放到磁盘也意味着用户可以直接改 UI 而不用重新打包）。
 * 构建时把它们内嵌成 base64，首次运行时落到 exe 旁边的 NetWalk-public/。
 *
 * 源码模式下直接返回项目里的 public/，不做任何释放。
 */
const fs = require('fs');
const path = require('path');
const { IS_PACKAGED, APP_ROOT } = require('./paths');

const PUBLIC_DIR = process.env.NETWALK_PUBLIC_DIR
  ? path.resolve(process.env.NETWALK_PUBLIC_DIR)
  : path.join(APP_ROOT, 'NetWalk-public');

let cachedDir = null;

/** 释放前端资源，返回真实可用的目录；失败则返回 '' */
function ensurePublic() {
  if (cachedDir !== null) return cachedDir;
  if (!IS_PACKAGED) { cachedDir = ''; return cachedDir; }

  let payload;
  try {
    payload = require('./public-payload');
  } catch (err) {
    cachedDir = '';
    return cachedDir;
  }

  const stampFile = path.join(PUBLIC_DIR, 'STAMP');
  const want = String(payload.version || '1');
  try {
    if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8').trim() === want) {
      cachedDir = PUBLIC_DIR;
      return cachedDir;
    }
  } catch (_) { /* 重新释放 */ }

  try {
    const files = payload.files || {};
    let lastErr = null;
    for (const rel of Object.keys(files)) {
      const dest = path.join(PUBLIC_DIR, rel);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(files[rel], 'base64'));
      } catch (err) { lastErr = err; }
    }
    try { fs.writeFileSync(stampFile, want, 'utf8'); } catch (_) { /* 下次再来 */ }
    const usable = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));
    if (!usable && lastErr) console.error('[assets] 释放前端资源失败：' + lastErr.message);
    cachedDir = usable ? PUBLIC_DIR : '';
    return cachedDir;
  } catch (err) {
    console.error('[assets] 释放前端资源失败：' + err.message);
    cachedDir = '';
    return cachedDir;
  }
}

module.exports = { ensurePublic, PUBLIC_DIR };
