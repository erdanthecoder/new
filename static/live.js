/* Quoldek live games, without a server of our own.
 *
 * GitHub Pages only serves files, so the sync has to happen somewhere else:
 * three small Supabase tables reached with the PUBLISHABLE key (the one meant
 * to ship in browser code — the secret service key is not used here and the
 * quizzes/results table stays out of anon's reach entirely).
 *
 * The host device is the referee: players insert their answers, and the host
 * reads them, scores them and publishes the next state. One writer means no
 * merge conflicts and the scoring rules live in one place.
 */
(function (global) {
  'use strict';

  const URL_BASE = 'https://blkwilonabowayxefxpx.supabase.co';
  const PUBLISHABLE = 'sb_publishable_GT9kBg_L8Y2rT4n2DybBQA_nO93VP-4';
  const REST = URL_BASE + '/rest/v1';

  const HEADERS = {
    apikey: PUBLISHABLE,
    authorization: 'Bearer ' + PUBLISHABLE,
    'content-type': 'application/json'
  };

  async function rest(method, path, body, extra) {
    const res = await fetch(REST + path, {
      method,
      headers: Object.assign({}, HEADERS, extra || {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `Supabase ${res.status}`;
      try { message = JSON.parse(text).message || message; } catch { /* not json */ }
      throw Object.assign(new Error(message), { status: res.status });
    }
    return text ? JSON.parse(text) : null;
  }

  const now = () => Date.now();
  const rid = (n = 10) => Math.random().toString(36).slice(2, 2 + n);
  /* Characters are numbers, drawn by sprites.js. A number is handed out once per
   * game so no two children in the same room are the same character, and it is
   * stored with the player so it never changes underneath them. */
  const freeFace = (taken) => (global.Sprite ? global.Sprite.freeFace(taken) : (taken || []).length);

  /* The character a child asked for, or the closest one still free. Two children
   * with the same colour and silhouette cannot be told apart across a classroom,
   * so a taken choice keeps its colour and steps the silhouette on. */
  function wantedFace(wanted, taken) {
    const S = global.Sprite;
    const n = Number(wanted);
    if (!S || !Number.isFinite(n) || n < 0) return freeFace(taken);
    const used = new Set((taken || []).map(String));
    const { colour, shape } = S.partsOf(n);
    for (let step = 0; step < S.SHAPES; step++) {
      const candidate = String(S.combine(colour, shape + step));
      if (!used.has(candidate)) return candidate;
    }
    return freeFace(taken);
  }

  const MODES = {
    normal:   { label: 'Normal',       icon: 'target', blurb: 'Fastest right answer scores the most' },
    laser:    { label: 'Laser Tag',    icon: 'laser', blurb: 'One arena. Move, shoot, and answer when your energy runs out' },
    kart:     { label: 'Kart Race',    icon: 'kart', blurb: 'Every right answer drives your kart further' },
    tower:    { label: 'Tower Build',  icon: 'bricks', blurb: 'Stack a block for each right answer' },
    treasure: { label: 'Treasure Run', icon: 'gem', blurb: 'Collect coins and open lucky chests' },
    boss:     { label: 'Boss Battle',  icon: 'dragon', blurb: 'The whole class fights one boss together' },
    snow:     { label: 'Snowball Fight', icon: 'snow', blurb: 'Two teams. Every right answer knocks a block off their fort' },
    balloon:  { label: 'Balloon Drop', icon: 'balloon', blurb: 'Three balloons each. Get one wrong and one pops' }
  };
  /* Each game is played on a map the teacher picks. A map is scenery and a palette:
   * it changes what the board looks like, not how the scoring works. */
  const MAPS = {
    normal:   [['hall', 'School Hall'], ['space', 'Space Station'], ['jungle', 'Jungle Clearing']],
    laser:    [['arena', 'Neon Arena'], ['bunker', 'Bunker'], ['moon', 'Moon Base']],
    kart:     [['city', 'City Circuit'], ['desert', 'Desert Dash'], ['ice', 'Ice Track']],
    tower:    [['site', 'Building Site'], ['candy', 'Candy Land'], ['castle', 'Castle Walls']],
    treasure: [['cave', 'Cave of Coins'], ['beach', 'Pirate Beach'], ['vault', 'The Vault']],
    boss:     [['lair', 'Dragon Lair'], ['volcano', 'Volcano'], ['ruins', 'Old Ruins']],
    snow:     [['playground', 'Playground'], ['forest', 'Winter Forest'], ['peak', 'Mountain Peak']],
    balloon:  [['fair', 'Summer Fair'], ['clouds', 'Above the Clouds'], ['night', 'Night Sky']]
  };
  const mapsFor = (mode) => (MAPS[mode] || MAPS.normal).map(([id, label]) => ({ id, label }));
  const defaultMap = (mode) => (MAPS[mode] || MAPS.normal)[0][0];

  const TRACK_LENGTH = 1000, BOSS_HP_PER_QUESTION = 55;
  const FORT_BLOCKS = 12;          // how tall each team's fort starts
  const BALLOONS = 3;              // how many wrong answers a child can afford
  const MAX_PLAYER_HIT = 40;

  /* ── marking, shared with the rest of the app ─────────── */
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function grade(question, given) {
    const right = (question.choices || []).filter(c => c.correct).map(c => c.id);
    if (question.type === 'mc' || question.type === 'tf') return !!given && right.includes(given);
    if (question.type === 'multi') {
      if (!Array.isArray(given) || !right.length) return false;
      return given.length === right.length && right.every(id => given.includes(id));
    }
    if (question.type === 'short') {
      const accepted = String(question.answer || '').split(/\s*[|,]\s*/).map(norm).filter(Boolean);
      return accepted.length ? accepted.includes(norm(given)) : false;
    }
    return false;
  }

  /* ── the modes, same rules as the server edition ─── */
  const SCORERS = {
    normal(game, p, q, ok, speed) {
      if (!ok) { p.lastGain = 0; return; }
      const base = q.points || 100;
      const gain = Math.round((base * 0.5 + base * 0.5 * speed) * (1 + Math.min(p.streak, 5) * 0.1));
      p.score += gain; p.lastGain = gain;
    },
    laser(game, p, q, ok, speed) {
      const foe = p.team === 'red' ? 'blue' : 'red';
      const mates = Object.values(game.players);
      if (ok && !p.down) {
        let damage = Math.round(45 + 55 * speed);
        if (p.streak >= 3) damage = Math.round(damage * 1.8);
        const targets = mates.filter(x => x.team === foe && !x.down);
        let hitName = game.teams[foe].name;
        if (targets.length) {
          // whoever they lined up during the countdown, if that player is still standing
          const chosen = targets.find(x => x.id === p.target);
          const target = chosen || targets.reduce((a, b) => (a.hp >= b.hp ? a : b));
          target.hp = Math.max(0, target.hp - Math.min(damage, MAX_PLAYER_HIT));
          target.lastDamage = Math.min(damage, MAX_PLAYER_HIT);
          hitName = target.name;
          if (target.hp === 0) { target.down = true; game.lastEvents.push(`${p.name} knocked out ${target.name}`); }
        }
        game.teams[foe].hp = Math.max(0, game.teams[foe].hp - damage);
        game.teams[p.team].score += damage;
        p.score += damage;
        game.lastEvents.push(`${p.name} hit ${hitName} for ${damage}` + (p.streak >= 3 ? ' (overcharged)' : ''));
      } else if (ok && p.down) {
        const hurt = mates.filter(x => x.team === p.team && x.hp < 100);
        if (hurt.length) {
          const mate = hurt.reduce((a, b) => (a.hp <= b.hp ? a : b));
          mate.hp = Math.min(100, mate.hp + 25);
          if (mate.down && mate.hp > 0) mate.down = false;
          game.lastEvents.push(`${p.name} revived ${mate.name}, +25 HP`);
        }
        p.score += 25;
      } else {
        p.hp = Math.max(0, p.hp - 10);
        if (p.hp === 0) p.down = true;
        game.lastEvents.push(`${p.name} missed and lost shield`);
      }
    },
    kart(game, p, q, ok, speed) {
      if (!ok) { game.lastEvents.push(`${p.name} span out`); return; }
      let metres = Math.round(45 + 55 * speed);
      const boost = p.streak >= 3;
      if (boost) metres = Math.round(metres * 1.6);
      p.distance += metres; p.score = p.distance; p.lastGain = metres;
      game.lastEvents.push(`${p.name} drove ${metres}m` + (boost ? ' with a boost' : ''));
    },
    tower(game, p, q, ok, speed) {
      if (ok) {
        const gain = speed > 0.55 ? 2 : 1;
        p.blocks += gain; p.lastGain = gain;
        game.lastEvents.push(`${p.name} stacked ${gain} block${gain > 1 ? 's' : ''}`);
      } else {
        if (p.blocks > 0) game.lastEvents.push(`${p.name}'s tower wobbled and a block fell`);
        p.blocks = Math.max(0, p.blocks - 1); p.lastGain = -1;
      }
      p.score = p.blocks;
    },
    treasure(game, p, q, ok, speed) {
      if (!ok) { p.chest = ''; game.lastEvents.push(`${p.name} found an empty chest`); return; }
      let coins = Math.round(60 + 60 * speed);
      const roll = Math.random();
      let chest = '';
      if (roll < 0.12) { coins *= 3; chest = 'Jackpot, three times'; }
      else if (roll < 0.32) { coins *= 2; chest = 'Double chest'; }
      else if (roll < 0.42) {
        const others = Object.values(game.players).filter(x => x.id !== p.id && x.coins > 0);
        if (others.length) {
          const leader = others.reduce((a, b) => (a.coins >= b.coins ? a : b));
          const stolen = Math.floor(leader.coins * 0.2);
          leader.coins -= stolen; leader.score = leader.coins;
          coins += stolen; chest = `Raided ${leader.name} for ${stolen}`;
        }
      }
      p.coins += coins; p.score = p.coins; p.chest = chest; p.lastGain = coins;
      game.lastEvents.push(`${p.name} collected ${coins}` + (chest ? ` — ${chest}` : ''));
    },
    /* Snowball Fight: red against blue, and what the class watches is the other
     * side's fort coming down block by block. A team wins by knocking the last
     * block off, not by holding the highest number — which means a class that
     * fell behind early is still in it while a block remains. */
    snow(game, p, q, ok, speed) {
      const foe = p.team === 'red' ? 'blue' : 'red';
      const fort = game.teams[foe];
      if (!ok) {
        p.lastGain = 0;
        game.lastEvents.push(`${p.name} missed`);
        return;
      }
      // a fast answer throws harder, and a run of them throws harder still
      const power = 1 + Math.min(p.streak, 4) * 0.25;
      const hit = Math.min(fort.blocks, Math.max(1, Math.round((0.6 + speed) * power)));
      fort.blocks -= hit;
      const gain = Math.round((q.points || 100) * (0.5 + 0.5 * speed));
      p.score += gain; p.lastGain = gain; p.hits += hit;
      game.teams[p.team].score += gain;
      game.lastEvents.push(`${p.name} knocked ${hit} block${hit > 1 ? 's' : ''} off the ${fort.name} fort`
                           + (fort.blocks ? '' : ' — it is down!'));
    },

    /* Balloon Drop: three balloons each, and a wrong answer pops one. Being out
     * has to still be worth watching, so a child with no balloons left keeps
     * answering for points — they simply cannot win it any more. */
    balloon(game, p, q, ok, speed) {
      const out = p.balloons <= 0;
      if (!ok) {
        p.lastGain = 0;
        if (out) { game.lastEvents.push(`${p.name} got it wrong`); return; }
        p.balloons -= 1;
        game.lastEvents.push(p.balloons
          ? `${p.name} lost a balloon — ${p.balloons} left`
          : `${p.name} is out of balloons`);
        return;
      }
      const base = q.points || 100;
      // still floating is worth more than playing on for pride
      const gain = Math.round((base * 0.5 + base * 0.5 * speed) * (out ? 0.4 : 1));
      p.score += gain; p.lastGain = gain;
    },

    boss(game, p, q, ok, speed) {
      const boss = game.boss;
      if (ok) {
        let damage = Math.round(20 + 25 * speed);
        if (p.streak >= 3) damage = Math.round(damage * 1.5);
        boss.hp = Math.max(0, boss.hp - damage);
        p.score += damage; p.lastGain = damage;
        game.lastEvents.push(`${p.name} hit ${boss.name} for ${damage}`);
        if (boss.hp === 0) game.lastEvents.push(`${boss.name} is defeated`);
      } else {
        boss.classHp = Math.max(0, boss.classHp - 4);
        p.lastGain = 0;
        game.lastEvents.push(`${boss.name} struck back at the class`);
      }
    }
  };

  const BOSS_NAMES = ['Professor Puzzle', 'The Grumbling Grammarian', 'Baron Blunder',
                      'Countess Confusion', 'The Number Nibbler', 'Sir Slipsalot'];

  /* ── state helpers ────────────────────────────────────── */
  const blankPlayer = (row) => ({
    id: row.id, name: row.name, avatar: Number(row.avatar) || 0, team: row.team || 'red',
    score: 0, hp: 100, streak: 0, best: 0, answered: false, correct: null, down: false,
    lastDamage: 0, distance: 0, blocks: 0, coins: 0, chest: '', lastGain: 0, target: '',
    balloons: BALLOONS, hits: 0
  });

  async function readGame(pin) {
    const rows = await rest('GET', `/quiznova_live_games?pin=eq.${encodeURIComponent(pin)}&select=data`);
    if (!rows || !rows.length) throw Object.assign(new Error('That game code is not live.'), { status: 404 });
    return rows[0].data;
  }

  const writeGame = (pin, data) =>
    rest('PATCH', `/quiznova_live_games?pin=eq.${encodeURIComponent(pin)}`,
         { data, updated_at: new Date().toISOString() }, { prefer: 'return=minimal' });

  /** The public shape the host and player pages already know how to render. */
  function publicView(game) {
    const questions = game.questions || [];
    const idx = game.index;
    let question = null;
    if (idx >= 0 && idx < questions.length && (game.state === 'question' || game.state === 'reveal')) {
      const q = questions[idx];
      const reveal = game.state === 'reveal';
      question = {
        id: q.id, type: q.type, text: q.text, image: q.image || '',
        points: q.points, time: q.time,
        choices: (q.choices || []).map(c => reveal ? { id: c.id, text: c.text, correct: c.correct }
                                                   : { id: c.id, text: c.text })
      };
      if (reveal) { question.explanation = q.explanation || ''; question.answer = q.answer || ''; }
    }
    const players = Object.values(game.players || {}).sort((a, b) => b.score - a.score);
    return {
      pin: game.pin, mode: game.mode, map: game.map || defaultMap(game.mode),
      state: game.state, index: idx, total: questions.length,
      quizTitle: game.quizTitle, quizId: game.quizId, question, endsAt: game.endsAt, serverNow: now(),
      players, teams: game.teams, counts: game.counts || {}, lastEvents: game.lastEvents || [],
      // Laser Tag asks each child their own questions as their bar runs out, so
      // their phone needs the set. A child who digs into the page can read the
      // answers; the same is true of every game of this shape.
      quiz: game.mode === 'laser' && game.state === 'arena' ? questions : null,
      boss: game.boss || null, trackLength: TRACK_LENGTH, modeInfo: MODES[game.mode] || MODES.normal
    };
  }

  /** Open the question itself and start its clock. */
  function beginQuestion(game) {
    game.state = 'question';
    game.endsAt = now() + (game.questions[game.index].time || 20) * 1000 + 700;
  }

  /* Laser Tag runs on a two-beat round, the way a shooting game does: a short
   * countdown where everyone lines up a shot, then one question that decides
   * whether the shot lands. Every other game goes straight to the question. */
  function openQuestion(game) {
    game.index += 1;
    game.counts = {}; game.lastEvents = [];
    if (game.index >= game.questions.length) { game.state = 'over'; game.endsAt = null; return; }
    Object.values(game.players).forEach(p => {
      p.answered = false; p.correct = null; p.lastDamage = 0; p.lastGain = 0; p.chest = '';
    });
    beginQuestion(game);
  }

  const readPlayers = (pin) =>
    rest('GET', `/quiznova_live_players?pin=eq.${encodeURIComponent(pin)}&select=*`);
  const readAnswers = (pin, index) => index < 0 ? Promise.resolve([])
    : rest('GET', `/quiznova_live_answers?pin=eq.${encodeURIComponent(pin)}&q_index=eq.${index}&select=*`);

  /* ── the host's reconcile step: pull answers, score them ─ */
  async function reconcile(pin, game, prefetched) {
    const [playerRows, answerRows] = prefetched || await Promise.all([
      readPlayers(pin), readAnswers(pin, game.index)
    ]);

    let changed = false;

    // anyone new in the lobby
    for (const row of playerRows || []) {
      if (!game.players[row.id]) { game.players[row.id] = blankPlayer(row); changed = true; }
      else if (game.players[row.id].team !== (row.team || 'red') && game.state === 'lobby') {
        game.players[row.id].team = row.team || 'red'; changed = true;
      }
    }

    if (game.state === 'arena') {
      // the scores are earned in the arena and each phone saves its own
      for (const row of playerRows || []) {
        const player = game.players[row.id];
        if (player && Number(row.score || 0) !== player.score) {
          player.score = Number(row.score || 0); changed = true;
        }
      }
    }

    if (game.state === 'question') {
      const question = game.questions[game.index];
      for (const row of (answerRows || []).sort((a, b) => new Date(a.at) - new Date(b.at))) {
        const player = game.players[row.player_id];
        if (!player || player.answered) continue;
        const ok = grade(question, row.answer);
        player.answered = true;
        player.correct = ok;
        player.streak = ok ? player.streak + 1 : 0;
        player.best = Math.max(player.best, player.streak);
        const key = typeof row.answer === 'string' ? row.answer : JSON.stringify(row.answer);
        game.counts[key] = (game.counts[key] || 0) + 1;
        (SCORERS[game.mode] || SCORERS.normal)(game, player, question, ok, Math.max(0, Math.min(1, row.speed || 0)));
        changed = true;
      }
      game.lastEvents = game.lastEvents.slice(-6);

      const everyone = Object.values(game.players);
      const fortDown = game.mode === 'snow' &&
        ['red', 'blue'].some(side => game.teams[side].max && game.teams[side].blocks <= 0);
      if (game.mode === 'boss' && game.boss && (game.boss.hp === 0 || game.boss.classHp === 0)) {
        game.state = 'over'; game.endsAt = null; changed = true;
      } else if (fortDown) {
        game.state = 'over'; game.endsAt = null; changed = true;
      } else if (everyone.length && everyone.every(p => p.answered)) {
        game.state = 'reveal'; game.endsAt = null; changed = true;
      } else if (game.endsAt && now() >= game.endsAt) {
        game.state = 'reveal'; game.endsAt = null;
        everyone.forEach(p => {
          if (p.answered) return;
          p.streak = 0;
          // letting the clock run out cannot be the safe move: in Balloon Drop it
          // costs a balloon, the same as answering wrongly
          if (game.mode === 'balloon' && p.balloons > 0) {
            p.balloons -= 1;
            game.lastEvents.push(`${p.name} ran out of time — ${p.balloons} balloon${p.balloons === 1 ? '' : 's'} left`);
          }
        });
        changed = true;
      }
    }

    if (changed) await writeGame(pin, game);
    return game;
  }

  /* ── the API the pages call ───────────────────────────── */
  // Nova.store writes JSON, so read it the same way rather than comparing quotes
  const hostTokenFor = (pin) => {
    try { return JSON.parse(localStorage.getItem('nova:host:' + pin)); } catch { return null; }
  };

  /* The host's poll needs the game, the players and this question's answers. Waiting
   * for the game row before asking for the other two doubles the round trip on a
   * school connection, so remember which question is open and ask for all three at
   * once — the host is the only device that moves the question on, so this cache
   * is only ever stale on the single poll after a page reload, which then refetches. */
  const openIndex = Object.create(null);

  async function handle(path, method, body) {
    if (path === '/modes') {
      return { modes: Object.entries(MODES).map(([id, m]) => Object.assign({ id, maps: mapsFor(id) }, m)) };
    }

    const m = path.match(/^\/games(?:\/([^/]+))?(\/.*)?$/);
    if (!m) return null;
    const [, pin, tail] = m;

    if (!pin && method === 'POST') {                       // create
      const quiz = body.quiz;
      if (!quiz || !quiz.questions || !quiz.questions.length) {
        throw new Error('Add at least one question first.');
      }
      const questions = JSON.parse(JSON.stringify(quiz.questions));
      if (quiz.settings && quiz.settings.shuffleQuestions) questions.sort(() => Math.random() - 0.5);
      const newPin = String(Math.floor(100000 + Math.random() * 900000));
      const game = {
        pin: newPin, hostToken: rid(16), quizId: quiz.id, quizTitle: quiz.title,
        mode: MODES[body.mode] ? body.mode : 'normal',
        map: '',
        state: 'lobby', index: -1, questions, players: {},
        teams: { red: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Crimson' },
                 blue: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Cobalt' } },
        counts: {}, lastEvents: [], createdAt: now()
      };
      const maps = mapsFor(game.mode).map(m => m.id);
      game.map = maps.includes(body.map) ? body.map : defaultMap(game.mode);
      await rest('POST', '/quiznova_live_games', { pin: newPin, data: game }, { prefer: 'return=minimal' });
      return { pin: newPin, hostToken: game.hostToken, mode: game.mode, quizTitle: quiz.title, total: questions.length };
    }

    let prefetched = null, game;
    if (!tail && method === 'GET' && hostTokenFor(pin) != null) {
      const guess = openIndex[pin] ?? -1;
      const [row, playerRows, answerRows] = await Promise.all([
        readGame(pin), readPlayers(pin), readAnswers(pin, guess)
      ]);
      game = row;
      if (game.index === guess) prefetched = [playerRows, answerRows];
      else prefetched = [playerRows, await readAnswers(pin, game.index)];
    } else {
      game = await readGame(pin);
    }
    openIndex[pin] = game.index;
    const isHost = hostTokenFor(pin) === game.hostToken;

    if (!tail && method === 'GET') {
      // only the host reconciles, so there is exactly one writer
      if (isHost) await reconcile(pin, game, prefetched);
      return publicView(game);
    }

    if (tail === '/join' && method === 'POST') {
      if (game.state === 'over') throw new Error('This game has finished.');
      // ask the table, not the host's copy: someone may have joined a second ago
      const already = await readPlayers(pin) || [];
      const red = already.filter(p => p.team === 'red').length;
      const blue = already.filter(p => p.team === 'blue').length;
      const row = {
        id: rid(10), pin, name: (body.name || 'Player').slice(0, 16),
        avatar: String(wantedFace(body.avatar, already.map(p => p.avatar))),
        team: red <= blue ? 'red' : 'blue'
      };
      await rest('POST', '/quiznova_live_players', row, { prefer: 'return=minimal' });
      return { player: blankPlayer(row), game: publicView(game) };
    }

    if (tail === '/score' && method === 'POST') {
      await rest('PATCH', `/quiznova_live_players?id=eq.${encodeURIComponent(body.playerId)}`,
                 { score: Math.max(0, Math.round(Number(body.score) || 0)) }, { prefer: 'return=minimal' });
      return { ok: true };
    }

    if (tail === '/team' && method === 'POST') {
      const rows = await rest('GET', `/quiznova_live_players?id=eq.${encodeURIComponent(body.playerId)}&select=team`);
      const next = rows && rows[0] && rows[0].team === 'red' ? 'blue' : 'red';
      await rest('PATCH', `/quiznova_live_players?id=eq.${encodeURIComponent(body.playerId)}`,
                 { team: next }, { prefer: 'return=minimal' });
      return { team: next };
    }

    if (tail === '/answer' && method === 'POST') {
      if (game.state !== 'question') throw new Error('No question is open.');
      const limit = (game.questions[game.index].time || 20) * 1000;
      const left = Math.max(0, (game.endsAt || now()) - now());
      try {
        await rest('POST', '/quiznova_live_answers', {
          pin, player_id: body.playerId, q_index: game.index,
          answer: body.answer, speed: limit ? Math.max(0, Math.min(1, left / limit)) : 0
        }, { prefer: 'return=minimal' });
      } catch (err) {
        if (err.status === 409) throw new Error('Already answered.');   // the primary key caught it
        throw err;
      }
      // the host scores it on its next pass; the player waits for that state
      return { correct: null, score: 0, hp: 100, streak: 0, state: game.state };
    }

    if (!isHost) throw new Error('Only the host can control the game.');

    if (tail === '/start') {
      await reconcile(pin, game);
      if (game.mode === 'laser') {
        // one long round: the arena runs until the teacher stops it, and each
        // child's own energy bar decides when they break off to answer
        game.state = 'arena';
        game.index = 0;
        game.endsAt = null;
        await writeGame(pin, game);
        return publicView(game);
      }
      if (game.mode === 'snow') {
        // a fort per team, sized so a small class still gets to knock one down
        for (const side of ['red', 'blue']) {
          const n = Object.values(game.players).filter(p => p.team === side).length;
          game.teams[side].blocks = Math.max(6, Math.min(FORT_BLOCKS, 3 + n * 2));
          game.teams[side].max = game.teams[side].blocks;
        }
      }
      if (game.mode === 'balloon') {
        for (const p of Object.values(game.players)) p.balloons = BALLOONS;
      }
      if (game.mode === 'boss') {
        const hp = BOSS_HP_PER_QUESTION * Math.max(1, game.questions.length);
        game.boss = { hp, max: hp, name: BOSS_NAMES[Math.floor(Math.random() * BOSS_NAMES.length)],
                      classHp: 100, classMax: 100 };
      }
      openQuestion(game);
      await writeGame(pin, game);
      return publicView(game);
    }
    if (tail === '/next') {
      if (game.state === 'question') { game.state = 'reveal'; game.endsAt = null; }
      else openQuestion(game);
      await writeGame(pin, game);
      return publicView(game);
    }
    if (tail === '/tick') { await reconcile(pin, game); return publicView(game); }
    if (tail === '/end') { game.state = 'over'; game.endsAt = null; await writeGame(pin, game); return publicView(game); }

    return null;
  }

  global.NovaLive = { handle, MODES, configured: Boolean(URL_BASE && PUBLISHABLE) };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaLive;
