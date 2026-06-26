#!/usr/bin/env python3
"""
KidWorld Server
Run: python server.py
Then open http://localhost:5000 in your browser
"""
from flask import Flask, send_from_directory
import os, sys

app = Flask(__name__)
PORT = int(os.environ.get('PORT', 5000))

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

if __name__ == '__main__':
    print()
    print("╔══════════════════════════════════════════╗")
    print("║           🌍  KidWorld  🌍               ║")
    print("╠══════════════════════════════════════════╣")
    print(f"║  Open this in your browser:              ║")
    print(f"║  http://localhost:{PORT}                   ║")
    print(f"║                                          ║")
    print(f"║  Students:  /index.html                  ║")
    print(f"║  Teacher:   /teacher.html  (teach2024)   ║")
    print(f"║                                          ║")
    print(f"║  Press CTRL+C to stop                    ║")
    print("╚══════════════════════════════════════════╝")
    print()
    app.run(host='0.0.0.0', port=PORT, debug=False)
