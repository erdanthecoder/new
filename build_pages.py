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

PAGES = ["quiznova.html", "studio.html", "take.html"]
ASSETS = ["nova.css", "nova.js", "qr.js", "nova-local.js"]


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
        html = html.replace('<script src="/nova.js"></script>',
                            '<script src="nova.js"></script>\n<script src="nova-local.js"></script>')
        html = html.replace('<script src="/qr.js"></script>', '<script src="qr.js"></script>')
        html = html.replace('href="/nova.css"', 'href="nova.css"')

        # relative links: Pages serves from a subfolder, not the domain root
        html = html.replace('href="/quiz"', 'href="index.html"')
        html = html.replace("href: '/studio?id=' + q.id", "href: 'studio.html?id=' + q.id")
        html = html.replace("location.href = '/studio?id=' + quiz.id", "location.href = 'studio.html?id=' + quiz.id")
        html = html.replace("location.href = '/quiz'", "location.href = 'index.html'")
        html = html.replace('href="/index.html"', 'href="index.html"')
        html = html.replace("'/studio?id=' + quizId", "'studio.html?id=' + quizId")

        # share links carry the quiz inside the URL — there is no server to ask
        html = html.replace("const link = location.origin + '/take?id=' + q.id;", "const link = Nova.shareLink(q.id);")
        html = html.replace("const link = location.origin + '/take?id=' + quizId;", "const link = Nova.shareLink(quizId);")

        # live games genuinely need a server — say so rather than fail on click
        html = html.replace(
            '<button class="btn sm primary" id="present">▶ Play live</button>',
            '<button class="btn sm" id="present" title="Live PIN games need the server edition">▶ Play live</button>')
        html = html.replace(
            "$('#present').onclick = () => {",
            "$('#present').onclick = () => { return toast('Live PIN games need the server edition — see the README', 'bad'); }; "
            "const unusedPresent = () => {")

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
