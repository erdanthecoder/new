# Quoldek

Your quiz site: **https://quoldek.web.app** (also at https://erdanthecoder.github.io/new/)

Make a quiz, let the co-pilot write the questions, send the link to Google
Classroom, or run it live on the projector while the class plays on their phones.

## Live game modes

| Mode | What happens |
|---|---|
| 🏆 Classic | Fastest correct answer scores the most points |
| 🔫 Laser Tag | Two teams, right answers fire, wrong answers cost shield |
| 🏎️ Kart Race | Every correct answer drives your kart down the track |
| 🏗️ Tower Build | Stack a block per correct answer, wrong answers topple one |
| 💎 Treasure Run | Answer to open chests and collect gems |
| 🐉 Boss Battle | The whole class attacks one boss together |

Hit **Host live**, put the PIN on the board, and students join at the same site.
The game runs through your Supabase project, so phones stay in sync with no server
to keep awake.

## Also in this repo

`server.py` runs the same thing as a normal Flask app (`pip install -r
requirements.txt && python server.py`) if you ever want it on your own host —
that edition can also use an Anthropic API key for the co-pilot. The KidWorld
learning pages live at `/student.html` and `/teacher.html`.
