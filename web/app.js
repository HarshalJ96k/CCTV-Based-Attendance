// API Configuration
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://cctv-based-attendance.onrender.com'; // Change this after deploying to Render

// DOM Elements
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const startStatus = document.getElementById('start-status');
const lookupForm = document.getElementById('lookup-form');
const lookupStatus = document.getElementById('lookup-status');
const attendanceTable = document.getElementById('attendance-table');
const attendanceTbody = attendanceTable.querySelector('tbody');
const addStudentForm = document.getElementById('add-student-form');
const addStudentStatus = document.getElementById('add-student-status');
const studentsList = document.getElementById('students-list');

// Export & Search
const exportAttendanceBtn = document.getElementById('export-attendance-btn');
const exportStudentsBtn = document.getElementById('export-students-btn');
const clearAttendanceBtn = document.getElementById('clear-attendance-btn');
const searchStudentsInput = document.getElementById('search-students');
const studentPhotoInput = document.getElementById('student-photo');
const photoPreviewContainer = document.getElementById('photo-preview-container');

// Stats Elements
const statTotalStudents = document.getElementById('stat-total-students');
const statTodayAttendance = document.getElementById('stat-today-attendance');
const statSystemStatus = document.getElementById('stat-system-status');

// In-memory data
let currentAttendanceData = [];
let allStudentsData = [];
let isSystemRunning = false;

// Tab Switching
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const tabId = item.getAttribute('data-tab');
    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');
    tabContents.forEach(content => {
      content.classList.remove('active');
      if (content.id === tabId) content.classList.add('active');
    });
    if (tabId === 'students') fetchStudents();
    if (tabId === 'dashboard') updateStats();
    if (tabId === 'records') fetchAttendance();
  });
});

// Helper Functions
const setStatus = (el, msg, isError = false) => {
  if (!el) return;
  el.textContent = msg;
  el.style.backgroundColor = isError ? '#fef2f2' : '#f0f9ff';
  el.style.color = isError ? '#b91c1c' : '#0369a1';
  el.style.border = `1px solid ${isError ? '#fecaca' : '#bae6fd'}`;
  el.style.display = msg ? 'flex' : 'none';
};

const downloadCSV = (data, filename, headers) => {
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
};

// Photo Preview
studentPhotoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      photoPreviewContainer.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
    };
    reader.readAsDataURL(file);
  }
});

// Search Students
searchStudentsInput.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  const filtered = allStudentsData.filter(s =>
    s.name.toLowerCase().includes(term) || (s.roll_no && s.roll_no.toLowerCase().includes(term))
  );
  renderStudentsList(filtered);
});

// Action Handlers
// Face recognition variables
let faceMatcher = null;
let labeledDescriptors = [];
let modelsLoaded = false;
let cameraStream = null;
let recognitionInterval = null;

// DOM Elements for camera
const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const cameraContainer = document.getElementById('camera-container');
const cameraLoading = document.getElementById('camera-loading');

// Load Face API Models
async function loadModels() {
  if (modelsLoaded) return;
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
  try {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    modelsLoaded = true;
    console.log('Face-api models loaded');
  } catch (err) {
    console.error('Error loading face-api models:', err);
    throw err;
  }
}

// Generate descriptors for all registered students
async function prepareFaceMatcher() {
  setStatus(startStatus, 'Loading student face data...');
  labeledDescriptors = [];

  for (const student of allStudentsData) {
    if (!student.photo_url) continue;
    try {
      const img = await faceapi.fetchImage(student.photo_url);
      const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
      if (detection) {
        labeledDescriptors.push(new faceapi.LabeledFaceDescriptors(student.name, [detection.descriptor]));
      }
    } catch (err) {
      console.warn(`Failed to process photo for ${student.name}:`, err);
    }
  }

  if (labeledDescriptors.length > 0) {
    faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6); // 0.6 threshold
  }
}

// Action Handlers
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  cameraContainer.style.display = 'block';
  cameraLoading.style.display = 'flex';
  setStatus(startStatus, 'Initializing recognition system...');

  try {
    await loadModels();

    // Ensure we have current students data
    if (allStudentsData.length === 0) await fetchStudents();
    await prepareFaceMatcher();

    if (!faceMatcher) {
      throw new Error('No valid student face data found. Register students first.');
    }

    // Start Camera
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: {} });
    video.srcObject = cameraStream;

    cameraLoading.style.display = 'none';
    isSystemRunning = true;
    updateStats();
    setStatus(startStatus, 'System running. Scanning faces...');

    // Start recognition loop
    startRecognitionLoop();
  } catch (err) {
    console.error(err);
    setStatus(startStatus, err.message || 'Error starting camera. Check permissions.', true);
    cameraContainer.style.display = 'none';
  } finally {
    startBtn.disabled = false;
  }
});

function startRecognitionLoop() {
  const displaySize = { width: video.width, height: video.height };
  faceapi.matchDimensions(canvas, displaySize);

  recognitionInterval = setInterval(async () => {
    if (!isSystemRunning) return;

    const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
    const resizedDetections = faceapi.resizeResults(detections, displaySize);

    // Clear canvas
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

    resizedDetections.forEach(detection => {
      const result = faceMatcher.findBestMatch(detection.descriptor);
      const box = detection.detection.box;
      const label = result.toString();

      // Draw box and label
      new faceapi.draw.DrawBox(box, { label }).draw(canvas);

      // If recognized, send attendance
      if (result.label !== 'unknown') {
        recordAttendanceDebounced(result.label);
      }
    });
  }, 500); // Check every 500ms
}

// Prevent multiple records for the same person in a short time
const markedToday = new Set(); // Use a set to remember who was marked in this session
function recordAttendanceDebounced(name) {
  // If we already marked them in this browser session, don't even call the server
  if (markedToday.has(name)) return;

  const student = allStudentsData.find(s => s.name === name);
  const roll_no = student ? student.roll_no : '';

  submitAttendance(name, roll_no);
}

async function submitAttendance(name, roll_no) {
  try {
    const payload = {
      name,
      roll_no,
      source: 'Browser Camera',
      recorded_at: new Date().toISOString()
    };

    const res = await fetch(`${API_BASE_URL}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      if (data.alreadyExists) {
        console.log(`[Info] ${name} already marked for today.`);
      } else {
        console.log(`[Success] Attendance recorded for ${name}`);
      }
      // Add to our local "marked" list so we stop scanning them
      markedToday.add(name);
      updateStats();
    }
  } catch (err) {
    console.error('Failed to record attendance:', err);
  }
}

stopBtn.addEventListener('click', () => {
  isSystemRunning = false;

  if (recognitionInterval) clearInterval(recognitionInterval);
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }

  cameraContainer.style.display = 'none';
  updateStats();
  setStatus(startStatus, 'System stopped.');
});

lookupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  fetchAttendance();
});

clearAttendanceBtn.addEventListener('click', () => {
  document.getElementById('lookup-student-name').value = '';
  document.getElementById('lookup-date').value = '';
  fetchAttendance();
});

async function fetchAttendance() {
  const name = document.getElementById('lookup-student-name').value.trim();
  const date = document.getElementById('lookup-date').value;

  setStatus(lookupStatus, 'Searching records...');
  attendanceTable.classList.add('hidden');
  attendanceTbody.innerHTML = '';
  currentAttendanceData = [];

  try {
    let url = `${API_BASE_URL}/attendance?`;
    if (name) url += `name=${encodeURIComponent(name)}&`;
    if (date) url += `date=${encodeURIComponent(date)}&`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();

    if (!data || data.length === 0) {
      setStatus(lookupStatus, 'No records found matching your filters.', true);
      return;
    }

    currentAttendanceData = data;
    data.forEach((row) => {
      const tr = document.createElement('tr');
      // Improved Date Formatting
      const dateObj = new Date(row.recorded_at);
      const formattedDate = dateObj.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      const formattedTime = dateObj.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      tr.innerHTML = `
        <td style="font-weight: 500;">
          <div style="font-size: 0.9rem;">${formattedDate}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${formattedTime}</div>
        </td>
        <td><span class="badge" style="background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${row.source || 'N/A'}</span></td>
        <td style="font-weight: 600;">${row.name || 'N/A'}</td>
        <td style="color: var(--text-muted);">${row.roll_no || 'N/A'}</td>
      `;
      attendanceTbody.appendChild(tr);
    });

    attendanceTable.classList.remove('hidden');
    setStatus(lookupStatus, '');
  } catch (err) {
    console.error(err);
    setStatus(lookupStatus, 'Failed to fetch records. System might be offline.', true);
  }
}

addStudentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus(addStudentStatus, 'Saving student...');
  try {
    const res = await fetch(`${API_BASE_URL}/students`, { method: 'POST', body: new FormData(addStudentForm) });
    if (!res.ok) throw new Error();
    setStatus(addStudentStatus, 'Student saved successfully!');
    addStudentForm.reset();
    photoPreviewContainer.innerHTML = '<i data-lucide="image" style="color: var(--border); width: 24px;"></i>';
    lucide.createIcons();
    fetchStudents();
  } catch (err) {
    setStatus(addStudentStatus, 'Save failed. Check server.', true);
  }
});

async function fetchStudents() {
  try {
    const res = await fetch(`${API_BASE_URL}/students`);
    const { data } = await res.json();
    allStudentsData = data || [];
    renderStudentsList(allStudentsData);
    updateStats();
  } catch (err) { console.error(err); }
}

function renderStudentsList(data) {
  if (!studentsList) return;
  studentsList.innerHTML = '';
  data.forEach(student => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${student.photo_url || 'https://via.placeholder.com/40'}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid var(--border);"></td>
      <td style="font-weight:500;">${student.name}</td>
      <td style="color:var(--text-muted);">${student.roll_no || 'N/A'}</td>`;
    studentsList.appendChild(tr);
  });
}

async function updateStats() {
  if (statTotalStudents) statTotalStudents.textContent = allStudentsData.length;
  if (statSystemStatus) {
    statSystemStatus.textContent = isSystemRunning ? 'Online' : 'Offline';
    statSystemStatus.style.color = isSystemRunning ? '#10b981' : '#ef4444';
  }

  // Fetch today's count using local date
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;

    const res = await fetch(`${API_BASE_URL}/attendance?date=${today}`);
    const { data } = await res.json();
    if (statTodayAttendance) statTodayAttendance.textContent = data.length || 0;
  } catch (err) { }
}

// Export Listeners
exportAttendanceBtn.addEventListener('click', () => downloadCSV(currentAttendanceData, `attendance_${new Date().toISOString().split('T')[0]}.csv`, ['name', 'roll_no', 'recorded_at', 'source']));
exportStudentsBtn.addEventListener('click', () => downloadCSV(allStudentsData, 'students_list.csv', ['name', 'roll_no', 'photo_url']));

// Init
fetchStudents();
updateStats();
setStatus(startStatus, '');
setStatus(lookupStatus, '');
setStatus(addStudentStatus, '');
setInterval(updateStats, 30000); // Update stats every 30s
