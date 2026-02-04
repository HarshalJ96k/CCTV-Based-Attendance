import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface TeacherDashboardProps {
  user: any;
  supabase: any;
  onSignOut: () => void;
}

export function TeacherDashboard({ user, supabase, onSignOut }: TeacherDashboardProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [message, setMessage] = useState('');

  const handleStartAttendance = async () => {
    setIsStarting(true);
    setMessage('Starting attendance system...');

    try {
      // For development, use local server; for production, use Vercel
      const apiUrl = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3001/api/start-attendance'
        : 'https://attendance-server.vercel.app/api/start-attendance';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setMessage('Attendance system started successfully! The webcam should now be active.');
      } else {
        setMessage('Failed to start attendance system. Please check the server.');
      }
    } catch (error) {
      console.error('Error starting attendance:', error);
      setMessage('Error connecting to server. Please ensure the attendance server is running.');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Teacher Dashboard</h1>
            <p className="text-gray-600">Welcome, {user?.email}</p>
          </div>
          <Button onClick={onSignOut} variant="outline">
            Sign Out
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Attendance Control</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Click the button below to start the attendance system. This will activate the webcam
              for face recognition and automatically mark attendance for recognized students.
            </p>
            <Button
              onClick={handleStartAttendance}
              disabled={isStarting}
              className="w-full md:w-auto"
            >
              {isStarting ? 'Starting...' : 'Start Attendance'}
            </Button>
            {message && (
              <p className="mt-4 text-sm text-gray-700 bg-gray-100 p-3 rounded">
                {message}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside space-y-2 text-gray-600">
              <li>Ensure the webcam is connected and accessible.</li>
              <li>Students should face the camera clearly for recognition.</li>
              <li>The system will automatically detect and mark attendance.</li>
              <li>Press 'q' in the attendance window to stop the session.</li>
              <li>All attendance data is saved to Supabase in real-time.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
