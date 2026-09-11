/**
 * 极简静态文件中间件。
 *
 * 为什么不用 express.static：
 *   它底层走 send → fs.createReadStream + Range 请求处理，
 *   在 pkg 快照里行为不稳定；而本项目的静态资源总共十来个小文件，
 *   用 fs.readFileSync 一次性读出反而更确定、更快。
 */
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * @param {string} rootDir 静态资源根目录（可以是 pkg 快照路径）
 * @returns {import('express').RequestHandler}
 */
function staticMiddleware(rootDir) {
  const root = path.resolve(rootDir);
  return function serveStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let urlPath;
    try {
      urlPath = decodeURIComponent((req.path || '/').split('?')[0]);
    } catch (_) {
      return next();               // 非法百分号编码
    }
    if (urlPath.indexOf('\0') >= 0) return next();

    const rel = urlPath === '/' || urlPath === '' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.resolve(root, rel);

    // 目录穿越防护：解析后的路径必须仍在 root 之内
    if (file !== root && file.indexOf(root + path.sep) !== 0) return next();

    let buf;
    try {
      if (!fs.statSync(file).isFile()) return next();
      buf = fs.readFileSync(file);
    } catch (_) {
      return next();               // 不存在 → 交给后面的 404
    }

    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') return res.end();
    return res.end(buf);
  };
}

module.exports = { staticMiddleware, MIME };
