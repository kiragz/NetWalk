/**
 * 从邮箱拉取最新存档码（零依赖 IMAP 客户端）
 *
 * 与 mailer.js 的「发」配对：出发时从收件箱把最新存档码取回来，
 * 比本地新就自动导入 —— 换设备 / 重装后打开就能从上次结束点继续走。
 *
 * 原理：TLS 直连 IMAP 993，LOGIN（QQ/163 用授权码）→ SELECT INBOX →
 * SEARCH 主题含「NetWalk」→ FETCH 最新一封正文 → 提取 NW1. 开头的存档码。
 * 只实现本项目需要的最小命令集：逐条发送、等该条 tag 的完成行、再发下一条。
 *
 * 隐私：只读自己收件箱里带 NetWalk 主题的邮件，只提取存档码。
 */
const tls = require('tls');

function imapConfigured(cfg) {
  return Boolean(cfg && cfg.mailUser && cfg.mailPass && cfg.mailImapHost);
}

/** 从邮件文本提取存档码（NW1. + base64url 字符集） */
function extractCode(text) {
  const m = String(text || '').match(/NW1\.[A-Za-z0-9_\-]{16,}/);
  return m ? m[0] : null;
}

/**
 * 把 IMAP FETCH 的响应还原成邮件正文明文。
 *
 * 关键：我们发出去的邮件用的是 `Content-Transfer-Encoding: base64`
 * （见 mailer.buildMessage），所以 `BODY.PEEK[TEXT]` 拿回来的是 **base64 密文**，
 * 直接在密文里找 `NW1.` 永远找不到 —— 这正是"一键同步说没找到存档码"的真因。
 * 这里按 literal 长度精确截出正文并解码。
 */
function decodeBody(raw) {
  const s = String(raw || '');
  const m = s.match(/\{(\d+)\}\r?\n/);
  let body = s;
  if (m) {
    const n = Number(m[1]);
    const start = m.index + m[0].length;
    if (Number.isFinite(n) && n > 0) body = s.slice(start, start + n);
  }
  const compact = body.replace(/\s+/g, '');
  // 头部声明了 base64，或者正文本身就是纯 base64 字符集 → 解一次
  const looksB64 = /Content-Transfer-Encoding:\s*base64/i.test(s)
    || (compact.length > 40 && /^[A-Za-z0-9+/=]+$/.test(compact));
  if (looksB64) {
    try {
      const dec = Buffer.from(compact, 'base64').toString('utf8');
      if (dec && dec.length) return dec;
    } catch (_) { /* 解不开就退回原文 */ }
  }
  return body;
}

/** 从 FETCH 响应里取正文并抽出存档码（先解码，再找） */
function extractCodeFromFetch(raw) {
  const text = decodeBody(raw);
  const code = extractCode(text);
  return {
    code,
    text: code ? text : decodeBody(raw),
  };
}

/**
 * 拉取收件箱里最新的 NetWalk 存档码
 * @param {object} cfg { mailUser, mailPass, mailImapHost, mailImapPort }
 * @param {Function} [onLog]
 * @param {object} [opts] { mode: 'fetch'(默认) | 'status' }
 *        status 模式只做 SEARCH，返回 { count, latestId }，用于「邮箱里有没有存档」指示灯
 * @returns {Promise<{ok:boolean, code?:string, count?:number, error?:string}>}
 */
function fetchLatestArchiveCode(cfg, onLog, opts) {
  const log = onLog || (() => {});
  const mode = (opts && opts.mode) || 'fetch';
  if (!imapConfigured(cfg)) {
    return Promise.resolve({ ok: false, error: '未配置 IMAP：请在设置里填 mailImapHost（如 imap.qq.com）、邮箱账号与授权码' });
  }
  const host = String(cfg.mailImapHost);
  const port = Number(cfg.mailImapPort) || 993;
  const user = String(cfg.mailUser).replace(/"/g, '');
  const pass = String(cfg.mailPass).replace(/"/g, '');

  return new Promise((resolve) => {
    let settled = false;
    let sock = null;
    let buf = '';
    let resp = '';            // 当前命令的累计响应（tag 完成行之前的一切）
    let curTag = '';
    let curName = '';
    let onDone = null;        // 当前命令成功后的处理，返回 'stop' 就结束
    let tagN = 0;
    let lastId = 0;
    let curTolerate = false;

    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (sock) sock.destroy(); } catch (_) { /* noop */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'IMAP 超时（15 秒）：服务器长时间无响应，检查 IMAP 服务是否已在邮箱后台开启' }), 15000);
    const fail = (msg) => finish({ ok: false, error: msg });

    // tolerate：某些服务器不认识该命令（如 ID）返回 BAD/NO 时照常继续
    const send = (name, cmd, done, tolerate) => {
      curTag = 'NW' + (++tagN);
      curName = name;
      onDone = done || null;
      curTolerate = Boolean(tolerate);
      resp = '';
      sock.write(curTag + ' ' + cmd + '\r\n');
    };

    const start = () => {
      // 1) LOGIN
      send('LOGIN', `LOGIN "${user}" "${pass}"`, () => {
        log('IMAP 登录成功');
        // 2) ID 自报身份 —— QQ/163 等国内邮箱的硬性要求：
        //    不发这条的话 LOGIN 能成功，但后续 SELECT/SEARCH 会被服务器静默挂起（表现为"一直连接中"）。
        //    个别服务器不支持 ID 命令，返回 BAD/NO 时容忍继续。
        send('ID', 'ID ("name" "NetWalk" "version" "1.0.0")', () => {
          // 3) SELECT INBOX
          send('SELECT', 'SELECT INBOX', () => {
            // 4) SEARCH 主题含 NetWalk 的邮件
            send('SEARCH', 'SEARCH SUBJECT "NetWalk"', (accumulated) => {
              const m = accumulated.match(/\* SEARCH([^\r\n]*)/i);
              const ids = (m ? m[1] : '').trim().split(/\s+/).filter(Boolean).map(Number);
              // 只查数量（指示灯用）：不做 FETCH，直接返回
              if (mode === 'status') {
                log(ids.length ? ('邮箱里已有 ' + ids.length + ' 封 NetWalk 邮件') : '邮箱里还没有 NetWalk 邮件');
                finish({ ok: true, count: ids.length, latestId: ids.length ? Math.max.apply(null, ids) : null });
                return 'stop';
              }
              if (!ids.length) {
                return fail('收件箱里还没有 NetWalk 存档邮件。先在旧设备上结束一次漫游（会自动把存档码发到邮箱），或到「存档」弹窗手动复制导入');
              }
              lastId = Math.max.apply(null, ids);
              // 5) 从最近的邮件往前找"带存档码"的那封（PEEK 不标记已读）。
              //    不能只看最新一封：0.8.7 起「登录验证码」邮件主题也含 NetWalk，
              //    最新一封往往正是验证码邮件（不含 NW1. 存档码）。
              const queue = ids.slice(-15).reverse();
              let qi = 0;
              const tryNext = () => {
                if (qi >= queue.length) {
                  return fail(`最近 ${queue.length} 封 NetWalk 邮件里都没有存档码（NW1. 开头）。`
                    + '最新的多半是「登录验证码」邮件；请在旧设备上结束一次漫游、或点「⬆ 上传存档」把存档码发到邮箱后再同步。'
                    + '也可以直接从旧设备复制存档码，用「存档」弹窗手动导入。');
                }
                const id = queue[qi++];
                send('FETCH', `FETCH ${id} (BODY.PEEK[TEXT])`, (accum2) => {
                  const { code, text } = extractCodeFromFetch(accum2);
                  if (code) {
                    log('已从邮箱第 ' + id + ' 封取回存档码（' + Math.round(code.length / 1024 * 10) / 10 + ' KB）');
                    finish({ ok: true, code, mailText: text, mailId: id });
                    // 6) 礼貌退出（结果已经 resolve，连接随后被销毁）
                    try { sock.write('NW0 LOGOUT\r\n'); } catch (_) { /* noop */ }
                    return 'stop';
                  }
                  tryNext();   // 这封是验证码之类的，继续往前找
                });
              };
              tryNext();
            });
          });
        }, true /* ID 失败也继续 */);
      });
    };

    try {
      sock = tls.connect({ host, port, rejectUnauthorized: false }, () => {
        log(`IMAP 已连接 ${host}:${port}`);
      });
    } catch (err) {
      return finish({ ok: false, error: 'IMAP 连接失败：' + err.message });
    }

    sock.on('error', (err) => {
      // finish 后的 destroy 会触发 EPIPE，忽略
      if (!settled) fail('IMAP 错误：' + err.message);
    });

    sock.on('data', (chunk) => {
      if (settled) return;
      buf += chunk.toString('utf8');
      // 还没发第一条命令：等服务器问候（* OK ...）—— greeting 到了就登录
      if (!curTag) {
        if (/\*\s+(OK|PREAUTH)/i.test(buf)) { buf = ''; start(); }
        else if (/\*\s+BYE|^\*\s+NO/i.test(buf)) fail('IMAP 服务器拒绝连接');
        return;
      }
      // 当前命令的完成行：A<n> OK/NO/BAD
      const re = new RegExp('^' + curTag + '\\s+(OK|NO|BAD)[^\\r\\n]*', 'im');
      const m = buf.match(re);
      if (!m) {
        resp += '';   // 响应未完整，继续等（buf 本身就是累计缓冲）
        return;
      }
      const status = m[1].toUpperCase();
      const whole = buf;
      buf = '';
      if (status !== 'OK') {
        if (curTolerate && onDone) {
          log(curName + ' 不被该服务器支持，跳过');
          const r = onDone(whole);
          if (r === 'stop') return;
          return;
        }
        return fail(`${curName} 失败：${whole.slice(0, 150).replace(/\r?\n/g, ' ').trim()}`);
      }
      if (onDone) {
        const r = onDone(whole);
        if (r === 'stop') return;
      }
      // 继续下一条（onDone 里已经 send 了；没有 send 就说明流程该结束了）
    });

    sock.on('close', () => {
      if (!settled) finish({ ok: false, error: 'IMAP 连接被关闭（检查授权码 / IMAP 服务是否开启）' });
    });
  });
}

/**
 * 清理旧存档邮件：只保留最新一封，其余带 NetWalk 主题的逐封标记删除并 EXPUNGE。
 * 逐封 STORE（不能用数字区间）—— 区间会把夹在中间的无关邮件也标上删除标记。
 */
function cleanupMailbox(cfg, onLog) {
  const log = onLog || (() => {});
  if (!imapConfigured(cfg)) {
    return Promise.resolve({ ok: false, error: '未配置 IMAP：请在设置里填 mailImapHost（如 imap.qq.com）、邮箱账号与授权码' });
  }
  const host = String(cfg.mailImapHost);
  const port = Number(cfg.mailImapPort) || 993;
  const user = String(cfg.mailUser).replace(/"/g, '');
  const pass = String(cfg.mailPass).replace(/"/g, '');

  return new Promise((resolve) => {
    let settled = false, sock = null, buf = '', curTag = '', onDone = null, tagN = 0;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (sock) sock.destroy(); } catch (_) { /* noop */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'IMAP 超时（60 秒）：邮件较多时清理会慢一些，可稍后再试' }), 60000);
    const send = (name, cmd, done) => { curTag = 'NW' + (++tagN); onDone = done || null; sock.write(curTag + ' ' + cmd + '\r\n'); };
    const start = () => {
      send('LOGIN', `LOGIN "${user}" "${pass}"`, () => {
        send('ID', 'ID ("name" "NetWalk" "version" "1.0.0")', () => {
          send('SELECT', 'SELECT INBOX', () => {
            send('SEARCH', 'SEARCH SUBJECT "NetWalk"', (acc) => {
              const m = acc.match(/\* SEARCH([^\r\n]*)/i);
              const ids = (m ? m[1] : '').trim().split(/\s+/).filter(Boolean).map(Number);
              if (ids.length <= 1) {
                const msg = ids.length ? '邮箱里只有 1 封 NetWalk 邮件，无需清理' : '邮箱里没有 NetWalk 邮件，无需清理';
                log(msg); finish({ ok: true, deleted: 0, kept: ids.length }); return 'stop';
              }
              const keepId = Math.max.apply(null, ids);
              const del = ids.filter((x) => x !== keepId);
              log(`邮箱里共 ${ids.length} 封 NetWalk 邮件，保留最新一封（第 ${keepId} 封），正在清理其余 ${del.length} 封…`);
              let i = 0;
              const delNext = () => {
                if (i >= del.length) {
                  send('EXPUNGE', 'EXPUNGE', () => {
                    log(`清理完成：已删除 ${del.length} 封旧邮件`);
                    finish({ ok: true, deleted: del.length, kept: 1, keepId }); return 'stop';
                  });
                  return;
                }
                const id = del[i++];
                send('STORE', `STORE ${id} +FLAGS.SILENT (\\Deleted)`, () => delNext());
              };
              delNext();
            });
          });
        }, true);
      });
    };
    try {
      sock = tls.connect({ host, port, rejectUnauthorized: false }, () => { /* 已连接 */ });
    } catch (err) {
      return finish({ ok: false, error: 'IMAP 连接失败：' + err.message });
    }
    sock.on('error', (err) => { if (!settled) finish({ ok: false, error: 'IMAP 错误：' + err.message }); });
    sock.on('data', (chunk) => {
      if (settled) return;
      buf += chunk.toString('utf8');
      if (!curTag) {
        if (/\*\s+(OK|PREAUTH)/i.test(buf)) { buf = ''; start(); }
        else if (/\*\s+BYE|^\*\s+NO/i.test(buf)) finish({ ok: false, error: 'IMAP 服务器拒绝连接' });
        return;
      }
      const re = new RegExp('^' + curTag + '\\s+(OK|NO|BAD)[^\\r\\n]*', 'im');
      const m = buf.match(re);
      if (!m) return;
      const status = m[1].toUpperCase();
      const whole = buf; buf = '';
      if (status !== 'OK') return finish(`${'IMAP 命令失败'}：${whole.slice(0, 150).replace(/\r?\n/g, ' ').trim()}`);
      if (onDone) { const r = onDone(whole); if (r === 'stop') return; }
    });
    sock.on('close', () => { if (!settled) finish({ ok: false, error: 'IMAP 连接被关闭（检查授权码 / IMAP 服务是否开启）' }); });
  });
}

/** 只检查收件箱里有多少封 NetWalk 存档邮件（不下载正文） */
function checkInbox(cfg, onLog) {
  return fetchLatestArchiveCode(cfg, onLog, { mode: 'status' });
}

module.exports = {
  fetchLatestArchiveCode, checkInbox, extractCode, imapConfigured,
  decodeBody, extractCodeFromFetch, cleanupMailbox,
};
