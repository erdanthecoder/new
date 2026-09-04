# Quoldek for Windows

The app is not a browser pointed at the website. It runs the whole thing on the
computer it is installed on: the pages, the quizzes and the live game all come
from here, and the phones in the room join over the school's own wifi.

That is the point. School wifi is unreliable and school firewalls block things,
and neither can stop a lesson that never leaves the building.

## What it does that the website cannot

- **Works with no internet.** Nothing is fetched and nothing is sent. The
  address on the home screen is this computer; a phone on the same wifi reaches
  it directly.
- **Quizzes are files.** One `.json` per quiz in a folder you can open, copy,
  back up or email. Not inside a browser's storage where clearing the cache
  takes them away.
- **The board goes on the projector.** It opens on the second screen, full
  screen, while the laptop keeps the studio.
- **Settings that are actually settings.** A window of switches and sliders that
  save the moment you touch them.

## Running it

Download from the **Windows app** action on GitHub, or from a release:

- `Quoldek-x.y.z-windows-x64.exe` — the installer.
- `Quoldek-x.y.z-windows-x64.zip` — the same app, no installing. Unzip it
  anywhere and run `Quoldek.exe`. Useful on a school computer you cannot
  install software on.

Windows will warn about an unknown publisher, because the app is not signed —
signing needs a certificate that costs money every year. Choose **More info →
Run anyway**.

## Building it yourself

```
cd desktop
npm install
npm start          # run it
npm run dist       # build the installer and the zip
```

The zip can be built on any machine. The installer has to be built on Windows:
putting it together runs the installer once to produce its own uninstaller.
`.github/workflows/desktop.yml` does that on a Windows runner.

## How it is put together

| File | What it is |
|---|---|
| `main.js` | The app: windows, menu, the board on the projector, files |
| `server.js` | The site and the API, served from this computer |
| `games.js` | Live games, held in memory |
| `store.js` | Quizzes, as files on disk |
| `ops.js` | Editing a quiz as a list of operations |
| `settings.js` | What the teacher has chosen |
| `ui/home.html` | The app's own home screen |
| `ui/settings.html` | The settings window |

The rules of the games are not in here. They are in `../static/rules.js`, shared
with the website, so a game plays identically whichever way it is run.
