#!/usr/bin/env python3
"""Build the static (GitHub Pages) edition of Quoldek into docs/.

GitHub Pages serves files, it cannot run Python — so this build swaps the
Flask API for an in-browser one (nova-local.js) and drops the live-game pages,
which genuinely need a server. Everything else survives: the builder, the AI
co-pilot, homework links and instant marking.
"""
import hashlib
import os
import re
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "static")
OUT = os.path.join(ROOT, "docs")
# Students get their own short address. The join page is the whole site there,
# so a class types playquoldek.web.app rather than a path with a filename on it.
PLAY_OUT = os.path.join(ROOT, "docs-play")
PLAY_HOST = "playquoldek.web.app"
PLAY_ASSETS = ["nova.css", "logo.svg", "sprites.js", "nova.js", "quizbank.js", "realtime.js",
               "arena.js", "paste.js", "live.js", "nova-local.js", "account.js"]

# And the board gets its own address, so the screen at the front of the room is a
# site of its own rather than a page inside the studio.
LIVE_OUT = os.path.join(ROOT, "docs-live")
LIVE_HOST = "livequoldek.web.app"
LIVE_ASSETS = PLAY_ASSETS + ["qr.js", "music.js"]

PAGES = ["quiznova.html", "studio.html", "take.html", "host.html", "play.html"]
ASSETS = ["nova.css", "logo.svg", "sprites.js", "music.js", "nova.js", "qr.js", "quizbank.js", "realtime.js", "arena.js", "paste.js", "live.js", "nova-local.js", "account.js"]


def build():
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name != ".nojekyll":
            path = os.path.join(OUT, name)
            shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)

    # a content hash on each asset URL, so a returning browser can never serve a
    # stale copy of the app from its cache after a deploy
    stamps = {}
    for asset in ASSETS:
        src = os.path.join(SRC, asset)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(OUT, asset))
            digest = hashlib.sha256(open(src, "rb").read()).hexdigest()[:8]
            stamps[asset] = f"{asset}?v={digest}"

    for page in PAGES:
        html = open(os.path.join(SRC, page), encoding="utf-8").read()

        # the in-browser API must load right after the shared runtime
        html = html.replace('<script src="/sprites.js"></script>', '<script src="sprites.js"></script>')
        html = html.replace('<script src="/music.js"></script>', '<script src="music.js"></script>')
        html = html.replace('<script src="/arena.js"></script>', '')   # the bundle already adds it
        html = html.replace('<script src="/nova.js"></script>',
                            '<script src="nova.js"></script>\n'
                            '<script src="quizbank.js"></script>\n'
                            '<script src="realtime.js"></script>\n'
                            '<script src="arena.js"></script>\n'
                            '<script src="paste.js"></script>\n'
                            '<script src="live.js"></script>\n'
                            '<script src="nova-local.js"></script>\n'
                            '<script src="account.js"></script>')
        html = html.replace('<script src="/qr.js"></script>', '<script src="qr.js"></script>')
        html = html.replace('href="/nova.css"', 'href="nova.css"')
        html = html.replace('href="/logo.svg"', 'href="logo.svg"')

        # relative links: Pages serves from a subfolder, not the domain root
        html = html.replace('href="/quiz"', 'href="index.html"')
        html = html.replace("href: '/studio?id=' + q.id", "href: 'studio.html?id=' + q.id")
        html = html.replace("location.href = '/studio?id=' + quiz.id", "location.href = 'studio.html?id=' + quiz.id")
        html = html.replace("location.href = '/quiz'", "location.href = 'index.html'")
        html = html.replace('href="/index.html"', 'href="index.html"')
        html = html.replace("location.href = '/host?pin=' + game.pin",
                            "location.href = (window.QUOLDEK_LIVE\n"
                            "  ? 'https://' + window.QUOLDEK_LIVE + '/?pin=' + game.pin\n"
                            "  : 'host.html?pin=' + game.pin)")
        html = html.replace("location.href = '/play?pin=' + pin", "location.href = 'play.html?pin=' + pin")
        html = html.replace("href: '/play'", "href: 'play.html'")
        html = html.replace('href="/play"', 'href="play.html"')
        html = html.replace("location.href = '/play'", "location.href = 'play.html'")
        html = html.replace("history.replaceState(null, '', '/play?pin=' + pin)",
                            "history.replaceState(null, '', 'play.html?pin=' + pin)")
        if page == "host.html":
            # The board sends the class to the short address when this build is
            # the one that has it, and otherwise to the play page beside it.
            html = html.replace("const joinUrl = () => location.origin + '/play?pin=' + pin;",
                                "const joinUrl = () => (window.QUOLDEK_PLAY\n"
                                "  ? 'https://' + window.QUOLDEK_PLAY + '/?pin=' + pin\n"
                                "  : location.href.replace(/[^/]*$/, '') + 'play.html?pin=' + pin);")
            html = html.replace("const joinLabel = () => location.host + '/play';",
                                "const joinLabel = () => (window.QUOLDEK_PLAY\n"
                                "  || joinUrl().replace(/^https?:\\/\\//, '').replace(/\\?.*$/, ''));")
        else:
            # the other pages only mention the address in prose
            html = html.replace("${esc(location.host)}/play",
                                "${esc(location.host + location.pathname.replace(/[^/]*$/, ''))}play.html")
        html = html.replace("'/studio?id=' + quizId", "'studio.html?id=' + quizId")

        # share links carry the quiz inside the URL — there is no server to ask
        html = html.replace("const link = location.origin + '/take?id=' + q.id;", "const link = Nova.shareLink(q.id);")
        html = html.replace("const link = location.origin + '/take?id=' + quizId;", "const link = Nova.shareLink(quizId);")

        # live games run through Supabase in this edition, so the button stays live

        # the hub's pitch should match what this edition actually does
        # the hub's own pitch is written for this edition already


        # A deployed site sends everyone to the short address; a copy being run
        # from a laptop keeps pointing at the play page beside it, so a game
        # still works with no internet at all.
        html = html.replace("<script>", "<script>\n"
            "window.QUOLDEK_LOCAL = /^(localhost|127\\.|0\\.0\\.0\\.0|\\[?::1)/.test(location.hostname);\n"
            "window.QUOLDEK_PLAY = window.QUOLDEK_LOCAL ? '' : '" + PLAY_HOST + "';\n"
            "window.QUOLDEK_LIVE = window.QUOLDEK_LOCAL ? '' : '" + LIVE_HOST + "';", 1)

        for asset, stamped in stamps.items():
            html = html.replace(f'"{asset}"', f'"{stamped}"')

        open(os.path.join(OUT, "index.html" if page == "quiznova.html" else page), "w", encoding="utf-8").write(html)

    open(os.path.join(OUT, ".nojekyll"), "w").close()
    print("built docs/:", ", ".join(sorted(os.listdir(OUT))))
    build_play(stamps)
    build_live(stamps)


def build_play(stamps):
    """The join page on its own, as the root of the students' address.

    It is the same play.html, built again rather than copied, so there is one
    source for it and no chance of the two drifting apart.
    """
    os.makedirs(PLAY_OUT, exist_ok=True)
    for name in os.listdir(PLAY_OUT):
        path = os.path.join(PLAY_OUT, name)
        shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)

    for asset in PLAY_ASSETS:
        src = os.path.join(SRC, asset)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(PLAY_OUT, asset))

    html = open(os.path.join(OUT, "play.html"), encoding="utf-8").read()
    # on this site the join page is the root, so its own links must say so
    html = html.replace("'play.html?pin=' + pin", "'./?pin=' + pin")
    html = html.replace('href="play.html"', 'href="./"')
    html = html.replace("href: 'play.html'", "href: './'")
    html = html.replace("location.href = 'play.html'", "location.href = './'")
    html = html.replace('href="index.html"', 'href="https://quoldek.web.app/"')
    open(os.path.join(PLAY_OUT, "index.html"), "w", encoding="utf-8").write(html)
    open(os.path.join(PLAY_OUT, ".nojekyll"), "w").close()
    print("built docs-play/:", ", ".join(sorted(os.listdir(PLAY_OUT))))


def build_live(stamps):
    """The board on its own, as the root of the teacher's live address.

    A teacher opens the game from the studio, which sends them here with the PIN;
    arriving with no PIN, this asks for one, so a board can also be reopened on a
    different computer without going back through the studio.
    """
    os.makedirs(LIVE_OUT, exist_ok=True)
    for name in os.listdir(LIVE_OUT):
        path = os.path.join(LIVE_OUT, name)
        shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)

    for asset in LIVE_ASSETS:
        src = os.path.join(SRC, asset)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(LIVE_OUT, asset))

    html = open(os.path.join(OUT, "host.html"), encoding="utf-8").read()
    # on this site the board is the root, so its own links must say so
    html = html.replace("'host.html?pin=' + game.pin", "'./?pin=' + game.pin")
    html = html.replace('href="index.html"', 'href="https://quoldek.web.app/"')
    html = html.replace('href="studio.html', 'href="https://quoldek.web.app/studio.html')
    # index.html here is the board itself, so anything sent "home" must be sent
    # to the studio's own site rather than round in a circle
    html = html.replace("location.href = 'index.html'", "location.href = 'https://quoldek.web.app/'")
    html = html.replace("location.href = 'studio.html", "location.href = 'https://quoldek.web.app/studio.html")
    html = html.replace('href="play.html', 'href="https://' + PLAY_HOST + '/')
    open(os.path.join(LIVE_OUT, "index.html"), "w", encoding="utf-8").write(html)
    open(os.path.join(LIVE_OUT, ".nojekyll"), "w").close()
    print("built docs-live/:", ", ".join(sorted(os.listdir(LIVE_OUT))))


if __name__ == "__main__":
    build()
