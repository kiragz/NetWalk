/**
 * 账号（单机多档案）
 *
 * 设计：
 *   - 账号 = 一个独立的数据目录 DATA_DIR/accounts/<id>/（轨迹、成就、配置完全隔离）
 *   - active.json 记录当前账号，服务启动时据此选择数据目录
 *   - 验证码只存内存、5 分钟过期；未配置邮件服务时直接回显给用户（本地单机，无泄露风险）
 *     预留 mail 配置：将来在 config.json 加 mail.smtp 即可切到真实发信
 *   - 隐私：email 只存 sha1 哈希和脱敏显示形式，不存明文
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AccountStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.file = path.join(baseDir, 'accounts.json');
    this.activeFile = path.join(baseDir, 'active.json');
    this.codes = new Map();           // email -> { code, exp, tries }
    fs.mkdirSync(baseDir, { recursive: true });
  }

  _read(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
  }
  _write(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  list() { return this._read(this.file, []); }
  save(list) { this._write(this.file, list); }

  hashEmail(email) {
    return crypto.createHash('sha1').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 16);
  }
  maskEmail(email) {
    const s = String(email).trim();
    const at = s.indexOf('@');
    if (at <= 1) return s.slice(0, 1) + '***' + s.slice(at);
    return s.slice(0, 2) + '***' + s.slice(at);
  }

  findByEmail(email) {
    const id = this.hashEmail(email);
    return this.list().find((a) => a.id === id) || null;
  }
  findById(id) {
    return this.list().find((a) => a.id === id) || null;
  }

  create(email, name) {
    const list = this.list();
    const id = this.hashEmail(email);
    const acc = {
      id,
      email: this.maskEmail(email),
      name: String(name || '').trim().slice(0, 20) || '旅行者',
      createdAt: new Date().toISOString(),
    };
    const i = list.findIndex((a) => a.id === id);
    if (i >= 0) list[i] = acc; else list.push(acc);
    this.save(list);
    return acc;
  }

  rename(id, name) {
    const list = this.list();
    const acc = list.find((a) => a.id === id);
    if (!acc) return null;
    acc.name = String(name || '').trim().slice(0, 20) || acc.name;
    this.save(list);
    return acc;
  }

  /** 生成验证码；返回 { code }（调用方决定是发邮件还是直显） */
  issueCode(email) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.codes.set(String(email).trim().toLowerCase(), {
      code, exp: Date.now() + 5 * 60 * 1000, tries: 0,
    });
    return code;
  }

  verifyCode(email, code) {
    const key = String(email).trim().toLowerCase();
    const rec = this.codes.get(key);
    if (!rec) return { ok: false, error: '请先获取验证码' };
    if (Date.now() > rec.exp) { this.codes.delete(key); return { ok: false, error: '验证码已过期，请重新获取' }; }
    rec.tries += 1;
    if (rec.tries > 6) { this.codes.delete(key); return { ok: false, error: '尝试次数过多，请重新获取' }; }
    if (String(code).trim() !== rec.code) return { ok: false, error: '验证码不正确' };
    this.codes.delete(key);
    return { ok: true };
  }

  /** 当前账号（服务启动时应读一次，决定数据目录） */
  getActive() { return this._read(this.activeFile, null); }
  setActive(acc) { this._write(this.activeFile, acc ? { id: acc.id, name: acc.name, email: acc.email } : null); }
  clearActive() { this._write(this.activeFile, null); }
}

module.exports = { AccountStore };
