/* Reading questions a teacher pasted in, however they happen to be written.
 *
 * The point is that a teacher can ask any chatbot — Gemini, ChatGPT, Claude —
 * "write me ten questions about the Romans", copy whatever comes back, and paste
 * it here. None of them agree on a format, and none of them can be relied on to
 * follow one exactly, so nothing here demands a format. It reads JSON if it is
 * given JSON, and reads the ordinary numbered-question-with-A-B-C-D layout
 * otherwise, which is what these tools write when left alone.
 *
 * It never guesses at an answer. A question whose correct answer cannot be
 * identified is still imported, with the first option marked — and the caller is
 * told how many of those there were, so the teacher can check them.
 */
(function (global) {
  'use strict';

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  /* Chatbots decorate: **bold**, `code`, leading bullets, trailing colons. */
  const plain = (s) => clean(s)
    .replace(/^[-*••]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();

  const LETTERS = 'abcdefghij';

  /* ── JSON ────────────────────────────────────────────
   * Every tool picks different key names, so ask for the value under any of the
   * names they use rather than insisting on one.
   */
  const pick = (obj, names) => {
    for (const n of names) {
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase().replace(/[^a-z]/g, '') === n) return obj[k];
      }
    }
    return undefined;
  };

  const Q_TEXT = ['question', 'prompt', 'text', 'q', 'title', 'stem'];
  const Q_OPTS = ['options', 'choices', 'answers', 'alternatives', 'a'];
  const Q_ANS = ['answer', 'correct', 'correctanswer', 'correctoption', 'correctchoice',
                 'correctindex', 'answerindex', 'solution', 'key'];
  const Q_WHY = ['explanation', 'why', 'reason', 'rationale', 'note', 'feedback'];

  /** Which option an answer refers to: an index, a letter, true/false, or the text itself. */
  function resolveAnswer(answer, options) {
    if (answer == null || answer === '') return -1;
    if (typeof answer === 'number' && Number.isFinite(answer)) {
      // "1" is the first option in some tools' output and the second in others.
      // An index that only fits one of the two readings settles it; otherwise
      // treat it as counting from zero, which is what JSON output usually means.
      if (answer >= 0 && answer < options.length) return answer;
      if (answer >= 1 && answer <= options.length) return answer - 1;
      return -1;
    }
    if (typeof answer === 'boolean') {
      const want = answer ? 'true' : 'false';
      const i = options.findIndex(o => clean(o).toLowerCase() === want);
      return i;
    }
    if (Array.isArray(answer)) return resolveAnswer(answer[0], options);
    const raw = plain(answer);
    if (!raw) return -1;
    // "B", "b)", "(C)", "Option D"
    const letter = raw.match(/^(?:option\s*)?\(?([a-j])\)?[.):]?$/i);
    if (letter) {
      const i = LETTERS.indexOf(letter[1].toLowerCase());
      if (i >= 0 && i < options.length) return i;
    }
    const digit = raw.match(/^\(?(\d{1,2})\)?[.):]?$/);
    if (digit) return resolveAnswer(Number(digit[1]), options);
    // the answer written out, possibly with its letter in front
    const stripped = raw.replace(/^\(?[a-j]\)?[.):]\s*/i, '');
    const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
    let i = options.findIndex(o => same(o, raw));
    if (i < 0) i = options.findIndex(o => same(o, stripped));
    return i;
  }

  function fromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const text = plain(pick(obj, Q_TEXT));
    if (!text) return null;

    let options = pick(obj, Q_OPTS);
    if (options && !Array.isArray(options) && typeof options === 'object') {
      // {"A": "...", "B": "..."} — keep the letters' order, not the object's
      options = Object.keys(options).sort().map(k => options[k]);
    }
    let list = Array.isArray(options)
      ? options.map(o => (o && typeof o === 'object' ? plain(pick(o, ['text', 'label', 'option', 'value'])) : plain(o)))
               .filter(Boolean)
      : [];
    // some tools mark the right one on the option itself
    let marked = -1;
    if (Array.isArray(options)) {
      options.forEach((o, i) => {
        if (o && typeof o === 'object' && (o.correct || o.isCorrect || o.is_correct)) marked = i;
      });
    }
    // strip a leading "A) " the tool left inside the option text
    list = list.map(o => o.replace(/^\(?[a-j]\)?[.):]\s+/i, ''));

    const why = plain(pick(obj, Q_WHY));
    const answer = pick(obj, Q_ANS);

    if (!list.length) {
      const t = clean(answer).toLowerCase();
      if (t === 'true' || t === 'false') {
        return { text, options: ['True', 'False'], correct: t === 'true' ? 0 : 1, why, sure: true };
      }
      // no options at all: a question the class types the answer to
      const written = plain(answer);
      if (!written) return null;
      return { text, options: [], written, why, sure: true };
    }

    let correct = marked >= 0 ? marked : resolveAnswer(answer, list);
    return { text, options: list, correct: correct < 0 ? 0 : correct, why, sure: correct >= 0 };
  }

  function fromJson(text) {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    let list = data;
    if (!Array.isArray(list) && data && typeof data === 'object') {
      list = pick(data, ['questions', 'quiz', 'items', 'data']) || null;
      if (!Array.isArray(list)) list = null;
    }
    if (!Array.isArray(list)) return null;
    const title = (data && !Array.isArray(data)) ? plain(pick(data, ['title', 'name', 'topic'])) : '';
    const out = list.map(fromObject).filter(Boolean);
    return out.length ? { title, questions: out } : null;
  }

  /* ── ordinary written-out questions ──────────────────
   * The layout every chatbot falls back to:
   *
   *   1. What is the capital of France?
   *   A) Rome   B) Paris   C) Madrid   D) Berlin
   *   Answer: B
   *   Because ...
   */
  const NUMBERED = /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\]:-]\s+(.*)$/i;
  const OPTION = /^\s*\(?([a-j])\)?\s*[.):-]\s+(.*)$/i;
  const ANSWER = /^\s*(?:\*\*)?(?:correct\s+)?answer\s*(?:key)?\s*(?:\*\*)?\s*[:.\-]\s*(.+)$/i;
  const WHY = /^\s*(?:\*\*)?(?:explanation|why|because|reason)(?:\*\*)?\s*[:.\-]\s*(.+)$/i;

  /* Chatbots wrap headings in ** and put bullets in front of options. Strip that
   * before matching, or "**1. Question**" never reads as question one. */
  const undress = (line) => line.trim()
    .replace(/^[-*•·]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/^_+|_+$/g, '')
    .trim();

  /** Pull "A) x  B) y  C) z" out of one line. Returns [] unless at least two are found. */
  function inlineOptions(line) {
    const found = [];
    const re = /(?:^|\s)\(?([a-j])\)?\s*[.):-]\s+([^]+?)(?=\s+\(?[a-j]\)?\s*[.):-]\s+|$)/gi;
    let m, expect = 0;
    while ((m = re.exec(line))) {
      if (LETTERS.indexOf(m[1].toLowerCase()) !== expect) return [];   // out of order: not an option list
      found.push(m[2].trim());
      expect++;
    }
    return found.length >= 2 ? found : [];
  }

  function fromProse(text) {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    let cur = null;
    /* "B) Paris (correct)" and "B) Paris ✓" both name the answer where it stands. */
    const addOption = (q, body) => {
      let text = plain(body);
      const marked = /\(\s*correct\s*\)\s*$/i.test(text) || /\bcorrect\s*$/i.test(text) || /[✓✔☑]\s*$/.test(text);
      if (marked) {
        text = text.replace(/\(\s*correct\s*\)\s*$/i, '').replace(/\bcorrect\s*$/i, '')
                   .replace(/[✓✔☑]\s*$/, '').replace(/[\s—–-]+$/, '').trim();
        q.answerAt = q.options.length;
      }
      if (text) q.options.push(text); else if (marked) q.answerAt = -1;
    };

    const finish = () => {
      if (!cur) return;
      const q = cur; cur = null;
      if (!q.text) return;
      if (q.options.length) {
        const at = q.answerAt >= 0 ? q.answerAt
                 : (q.answerText ? resolveAnswer(q.answerText, q.options) : -1);
        out.push({ text: q.text, options: q.options, correct: at < 0 ? 0 : at, why: q.why, sure: at >= 0 });
      } else if (q.answerText) {
        const t = q.answerText.toLowerCase();
        if (t === 'true' || t === 'false') {
          out.push({ text: q.text, options: ['True', 'False'], correct: t === 'true' ? 0 : 1, why: q.why, sure: true });
        } else {
          out.push({ text: q.text, options: [], written: q.answerText, why: q.why, sure: true });
        }
      }
    };

    /* An option marked in place ("B) 3 (correct)") is remembered by its position.
     * Remembering its text instead would go wrong the moment the text is a
     * number, which in a maths quiz it usually is. */
    const take = (q, body, isMarked) => {
      if (isMarked) q.answerAt = q.options.length;
      q.options.push(body);
    };

    for (const line of lines) {
      const bare = undress(line);
      if (!bare) continue;

      const num = bare.match(NUMBERED);
      if (num) {
        finish();
        cur = { text: plain(num[2]), options: [], why: '', answerText: '', answerAt: -1 };
        // the options are sometimes on the same line as the question
        const tail = inlineOptions(num[2]);
        if (tail.length) {
          cur.text = plain(num[2].slice(0, num[2].search(/\s\(?[a-j]\)?\s*[.):-]\s/i) + 1));
          tail.forEach(o => addOption(cur, o));
        }
        continue;
      }
      if (!cur) continue;

      const ans = bare.match(ANSWER);
      if (ans) { cur.answerText = plain(ans[1]); continue; }
      const why = bare.match(WHY);
      if (why) { cur.why = plain(why[1]); continue; }

      // options may be one per line, or several on one line
      const several = inlineOptions(bare);
      if (several.length) { several.forEach(o => addOption(cur, o)); continue; }
      const opt = bare.match(OPTION);
      if (opt) { addOption(cur, opt[2]); continue; }

      // a wrapped question line
      if (!cur.options.length && cur.text.length < 240) cur.text = plain(cur.text + ' ' + bare);
    }
    finish();
    return out.length ? { title: '', questions: out } : null;
  }

  /**
   * parse(text) → { title, questions, unsure } or null
   *   questions: [{ text, options[], correct, written, why }]
   *   unsure:    how many had no answer we could identify
   */
  function parse(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    // a fenced block is JSON often enough to be worth unwrapping first
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const found = (fenced && fromJson(fenced[1].trim()))
               || fromJson(raw)
               || fromProse(fenced ? fenced[1] : raw);
    if (!found) return null;
    found.unsure = found.questions.filter(q => !q.sure).length;
    return found;
  }

  global.NovaPaste = { parse, resolveAnswer };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaPaste;
