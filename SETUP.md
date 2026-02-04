# Attendance System Setup (HTML + Express + Python + Supabase)

## Prerequisites (all free)
- Node.js 20+
- Python 3.10+ with pip
- Webcam attached (laptop cam works)
- Supabase project with `attendance` table:
  - columns: `id (int, pk)`, `name text`, `roll_no text`, `recorded_at timestamptz`, `source text`
  - grant insert/select to service role

## Configure env
Create `attendance-server/.env` (see `attendance-server/ENV.example`):
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE=...
PORT=3001
# optional:
# PYTHON_CMD=python
# PYTHON_SCRIPT=../program.py
```

## Install deps
```
# Node API
cd attendance-server
npm install

# Python (from repo root)
pip install -r requirements.txt
```

## Run the stack locally
```
# Terminal 1: start API + static site
cd attendance-server
npm run dev
# serves http://localhost:3001 and static UI at / (web/index.html)

# Terminal 2: run webcam face-recognition
python program.py
```

## Use the app
- Open http://localhost:3001 in a browser.
- Teacher: click “Start Attendance” (calls /start, which spawns python if configured) or run `python program.py` manually.
- Student: enter name and fetch records (hits GET /attendance).

## Notes
- `program.py` defaults to POST `http://localhost:3001/attendance`. Override with `SERVER_URL` env to point elsewhere.
- `/start` endpoint spawns the python script; ensure PATH includes Python or set `PYTHON_CMD`.
- Keep images for known faces in `photos/` (`jobs.jpg`, `tata.jpg`, etc.). Add more by extending the script.

