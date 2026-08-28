/* QuizNova — static edition.
 *
 * GitHub Pages serves files; it cannot run the Python server. This file
 * re-implements the API the pages call, entirely in the browser:
 *   • quizzes live in localStorage
 *   • share links carry the quiz inside the URL, so a student needs no account
 *   • marking and the AI question bank run client side
 * Live PIN games are the one thing that genuinely needs a server, so those
 * calls report a clear message instead of failing silently.
 */
(function (Nova) {
  'use strict';

  const KEY = 'nova:quizzes';
  const RESP = 'nova:responses';
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private */ } };
  const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
  const now = () => Date.now();

  /* ── quiz shapes, mirroring the server ─────────────── */
  const blankChoice = (text = '', correct = false) => ({ id: rid(6), text, correct });

  function blankQuestion(kind = 'mc') {
    const q = { id: rid(10), type: kind, text: '', points: 100, time: 20,
                explanation: '', image: '', choices: [], answer: '' };
    if (kind === 'mc' || kind === 'multi') {
      q.choices = [blankChoice(), blankChoice(), blankChoice(), blankChoice()];
      q.choices[0].correct = true;
    } else if (kind === 'tf') {
      q.choices = [blankChoice('True', true), blankChoice('False')];
    }
    return q;
  }

  const newQuiz = (title) => ({
    id: rid(8), title: title || 'Untitled quiz', description: '', owner: 'Teacher',
    theme: 'aurora', createdAt: now(), updatedAt: now(), version: 1,
    settings: { shuffleQuestions: false, shuffleChoices: true, showAnswers: true,
                requireName: true, defaultTime: 20, defaultPoints: 100 },
    questions: []
  });

  const allQuizzes = () => read(KEY, {});
  const saveQuizzes = (all) => write(KEY, all);
  const allResponses = () => read(RESP, {});

  /* ── marking ───────────────────────────────────────── */
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const correctIds = (q) => q.choices.filter(c => c.correct).map(c => c.id);

  function grade(question, given) {
    const kind = question.type;
    if (kind === 'mc' || kind === 'tf') return !!given && correctIds(question).includes(given);
    if (kind === 'multi') {
      const want = correctIds(question);
      if (!Array.isArray(given) || !want.length) return false;
      return given.length === want.length && want.every(id => given.includes(id));
    }
    if (kind === 'short') {
      const accepted = String(question.answer || '').split(/\s*[|,]\s*/).map(norm).filter(Boolean);
      return accepted.length ? accepted.includes(norm(given)) : false;
    }
    return false;
  }

  /* ── share links: the quiz travels inside the URL ───── */
  const toB64 = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64 = (b64) => decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))));

  function packQuiz(quiz) {
    // strip what a student does not need, keeping the link short
    const lean = {
      i: quiz.id, t: quiz.title, d: quiz.description, s: quiz.settings,
      q: quiz.questions.map(q => ({
        i: q.id, y: q.type, x: q.text, p: q.points, m: q.time, e: q.explanation,
        a: q.answer, c: q.choices.map(c => ({ i: c.id, x: c.text, k: c.correct ? 1 : 0 }))
      }))
    };
    return toB64(JSON.stringify(lean));
  }

  function unpackQuiz(packed) {
    const lean = JSON.parse(fromB64(packed));
    return {
      id: lean.i, title: lean.t, description: lean.d || '', theme: 'aurora',
      createdAt: now(), updatedAt: now(), version: 1,
      settings: Object.assign({ shuffleQuestions: false, shuffleChoices: true, showAnswers: true,
                                requireName: true, defaultTime: 20, defaultPoints: 100 }, lean.s || {}),
      questions: (lean.q || []).map(q => ({
        id: q.i, type: q.y, text: q.x, points: q.p, time: q.m, explanation: q.e || '',
        answer: q.a || '', image: '',
        choices: (q.c || []).map(c => ({ id: c.i, text: c.x, correct: !!c.k }))
      }))
    };
  }

  Nova.shareLink = (quizId) => {
    const quiz = allQuizzes()[quizId];
    const base = location.href.replace(/[^/]*$/, '') + 'take.html';
    return quiz ? `${base}#d=${packQuiz(quiz)}` : base;
  };

  /* ── the AI co-pilot, running offline ──────────────── */
  const BANK = {
    math: [
      ['What is 7 × 8?', ['56', '48', '64', '54'], '7 × 8 = 56.'],
      ['What is 144 ÷ 12?', ['12', '14', '11', '24'], 'Twelve twelves make 144.'],
      ['What is 25% of 80?', ['20', '25', '16', '40'], 'A quarter of 80 is 20.'],
      ['Which number is prime?', ['17', '21', '27', '33'], '17 has no factors except 1 and itself.'],
      ['Perimeter of a 5cm by 3cm rectangle?', ['16cm', '15cm', '8cm', '18cm'], '2 × (5 + 3) = 16cm.']
    ],
    science: [
      ['What gas do plants take in to photosynthesise?', ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium'], 'Plants take in carbon dioxide and give out oxygen.'],
      ['How many planets are in our solar system?', ['8', '9', '7', '10'], 'Eight, since Pluto was reclassified.'],
      ['What is the boiling point of water at sea level?', ['100°C', '90°C', '50°C', '120°C'], 'Water boils at 100°C at sea level.'],
      ['Which organ pumps blood around the body?', ['Heart', 'Lungs', 'Liver', 'Brain'], 'The heart pumps blood through the body.'],
      ['What force pulls objects towards Earth?', ['Gravity', 'Friction', 'Magnetism', 'Tension'], 'Gravity pulls objects toward the centre of the Earth.']
    ],
    english: [
      ['Which word is a noun?', ['Bicycle', 'Quickly', 'Bright', 'Running'], 'A noun names a person, place or thing.'],
      ["What is the past tense of 'go'?", ['Went', 'Goed', 'Gone', 'Going'], 'The past tense of go is went.'],
      ['Which sentence is punctuated correctly?', ['We ate lunch, then we played.', 'we ate lunch then we played', 'We ate lunch then, we played', 'We, ate lunch then we played'], 'The comma separates the two clauses.'],
      ["What is a synonym for 'happy'?", ['Joyful', 'Tired', 'Angry', 'Cold'], 'Joyful means the same as happy.'],
      ['Which word is spelled correctly?', ['Necessary', 'Neccessary', 'Necesary', 'Nesessary'], 'Necessary has one c and two s letters.']
    ],
    geography: [
      ['What is the capital of France?', ['Paris', 'Lyon', 'Marseille', 'Nice'], 'Paris is the capital of France.'],
      ['Which is the longest river in the world?', ['The Nile', 'The Amazon', 'The Danube', 'The Thames'], 'The Nile is generally listed as the longest.'],
      ['Which continent is Egypt in?', ['Africa', 'Asia', 'Europe', 'Oceania'], 'Egypt is in north east Africa.'],
      ['What is the largest ocean?', ['Pacific', 'Atlantic', 'Indian', 'Arctic'], 'The Pacific is the largest ocean.'],
      ['Mount Everest sits on the border of Nepal and…', ['China', 'India', 'Bhutan', 'Pakistan'], 'Everest sits on the Nepal–China border.']
    ],
    history: [
      ['In which year did the Second World War end?', ['1945', '1918', '1939', '1950'], 'It ended in 1945.'],
      ['Who was the first person on the Moon?', ['Neil Armstrong', 'Buzz Aldrin', 'Yuri Gagarin', 'Michael Collins'], 'Neil Armstrong stepped onto the Moon in 1969.'],
      ['The Great Fire of London happened in…', ['1666', '1066', '1766', '1566'], 'The Great Fire of London was in 1666.'],
      ['Who built the pyramids at Giza?', ['The ancient Egyptians', 'The Romans', 'The Greeks', 'The Vikings'], 'The ancient Egyptians built them as royal tombs.'],
      ["Which empire built Hadrian's Wall?", ['Roman', 'Ottoman', 'Mongol', 'British'], 'The Romans built it in Britain.']
    ]
  };
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };

  function offlineBrain(prompt, quiz) {
    const text = prompt.toLowerCase();
    let count = 5;
    const digits = text.match(/(\d+)(?=[^.]*\bquestion)/) || text.match(/^\D*(\d+)/);
    if (digits) count = Math.max(1, Math.min(20, parseInt(digits[1], 10)));
    else for (const [word, value] of Object.entries(WORDS)) {
      if (new RegExp(`\\b${word}\\b[^.]*\\bquestion`).test(text)) { count = value; break; }
    }

    let topic = Object.keys(BANK).find(k => text.includes(k));
    if (!topic) {
      const hints = { math: 'maths', english: 'grammar', science: 'biology', geography: 'capital', history: 'war' };
      topic = Object.keys(hints).find(k => text.includes(hints[k]));
    }
    if (!topic) {
      const blob = ((quiz.title || '') + ' ' + (quiz.description || '')).toLowerCase();
      topic = Object.keys(BANK).find(k => blob.includes(k)) || 'science';
    }

    if (/\b(delete|remove|clear)\b/.test(text)) {
      const targets = (/\ball\b|\bevery\b/.test(text) ? quiz.questions : quiz.questions.slice(-count));
      return { reply: `Removed ${targets.length} question(s).`,
               ops: targets.map(q => ({ op: 'delete_question', id: q.id })) };
    }
    if (/harder|difficult/.test(text)) {
      return { reply: 'Tightened the timers and raised the points.',
               ops: quiz.questions.map(q => ({ op: 'update_question', id: q.id,
                 patch: { time: Math.max(8, (q.time || 20) - 5), points: (q.points || 100) + 50 } })) };
    }
    if (/easier|simpler/.test(text)) {
      return { reply: 'Gave every question 10 extra seconds.',
               ops: quiz.questions.map(q => ({ op: 'update_question', id: q.id, patch: { time: (q.time || 20) + 10 } })) };
    }
    if (/title|rename/.test(text)) {
      const title = (prompt.split(':').pop() || '').trim().replace(/^"|"$/g, '') || `${topic} quiz`;
      return { reply: `Renamed the quiz to “${title}”.`, ops: [{ op: 'update_quiz', patch: { title } }] };
    }

    const bank = BANK[topic].slice().sort(() => Math.random() - 0.5);
    const ops = [];
    for (let i = 0; i < count; i++) {
      const [stem, options, why] = bank[i % bank.length];
      const shuffled = options.slice().sort(() => Math.random() - 0.5);
      ops.push({ op: 'add_question', question: {
        type: 'mc', text: stem, points: 100, time: 20, explanation: why,
        choices: shuffled.map(opt => ({ text: opt, correct: opt === options[0] }))
      } });
    }
    return { reply: `Added ${count} ${topic} question(s) for you.`, ops };
  }

  /* ── operations, mirroring the server's apply_ops ──── */
  function applyOps(quiz, ops) {
    const log = [];
    const find = (op) => quiz.questions.find(q => q.id === op.id)
      || (Number.isInteger(op.at) ? quiz.questions[op.at] : null);

    (ops || []).forEach(op => {
      if (op.op === 'add_question') {
        const p = op.question || {};
        const q = blankQuestion(p.type || 'mc');
        q.text = p.text || '';
        q.points = parseInt(p.points, 10) || quiz.settings.defaultPoints;
        q.time = parseInt(p.time, 10) || quiz.settings.defaultTime;
        q.explanation = p.explanation || '';
        q.answer = p.answer || '';
        if (Array.isArray(p.choices) && p.choices.length) {
          q.choices = p.choices.map(c => blankChoice(String(c.text || ''), !!c.correct));
          if (q.type === 'mc' && !q.choices.some(c => c.correct)) q.choices[0].correct = true;
        }
        if (Number.isInteger(op.at) && op.at >= 0 && op.at <= quiz.questions.length) quiz.questions.splice(op.at, 0, q);
        else quiz.questions.push(q);
        log.push(`Added: “${(q.text || 'new question').slice(0, 60)}”`);
      } else if (op.op === 'delete_question') {
        const q = find(op);
        if (q) { quiz.questions = quiz.questions.filter(x => x !== q); log.push(`Deleted: “${(q.text || 'question').slice(0, 60)}”`); }
      } else if (op.op === 'update_question') {
        const q = find(op);
        if (q) {
          const p = op.patch || {};
          ['text', 'explanation', 'answer', 'image', 'type'].forEach(k => { if (k in p) q[k] = p[k]; });
          ['points', 'time'].forEach(k => { if (k in p) q[k] = parseInt(p[k], 10) || q[k]; });
          if (Array.isArray(p.choices)) q.choices = p.choices.map(c => blankChoice(String(c.text || ''), !!c.correct));
          log.push(`Edited: “${(q.text || 'question').slice(0, 60)}”`);
        }
      } else if (op.op === 'reorder') {
        const ranked = (op.ids || []).map(id => quiz.questions.find(q => q.id === id)).filter(Boolean);
        quiz.questions = ranked.concat(quiz.questions.filter(q => !ranked.includes(q)));
        log.push('Reordered the questions');
      } else if (op.op === 'update_quiz') {
        const p = op.patch || {};
        ['title', 'description', 'theme'].forEach(k => { if (k in p) quiz[k] = p[k]; });
        if (p.settings) Object.assign(quiz.settings, p.settings);
        log.push('Updated the quiz settings');
      }
    });
    return log;
  }

  /* ── the API surface the pages call ────────────────── */
  const summary = (q) => ({
    id: q.id, title: q.title, description: q.description || '',
    questions: (q.questions || []).length, updatedAt: q.updatedAt, theme: q.theme || 'aurora',
    responses: (allResponses()[q.id] || []).length
  });

  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };

  Nova.api = async function (path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
    const clean = path.split('?')[0];
    const all = allQuizzes();

    if (clean === '/status') return { storage: 'browser', durable: true, quizzes: Object.keys(all).length, liveGames: 0, ai: false };
    if (clean === '/ai/status') return { live: false, model: 'built-in question bank' };

    if (clean === '/quizzes' && method === 'GET') {
      return { quizzes: Object.values(all).map(summary).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) };
    }
    if (clean === '/quizzes' && method === 'POST') {
      const quiz = newQuiz(body.title);
      if (body.starter !== false) quiz.questions = [blankQuestion('mc')];
      all[quiz.id] = quiz; saveQuizzes(all);
      return quiz;
    }

    // A shared link has no id in the path — the quiz rides in the fragment.
    const match = clean.match(/^\/quizzes\/([^/]*)(\/.*)?$/);
    if (match) {
      const [, id, tail] = match;
      let quiz = id ? all[id] : null;

      if (!quiz && location.hash.includes('d=')) {
        try {
          quiz = unpackQuiz(location.hash.split('d=')[1].split('&')[0]);
        } catch { /* malformed link */ }
      }
      if (!quiz) fail('Quiz not found', 404);

      if (!tail && method === 'GET') return quiz;
      if (!tail && method === 'DELETE') { delete all[id]; saveQuizzes(all); return { ok: true }; }
      if (!tail && method === 'PATCH') {
        ['title', 'description', 'theme', 'owner'].forEach(k => { if (k in body) quiz[k] = body[k]; });
        if (body.settings) Object.assign(quiz.settings, body.settings);
        if (Array.isArray(body.questions)) quiz.questions = body.questions;
        quiz.updatedAt = now(); quiz.version = (quiz.version || 0) + 1;
        all[quiz.id] = quiz; saveQuizzes(all);
        return quiz;
      }
      if (tail === '/ops' && method === 'POST') {
        const log = applyOps(quiz, body.ops);
        quiz.updatedAt = now(); quiz.version = (quiz.version || 0) + 1;
        all[quiz.id] = quiz; saveQuizzes(all);
        return { quiz, log };
      }
      if (tail === '/presence') return { people: [] };
      if (tail === '/submit' && method === 'POST') {
        const answers = body.answers || {};
        let score = 0, total = 0;
        const breakdown = quiz.questions.map(q => {
          const ok = grade(q, answers[q.id]);
          total += q.points || 100;
          if (ok) score += q.points || 100;
          return { id: q.id, correct: ok, given: answers[q.id],
                   expected: correctIds(q).length ? correctIds(q) : q.answer, explanation: q.explanation || '' };
        });
        const record = { id: rid(8), name: (body.name || 'Anonymous').trim().slice(0, 40), at: now(),
                         score, total, seconds: body.seconds || 0, answers, breakdown };
        const store = allResponses();
        (store[quiz.id] = store[quiz.id] || []).push(record);
        write(RESP, store);
        return record;   // note: stored on this device — see README on collecting results
      }
      if (tail === '/responses') {
        const rows = allResponses()[quiz.id] || [];
        const stats = quiz.questions.map(q => ({
          id: q.id, text: q.text || '',
          correct: rows.filter(r => r.breakdown.some(b => b.id === q.id && b.correct)).length,
          answered: rows.filter(r => r.breakdown.some(b => b.id === q.id)).length
        }));
        return { responses: rows, stats };
      }
    }

    if (clean === '/ai' && method === 'POST') {
      const quiz = all[body.quizId];
      if (!quiz) fail('Quiz not found', 404);
      const result = offlineBrain(body.prompt || '', quiz);
      if (body.permission === 'read') {
        return { reply: result.reply, ops: [], applied: false, source: 'offline',
                 note: 'Read only mode — I did not change anything.' };
      }
      if (body.permission === 'auto') {
        const log = applyOps(quiz, result.ops);
        quiz.updatedAt = now(); all[quiz.id] = quiz; saveQuizzes(all);
        return { reply: result.reply, ops: result.ops, applied: true, log, quiz, source: 'offline' };
      }
      return { reply: result.reply, ops: result.ops, applied: false, source: 'offline' };
    }

    if (clean.startsWith('/games')) {
      fail('Live PIN games need the server edition — see the README for one-click hosting.');
    }
    fail('Unknown request: ' + path, 404);
  };

  /* No server means no cross-device streaming; other tabs still sync. */
  Nova.stream = function (path, onMessage) {
    const handler = (evt) => { if (evt.key === KEY) onMessage({ event: 'poll', data: {} }); };
    window.addEventListener('storage', handler);
    return { close: () => window.removeEventListener('storage', handler) };
  };
})(window.Nova);
