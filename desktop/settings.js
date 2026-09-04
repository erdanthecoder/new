/* What the teacher has chosen, kept in one small file.
 *
 * Every setting has a sensible value already, so the app works before anyone
 * opens the settings window, and an unreadable or hand-edited file falls back to
 * those rather than refusing to start.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  port: 8123,                 // 0 lets the computer pick; a fixed one keeps the address stable
  music: true,
  boardFullScreen: true,
  boardOnSecondScreen: true,
  defaultTime: 20,
  defaultPoints: 100,
  showJoinBar: true,
  theme: 'system'             // 'system' | 'light' | 'dark'
};

const RANGES = {
  port: (v) => (Number.isInteger(v) && (v === 0 || (v >= 1024 && v <= 65535))),
  defaultTime: (v) => Number.isInteger(v) && v >= 5 && v <= 120,
  defaultPoints: (v) => Number.isInteger(v) && v >= 10 && v <= 2000,
  theme: (v) => ['system', 'light', 'dark'].includes(v)
};

class Settings {
  constructor(file) {
    this.file = file;
    this.values = Object.assign({}, DEFAULTS);
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [key, value] of Object.entries(saved)) this.set(key, value, false);
    } catch { /* no file yet, or somebody edited it into nonsense */ }
    return this.values;
  }

  set(key, value, save = true) {
    if (!(key in DEFAULTS)) return false;
    if (typeof DEFAULTS[key] === 'boolean') value = !!value;
    else if (typeof DEFAULTS[key] === 'number') value = Math.round(Number(value));
    if (RANGES[key] && !RANGES[key](value)) return false;
    this.values[key] = value;
    if (save) this.save();
    return true;
  }

  patch(values) {
    const taken = {};
    for (const [k, v] of Object.entries(values || {})) taken[k] = this.set(k, v, false);
    this.save();
    return taken;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2), 'utf8');
    } catch { /* read-only disk: the app still runs, the choice just does not stick */ }
  }

  reset() { this.values = Object.assign({}, DEFAULTS); this.save(); return this.values; }
}

module.exports = { Settings, DEFAULTS };
