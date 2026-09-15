/**
 * 高德可达性诊断的判定逻辑（纯函数，便于单测）。
 * 输入服务端探测结果，输出给用户看的人话结论。
 */
function classifyAmapProbe(p) {
  const r = p || {};
  if (!r.keyed) {
    return '本机没有配置高德 Key —— 到设置里填写，或用「一键同步」从邮箱恢复配置。';
  }
  if (!r.reachable) {
    return `服务端直连高德失败（${r.error || '未知'}，${r.ms || 0}ms）→ 本机网络/DNS 到不了 webapi.amap.com。`
      + '若开了代理/PAC，请把 *.amap.com 设为直连（走境外出口会被高德拒绝）。';
  }
  if (r.keyRejected) {
    return '网络正常，但高德拒绝了这个 Key（无效 / 类型不对 / 被限制）→ 确认 Key 是「Web端(JS API)」'
      + '类型，且没设只允许某些域名的白名单。';
  }
  return `服务端能正常取到高德脚本（${r.ms || 0}ms）→ 网络与服务端没问题，`
    + '失败多半在浏览器一侧：浏览器代理/PAC 把 amap.com 走了境外、扩展拦截、或安全密钥填错。';
}

module.exports = { classifyAmapProbe };
