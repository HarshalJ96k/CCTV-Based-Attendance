import startAttendance from './start-attendance.js';

export default function handler(req, res) {
  if (req.url === '/api/start-attendance') {
    return startAttendance(req, res);
  }

  res.status(200).send(`
    <div style="font-family: Arial; padding: 40px;">
      <h2>✅ Attendance Server Running</h2>
      <p>API endpoint is available at <a href="/api/attendance">/api/attendance</a></p>
      <p>Start attendance endpoint at <a href="/api/start-attendance">/api/start-attendance</a></p>
      <p>Deployed successfully on Vercel 🎉</p>
    </div>
  `);
}
