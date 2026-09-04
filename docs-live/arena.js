/* Laser Tag: one arena, everybody in it.
 *
 * The loop is play, run out of energy, answer a question, back in. Energy drains
 * while you are alive and every shot costs a little, so roughly twenty seconds of
 * fighting buys one question. Being tagged also puts you out until you answer.
 *
 * Where the work happens
 *   Each device simulates its own player and draws everyone. Positions go out over
 *   the game's broadcast channel ten times a second and are never written to the
 *   database: thirty children moving is far too much to store and worth nothing
 *   once the round is over. Only the score is written, every few seconds, so the
 *   board and the final results survive a phone going flat.
 *
 * Who decides a hit
 *   The player who is hit decides. A shooter says "I hit you"; the victim checks
 *   it against where it actually is, takes the hit and says so; the shooter counts
 *   the points when that answer comes back. Nobody can score by claiming.
 */
(function (global) {
  'use strict';

  const W = 1600, H = 1000;              // the arena, in its own units
  const PLAYER_R = 26, ALIEN_R = 22, SHOT_R = 7;
  const SPEED = 340, SHOT_SPEED = 780;   // units per second
  const ENERGY_SECONDS = 20;             // a full bar, spent just by being alive
  const SHOT_COST = 3;                   // per shot, as a percentage of the bar
  const FIRE_GAP = 260;                  // milliseconds between shots
  const ALIEN_POINTS = 10, PLAYER_POINTS = 100;
  const SEND_HZ = 10, SAVE_MS = 4000;

  const POWERS = {
    rapid:  { label: 'Rapid fire',  colour: '#FFC53D', life: 9000 },
    triple: { label: 'Triple shot', colour: '#FF7A45', life: 9000 },
    spread: { label: 'Triple beam', colour: '#E8467C', life: 9000 },
    speed:  { label: 'Speed boost', colour: '#2BA8FF', life: 9000 },
    shield: { label: 'Force field', colour: '#12BE8E', life: 0 },
    mystery:{ label: 'Mystery',     colour: '#7C4DFF', life: 0 }
  };
  const REAL_POWERS = ['rapid', 'triple', 'spread', 'speed', 'shield'];

  const now = () => performance.now();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  /**
   * start(options) → controller
   *   canvas    where to draw
   *   me        this player ({ id, name, avatar, team })
   *   watching  true for the board: draw everyone, control nobody
   *   send      (event, payload) => void, to the other devices
   *   onQuestion()   energy gone or tagged: the page should ask a question
   *   onScore(score) the running total changed
   */
  function start(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const watching = !!opts.watching;
    const send = opts.send || (() => {});
    const meId = opts.me ? opts.me.id : 'board';

    const self = {
      id: meId, name: opts.me ? opts.me.name : '', avatar: opts.me ? opts.me.avatar : 0,
      team: opts.me ? opts.me.team : 'red',
      x: rand(200, W - 200), y: rand(200, H - 200), angle: 0,
      alive: !watching, energy: 100, score: 0, power: '', powerUntil: 0, shield: false
    };
    const others = new Map();            // id -> last state heard, with a timestamp
    const shots = [];
    const aliens = [];
    const capsules = [];
    const sparks = [];
    let running = true, last = now(), lastSend = 0, lastSave = 0, lastFire = 0;
    const keys = new Set();
    let stickX = 0, stickY = 0, pointer = null;

    /* ── the arena's own furniture ─────────────────────── */
    const spawnAlien = () => aliens.push({
      id: 'a' + Math.random().toString(36).slice(2, 7),
      x: rand(120, W - 120), y: rand(120, H - 120),
      vx: rand(-70, 70), vy: rand(-70, 70), hp: 1
    });
    const spawnCapsule = () => capsules.push({
      kind: REAL_POWERS.concat('mystery')[Math.floor(Math.random() * 6)],
      x: rand(140, W - 140), y: rand(140, H - 140), born: now()
    });
    for (let i = 0; i < 7; i++) spawnAlien();
    for (let i = 0; i < 3; i++) spawnCapsule();

    /* ── what other devices tell us ────────────────────── */
    function heard(event, data) {
      if (!data || data.id === meId) return;
      if (event === 'move') {
        const was = others.get(data.id);
        others.set(data.id, Object.assign(was || {}, data, { at: now() }));
      } else if (event === 'shot') {
        shots.push({ x: data.x, y: data.y, dx: Math.cos(data.a), dy: Math.sin(data.a),
                     by: data.id, team: data.team, mine: false, born: now() });
      } else if (event === 'hit' && data.to === meId) {
        // somebody says they hit us. We are the ones who decide.
        if (!self.alive) return;
        if (self.shield) { self.shield = false; boom(self.x, self.y, '#12BE8E'); return; }
        self.alive = false;
        boom(self.x, self.y, '#FF6B5A');
        send('tagged', { id: meId, by: data.id });
        if (opts.onQuestion) opts.onQuestion('tagged');
      } else if (event === 'tagged' && data.by === meId) {
        self.score += PLAYER_POINTS;                 // confirmed by the player we hit
        if (opts.onScore) opts.onScore(self.score);
      } else if (event === 'gone') {
        others.delete(data.id);
      }
    }

    function boom(x, y, colour) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, s = rand(60, 260);
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: now(), colour });
      }
    }

    /* ── controls ──────────────────────────────────────── */
    const onKey = (e, down) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        down ? keys.add(k) : keys.delete(k);
        e.preventDefault();
      }
      if (down && k === ' ') { fire(); e.preventDefault(); }
    };
    const keyDown = (e) => onKey(e, true), keyUp = (e) => onKey(e, false);
    if (!watching) {
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      canvas.addEventListener('mousemove', (e) => { pointer = toArena(e.clientX, e.clientY); });
      canvas.addEventListener('mousedown', (e) => { e.preventDefault(); fire(); });
    }

    /** The joystick both walks and aims: where you steer is where you shoot. */
    function stick(dx, dy) {
      stickX = dx; stickY = dy;
      if (dx || dy) self.angle = Math.atan2(dy, dx);
    }

    function fire() {
      if (!self.alive || watching) return;
      const gap = self.power === 'rapid' ? FIRE_GAP * 0.42 : FIRE_GAP;
      if (now() - lastFire < gap) return;
      lastFire = now();
      self.energy = clamp(self.energy - SHOT_COST, 0, 100);
      const angles = self.power === 'spread' ? [-0.22, 0, 0.22] : [0];
      angles.forEach(off => {
        const a = self.angle + off;
        shots.push({ x: self.x, y: self.y, dx: Math.cos(a), dy: Math.sin(a),
                     by: meId, team: self.team, mine: true, born: now() });
        send('shot', { id: meId, x: self.x, y: self.y, a, team: self.team });
      });
      if (self.power === 'triple') {                 // three in quick succession
        [110, 220].forEach(ms => setTimeout(() => {
          if (!running || !self.alive) return;
          const a = self.angle;
          shots.push({ x: self.x, y: self.y, dx: Math.cos(a), dy: Math.sin(a),
                       by: meId, team: self.team, mine: true, born: now() });
          send('shot', { id: meId, x: self.x, y: self.y, a, team: self.team });
        }, ms));
      }
    }

    /* ── the loop ──────────────────────────────────────── */
    function step(dt) {
      const t = now();

      if (self.alive && !watching) {
        let dx = stickX, dy = stickY;
        if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
        if (keys.has('d') || keys.has('arrowright')) dx += 1;
        if (keys.has('w') || keys.has('arrowup')) dy -= 1;
        if (keys.has('s') || keys.has('arrowdown')) dy += 1;
        const len = Math.hypot(dx, dy);
        if (len > 0.06) {
          const speed = SPEED * (self.power === 'speed' ? 1.55 : 1);
          self.x = clamp(self.x + (dx / len) * speed * dt, PLAYER_R, W - PLAYER_R);
          self.y = clamp(self.y + (dy / len) * speed * dt, PLAYER_R, H - PLAYER_R);
          if (!pointer) self.angle = Math.atan2(dy, dx);
        }
        if (pointer) self.angle = Math.atan2(pointer.y - self.y, pointer.x - self.x);

        // being alive is what costs energy; a full bar is about twenty seconds
        self.energy = clamp(self.energy - (100 / ENERGY_SECONDS) * dt, 0, 100);
        if (self.power && self.powerUntil && t > self.powerUntil) self.power = '';
        if (self.energy <= 0) {
          self.alive = false;
          if (opts.onQuestion) opts.onQuestion('energy');
        }

        capsules.forEach((c, i) => {
          if (Math.hypot(c.x - self.x, c.y - self.y) < PLAYER_R + 20) {
            const kind = c.kind === 'mystery'
              ? REAL_POWERS[Math.floor(Math.random() * REAL_POWERS.length)] : c.kind;
            if (kind === 'shield') self.shield = true;
            else { self.power = kind; self.powerUntil = t + POWERS[kind].life; }
            boom(c.x, c.y, POWERS[kind].colour);
            capsules.splice(i, 1);
            setTimeout(() => { if (running) spawnCapsule(); }, 6000);
          }
        });
      }

      aliens.forEach(a => {
        a.x += a.vx * dt; a.y += a.vy * dt;
        if (a.x < ALIEN_R || a.x > W - ALIEN_R) a.vx *= -1;
        if (a.y < ALIEN_R || a.y > H - ALIEN_R) a.vy *= -1;
        a.x = clamp(a.x, ALIEN_R, W - ALIEN_R); a.y = clamp(a.y, ALIEN_R, H - ALIEN_R);
      });

      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.x += s.dx * SHOT_SPEED * dt; s.y += s.dy * SHOT_SPEED * dt;
        if (s.x < 0 || s.x > W || s.y < 0 || s.y > H || t - s.born > 2200) { shots.splice(i, 1); continue; }
        if (!s.mine) continue;                         // only our own shots can score for us

        let done = false;
        for (let j = aliens.length - 1; j >= 0 && !done; j--) {
          if (Math.hypot(aliens[j].x - s.x, aliens[j].y - s.y) < ALIEN_R + SHOT_R) {
            boom(aliens[j].x, aliens[j].y, '#7BC62D');
            aliens.splice(j, 1);
            setTimeout(() => { if (running) spawnAlien(); }, 2500);
            self.score += ALIEN_POINTS;
            if (opts.onScore) opts.onScore(self.score);
            done = true;
          }
        }
        if (done) { shots.splice(i, 1); continue; }

        others.forEach((o, id) => {
          if (done || !o.alive) return;
          if (o.team && o.team === self.team) return;   // never your own team
          if (Math.hypot(o.x - s.x, o.y - s.y) < PLAYER_R + SHOT_R) {
            send('hit', { id: meId, to: id });          // they decide whether it landed
            boom(s.x, s.y, '#FFC53D');
            done = true;
          }
        });
        if (done) shots.splice(i, 1);
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
        if (t - p.born > 620) sparks.splice(i, 1);
      }

      others.forEach((o, id) => { if (t - o.at > 6000) others.delete(id); });

      if (!watching && t - lastSend > 1000 / SEND_HZ) {
        lastSend = t;
        send('move', { id: meId, x: Math.round(self.x), y: Math.round(self.y),
                       a: +self.angle.toFixed(2), alive: self.alive, team: self.team,
                       name: self.name, avatar: self.avatar, score: self.score });
      }
      if (!watching && opts.onSave && t - lastSave > SAVE_MS) {
        lastSave = t; opts.onSave(self.score);
      }
    }

    /* ── drawing ───────────────────────────────────────── */
    /* A phone is tall and the arena is wide, so the phone gets a camera that keeps
     * its own player in the middle. The board has the room to show all of it. */
    const VIEW = 900;                     // how much of the arena a phone can see
    let cam = { s: 1, ox: 0, oy: 0 };

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      if (watching) {
        const s = Math.min(w / W, h / H);
        cam = { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2 };
      } else {
        const s = Math.max(w / VIEW, h / VIEW);
        const halfW = w / (2 * s), halfH = h / (2 * s);
        const cx = halfW * 2 >= W ? W / 2 : clamp(self.x, halfW, W - halfW);
        const cy = halfH * 2 >= H ? H / 2 : clamp(self.y, halfH, H - halfH);
        cam = { s, ox: w / 2 - cx * s, oy: h / 2 - cy * s };
      }
      return cam;
    }

    /** Where a screen point lands in the arena. */
    function toArena(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const dpr = canvas.width / box.width;
      return { x: ((clientX - box.left) * dpr - cam.ox) / cam.s,
               y: ((clientY - box.top) * dpr - cam.oy) / cam.s };
    }

    function body(x, y, angle, colour, alive, label, isSelf) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = alive ? 1 : 0.28;
      ctx.save();
      ctx.rotate(angle);
      ctx.fillStyle = colour;
      ctx.fillRect(PLAYER_R - 4, -6, 26, 12);          // the barrel points where you aim
      ctx.restore();
      const g = ctx.createRadialGradient(-7, -9, 3, 0, 0, PLAYER_R + 6);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, colour); g.addColorStop(1, colour);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.75)';
      ctx.beginPath(); ctx.arc(-8, -4, 4.6, 0, Math.PI * 2); ctx.arc(8, -4, 4.6, 0, Math.PI * 2); ctx.fill();
      if (isSelf) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, PLAYER_R + 7, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (label) {
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        const w = ctx.measureText(label).width + 16;
        ctx.fillRect(-w / 2, PLAYER_R + 8, w, 28);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, 0, PLAYER_R + 29);
      }
      ctx.restore();
    }

    const teamColour = (team) => team === 'blue' ? '#4F6BFF' : '#F4364C';

    function draw() {
      const { s, ox, oy } = fit();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0A0716';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(s, 0, 0, s, ox, oy);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#241E44'); bg.addColorStop(1, '#0D0A1C');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 2;
      for (let x = 0; x <= W; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      capsules.forEach(c => {
        const p = POWERS[c.kind];
        const bob = Math.sin((now() - c.born) / 320) * 5;
        ctx.save(); ctx.translate(c.x, c.y + bob);
        ctx.shadowColor = p.colour; ctx.shadowBlur = 22;
        ctx.fillStyle = p.colour;
        ctx.beginPath(); ctx.roundRect(-17, -22, 34, 44, 17); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.roundRect(-11, -16, 22, 12, 6); ctx.fill();
        ctx.restore();
      });

      aliens.forEach(a => {
        ctx.save(); ctx.translate(a.x, a.y);
        ctx.fillStyle = '#7BC62D';
        ctx.beginPath(); ctx.ellipse(0, 0, ALIEN_R, ALIEN_R * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath(); ctx.arc(-7, -3, 4, 0, Math.PI * 2); ctx.arc(7, -3, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1b1330';
        ctx.beginPath(); ctx.arc(-7, -3, 2, 0, Math.PI * 2); ctx.arc(7, -3, 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      shots.forEach(s => {
        ctx.save();
        ctx.strokeStyle = s.team === 'blue' ? '#8FA6FF' : '#FF8A7A';
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 16;
        ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.dx * 26, s.y - s.dy * 26); ctx.stroke();
        ctx.restore();
      });

      others.forEach(o => body(o.x, o.y, o.a || 0, teamColour(o.team), o.alive !== false, o.name, false));
      if (!watching) {
        body(self.x, self.y, self.angle, teamColour(self.team), self.alive, '', true);
        if (self.shield) {
          ctx.save(); ctx.strokeStyle = '#12BE8E'; ctx.lineWidth = 4;
          ctx.shadowColor = '#12BE8E'; ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.arc(self.x, self.y, PLAYER_R + 13, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }

      sparks.forEach(p => {
        ctx.globalAlpha = Math.max(0, 1 - (now() - p.born) / 620);
        ctx.fillStyle = p.colour;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      });
    }

    function frame() {
      if (!running) return;
      const t = now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      step(dt);
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      heard,
      fire,
      stick,
      get energy() { return self.energy; },
      get score() { return self.score; },
      get alive() { return self.alive; },
      get power() { return self.power ? POWERS[self.power].label : (self.shield ? 'Force field' : ''); },
      get playerCount() { return others.size + (watching ? 0 : 1); },
      /** Back in after a question: full bar, fresh position. */
      revive() {
        self.alive = true; self.energy = 100; self.shield = false; self.power = '';
        self.x = rand(200, W - 200); self.y = rand(200, H - 200);
      },
      stop() {
        running = false;
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
        if (!watching) send('gone', { id: meId });
      }
    };
  }

  global.NovaArena = { start, POWERS, ALIEN_POINTS, PLAYER_POINTS, ENERGY_SECONDS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaArena;
