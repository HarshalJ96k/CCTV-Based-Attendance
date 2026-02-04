// Configuration for deployment
// In development: same origin (empty string)
// In production: point to your Render backend URL (e.g., 'https://attendance-api.onrender.com')
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : 'REPLACE_WITH_YOUR_RENDER_URL';

export default API_BASE_URL;
