/** 最小探针：加载 app，打印首个页面错误与 NetWalkRepairUtil 是否存在 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(base, 'public', 'index.html'), 'utf8');
const dom = new JSDOM(html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, ''), {
  url: 'http://127.0.0.1:8787/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

const errors = [];
window.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.error && e.error.stack ? e.error.stack.split('\n')[0] : e.message)));
const vc = dom.virtualConsole;
if (vc) vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail && e.detail.stack ? e.detail.stack.split('\n')[0] : e.message)));

// 最小 mock：fetch / WebSocket / localStorage 已由 jsdom 提供 localStorage；这里只 mock fetch 与 WebSocket
window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
window.WebSocket = class { constructor() { setTimeout(() => this.onclose && this.onclose(), 50); } close() {} };
window.navigator.geolocation = window.navigator.geolocation || {};

// 载入脚本（与 ui.js 相同顺序）
const scripts = ['public/js/speed.js', 'public/js/provider-drill.js', 'public/js/engine.js', 'public/js/share.js', 'public/js/report-excel.js', 'public/js/app.js'];
for (const s of scripts) {
  try {
    window.eval(fs.readFileSync(path.join(base, s), 'utf8'));
  } catch (e) {
    errors.push('LOAD ' + s + ': ' + (e.stack || e.message).split('\n')[0]);
  }
}

setTimeout(() => {
  console.log('页面错误数:', errors.length);
  errors.slice(0, 8).forEach((e) => console.log('  - ' + e));
  console.log('NetWalkRepairUtil:', typeof window.NetWalkRepairUtil);
  console.log('NetWalkDebug:', typeof window.NetWalkDebug);
  process.exit(0);
}, 3000);
