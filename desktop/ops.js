/* Editing a quiz, as a list of operations.
 *
 * The studio sends what it wants done rather than the whole quiz, so two people
 * editing at once cannot overwrite each other wholesale — and the AI co-pilot
 * proposes the very same operations, which is why a teacher can read and refuse
 * each one before it happens.
 */
const { blankQuestion, blankChoice } = require('./store.js');

function applyOps(quiz, ops) {
  const log = [];
  let questions = quiz.questions || (quiz.questions = []);
  const index = new Map(questions.map(q => [q.id, q]));
  const clip = (s) => String(s || '').slice(0, 60);

  const madeChoices = (list) => list.map(c => blankChoice(String(c && c.text || ''), !!(c && c.correct)));

  for (const op of ops || []) {
    const kind = op && op.op;

    if (kind === 'add_question') {
      const payload = op.question || {};
      const q = blankQuestion(payload.type || 'mc');
      q.text = payload.text || '';
      q.points = Number(payload.points) || quiz.settings.defaultPoints;
      q.time = Number(payload.time) || quiz.settings.defaultTime;
      q.explanation = payload.explanation || '';
      q.answer = payload.answer || '';
      if (Array.isArray(payload.choices) && payload.choices.length) {
        q.choices = madeChoices(payload.choices);
        if (q.type === 'mc' && !q.choices.some(c => c.correct)) q.choices[0].correct = true;
      }
      if (Number.isInteger(op.at) && op.at >= 0 && op.at <= questions.length) questions.splice(op.at, 0, q);
      else questions.push(q);
      index.set(q.id, q);
      log.push(`Added: “${clip(q.text || 'new question')}”`);

    } else if (kind === 'delete_question') {
      let found = index.get(op.id);
      if (!found && Number.isInteger(op.at) && op.at >= 0 && op.at < questions.length) found = questions[op.at];
      if (found) {
        questions.splice(questions.indexOf(found), 1);
        index.delete(found.id);
        log.push(`Deleted: “${clip(found.text || 'question')}”`);
      }

    } else if (kind === 'update_question') {
      let found = index.get(op.id);
      if (!found && Number.isInteger(op.at) && op.at >= 0 && op.at < questions.length) found = questions[op.at];
      if (found) {
        const patch = op.patch || {};
        for (const key of ['text', 'explanation', 'answer', 'image', 'type']) {
          if (key in patch) found[key] = patch[key];
        }
        for (const key of ['points', 'time']) {
          if (key in patch) { const n = Number(patch[key]); if (Number.isFinite(n)) found[key] = n; }
        }
        if (Array.isArray(patch.choices)) found.choices = madeChoices(patch.choices);
        log.push(`Edited: “${clip(found.text || 'question')}”`);
      }

    } else if (kind === 'reorder') {
      const ranked = (op.ids || []).map(id => index.get(id)).filter(Boolean);
      for (const q of questions) if (!ranked.includes(q)) ranked.push(q);
      quiz.questions = ranked;
      questions = quiz.questions;
      log.push('Reordered the questions');

    } else if (kind === 'update_quiz') {
      const patch = op.patch || {};
      for (const key of ['title', 'description', 'theme']) if (key in patch) quiz[key] = patch[key];
      if (patch.settings && typeof patch.settings === 'object') Object.assign(quiz.settings, patch.settings);
      log.push('Updated the quiz settings');
    }
  }
  return log;
}

module.exports = { applyOps };
