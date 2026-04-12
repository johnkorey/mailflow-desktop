import { Router } from 'express';
import { attachmentDb } from '../database/db.mjs';
import { convertAttachment } from '../services/attachment-converter.mjs';

const router = Router();

/**
 * GET /api/user/attachments
 * Get all attachments for current user
 */
router.get('/', (req, res) => {
    try {
        const attachments = attachmentDb.findAllByUserId(req.user.id);
        res.json({ attachments });
    } catch (error) {
        console.error('Get attachments error:', error);
        res.status(500).json({ error: 'Failed to get attachments' });
    }
});

/**
 * GET /api/user/attachments/:id
 * Get single attachment
 */
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const attachment = attachmentDb.findById(id);

        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        res.json({ attachment });
    } catch (error) {
        console.error('Get attachment error:', error);
        res.status(500).json({ error: 'Failed to get attachment' });
    }
});

/**
 * POST /api/user/attachments
 * Create new attachment
 */
router.post('/', (req, res) => {
    try {
        const { name, description, html_content, tags, file_name, file_content, file_type, file_size } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        if (!html_content && !file_content) {
            return res.status(400).json({ error: 'HTML content or file upload is required' });
        }

        const attachData = {
            user_id: req.user.id,
            name,
            description,
            html_content: html_content || null,
            tags
        };

        // Handle file upload (base64)
        if (file_content) {
            attachData.file_name = file_name;
            attachData.file_content = Buffer.from(file_content, 'base64');
            attachData.file_type = file_type;
            attachData.file_size = file_size || 0;
        }

        const attachment = attachmentDb.create(attachData);

        // Don't send file_content back in response
        delete attachment.file_content;

        res.status(201).json({
            message: 'Attachment created',
            attachment
        });
    } catch (error) {
        console.error('Create attachment error:', error);
        res.status(500).json({ error: 'Failed to create attachment' });
    }
});

/**
 * PUT /api/user/attachments/:id
 * Update attachment
 */
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, html_content, tags, is_active, file_name, file_content, file_type, file_size } = req.body;

        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (html_content !== undefined) updateData.html_content = html_content;
        if (tags !== undefined) updateData.tags = tags;
        if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;
        if (file_content) {
            updateData.file_name = file_name;
            updateData.file_content = Buffer.from(file_content, 'base64');
            updateData.file_type = file_type;
            updateData.file_size = file_size || 0;
        }

        attachmentDb.update(id, updateData);

        res.json({ message: 'Attachment updated' });
    } catch (error) {
        console.error('Update attachment error:', error);
        res.status(500).json({ error: 'Failed to update attachment' });
    }
});

/**
 * DELETE /api/user/attachments/:id
 * Delete attachment
 */
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;

        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        attachmentDb.delete(id);

        res.json({ message: 'Attachment deleted' });
    } catch (error) {
        console.error('Delete attachment error:', error);
        res.status(500).json({ error: 'Failed to delete attachment' });
    }
});

/**
 * POST /api/user/attachments/:id/preview
 * Preview attachment in different formats
 */
router.post('/:id/preview', async (req, res) => {
    try {
        const { id } = req.params;
        const { format = 'html' } = req.body;

        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        // Convert to requested format
        const converted = await convertAttachment(
            attachment.html_content,
            format,
            attachment.name.replace(/[^a-zA-Z0-9]/g, '_')
        );

        res.json({
            format,
            filename: converted.filename,
            mimeType: converted.mimeType,
            content: converted.content // Base64
        });
    } catch (error) {
        console.error('Preview attachment error:', error);
        res.status(500).json({ error: 'Failed to preview attachment: ' + error.message });
    }
});

/**
 * POST /api/user/attachments/:id/convert
 * Convert and download attachment in specified format
 */
router.post('/:id/convert', async (req, res) => {
    try {
        const { id } = req.params;
        const { format = 'html' } = req.body;

        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const converted = await convertAttachment(
            attachment.html_content,
            format,
            attachment.name.replace(/[^a-zA-Z0-9]/g, '_')
        );

        const buffer = Buffer.from(converted.content, 'base64');

        res.setHeader('Content-Type', converted.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${converted.filename}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Convert attachment error:', error);
        res.status(500).json({ error: 'Failed to convert attachment: ' + error.message });
    }
});

export default router;
