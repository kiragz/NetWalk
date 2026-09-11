/**
 * 存档码：把全部漫游数据压缩编码成一段可复制文本，便于换机继承。
 * 格式：NW1.<base64url( deflateRaw( JSON ) )>
 */
const zlib = require('zlib');

const PREFIX = 'NW1';
const MAX_CODE = 12 * 1024 * 1024; // 12MB 文本上限

/** 随存档一起带走的本机配置键（换设备时不用再手填一遍） */
const CARRY_KEYS = [
  'amapKey', 'amapSecurityJsCode',
  'mailSmtpHost', 'mailSmtpPort', 'mailUser', 'mailPass', 'mailImapHost', 'mailImapPort',
  // 出发点也一起带走：否则新设备会落回默认城市中心（比如默认的深圳）
  'city', 'originCustom', 'originName',
];
/** 需要原样保留的对象型字段（不能 String() 化） */
const CARRY_OBJECT_KEYS = ['origin'];

/** 从 config 里挑出可迁移的配置（只保留有值的；origin 保持对象） */
function pickCarryConfig(cfg) {
  const out = {};
  if (!cfg) return out;
  for (const k of CARRY_KEYS) {
    const v = cfg[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') continue;
    if (String(v) === '') continue;
    out[k] = (typeof v === 'boolean') ? v : String(v);
  }
  for (const k of CARRY_OBJECT_KEYS) {
    const o = cfg[k];
    if (o && Number.isFinite(Number(o.lng)) && Number.isFinite(Number(o.lat))) {
      out[k] = { lng: Number(o.lng), lat: Number(o.lat) };
    }
  }
  return out;
}

function exportArchive(store, achStore, machineCfg) {
  const dates = store.listDates();
  const tracks = {};
  for (const d of dates) tracks[d] = store.get(d);
  const payload = {
    v: 1,
    at: Date.now(),
    tracks,
    achievements: achStore ? achStore.data : { unlocked: {} },
  };
  // 可选：把本机配置（地图 Key / 邮箱）一起带走。旧版本读这个字段会忽略，向后兼容。
  const cfg = pickCarryConfig(machineCfg);
  if (Object.keys(cfg).length) payload.cfg = cfg;
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
  // 出发序号是全局的（跨天累加），合并后必须按时间全局重排，
  // 否则两台设备各自的「第 1、2、3 次」会冲突，出发次数对不上。
  if (store && typeof store.renumberSessions === 'function') store.renumberSessions();
  // 注意：这里**不**自动应用 payload.cfg —— 万一导入的是别人的存档码，
  // 不能把人家的邮箱配置盖到自己机器上。是否应用交给调用方/用户确认。
  const cfg = pickCarryConfig(payload.cfg);
  return {
    added, merged, total: added + merged, achievements: achCount,
    cfg: Object.keys(cfg).length ? cfg : null,
  };
}

module.exports = { exportArchive, importArchive, decodeArchive, PREFIX, CARRY_KEYS, pickCarryConfig };
