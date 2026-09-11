/**
 * 旅行者档案：注册（起名 + 邮箱验证码）、出发点一次设定、重置保护。
 *
 * 单机版没有邮件服务，验证码默认走「本地模式」——直接返回给页面显示；
 * 将来接入 SMTP（Nodemailer / 免费 API）后只需替换 sendCode 里的投递实现。
 *
 * 重置保护：必须一字不差输入 RESET_PHRASE 才能执行，防止误删全部数据。
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const FILE = path.join(DATA_DIR, 'profile.json');
const RESET_PHRASE = '我已知重置将删除全部漫游数据且不可恢复';
const CODE_TTL_MS = 10 * 60 * 1000;    // 验证码 10 分钟有效
const CODE_RESEND_MS = 60 * 1000;      // 同一邮箱 60 秒内只能发一次

/** email -> { code, exp, lastSent } */
const codes = new Map();

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return null; }
}

function save(p) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* noop */ }
  fs.writeFileSync(FILE, JSON.stringify(p, null, 2), 'utf8');
}

function exists() { return Boolean(load()); }

function genCode() {
  // 6 位数字；crypto 随机避免可预测
  try {
    const b = require('crypto').randomBytes(4).readUInt32BE(0);
    return String(100000 + (b % 900000));
  } catch (_) {
    return String(100000 + Math.floor(Math.random() * 900000));
  }
}

/**
 * 生成验证码。返回 { ok, delivery, devCode?, error? }
 * - delivery 'local'：单机无邮件服务，devCode 直接给页面显示
 * - delivery 'smtp'：已接入邮件服务，真实发出（预留）
 */
function sendCode(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: '邮箱格式不对' };
  }
  const prev = codes.get(email);
  if (prev && Date.now() - prev.lastSent < CODE_RESEND_MS) {
    return { ok: false, error: '发送太频繁，请 1 分钟后再试' };
  }
  const code = genCode();
  codes.set(email, { code, exp: Date.now() + CODE_TTL_MS, lastSent: Date.now() });
  // TODO: 接入 SMTP / 邮件 API 后，在这里真实发信并返回 { delivery: 'smtp' }
  return { ok: true, delivery: 'local', devCode: code };
}

function verifyCode(rawEmail, rawCode) {
  const email = String(rawEmail || '').trim().toLowerCase();
  const c = codes.get(email);
  if (!c) return false;
  if (Date.now() > c.exp) { codes.delete(email); return false; }
  if (c.code !== String(rawCode || '').trim()) return false;
  codes.delete(email);
  return true;
}

function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at <= 0) return '未绑定';
  const name = s.slice(0, at);
  const shown = name.length <= 2 ? name[0] + '*' : name[0] + '***' + name[name.length - 1];
  return shown + s.slice(at);
}

/** 注册成功后创建档案；origin 为城市中心或前端选定的坐标 */
function register({ name, email, city, origin, originName }) {
  const p = {
    name: String(name || '旅行者').trim().slice(0, 24) || '旅行者',
    email: String(email || '').trim().toLowerCase().slice(0, 80),
    city: String(city || '深圳').slice(0, 24),
    origin: origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat)
      ? { lng: Number(origin.lng), lat: Number(origin.lat) } : null,
    originName: String(originName || '').slice(0, 40),
    createdAt: new Date().toISOString(),
  };
  save(p);
  return p;
}

/** 重置：清档案 + 清全部漫游数据（store 由调用方 forgetAll / 成就由调用方 reset） */
function resetAll({ name, city, origin, originName } = {}) {
  try { fs.rmSync(FILE, { force: true }); } catch (_) { /* noop */ }
  const tracksDir = path.join(DATA_DIR, 'tracks');
  try {
    for (const f of fs.readdirSync(tracksDir)) {
      if (f.endsWith('.json')) fs.rmSync(path.join(tracksDir, f), { force: true });
    }
  } catch (_) { /* 目录不存在就算了 */ }
  if (city || origin) {
    return register({ name: name || '旅行者', email: '', city, origin, originName });
  }
  return null;
}

module.exports = { load, save, exists, sendCode, verifyCode, register, resetAll, maskEmail, RESET_PHRASE };
