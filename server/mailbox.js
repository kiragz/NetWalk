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
 * 拉取收件箱里最新的 NetWalk 存档码
 * @param {object} cfg { mailUser, mailPass, mailImapHost, mailImapPort }
 * @param {Function} [onLog]
 * @returns {Promise<{ok:boolean, code?:string, error?:string}>}
 */
function fetchLatestArchiveCode(cfg, onLog) {
  const log = onLog || (() => {});
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
              if (!ids.length) {
                return fail('收件箱里还没有 NetWalk 存档邮件。先在旧设备上结束一次漫游（会自动把存档码发到邮箱），或到「存档」弹窗手动复制导入');
              }
              lastId = Math.max.apply(null, ids);
              // 5) 取最后一封的正文（PEEK 不标记已读）
              send('FETCH', `FETCH ${lastId} (BODY.PEEK[TEXT])`, (accum2) => {
                const code = extractCode(accum2);
                if (!code) return fail(`第 ${lastId} 封邮件里没找到存档码（NW1. 开头）`);
                log('已从邮箱取回最新存档码（' + Math.round(code.length / 1024 * 10) / 10 + ' KB）');
                finish({ ok: true, code, mailText: accum2 });
                // 6) 礼貌退出（结果已经 resolve，连接随后被销毁）
                try { sock.write('NW0 LOGOUT\r\n'); } catch (_) { /* noop */ }
                return 'stop';
              });
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

module.exports = { fetchLatestArchiveCode, extractCode, imapConfigured };
