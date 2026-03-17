const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://cctv-based-attendance.onrender.com';

// State
let currentUser = null;
let currentRole = null; // 'teacher' or 'student'
let sessionActive = false;
let sessionSubject = '';
let myAttendanceMarked = false;

// DOM Elements
const screens = {
  login: document.getElementById('login-screen'),
  teacher: document.getElementById('teacher-screen'),
  student: document.getElementById('student-screen')
};

// --- Initialization & UI Helpers ---
function showScreen(screenName) {
  Object.values(screens).forEach(s => {
    s.classList.remove('active');
    s.classList.add('hide');
  });
  screens[screenName].classList.remove('hide');
  // slight delay to allow display block to apply before animation
  setTimeout(() => screens[screenName].classList.add('active'), 50);
}

function setStatus(elementId, msg, isError = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg ${isError ? 'error' : 'success'}`;
  setTimeout(() => { el.className = 'status-msg'; }, 5000); // clear after 5s
}

// Tab Switching
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    // only handle clicks within the same screen
    const nav = e.currentTarget;
    const parentHeader = nav.closest('.app-header');
    
    parentHeader.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    nav.classList.add('active');
    
    const targetId = nav.getAttribute('data-target');
    const screenPane = nav.closest('.screen');
    
    screenPane.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.add('hide');
      pane.classList.remove('active');
    });
    
    const targetPane = document.getElementById(targetId);
    if(targetPane) {
      targetPane.classList.remove('hide');
      targetPane.classList.add('active');
    }
    
    // Refresh data on specific tabs
    if(targetId === 'teacher-records') loadTeacherRecords();
    if(targetId === 'teacher-students') loadTeacherStudents();
    if(targetId === 'student-history') loadStudentHistory();
  });
});

lucide.createIcons();

// --- Theme Toggling ---
const toggleTheme = () => {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.innerHTML = isLight ? '<i data-lucide="moon"></i>' : '<i data-lucide="sun"></i>';
  });
  lucide.createIcons();
};

document.querySelectorAll('.theme-toggle').forEach(btn => {
  btn.addEventListener('click', toggleTheme);
});

// Initialize theme from storage
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light-theme');
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.innerHTML = '<i data-lucide="moon"></i>';
  });
  lucide.createIcons();
}

// --- Login Logic ---
let loginRole = 'student';
document.querySelectorAll('.role-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    loginRole = e.currentTarget.getAttribute('data-role');
    
    const label = document.getElementById('username-label');
    label.textContent = loginRole === 'teacher' ? 'Username' : 'Enrollment Number';
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  
  if (!username || !password) return;
  const btn = e.target.querySelector('button');
  btn.textContent = 'Signing in...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: loginRole, username, password })
    });
    const data = await res.json();
    
    if (res.ok && data.success) {
      currentRole = data.role;
      currentUser = data.user || { name: 'Admin' };
      
      if (currentRole === 'teacher') {
        showScreen('teacher');
        initTeacher();
      } else {
        showScreen('student');
        initStudent();
      }
    } else {
      setStatus('login-status', data.error || 'Login failed', true);
    }
  } catch (err) {
    setStatus('login-status', 'Network error. Backend might be asleep.', true);
  } finally {
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
});

// Logout
document.getElementById('teacher-logout').addEventListener('click', logout);
document.getElementById('student-logout').addEventListener('click', logout);

function logout() {
  currentUser = null;
  currentRole = null;
  document.getElementById('login-form').reset();
  showScreen('login');
  if(sessionPoller) clearInterval(sessionPoller);
}


// ==========================================
// TEACHER MODULE
// ==========================================
let allStudentsData = [];
let allAttendanceData = [];

async function initTeacher() {
  updateTeacherSessionUI();
  fetchSessionStatus();
  loadSubjects();
}

async function loadSubjects() {
  try {
    const res = await fetch(`${API_BASE_URL}/subjects`);
    if(!res.ok) return;
    const { data } = await res.json();
    const select = document.getElementById('session-subject');
    select.innerHTML = '<option value="">Select a Subject...</option>';
    if (data) {
      data.forEach(sub => {
        select.innerHTML += `<option value="${sub}">${sub}</option>`;
      });
    }
  } catch(e) { console.error('Failed to load subjects', e); }
}

document.getElementById('add-subject-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-subject-name').value.trim();
  if(!name) return;
  
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  
  try {
    const res = await fetch(`${API_BASE_URL}/subjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const json = await res.json();
    if(res.ok && json.success) {
      setStatus('subject-status', 'Subject added!');
      e.target.reset();
      loadSubjects();
    } else {
      setStatus('subject-status', json.error || 'Failed to add subject', true);
    }
  } catch(err) {
    setStatus('subject-status', 'Network error', true);
  } finally {
    btn.disabled = false;
  }
});

async function fetchSessionStatus() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/session`);
    const data = await res.json();
    sessionActive = data.active;
    sessionSubject = data.subject;
    updateTeacherSessionUI();
  } catch(e) {}
}

function updateTeacherSessionUI() {
  const statStatus = document.getElementById('stat-sys-status');
  const startBtn = document.getElementById('start-sys-btn');
  const stopBtn = document.getElementById('stop-sys-btn');
  const subjectInput = document.getElementById('session-subject');
  
  if (sessionActive) {
    statStatus.textContent = `Online (${sessionSubject})`;
    statStatus.className = 'stat-val online';
    startBtn.classList.add('hide');
    stopBtn.classList.remove('hide');
    subjectInput.disabled = true;
  } else {
    statStatus.textContent = 'Offline';
    statStatus.className = 'stat-val offline';
    startBtn.classList.remove('hide');
    stopBtn.classList.add('hide');
    subjectInput.disabled = false;
  }
}

// Start Session (CCTV & Session flag)
document.getElementById('start-sys-btn').addEventListener('click', async () => {
  const subject = document.getElementById('session-subject').value;
  if (!subject) {
    setStatus('stat-sys-status', 'Please select a subject first!', true);
    return;
  }
  const ipWebcam = document.getElementById('ip-webcam-url').value.trim();
  
  try {
    // 1. Mark session as active
    await fetch(`${API_BASE_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject })
    });
    
    // 2. Start Python CCTV script
    await fetch(`${API_BASE_URL}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, ip_webcam_url: ipWebcam })
    });
    
    sessionActive = true;
    sessionSubject = subject;
    updateTeacherSessionUI();
    
    // Track marked count today
    updateMarkedCount();
  } catch(e) { console.error(e); }
});

// Stop Session
document.getElementById('stop-sys-btn').addEventListener('click', async () => {
  try {
    await fetch(`${API_BASE_URL}/api/session/stop`, { method: 'POST' });
    await fetch(`${API_BASE_URL}/stop`, { method: 'POST' });
    sessionActive = false;
    sessionSubject = '';
    updateTeacherSessionUI();
  } catch(e) { console.error(e); }
});

async function updateMarkedCount() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`${API_BASE_URL}/attendance?date=${today}`);
    const { data } = await res.json();
    document.getElementById('stat-marked').textContent = data ? data.length : 0;
  } catch(e){}
}

// Teacher Records Tab
document.getElementById('lookup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadTeacherRecords();
});

async function loadTeacherRecords() {
  const name = document.getElementById('lookup-name').value.trim();
  const date = document.getElementById('lookup-date').value;
  
  try {
    let url = `${API_BASE_URL}/attendance?`;
    if (name) url += `name=${encodeURIComponent(name)}&`;
    if (date) url += `date=${encodeURIComponent(date)}&`;
    
    const res = await fetch(url);
    const { data } = await res.json();
    allAttendanceData = data || [];
    
    const tbody = document.querySelector('#records-table tbody');
    tbody.innerHTML = '';
    
    if (allAttendanceData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="center-text">No records found</td></tr>';
      return;
    }
    
    allAttendanceData.forEach(row => {
      const dateObj = new Date(row.recorded_at);
      const fd = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const ft = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute:'2-digit' });
      
      tbody.innerHTML += `
        <tr>
          <td><div style="font-weight:500">${fd}</div><div style="font-size:0.75rem;color:var(--text-muted)">${ft}</div></td>
          <td>${row.subject || 'N/A'}</td>
          <td style="font-weight:600">${row.name}</td>
          <td style="color:var(--text-muted)">${row.roll_no || '-'}</td>
        </tr>
      `;
    });
  } catch(e) {}
}

document.getElementById('export-records-btn').addEventListener('click', () => {
  downloadCSV(allAttendanceData, 'attendance_records.csv', ['name', 'roll_no', 'subject', 'recorded_at', 'source']);
});

// Teacher Students Tab
document.getElementById('student-photo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('photo-preview').innerHTML = `<img src="${e.target.result}">`;
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById('add-student-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Registering...';
  
  try {
    const formData = new FormData(e.target);
    const res = await fetch(`${API_BASE_URL}/students`, { method: 'POST', body: formData });
    const json = await res.json();
    
    if (res.ok && json.success) {
      // Show password directly in UI
      setStatus('add-student-result', `Success! Temporary Password: ${json.password}`);
      e.target.reset();
      document.getElementById('photo-preview').innerHTML = '<i data-lucide="image"></i>';
      lucide.createIcons();
      loadTeacherStudents();
    } else {
      setStatus('add-student-result', json.error || 'Registration failed', true);
    }
  } catch(e) {
    setStatus('add-student-result', 'Network error', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Register';
  }
});

async function loadTeacherStudents() {
  try {
    const res = await fetch(`${API_BASE_URL}/students`);
    const { data } = await res.json();
    allStudentsData = data || [];
    
    const tbody = document.querySelector('#students-table tbody');
    tbody.innerHTML = '';
    
    allStudentsData.forEach(student => {
      tbody.innerHTML += `
        <tr>
          <td><img src="${student.photo_url || 'https://via.placeholder.com/40'}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--border)"></td>
          <td style="font-weight:500">${student.name}</td>
          <td style="color:var(--text-muted)">${student.roll_no || '-'}</td>
          <td style="font-family: monospace; color: var(--primary); font-weight: 500;">${student.password || '-'}</td>
        </tr>
      `;
    });
  } catch(e) {}
}

document.getElementById('export-students-btn').addEventListener('click', () => {
  downloadCSV(allStudentsData, 'registered_students.csv', ['name', 'roll_no', 'password', 'photo_url']);
});


// ==========================================
// STUDENT MODULE
// ==========================================
let sessionPoller = null;
let modelsLoaded = false;
let studentFaceMatcher = null;
const studentVideo = document.getElementById('student-video');
const studentCameraWrapper = document.getElementById('student-camera');
const studentMarkBtn = document.getElementById('student-mark-btn');

async function initStudent() {
  // Setup Profile
  document.getElementById('my-name').textContent = currentUser.name;
  document.getElementById('my-roll-no').textContent = currentUser.roll_no;
  document.getElementById('my-profile-pic').src = currentUser.photo_url || 'https://via.placeholder.com/100';
  
  myAttendanceMarked = false;
  
  // Start polling session status
  pollSession();
  sessionPoller = setInterval(pollSession, 5000);
  
  loadStudentHistory();
}

async function pollSession() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/session`);
    const data = await res.json();
    
    const banner = document.getElementById('class-status-banner');
    
    if (data.active) {
      banner.className = 'status-banner online';
      banner.innerHTML = `<i data-lucide="check-circle"></i> Class in session: ${data.subject}`;
      
      if (!myAttendanceMarked) {
        studentMarkBtn.classList.remove('hide');
        studentMarkBtn.disabled = false;
      } else {
        studentMarkBtn.classList.add('hide');
      }
    } else {
      banner.className = 'status-banner offline';
      banner.innerHTML = `<i data-lucide="info"></i> No active class session`;
      studentMarkBtn.classList.add('hide');
      
      // Stop camera if running
      if(studentVideo.srcObject) {
        studentVideo.srcObject.getTracks().forEach(t => t.stop());
        studentCameraWrapper.classList.add('hide');
      }
    }
    lucide.createIcons();
  } catch(e){}
}

async function loadStudentHistory() {
  try {
    const res = await fetch(`${API_BASE_URL}/attendance?roll_no=${currentUser.roll_no}`);
    const { data } = await res.json();
    const records = data || [];
    
    document.getElementById('my-total-att').textContent = records.length;
    
    const tbody = document.querySelector('#my-attendance-table tbody');
    tbody.innerHTML = '';
    
    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="center-text">No records found</td></tr>';
      return;
    }
    
    records.forEach(row => {
      const dateObj = new Date(row.recorded_at);
      const fd = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year:'numeric' });
      const ft = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute:'2-digit' });
      
      tbody.innerHTML += `
        <tr>
          <td><div style="font-weight:500">${fd}</div><div style="font-size:0.75rem;color:var(--text-muted)">${ft}</div></td>
          <td>${row.subject || 'General'}</td>
          <td><span class="badge" style="background:rgba(255,255,255,0.1);padding:4px 8px;border-radius:4px;font-size:0.75rem">${row.source}</span></td>
        </tr>
      `;
    });
  } catch(e) {}
}

// Student Self-Attendance via browser camera
studentMarkBtn.addEventListener('click', async () => {
  studentMarkBtn.disabled = true;
  studentMarkBtn.textContent = 'Initializing Camera...';
  
  try {
    if (!modelsLoaded) {
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      modelsLoaded = true;
      
      // Pre-calculate user's face descriptor
      setStatus('student-mark-status', 'Loading your profile photo data...');
      if(currentUser.photo_url) {
        const img = await faceapi.fetchImage(currentUser.photo_url);
        const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
        if (detection) {
          studentFaceMatcher = new faceapi.FaceMatcher([
            new faceapi.LabeledFaceDescriptors(currentUser.name, [detection.descriptor])
          ], 0.55); // strict threshold for self matching
        }
      }
    }
    
    if (!studentFaceMatcher) throw new Error('Could not analyze your profile photo. Please contact Admin.');

    studentCameraWrapper.classList.remove('hide');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    studentVideo.srcObject = stream;
    
    studentMarkBtn.textContent = 'Scanning Face...';
    setStatus('student-mark-status', 'Looking for your face...');
    
    // Start scanning loop
    const scanInterval = setInterval(async () => {
      if(!studentVideo.srcObject) {
         clearInterval(scanInterval);
         return;
      }
      const detection = await faceapi.detectSingleFace(studentVideo).withFaceLandmarks().withFaceDescriptor();
      if (detection) {
        const result = studentFaceMatcher.findBestMatch(detection.descriptor);
        if (result.label === currentUser.name) {
          // Success!
          clearInterval(scanInterval);
          stream.getTracks().forEach(t => t.stop());
          studentCameraWrapper.classList.add('hide');
          
          await submitStudentAttendance();
        } else {
          setStatus('student-mark-status', 'Face detected, but does not match your profile!', true);
        }
      }
    }, 500);
    
  } catch(err) {
    setStatus('student-mark-status', err.message || 'Camera error.', true);
    studentMarkBtn.innerHTML = '<i data-lucide="camera"></i> Mark My Attendance';
    studentMarkBtn.disabled = false;
    lucide.createIcons();
  }
});

async function submitStudentAttendance() {
  setStatus('student-mark-status', 'Marking attendance globally...');
  try {
    const res = await fetch(`${API_BASE_URL}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: currentUser.name,
        roll_no: currentUser.roll_no,
        source: 'Student App',
        recorded_at: new Date().toISOString()
      })
    });
    
    const data = await res.json();
    if(res.ok && data.success) {
      setStatus('student-mark-status', 'Attendance successfully marked!');
      myAttendanceMarked = true;
      studentMarkBtn.classList.add('hide');
      loadStudentHistory(); // Refresh table
    } else {
      setStatus('student-mark-status', data.message || 'Failed to mark', true);
    }
  } catch(e) {
    setStatus('student-mark-status', 'Network error', true);
  }
}

// Helpers
function downloadCSV(data, filename, headers) {
  if (!data || data.length === 0) return alert('No data to export');
  const csvContent = [
    headers.join(','),
    ...data.map(row => headers.map(header => `"${String(row[header] || '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.setAttribute('href', URL.createObjectURL(blob));
  link.setAttribute('download', filename);
  link.click();
}
