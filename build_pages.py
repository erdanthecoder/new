#!/usr/bin/env python3
"""Build the static (GitHub Pages) edition of QuizNova into docs/.

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

PAGES = ["quiznova.html", "studio.html", "take.html", "host.html", "play.html"]
ASSETS = ["nova.css", "sprites.js", "nova.js", "qr.js", "quizbank.js", "realtime.js", "live.js", "nova-local.js"]


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
        html = html.replace('<script src="/nova.js"></script>',
                            '<script src="nova.js"></script>\n'
                            '<script src="quizbank.js"></script>\n'
                            '<script src="realtime.js"></script>\n'
                            '<script src="live.js"></script>\n'
                            '<script src="nova-local.js"></script>')
        html = html.replace('<script src="/qr.js"></script>', '<script src="qr.js"></script>')
        html = html.replace('href="/nova.css"', 'href="nova.css"')

        # relative links: Pages serves from a subfolder, not the domain root
        html = html.replace('href="/quiz"', 'href="index.html"')
        html = html.replace("href: '/studio?id=' + q.id", "href: 'studio.html?id=' + q.id")
        html = html.replace("location.href = '/studio?id=' + quiz.id", "location.href = 'studio.html?id=' + quiz.id")
        html = html.replace("location.href = '/quiz'", "location.href = 'index.html'")
        html = html.replace('href="/index.html"', 'href="index.html"')
        html = html.replace("location.href = '/host?pin=' + game.pin", "location.href = 'host.html?pin=' + game.pin")
        html = html.replace("location.href = '/play?pin=' + pin", "location.href = 'play.html?pin=' + pin")
        html = html.replace("href: '/play'", "href: 'play.html'")
        html = html.replace('href="/play"', 'href="play.html"')
        html = html.replace("location.href = '/play'", "location.href = 'play.html'")
        html = html.replace("history.replaceState(null, '', '/play?pin=' + pin)",
                            "history.replaceState(null, '', 'play.html?pin=' + pin)")
        if page == "host.html":
            # a folder-relative join link, shown without the protocol
            html = html.replace("const joinUrl = () => location.origin + '/play?pin=' + pin;",
                                "const joinUrl = () => location.href.replace(/[^/]*$/, '') + 'play.html?pin=' + pin;")
            html = html.replace("const joinLabel = () => location.host + '/play';",
                                "const joinLabel = () => joinUrl().replace(/^https?:\\/\\//, '').replace(/\\?.*$/, '');")
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
        html = html.replace(
            '<p class="lede">A Google-Forms-style builder that updates in realtime for everyone editing it, an AI that adds,\n      edits and deletes questions — but only when you allow it — and two live game modes your class will actually\n      ask to play again. Send any quiz straight to Google Classroom.</p>',
            '<p class="lede">A Google-Forms-style quiz builder with an AI that adds, edits and deletes questions — but only\n      when you allow it — and instant marking with explanations. Share a quiz straight to Google Classroom:\n      the link carries the whole quiz, so your students need no account and nothing to install.</p>')

        for asset, stamped in stamps.items():
            html = html.replace(f'"{asset}"', f'"{stamped}"')

        open(os.path.join(OUT, "index.html" if page == "quiznova.html" else page), "w", encoding="utf-8").write(html)

    open(os.path.join(OUT, ".nojekyll"), "w").close()
    print("built docs/:", ", ".join(sorted(os.listdir(OUT))))


if __name__ == "__main__":
    build()
