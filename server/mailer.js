/**
 * 存档码邮件发送（零依赖 SMTP 客户端，直连 TLS）
 *
 * 为什么不用 PowerShell 的 Send-MailMessage：
 *   它底层是 System.Net.Mail.SmtpClient，只支持 STARTTLS（通常 587），
 *   **不支持 465 端口的隐式 SSL**；而 QQ / 163 默认给的就是 465。
 *   结果就是：配置看着保存成功了，却永远发不出去（旧实现的老毛病）。
 *
 * 这里自己实现最小 SMTP：
 *   - 465 端口：隐式 TLS，tls.connect 直连；
 *   - 587 / 其它端口：明文连接，若服务器声明 STARTTLS 则升级为 TLS；
 *   - 认证：AUTH LOGIN（QQ / 163 / 绝大多数邮箱都支持）。
 *
 * 隐私：邮件正文只有存档码与（可选的）配置区，发件 / 收件都是用户自己的邮箱。
 */
const tls = require('tls');
const net = require('net');

function configured(cfg) {
  return Boolean(cfg && cfg.mailSmtpHost && cfg.mailUser && cfg.mailPass);
}

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }
function rfc2047(s) { return '=?UTF-8?B?' + b64(s) + '?='; }

/** 组装一封 UTF-8 纯文本邮件（正文 base64，避免 8bit / 中文乱码） */
function buildMessage(cfg, to, subject, body) {
  const from = cfg.mailFrom || cfg.mailUser;
  const headers = [
    'From: ' + from,
    'To: ' + to,
    'Subject: ' + rfc2047(subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Date: ' + new Date().toUTCString(),
  ];
  const bodyB64 = b64(body).replace(/(.{76})/g, '$1\r\n');
  return headers.join('\r\n') + '\r\n\r\n' + bodyB64 + '\r\n';
}

/**
 * 极简 SMTP 会话：逐条发命令、等 "NNN " 结束行
 * @returns {Promise<void>}
 */
function smtpSend(opts) {
  const { host, port, user, pass, from, to, raw } = opts;
  const implicit = Number(port) === 465;
  const timeoutMs = Number(opts.timeoutMs) || 25000;

  return new Promise((resolve, reject) => {
    let baseSock = null;
    let stream = null;
    let buf = '';
    let lines = [];
    let waiters = [];
    let done = false;
    let deferredErr = null;

    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (stream) stream.destroy(); } catch (_) { /* noop */ }
      try { if (baseSock && baseSock !== stream) baseSock.destroy(); } catch (_) { /* noop */ }
      if (err) reject(err); else resolve(true);
    };

    const timer = setTimeout(
      () => finish(new Error('SMTP 超时（' + Math.round(timeoutMs / 1000) + ' 秒）：检查网络 / SMTP 服务是否开启')),
      timeoutMs
    );

    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
      flush();
    };
    const onErr = (e) => { deferredErr = e; finish(e); };
    const onClose = () => { if (!done) finish(deferredErr || new Error('SMTP 连接被关闭')); };

    const attach = (s) => { s.on('data', onData); s.on('error', onErr); s.on('close', onClose); };
    const detach = (s) => {
      try { s.removeListener('data', onData); s.removeListener('error', onErr); s.removeListener('close', onClose); } catch (_) { /* noop */ }
    };

    const flush = () => {
      while (waiters.length) {
        const idx = lines.findIndex((l) => /^\d{3} /.test(l));
        if (idx < 0) break;
        const reply = lines.splice(0, idx + 1);
        const code = Number(reply[reply.length - 1].slice(0, 3));
        const w = waiters.shift();
        w.resolve({ code, text: reply.join('\n') });
      }
    };

    const readReply = () => new Promise((res, rej) => {
      if (done) return rej(deferredErr || new Error('连接已关闭'));
      waiters.push({ resolve: res, reject: rej });
      flush();
    });

    const write = (s) => { try { stream.write(s); } catch (e) { deferredErr = e; finish(e); } };
    const cmd = (line) => write(line + '\r\n');

    const expect = async (codes, label) => {
      const r = await readReply();
      const ok = codes.some((c) => String(r.code).startsWith(String(c)));
      if (!ok) {
        const last = r.text.split('\n').pop();
        throw new Error(label + ' 失败（' + r.code + '）：' + last);
      }
      return r;
    };

    const heloName = opts.helo || 'netwalk.local';
    const session = async () => {
      await expect(['220'], '连接问候');
      cmd('EHLO ' + heloName);
      const ehlo = await expect(['250'], 'EHLO');
      if (!implicit && /STARTTLS/i.test(ehlo.text.replace(/\n/g, ' '))) {
        cmd('STARTTLS');
        await expect(['220'], 'STARTTLS');
        detach(stream);                                   // 停止监听明文 socket
        stream = tls.connect({ socket: baseSock, servername: host, rejectUnauthorized: false });
        attach(stream);
        cmd('EHLO ' + heloName);
        await expect(['250'], 'EHLO(TLS)');
      }
      cmd('AUTH LOGIN');
      await expect(['334'], 'AUTH LOGIN');
      cmd(b64(user));
      await expect(['334'], 'AUTH 用户名');
      cmd(b64(pass));
      await expect(['235'], 'AUTH 授权码');
      cmd('MAIL FROM:<' + from + '>');
      await expect(['250'], 'MAIL FROM');
      cmd('RCPT TO:<' + to + '>');
      await expect(['250', '251'], 'RCPT TO');
      cmd('DATA');
      await expect(['354'], 'DATA');
      const safe = raw.replace(/\r\n\./g, '\r\n..');       // 行首点号转义
      write(safe + (safe.slice(-2) === '\r\n' ? '' : '\r\n') + '.\r\n');
      await expect(['250'], '发送正文');
      cmd('QUIT');
      finish(null);
    };

    try {
      baseSock = implicit
        ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
        : net.connect({ host, port });
      stream = baseSock;
      attach(stream);
      session().catch((e) => finish(e));
    } catch (e) {
      finish(e);
    }
  });
}

/** 本机名称：优先用设置里填的，否则取主机名；只用于在存档邮件里区分是哪台设备 */
function machineLabel(cfg) {
  const n = String((cfg && cfg.machineName) || '').trim();
  if (n) return n.slice(0, 24);
  try {
    const os = require('os');
    return String(os.hostname() || '').slice(0, 24) || '未命名设备';
  } catch (_) { return '未命名设备'; }
}

/**
 * 存档邮件主题：带上「数据时间 + 机器名」。
 * 以前只有日期，同一天发多封（每小时自动存档）主题完全一样，
 * 同步时无法判断哪封是哪台机器、哪一刻的数据 —— 会出现"同步了但没从最新位置继续"。
 */
function archiveSubject(cfg) {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `NetWalk 存档 ${stamp} · ${machineLabel(cfg)}`;
}

function archiveBody(archiveCode, extraText, cfg) {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return [
    '这是你的 NetWalk 漫游存档码。',
    '在另一台电脑的 NetWalk 里：点「存档」→ 粘贴到「导入」框 → 点「导入并合并」，即可接着走。',
    '',
    `本机名称：${machineLabel(cfg)}`,
    `数据打包时间：${stamp}`,
    '（同步时 NetWalk 会用「数据打包时间」最新的一份，避免用旧数据覆盖新进度）',
    '',
    '----- 存档码开始 -----',
    archiveCode,
    '----- 存档码结束 -----',
    ...(extraText
      ? ['', '----- 配置信息开始（换设备时在设置里点「从邮箱恢复配置」即可自动填好） -----', extraText, '----- 配置信息结束 -----']
      : []),
    '',
    '存档码只包含漫游数据与成就，不含任何密码。',
  ].join('\r\n');
}

/**
 * 发送存档码邮件（异步）。返回 Promise<{ok, error?}>，不 await 也不会抛错。
 * @param {object} cfg
 * @param {string} to   收件人（务必是完整邮箱，不能是脱敏后的 17***@qq.com）
 * @param {string} archiveCode
 * @param {Function} [onLog]
 * @param {string} [extraText] 配置区文本
 */
function sendArchiveMail(cfg, to, archiveCode, onLog, extraText) {
  const log = onLog || (() => {});
  if (!configured(cfg)) return Promise.resolve({ ok: false, error: '未配置 SMTP（mailSmtpHost / mailUser / mailPass）' });
  if (!to) return Promise.resolve({ ok: false, error: '收件人为空（请先在设置里填邮箱账号）' });
  if (!archiveCode) return Promise.resolve({ ok: false, error: '存档码为空' });
  const raw = buildMessage(cfg, to, archiveSubject(cfg), archiveBody(archiveCode, extraText, cfg));
  return smtpSend({
    host: cfg.mailSmtpHost,
    port: Number(cfg.mailSmtpPort) || 465,
    user: String(cfg.mailUser).replace(/"/g, ''),
    pass: String(cfg.mailPass).replace(/"/g, ''),
    from: String(cfg.mailFrom || cfg.mailUser).replace(/"/g, ''),
    to: String(to).replace(/"/g, ''),
    raw,
  }).then(() => {
    log(`存档码已发送到邮箱 ${to}`);
    return { ok: true };
  }).catch((e) => {
    const msg = e && e.message ? e.message : String(e);
    log('存档码邮件发送失败：' + msg);
    return { ok: false, error: msg };
  });
}

/**
 * 发送一封普通纯文本邮件（验证码 / 通知用）。
 * 与存档码邮件共用同一套 SMTP 通道，返回 { ok, error? }。
 */
function sendMail(cfg, to, subject, body) {
  if (!configured(cfg)) return Promise.resolve({ ok: false, error: '未配置 SMTP（mailSmtpHost / mailUser / mailPass）' });
  if (!to) return Promise.resolve({ ok: false, error: '收件人为空' });
  const raw = buildMessage(cfg, to, subject, String(body || ''));
  return smtpSend({
    host: cfg.mailSmtpHost,
    port: Number(cfg.mailSmtpPort) || 465,
    user: String(cfg.mailUser).replace(/"/g, ''),
    pass: String(cfg.mailPass).replace(/"/g, ''),
    from: String(cfg.mailFrom || cfg.mailUser).replace(/"/g, ''),
    to: String(to).replace(/"/g, ''),
    raw,
  }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: (e && e.message) ? e.message : String(e) }));
}

/** 兼容旧调用点：只需要布尔「是否已发起」时用 */
function sendArchiveMailNow() { return sendArchiveMail.apply(null, arguments); }

module.exports = {
  sendArchiveMail, sendArchiveMailNow, sendMail,
  smtpSend, buildMessage, configured: configured, mailConfigured: configured,
  archiveSubject, machineLabel,
};
