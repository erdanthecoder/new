# One worker on purpose: live games and realtime streams live in this process's
# memory, so a second worker would answer with a different game. Threads (not
# workers) carry the load — each open realtime connection holds one.
web: gunicorn --workers 1 --threads 128 --worker-class gthread --timeout 120 --keep-alive 70 --bind 0.0.0.0:$PORT server:app
