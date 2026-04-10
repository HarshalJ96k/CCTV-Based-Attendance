import express from 'express';
import fs from 'fs';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const STUDENT_BUCKET = process.env.STUDENT_BUCKET || 'students';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.warn('[WARN] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env vars.');
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
  : null;

app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

let pythonChild = null;

let currentSession = { active: false, subject: '' };
let cameraStatus = "Disconnected";
let lastCameraError = "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const staticDir = path.resolve(path.join(__dirname, '../web'));
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  console.log(`[server] serving static frontend from ${staticDir}`);
}

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Login Endpoint
app.post('/login', async (req, res) => {
  const { role, username, password } = req.body;

  if (role === 'teacher') {
    if (username === 'admin' && password === 'admin') {
      res.json({ success: true, role: 'teacher' });
    } else {
      res.status(401).json({ error: 'Invalid teacher credentials' });
    }
  } else if (role === 'student') {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('roll_no', username)
        .eq('password', password)
        .single();
      
      if (error || !data) {
        return res.status(401).json({ error: 'Invalid student credentials' });
      }
      res.json({ success: true, role: 'student', user: data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(400).json({ error: 'Invalid role' });
  }
});

// Session Management
app.get('/api/session', (req, res) => {
  res.json({ ...currentSession, cameraStatus, lastError: lastCameraError });
});

app.post('/api/session/start', (req, res) => {
  const { subject } = req.body || {};
  currentSession = { active: true, subject: subject || 'General' };
  res.json({ success: true, session: currentSession });
});

app.post('/api/session/stop', (req, res) => {
  currentSession = { active: false, subject: '' };
  res.json({ success: true, session: currentSession });
});

// Attendance fetching
app.get('/attendance', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { name, date, roll_no, subject } = req.query;

    let query = supabase.from('attendance').select('*').order('recorded_at', { ascending: false });

    if (name) query = query.ilike('name', `%${name}%`);
    if (roll_no) query = query.eq('roll_no', roll_no);
    if (subject) query = query.ilike('subject', `%${subject}%`);
    if (date) {
      const startDate = `${date}T00:00:00.000Z`;
      const endDate = `${date}T23:59:59.999Z`;
      query = query.gte('recorded_at', startDate).lte('recorded_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Students fetching
app.get('/students', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { data, error } = await supabase
      .from('students')
      .select('id,name,roll_no,photo_url,password')
      .order('name', { ascending: true });
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subjects endpoints
app.get('/subjects', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { data, error } = await supabase
      .from('subjects')
      .select('name')
      .order('name', { ascending: true });
    if (error) throw error;
    res.json({ data: data.map(s => s.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/subjects', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'subject name is required' });

    const { data, error } = await supabase
      .from('subjects')
      .insert([{ name }])
      .select();
      
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Subject already exists' });
      throw error;
    }
    
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function ensureBucketExists() {
  if (!supabase) return;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === STUDENT_BUCKET);
    if (exists) return;
    await supabase.storage.createBucket(STUDENT_BUCKET, { public: true });
  } catch (err) {}
}

app.post('/students', upload.single('photo'), async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { name, roll_no = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });

    await ensureBucketExists();

    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const objectPath = `${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(STUDENT_BUCKET)
      .upload(objectPath, req.file.buffer, {
        contentType: req.file.mimetype || 'image/jpeg',
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(STUDENT_BUCKET).getPublicUrl(objectPath);
    const photo_url = publicUrlData?.publicUrl;

    const password = Math.random().toString(36).slice(-8);

    const { data, error } = await supabase
      .from('students')
      .insert([{ name, roll_no, photo_url, password }])
      .select();
      
    if (error) throw error;
    res.json({ success: true, data, password });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, details: err });
  }
});

app.post('/attendance', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { name, roll_no = '', recorded_at, source = 'web', subject } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const now = recorded_at ? new Date(recorded_at) : new Date();
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);
    const endOfDay = new Date(now).setHours(23, 59, 59, 999);

    const currentSub = subject || currentSession.subject || 'General';

    const { data: existing, error: checkError } = await supabase
      .from('attendance')
      .select('id')
      .eq('name', name)
      .eq('subject', currentSub)
      .gte('recorded_at', new Date(startOfDay).toISOString())
      .lte('recorded_at', new Date(endOfDay).toISOString())
      .limit(1);

    if (checkError) throw checkError;
    if (existing && existing.length > 0) {
      return res.json({ success: true, message: 'Attendance already recorded for today', alreadyExists: true });
    }

    const payload = {
      name,
      roll_no,
      recorded_at: now.toISOString(),
      source,
      subject: subject || currentSession.subject || 'General'
    };

    try {
      const { data: studentRows, error: studentErr } = await supabase
        .from('students')
        .select('id')
        .eq('roll_no', roll_no)
        .limit(1);
      if (!studentErr && studentRows && studentRows.length > 0) {
        payload.student_id = studentRows[0].id;
      }
    } catch (innerErr) {}

    const { data, error } = await supabase.from('attendance').insert([payload]).select();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/start', (req, res) => {
  const pythonCmd = process.env.PYTHON_CMD || 'python';
  const scriptPath = process.env.PYTHON_SCRIPT || path.resolve(path.join(__dirname, '../program.py'));

  try {
    if (pythonChild) {
      return res.json({ success: true, message: 'Python attendance script already running' });
    }

    const { ip_webcam_url, subject, enable_geofence } = req.body || {};
    const env = { ...process.env };
    if (ip_webcam_url && ip_webcam_url.trim()) {
      env.IP_WEBCAM_URL = ip_webcam_url.trim();
    }
    if (subject) {
      env.CURRENT_SUBJECT = subject;
    }
    env.ENABLE_GEOFENCE = enable_geofence ? "true" : "false";

    const child = spawn(pythonCmd, [scriptPath], {
      cwd: path.dirname(scriptPath),
      stdio: 'inherit',
      windowsHide: true,
      env: env,
    });

    pythonChild = child;
    cameraStatus = "Connecting...";
    lastCameraError = "";

    // Capture stdout to detect connection success
    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[python] ${output}`);
      if (output.includes('[SUCCESS]')) cameraStatus = "Connected";
      if (output.includes('[ERROR]')) {
        cameraStatus = "Failed";
        lastCameraError = output.split('[ERROR]')[1].trim();
      }
    });

    // Capture stderr for critical errors
    child.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[python-err] ${output}`);
      if (output.toLowerCase().includes('error')) {
        cameraStatus = "Error";
        lastCameraError = output;
      }
    });

    child.on('close', (code) => {
      pythonChild = null;
      cameraStatus = "Disconnected";
    });

    const source = ip_webcam_url ? 'IP Webcam' : 'webcam';
    res.json({ success: true, message: `Python attendance script started with ${source}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/stop', (req, res) => {
  try {
    if (!pythonChild) {
      return res.json({ success: true, message: 'Python attendance script is not running' });
    }
    pythonChild.kill('SIGTERM');
    pythonChild = null;
    res.json({ success: true, message: 'Python attendance script stopped' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

