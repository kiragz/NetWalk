/**
 * 从磁盘真实路径加载「外部」模块。
 *
 * 为什么需要它：在 Node SEA（单文件 exe）里，运行时的 require 只能解析内置模块，
 * 用 `require('C:/.../node_modules/x')` 这种绝对路径会抛 ERR_UNKNOWN_BUILTIN_MODULE。
 * 必须借 module.createRequire() 建一个锚定在真实目录上的 require，才能正常走
 * node_modules 解析。
 *
 * 源码模式下同样可用（只是没必要），所以两条路径共用这一个函数。
 */
const path = require('path');
const { createRequire } = require('module');

/**
 * @param {string} dir 真实存在的目录（会用它作为解析锚点）
 * @param {string} name 模块名，如 'uiohook-napi'
 */
function requireFrom(dir, name) {
  const anchor = path.join(dir, '__netwalk_resolve_anchor__.js');
  return createRequire(anchor)(name);
}

module.exports = { requireFrom };
