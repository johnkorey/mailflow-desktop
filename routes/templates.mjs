import { Router } from 'express';
import { emailTemplateDb } from '../database/db.mjs';

const router = Router();

// Get all templates for user
router.get('/', (req, res) => {
    try {
        const templates = emailTemplateDb.findByUserId(req.user.id);
        res.json({ templates });
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// Get single template
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const template = emailTemplateDb.findById(id);

        if (!template || template.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ template });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ error: 'Failed to fetch template' });
    }
});

// Create template
router.post('/', (req, res) => {
    try {
        const { name, description, html_content, tags } = req.body;

        if (!name || !html_content) {
            return res.status(400).json({ error: 'Name and HTML content are required' });
        }

        const template = emailTemplateDb.create({
            user_id: req.user.id,
            name,
            description: description || '',
            html_content,
            tags: tags || ''
        });

        res.json({ message: 'Template saved', template });
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ error: 'Failed to save template' });
    }
});

// Update template
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, html_content, tags, is_active } = req.body;

        const template = emailTemplateDb.findById(id);
        if (!template || template.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (html_content !== undefined) updateData.html_content = html_content;
        if (tags !== undefined) updateData.tags = tags;
        if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;

        emailTemplateDb.update(id, updateData);

        res.json({ message: 'Template updated' });
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

// Delete template
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;

        const template = emailTemplateDb.findById(id);
        if (!template || template.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Template not found' });
        }

        emailTemplateDb.delete(id);

        res.json({ message: 'Template deleted' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

export default router;
