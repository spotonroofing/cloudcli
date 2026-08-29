import express from 'express';
import multer from 'multer';

import {
  buildStoredAttachmentRecords,
  buildStoredImageRecords,
  ensureImageAssetsDir,
  isAllowedImageMimeType,
  openStoredAttachmentAsset,
} from '@/modules/assets/services/image-assets.service.js';
import { openLocalFile, resolveLocalFile } from '@/modules/assets/services/local-files.service.js';
import { projectsDb } from '@/modules/database/index.js';

const router = express.Router();

// Multer writes uploads straight into the global assets folder; the service
// owns the folder location and the response record shape.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureImageAssetsDir()
      .then((assetsDir) => cb(null, assetsDir))
      .catch((error) => cb(error as Error, ''));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

const attachmentUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

/**
 * Stores chat image attachments in the global runtime assets folder and
 * returns their absolute paths for use in provider prompts and chat history.
 */
router.post('/images', (req, res) => {
  upload.array('images', 5)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    res.json({ images: buildStoredImageRecords(files) });
  });
});

/**
 * Stores provider-neutral chat attachments. Files of any MIME type are
 * accepted because providers inspect them as data through their file-reading
 * tools; uploads are capped at 10 files and 10MB per file.
 */
router.post('/files', (req, res) => {
  attachmentUpload.array('files', 10)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    res.json({ attachments: buildStoredAttachmentRecords(files) });
  });
});

/**
 * Serves one stored image asset by filename. Only files directly inside the
 * global assets folder are reachable; traversal attempts resolve to null.
 */
router.get('/images/:filename', async (req, res) => {
  const asset = await openStoredAttachmentAsset(req.params.filename);
  if (asset.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }
  if (asset.status === 'missing') {
    return res.status(404).json({ error: 'Asset not found' });
  }

  res.setHeader('Content-Type', asset.contentType);
  // Stored-XSS hardening: never let the browser sniff a different type, and
  // force SVGs (which can carry scripts when rendered as a document) to
  // download instead of rendering inline. The chat UI is unaffected — it
  // fetches assets as blobs and shows them through <img>, where SVG scripts
  // never execute.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (asset.contentType === 'image/svg+xml') {
    res.setHeader('Content-Disposition', 'attachment');
  }
  asset.stream.pipe(res);
  asset.stream.on('error', (error) => {
    console.error('Error streaming image asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

/**
 * Downloads one stored non-image attachment. Content-Disposition prevents
 * uploaded HTML or other active formats from rendering in the application.
 */
router.get('/files/:filename', async (req, res) => {
  const asset = await openStoredAttachmentAsset(req.params.filename);
  if (asset.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }
  if (asset.status === 'missing') {
    return res.status(404).json({ error: 'Asset not found' });
  }

  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace(/["\r\n]/g, '_')}"`);
  asset.stream.pipe(res);
  asset.stream.on('error', (error) => {
    console.error('Error streaming attachment asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

/** The project root a local-file request resolves relative paths against. */
const readProjectRoot = (projectId: unknown): string | null =>
  typeof projectId === 'string' && projectId.trim()
    ? projectsDb.getProjectPathById(projectId)
    : null;

/**
 * Describes one file a session presented in chat by path, so the transcript can
 * draw the shared attachment card (name, size, kind) before opening anything.
 * Read-only, and only inside the project workspace or the planner memory repo.
 */
router.get('/local-file', async (req, res) => {
  const lookup = await resolveLocalFile(String(req.query.path ?? ''), readProjectRoot(req.query.projectId));
  if (lookup.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  if (lookup.status === 'missing') {
    return res.status(404).json({ error: 'File not found' });
  }

  res.json({
    name: lookup.name,
    size: lookup.size,
    mimeType: lookup.mimeType,
    kind: lookup.kind,
    path: lookup.absolutePath,
  });
});

/**
 * Streams a presented file's bytes for the viewer and its download control.
 * Same containment as the describe route; `download=1` forces the save dialog.
 */
router.get('/local-file/content', async (req, res) => {
  const lookup = await resolveLocalFile(String(req.query.path ?? ''), readProjectRoot(req.query.projectId));
  if (lookup.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  if (lookup.status === 'missing') {
    return res.status(404).json({ error: 'File not found' });
  }

  const download = req.query.download === '1';
  res.setHeader('Content-Type', lookup.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Same stored-XSS hardening as the asset routes: an SVG rendered as a
  // document can carry scripts, so it only ever leaves as a download.
  const disposition = download || lookup.mimeType === 'image/svg+xml' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${lookup.name.replace(/["\r\n]/g, '_')}"`);

  const stream = openLocalFile(lookup.absolutePath);
  stream.pipe(res);
  stream.on('error', (error) => {
    console.error('Error streaming local file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading file' });
    }
  });
});

export default router;
