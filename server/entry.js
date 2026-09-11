/**
 * 统一入口（源码与打包共用）。
 *
 * - 带 --netwalk-child=<name> 启动 → 只跑对应的采集子进程，不起 HTTP 服务
 * - 否则 → 正常启动 NetWalk 服务
 *
 * 打包时用这个文件作为 pkg 的入口，这样 exe 内部同时具备
 * 「主服务」与「采集子进程」两种角色。
 */
const { childNameFromArgv } = require('./childproc');

const childName = childNameFromArgv(process.argv);

if (childName === 'keyworker') {
  require('./keyworker');
} else if (childName === 'networker') {
  require('./networker');
} else if (childName) {
  console.error('[netwalk] 未知子进程角色: ' + childName);
  process.exit(2);
} else {
  require('./index');
}
