/**
 * 网速兜底采集子进程（systeminformation）
 * 仅在 PowerShell 方案不可用时代替；独立进程可避免其慢速调用阻塞主服务。
 */
let si = null;
try {
  // eslint-disable-next-line global-require
  si = require('systeminformation');
} catch (err) {
  process.send({ type: 'ready', ok: false, error: err && err.message ? err.message : String(err) });
  process.exit(0);
}

async function tick() {
  try {
    const stats = await si.networkStats();
    if (Array.isArray(stats) && stats.length) {
      let rx = 0;
      let tx = 0;
      let top = '';
      let topRate = -1;
      for (const s of stats) {
        const r = Number(s.rx_sec) || 0;
        const t = Number(s.tx_sec) || 0;
        rx += r;
        tx += t;
        if (r + t > topRate) { topRate = r + t; top = s.iface; }
      }
      process.send({ type: 'net', ok: true, rx, tx, iface: top });
    }
  } catch (err) {
    process.send({ type: 'net', ok: false, error: err && err.message ? err.message : String(err) });
  }
}

process.send({ type: 'ready', ok: true });

// 递归调度，避免慢速调用堆积
(function loop() {
  tick().then(() => setTimeout(loop, 3000));
})();

process.on('message', (m) => {
  if (m && m.type === 'stop') process.exit(0);
});
process.on('disconnect', () => process.exit(0));
