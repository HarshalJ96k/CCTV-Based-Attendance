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

// Serve static frontend (plain HTML/JS) from ../web
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const staticDir = path.resolve(path.join(__dirname, '../web'));
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  console.log(`[server] serving static frontend from ${staticDir}`);
} else {
  console.log('[server] skipping static serving (frontend hosted elsewhere)');
}

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/attendance', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { name, date } = req.query;

    let query = supabase.from('attendance').select('*').order('recorded_at', { ascending: false });

    if (name) {
      query = query.ilike('name', `%${name}%`);
    }

    if (date) {
      // Use gte/lt to filter by a specific day (YYYY-MM-DD)
      const startDate = `${date}T00:00:00.000Z`;
      const endDate = `${date}T23:59:59.999Z`;
      query = query.gte('recorded_at', startDate).lte('recorded_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data });
  } catch (err) {
    console.error('GET /attendance error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/students', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { data, error } = await supabase
      .from('students')
      .select('id,name,roll_no,photo_url')
      .order('name', { ascending: true });
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    console.error('GET /students error:', err);
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
    console.log(`[storage] created bucket ${STUDENT_BUCKET}`);
  } catch (err) {
    console.warn('[storage] bucket check/create failed:', err.message);
  }
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

    const { data, error } = await supabase
      .from('students')
      .insert([{ name, roll_no, photo_url }])
      .select();
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('POST /students full error:', JSON.stringify(err, null, 2));
    console.error('POST /students error stack:', err.stack);
    res.status(500).json({ success: false, error: err.message, details: err });
  }
});

app.post('/attendance', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { name, roll_no = '', recorded_at, source = 'web' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const now = recorded_at ? new Date(recorded_at) : new Date();
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);
    const endOfDay = new Date(now).setHours(23, 59, 59, 999);

    // Check if student already marked today
    const { data: existing, error: checkError } = await supabase
      .from('attendance')
      .select('id')
      .eq('name', name)
      .gte('recorded_at', new Date(startOfDay).toISOString())
      .lte('recorded_at', new Date(endOfDay).toISOString())
      .limit(1);

    if (checkError) throw checkError;

    if (existing && existing.length > 0) {
      return res.json({
        success: true,
        message: 'Attendance already recorded for today',
        alreadyExists: true
      });
    }

    const payload = {
      name,
      roll_no,
      recorded_at: now.toISOString(),
      source,
    };

    // try to link to students table by name (first match)
    try {
      const { data: studentRows, error: studentErr } = await supabase
        .from('students')
        .select('id')
        .eq('name', name)
        .limit(1);
      if (!studentErr && studentRows && studentRows.length > 0) {
        payload.student_id = studentRows[0].id;
      }
    } catch (innerErr) {
      console.warn('[attendance] student lookup failed:', innerErr.message);
    }

    const { data, error } = await supabase.from('attendance').insert([payload]).select();
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('POST /attendance error:', err);
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

    // Get IP Webcam URL from request body
    const { ip_webcam_url } = req.body || {};
    const env = { ...process.env };
    if (ip_webcam_url && ip_webcam_url.trim()) {
      env.IP_WEBCAM_URL = ip_webcam_url.trim();
      console.log(`[INFO] Starting with IP Webcam URL: ${ip_webcam_url}`);
    }

    const child = spawn(pythonCmd, [scriptPath], {
      cwd: path.dirname(scriptPath),
      stdio: 'inherit',
      windowsHide: true,
      env: env,
    });

    pythonChild = child;

    child.on('close', (code) => {
      console.log(`Python script exited with code ${code}`);
      pythonChild = null;
    });
    child.on('error', (err) => {
      console.error('Failed to start Python script:', err);
    });

    const source = ip_webcam_url ? 'IP Webcam' : 'webcam';
    res.json({ success: true, message: `Python attendance script started with ${source}` });
  } catch (err) {
    console.error('POST /start error:', err);
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
    console.error('POST /stop error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] static frontend at ${staticDir}`);
});

