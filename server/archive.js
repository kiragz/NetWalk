/**
 * 存档码：把全部漫游数据压缩编码成一段可复制文本，便于换机继承。
 * 格式：NW1.<base64url( deflateRaw( JSON ) )>
 */
const zlib = require('zlib');

const PREFIX = 'NW1';
const MAX_CODE = 12 * 1024 * 1024; // 12MB 文本上限

function exportArchive(store, achStore) {
  const dates = store.listDates();
  const tracks = {};
  for (const d of dates) tracks[d] = store.get(d);
  const payload = {
    v: 1,
    at: Date.now(),
    tracks,
    achievements: achStore ? achStore.data : { unlocked: {} },
  };
  const json = JSON.stringify(payload);
  const buf = zlib.deflateRawSync(Buffer.from(json, 'utf8'), { level: 9 });
  const code = `${PREFIX}.${buf.toString('base64url')}`;
  return {
    code,
    days: dates.length,
    bytes: Buffer.byteLength(code, 'utf8'),
    rawBytes: Buffer.byteLength(json, 'utf8'),
  };
}

function decodeArchive(code) {
  const s = String(code || '').replace(/\s+/g, '');
  if (!s) throw new Error('存档码为空');
  if (s.length > MAX_CODE) throw new Error('存档码过长');
  if (!s.startsWith(`${PREFIX}.`)) throw new Error('存档码格式不正确（应以 NW1. 开头）');
  const b64 = s.slice(PREFIX.length + 1);
  let buf;
  try {
    buf = Buffer.from(b64, 'base64url');
  } catch (_) {
    throw new Error('存档码编码无法解析');
  }
  let payload;
  try {
    payload = JSON.parse(zlib.inflateRawSync(buf).toString('utf8'));
  } catch (_) {
    throw new Error('存档码已损坏或不是本程序的存档');
  }
  if (!payload || typeof payload.tracks !== 'object') throw new Error('存档内容不完整');
  return payload;
}

/**
 * 导入并合并
 * @returns {{added:number, merged:number, total:number, achievements:number}}
 */
function importArchive(code, store, achStore) {
  const payload = decodeArchive(code);
  let added = 0;
  let merged = 0;
  for (const [date, data] of Object.entries(payload.tracks)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const cur = store.get(date);
    const curPoints = (cur && cur.path && cur.path.length) || 0;
    if (curPoints === 0) {
      store.replace(date, data);
      added++;
    } else {
      store.mergeDate(date, data);
      merged++;
    }
  }
  const achCount = achStore ? achStore.merge(payload.achievements) : 0;
  return { added, merged, total: added + merged, achievements: achCount };
}

module.exports = { exportArchive, importArchive, decodeArchive, PREFIX };
