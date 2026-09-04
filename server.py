#!/usr/bin/env python3
"""
KidWorld + Quoldek server
Run: python server.py   →   http://localhost:5000
"""
from flask import Flask, send_from_directory, redirect
import os

from quizapi import api

app = Flask(__name__, static_folder=None)
app.register_blueprint(api, url_prefix="/api")

PORT = int(os.environ.get("PORT", 5000))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


@app.route("/")
def index():
    return send_from_directory(STATIC, "index.html")


# Friendly URLs for Quoldek — the ones teachers paste into Google Classroom.
@app.route("/quiz")
def quiz_home():
    return send_from_directory(STATIC, "quiznova.html")


@app.route("/studio")
def studio():
    return send_from_directory(STATIC, "studio.html")


@app.route("/take")
def take():
    return send_from_directory(STATIC, "take.html")


@app.route("/host")
def host():
    return send_from_directory(STATIC, "host.html")


@app.route("/play")
def play():
    return send_from_directory(STATIC, "play.html")


@app.route("/join")
def join():
    return redirect("/play")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC, filename)


@app.after_request
def no_cache(resp):
    if resp.mimetype in ("text/html", "application/javascript", "text/css"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


if __name__ == "__main__":
    print()
    print("  ╔══════════════════════════════════════════════╗")
    print("  ║        🌍 KidWorld  ·  ⚡ Quoldek           ║")
    print("  ╠══════════════════════════════════════════════╣")
    print(f"  ║  http://localhost:{PORT}".ljust(48) + "║")
    print("  ║                                              ║")
    print("  ║  Quiz hub     /quiz                          ║")
    print("  ║  Builder      /studio                        ║")
    print("  ║  Live host    /host                          ║")
    print("  ║  Play / join  /play                          ║")
    print("  ║  KidWorld     /student.html  /teacher.html   ║")
    print("  ║                                              ║")
    print("  ║  Set ANTHROPIC_API_KEY for the live AI       ║")
    print("  ║  Press CTRL+C to stop                        ║")
    print("  ╚══════════════════════════════════════════════╝")
    print()
    app.run(host="0.0.0.0", port=PORT, threaded=True, debug=False)
