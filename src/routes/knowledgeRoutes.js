import express, {
  Router
} from 'express';

import multer
  from 'multer';

import {
  runKnowledgeSync,
  listKnowledgeDocuments,
  listOldKnowledgeVersionsController,
  uploadKnowledgePdf,
  removeKnowledgeDocument,
  deleteKnowledgeVersionController,
  renameKnowledgeDocumentController,
  renameArchivedKnowledgeVersionController,
  restoreKnowledgeDocumentController,
  restoreKnowledgeVersionController
} from '../controllers/knowledgeController.js';

import {
  asyncHandler
} from '../middleware/validate.js';

import {
  requireAdminKey
} from '../middleware/adminAuth.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  },
  fileFilter(_req, file, callback) {
    if (file.mimetype !== 'application/pdf') {
      const error = new Error('Only PDF files are accepted.');
      error.code = 'INVALID_FILE_TYPE';
      return callback(error);
    }

    callback(null, true);
  }
});

function receivePdf(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: 'The PDF is too large. Maximum size is 25 MB.'
      });
    }

    return res.status(400).json({
      success: false,
      code: error.code || 'UPLOAD_ERROR',
      message: error.message || 'The PDF could not be uploaded.'
    });
  });
}

router.get(
  '/admin/documents',
  requireAdminKey,
  asyncHandler(listKnowledgeDocuments)
);

router.get(
  '/admin/old-versions',
  requireAdminKey,
  asyncHandler(listOldKnowledgeVersionsController)
);

router.post(
  '/admin/upload',
  requireAdminKey,
  receivePdf,
  asyncHandler(uploadKnowledgePdf)
);

router.patch(
  '/admin/documents/:documentId/rename',
  requireAdminKey,
  express.json(),
  asyncHandler(renameKnowledgeDocumentController)
);

router.delete(
  '/admin/documents/:documentId',
  requireAdminKey,
  asyncHandler(removeKnowledgeDocument)
);

router.patch(
  '/admin/documents/:documentId/versions/:versionId/rename',
  requireAdminKey,
  express.json(),
  asyncHandler(renameArchivedKnowledgeVersionController)
);

router.post(
  '/admin/documents/:documentId/versions/:versionId/restore',
  requireAdminKey,
  asyncHandler(restoreKnowledgeVersionController)
);

router.delete(
  '/admin/documents/:documentId/versions/:versionId',
  requireAdminKey,
  asyncHandler(deleteKnowledgeVersionController)
);

/* Backward-compatible restore route. */
router.post(
  '/admin/documents/:documentId/restore',
  requireAdminKey,
  asyncHandler(restoreKnowledgeDocumentController)
);

router.post(
  '/sync',
  requireAdminKey,
  asyncHandler(runKnowledgeSync)
);

export default router;
