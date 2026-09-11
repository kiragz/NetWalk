/**
 * 存档码邮件发送（用系统自带 PowerShell Send-MailMessage，无需额外依赖）
 *
 * 前提：config.json 里配置
 *   mailSmtpHost  例如 smtp.qq.com
 *   mailSmtpPort  例如 465（SSL）或 587（STARTTLS）
 *   mailUser      例如 xxx@qq.com
 *   mailPass      授权码（不是登录密码；QQ/163 需在邮箱设置里开启 SMTP 并生成授权码）
 *   mailFrom      发件人（一般与 mailUser 相同，可省略）
 *
 * 单机隐私说明：邮件内容只有存档码（本机漫游数据），不含 Key / 密码。
 */
const { spawn } = require('child_process');

function configured(cfg) {
  return Boolean(cfg && cfg.mailSmtpHost && cfg.mailUser && cfg.mailPass);
}

/** 把 PowerShell 单引号字符串转义（' -> ''） */
function psq(s) {
  return String(s == null ? '' : s).replace(/'/g, "''").replace(/[\r\n]+/g, ' ').slice(0, 900);
}

/**
 * 发送存档码邮件；fire-and-forget，结果通过 onLog 回调输出
 * @returns {boolean} 是否已发起（不代表送达）
 */
function sendArchiveMail(cfg, to, archiveCode, onLog, extraText) {
  if (!configured(cfg) || !to || !archiveCode) return false;
  const log = onLog || (() => {});
  const from = cfg.mailFrom || cfg.mailUser;
  const port = Number(cfg.mailSmtpPort) || 465;
  const subject = `NetWalk 存档码（${new Date().toISOString().slice(0, 10)}）`;
  const body = [
    '这是你的 NetWalk 漫游存档码。',
    '在另一台电脑的 NetWalk 里：点「存档」→ 粘贴到「导入」框 → 点「导入并合并」，即可接着走。',
    '',
    '----- 存档码开始 -----',
    archiveCode,
    '----- 存档码结束 -----',
    ...(extraText ? ['', '----- 配置信息开始（换设备时在设置里点「从邮箱恢复配置」即可自动填好） -----', extraText, '----- 配置信息结束 -----'] : []),
    '',
    '存档码只包含漫游数据与成就，不含任何密码。',
  ].join('\r\n');

  const ps = [
    `$secpass = ConvertTo-SecureString '${psq(cfg.mailPass)}' -AsPlainText -Force;`,
    `$cred = New-Object System.Management.Automation.PSCredential('${psq(cfg.mailUser)}', $secpass);`,
    `Send-MailMessage -From '${psq(from)}' -To '${psq(to)}' -Subject '${psq(subject)}' -Body '${psq(body)}'`,
    `-SmtpServer '${psq(cfg.mailSmtpHost)}' -Port ${port} -UseSsl -Credential $cred -Encoding UTF8`,
  ].join(' ');

  try {
    const proc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    proc.on('error', (e) => log(`存档码邮件发送失败：${e.message}`));
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('exit', (code) => {
      if (code === 0) log(`存档码已发送到邮箱 ${to}`);
      else log(`存档码邮件发送失败（exit=${code}）${err ? '：' + err.trim().split('\n')[0].slice(0, 120) : ''}`);
    });
    proc.unref();
    return true;
  } catch (err) {
    log('存档码邮件发送失败：' + (err && err.message ? err.message : err));
    return false;
  }
}

module.exports = { sendArchiveMail, configured: mailConfigured };
function mailConfigured(cfg) { return configured(cfg); }
