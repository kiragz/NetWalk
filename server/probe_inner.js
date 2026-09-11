const fs = require('fs');
const out = process.env.NW_OUT || 'none';
try {
  fs.appendFileSync(out, 'RUN pid=' + process.pid + '\n');
} catch (e) {
  try { fs.appendFileSync(require('path').join(__dirname, '.tmp_ran_err.txt'), 'ERR ' + e.message + '\n'); } catch (_) {}
}
setInterval(() => {}, 1000);