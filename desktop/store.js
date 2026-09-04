/* Quizzes on disk, as ordinary files.
 *
 * A quiz is one .json file in a folder the teacher can open, copy, back up or
 * email. That is the point of a desktop app: the work is theirs and it is
 * somewhere they can find it, rather than inside a browser's storage where a
 * cleared cache takes it away.
 */
const fs = require('fs');
const path = require('path');

const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
const now = () => Date.now();

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  file(id) { return path.join(this.dir, id + '.json'); }

  all() {
    const out = {};
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return out; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const quiz = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
        // a file somebody renamed still belongs to the quiz inside it
        if (quiz && quiz.id) out[quiz.id] = quiz;
      } catch { /* a half-written or hand-edited file is skipped, not fatal */ }
    }
    return out;
  }

  get(id) { return this.all()[id] || null; }

  save(quiz) {
    quiz.updatedAt = now();
    // written beside the target and moved into place, so a crash mid-write
    // cannot leave a teacher with half a quiz
    const tmp = this.file(quiz.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(quiz, null, 2), 'utf8');
    fs.renameSync(tmp, this.file(quiz.id));
    return quiz;
  }

  remove(id) {
    try { fs.unlinkSync(this.file(id)); return true; } catch { return false; }
  }
}

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

const newQuiz = (title, owner) => ({
  id: rid(8), title: title || 'Untitled quiz', description: '', owner: owner || 'Teacher',
  theme: 'aurora', createdAt: now(), updatedAt: now(), version: 1,
  settings: { shuffleQuestions: false, shuffleChoices: true, showAnswers: true,
              requireName: true, defaultTime: 20, defaultPoints: 100 },
  questions: []
});

module.exports = { Store, newQuiz, blankQuestion, blankChoice, rid, now };
