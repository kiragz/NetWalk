/**
 * 成就存储与判定
 */
const fs = require('fs');
const path = require('path');
const ach = require('../public/js/achievements.js');

class AchievementStore {
  constructor(dir) {
    this.file = path.join(dir, 'achievements.json');
    this.data = { unlocked: {} };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (raw && typeof raw.unlocked === 'object') this.data = { unlocked: raw.unlocked || {} };
      }
    } catch (err) {
      console.error('[achievements] 读取失败：', err.message);
    }
  }

  /** 清空全部解锁记录（重置账号数据时用），并立即落盘 */
  forgetAll() {
    this.data = { unlocked: {} };
    this.save();
  }

  save() {
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[achievements] 写入失败：', err.message);
    }
  }

  /**
   * 根据聚合指标刷新解锁状态
   * @returns {{newly:string[], unlocked:object, total:number, got:number}}
   */
  refresh(agg) {
    const hit = ach.evaluate(agg);
    const newly = [];
    for (const id of hit) {
      if (!this.data.unlocked[id]) {
        this.data.unlocked[id] = Date.now();
        newly.push(id);
      }
    }
    if (newly.length) this.save();
    return this.status(newly);
  }

  status(newly = []) {
    const unlocked = this.data.unlocked || {};
    return {
      newly,
      unlocked,
      total: ach.ACHIEVEMENTS.length,
      got: Object.keys(unlocked).length,
    };
  }

  /** 导入存档时合并成就（保留更早的解锁时间） */
  merge(other) {
    const src = (other && other.unlocked) || {};
    let n = 0;
    for (const [id, ts] of Object.entries(src)) {
      if (!this.data.unlocked[id] || this.data.unlocked[id] > ts) {
        this.data.unlocked[id] = ts;
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  reset() {
    this.data = { unlocked: {} };
    this.save();
  }
}

module.exports = { AchievementStore };
