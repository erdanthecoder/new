/* A tune for the big screen, played by the browser rather than downloaded.
 *
 * Nothing here is a file: every note is a struck tone built from a few
 * oscillators that ring and fade, which is what a marimba or a plucked string
 * does and what a square-wave arpeggio does not. That is deliberate — a game in
 * a classroom should not sound like a machine, and it should not sound like
 * every other website either.
 *
 * It only ever plays on the screen everyone is looking at. Thirty phones each
 * playing their own copy would be unbearable.
 */
(function (global) {
  'use strict';

  // A pentatonic scale has no interval in it that can clash, so a tune wandering
  // about inside one stays pleasant however long it is left running.
  const SCALE = [0, 2, 4, 7, 9];
  const ROOT = 220;                                   // A3
  const note = (step) => ROOT * Math.pow(2, (SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);

  let ctx = null, out = null, timer = null, playing = false, step = 0, bar = 0;
  let wanted = false;                                 // what the teacher asked for

  function build() {
    if (ctx) return ctx;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    out = ctx.createGain();
    out.gain.value = 0;
    // a gentle low-pass takes the glassy edge off, so it sits under a room
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 2600;
    out.connect(soft).connect(ctx.destination);
    return ctx;
  }

  /* One struck note: a body that rings, a softer octave above it for warmth, and
   * a very short knock at the start, which is the part the ear reads as "struck"
   * rather than "switched on". */
  function pluck(freq, at, level, length) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    g.connect(out);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = freq;
    body.connect(g);
    body.start(at); body.stop(at + length + 0.05);

    const ring = ctx.createGain();
    ring.gain.setValueAtTime(0, at);
    ring.gain.linearRampToValueAtTime(level * 0.34, at + 0.02);
    ring.gain.exponentialRampToValueAtTime(0.0001, at + length * 0.7);
    ring.connect(out);
    const over = ctx.createOscillator();
    over.type = 'sine';
    over.frequency.value = freq * 2.02;               // very slightly sharp, so it beats a little
    over.connect(ring);
    over.start(at); over.stop(at + length);

    const knock = ctx.createGain();
    knock.gain.setValueAtTime(level * 0.5, at);
    knock.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    knock.connect(out);
    const tap = ctx.createOscillator();
    tap.type = 'sine';
    tap.frequency.setValueAtTime(freq * 3, at);
    tap.frequency.exponentialRampToValueAtTime(freq, at + 0.05);
    tap.connect(knock);
    tap.start(at); tap.stop(at + 0.06);
  }

  const BEAT = 0.34;                                  // a little under 180 notes a minute
  const PATTERN = [0, 2, 4, 2, 3, 1, 4, 2];           // steps within the scale
  const BASS    = [-5, null, -3, null, -4, null, -3, null];

  function schedule() {
    if (!playing) return;
    const at = ctx.currentTime + 0.06;
    const i = step % PATTERN.length;

    pluck(note(PATTERN[i] + 5), at, 0.16, 1.5);
    if (BASS[i] !== null) pluck(note(BASS[i]), at, 0.13, 2.2);
    // every fourth bar takes a breath, so it never becomes a treadmill
    if (i === 0) { bar++; if (bar % 4 === 0) pluck(note(PATTERN[0] + 10), at, 0.08, 2.4); }

    step++;
    timer = setTimeout(schedule, BEAT * 1000);
  }

  function fade(to, seconds) {
    if (!out) return;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(to, now + seconds);
  }

  function start() {
    wanted = true;
    if (!build() || playing) return;
    // a browser will not make a sound until somebody has interacted with the page
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    playing = true;
    fade(0.5, 2.5);
    schedule();
  }

  function stop() {
    wanted = false;
    if (!playing) return;
    playing = false;
    clearTimeout(timer);
    fade(0, 0.8);
  }

  /** A short flourish, for a moment worth marking. */
  function sting(kind) {
    if (!build()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const at = ctx.currentTime + 0.02;
    const was = out.gain.value;
    out.gain.setValueAtTime(Math.max(was, 0.5), at);
    const runs = { right: [4, 6, 8], wrong: [3, 1], win: [4, 6, 8, 11], go: [0, 4, 7] };
    (runs[kind] || runs.right).forEach((n, i) => pluck(note(n + 5), at + i * 0.09, 0.2, 1.1));
    if (playing) fade(0.5, 1.2);
  }

  global.NovaMusic = {
    start, stop, sting,
    get on() { return playing; },
    get wanted() { return wanted; },
    /** Browsers block sound until a click; call this from one. */
    unlock() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
