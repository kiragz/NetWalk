/**
 * 自检工具：验证网速与击键采集是否正常工作
 * 运行：node server/selftest.js
 * 提示：运行后请敲击键盘 5~10 秒，观察 KPM 是否上升。
 */
const { NetMonitor } = require('./netmon');
const { KeyMonitor } = require('./keymon');
const { convert } = require('../public/js/speed.js');

const net = new NetMonitor({ intervalMs: 1000 });
const keys = new KeyMonitor();

function fmt(b) {
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let i = 0; let n = Math.max(0, b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

console.log('\nNetWalk 自检开始，持续 15 秒 —— 请现在随便敲几下键盘\n');

async function main() {
  net.start();
  const mode = await keys.start();
  console.log(`击键采集模式：${mode === 'global' ? '系统级全局钩子 ✓' : '仅浏览器窗口内（全局钩子不可用）'}\n`);
  console.log('  时间   下载        上传        打字      换算速度');
  console.log('  ' + '-'.repeat(52));

  const t0 = Date.now();
  const timer = setInterval(() => {
    const n = net.snapshot();
    const k = keys.snapshot();
    const r = convert({ rx: n.rx, tx: n.tx, kpm: k.kpm });
    const sec = Math.round((Date.now() - t0) / 1000);
    console.log(`  ${String(sec).padStart(3)}s  ${fmt(n.rx).padEnd(11)} ${fmt(n.tx).padEnd(11)} ${String(k.kpm).padStart(4)} KPM  ${String(r.speedKmh).padStart(5)} km/h ${r.icon}${r.label}`);
  }, 1500);

  setTimeout(() => {
    clearInterval(timer);
    const k = keys.snapshot();
    const n = net.snapshot();
    console.log('\n' + '  ' + '-'.repeat(52));
    console.log('\n自检结果：');
    console.log(`  网速采集  ${n.available ? '✓ 正常' : '✗ 不可用'}  来源=${n.source}  网卡=${n.iface || '-'}`);
    console.log(`             峰值下载 ${fmt(n.peakRx)}，峰值上传 ${fmt(n.peakTx)}`);
    console.log(`  击键采集  ${k.mode === 'global' ? '✓ 系统级全局钩子' : '△ 仅浏览器窗口内'}  累计 ${k.total} 键，峰值 ${k.peakKpm} KPM`);
    if (k.total === 0) {
      console.log('             ↑ 期间没有捕获到击键。若在自检时敲过键盘仍为 0，');
      console.log('               试试用管理员权限运行，或确认没有安全软件拦截键盘钩子。');
    } else {
      console.log('             ↑ 已捕获击键，说明全局钩子工作正常。');
    }
    console.log('');
    keys.stop();
    net.stop();
    process.exit(0);
  }, 15000);
}

main();
