import { spawn } from 'child_process';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    // Spawn the Python script
    const pythonProcess = spawn('python', ['../../program.py'], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });

    // Handle process events
    pythonProcess.on('close', (code) => {
      console.log(`Python script exited with code ${code}`);
    });

    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python script:', error);
    });

    // Respond immediately that the script has been started
    return res.status(200).json({ success: true, message: 'Attendance script started' });
  } catch (e) {
    console.error('Serverless Error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
