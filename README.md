# 🌍 KidWorld

A fun learning platform for Year 1 & 2 students — Maths, English and Russian.

---

## 🚀 How to Run (Local)

### Windows
1. Make sure [Python](https://www.python.org/downloads/) is installed  
   *(tick "Add Python to PATH" during install)*
2. Double-click **`start.bat`**
3. KidWorld opens at **http://localhost:5000** automatically

### Mac / Linux
1. Make sure Python 3 is installed
2. Open Terminal in this folder
3. Run: `chmod +x start.sh && ./start.sh`
4. KidWorld opens at **http://localhost:5000** automatically

### Manual start (any OS)
```bash
pip install flask
python server.py
```
Then open **http://localhost:5000**

---

## 🌐 Pages

| URL | Who | What |
|-----|-----|------|
| `/` | Everyone | Landing page |
| `/student.html` | Students | Full learning app |
| `/teacher.html` | Teacher | Dashboard (password: `teach2024`) |

---

## 🎮 What's Inside

### Student App
- 5-step onboarding (name, language 🇬🇧/🇷🇺, year, background)
- Full Year 1 & 2 curriculum: Maths, English, Russian
- **Maths → Summary tab**: Number bonds, times tables, fractions, shapes (Year-specific)
- Language Lab: EN ↔ RU flashcards + translation quiz
- 12 playable games
- 6 subject quizzes (auto-advance, no Next button)
- Teacher forms & quizzes (students answer in-app)
- Full Russian UI when Russian is selected

### Teacher Dashboard (password: `teach2024`)
- Post announcements (Normal / Urgent / Fun)
- Set homework (subject, year group, due date, points)
- **Google Form-style form builder**: Multiple choice, Text, Rating (1–5⭐), Yes/No
- **Quiz builder**: Same as forms but with correct answers marked
- Results dashboard with bar charts and per-student responses
- Live actions: 🪩 Disco, 🎊 Party, ⭐ Star Rain
- Student leaderboard & star rewards

---

## ☁️ Deploy to Railway (free hosting)

1. Push this folder to a GitHub repo (files at root level)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Pick your repo — Railway auto-detects Python
4. Settings → Networking → Generate Domain
5. Share `yourdomain.railway.app` with students and parents!

---

## 📁 File Structure

```
KidWorld/
├── server.py          ← Python web server (Flask)
├── requirements.txt   ← Python packages needed
├── Procfile           ← For Railway deployment
├── start.bat          ← Windows launcher (double-click!)
├── start.sh           ← Mac/Linux launcher
├── README.md          ← This file
└── static/
    ├── index.html     ← Landing page
    ├── student.html   ← Student app
    └── teacher.html   ← Teacher dashboard
```

---

## 🔑 Teacher Password
Default: **`teach2024`**  
To change it, edit line 7 in `server.py`:
```python
# No password in server.py - it's checked in teacher.html
```
Search for `teach2024` in `teacher.html` and change it.
