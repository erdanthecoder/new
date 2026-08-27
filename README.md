# 🌍 KidWorld + ⚡ QuizNova

A fun learning platform for Year 1 & 2 students — **and** QuizNova, a realtime quiz
studio with an AI co-pilot, homework links for Google Classroom, and two live game modes.

---

## 🚀 How to Run (Local)

### Windows
1. Install [Python](https://www.python.org/downloads/) *(tick “Add Python to PATH”)*
2. Double-click **`start.bat`**
3. It opens at **http://localhost:5000**

### Mac / Linux
```bash
chmod +x start.sh && ./start.sh
```

### Manual start (any OS)
```bash
pip install -r requirements.txt
python server.py
```

---

## 🌐 Pages

| URL | Who | What |
|-----|-----|------|
| `/` | Everyone | Landing page |
| `/quiz` | Teacher | **QuizNova hub** — all quizzes, create, host, share |
| `/studio?id=…` | Teacher | **Realtime builder** + AI co-pilot + responses |
| `/take?id=…` | Student | Take a quiz / homework (the Google Classroom link) |
| `/host?pin=…` | Teacher | Live game board for the projector |
| `/play?pin=…` | Student | Join a live game on a phone or laptop |
| `/student.html` | Students | KidWorld learning app |
| `/teacher.html` | Teacher | KidWorld dashboard (password: `teach2024`) |

---

## ⚡ QuizNova

### Realtime builder (`/studio`)
Google-Forms-style cards — multiple choice, multi-select, true/false and short answer —
with points and a per-question timer. Everything saves automatically and **streams to
every other person who has the quiz open**, with presence avatars in the header so you can
see who is editing beside you. Drag the outline on the left to reorder.

### The AI co-pilot — only edits when you allow it
The panel on the right can add, rewrite, reorder and delete questions. You choose how much
rope it gets, and the setting is remembered:

| Mode | What happens |
|------|--------------|
| **Ask me** *(default)* | The AI returns a list of exact operations — `ADD`, `EDIT`, `DELETE`, `REORDER` — and nothing changes until you press **Approve**. |
| **Auto-edit** | Changes are applied immediately and the edited cards flash green. |
| **Read-only** | The AI answers but is blocked from touching the quiz at all. |

Every applied change is logged in the chat and broadcast to other editors in realtime.

**Live Claude:** set an API key and restart — the co-pilot writes original questions for
any topic, reading level or curriculum.

```bash
export ANTHROPIC_API_KEY=sk-ant-…      # Windows: set ANTHROPIC_API_KEY=sk-ant-…
export QUIZNOVA_MODEL=claude-sonnet-5  # optional
python server.py
```

Without a key it still works: a built-in question bank (maths, science, English,
geography, history) handles “add 5 questions”, “make it harder”, “delete the last
question”, “rename the quiz” and so on, so the panel is never dead.

### Homework & Google Classroom
Press **🔗 Share** in the studio. You get a student link plus a
**📚 Send to Google Classroom** button that opens Classroom’s share dialog with the
link and title filled in — assign it as homework in two clicks. Students type their
name, answer, and get instant marking with explanations. Results appear live in the
studio’s **Responses** tab: average, top score, a per-question success bar, and every
student’s paper.

### Live games (`/host` + `/play`)
Press **▶ Play live**, pick a mode, and the board shows a six-digit PIN. Students join at
`yoursite/play`. Scoring is done on the server, so nobody can fake a score.

**🎯 Normal mode** — answer fast for more points, streaks add up to a ×1.5 multiplier,
and the leaderboard reshuffles after every question. Ends on a podium.

**🔫 Laser Tag mode** — two auto-balanced teams (Crimson vs Cobalt), each with a shield
pool and every player on 100 HP:

* A correct answer **fires at the strongest opponent still standing** — faster answers hit harder.
* **Three correct in a row = ⚡ OVERCHARGE**, 1.8× damage.
* A wrong answer costs you 10 shield.
* At 0 HP you are **down** — but not out: your correct answers now **revive and heal teammates**.
* No single shot can knock a player out, so nobody sits idle.
* The team with shields left when the questions run out wins.

The host board shows both HP bars, every fighter’s health, and a live kill feed.

---

## ☁️ Put it on the internet (get a real web address)

The app is a Python web server, so it needs a host. Both options below are free,
take about three minutes, and give you an `https://…` link you can paste into
Google Classroom.

### Option A — Render (one click, uses `render.yaml`)
1. Push this repo to GitHub (already done if you are reading this on GitHub)
2. Go to [render.com](https://render.com) → sign in with GitHub
3. **New → Blueprint** → pick this repository → **Apply**
4. Wait for the first build, then open the URL Render shows you
   (something like `https://quiznova.onrender.com`)
5. Share `your-url/quiz` with yourself and `your-url/play` with students

> On Render's free plan the site sleeps after 15 minutes idle and takes ~30
> seconds to wake. Open it a minute before your lesson starts.

### Option B — Railway
1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
2. Pick this repo — the `Procfile` is detected automatically
3. **Settings → Networking → Generate Domain**
4. Open the domain and go to `/quiz`

### Turning on live Claude (optional)
In either dashboard add an environment variable:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | your key from [console.anthropic.com](https://console.anthropic.com) |

Without it the co-pilot still works from its built-in question bank.

### Two things to know about hosting

**One worker, many threads.** Live games and realtime streams are held in the
server's memory, so the `Procfile` deliberately runs a *single* gunicorn worker
with 128 threads. Adding workers would put half your class in a different copy
of the game. Each open realtime connection uses one thread, so 128 covers a
large class comfortably.

**Quizzes are stored in `data/store.json`.** That file lives on the server's
disk, which free hosts wipe on every redeploy. Quizzes and results survive
restarts but not redeploys — attach a persistent disk (Render) or a volume
(Railway) mounted at `data/`, or move the store to a database, if you need them
to last a whole year.

---

## 📁 File structure

```
├── server.py          ← Flask app + friendly routes
├── quizapi.py         ← QuizNova API: quizzes, realtime, AI, live games
├── data/store.json    ← quizzes & responses (created on first run)
├── requirements.txt
├── Procfile           ← production start command (1 worker, 128 threads)
├── render.yaml        ← one-click Render blueprint
├── start.bat / start.sh
└── static/
    ├── index.html     ← landing page
    ├── nova.css       ← QuizNova design system
    ├── nova.js        ← shared helpers, API + realtime client
    ├── quiznova.html  ← quiz hub
    ├── studio.html    ← realtime builder + AI co-pilot
    ├── take.html      ← student / homework view
    ├── host.html      ← live game board
    ├── play.html      ← live player view
    ├── student.html   ← KidWorld student app
    └── teacher.html   ← KidWorld teacher dashboard
```

## 🔑 KidWorld teacher password
Default **`teach2024`** — search for `teach2024` in `static/teacher.html` to change it.
