# TODO: Implement Attendance Workflow

## Steps to Complete

- [x] Create `attendance-server/api/start-attendance.js` endpoint to spawn Python script
- [x] Update `attendance-server/api/index.js` to include `/start-attendance` route
- [x] Update `program.py` to use configurable SERVER_URL via environment variable
- [x] Implement `TeacherDashboard.tsx` with button to start attendance
- [x] Implement `StudentDashboard.tsx` to display attendance data from Supabase

## Followup Steps
- Run attendance-server locally (`npm run dev`)
- Update frontend to call local API for development
- Test face recognition and attendance marking
- Verify Supabase data display in student dashboard
