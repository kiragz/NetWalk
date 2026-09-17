/**
 * 高德请求的本机代理通道
 *
 * 存在的理由：某些机器上**浏览器**连不到高德（PAC/代理把 amap.com 走了境外、扩展拦截），
 * 但**服务端直连没问题**（见 /api/amapcheck）。此时让浏览器只访问 127.0.0.1，
 * 由本机服务端代取 SDK / 插件 / 切片，就能绕过浏览器侧的代理问题。
 *
 * 安全：只允许白名单内的 https 高德域名（防 SSRF），其余一律拒绝。
 */
const https = require('https');

const ALLOW = [
  /^webapi\.amap\.com$/i,
  /(^|\.)amap\.com$/i,
  /(^|\.)autonavi\.com$/i,
  /(^|\.)amappls\.com$/i,
];

/** 是否允许代理该 URL（必须是 https 且命中高德域名白名单） */
function isAllowedAmapUrl(u) {
  try {
    const x = new URL(String(u || ''));
    if (x.protocol !== 'https:') return false;
    return ALLOW.some((re) => re.test(x.hostname));
  } catch (_) { return false; }
}

/** 内存缓存：SDK/插件/切片都不大，缓存能显著减少重复请求 */
const cache = new Map();
const MAX_ITEMS = 400;
const MAX_BYTES = 40 * 1024 * 1024;
let cacheBytes = 0;

function cacheGet(u) { const it = cache.get(u); if (it) it.at = Date.now(); return it; }
function cachePut(u, item) {
  cacheBytes += item.body.length;
  cache.set(u, item);
  while (cache.size > MAX_ITEMS || cacheBytes > MAX_BYTES) {
    const first = cache.keys().next();
    if (first.done) break;
    const old = cache.get(first.value);
    cacheBytes -= old ? old.body.length : 0;
    cache.delete(first.value);
  }
}
function cacheStats() { return { items: cache.size, bytes: cacheBytes }; }

/** 代取一个高德 URL；跟随最多 3 次跳转 */
function fetchAmap(u, opts) {
  const o = opts || {};
  const timeout = Number(o.timeout) || 12000;
  const useCache = o.cache !== false;
  if (useCache) {
    const hit = cacheGet(u);
    if (hit) return Promise.resolve({ ok: true, status: 200, type: hit.type, body: hit.body, cached: true });
  }
  return new Promise((resolve) => {
    const go = (url, depth) => {
      if (depth > 3) return resolve({ ok: false, error: '跳转过多' });
      let r;
      try {
        r = https.request(url, { method: 'GET', headers: { 'User-Agent': 'NetWalk-amap-proxy', Accept: '*/*' }, timeout }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, url).toString();
            if (!isAllowedAmapUrl(next)) return resolve({ ok: false, error: '跳转到了非白名单域名' });
            return go(next, depth + 1);
          }
          const chunks = [];
          let size = 0;
          res.on('data', (c) => { chunks.push(c); size += c.length; if (size > 12 * 1024 * 1024) r.destroy(); });
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            const type = String(res.headers['content-type'] || 'application/octet-stream');
            const item = { type, body, at: Date.now() };
            if (useCache && res.statusCode === 200 && body.length) cachePut(url, item);
            resolve({ ok: true, status: res.statusCode, type, body });
          });
        });
      } catch (e) { return resolve({ ok: false, error: e.message }); }
      r.on('timeout', () => { r.destroy(); resolve({ ok: false, error: '超时' }); });
      r.on('error', (e) => resolve({ ok: false, error: e.message }));
      r.end();
    };
    go(u, 0);
  });
}

module.exports = { isAllowedAmapUrl, fetchAmap, cacheStats };
