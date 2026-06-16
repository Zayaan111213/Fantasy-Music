import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function createUploader(subdir: string, fieldName: string) {
  const storage = multer.diskStorage({
    destination: path.join(__dirname, '../../../uploads', subdir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        const err = new Error('Only JPEG, PNG, or WebP images are allowed') as Error & { status?: number };
        err.status = 400;
        cb(err);
        return;
      }
      cb(null, true);
    },
  }).single(fieldName);
}

export const uploadAvatar = createUploader('avatars', 'avatar');
export const uploadTeamLogo = createUploader('team-logos', 'logo');
