import face_recognition
import cv2
import numpy as np
import csv
import requests
import os
import math
from datetime import datetime
from io import BytesIO

# API endpoint to receive attendance (defaults to local Express API)
SERVER_URL = os.getenv("SERVER_URL", "https://cctv-based-attendance.onrender.com/attendance")
# Endpoint to fetch students with photo URLs
STUDENTS_URL = os.getenv("STUDENTS_URL", "https://cctv-based-attendance.onrender.com/students")
# IP Webcam URL from mobile (e.g., http://192.168.1.100:8080/video)
IP_WEBCAM_URL = os.getenv("IP_WEBCAM_URL", "")
# Current Subject
CURRENT_SUBJECT = os.getenv("CURRENT_SUBJECT", "General")

# Target Geofencing Coordinates
TARGET_LAT = 16.40614102801584
TARGET_LON = 74.14202251348537
MAX_DISTANCE_METERS = 100

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # Radius of Earth in meters
    phi_1 = math.radians(lat1)
    phi_2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2.0)**2 + math.cos(phi_1)*math.cos(phi_2) * math.sin(delta_lambda/2.0)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_current_location():
    # Note: For 100m accuracy, this requires a physical GPS module or mobile GPS sensors. 
    # Standard IP-based location is highly inaccurate (cellular/ISP towers) and works mostly for demonstration.
    try:
        resp = requests.get("https://ipapi.co/json/", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("latitude"), data.get("longitude")
    except Exception:
        pass
    return None, None

ENABLE_GEOFENCE = os.getenv("ENABLE_GEOFENCE", "false").lower() == "true"

if ENABLE_GEOFENCE:
    current_lat, current_lon = get_current_location()
    if current_lat is not None and current_lon is not None:
        distance = haversine(TARGET_LAT, TARGET_LON, current_lat, current_lon)
        print(f"[INFO] Geofence check: Device is ~{distance:.2f} meters away.")
        if distance > MAX_DISTANCE_METERS:
            print(f"[ERROR] You are {distance:.2f}m from the campus. Attendance system is strictly disabled.")
            exit(1)
    else:
        print("[WARNING] Could not fetch location coordinates. Ensure you have network access.")
else:
    print("[INFO] Geofence check is disabled.")

print(f"[INFO] Sending attendance to: {SERVER_URL}")

# Initialize video source (IP webcam from mobile or default webcam)
webcam_url = None  # Store the working URL for reconnection
if IP_WEBCAM_URL:
    webcam_url = IP_WEBCAM_URL.strip()
    if not any(webcam_url.endswith(path) for path in ['/video', '/videofeed', '/ipcam/video', '/mjpegfeed']):
        if '/' not in webcam_url.split('://')[1] or webcam_url.count('/') == 2:
            webcam_url = webcam_url.rstrip('/') + '/video'
    
    print(f"[INFO] Connecting to IP Webcam: {webcam_url}")
    video_capture = cv2.VideoCapture(webcam_url)
    video_capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    if not video_capture.isOpened():
        print(f"[ERROR] Failed to open IP Webcam at {webcam_url}")
        print(f"[INFO] Trying alternative endpoints...")
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
            print(f"[ERROR] Could not connect to IP Webcam.")
            video_capture = None
else:
    print("[INFO] Attempting to open default webcam...")
    video_capture = cv2.VideoCapture(0)
    if video_capture and video_capture.isOpened():
        print("[SUCCESS] Default webcam connected.")
    else:
        print("[ERROR] Failed to open default webcam.")

def load_encoding_from_url(url):
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        image = face_recognition.load_image_file(BytesIO(resp.content))
        encodings = face_recognition.face_encodings(image)
        if len(encodings) == 0:
            return None
        return encodings[0]
    except Exception as exc:
        return None

def fetch_students():
    try:
        resp = requests.get(STUDENTS_URL, timeout=8)
        if resp.status_code != 200:
            return []
        payload = resp.json()
        return payload.get("data", []) or []
    except Exception as exc:
        return []

def build_known_faces():
    known_encodings = []
    known_names = []
    name_to_roll = {}

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
                name_to_roll[name] = roll

    if not known_encodings:
        print("[WARNING] No remote students found or failed to load photos from the API.")

    return known_encodings, known_names, name_to_roll

print("[INFO] Loading student database encodings...")
known_face_encodings, known_face_names, name_to_roll_no = build_known_faces()
print(f"[SUCCESS] Loaded {len(known_face_names)} student encodings.")
print("[INFO] Initializing system...")

students = known_face_names.copy()
now = datetime.now()
current_date = now.strftime("%Y-%m-%d")

f = open(current_date + '.csv', 'w+', newline='')
lnwriter = csv.writer(f)
lnwriter.writerow(["Name", "Time"])

def send_attendance_to_server(name):
    try:
        roll_no = name_to_roll_no.get(name, "")
        payload = {
            "name": name,
            "roll_no": roll_no,
            "recorded_at": datetime.now().astimezone().isoformat(),
            "source": "ip_webcam" if IP_WEBCAM_URL else "webcam",
            "subject": CURRENT_SUBJECT
        }
        response = requests.post(SERVER_URL, json=payload, timeout=5)
        if response.status_code == 200:
            print(f"[CLOUD ✅] Attendance uploaded for: {name} in {CURRENT_SUBJECT}")
        else:
            print(f"[CLOUD ⚠️] Server responded with {response.status_code}: {response.text}")
    except Exception as e:
        print(f"[CLOUD ❌] Failed to send {name}: {e}")

if video_capture is None:
    print("[ERROR] Video capture not initialized. Exiting.")
    exit(1)

while True:
    ret, frame = video_capture.read()
    if not ret:
        source_name = "IP Webcam" if IP_WEBCAM_URL else "webcam"
        print(f"[ERROR] Could not read frame from {source_name}. Check connection and URL.")
        if IP_WEBCAM_URL and webcam_url:
            import time
            time.sleep(2)
            if video_capture:
                video_capture.release()
            video_capture = cv2.VideoCapture(webcam_url)
            video_capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not video_capture.isOpened():
                time.sleep(5)
            continue
        break

    small_frame = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
    rgb_small_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

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
                send_attendance_to_server(name)
        else:
            continue

    for (top, right, bottom, left), name in zip(face_locations, face_names):
        top *= 4
        right *= 4
        bottom *= 4
        left *= 4

        cv2.rectangle(frame, (left, top), (right, bottom), (0, 255, 0), 2)
        cv2.rectangle(frame, (left, bottom - 35), (right, bottom), (0, 255, 0), cv2.FILLED)
        font = cv2.FONT_HERSHEY_DUPLEX
        cv2.putText(frame, name, (left + 6, bottom - 6), font, 0.8, (255, 255, 255), 1)

    if not os.getenv("HEADLESS"):
        cv2.imshow("Attendance System", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

video_capture.release()
cv2.destroyAllWindows()
f.close()
print("✅ Attendance saved locally and synced to cloud.")
