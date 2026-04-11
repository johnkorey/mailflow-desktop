import { Router } from 'express';
import nodemailer from 'nodemailer';
import { smtpDb, inboxFinderTestDb, inboxFinderResultDb } from '../database/db.mjs';
import { authenticate } from '../middleware/auth.mjs';
import { decrypt } from '../services/encryption.mjs';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/inbox-finder/tests
 * Get all inbox finder tests for the user
 */
router.get('/tests', (req, res) => {
    try {
        const tests = inboxFinderTestDb.findByUserId(req.user.id);
        
        // Parse JSON fields
        const parsedTests = tests.map(t => ({
            ...t,
            usernames: JSON.parse(t.usernames || '[]'),
            domains: JSON.parse(t.domains || '[]')
        }));
        
        res.json({ tests: parsedTests });
    } catch (error) {
        console.error('Get inbox finder tests error:', error);
        res.status(500).json({ error: 'Failed to get tests' });
    }
});

/**
 * GET /api/inbox-finder/tests/:id
 * Get single test with results
 */
router.get('/tests/:id', (req, res) => {
    try {
        const { id } = req.params;
        const test = inboxFinderTestDb.findById(id);
        
        if (!test || test.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Test not found' });
        }
        
        const results = inboxFinderResultDb.findByTestId(id);
        
        res.json({
            test: {
                ...test,
                usernames: JSON.parse(test.usernames || '[]'),
                domains: JSON.parse(test.domains || '[]')
            },
            results
        });
    } catch (error) {
        console.error('Get inbox finder test error:', error);
        res.status(500).json({ error: 'Failed to get test' });
    }
});

/**
 * POST /api/inbox-finder/tests
 * Create and run a new inbox finder test
 * 
 * Logic:
 * - Usernames + Domains = SENDER addresses (FROM field)
 * - Recipients = Actual email addresses to send TO
 * - For each sender combination, sends test email to all recipients
 */
router.post('/tests', async (req, res) => {
    try {
        const { smtp_config_id, name, usernames, domains, recipients } = req.body;
        
        // Validate inputs
        if (!smtp_config_id) {
            return res.status(400).json({ error: 'SMTP configuration is required' });
        }
        
        if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
            return res.status(400).json({ error: 'At least one sender username is required' });
        }
        
        if (!domains || !Array.isArray(domains) || domains.length === 0) {
            return res.status(400).json({ error: 'At least one sender domain is required' });
        }
        
        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'At least one recipient email is required' });
        }
        
        // Verify SMTP belongs to user
        const smtp = smtpDb.findById(smtp_config_id);
        if (!smtp || smtp.user_id !== req.user.id) {
            return res.status(404).json({ error: 'SMTP configuration not found' });
        }
        
        // Clean inputs - SENDER usernames
        const cleanUsernames = usernames
            .map(u => u.trim().toLowerCase())
            .filter(u => u && u.length > 0);
        
        // Clean inputs - SENDER domains
        const cleanDomains = domains
            .map(d => d.trim().toLowerCase())
            .filter(d => d && d.includes('.'));
        
        // Clean inputs - RECIPIENT emails
        const cleanRecipients = recipients
            .map(r => r.trim().toLowerCase())
            .filter(r => r && r.includes('@') && r.includes('.'));
        
        if (cleanRecipients.length === 0) {
            return res.status(400).json({ error: 'No valid recipient emails found' });
        }
        
        // Generate all SENDER combinations (FROM addresses)
        const senderCombinations = [];
        for (const username of cleanUsernames) {
            for (const domain of cleanDomains) {
                senderCombinations.push({
                    email: `${username}@${domain}`,
                    username,
                    domain
                });
            }
        }
        
        if (senderCombinations.length === 0) {
            return res.status(400).json({ error: 'No valid sender combinations generated' });
        }
        
        // Total tests = sender combinations × recipients
        const totalTests = senderCombinations.length * cleanRecipients.length;
        
        if (totalTests > 1000) {
            return res.status(400).json({ 
                error: `Too many tests (${totalTests}). Maximum 1000 allowed. Reduce senders or recipients.`
            });
        }
        
        // Create test record
        const test = inboxFinderTestDb.create({
            user_id: req.user.id,
            smtp_config_id,
            name: name || `Inbox Test ${new Date().toLocaleString()}`,
            usernames: cleanUsernames,
            domains: cleanDomains,
            recipients: cleanRecipients,
            total_combinations: totalTests
        });
        
        // Create result records - one for each sender/recipient pair
        const testResults = [];
        for (const sender of senderCombinations) {
            for (const recipientEmail of cleanRecipients) {
                testResults.push({
                    sender_email: sender.email,
                    recipient_email: recipientEmail,
                    username: sender.username,
                    domain: sender.domain
                });
            }
        }
        inboxFinderResultDb.bulkCreateWithRecipients(test.id, testResults);
        
        // Start test (mark as running)
        inboxFinderTestDb.update(test.id, {
            status: 'running',
            started_at: new Date().toISOString()
        });
        
        // Send response immediately, process in background
        res.status(201).json({
            message: 'Test started',
            test: {
                id: test.id,
                total_combinations: totalTests,
                sender_count: senderCombinations.length,
                recipient_count: cleanRecipients.length
            }
        });
        
        // Process sending in background
        processInboxFinderTest(test.id, smtp).catch(err => {
            console.error(`[InboxFinder] Test ${test.id} error:`, err);
        });
        
    } catch (error) {
        console.error('Create inbox finder test error:', error);
        res.status(500).json({ error: 'Failed to create test' });
    }
});

/**
 * GET /api/inbox-finder/tests/:id/status
 * Get test progress/status
 */
router.get('/tests/:id/status', (req, res) => {
    try {
        const { id } = req.params;
        const test = inboxFinderTestDb.findById(id);
        
        if (!test || test.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Test not found' });
        }
        
        const counts = inboxFinderResultDb.getStatusCounts(id);
        
        res.json({
            status: test.status,
            total: counts.total,
            sent: counts.sent,
            failed: counts.failed,
            pending: counts.pending,
            progress: counts.total > 0 ? Math.round(((counts.sent + counts.failed) / counts.total) * 100) : 0
        });
    } catch (error) {
        console.error('Get inbox finder status error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});

/**
 * DELETE /api/inbox-finder/tests/:id
 * Delete a test
 */
router.delete('/tests/:id', (req, res) => {
    try {
        const { id } = req.params;
        const test = inboxFinderTestDb.findById(id);
        
        if (!test || test.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Test not found' });
        }
        
        // Delete results first
        inboxFinderResultDb.deleteByTestId(id);
        
        // Delete test
        inboxFinderTestDb.delete(id);
        
        res.json({ message: 'Test deleted' });
    } catch (error) {
        console.error('Delete inbox finder test error:', error);
        res.status(500).json({ error: 'Failed to delete test' });
    }
});

/**
 * POST /api/inbox-finder/tests/:id/cancel
 * Cancel a running test
 */
router.post('/tests/:id/cancel', (req, res) => {
    try {
        const { id } = req.params;
        const test = inboxFinderTestDb.findById(id);
        
        if (!test || test.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Test not found' });
        }
        
        if (test.status !== 'running') {
            return res.status(400).json({ error: 'Test is not running' });
        }
        
        inboxFinderTestDb.update(id, {
            status: 'cancelled',
            completed_at: new Date().toISOString()
        });
        
        res.json({ message: 'Test cancelled' });
    } catch (error) {
        console.error('Cancel inbox finder test error:', error);
        res.status(500).json({ error: 'Failed to cancel test' });
    }
});

/**
 * Process inbox finder test - sends test emails
 * 
 * Logic:
 * - For each result (sender_email + recipient_email pair)
 * - Sends FROM sender_email (overriding SMTP default) TO recipient_email
 * - This tests if the sender address can deliver to recipients
 */
async function processInboxFinderTest(testId, smtp) {
    console.log(`[InboxFinder] Starting test ${testId}`);
    
    try {
        // Decrypt SMTP password
        const password = decrypt(smtp.password_encrypted);
        
        // Create transporter - uses SMTP for authentication only
        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure === 1,
            auth: {
                user: smtp.username,
                pass: password
            },
            tls: {
                rejectUnauthorized: false
            }
        });
        
        // Verify connection
        try {
            await transporter.verify();
        } catch (verifyError) {
            console.error(`[InboxFinder] SMTP verify failed:`, verifyError);
            inboxFinderTestDb.update(testId, {
                status: 'completed',
                completed_at: new Date().toISOString()
            });
            return;
        }
        
        // Get all pending results
        const results = inboxFinderResultDb.findByTestId(testId);
        const pendingResults = results.filter(r => r.status === 'pending');
        
        let sentCount = 0;
        let failedCount = 0;
        
        for (const result of pendingResults) {
            // Check if test was cancelled
            const currentTest = inboxFinderTestDb.findById(testId);
            if (currentTest.status === 'cancelled') {
                console.log(`[InboxFinder] Test ${testId} was cancelled`);
                break;
            }
            
            // Generate unique test content for each email
            const testSubject = `Inbox Test - ${Date.now()}`;
            const testBody = generateTestEmailContent();
            
            // Use the sender_email from result as FROM address (overrides SMTP default)
            const senderEmail = result.sender_email || result.email;
            const recipientEmail = result.recipient_email || result.email;
            
            try {
                await transporter.sendMail({
                    from: senderEmail,  // Override SMTP default - use sender combination
                    to: recipientEmail,  // Send TO the recipient
                    subject: testSubject,
                    text: testBody,
                    html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Inbox Delivery Test</h2>
                        <p>${testBody}</p>
                        <hr>
                        <p style="font-size: 12px; color: #666;">
                            Test ID: ${testId}<br>
                            FROM: ${senderEmail}<br>
                            TO: ${recipientEmail}<br>
                            Time: ${new Date().toISOString()}
                        </p>
                    </div>`
                });
                
                inboxFinderResultDb.updateStatus(result.id, 'sent');
                sentCount++;
                console.log(`[InboxFinder] Sent FROM ${senderEmail} TO ${recipientEmail}`);
                
            } catch (sendError) {
                inboxFinderResultDb.updateStatus(result.id, 'failed', sendError.message);
                failedCount++;
                console.log(`[InboxFinder] Failed FROM ${senderEmail} TO ${recipientEmail}: ${sendError.message}`);
            }
            
            // Small delay between sends (1-3 seconds)
            const delay = 1000 + Math.random() * 2000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // Update test as completed
        inboxFinderTestDb.update(testId, {
            status: 'completed',
            sent_count: sentCount,
            failed_count: failedCount,
            completed_at: new Date().toISOString()
        });
        
        console.log(`[InboxFinder] Test ${testId} completed. Sent: ${sentCount}, Failed: ${failedCount}`);
        
    } catch (error) {
        console.error(`[InboxFinder] Test ${testId} error:`, error);
        inboxFinderTestDb.update(testId, {
            status: 'completed',
            completed_at: new Date().toISOString()
        });
    }
}

/**
 * Generate random test email content
 */
function generateTestEmailContent() {
    const messages = [
        'This is a delivery test email. Please check if this arrived in your inbox.',
        'Testing email delivery. If you received this in your inbox, delivery was successful.',
        'Inbox placement test. This email was sent to verify delivery.',
        'Email delivery verification test. Check your inbox for this message.',
        'This is an automated test to check inbox placement for your email configuration.'
    ];
    
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    const timestamp = new Date().toISOString();
    const randomCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    return `${randomMessage}\n\nTest Code: ${randomCode}\nTimestamp: ${timestamp}`;
}

export default router;

