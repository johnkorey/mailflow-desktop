import { Router } from 'express';
import { smtpDb, campaignDb, recipientDb, attachmentDb, validateAndDedupeRecipients } from '../database/db.mjs';
import { buildCampaignPreview } from '../services/preview.mjs';

const router = Router();

/**
 * GET /api/user/campaigns
 * Get all campaigns for current user
 */
router.get('/', (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const campaigns = campaignDb.findByUserId(req.user.id, parseInt(limit), parseInt(offset));

        res.json({ campaigns });
    } catch (error) {
        console.error('Get campaigns error:', error);
        res.status(500).json({ error: 'Failed to get campaigns' });
    }
});

/**
 * GET /api/user/campaigns/:id
 * Get single campaign with recipients
 */
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;

        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const recipients = recipientDb.findByCampaignId(id);
        const stats = recipientDb.getStatsByCampaignId(id);

        res.json({ campaign, recipients, stats });
    } catch (error) {
        console.error('Get campaign error:', error);
        res.status(500).json({ error: 'Failed to get campaign' });
    }
});

/**
 * POST /api/user/campaigns
 * Create new campaign
 */
router.post('/', (req, res) => {
    try {
        const {
            name, subject, body_html, body_text, reply_to,
            attachment, attachment_id, attachment_format, attachment_custom_name, smtp_config_id,
            // Rotation fields
            subjects_list, sender_names_list, cta_links_list, smtp_ids_list,
            rotate_subjects, rotate_senders, rotate_cta, rotate_smtp, smtp_rotation_type
        } = req.body;

        // Subject is required unless a subjects_list is provided for rotation
        const hasSubjectList = subjects_list && Array.isArray(subjects_list) && subjects_list.length > 0;
        if (!name) {
            return res.status(400).json({ error: 'Campaign name is required' });
        }
        if (!subject && !hasSubjectList) {
            return res.status(400).json({ error: 'Subject is required (or select a subject list for rotation)' });
        }

        // Verify SMTP config ownership if provided
        if (smtp_config_id) {
            const smtpConfig = smtpDb.findById(smtp_config_id);
            if (!smtpConfig || smtpConfig.user_id !== req.user.id) {
                return res.status(400).json({ error: 'Invalid SMTP configuration' });
            }
        }

        // Verify all SMTP IDs in rotation list
        if (smtp_ids_list && Array.isArray(smtp_ids_list)) {
            for (const smtpId of smtp_ids_list) {
                const smtpConfig = smtpDb.findById(smtpId);
                if (!smtpConfig || smtpConfig.user_id !== req.user.id) {
                    return res.status(400).json({ error: 'Invalid SMTP in rotation list' });
                }
            }
        }

        // Verify attachment library ownership if provided
        if (attachment_id) {
            const libraryAttachment = attachmentDb.findById(attachment_id);
            if (!libraryAttachment || libraryAttachment.user_id !== req.user.id) {
                return res.status(400).json({ error: 'Invalid attachment' });
            }
        }

        // Handle direct upload attachment
        let attachment_name = null;
        let attachment_content = null;
        if (attachment && attachment.name && attachment.content) {
            attachment_name = attachment.name;
            attachment_content = attachment.content;
        }

        // Debug: Log received rotation data
        console.log('[Campaign Create] Rotation data received:', {
            rotate_cta,
            cta_links_list,
            rotate_subjects,
            rotate_senders,
            subjects_list: subjects_list ? `${subjects_list.length} items` : null,
            sender_names_list: sender_names_list ? `${sender_names_list.length} items` : null
        });

        console.log('[Campaign Create] Attachment data:', { attachment_id, attachment_format, attachment_name, has_attachment_content: !!attachment_content });

        const campaign = campaignDb.create({
            user_id: req.user.id,
            name,
            subject,
            body_html,
            body_text,
            reply_to,
            attachment_name,
            attachment_content,
            attachment_id: attachment_id || null,
            attachment_format: attachment_format || 'html',
            attachment_custom_name: attachment_custom_name || null,
            smtp_config_id,
            // Rotation fields
            subjects_list: subjects_list ? JSON.stringify(subjects_list) : null,
            sender_names_list: sender_names_list ? JSON.stringify(sender_names_list) : null,
            cta_links_list: cta_links_list ? JSON.stringify(cta_links_list) : null,
            smtp_ids_list: smtp_ids_list ? JSON.stringify(smtp_ids_list) : null,
            rotate_subjects: rotate_subjects || false,
            rotate_senders: rotate_senders || false,
            rotate_cta: rotate_cta || false,
            rotate_smtp: rotate_smtp || false,
            smtp_rotation_type: smtp_rotation_type || 'round_robin'
        });

        res.status(201).json({
            message: 'Campaign created',
            campaign
        });
    } catch (error) {
        console.error('Create campaign error:', error);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

/**
 * PUT /api/user/campaigns/:id
 * Update campaign
 */
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, subject, body_html, body_text, reply_to,
            attachment, attachment_id, attachment_format, attachment_custom_name, smtp_config_id,
            // Rotation fields
            subjects_list, sender_names_list, cta_links_list, smtp_ids_list,
            rotate_subjects, rotate_senders, rotate_cta, rotate_smtp, smtp_rotation_type
        } = req.body;

        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Can't update if sending
        if (campaign.status === 'sending') {
            return res.status(400).json({ error: 'Cannot update campaign while sending' });
        }

        // Verify all SMTP IDs in rotation list
        if (smtp_ids_list && Array.isArray(smtp_ids_list)) {
            for (const smtpId of smtp_ids_list) {
                const smtpConfig = smtpDb.findById(smtpId);
                if (!smtpConfig || smtpConfig.user_id !== req.user.id) {
                    return res.status(400).json({ error: 'Invalid SMTP in rotation list' });
                }
            }
        }

        // Verify attachment library ownership if provided
        if (attachment_id) {
            const libraryAttachment = attachmentDb.findById(attachment_id);
            if (!libraryAttachment || libraryAttachment.user_id !== req.user.id) {
                return res.status(400).json({ error: 'Invalid attachment' });
            }
        }

        // Handle direct upload attachment - only update if new attachment provided
        let attachment_name = campaign.attachment_name;
        let attachment_content = campaign.attachment_content;
        if (attachment && attachment.name && attachment.content) {
            attachment_name = attachment.name;
            attachment_content = attachment.content;
        } else if (attachment === null) {
            // Explicitly remove direct attachment
            attachment_name = null;
            attachment_content = null;
        }

        campaignDb.update(id, {
            name,
            subject,
            body_html,
            body_text,
            reply_to,
            attachment_name,
            attachment_content,
            attachment_id: attachment_id !== undefined ? attachment_id : campaign.attachment_id,
            attachment_format: attachment_format || campaign.attachment_format || 'html',
            attachment_custom_name: attachment_custom_name !== undefined ? attachment_custom_name : campaign.attachment_custom_name,
            smtp_config_id,
            // Rotation fields
            subjects_list: subjects_list !== undefined ? JSON.stringify(subjects_list) : campaign.subjects_list,
            sender_names_list: sender_names_list !== undefined ? JSON.stringify(sender_names_list) : campaign.sender_names_list,
            cta_links_list: cta_links_list !== undefined ? JSON.stringify(cta_links_list) : campaign.cta_links_list,
            smtp_ids_list: smtp_ids_list !== undefined ? JSON.stringify(smtp_ids_list) : campaign.smtp_ids_list,
            rotate_subjects: rotate_subjects !== undefined ? (rotate_subjects ? 1 : 0) : campaign.rotate_subjects,
            rotate_senders: rotate_senders !== undefined ? (rotate_senders ? 1 : 0) : campaign.rotate_senders,
            rotate_cta: rotate_cta !== undefined ? (rotate_cta ? 1 : 0) : campaign.rotate_cta,
            rotate_smtp: rotate_smtp !== undefined ? (rotate_smtp ? 1 : 0) : campaign.rotate_smtp,
            smtp_rotation_type: smtp_rotation_type || campaign.smtp_rotation_type || 'round_robin'
        });

        // Reset campaign to draft and reset all recipients to pending so it can be re-sent
        if (campaign.status !== 'draft') {
            campaignDb.updateStatus(id, 'draft');
            campaignDb.update(id, { sent_count: 0, failed_count: 0 });
            recipientDb.resetAllStatus(id);
        }

        res.json({ message: 'Campaign updated' });
    } catch (error) {
        console.error('Update campaign error:', error);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
});

/**
 * DELETE /api/user/campaigns/:id
 * Delete campaign
 */
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Can't delete if sending
        if (campaign.status === 'sending') {
            return res.status(400).json({ error: 'Cannot delete campaign while sending' });
        }

        campaignDb.delete(id);

        res.json({ message: 'Campaign deleted' });
    } catch (error) {
        console.error('Delete campaign error:', error);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
});

/**
 * POST /api/user/campaigns/:id/reset
 * Reset a campaign for resending
 */
router.post('/:id/reset', (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Only allow resending completed/sent campaigns
        if (!['sent', 'completed', 'paused', 'failed'].includes(campaign.status)) {
            return res.status(400).json({ error: 'Can only reset completed, paused, or failed campaigns' });
        }

        // Reset campaign status to draft
        campaignDb.update(id, {
            status: 'draft',
            sent_count: 0,
            failed_count: 0,
            completed_at: null
        });

        // Reset all recipients to pending
        recipientDb.resetForCampaign(id);

        res.json({ success: true, message: 'Campaign reset for resending' });
    } catch (error) {
        console.error('Reset campaign error:', error);
        res.status(500).json({ error: 'Failed to reset campaign' });
    }
});

/**
 * POST /api/user/campaigns/:id/schedule
 * Schedule a campaign to send at a future time.
 * Body: { scheduled_at: "2026-04-11T15:00:00" }  (null to cancel)
 */
router.post('/:id/schedule', (req, res) => {
    try {
        const { id } = req.params;
        const { scheduled_at } = req.body;

        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        if (campaign.status === 'sending') {
            return res.status(400).json({ error: 'Cannot schedule while sending' });
        }

        // null clears the schedule
        if (scheduled_at === null || scheduled_at === '') {
            campaignDb.update(id, { scheduled_at: null });
            return res.json({ message: 'Schedule cleared', scheduled_at: null });
        }

        // Validate — must parse as a date and be in the future
        const date = new Date(scheduled_at);
        if (isNaN(date.getTime())) {
            return res.status(400).json({ error: 'Invalid scheduled_at date' });
        }

        // Must have recipients
        if ((campaign.total_recipients || 0) <= 0) {
            return res.status(400).json({ error: 'Add recipients before scheduling' });
        }

        // Reset to draft in case it was paused/failed
        if (campaign.status !== 'draft') {
            campaignDb.updateStatus(id, 'draft');
        }

        // Store as SQLite-friendly ISO string
        const isoString = date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
        campaignDb.update(id, { scheduled_at: isoString });

        res.json({ message: 'Campaign scheduled', scheduled_at: isoString });
    } catch (error) {
        console.error('Schedule campaign error:', error);
        res.status(500).json({ error: 'Failed to schedule campaign' });
    }
});

/**
 * POST /api/user/campaigns/preview
 * Render a campaign as it would appear, without sending. Accepts either:
 *   - { campaign_id: <id> }                       — load from DB
 *   - { subject, body_html, body_text }           — preview unsaved draft
 * Plus optional sample_recipient: { email, name }
 *
 * Returns { subject, html, text, score: { score, level, levelText, flags, reasons } }
 */
router.post('/preview', (req, res) => {
    try {
        const { campaign_id, subject, body_html, body_text, sample_recipient } = req.body;

        let campaign;
        if (campaign_id) {
            campaign = campaignDb.findById(campaign_id);
            if (!campaign || campaign.user_id !== req.user.id) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
        } else {
            campaign = {
                subject: subject || '',
                body_html: body_html || '',
                body_text: body_text || ''
            };
        }

        const preview = buildCampaignPreview(campaign, sample_recipient);
        res.json(preview);
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Failed to build preview' });
    }
});

/**
 * POST /api/user/campaigns/:id/clone
 * Duplicate a campaign as a new draft (no recipients copied)
 */
router.post('/:id/clone', (req, res) => {
    try {
        const { id } = req.params;
        const newCampaign = campaignDb.clone(id, req.user.id);
        if (!newCampaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        res.status(201).json({
            message: 'Campaign cloned',
            campaign: newCampaign
        });
    } catch (error) {
        console.error('Clone campaign error:', error);
        res.status(500).json({ error: 'Failed to clone campaign' });
    }
});

/**
 * POST /api/user/campaigns/:id/recipients
 * Add recipients to campaign
 */
router.post('/:id/recipients', (req, res) => {
    try {
        const { id } = req.params;
        const { recipients } = req.body; // Array of { email, name? }

        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status !== 'draft') {
            campaignDb.updateStatus(id, 'draft');
        }

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Recipients array is required' });
        }

        // Validate + dedupe (within batch AND against existing recipients)
        const result = validateAndDedupeRecipients(id, recipients);

        if (result.valid.length === 0) {
            return res.status(400).json({
                error: 'No valid new email addresses to add',
                ...result.summary
            });
        }

        recipientDb.bulkCreate(id, result.valid);

        res.json({
            message: `Added ${result.summary.imported} recipients`,
            ...result.summary
        });
    } catch (error) {
        console.error('Add recipients error:', error);
        res.status(500).json({ error: 'Failed to add recipients' });
    }
});

/**
 * PUT /api/user/campaigns/:id/recipients
 * Replace all recipients for a campaign
 */
router.put('/:id/recipients', (req, res) => {
    try {
        const { id } = req.params;
        const { recipients, deduplicate } = req.body;

        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Recipients array is required' });
        }

        // For replace mode, skip the "already exists" check because we're wiping first.
        // Dedup within the batch only when the user explicitly checked the box.
        const result = validateAndDedupeRecipients(null, recipients, { skipExistingCheck: true, deduplicate: !!deduplicate });

        if (result.valid.length === 0) {
            return res.status(400).json({
                error: 'No valid email addresses provided',
                ...result.summary
            });
        }

        // Delete old recipients and reset counters
        recipientDb.deleteByampaignId(id);
        campaignDb.update(id, { total_recipients: 0, sent_count: 0, failed_count: 0 });
        campaignDb.updateStatus(id, 'draft');

        recipientDb.bulkCreate(id, result.valid);

        res.json({
            message: `Replaced with ${result.summary.imported} recipients`,
            ...result.summary
        });
    } catch (error) {
        console.error('Replace recipients error:', error);
        res.status(500).json({ error: 'Failed to replace recipients' });
    }
});

/**
 * DELETE /api/user/campaigns/:id/recipients
 * Clear all recipients from campaign
 */
router.delete('/:id/recipients', (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status !== 'draft') {
            return res.status(400).json({ error: 'Can only clear recipients from draft campaigns' });
        }

        recipientDb.deleteByampaignId(id);
        campaignDb.update(id, { total_recipients: 0 });

        res.json({ message: 'Recipients cleared' });
    } catch (error) {
        console.error('Clear recipients error:', error);
        res.status(500).json({ error: 'Failed to clear recipients' });
    }
});

export default router;
