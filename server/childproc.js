/**
 * 统一的采集子进程启动器。
 *
 * 打包后 exe 里没有可 fork 的独立 .js 文件（代码都在只读快照里），
 * 所以改用「同一个可执行文件 + --netwalk-child=<name> 标记」启动子进程，
 * 由 server/entry.js 分流。用 spawn 的 'ipc' stdio 即可保留 process.send 通道。
 *
 * 源码模式下也用同一套机制，只是把 entry.js 作为脚本传给 node，
 * 这样源码与打包两条路径的行为完全一致，避免「本地能跑、打包就废」。
 */
const path = require('path');
const { spawn } = require('child_process');
const { IS_PACKAGED } = require('./paths');

/** 允许的子进程名 */
const CHILDREN = ['keyworker', 'networker'];

const FLAG_PREFIX = '--netwalk-child=';

/** 从 argv 里取出子进程角色（供 entry.js 使用） */
function childNameFromArgv(argv) {
  const hit = (argv || []).find((a) => typeof a === 'string' && a.startsWith(FLAG_PREFIX));
  if (!hit) return null;
  const name = hit.slice(FLAG_PREFIX.length);
  return CHILDREN.includes(name) ? name : null;
}

/**
 * 启动一个采集子进程，带 IPC 通道。
 * @param {'keyworker'|'networker'} name
 * @param {Record<string,string>} [extraEnv]
 * @returns {import('child_process').ChildProcess}
 */
function spawnChild(name, extraEnv) {
  if (!CHILDREN.includes(name)) throw new Error('未知子进程: ' + name);

  const opts = {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: Object.assign({}, process.env, extraEnv || {}),
    windowsHide: true,
  };

  if (IS_PACKAGED) {
    // pkg 对打包内应用发起的所有 spawn 都会注入 PKG_EXECPATH=本 exe，
    // 子进程的 bootstrap 因此走「argv[1] = 要执行的脚本」分支（见
    // pkg prelude/bootstrap.js）。所以第一个参数必须是快照内的入口脚本
    // （打包父进程里 process.argv[1] 恰好就是它），角色标记跟在后面，
    // 由 server/entry.js 里的 childNameFromArgv 解析。
    return spawn(process.execPath, [process.argv[1], FLAG_PREFIX + name], opts);
  }
  // 源码模式：node <entry.js> --netwalk-child=<name>
  return spawn(process.execPath, [path.join(__dirname, 'entry.js'), FLAG_PREFIX + name], opts);
}

module.exports = { spawnChild, childNameFromArgv, CHILDREN, FLAG_PREFIX };
