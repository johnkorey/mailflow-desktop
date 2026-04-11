import { Router } from 'express';
import { authenticate } from '../middleware/auth.mjs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Create uploads directory if it doesn't exist
const uploadsDir = process.env.MAILFLOW_USER_DATA
    ? path.join(process.env.MAILFLOW_USER_DATA, 'uploads', 'templates')
    : path.join(__dirname, '..', 'public', 'uploads', 'templates');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'template-' + uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP, SVG)'));
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

router.use(authenticate);

router.post('/template-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }

        const imageUrl = `/uploads/templates/${req.file.filename}`;

        res.json({
            success: true,
            url: imageUrl,
            filename: req.file.filename,
            size: req.file.size,
            message: 'Image uploaded successfully'
        });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

router.delete('/template-image/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        if (!/^[\w-]+\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.join(uploadsDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        fs.unlinkSync(filePath);

        res.json({ success: true, message: 'Image deleted successfully' });
    } catch (error) {
        console.error('Image delete error:', error);
        res.status(500).json({ error: 'Failed to delete image' });
    }
});

export default router;
