// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './database/db.mjs';
import { startScheduler } from './services/scheduler.mjs';

// Import routes
import authRoutes from './routes/auth.mjs';
import userRoutes from './routes/user.mjs';
import sendRoutes from './routes/send.mjs';
import inboxFinderRoutes from './routes/inbox-finder.mjs';
import uploadRoutes from './routes/upload.mjs';
import unsubscribeRoutes from './routes/unsubscribe.mjs';
// TODO: Uncomment after MVP to enable license gating
// import licenseRoutes from './routes/license.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
console.log('Initializing database...');
initializeDatabase();

// Body parsing with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/send', sendRoutes);
app.use('/api/inbox-finder', inboxFinderRoutes);
app.use('/api/upload', uploadRoutes);

// Public unsubscribe routes — mounted at root, no auth, must be before SPA catch-all
app.use(unsubscribeRoutes);
// TODO: Uncomment after MVP to enable license gating
// app.use('/api/license', licenseRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server — retry if port is temporarily unavailable (TIME_WAIT)
function startServer(retries = 5) {
    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, () => {
            console.log(`MailFlow Desktop - Server running at http://localhost:${PORT}`);
            resolve(server);
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE' && retries > 0) {
                console.log(`Port ${PORT} busy, retrying in 1s... (${retries} left)`);
                setTimeout(() => startServer(retries - 1).then(resolve).catch(reject), 1000);
            } else {
                reject(err);
            }
        });
    });
}

const server = await startServer();

// Start the campaign scheduler (checks every 30s for campaigns due to send)
startScheduler();

export { app, server };
export default app;
