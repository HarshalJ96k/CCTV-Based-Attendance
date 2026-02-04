import face_recognition
import cv2
import numpy as np
import csv
import requests
import os
from datetime import datetime
from pathlib import Path
from io import BytesIO

# API endpoint to receive attendance (defaults to local Express API)
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:3001/attendance")
# Endpoint to fetch students with photo URLs
STUDENTS_URL = os.getenv("STUDENTS_URL", "http://localhost:3001/students")
# IP Webcam URL from mobile (e.g., http://192.168.1.100:8080/video)
IP_WEBCAM_URL = os.getenv("IP_WEBCAM_URL", "")

BASE_DIR = Path(__file__).resolve().parent

print(f"[INFO] Sending attendance to: {SERVER_URL}")

# Initialize video source (IP webcam from mobile or default webcam)
webcam_url = None  # Store the working URL for reconnection
if IP_WEBCAM_URL:
    # Ensure IP webcam URL has proper video endpoint
    webcam_url = IP_WEBCAM_URL.strip()
    # Common IP webcam endpoints
    if not any(webcam_url.endswith(path) for path in ['/video', '/videofeed', '/ipcam/video', '/mjpegfeed']):
        # Try common endpoints, starting with /video
        if '/' not in webcam_url.split('://')[1] or webcam_url.count('/') == 2:
            webcam_url = webcam_url.rstrip('/') + '/video'
    
    print(f"[INFO] Connecting to IP Webcam: {webcam_url}")
    # IP webcam apps typically use HTTP streams (MJPEG format)
    video_capture = cv2.VideoCapture(webcam_url)
    # Reduce buffer size for lower latency
    video_capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    # Test connection
    if not video_capture.isOpened():
        print(f"[ERROR] Failed to open IP Webcam at {webcam_url}")
        print(f"[INFO] Trying alternative endpoints...")
        # Try alternative endpoints
        base_url = IP_WEBCAM_URL.strip().rstrip('/')
        alternatives = [
            base_url + '/video',
            base_url + '/videofeed',
            base_url + '/ipcam/video',
            base_url + '/mjpegfeed?640x480',
            base_url + '/video?640x480'
        ]
        
        connected = False
        for alt_url in alternatives:
            print(f"[INFO] Trying: {alt_url}")
            test_capture = cv2.VideoCapture(alt_url)
            test_capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if test_capture.isOpened():
                # Test if we can read a frame
                ret, _ = test_capture.read()
                if ret:
                    print(f"[SUCCESS] Connected to: {alt_url}")
                    video_capture = test_capture
                    webcam_url = alt_url
                    connected = True
                    break
                else:
                    test_capture.release()
            else:
                test_capture.release()
        
        if not connected:
            print(f"[ERROR] Could not connect to IP Webcam. Please check:")
            print(f"  1. Mobile and computer are on same Wi-Fi network")
            print(f"  2. IP Webcam app is running and started")
            print(f"  3. Try URL with /video endpoint: {base_url}/video")
            video_capture = None
else:
    print("[INFO] Using default webcam (device 0)")
    video_capture = cv2.VideoCapture(0)

def load_encoding(image_path):
    """Load a face encoding from local image path."""
    image = face_recognition.load_image_file(image_path)
    encodings = face_recognition.face_encodings(image)
    if len(encodings) == 0:
        print(f"[ERROR] No face detected in: {image_path}")
        return None
    return encodings[0]


def load_encoding_from_url(url):
    """Download image from URL and produce face encoding."""
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        image = face_recognition.load_image_file(BytesIO(resp.content))
        encodings = face_recognition.face_encodings(image)
        if len(encodings) == 0:
            print(f"[WARN] No face detected in remote image: {url}")
            return None
        return encodings[0]
    except Exception as exc:
        print(f"[WARN] Failed to load remote image {url}: {exc}")
        return None


def fetch_students():
    """Fetch students (name, roll_no, photo_url) from API."""
    try:
        resp = requests.get(STUDENTS_URL, timeout=8)
        if resp.status_code != 200:
            print(f"[WARN] /students responded {resp.status_code}: {resp.text}")
            return []
        payload = resp.json()
        return payload.get("data", []) or []
    except Exception as exc:
        print(f"[WARN] Failed to fetch students: {exc}")
        return []


def build_known_faces():
    """Load encodings from DB first; fallback to local photos if none."""
    known_encodings = []
    known_names = []
    name_to_roll = {}  # Dictionary to map name to roll_no

    # Try DB-sourced students
    students = fetch_students()
    if students:
        print(f"[INFO] Loaded {len(students)} students from API.")
        for student in students:
            name = (student.get("name") or "").strip()
            roll = (student.get("roll_no") or "").strip()
            photo_url = student.get("photo_url")
            if not name or not photo_url:
                continue
            encoding = load_encoding_from_url(photo_url)
            if encoding is not None:
                label = name
                known_encodings.append(encoding)
                known_names.append(label)
                # Store roll_no mapping
                name_to_roll[name] = roll

    # Fallback to bundled local photos if API empty or failed
    if not known_encodings:
        print("[INFO] No remote students found; using local photos fallback.")
        local_photos = [
            ("jobs", BASE_DIR / "photos" / "jobs.jpg"),
            ("ratan tata", BASE_DIR / "photos" / "tata.jpg"),
            ("sadmona", BASE_DIR / "photos" / "sadmona.jpg"),
            ("tesla", BASE_DIR / "photos" / "tesla.jpg"),
        ]
        for name, path in local_photos:
            if not path.exists():
                continue
            encoding = load_encoding(str(path))
            if encoding is not None:
                known_encodings.append(encoding)
                known_names.append(name)
                # No roll_no for local photos
                name_to_roll[name] = ""

    return known_encodings, known_names, name_to_roll


known_face_encodings, known_face_names, name_to_roll_no = build_known_faces()

# ---- Attendance Setup ----
students = known_face_names.copy()
now = datetime.now()
current_date = now.strftime("%Y-%m-%d")

f = open(current_date + '.csv', 'w+', newline='')
lnwriter = csv.writer(f)
lnwriter.writerow(["Name", "Time"])

# ---- Function to Send Attendance to Server ----
def send_attendance_to_server(name):
    """Send recognized face data to Supabase through Vercel API."""
    try:
        # Get roll_no from the mapping, default to empty string if not found
        roll_no = name_to_roll_no.get(name, "")
        payload = {
            "name": name,
            "roll_no": roll_no,
            "recorded_at": datetime.now().astimezone().isoformat(),
            "source": "ip_webcam" if IP_WEBCAM_URL else "webcam",
        }
        response = requests.post(SERVER_URL, json=payload, timeout=5)
        if response.status_code == 200:
            print(f"[CLOUD ✅] Attendance uploaded for: {name}")
        else:
            print(f"[CLOUD ⚠️] Server responded with {response.status_code}: {response.text}")
    except Exception as e:
        print(f"[CLOUD ❌] Failed to send {name}: {e}")

# ---- Main Loop ----
if video_capture is None:
    print("[ERROR] Video capture not initialized. Exiting.")
    exit(1)

while True:
    ret, frame = video_capture.read()
    if not ret:
        source_name = "IP Webcam" if IP_WEBCAM_URL else "webcam"
        print(f"[ERROR] Could not read frame from {source_name}. Check connection and URL.")
        # For IP webcam, try to reconnect after a short delay
        if IP_WEBCAM_URL and webcam_url:
            import time
            time.sleep(2)
            if video_capture:
                video_capture.release()
            # Reconnect with the same URL that worked
            video_capture = cv2.VideoCapture(webcam_url)
            video_capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not video_capture.isOpened():
                print(f"[ERROR] Reconnection failed. Please check IP Webcam connection.")
                time.sleep(5)
            continue
        break

    # Resize frame for faster processing
    small_frame = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)

    # Convert BGR (OpenCV) to RGB (face_recognition)
    rgb_small_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

    # Detect faces and encodings
    face_locations = face_recognition.face_locations(rgb_small_frame)
    face_encodings = face_recognition.face_encodings(rgb_small_frame, face_locations)

    face_names = []

    for face_encoding in face_encodings:
        matches = face_recognition.compare_faces(known_face_encodings, face_encoding)
        name = ""

        face_distance = face_recognition.face_distance(known_face_encodings, face_encoding)
        best_match_index = np.argmin(face_distance)
        if matches[best_match_index]:
            name = known_face_names[best_match_index]

        face_names.append(name)

        if name in known_face_names:
            if name in students:
                students.remove(name)
                print(f"[LOCAL ✅] Marked present: {name}")
                current_time = datetime.now().strftime("%H:%M:%S")
                lnwriter.writerow([name, current_time])
                send_attendance_to_server(name)  # Send to Supabase
        else:
            # unmatched faces are ignored
            continue

    # ---- Display the webcam feed ----
    for (top, right, bottom, left), name in zip(face_locations, face_names):
        top *= 4
        right *= 4
        bottom *= 4
        left *= 4

        # Draw a rectangle around the face
        cv2.rectangle(frame, (left, top), (right, bottom), (0, 255, 0), 2)

        # Label the face
        cv2.rectangle(frame, (left, bottom - 35), (right, bottom), (0, 255, 0), cv2.FILLED)
        font = cv2.FONT_HERSHEY_DUPLEX
        cv2.putText(frame, name, (left + 6, bottom - 6), font, 0.8, (255, 255, 255), 1)

    cv2.imshow("Attendance System", frame)

    # Quit when 'q' is pressed
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# ---- Cleanup ----
video_capture.release()
cv2.destroyAllWindows()
f.close()
print("✅ Attendance saved locally and synced to cloud.")
