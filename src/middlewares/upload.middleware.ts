import multer from 'multer';

const allowedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
]);

export const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_req, file, callback) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
            return callback(
                new Error('Formato inválido. Envie JPG, PNG ou WEBP.'),
            );
        }

        return callback(null, true);
    },
});