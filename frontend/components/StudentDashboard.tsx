import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

interface StudentDashboardProps {
  user: any;
  supabase: any;
  onSignOut: () => void;
}

interface AttendanceRecord {
  id: number;
  name: string;
  roll_no: string;
  recorded_at: string;
  source: string;
}

export function StudentDashboard({ user, supabase, onSignOut }: StudentDashboardProps) {
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAttendance();
  }, []);

  const fetchAttendance = async () => {
    try {
      setLoading(true);
      // Fetch attendance records for the current user
      // Assuming name matches user email or we can map it
      const userName = user?.email?.split('@')[0] || user?.email; // Simple mapping

      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('name', userName)
        .order('recorded_at', { ascending: false });

      if (error) throw error;

      setAttendanceRecords(data || []);
    } catch (err) {
      console.error('Error fetching attendance:', err);
      setError('Failed to load attendance records');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Student Dashboard</h1>
            <p className="text-gray-600">Welcome, {user?.email}</p>
          </div>
          <Button onClick={onSignOut} variant="outline">
            Sign Out
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your Attendance Records</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-600">Loading attendance records...</p>
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-red-600">{error}</p>
                <Button onClick={fetchAttendance} className="mt-4">
                  Try Again
                </Button>
              </div>
            ) : attendanceRecords.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600">No attendance records found.</p>
                <p className="text-sm text-gray-500 mt-2">
                  Attendance will appear here once marked by the teacher.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{formatDate(record.recorded_at)}</TableCell>
                      <TableCell className="capitalize">{record.source}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Present
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
