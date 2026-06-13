import multer from "multer";
import fs from 'fs';
import { promises as fsPromises } from 'fs';

// Configuration multer
export const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
   
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `cv-${uniqueSuffix}.pdf`);
  }
});

export const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});