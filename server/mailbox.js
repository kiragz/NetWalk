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

/** 从存档码解出的时间戳转成可读标签（旧版邮件用） */
function fmtStamp(ms) {
  if (!Number(ms)) return '';
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 解出这份存档「数据实际覆盖到的最新时刻」= 所有轨迹点 / 出发记录 / 采样里最大的 t。
 * 这才是判断"该用哪份继续"的真正依据：
 * payload.at 只是打包时间，一台数据很旧的机器晚打包，at 会很新但数据很旧。
 */
function codeDataInfo(code) {
  const out = { at: 0, dataEndAt: 0, days: 0, points: 0, places: 0 };
  try {
    const { decodeArchive } = require('./archive');
    const p = decodeArchive(code);
    out.at = Number(p && p.at) || 0;
    const tracks = (p && p.tracks) || {};
    out.days = Object.keys(tracks).length;
    for (const day of Object.keys(tracks)) {
      const d = tracks[day] || {};
      for (const arr of [d.path, d.sessions, d.samples, d.rolls]) {
        for (const it of (arr || [])) {
          const t = Number(it && it.t) || 0;
          if (t > out.dataEndAt) out.dataEndAt = t;
          if (arr === d.path) out.points++;
        }
      }
    }
    const places = (p && p.places) || {};
    for (const day of Object.keys(places)) out.places += (places[day] || []).length;
  } catch (_) { /* 解不开就当未知 */ }
  return out;
}
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

/** 解码 MIME 编码字（=?UTF-8?B?...?= / =?UTF-8?Q?...?=），主题里的中文靠它还原 */
function decodeMimeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, charset, enc, data) => {
    try {
      if (String(enc).toUpperCase() === 'B') {
        return Buffer.from(data, 'base64').toString('utf8');
      }
      const q = String(data).replace(/_/g, ' ')
        .replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(q, 'binary').toString('utf8');
    } catch (_) { return m; }
  });
}

/**
 * 从存档邮件主题里解析出「数据时间 + 机器名」。
 * 新格式：`NetWalk 存档 2026-09-16 17:23 · 客厅电脑`
 * 旧格式：`NetWalk 存档码（2026-09-16）` → 只有日期，机器名未知
 * @returns {{dataAt:number, machine:string, label:string, legacy:boolean}}
 */
function parseArchiveSubject(subject) {
  const s = decodeMimeWords(subject).replace(/\s+/g, ' ').trim();
  const m = s.match(/NetWalk\s*存档\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?:\s*·\s*(.*))?/);
  if (m) {
    const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0).getTime();
    const machine = String(m[6] || '').trim();
    return {
      dataAt: Number.isFinite(t) ? t : 0,
      machine,
      label: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` + (machine ? ' · ' + machine : ''),
      legacy: false,
    };
  }
  const d = s.match(/NetWalk\s*存档码?[（(](\d{4})-(\d{2})-(\d{2})[)）]/);
  if (d) {
    // 旧版主题只有日期、没有时刻 → 数据时间视为**未知**（dataAt=0），
    // 这样排序会退到邮件时间，且自动模式会去读正文把真实的数据时间解出来。
    return { dataAt: 0, machine: '', label: `${d[1]}-${d[2]}-${d[3]}（旧版存档，时间/机器名未知）`, legacy: true, dateOnly: `${d[1]}-${d[2]}-${d[3]}` };
  }
  return { dataAt: 0, machine: '', label: s || '(无主题)', legacy: true };
}

/**
 * 候选排序：**数据实际覆盖到的最新时刻排最前**（其次是打包时间，再退到邮件时间）。
 * 这就是「同步没从最新位置继续」的根治点 —— 以前只看邮件到达顺序，
 * 后来到达的邮件可能装的是更旧的数据（另一台机器的每小时自动存档）。
 */
function rankArchiveCandidates(list) {
  return list.slice().sort((a, b) => {
    const ea = Number(a.dataEndAt) || 0, eb = Number(b.dataEndAt) || 0;
    if (eb !== ea) return eb - ea;
    const da = Number(a.dataAt) || 0, db = Number(b.dataAt) || 0;
    if (db !== da) return db - da;
    return (Number(b.mailDate) || 0) - (Number(a.mailDate) || 0);
  });
}

/** 从 header FETCH 响应里取 Subject / Date */
function parseHeaderFetch(raw) {
  const s = String(raw || '');
  let head = s;
  const lit = s.match(/\{(\d+)\}\r?\n/);
  if (lit) {
    const n = Number(lit[1]);
    const start = lit.index + lit[0].length;
    if (Number.isFinite(n) && n > 0) head = s.slice(start, start + n);
  }
  const subj = head.match(/^Subject:\s*([\s\S]*?)(?=\r?\n[A-Za-z-]+:|\r?\n\r?\n|$)/im);
  const date = head.match(/^Date:\s*(.+)$/im);
  const dateMs = date ? Date.parse(date[1].trim()) : 0;
  return {
    subject: subj ? subj[1].replace(/\r?\n\s*/g, ' ').trim() : '',
    mailDate: Number.isFinite(dateMs) ? dateMs : 0,
  };
}

/**
 * 列出 / 挑选存档邮件（单次 IMAP 会话完成）：
 *  - { listOnly: true } → 只列候选（只抓 Subject/Date 头，不下载正文）
 *  - { mailId }         → 取指定那一封的存档码
 *  - 两者都不给          → 按「数据时间最新」排序后逐封尝试，取第一封含存档码的
 * @returns {Promise<{ok:boolean, list?:Array, code?:string, mailText?:string, mailId?:number, picked?:object, error?:string}>}
 */
function pickArchive(cfg, onLog, opts) {
  const log = onLog || (() => {});
  const o = opts || {};
  const limit = Math.max(1, Math.min(30, Number(o.limit) || 12));
  if (!imapConfigured(cfg)) {
    return Promise.resolve({ ok: false, error: '未配置 IMAP：请在设置里填 mailImapHost（如 imap.qq.com）、邮箱账号与授权码' });
  }
  const host = String(cfg.mailImapHost);
  const port = Number(cfg.mailImapPort) || 993;
  const user = String(cfg.mailUser).replace(/"/g, '');
  const pass = String(cfg.mailPass).replace(/"/g, '');

  return new Promise((resolve) => {
    let settled = false, sock = null, buf = '', curTag = '', curName = '', onDone = null, tagN = 0, curTolerate = false;
    const list = [];
    let headerQueue = [];
    let bodyQueue = [];
    let scanQueue = [];
    let timer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (sock) sock.destroy(); } catch (_) { /* noop */ }
      resolve(r);
    };
    const reseTimer = (ms) => { clearTimeout(timer); timer = setTimeout(() => finish({ ok: false, error: `IMAP 超时（${Math.round(ms / 1000)} 秒）：邮箱较大时列存档会慢一些，可稍后再试` }), ms); };
    reseTimer(25000);
    const fail = (msg) => finish({ ok: false, error: msg });
    const send = (name, cmd, done, tolerate) => {
      curTag = 'NW' + (++tagN);
      curName = name;
      onDone = done || null;
      curTolerate = Boolean(tolerate);
      sock.write(curTag + ' ' + cmd + '\r\n');
    };

    const fetchHeaders = () => {
      if (!headerQueue.length) return afterHeaders();
      const id = headerQueue.shift();
      send('FETCHH', `FETCH ${id} (BODY.PEEK[HEADER.FIELDS (SUBJECT DATE)])`, (acc) => {
        const h = parseHeaderFetch(acc);
        const p = parseArchiveSubject(h.subject);
        list.push({ mailId: id, subject: h.subject, mailDate: h.mailDate, dataAt: p.dataAt, machine: p.machine, label: p.label, legacy: p.legacy });
        fetchHeaders();
      });
    };

    const afterHeaders = () => {
      const ranked = rankArchiveCandidates(list);
      if (ranked.length) {
        log('邮箱存档候选：' + ranked.slice(0, 3).map((r) => r.label).join(' / ') + (ranked.length > 3 ? ` …共 ${ranked.length} 封` : ''));
      }
      if (o.mailId) {
        bodyQueue = ranked.filter((r) => Number(r.mailId) === Number(o.mailId));
        if (!bodyQueue.length) return fail(`邮箱里没有第 ${o.mailId} 封存档邮件`);
        return tryNextBody();
      }
      // 需要读正文的情况：
      //  ① 自动挑选（要按"数据实际覆盖到的最新时刻"选，才不会被"数据旧但打包晚"的存档骗到）
      //  ② 列表要附带数据信息（前端选择框里显示「数据到 …」）
      const needScan = o.scanBodies !== false && ranked.length > 1
        && (o.withData || ranked.some((r) => !r.dataAt));
      if (needScan) {
        scanQueue = ranked.slice(0, Math.min(ranked.length, Number(o.scanLimit) || 6));
        log(`将读取最多 ${scanQueue.length} 封存档正文，按「数据实际覆盖到的最新时刻」排序…`);
        try { clearTimeout(timer); } catch (_) {}
        reseTimer(45000);
        return scanBodies();
      }
      if (o.listOnly) { finish({ ok: true, list: ranked }); return; }
      bodyQueue = ranked.slice();
      if (ranked[0]) log('将按「数据最新」优先使用：' + ranked[0].label);
      tryNextBody();
    };

    /** 逐封读正文、解出「打包时间 + 数据覆盖到的最新时刻」，再重排候选 */
    const scanBodies = () => {
      if (!scanQueue.length) {
        const ranked2 = rankArchiveCandidates(list);
        if (o.listOnly) { finish({ ok: true, list: ranked2 }); return; }
        const best = ranked2.filter((r) => r.code)[0];
        if (!best) { bodyQueue = ranked2.slice(); return tryNextBody(); }
        log(`读完正文：数据最新的是 ${best.label}（第 ${best.mailId} 封）`);
        try { sock.write('NW0 LOGOUT\r\n'); } catch (_) { /* noop */ }
        finish({ ok: true, code: best.code, mailText: best.text, mailId: best.mailId, picked: best, list: ranked2 });
        return;
      }
      const cand = scanQueue.shift();
      send('FETCH', `FETCH ${cand.mailId} (BODY.PEEK[TEXT])`, (acc) => {
        const { code, text } = extractCodeFromFetch(acc);
        if (code) {
          const info = codeDataInfo(code);
          cand.code = code;
          cand.text = text;
          cand.dataAt = info.at;
          cand.dataEndAt = info.dataEndAt;
          cand.days = info.days;
          cand.points = info.points;
          cand.places = info.places;
          const endTxt = fmtStamp(info.dataEndAt || info.at);
          cand.label = (endTxt ? endTxt + (info.dataEndAt ? '（数据到）' : '（打包）') : `第 ${cand.mailId} 封`)
            + (cand.machine ? ' · ' + cand.machine : '');
        } else {
          cand.noCode = true;   // 验证码之类的邮件
        }
        scanBodies();
      });
    };

    const tryNextBody = () => {
      if (!bodyQueue.length) {
        return fail('最近这些 NetWalk 邮件里都没有存档码（NW1. 开头）。'
          + '最新的多半是「登录验证码」邮件；请在旧设备上结束一次漫游、或点「⬆ 上传存档」把存档码发到邮箱后再同步。');
      }
      const cand = bodyQueue.shift();
      send('FETCH', `FETCH ${cand.mailId} (BODY.PEEK[TEXT])`, (acc) => {
        const { code, text } = extractCodeFromFetch(acc);
        if (code) {
          log(`已取回存档码：${cand.label}（第 ${cand.mailId} 封，${Math.round(code.length / 1024 * 10) / 10} KB）`);
          try { sock.write('NW0 LOGOUT\r\n'); } catch (_) { /* noop */ }
          finish({ ok: true, code, mailText: text, mailId: cand.mailId, picked: cand, list: rankArchiveCandidates(list) });
          return 'stop';
        }
        tryNextBody();
      });
    };

    const start = () => {
      send('LOGIN', `LOGIN "${user}" "${pass}"`, () => {
        log('IMAP 登录成功');
        send('ID', 'ID ("name" "NetWalk" "version" "1.0.0")', () => {
          send('SELECT', 'SELECT INBOX', () => {
            send('SEARCH', 'SEARCH SUBJECT "NetWalk"', (acc) => {
              const m = acc.match(/\* SEARCH([^\r\n]*)/i);
              const ids = (m ? m[1] : '').trim().split(/\s+/).filter(Boolean).map(Number);
              if (!ids.length) {
                return fail('收件箱里还没有 NetWalk 存档邮件。先在旧设备上结束一次漫游（会自动把存档码发到邮箱），或到「存档」弹窗手动复制导入');
              }
              headerQueue = ids.slice(-limit).reverse();   // 新的先查
              fetchHeaders();
            });
          });
        }, true);
      });
    };

    try {
      sock = tls.connect({ host, port, rejectUnauthorized: false }, () => log(`IMAP 已连接 ${host}:${port}`));
    } catch (err) {
      return finish({ ok: false, error: 'IMAP 连接失败：' + err.message });
    }
    sock.on('error', (err) => { if (!settled) fail('IMAP 错误：' + err.message); });
    sock.on('data', (chunk) => {
      if (settled) return;
      buf += chunk.toString('utf8');
      if (!curTag) {
        if (/\*\s+(OK|PREAUTH)/i.test(buf)) { buf = ''; start(); }
        else if (/\*\s+BYE|^\*\s+NO/i.test(buf)) fail('IMAP 服务器拒绝连接');
        return;
      }
      const re = new RegExp('^' + curTag + '\\s+(OK|NO|BAD)[^\\r\\n]*', 'im');
      const m = buf.match(re);
      if (!m) return;                      // 响应未完整，继续等
      const status = m[1].toUpperCase();
      const whole = buf;
      buf = '';
      if (status !== 'OK') {
        if (curTolerate && onDone) { log(curName + ' 不被该服务器支持，跳过'); if (onDone(whole) === 'stop') return; return; }
        return fail(`${curName} 失败：${whole.slice(0, 150).replace(/\r?\n/g, ' ').trim()}`);
      }
      if (onDone && onDone(whole) === 'stop') return;
    });
    sock.on('close', () => { if (!settled) finish({ ok: false, error: 'IMAP 连接被关闭（检查授权码 / IMAP 服务是否开启）' }); });
  });
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
  fetchLatestArchiveCode, pickArchive, checkInbox, extractCode, imapConfigured,
  decodeBody, extractCodeFromFetch, cleanupMailbox,
  parseArchiveSubject, rankArchiveCandidates, parseHeaderFetch, decodeMimeWords,
};
