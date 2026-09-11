/**
 * NetWalk 打包脚本 —— 产出单文件 exe
 *
 * 默认走 **Node SEA**（Single Executable Application）：
 *   用本机已装的 node.exe 作为底座，不需要下载任何大文件。
 *
 * 也支持 --mode pkg（用 @yao-pkg/pkg），但它需要从 GitHub 拉一份 ~55MB 的
 * 预编译 Node 二进制；在网络受限/代理会截断的环境里会失败，所以只作备选。
 *
 * 三个步骤：
 *   1) 生成内嵌载荷：原生模块（uiohook）+ 前端资源（public）
 *   2) 用 esbuild 把整个 server/ 打成单文件 CJS bundle
 *   3) SEA：node --experimental-sea-config 出 blob → 复制 node.exe → postject 注入
 *
 * 用法：
 *   node build.js                    # SEA，默认输出 dist/NetWalk.exe
 *   node build.js --mode pkg         # 改用 pkg
 *   node build.js --payload-only     # 只重新生成内嵌载荷
 *   node build.js --target node24-win-x64   # 仅 pkg 模式有意义
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const NATIVE_PAYLOAD_FILE = path.join(ROOT, 'server', 'native-payload.js');
const PUBLIC_PAYLOAD_FILE = path.join(ROOT, 'server', 'public-payload.js');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const MODE = argOf('--mode', 'pkg');
const PKG_TARGET = argOf('--target', 'node22-win-x64');
const PAYLOAD_ONLY = argv.includes('--payload-only');

/** pkg-fetch v3.6 实际提供过预编译产物的目标（没有 node18 / node20） */
const KNOWN_PKG_TARGETS = [
  'node22-win-x64', 'node24-win-x64', 'node26-win-x64',
  'node22-linux-x64', 'node24-linux-x64', 'node22-macos-x64', 'node24-macos-x64',
];

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// ---------------------------------------------------------------- 载荷生成

function collectNativeFiles() {
  const files = [];
  const add = (rel) => {
    const abs = path.join(ROOT, 'node_modules', rel);
    if (!fs.existsSync(abs)) throw new Error('缺少原生依赖文件: node_modules/' + rel);
    files.push(rel);
  };
  const uioPkg = require(path.join(ROOT, 'node_modules', 'uiohook-napi', 'package.json'));
  add('uiohook-napi/package.json');
  add(path.join('uiohook-napi', uioPkg.main || 'dist/index.js'));
  add(path.join('uiohook-napi', 'prebuilds', `${process.platform}-${process.arch}`, 'uiohook-napi.node'));

  const ngb = require(path.join(ROOT, 'node_modules', 'node-gyp-build', 'package.json'));
  add('node-gyp-build/package.json');
  add(path.join('node-gyp-build', ngb.main || 'index.js'));
  add('node-gyp-build/node-gyp-build.js');
  return files;
}

function buildPayload() {
  const rels = collectNativeFiles();
  const files = {};
  let rawBytes = 0;
  for (const rel of rels) {
    const buf = fs.readFileSync(path.join(ROOT, 'node_modules', rel));
    rawBytes += buf.length;
    files[rel.split(path.sep).join('/')] = buf.toString('base64');
  }
  const version = require(path.join(ROOT, 'node_modules', 'uiohook-napi', 'package.json')).version
    + '-' + process.platform + '-' + process.arch;

  writePayloadFile(NATIVE_PAYLOAD_FILE, '原生模块（uiohook-napi + node-gyp-build）',
    rels.length, rawBytes, version, files);
  console.log(`[1/4] 原生载荷：${rels.length} 个文件，原始 ${(rawBytes / 1024).toFixed(1)} KB`);
}

function walkFiles(dir, base) {
  const list = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(abs).isDirectory()) list.push(...walkFiles(abs, rel));
    else list.push(rel);
  }
  return list;
}

function buildPublicPayload() {
  const publicDir = path.join(ROOT, 'public');
  const rels = walkFiles(publicDir, '').sort();
  const files = {};
  let rawBytes = 0;
  for (const rel of rels) {
    const buf = fs.readFileSync(path.join(publicDir, rel));
    rawBytes += buf.length;
    files[rel] = buf.toString('base64');
  }
  const version = require(path.join(ROOT, 'package.json')).version + '-' + rawBytes;
  writePayloadFile(PUBLIC_PAYLOAD_FILE, '前端资源（public/）', rels.length, rawBytes, version, files);
  console.log(`[2/4] 前端载荷：${rels.length} 个文件，原始 ${(rawBytes / 1024).toFixed(1)} KB`);
}

function writePayloadFile(file, label, count, rawBytes, version, files) {
  const keys = Object.keys(files);
  const lines = keys.map((k, i) => `    ${JSON.stringify(k)}: ${JSON.stringify(files[k])}${i === keys.length - 1 ? '' : ','}`);
  const out = `/**
 * 自动生成，请勿手改 —— 由 build.js 产出。
 * ${label}：${count} 个文件，原始 ${(rawBytes / 1024).toFixed(1)} KB（base64 内嵌，运行时释放到 exe 旁）
 */
module.exports = {
  version: ${JSON.stringify(version)},
  files: {
${lines.join('\n')}
  },
};
`;
  fs.writeFileSync(file, out, 'utf8');
}

// ---------------------------------------------------------------- SEA 模式

function findSeaBase() {
  // 优先用 PKG_NODE_PATH / 显式指定的 node.exe，否则用当前进程的
  const explicit = process.env.NETWALK_NODE_EXE;
  const cand = explicit || process.execPath;
  if (!fs.existsSync(cand)) throw new Error('找不到作为 SEA 底座的 node.exe: ' + cand);
  return cand;
}

async function bundleWithEsbuild() {
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (err) {
    throw new Error('未找到 esbuild（npm i -D esbuild）：' + err.message);
  }

  const outfile = path.join(DIST, 'netwalk.cjs');
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'server', 'entry.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    legalComments: 'none',
    logLevel: 'warning',
    // 原生/可选模块不能在打包时静态解析，运行时由 requireFrom 从磁盘加载
    external: [
      'uiohook-napi', 'node-gyp-build',
      'bufferutil', 'utf-8-validate',
      'node-global-key-listener',
    ],
  });
  const warns = (result.warnings || []).filter((w) => w.text.indexOf('Could not resolve') < 0);
  if (warns.length) {
    console.log('        esbuild 警告：');
    for (const w of warns.slice(0, 8)) {
      const loc = w.location ? ` (${w.location.file}:${w.location.line})` : '';
      console.log('          · ' + w.text + loc);
    }
  }
  const size = fs.statSync(outfile).size;
  console.log(`[3/4] esbuild 打包完成：dist/netwalk.cjs  ${(size / 1024).toFixed(0)} KB`);
  return outfile;
}

function runSea(bundleFile) {
  const baseExe = findSeaBase();
  const blobFile = path.join(DIST, 'netwalk-prep.blob');
  const configFile = path.join(DIST, 'sea-config.json');
  const outExe = path.join(DIST, 'NetWalk.exe');

  fs.writeFileSync(configFile, JSON.stringify({
    main: bundleFile,
    output: blobFile,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2), 'utf8');

  console.log('[4/4] 生成 SEA blob…');
  execFileSync(process.execPath, ['--experimental-sea-config', configFile], { cwd: ROOT, stdio: 'inherit' });

  // 底座 node.exe 可能带数字签名；注入后签名失效会导致 Windows 拒绝加载，先尽量移除
  fs.copyFileSync(baseExe, outExe);
  tryRemoveSignature(outExe);

  const postjectCli = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
  if (!fs.existsSync(postjectCli)) throw new Error('未找到 postject，请先执行：npm i -D postject');

  console.log('        注入 blob…');
  execFileSync(process.execPath, [
    postjectCli, outExe, 'NODE_SEA_BLOB', blobFile,
    '--sentinel-fuse', SEA_FUSE,
  ], { cwd: ROOT, stdio: 'inherit' });

  const size = fs.statSync(outExe).size;
  console.log(`\n打包完成：${outExe}`);
  console.log(`文件大小：${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`底座 Node：${baseExe}`);
  return outExe;
}

/** 尝试用 signtool 去掉 node.exe 的签名；没有 signtool 就跳过（多数情况也能跑） */
function tryRemoveSignature(exe) {
  const signtool = [
    'C:/Program Files (x86)/Windows Kits/10/bin/x64/signtool.exe',
    'C:/Program Files (x86)/Windows Kits/10/bin/10.0.22621.0/x64/signtool.exe',
  ].find((p) => fs.existsSync(p));
  if (!signtool) {
    console.log('        （未找到 signtool，跳过去签名；若 exe 无法启动再手动处理）');
    return;
  }
  try {
    execFileSync(signtool, ['remove', '/s', exe], { stdio: 'ignore' });
    console.log('        已移除底座签名');
  } catch (_) {
    console.log('        （去签名失败，继续）');
  }
}

// ---------------------------------------------------------------- pkg 模式

function runPkg() {
  if (!KNOWN_PKG_TARGETS.includes(PKG_TARGET)) {
    console.warn(`[!] ${PKG_TARGET} 不在已知有预编译产物的列表里，pkg 可能会尝试源码编译而失败。`);
    console.warn('    已知可用：' + KNOWN_PKG_TARGETS.join(', '));
  }
  const bin = [
    path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js'),
    path.join(ROOT, 'node_modules', 'pkg', 'lib-es5', 'bin.js'),
  ].find((p) => fs.existsSync(p));
  if (!bin) throw new Error('未找到 pkg，请先执行：npm i -D @yao-pkg/pkg');

  console.log('[3/4] 调 pkg 打包（' + PKG_TARGET + '）…');
  execFileSync(process.execPath, [
    bin,
    path.join('server', 'entry.js'),
    '--targets', PKG_TARGET,
    '--output', path.join('dist', 'NetWalk.exe'),
    '--compress', 'GZip',
    '--no-bytecode',
    '--public',
  ], { cwd: ROOT, stdio: 'inherit' });

  const out = path.join(DIST, 'NetWalk.exe');
  console.log(`\n打包完成：${out}`);
  console.log(`文件大小：${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
  return out;
}

// ---------------------------------------------------------------- 入口

(async () => {
  console.log('== NetWalk 打包（模式：' + MODE + '） ==');
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

  buildPayload();
  buildPublicPayload();

  if (PAYLOAD_ONLY) {
    console.log('[3/4] 已跳过打包（--payload-only）');
    return;
  }

  if (MODE === 'pkg') {
    runPkg();
  } else {
    const bundle = await bundleWithEsbuild();
    runSea(bundle);
  }
})().catch((err) => {
  console.error('\n[打包失败] ' + (err && err.message ? err.message : err));
  if (err && err.stderr) console.error(String(err.stderr).slice(0, 2000));
  process.exit(1);
});
