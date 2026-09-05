# Quoldek

Your quiz site: **https://quoldek.web.app** — everyone joins at **https://playquoldek.web.app**
(also at https://erdanthecoder.github.io/quiznova/)

Make a quiz, or paste in questions any chatbot wrote for you. Play it on the big
screen while everyone else answers on their own phone — a class, or the family
round the table. Or send the link to Google Classroom and let it mark itself.

## Live games

| Game | What happens |
|---|---|
| Normal | The fastest right answer scores the most |
| Laser Tag | One arena. Move, shoot, and answer when your energy runs out |
| Kart Race | Every right answer drives your kart further |
| Tower Build | Stack a block for each right answer |
| Treasure Run | Collect coins and open lucky chests |
| Boss Battle | Everyone fights one boss together |
| Snowball Fight | Two teams. Every right answer knocks a block off their fort |
| Balloon Drop | Three balloons each. Get one wrong and one pops |
| Tug of War | Two teams, one rope. Every right answer pulls it your way |
| Gold Heist | Every right answer opens a chest — and some of them rob somebody |
| Card Collector | Win a card for every right answer. First to all eight |

Each game has three maps to pick from, and everyone chooses their own character.

Hit **Host live**, put the PIN on the big screen, and everyone joins at **playquoldek.web.app**.
The game runs through your Supabase project, so phones stay in sync with no server
to keep awake.

## Quoldek for Windows

**[Download the app](https://github.com/erdanthecoder/quiznova/releases/latest)** —
the installer, or a zip that needs no installing. It runs the pages, the quizzes
and the live game on your own computer, and phones join over your wifi, so it
works with no internet at all. Quizzes are files in a folder you can back up.

## Also in this repo

`server.py` runs the same thing as a normal Flask app (`pip install -r
requirements.txt && python server.py`) if you ever want it on your own host —
that edition can also use an Anthropic API key for the co-pilot. The KidWorld
learning pages live at `/student.html` and `/teacher.html`.
