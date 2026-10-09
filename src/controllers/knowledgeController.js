import {
  syncKnowledge
} from '../services/knowledgeSyncService.js';

import {
  listKnowledgeDocumentsForAdmin,
  listOldKnowledgeVersions,
  uploadKnowledgeDocument,
  deleteKnowledgeDocument,
  deleteKnowledgeVersion,
  renameKnowledgeDocument,
  renameArchivedKnowledgeVersion,
  restoreKnowledgeDocument,
  restoreKnowledgeVersion
} from '../services/knowledgeAdminService.js';

export async function runKnowledgeSync(_req, res) {
  const result = await syncKnowledge('manual');
  return res.json({ success: true, ...result });
}

export async function listKnowledgeDocuments(_req, res) {
  const documents = await listKnowledgeDocumentsForAdmin();
  return res.json({ success: true, documents });
}

export async function listOldKnowledgeVersionsController(_req, res) {
  const versions = await listOldKnowledgeVersions();
  return res.json({ success: true, versions });
}

export async function uploadKnowledgePdf(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      code: 'FILE_REQUIRED',
      message: 'Please select a PDF file.'
    });
  }

  try {
    const result = await uploadKnowledgeDocument({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype
    });

    return res.status(201).json({
      success: true,
      message: result.replacement
        ? 'The new PDF version was uploaded successfully. The previous version was archived.'
        : 'The PDF was uploaded successfully.',
      ...result
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'UPLOAD_FAILED',
      message: error.message || 'The file could not be uploaded.',
      sync: error.syncResult || undefined
    });
  }
}

export async function removeKnowledgeDocument(req, res) {
  try {
    const result = await deleteKnowledgeDocument(req.params.documentId);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'DELETE_FAILED',
      message: error.message || 'The document could not be deleted.'
    });
  }
}

export async function deleteKnowledgeVersionController(req, res) {
  try {
    const result = await deleteKnowledgeVersion({
      documentId: req.params.documentId,
      versionId: req.params.versionId
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'VERSION_DELETE_FAILED',
      message: error.message || 'The version could not be deleted.'
    });
  }
}

export async function renameKnowledgeDocumentController(req, res) {
  try {
    const doc = await renameKnowledgeDocument({
      documentId: req.params.documentId,
      newName: req.body?.name
    });

    return res.json({
      success: true,
      message: `Document renamed to "${doc.document_name}".`,
      document: doc
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'RENAME_FAILED',
      message: error.message || 'The document could not be renamed.'
    });
  }
}

export async function renameArchivedKnowledgeVersionController(req, res) {
  try {
    const version = await renameArchivedKnowledgeVersion({
      documentId: req.params.documentId,
      versionId: req.params.versionId,
      newName: req.body?.name
    });

    return res.json({
      success: true,
      message: `Old version renamed to "${version.archived_filename}".`,
      version
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'VERSION_RENAME_FAILED',
      message: error.message || 'The old version could not be renamed.'
    });
  }
}

export async function restoreKnowledgeDocumentController(req, res) {
  try {
    const result = await restoreKnowledgeDocument(req.params.documentId);
    return res.json({
      success: true,
      message: 'The document was restored successfully.',
      ...result
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'RESTORE_FAILED',
      message: error.message || 'The document could not be restored.'
    });
  }
}

export async function restoreKnowledgeVersionController(req, res) {
  try {
    const result = await restoreKnowledgeVersion({
      documentId: req.params.documentId,
      versionId: req.params.versionId
    });

    return res.json({
      success: true,
      message: 'The selected old version was restored successfully.',
      ...result
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'VERSION_RESTORE_FAILED',
      message: error.message || 'The old version could not be restored.'
    });
  }
}
