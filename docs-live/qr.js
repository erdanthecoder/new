/* Minimal dependency-free QR encoder — byte mode, EC level L, versions 1–5
   (up to 106 characters, plenty for a join URL). Renders as crisp SVG.
   Returns null for anything it cannot encode, so callers can fall back. */
(function (global) {
  'use strict';

  /* ── Galois field GF(256) ─────────────────────────── */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function generatorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];                       // shift up one degree
        next[j + 1] ^= mul(poly[j], EXP[i]);      // …plus the α^i term
      }
      poly = next;
    }
    return poly;
  }

  function ecc(data, count) {
    const gen = generatorPoly(count);
    const out = new Array(count).fill(0);
    for (const byte of data) {
      const factor = byte ^ out[0];
      out.shift(); out.push(0);
      if (factor !== 0) for (let i = 0; i < gen.length - 1; i++) out[i] ^= mul(gen[i + 1], factor);
    }
    return out;
  }

  /* version: [total codewords, data codewords, ec codewords] for EC level L, one block */
  const VERSIONS = {
    1: [26, 19, 7], 2: [44, 34, 10], 3: [70, 55, 15], 4: [100, 80, 20], 5: [134, 108, 26]
  };
  const ALIGN = { 1: null, 2: 18, 3: 22, 4: 26, 5: 30 };

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let version = 0;
    for (let v = 1; v <= 5; v++) {
      if (bytes.length + 2 <= VERSIONS[v][1]) { version = v; break; }
    }
    if (!version) return null;

    const [, dataWords, ecWords] = VERSIONS[version];
    const bits = [];
    const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
    push(0b0100, 4);            // byte mode
    push(bytes.length, 8);      // character count (versions 1–9)
    bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, dataWords * 8 - bits.length));           // terminator
    while (bits.length % 8) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    const PAD = [0xEC, 0x11];
    while (words.length < dataWords) words.push(PAD[(words.length - bits.length / 8) % 2]);

    const all = words.concat(ecc(words, ecWords));
    return { version, codewords: all };
  }

  function build(text, forceMask) {
    const encoded = encode(text);
    if (!encoded) return null;
    const { version, codewords } = encoded;
    const size = version * 4 + 17;
    const grid = Array.from({ length: size }, () => new Array(size).fill(null));   // null = free
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    const set = (r, c, v) => { grid[r][c] = v; reserved[r][c] = true; };

    /* finder patterns + separators */
    const finder = (row, col) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(rr, cc, inRing || inCore ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    /* timing patterns */
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }

    /* alignment pattern */
    const centre = ALIGN[version];
    if (centre) {
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        const on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        set(centre + r, centre + c, on ? 1 : 0);
      }
    }

    /* dark module + reserved format areas */
    set(size - 8, 8, 1);
    for (let i = 0; i < 9; i++) {
      if (grid[8][i] === null) { grid[8][i] = 0; reserved[8][i] = true; }
      if (grid[i][8] === null) { grid[i][8] = 0; reserved[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) {
      if (grid[8][size - 1 - i] === null) { grid[8][size - 1 - i] = 0; reserved[8][size - 1 - i] = true; }
      if (grid[size - 1 - i][8] === null) { grid[size - 1 - i][8] = 0; reserved[size - 1 - i][8] = true; }
    }

    /* data placement: two-column zigzag from the bottom right, skipping column 6 */
    const stream = [];
    codewords.forEach(word => { for (let i = 7; i >= 0; i--) stream.push((word >> i) & 1); });
    let idx = 0, upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (const c of [col, col - 1]) {
          if (reserved[row][c]) continue;
          grid[row][c] = idx < stream.length ? stream[idx] : 0;
          idx++;
        }
      }
      upward = !upward;
    }

    /* masking */
    const MASKS = [
      (r, c) => (r + c) % 2 === 0,
      (r) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
      (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
    ];

    const applyMask = (maskIndex) => {
      const out = grid.map(row => row.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && MASKS[maskIndex](r, c)) out[r][c] ^= 1;
      }
      writeFormat(out, maskIndex, size);
      return out;
    };

    if (forceMask !== undefined) return applyMask(forceMask);
    let best = null, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const candidate = applyMask(m);
      const score = penalty(candidate, size);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best;
  }

  /* 15-bit format information: EC level L (01) + mask, BCH(15,5), XOR 0x5412 */
  function formatBits(mask) {
    let value = (0b01 << 3) | mask;
    let rem = value << 10;
    for (let i = 4; i >= 0; i--) if (rem & (1 << (i + 10))) rem ^= 0b10100110111 << i;
    return ((value << 10) | rem) ^ 0b101010000010010;
  }

  function writeFormat(matrix, mask, size) {
    const bits = formatBits(mask);
    const bit = (i) => (bits >> i) & 1;
    /* copy 1: down the left of the top-right finder, then along row 8 */
    for (let i = 0; i <= 5; i++) matrix[i][8] = bit(i);
    matrix[7][8] = bit(6); matrix[8][8] = bit(7); matrix[8][7] = bit(8);
    for (let i = 9; i <= 14; i++) matrix[8][14 - i] = bit(i);
    /* copy 2: along row 8 on the right, then down column 8 at the bottom */
    for (let i = 0; i <= 7; i++) matrix[8][size - 1 - i] = bit(i);
    for (let i = 8; i <= 14; i++) matrix[size - 15 + i][8] = bit(i);
    matrix[size - 8][8] = 1;   // dark module
  }

  function penalty(m, size) {
    let score = 0;
    /* rule 1: runs of five or more */
    const run = (get) => {
      for (let a = 0; a < size; a++) {
        let last = -1, len = 0;
        for (let b = 0; b < size; b++) {
          const v = get(a, b);
          if (v === last) { len++; if (len === 5) score += 3; else if (len > 5) score++; }
          else { last = v; len = 1; }
        }
      }
    };
    run((r, c) => m[r][c]); run((c, r) => m[r][c]);
    /* rule 2: 2x2 blocks */
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    /* rule 3: finder-like patterns */
    const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const match = (cells) => cells.join('') === pat.join('') || cells.slice().reverse().join('') === pat.join('');
    for (let r = 0; r < size; r++) for (let c = 0; c + 11 <= size; c++) {
      if (match(m[r].slice(c, c + 11))) score += 40;
      const col = []; for (let k = 0; k < 11; k++) col.push(m[c + k][r]);
      if (match(col)) score += 40;
    }
    /* rule 4: dark/light balance */
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return score;
  }

  /** Render `text` as an SVG string, or return null if it will not fit. */
  function svg(text, { size = 148, quiet = 3, dark = '#0b1020', light = '#ffffff' } = {}) {
    const matrix = build(text);
    if (!matrix) return null;
    const n = matrix.length, total = n + quiet * 2;
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (matrix[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}"
      shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="${light}"/>
      <path d="${path}" fill="${dark}"/></svg>`;
  }

  global.QR = { svg, build };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.QR;
