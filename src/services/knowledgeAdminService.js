import crypto from 'node:crypto';
import path from 'node:path';

import {
  db
} from '../config/database.js';

import {
  uploadPdfToActiveFolder,
  moveFileToOldVersions,
  moveFileToActiveFolder,
  renameDriveFile,
  permanentlyDeleteDriveFile,
  trashDriveFile
} from './googleDriveService.js';

import {
  syncKnowledge
} from './knowledgeSyncService.js';

function normalizeDocumentKey(filename = '') {
  return String(filename)
    .trim()
    .toLowerCase();
}

function createChecksum(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
}

function normalizePdfName(value) {
  let cleanName = String(value || '').trim();

  if (!cleanName) {
    const error = new Error('Enter a filename.');
    error.status = 400;
    error.code = 'FILENAME_REQUIRED';
    throw error;
  }

  if (!cleanName.toLowerCase().endsWith('.pdf')) {
    cleanName = `${cleanName}.pdf`;
  }

  return cleanName;
}

function createArchiveFilename({ filename, versionNumber }) {
  const extension = path.extname(filename) || '.pdf';
  const base = path.basename(filename, extension);
  const date = new Date().toISOString().slice(0, 10);
  return `${base}_v${versionNumber}_${date}${extension}`;
}

async function getKnowledgeDocument(documentId) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM knowledge_documents
      WHERE knowledge_document_id = $1
      LIMIT 1
    `,
    [documentId]
  );

  return rows[0] || null;
}

async function getKnowledgeVersion({ documentId, versionId }) {
  const { rows } = await db.query(
    `
      SELECT
        kv.*,
        kd.document_name,
        kd.document_key,
        kd.is_active,
        kd.current_version_number,
        kd.current_drive_file_id
      FROM knowledge_document_versions kv
      JOIN knowledge_documents kd
        ON kd.knowledge_document_id = kv.knowledge_document_id
      WHERE kv.knowledge_document_version_id = $1
        AND kv.knowledge_document_id = $2
      LIMIT 1
    `,
    [versionId, documentId]
  );

  return rows[0] || null;
}

export async function listKnowledgeDocumentsForAdmin() {
  const { rows } = await db.query(
    `
      SELECT
        kd.knowledge_document_id,
        kd.document_key,
        kd.document_name,
        kd.current_version_number,
        kd.current_drive_file_id,
        kd.current_openai_file_id,
        kd.vector_store_id,
        kd.is_active,
        kd.last_checked_at,
        kd.last_synced_at,
        kd.removed_from_source_at,
        kd.created_at,
        kd.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'knowledge_document_version_id', kv.knowledge_document_version_id,
              'version_number', kv.version_number,
              'original_filename', kv.original_filename,
              'archived_filename', kv.archived_filename,
              'source_drive_file_id', kv.source_drive_file_id,
              'archived_drive_file_id', kv.archived_drive_file_id,
              'openai_file_id', kv.openai_file_id,
              'version_status', kv.version_status,
              'drive_status', kv.drive_status,
              'openai_status', kv.openai_status,
              'source_size_bytes', kv.source_size_bytes,
              'source_modified_at', kv.source_modified_at,
              'indexed_at', kv.indexed_at,
              'archived_at', kv.archived_at,
              'retired_at', kv.retired_at,
              'deleted_at', kv.deleted_at,
              'permanently_deleted_at', kv.permanently_deleted_at,
              'failure_message', kv.failure_message,
              'created_at', kv.created_at
            )
            ORDER BY kv.version_number DESC
          ) FILTER (
            WHERE kv.knowledge_document_version_id IS NOT NULL
          ),
          '[]'::json
        ) AS versions
      FROM knowledge_documents kd
      LEFT JOIN knowledge_document_versions kv
        ON kv.knowledge_document_id = kd.knowledge_document_id
      GROUP BY kd.knowledge_document_id
      ORDER BY kd.is_active DESC, kd.document_name ASC
    `
  );

  return rows;
}

export async function listOldKnowledgeVersions() {
  const { rows } = await db.query(
    `
      SELECT
        kv.knowledge_document_version_id,
        kv.knowledge_document_id,
        kv.version_number,
        kv.original_filename,
        kv.archived_filename,
        kv.source_drive_file_id,
        kv.archived_drive_file_id,
        kv.openai_file_id,
        kv.version_status,
        kv.drive_status,
        kv.openai_status,
        kv.archived_at,
        kv.retired_at,
        kv.deleted_at,
        kv.created_at,
        kd.document_name,
        kd.document_key,
        kd.is_active
      FROM knowledge_document_versions kv
      JOIN knowledge_documents kd
        ON kd.knowledge_document_id = kv.knowledge_document_id
      WHERE kv.drive_status = 'archived'
      ORDER BY kd.document_name ASC, kv.version_number DESC
    `
  );

  return rows;
}

export async function uploadKnowledgeDocument({ buffer, filename, mimetype }) {
  if (!buffer?.length) {
    const error = new Error('The uploaded file is empty.');
    error.status = 400;
    error.code = 'EMPTY_FILE';
    throw error;
  }

  if (mimetype !== 'application/pdf') {
    const error = new Error('Only PDF files are accepted.');
    error.status = 400;
    error.code = 'INVALID_FILE_TYPE';
    throw error;
  }

  const cleanFilename = normalizePdfName(filename);
  const documentKey = normalizeDocumentKey(cleanFilename);
  const checksum = createChecksum(buffer);

  const duplicateResult = await db.query(
    `
      SELECT
        kd.knowledge_document_id,
        kd.document_key,
        kd.document_name,
        kv.version_number
      FROM knowledge_document_versions kv
      JOIN knowledge_documents kd
        ON kd.knowledge_document_id = kv.knowledge_document_id
      WHERE kv.source_checksum = $1
        AND kv.version_status = 'active'
        AND kd.is_active = true
      LIMIT 1
    `,
    [checksum]
  );

  const duplicate = duplicateResult.rows[0];

  if (duplicate && duplicate.document_key !== documentKey) {
    const error = new Error(
      `Upload rejected. This PDF has the same content as "${duplicate.document_name}".`
    );
    error.status = 409;
    error.code = 'DUPLICATE_CONTENT';
    throw error;
  }

  if (duplicate && duplicate.document_key === documentKey) {
    const error = new Error(
      `"${cleanFilename}" is already the current version. No new version was created.`
    );
    error.status = 409;
    error.code = 'UNCHANGED_FILE';
    throw error;
  }

  const existingResult = await db.query(
    `
      SELECT *
      FROM knowledge_documents
      WHERE document_key = $1
      LIMIT 1
    `,
    [documentKey]
  );

  const existing = existingResult.rows[0] || null;
  let uploadedDriveFile = null;

  try {
    uploadedDriveFile = await uploadPdfToActiveFolder({
      buffer,
      filename: cleanFilename
    });

    if (existing?.is_active && existing.current_drive_file_id) {
      const archivedName = createArchiveFilename({
        filename: existing.document_name,
        versionNumber: existing.current_version_number
      });

      const archive = await moveFileToOldVersions({
        fileId: existing.current_drive_file_id,
        archivedName
      });

      if (!archive.success) {
        const error = new Error(
          `The new file was uploaded, but the previous version "${existing.document_name}" could not be archived.`
        );
        error.status = 500;
        error.code = 'OLD_VERSION_ARCHIVE_FAILED';
        throw error;
      }
    }

    const syncResult = await syncKnowledge('manual');

    if (syncResult.failed > 0) {
      const error = new Error(
        'The PDF reached Google Drive, but synchronization with PostgreSQL/OpenAI did not fully complete.'
      );
      error.status = 500;
      error.code = 'KNOWLEDGE_SYNC_FAILED';
      error.syncResult = syncResult;
      throw error;
    }

    return {
      file: uploadedDriveFile,
      sync: syncResult,
      replacement: Boolean(existing)
    };
  } catch (error) {
    if (uploadedDriveFile?.id && error.code !== 'KNOWLEDGE_SYNC_FAILED') {
      await trashDriveFile(uploadedDriveFile.id).catch(() => {});
    }
    throw error;
  }
}

export async function deleteKnowledgeDocument(documentId) {
  const doc = await getKnowledgeDocument(documentId);

  if (!doc) {
    const error = new Error('Knowledge document was not found.');
    error.status = 404;
    error.code = 'DOCUMENT_NOT_FOUND';
    throw error;
  }

  if (!doc.is_active) {
    const error = new Error('This document is not active.');
    error.status = 409;
    error.code = 'DOCUMENT_NOT_ACTIVE';
    throw error;
  }

  const { rows } = await db.query(
    `
      SELECT *
      FROM knowledge_document_versions
      WHERE knowledge_document_id = $1
        AND version_status = 'active'
      LIMIT 1
    `,
    [documentId]
  );

  const version = rows[0];

  if (!version) {
    const error = new Error('The active version could not be found.');
    error.status = 409;
    error.code = 'ACTIVE_VERSION_NOT_FOUND';
    throw error;
  }

  const archivedName = createArchiveFilename({
    filename: doc.document_name,
    versionNumber: version.version_number
  });

  const archive = await moveFileToOldVersions({
    fileId: version.source_drive_file_id || doc.current_drive_file_id,
    archivedName
  });

  if (!archive.success) {
    const error = new Error('The active PDF could not be moved to Old Versions.');
    error.status = 500;
    error.code = 'ARCHIVE_FAILED';
    throw error;
  }

  await db.query(
    `
      UPDATE knowledge_document_versions
      SET
        archived_drive_file_id = $2,
        archived_filename = $3,
        drive_status = 'archived',
        archived_at = COALESCE(archived_at, now())
      WHERE knowledge_document_version_id = $1
    `,
    [version.knowledge_document_version_id, archive.file.id, archive.file.name]
  );

  const syncResult = await syncKnowledge('manual');

  return {
    action: 'archived',
    message: 'The active document was moved to Old Versions.',
    sync: syncResult
  };
}

export async function deleteKnowledgeVersion({ documentId, versionId }) {
  const version = await getKnowledgeVersion({ documentId, versionId });

  if (!version) {
    const error = new Error('Knowledge version was not found.');
    error.status = 404;
    error.code = 'VERSION_NOT_FOUND';
    throw error;
  }

  if (
    version.version_status === 'active' &&
    version.drive_status === 'active_folder'
  ) {
    const archiveName = createArchiveFilename({
      filename: version.document_name,
      versionNumber: version.version_number
    });

    const archive = await moveFileToOldVersions({
      fileId: version.source_drive_file_id,
      archivedName: archiveName
    });

    if (!archive.success) {
      const error = new Error('The active PDF could not be moved into Old Versions.');
      error.status = 500;
      error.code = 'ARCHIVE_FAILED';
      throw error;
    }

    await db.query(
      `
        UPDATE knowledge_document_versions
        SET
          archived_drive_file_id = $2,
          archived_filename = $3,
          drive_status = 'archived',
          archived_at = COALESCE(archived_at, now())
        WHERE knowledge_document_version_id = $1
      `,
      [versionId, archive.file.id, archive.file.name]
    );

    const syncResult = await syncKnowledge('manual');

    return {
      action: 'archived',
      message: 'The active document was moved to Old Versions.',
      sync: syncResult
    };
  }

  if (version.drive_status === 'archived') {
    const fileId = version.archived_drive_file_id || version.source_drive_file_id;

    await permanentlyDeleteDriveFile(fileId);

    await db.query(
      `
        UPDATE knowledge_document_versions
        SET
          drive_status = 'permanently_deleted',
          permanently_deleted_at = now()
        WHERE knowledge_document_version_id = $1
      `,
      [versionId]
    );

    return {
      action: 'permanently_deleted',
      message: 'The old version was permanently deleted from Google Drive.'
    };
  }

  const error = new Error('This version cannot be deleted in its current state.');
  error.status = 409;
  error.code = 'INVALID_VERSION_STATE';
  throw error;
}

export async function renameKnowledgeDocument({ documentId, newName }) {
  const cleanName = normalizePdfName(newName);
  const newKey = normalizeDocumentKey(cleanName);
  const doc = await getKnowledgeDocument(documentId);

  if (!doc) {
    const error = new Error('Knowledge document was not found.');
    error.status = 404;
    error.code = 'DOCUMENT_NOT_FOUND';
    throw error;
  }

  if (!doc.is_active) {
    const error = new Error(
      'This logical document is inactive. Rename a specific archived version instead.'
    );
    error.status = 409;
    error.code = 'DOCUMENT_NOT_ACTIVE';
    throw error;
  }

  const duplicateResult = await db.query(
    `
      SELECT knowledge_document_id, document_name
      FROM knowledge_documents
      WHERE document_key = $1
        AND knowledge_document_id <> $2
      LIMIT 1
    `,
    [newKey, documentId]
  );

  if (duplicateResult.rows[0]) {
    const error = new Error(`A knowledge document named "${cleanName}" already exists.`);
    error.status = 409;
    error.code = 'DOCUMENT_NAME_EXISTS';
    throw error;
  }

  if (!doc.current_drive_file_id) {
    const error = new Error('The active Google Drive file ID is missing.');
    error.status = 409;
    error.code = 'ACTIVE_DRIVE_FILE_MISSING';
    throw error;
  }

  await renameDriveFile({
    fileId: doc.current_drive_file_id,
    newName: cleanName
  });

  const { rows } = await db.query(
    `
      UPDATE knowledge_documents
      SET
        document_name = $2,
        document_key = $3
      WHERE knowledge_document_id = $1
      RETURNING *
    `,
    [documentId, cleanName, newKey]
  );

  await db.query(
    `
      UPDATE knowledge_document_versions
      SET original_filename = $2
      WHERE knowledge_document_id = $1
        AND version_status = 'active'
    `,
    [documentId, cleanName]
  );

  return rows[0];
}

export async function renameArchivedKnowledgeVersion({ documentId, versionId, newName }) {
  const cleanName = normalizePdfName(newName);
  const version = await getKnowledgeVersion({ documentId, versionId });

  if (!version) {
    const error = new Error('Knowledge version was not found.');
    error.status = 404;
    error.code = 'VERSION_NOT_FOUND';
    throw error;
  }

  if (version.drive_status !== 'archived') {
    const error = new Error('Only files currently in Old Versions can be renamed with this action.');
    error.status = 409;
    error.code = 'VERSION_NOT_ARCHIVED';
    throw error;
  }

  const fileId = version.archived_drive_file_id || version.source_drive_file_id;
  const renamed = await renameDriveFile({
    fileId,
    newName: cleanName
  });

  const { rows } = await db.query(
    `
      UPDATE knowledge_document_versions
      SET archived_filename = $2
      WHERE knowledge_document_version_id = $1
      RETURNING *
    `,
    [versionId, renamed.name]
  );

  return rows[0];
}

export async function restoreKnowledgeVersion({ documentId, versionId }) {
  const doc = await getKnowledgeDocument(documentId);

  if (!doc) {
    const error = new Error('Knowledge document was not found.');
    error.status = 404;
    error.code = 'DOCUMENT_NOT_FOUND';
    throw error;
  }

  if (doc.is_active) {
    const error = new Error(
      'This document already has an active version. Delete the active version first, then restore the old version.'
    );
    error.status = 409;
    error.code = 'ACTIVE_VERSION_EXISTS';
    throw error;
  }

  const version = await getKnowledgeVersion({ documentId, versionId });

  if (!version) {
    const error = new Error('Knowledge version was not found.');
    error.status = 404;
    error.code = 'VERSION_NOT_FOUND';
    throw error;
  }

  if (version.drive_status !== 'archived') {
    const error = new Error('Only a version that currently exists in Old Versions can be restored.');
    error.status = 409;
    error.code = 'VERSION_NOT_RESTORABLE';
    throw error;
  }

  const fileId = version.archived_drive_file_id || version.source_drive_file_id;

  await moveFileToActiveFolder({
    fileId,
    activeName: doc.document_name
  });

  const syncResult = await syncKnowledge('manual');

  if (syncResult.failed > 0) {
    const error = new Error(
      'The archived file was moved to Active Files, but synchronization with PostgreSQL/OpenAI failed.'
    );
    error.status = 500;
    error.code = 'RESTORE_SYNC_FAILED';
    error.syncResult = syncResult;
    throw error;
  }

  await db.query(
    `
      UPDATE knowledge_document_versions
      SET
        drive_status = 'active_folder',
        version_status = CASE
          WHEN version_status = 'deleted' THEN 'retired'
          ELSE version_status
        END
      WHERE knowledge_document_version_id = $1
    `,
    [version.knowledge_document_version_id]
  );

  return {
    document: await getKnowledgeDocument(documentId),
    sync: syncResult
  };
}

export async function restoreKnowledgeDocument(documentId) {
  const { rows } = await db.query(
    `
      SELECT knowledge_document_version_id
      FROM knowledge_document_versions
      WHERE knowledge_document_id = $1
        AND drive_status = 'archived'
      ORDER BY version_number DESC
      LIMIT 1
    `,
    [documentId]
  );

  const version = rows[0];

  if (!version) {
    const error = new Error('No archived version is available to restore.');
    error.status = 404;
    error.code = 'NO_RESTORABLE_VERSION';
    throw error;
  }

  return restoreKnowledgeVersion({
    documentId,
    versionId: version.knowledge_document_version_id
  });
}
