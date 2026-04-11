import { Router } from 'express';
import { campaignDb, recipientDb } from '../database/db.mjs';
import { authenticate } from '../middleware/auth.mjs';
import { startCampaign, stopCampaign, pauseCampaign, resumeCampaign, getActiveSession } from '../services/email-sender.mjs';

const router = Router();

// Store SSE clients per campaign
const sseClients = new Map();

/**
 * GET /api/send/:campaignId/progress
 * SSE endpoint for real-time progress updates
 * NOTE: This endpoint uses token query param since EventSource can't send headers
 */
router.get('/:campaignId/progress', (req, res) => {
    const { campaignId } = req.params;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ event: 'connected' })}\n\n`);
    
    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        res.write(`: heartbeat\n\n`);
    }, 15000);
    
    // Add client to list
    if (!sseClients.has(campaignId)) {
        sseClients.set(campaignId, new Set());
    }
    sseClients.get(campaignId).add(res);
    
    // Remove client on close
    req.on('close', () => {
        clearInterval(heartbeat);
        const clients = sseClients.get(campaignId);
        if (clients) {
            clients.delete(res);
            if (clients.size === 0) {
                sseClients.delete(campaignId);
            }
        }
    });
});

// All other routes require authentication
router.use(authenticate);

/**
 * POST /api/send/:campaignId/start
 * Start sending emails for a campaign
 */
router.post('/:campaignId/start', async (req, res) => {
    try {
        const { campaignId } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(campaignId);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Check if already sending
        if (getActiveSession(parseInt(campaignId))) {
            return res.status(400).json({ error: 'Campaign is already sending' });
        }
        
        // Check recipients
        const stats = recipientDb.getStatsByCampaignId(campaignId);
        if (stats.pending === 0) {
            return res.status(400).json({ error: 'No pending recipients to send to' });
        }
        
        // Start campaign
        const sender = await startCampaign(req.user.id, parseInt(campaignId));
        
        // Set up event handlers for SSE
        sender.on('start', (data) => {
            broadcastToClients(campaignId, { event: 'start', data });
        });
        
        sender.on('sent', (data) => {
            broadcastToClients(campaignId, { event: 'sent', data });
        });
        
        sender.on('failed', (data) => {
            broadcastToClients(campaignId, { event: 'failed', data });
        });
        
        sender.on('complete', (data) => {
            broadcastToClients(campaignId, { event: 'complete', data });
        });
        
        sender.on('paused', () => {
            broadcastToClients(campaignId, { event: 'paused' });
        });
        
        sender.on('resumed', () => {
            broadcastToClients(campaignId, { event: 'resumed' });
        });
        
        sender.on('stopped', () => {
            broadcastToClients(campaignId, { event: 'stopped' });
        });
        
        // Start sending (don't await - let it run in background)
        sender.start().catch(error => {
            console.error('Campaign error:', error);
            broadcastToClients(campaignId, { event: 'error', data: { message: error.message } });
        });
        
        res.json({ 
            message: 'Campaign started',
            pending: stats.pending
        });
    } catch (error) {
        console.error('Start campaign error:', error);
        res.status(500).json({ error: error.message || 'Failed to start campaign' });
    }
});

/**
 * POST /api/send/:campaignId/stop
 * Stop sending emails
 */
router.post('/:campaignId/stop', (req, res) => {
    try {
        const { campaignId } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(campaignId);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const stopped = stopCampaign(parseInt(campaignId));
        
        if (stopped) {
            res.json({ message: 'Campaign stopped' });
        } else {
            res.status(400).json({ error: 'Campaign is not running' });
        }
    } catch (error) {
        console.error('Stop campaign error:', error);
        res.status(500).json({ error: 'Failed to stop campaign' });
    }
});

/**
 * POST /api/send/:campaignId/pause
 * Pause sending emails
 */
router.post('/:campaignId/pause', (req, res) => {
    try {
        const { campaignId } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(campaignId);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const paused = pauseCampaign(parseInt(campaignId));
        
        if (paused) {
            res.json({ message: 'Campaign paused' });
        } else {
            res.status(400).json({ error: 'Campaign is not running' });
        }
    } catch (error) {
        console.error('Pause campaign error:', error);
        res.status(500).json({ error: 'Failed to pause campaign' });
    }
});

/**
 * POST /api/send/:campaignId/resume
 * Resume sending emails
 */
router.post('/:campaignId/resume', (req, res) => {
    try {
        const { campaignId } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(campaignId);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const resumed = resumeCampaign(parseInt(campaignId));
        
        if (resumed) {
            res.json({ message: 'Campaign resumed' });
        } else {
            res.status(400).json({ error: 'Campaign is not running or paused' });
        }
    } catch (error) {
        console.error('Resume campaign error:', error);
        res.status(500).json({ error: 'Failed to resume campaign' });
    }
});

/**
 * GET /api/send/:campaignId/status
 * Get current sending status
 */
router.get('/:campaignId/status', (req, res) => {
    try {
        const { campaignId } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(campaignId);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const session = getActiveSession(parseInt(campaignId));
        const stats = recipientDb.getStatsByCampaignId(campaignId);
        
        res.json({
            campaign_status: campaign.status,
            is_running: !!session,
            is_paused: session ? session.isPaused : false,
            stats: {
                total: stats.total,
                pending: stats.pending,
                sent: stats.sent,
                failed: stats.failed
            },
            progress: session ? {
                sent: session.sentCount,
                failed: session.failedCount,
                total: session.totalCount
            } : null
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});


/**
 * Broadcast message to all SSE clients for a campaign
 */
function broadcastToClients(campaignId, message) {
    const clients = sseClients.get(String(campaignId));
    if (clients) {
        const data = `data: ${JSON.stringify(message)}\n\n`;
        clients.forEach(client => {
            try {
                client.write(data);
            } catch (error) {
                // Client disconnected
            }
        });
    }
}

export default router;

