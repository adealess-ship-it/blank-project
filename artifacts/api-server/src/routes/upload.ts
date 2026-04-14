import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";

const UPLOAD_DIR = path.resolve(
  __dirname,
  "../../../../qa_results/uploads",
);

// Ensure upload dir exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".md",
]);

function safeFilename(original: string): string {
  const ext = path.extname(original).toLowerCase() || ".png";
  const base = path.basename(original, path.extname(original))
    .replace(/[^a-zA-Z0-9_\-.\u0E00-\u0E7F]/g, "_")
    .slice(0, 100);
  const name = base || "file";

  let candidate = `${name}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(UPLOAD_DIR, candidate))) {
    candidate = `${name}_${counter}${ext}`;
    counter++;
  }
  return candidate;
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename(_req, file, cb) {
    cb(null, safeFilename(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith("image/") || ext === ".md") {
      cb(null, true);
    } else {
      cb(new Error("Only image and .md files are allowed"));
    }
  },
});

const router = Router();

// Upload file (rate limited)
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: "Too many uploads" } });
router.post(
  "/upload-file",
  uploadLimiter,
  upload.single("file"),
  (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    res.json({
      filename: file.filename,
      path: file.path,
      size: file.size,
    });
  },
);

// List uploaded files
router.get("/uploaded-files", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      res.json([]);
      return;
    }
    const files = fs.readdirSync(UPLOAD_DIR)
      .filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return ALLOWED_EXTS.has(ext);
      })
      .map((f) => {
        const fullPath = path.join(UPLOAD_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
          filename: f,
          path: fullPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete file (requires Authorization header)
router.delete("/uploaded-files/:filename", (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization required" });
    return;
  }
  const filename = path.basename(req.params.filename as string);
  // Extra path traversal protection
  if (filename.includes("..") || filename.includes("\0")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const fullPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  fs.unlinkSync(fullPath);
  res.json({ ok: true });
});

export default router;
