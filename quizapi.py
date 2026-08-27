#!/usr/bin/env python3
"""
QuizNova API — realtime quiz builder, AI co-editor and live game arena.

Everything lives behind /api and is served by server.py (Flask).
Realtime is done with Server-Sent Events (no extra dependencies) plus a
polling fallback, so it runs anywhere Flask runs (Railway, Render, laptop).
"""
from __future__ import annotations

import json
import os
import queue
import random
import re
import string
import threading
import time
import urllib.error
import urllib.request
import uuid

from flask import Blueprint, Response, jsonify, request

api = Blueprint("api", __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STORE_PATH = os.path.join(DATA_DIR, "store.json")

_lock = threading.RLock()
_store = {"quizzes": {}, "responses": {}}
_games: dict[str, dict] = {}          # pin -> game state (in memory, live only)
_channels: dict[str, list[queue.Queue]] = {}
_presence: dict[str, dict] = {}       # quiz id -> {clientId: {name, colour, ts}}


# ─────────────────────────────────────────── storage ──

def _load() -> None:
    global _store
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(STORE_PATH):
        try:
            with open(STORE_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            _store = {"quizzes": data.get("quizzes", {}), "responses": data.get("responses", {})}
        except Exception:
            _store = {"quizzes": {}, "responses": {}}


def _save() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(_store, fh, ensure_ascii=False)
    os.replace(tmp, STORE_PATH)


_load()


# ─────────────────────────────────────────── realtime ──

def publish(channel: str, event: str, payload: dict) -> None:
    """Fan a message out to every open SSE connection on a channel."""
    msg = {"event": event, "data": payload, "ts": int(time.time() * 1000)}
    with _lock:
        subs = list(_channels.get(channel, []))
    for q in subs:
        try:
            q.put_nowait(msg)
        except queue.Full:
            pass


def subscribe(channel: str) -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=200)
    with _lock:
        _channels.setdefault(channel, []).append(q)
    return q


def unsubscribe(channel: str, q: queue.Queue) -> None:
    with _lock:
        subs = _channels.get(channel)
        if subs and q in subs:
            subs.remove(q)
        if subs is not None and not subs:
            _channels.pop(channel, None)


def sse(channel: str, hello: dict | None = None) -> Response:
    q = subscribe(channel)

    def stream():
        try:
            yield "retry: 2000\n\n"
            if hello is not None:
                yield f"data: {json.dumps({'event': 'hello', 'data': hello})}\n\n"
            last_beat = time.time()
            while True:
                try:
                    msg = q.get(timeout=1.0)
                    yield f"data: {json.dumps(msg)}\n\n"
                except queue.Empty:
                    if time.time() - last_beat > 15:
                        last_beat = time.time()
                        yield ": ping\n\n"
        except GeneratorExit:
            pass
        finally:
            unsubscribe(channel, q)

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─────────────────────────────────────────── helpers ──

def nid(n: int = 10) -> str:
    return uuid.uuid4().hex[:n]


def now_ms() -> int:
    return int(time.time() * 1000)


def new_pin() -> str:
    while True:
        pin = "".join(random.choice(string.digits) for _ in range(6))
        if pin not in _games:
            return pin


def blank_choice(text: str = "", correct: bool = False) -> dict:
    return {"id": nid(6), "text": text, "correct": correct}


def blank_question(kind: str = "mc") -> dict:
    q = {
        "id": nid(8),
        "type": kind,
        "text": "",
        "points": 100,
        "time": 20,
        "explanation": "",
        "image": "",
        "choices": [],
        "answer": "",
    }
    if kind in ("mc", "multi"):
        q["choices"] = [blank_choice(), blank_choice(), blank_choice(), blank_choice()]
        q["choices"][0]["correct"] = True
    elif kind == "tf":
        q["choices"] = [blank_choice("True", True), blank_choice("False")]
    return q


def new_quiz(title: str = "Untitled quiz", owner: str = "Teacher") -> dict:
    return {
        "id": nid(8),
        "title": title or "Untitled quiz",
        "description": "",
        "owner": owner,
        "theme": "aurora",
        "createdAt": now_ms(),
        "updatedAt": now_ms(),
        "version": 1,
        "settings": {
            "shuffleQuestions": False,
            "shuffleChoices": True,
            "showAnswers": True,
            "requireName": True,
            "defaultTime": 20,
            "defaultPoints": 100,
        },
        "questions": [],
    }


def quiz_or_404(qid: str):
    quiz = _store["quizzes"].get(qid)
    if not quiz:
        return None, (jsonify({"error": "Quiz not found"}), 404)
    return quiz, None


def touch(quiz: dict) -> dict:
    quiz["updatedAt"] = now_ms()
    quiz["version"] = quiz.get("version", 0) + 1
    return quiz


def summary(quiz: dict) -> dict:
    return {
        "id": quiz["id"],
        "title": quiz["title"],
        "description": quiz.get("description", ""),
        "questions": len(quiz.get("questions", [])),
        "updatedAt": quiz.get("updatedAt"),
        "theme": quiz.get("theme", "aurora"),
        "responses": len(_store["responses"].get(quiz["id"], [])),
    }


def correct_ids(question: dict) -> set:
    return {c["id"] for c in question.get("choices", []) if c.get("correct")}


def normalise(text) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def grade(question: dict, given) -> bool:
    kind = question.get("type", "mc")
    if kind in ("mc", "tf"):
        return bool(given) and given in correct_ids(question)
    if kind == "multi":
        return bool(given) and set(given) == correct_ids(question) and len(correct_ids(question)) > 0
    if kind == "short":
        accepted = [normalise(a) for a in re.split(r"\s*[|,]\s*", question.get("answer", "")) if normalise(a)]
        return normalise(given) in accepted if accepted else False
    return False


# ─────────────────────────────────────────── quizzes ──

@api.get("/quizzes")
def list_quizzes():
    with _lock:
        items = [summary(q) for q in _store["quizzes"].values()]
    items.sort(key=lambda q: q["updatedAt"] or 0, reverse=True)
    return jsonify({"quizzes": items})


@api.post("/quizzes")
def create_quiz():
    body = request.get_json(silent=True) or {}
    with _lock:
        quiz = new_quiz(body.get("title", "Untitled quiz"), body.get("owner", "Teacher"))
        if body.get("starter", True):
            quiz["questions"] = [blank_question("mc")]
        _store["quizzes"][quiz["id"]] = quiz
        _save()
    return jsonify(quiz), 201


@api.get("/quizzes/<qid>")
def get_quiz(qid):
    quiz, err = quiz_or_404(qid)
    return err or jsonify(quiz)


@api.delete("/quizzes/<qid>")
def delete_quiz(qid):
    with _lock:
        _store["quizzes"].pop(qid, None)
        _store["responses"].pop(qid, None)
        _save()
    publish(f"quiz:{qid}", "quiz:deleted", {"id": qid})
    return jsonify({"ok": True})


@api.patch("/quizzes/<qid>")
def patch_quiz(qid):
    body = request.get_json(silent=True) or {}
    client = body.get("clientId", "")
    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        for key in ("title", "description", "theme", "owner"):
            if key in body:
                quiz[key] = body[key]
        if "settings" in body and isinstance(body["settings"], dict):
            quiz["settings"].update(body["settings"])
        if "questions" in body and isinstance(body["questions"], list):
            quiz["questions"] = body["questions"]
        touch(quiz)
        _save()
        snapshot = json.loads(json.dumps(quiz))
    publish(f"quiz:{qid}", "quiz:updated", {"quiz": snapshot, "by": client})
    return jsonify(snapshot)


def apply_ops(quiz: dict, ops: list) -> list:
    """Apply a list of edit operations. Returns human readable log lines."""
    log = []
    questions = quiz.setdefault("questions", [])
    index = {q["id"]: q for q in questions}

    for op in ops or []:
        kind = op.get("op")
        if kind == "add_question":
            payload = op.get("question") or {}
            q = blank_question(payload.get("type", "mc"))
            q["text"] = payload.get("text", "")
            q["points"] = int(payload.get("points", quiz["settings"]["defaultPoints"]))
            q["time"] = int(payload.get("time", quiz["settings"]["defaultTime"]))
            q["explanation"] = payload.get("explanation", "")
            q["answer"] = payload.get("answer", "")
            if isinstance(payload.get("choices"), list) and payload["choices"]:
                q["choices"] = [
                    blank_choice(str(c.get("text", "")), bool(c.get("correct")))
                    for c in payload["choices"]
                ]
                if q["type"] == "mc" and not any(c["correct"] for c in q["choices"]):
                    q["choices"][0]["correct"] = True
            at = op.get("at")
            if isinstance(at, int) and 0 <= at <= len(questions):
                questions.insert(at, q)
            else:
                questions.append(q)
            index[q["id"]] = q
            log.append(f"Added: “{(q['text'] or 'new question')[:60]}”")

        elif kind == "delete_question":
            target = op.get("id")
            found = index.get(target)
            if found is None and isinstance(op.get("at"), int) and 0 <= op["at"] < len(questions):
                found = questions[op["at"]]
            if found:
                questions.remove(found)
                index.pop(found["id"], None)
                log.append(f"Deleted: “{(found.get('text') or 'question')[:60]}”")

        elif kind == "update_question":
            found = index.get(op.get("id"))
            if not found and isinstance(op.get("at"), int) and 0 <= op["at"] < len(questions):
                found = questions[op["at"]]
            if found:
                patch = op.get("patch") or {}
                for key in ("text", "explanation", "answer", "image", "type"):
                    if key in patch:
                        found[key] = patch[key]
                for key in ("points", "time"):
                    if key in patch:
                        try:
                            found[key] = int(patch[key])
                        except (TypeError, ValueError):
                            pass
                if isinstance(patch.get("choices"), list):
                    found["choices"] = [
                        blank_choice(str(c.get("text", "")), bool(c.get("correct")))
                        for c in patch["choices"]
                    ]
                log.append(f"Edited: “{(found.get('text') or 'question')[:60]}”")

        elif kind == "reorder":
            order = op.get("ids") or []
            ranked = [index[i] for i in order if i in index]
            ranked += [q for q in questions if q not in ranked]
            quiz["questions"] = ranked
            questions = quiz["questions"]
            log.append("Reordered the questions")

        elif kind == "update_quiz":
            patch = op.get("patch") or {}
            for key in ("title", "description", "theme"):
                if key in patch:
                    quiz[key] = patch[key]
            if isinstance(patch.get("settings"), dict):
                quiz["settings"].update(patch["settings"])
            log.append("Updated the quiz settings")

    return log


@api.post("/quizzes/<qid>/ops")
def quiz_ops(qid):
    body = request.get_json(silent=True) or {}
    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        log = apply_ops(quiz, body.get("ops") or [])
        touch(quiz)
        _save()
        snapshot = json.loads(json.dumps(quiz))
    publish(f"quiz:{qid}", "quiz:updated", {"quiz": snapshot, "by": body.get("clientId", ""), "log": log})
    return jsonify({"quiz": snapshot, "log": log})


@api.post("/quizzes/<qid>/presence")
def quiz_presence(qid):
    body = request.get_json(silent=True) or {}
    client = body.get("clientId") or nid(6)
    with _lock:
        room = _presence.setdefault(qid, {})
        room[client] = {
            "clientId": client,
            "name": body.get("name") or "Someone",
            "colour": body.get("colour") or "#6ea8ff",
            "cursor": body.get("cursor"),
            "ts": now_ms(),
        }
        cutoff = now_ms() - 12000
        for key in [k for k, v in room.items() if v["ts"] < cutoff]:
            room.pop(key, None)
        people = list(room.values())
    publish(f"quiz:{qid}", "presence", {"people": people})
    return jsonify({"people": people})


@api.get("/quizzes/<qid>/events")
def quiz_events(qid):
    quiz = _store["quizzes"].get(qid)
    return sse(f"quiz:{qid}", {"quiz": quiz})


# ─────────────────────────────────── homework / solo ──

@api.post("/quizzes/<qid>/submit")
def submit_quiz(qid):
    body = request.get_json(silent=True) or {}
    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        answers = body.get("answers") or {}
        breakdown, score, total = [], 0, 0
        for question in quiz["questions"]:
            given = answers.get(question["id"])
            ok = grade(question, given)
            total += int(question.get("points", 100))
            if ok:
                score += int(question.get("points", 100))
            breakdown.append({
                "id": question["id"],
                "correct": ok,
                "given": given,
                "expected": sorted(correct_ids(question)) or question.get("answer", ""),
                "explanation": question.get("explanation", ""),
            })
        record = {
            "id": nid(8),
            "name": (body.get("name") or "Anonymous").strip()[:40],
            "at": now_ms(),
            "score": score,
            "total": total,
            "seconds": int(body.get("seconds") or 0),
            "answers": answers,
            "breakdown": breakdown,
        }
        _store["responses"].setdefault(qid, []).append(record)
        _save()
    publish(f"quiz:{qid}", "response:new", {"response": record})
    return jsonify(record), 201


@api.get("/quizzes/<qid>/responses")
def quiz_responses(qid):
    quiz, err = quiz_or_404(qid)
    if err:
        return err
    rows = _store["responses"].get(qid, [])
    per_question = []
    for question in quiz["questions"]:
        got = [r for r in rows if any(b["id"] == question["id"] and b["correct"] for b in r["breakdown"])]
        answered = [r for r in rows if any(b["id"] == question["id"] for b in r["breakdown"])]
        per_question.append({
            "id": question["id"],
            "text": question.get("text", ""),
            "correct": len(got),
            "answered": len(answered),
        })
    return jsonify({"responses": rows, "stats": per_question})


# ────────────────────────────────────────────── AI ──

AI_SYSTEM = """You are the quiz co-pilot inside QuizNova, a classroom quiz builder.
You edit a quiz by returning JSON operations. Never return prose outside the JSON object.

Return exactly this shape:
{"reply": "<one short friendly sentence for the teacher>",
 "ops": [ ...operations... ]}

Allowed operations:
{"op":"add_question","at":<optional index>,"question":{"type":"mc|tf|short|multi","text":"...","choices":[{"text":"...","correct":true}],"answer":"for short answers","points":100,"time":20,"explanation":"..."}}
{"op":"update_question","id":"<question id>","patch":{ same fields as above }}
{"op":"delete_question","id":"<question id>"}
{"op":"reorder","ids":["id","id"]}
{"op":"update_quiz","patch":{"title":"...","description":"...","settings":{"defaultTime":20}}}

Rules:
- Multiple choice questions get exactly 4 choices with exactly one correct.
- true/false questions get exactly the two choices True and False.
- Keep language age appropriate for the class described in the quiz.
- Only touch what the teacher asked for. If nothing should change, return an empty ops list.
- Always write a short explanation for each question you create.
"""

TOPIC_BANK = {
    "math": [
        ("What is 7 x 8?", ["56", "48", "64", "54"], "7 x 8 = 56."),
        ("What is 144 / 12?", ["12", "14", "11", "24"], "12 twelves make 144."),
        ("What is 25% of 80?", ["20", "25", "16", "40"], "25% is a quarter, and a quarter of 80 is 20."),
        ("Which number is prime?", ["17", "21", "27", "33"], "17 has no factors except 1 and itself."),
        ("What is the perimeter of a 5cm by 3cm rectangle?", ["16cm", "15cm", "8cm", "18cm"], "2 x (5 + 3) = 16cm."),
    ],
    "science": [
        ("What gas do plants take in to photosynthesise?", ["Carbon dioxide", "Oxygen", "Nitrogen", "Helium"], "Plants take in carbon dioxide and give out oxygen."),
        ("How many planets are in our solar system?", ["8", "9", "7", "10"], "There are 8 planets since Pluto was reclassified."),
        ("What is the boiling point of water at sea level?", ["100°C", "90°C", "50°C", "120°C"], "Water boils at 100°C at sea level."),
        ("Which organ pumps blood around the body?", ["Heart", "Lungs", "Liver", "Brain"], "The heart pumps blood through the body."),
        ("What force pulls objects towards Earth?", ["Gravity", "Friction", "Magnetism", "Tension"], "Gravity pulls objects toward the centre of the Earth."),
    ],
    "english": [
        ("Which word is a noun?", ["Bicycle", "Quickly", "Bright", "Running"], "A noun names a person, place or thing."),
        ("What is the past tense of 'go'?", ["Went", "Goed", "Gone", "Going"], "The past tense of go is went."),
        ("Which sentence is punctuated correctly?", ["We ate lunch, then we played.", "we ate lunch then we played", "We ate lunch then, we played", "We, ate lunch then we played"], "The comma separates the two clauses correctly."),
        ("What is a synonym for 'happy'?", ["Joyful", "Tired", "Angry", "Cold"], "Joyful means the same as happy."),
        ("Which word is spelled correctly?", ["Necessary", "Neccessary", "Necesary", "Nesessary"], "Necessary has one c and two s letters."),
    ],
    "geography": [
        ("What is the capital of France?", ["Paris", "Lyon", "Marseille", "Nice"], "Paris is the capital of France."),
        ("Which is the longest river in the world?", ["The Nile", "The Amazon", "The Danube", "The Thames"], "The Nile is generally listed as the longest river."),
        ("Which continent is Egypt in?", ["Africa", "Asia", "Europe", "Oceania"], "Egypt is in north east Africa."),
        ("What is the largest ocean?", ["Pacific", "Atlantic", "Indian", "Arctic"], "The Pacific Ocean is the largest."),
        ("Mount Everest sits on the border of Nepal and…", ["China", "India", "Bhutan", "Pakistan"], "Everest sits on the Nepal–China border."),
    ],
    "history": [
        ("In which year did the Second World War end?", ["1945", "1918", "1939", "1950"], "The Second World War ended in 1945."),
        ("Who was the first person on the Moon?", ["Neil Armstrong", "Buzz Aldrin", "Yuri Gagarin", "Michael Collins"], "Neil Armstrong stepped onto the Moon in 1969."),
        ("The Great Fire of London happened in…", ["1666", "1066", "1766", "1566"], "The Great Fire of London was in 1666."),
        ("Who built the pyramids at Giza?", ["The ancient Egyptians", "The Romans", "The Greeks", "The Vikings"], "The ancient Egyptians built them as royal tombs."),
        ("Which empire built Hadrian's Wall?", ["Roman", "Ottoman", "Mongol", "British"], "The Romans built Hadrian's Wall in Britain."),
    ],
}


def ai_key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def call_claude(payload: dict) -> dict:
    body = json.dumps({
        "model": os.environ.get("QUIZNOVA_MODEL", "claude-sonnet-5"),
        "max_tokens": 4000,
        "system": AI_SYSTEM,
        "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": ai_key(),
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("The assistant did not return JSON")
    return json.loads(match.group(0))


def offline_brain(prompt: str, quiz: dict) -> dict:
    """A capable rule based fallback so the AI panel still works with no API key."""
    text = prompt.lower()
    count = 5
    # "add 4 questions", "4 more science questions", "write ten true/false questions"
    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
             "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "twenty": 20}
    found = re.search(r"(\d+)(?=[^.]*\bquestion)", text) or re.search(r"^\D*(\d+)", text)
    if found:
        count = max(1, min(20, int(found.group(1))))
    else:
        for word, value in words.items():
            if re.search(rf"\b{word}\b[^.]*\bquestion", text):
                count = value
                break

    topic = None
    for key in TOPIC_BANK:
        if key in text:
            topic = key
    if topic is None:
        for key, hint in (("math", "maths"), ("english", "grammar"), ("science", "biology"),
                          ("geography", "capital"), ("history", "war")):
            if hint in text:
                topic = key
    if topic is None:
        blob = (quiz.get("title", "") + " " + quiz.get("description", "")).lower()
        topic = next((k for k in TOPIC_BANK if k in blob), "science")

    if any(word in text for word in ("delete", "remove", "clear")):
        if "all" in text or "every" in text:
            ops = [{"op": "delete_question", "id": q["id"]} for q in quiz.get("questions", [])]
            return {"reply": f"Cleared all {len(ops)} questions.", "ops": ops}
        wanted = quiz.get("questions", [])[-count:]
        ops = [{"op": "delete_question", "id": q["id"]} for q in wanted]
        return {"reply": f"Removed the last {len(ops)} question(s).", "ops": ops}

    if "harder" in text or "difficult" in text:
        ops = [{"op": "update_question", "id": q["id"], "patch": {"time": max(8, int(q.get("time", 20)) - 5),
                                                                 "points": int(q.get("points", 100)) + 50}}
               for q in quiz.get("questions", [])]
        return {"reply": "Tightened the timers and raised the points to make it harder.", "ops": ops}

    if "easier" in text or "simpler" in text:
        ops = [{"op": "update_question", "id": q["id"], "patch": {"time": int(q.get("time", 20)) + 10}}
               for q in quiz.get("questions", [])]
        return {"reply": "Gave every question 10 extra seconds.", "ops": ops}

    if "title" in text or "rename" in text:
        new_title = prompt.split(":")[-1].strip().strip('"') or f"{topic.title()} quiz"
        return {"reply": f"Renamed the quiz to “{new_title}”.", "ops": [{"op": "update_quiz", "patch": {"title": new_title}}]}

    bank = TOPIC_BANK[topic][:]
    random.shuffle(bank)
    ops = []
    for i in range(count):
        stem, options, why = bank[i % len(bank)]
        shuffled = options[:]
        random.shuffle(shuffled)
        ops.append({
            "op": "add_question",
            "question": {
                "type": "mc",
                "text": stem,
                "choices": [{"text": opt, "correct": opt == options[0]} for opt in shuffled],
                "points": 100,
                "time": 20,
                "explanation": why,
            },
        })
    return {"reply": f"Added {count} {topic} question(s) for you.", "ops": ops}


@api.get("/ai/status")
def ai_status():
    return jsonify({"live": bool(ai_key()), "model": os.environ.get("QUIZNOVA_MODEL", "claude-sonnet-5")})


@api.post("/ai")
def ai_edit():
    body = request.get_json(silent=True) or {}
    prompt = (body.get("prompt") or "").strip()
    permission = body.get("permission", "ask")   # ask | auto | read
    qid = body.get("quizId")
    if not prompt:
        return jsonify({"error": "Say what you would like changed."}), 400

    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        context = {
            "instruction": prompt,
            "quiz": {
                "title": quiz["title"],
                "description": quiz.get("description", ""),
                "settings": quiz["settings"],
                "questions": [
                    {"id": q["id"], "type": q["type"], "text": q["text"],
                     "choices": [{"text": c["text"], "correct": c["correct"]} for c in q.get("choices", [])],
                     "answer": q.get("answer", ""), "points": q.get("points"), "time": q.get("time")}
                    for q in quiz["questions"]
                ],
            },
        }

    source = "claude"
    try:
        if ai_key():
            result = call_claude(context)
        else:
            source, result = "offline", offline_brain(prompt, context["quiz"])
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, json.JSONDecodeError, TimeoutError) as exc:
        source = "offline"
        result = offline_brain(prompt, context["quiz"])
        result["reply"] += f"  (Working offline: {type(exc).__name__})"

    ops = result.get("ops") or []
    reply = result.get("reply") or "Here is what I suggest."

    if permission == "read":
        return jsonify({"reply": reply, "ops": [], "applied": False, "source": source,
                        "note": "Read only mode — I did not change anything."})

    if permission == "auto" and ops:
        with _lock:
            quiz, err = quiz_or_404(qid)
            if err:
                return err
            log = apply_ops(quiz, ops)
            touch(quiz)
            _save()
            snapshot = json.loads(json.dumps(quiz))
        publish(f"quiz:{qid}", "quiz:updated", {"quiz": snapshot, "by": "ai", "log": log})
        return jsonify({"reply": reply, "ops": ops, "applied": True, "log": log,
                        "quiz": snapshot, "source": source})

    return jsonify({"reply": reply, "ops": ops, "applied": False, "source": source})


# ─────────────────────────────────────── live games ──

TEAM_HP_FLOOR = 400          # smallest a team's shield pool can be
TEAM_HP_PER_PLAYER = 250     # …and how much each player adds to it
MAX_PLAYER_HIT = 40          # damage cap on any one player, so nobody is out in one shot

AVATARS = ["🦊", "🐼", "🦄", "🐙", "🦁", "🐸", "🐧", "🦖", "🐝", "🦈", "🐨", "🦉", "🐢", "🦩", "🐳", "🦋"]

def public_game(game: dict, include_answers: bool = False) -> dict:
    quiz = _store["quizzes"].get(game["quizId"], {})
    questions = game.get("questions", [])
    idx = game["index"]
    current = None
    if 0 <= idx < len(questions) and game["state"] in ("question", "reveal"):
        q = questions[idx]
        current = {
            "id": q["id"],
            "type": q["type"],
            "text": q["text"],
            "image": q.get("image", ""),
            "points": q.get("points", 100),
            "time": q.get("time", 20),
            "choices": [{"id": c["id"], "text": c["text"],
                         **({"correct": c["correct"]} if (include_answers or game["state"] == "reveal") else {})}
                        for c in q.get("choices", [])],
        }
        if include_answers or game["state"] == "reveal":
            current["explanation"] = q.get("explanation", "")
            current["answer"] = q.get("answer", "")
    players = sorted(game["players"].values(), key=lambda p: -p["score"])
    return {
        "pin": game["pin"],
        "mode": game["mode"],
        "state": game["state"],
        "index": idx,
        "total": len(questions),
        "quizTitle": quiz.get("title", "Quiz"),
        "quizId": game["quizId"],
        "question": current,
        "endsAt": game.get("endsAt"),
        "serverNow": now_ms(),
        "players": [{k: p[k] for k in ("id", "name", "avatar", "team", "score", "hp", "streak",
                                       "answered", "correct", "down", "lastDamage")} for p in players],
        "teams": game["teams"],
        "counts": game.get("counts", {}),
        "lastEvents": game.get("lastEvents", []),
    }


def broadcast_game(game: dict) -> None:
    publish(f"game:{game['pin']}", "game:state", public_game(game))


GAME_TTL_MS = 12 * 60 * 60 * 1000     # live games are memory only — drop stale ones


def sweep_games() -> None:
    cutoff = now_ms() - GAME_TTL_MS
    for pin in [p for p, g in _games.items() if g["createdAt"] < cutoff]:
        _games.pop(pin, None)


@api.post("/games")
def create_game():
    body = request.get_json(silent=True) or {}
    with _lock:
        sweep_games()
        quiz, err = quiz_or_404(body.get("quizId"))
        if err:
            return err
        if not quiz["questions"]:
            return jsonify({"error": "Add at least one question first."}), 400
        questions = json.loads(json.dumps(quiz["questions"]))
        if quiz["settings"].get("shuffleQuestions"):
            random.shuffle(questions)
        game = {
            "pin": new_pin(),
            "hostToken": nid(16),
            "quizId": quiz["id"],
            "mode": body.get("mode", "normal"),      # normal | laser
            "state": "lobby",
            "index": -1,
            "questions": questions,
            "players": {},
            "teams": {"red": {"hp": 0, "score": 0, "name": "Crimson"},
                      "blue": {"hp": 0, "score": 0, "name": "Cobalt"}},
            "counts": {},
            "lastEvents": [],
            "createdAt": now_ms(),
        }
        _games[game["pin"]] = game
    return jsonify({"pin": game["pin"], "hostToken": game["hostToken"], "mode": game["mode"],
                    "quizTitle": quiz["title"], "total": len(questions)}), 201


def game_or_404(pin):
    game = _games.get(pin)
    if not game:
        return None, (jsonify({"error": "That game code is not live."}), 404)
    return game, None


@api.get("/games/<pin>")
def get_game(pin):
    game, err = game_or_404(pin)
    return err or jsonify(public_game(game))


@api.get("/games/<pin>/events")
def game_events(pin):
    game = _games.get(pin)
    return sse(f"game:{pin}", public_game(game) if game else {"error": "gone"})


@api.post("/games/<pin>/join")
def join_game(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if game["state"] not in ("lobby", "question", "reveal"):
            return jsonify({"error": "This game has finished."}), 400
        name = (body.get("name") or "Player").strip()[:16] or "Player"
        red = sum(1 for p in game["players"].values() if p["team"] == "red")
        blue = sum(1 for p in game["players"].values() if p["team"] == "blue")
        player = {
            "id": nid(10),
            "name": name,
            "avatar": body.get("avatar") or random.choice(AVATARS),
            "team": "red" if red <= blue else "blue",
            "score": 0,
            "hp": 100,
            "streak": 0,
            "best": 0,
            "answered": False,
            "correct": None,
            "down": False,
            "lastDamage": 0,
            "answers": {},
        }
        game["players"][player["id"]] = player
    broadcast_game(game)
    return jsonify({"player": player, "game": public_game(game)}), 201


@api.post("/games/<pin>/team")
def switch_team(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Unknown player"}), 404
        if game["state"] != "lobby":
            return jsonify({"error": "Teams lock once the match starts."}), 400
        player["team"] = "blue" if player["team"] == "red" else "red"
    broadcast_game(game)
    return jsonify({"team": player["team"]})


def host_check(game, body):
    return body.get("hostToken") == game["hostToken"]


def open_question(game: dict) -> None:
    game["index"] += 1
    game["counts"] = {}
    game["lastEvents"] = []
    if game["index"] >= len(game["questions"]):
        game["state"] = "over"
        game["endsAt"] = None
        return
    question = game["questions"][game["index"]]
    for player in game["players"].values():
        player["answered"] = False
        player["correct"] = None
        player["lastDamage"] = 0
    game["state"] = "question"
    game["endsAt"] = now_ms() + int(question.get("time", 20)) * 1000 + 700


@api.post("/games/<pin>/start")
def start_game(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "Only the host can start the game."}), 403
        if game["mode"] == "laser":
            for team in ("red", "blue"):
                members = [p for p in game["players"].values() if p["team"] == team]
                # Enough HP that a match lasts several questions even with a small class.
                game["teams"][team]["hp"] = max(TEAM_HP_FLOOR, TEAM_HP_PER_PLAYER * len(members))
        open_question(game)
    broadcast_game(game)
    return jsonify(public_game(game))


@api.post("/games/<pin>/next")
def next_question(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "Only the host can advance the game."}), 403
        if game["state"] == "question":
            game["state"] = "reveal"
            game["endsAt"] = None
        else:
            open_question(game)
    broadcast_game(game)
    return jsonify(public_game(game))


@api.post("/games/<pin>/answer")
def answer_question(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Join the game first."}), 404
        if game["state"] != "question":
            return jsonify({"error": "No question is open."}), 400
        if player["answered"]:
            return jsonify({"error": "Already answered."}), 400

        question = game["questions"][game["index"]]
        given = body.get("answer")
        ok = grade(question, given)
        limit = int(question.get("time", 20)) * 1000
        left = max(0, (game.get("endsAt") or now_ms()) - now_ms())
        speed = max(0.0, min(1.0, left / limit)) if limit else 0.0

        player["answered"] = True
        player["correct"] = ok
        player["answers"][question["id"]] = given
        key = given if isinstance(given, str) else json.dumps(given)
        game["counts"][key] = game["counts"].get(key, 0) + 1

        if ok:
            player["streak"] += 1
            player["best"] = max(player["best"], player["streak"])
        else:
            player["streak"] = 0

        if game["mode"] == "normal":
            if ok:
                base = int(question.get("points", 100))
                multiplier = 1 + min(player["streak"], 5) * 0.1
                player["score"] += int(round((base * 0.5 + base * 0.5 * speed) * multiplier))
        else:
            foe = "blue" if player["team"] == "red" else "red"
            if ok and not player["down"]:
                damage = int(round(45 + 55 * speed))
                if player["streak"] >= 3:
                    damage = int(damage * 1.8)          # overcharge
                targets = [p for p in game["players"].values() if p["team"] == foe and not p["down"]]
                hit_name = game["teams"][foe]["name"]
                if targets:
                    target = max(targets, key=lambda p: p["hp"])
                    # Team shields soak the full shot; a single hit never one-shots a player.
                    player_damage = min(damage, MAX_PLAYER_HIT)
                    target["hp"] = max(0, target["hp"] - player_damage)
                    target["lastDamage"] = player_damage
                    hit_name = target["name"]
                    if target["hp"] == 0:
                        target["down"] = True
                        game["lastEvents"].append(f"💥 {player['name']} knocked out {target['name']}!")
                game["teams"][foe]["hp"] = max(0, game["teams"][foe]["hp"] - damage)
                game["teams"][player["team"]]["score"] += damage
                player["score"] += damage
                game["lastEvents"].append(
                    f"🔺 {player['name']} hit {hit_name} for {damage}" + (" ⚡OVERCHARGE" if player["streak"] >= 3 else "")
                )
            elif ok and player["down"]:
                mates = [p for p in game["players"].values() if p["team"] == player["team"] and p["hp"] < 100]
                heal = 25
                if mates:
                    mate = min(mates, key=lambda p: p["hp"])
                    mate["hp"] = min(100, mate["hp"] + heal)
                    if mate["down"] and mate["hp"] > 0:
                        mate["down"] = False
                    game["lastEvents"].append(f"✚ {player['name']} revived {mate['name']} (+{heal} HP)")
                player["score"] += heal
            else:
                player["hp"] = max(0, player["hp"] - 10)
                if player["hp"] == 0:
                    player["down"] = True
                game["lastEvents"].append(f"⚠️ {player['name']} missed and lost shield")

        game["lastEvents"] = game["lastEvents"][-6:]
        everyone_in = all(p["answered"] for p in game["players"].values()) and game["players"]
        if everyone_in:
            game["state"] = "reveal"
            game["endsAt"] = None
        snapshot = public_game(game)
    publish(f"game:{pin}", "game:state", snapshot)
    return jsonify({"correct": ok, "score": player["score"], "hp": player["hp"],
                    "streak": player["streak"], "state": game["state"]})


@api.post("/games/<pin>/end")
def end_game(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "Only the host can end the game."}), 403
        game["state"] = "over"
        game["endsAt"] = None
    broadcast_game(game)
    return jsonify(public_game(game))


@api.post("/games/<pin>/tick")
def tick_game(pin):
    """Called by the host when a timer runs out — closes the question server side."""
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "forbidden"}), 403
        if game["state"] == "question" and game.get("endsAt") and now_ms() >= game["endsAt"]:
            game["state"] = "reveal"
            game["endsAt"] = None
            for player in game["players"].values():
                if not player["answered"]:
                    player["streak"] = 0
    broadcast_game(game)
    return jsonify(public_game(game))
