import crypto from 'node:crypto';

import path from 'node:path';

import {
  toFile
} from 'openai';

import {
  db
} from '../config/database.js';

import {
  config
} from '../config/index.js';

import {
  openai
} from '../config/openai.js';

import {
  listKnowledgePdfs,
  downloadDriveFile,
  moveFileToOldVersions
} from './googleDriveService.js';


const knowledgeCategoryByFilename = {
  'client_info.pdf': 'client',

  'game_info.pdf': 'game',

  'enerwhizzoverview.pdf': 'overview',

  'technical_details_and_data_privacy.pdf': 'technical_privacy'
};

function getKnowledgeCategory(
  filename
) {
  const normalizedFilename =
    normalizeDocumentKey(filename);

  const category =
    knowledgeCategoryByFilename[
      normalizedFilename
    ];

  if (!category) {
    throw new Error(
      `No knowledge category is configured for "${filename}".`
    );
  }

  return category;
}

function normalizeDocumentKey(
  filename = ''
) {
  return String(filename)
    .trim()
    .toLowerCase();
}


function createChecksum(
  buffer
) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
}


function createArchivedFilename({
  filename,
  versionNumber
}) {
  const extension =
    path.extname(filename) ||
    '.pdf';

  const base =
    path.basename(
      filename,
      extension
    );

  const date =
    new Date()
      .toISOString()
      .slice(0, 10);

  return (
    `${base}_v${versionNumber}_${date}${extension}`
  );
}


async function getDocument(
  documentKey
) {
  const {
    rows
  } =
    await db.query(
      `
        SELECT *
        FROM knowledge_documents
        WHERE document_key = $1
        LIMIT 1
      `,
      [
        documentKey
      ]
    );

  return rows[0] || null;
}


async function getActiveVersion(
  documentId
) {
  const {
    rows
  } =
    await db.query(
      `
        SELECT *
        FROM knowledge_document_versions

        WHERE knowledge_document_id = $1
          AND version_status = 'active'

        LIMIT 1
      `,
      [
        documentId
      ]
    );

  return rows[0] || null;
}


/*
 * =========================================================
 * FIND DUPLICATE ACTIVE CONTENT
 * =========================================================
 *
 * Checks whether an ACTIVE document already exists with
 * exactly the same SHA-256 checksum.
 *
 * Example:
 *
 * ProductGuide.pdf
 * checksum = ABC
 *
 * AnotherGuide.pdf
 * checksum = ABC
 *
 * Same contents, different filename.
 */
async function findActiveDocumentByChecksum(
  checksum
) {
  const {
    rows
  } =
    await db.query(
      `
        SELECT
          kd.knowledge_document_id,
          kd.document_name,

          kv.knowledge_document_version_id,
          kv.version_number,
          kv.source_checksum

        FROM knowledge_document_versions kv

        JOIN knowledge_documents kd
          ON kd.knowledge_document_id =
             kv.knowledge_document_id

        WHERE
          kv.source_checksum = $1

          AND kv.version_status =
            'active'

          AND kd.is_active =
            true

        LIMIT 1
      `,
      [
        checksum
      ]
    );

  return rows[0] || null;
}


async function uploadToOpenAI({
  buffer,
  filename,
  category
}) {
  const openaiFile =
    await openai.files.create({
      file: await toFile(
        buffer,
        filename,
        {
          type: 'application/pdf'
        }
      ),

      purpose: 'assistants'
    });

  try {
    const vectorStoreFile =
      await openai.vectorStores.files.createAndPoll(
        config.OPENAI_VECTOR_STORE_ID,
        {
          file_id: openaiFile.id,

          attributes: {
            category
          }
        }
      );

    if (
      vectorStoreFile.status !== 'completed'
    ) {
      throw new Error(
        vectorStoreFile.last_error?.message ||
        `OpenAI could not index "${filename}".`
      );
    }

    return openaiFile;

  } catch (error) {
    await openai.files.delete(
      openaiFile.id
    ).catch(() => {});

    throw error;
  }
}

async function removeFromOpenAI(
  openaiFileId
) {
  if (!openaiFileId) {
    return;
  }


  try {
    await openai.vectorStores
      .files
      .delete(
        openaiFileId,
        {
          vector_store_id:
            config
              .OPENAI_VECTOR_STORE_ID
        }
      );

  } catch (error) {
    if (
      error?.status !== 404
    ) {
      console.error(
        'Could not remove vector store file:',
        error
      );
    }
  }


  try {
    await openai.files.delete(
      openaiFileId
    );

  } catch (error) {
    if (
      error?.status !== 404
    ) {
      console.error(
        'Could not delete OpenAI file:',
        error
      );
    }
  }
}


async function createFirstVersion({
  file,
  checksum,
  buffer,
  uploaded
}) {
  const client =
    await db.connect();


  try {
    await client.query(
      'BEGIN'
    );


    const key =
      normalizeDocumentKey(
        file.name
      );


    const documentResult =
      await client.query(
        `
          INSERT INTO knowledge_documents (
            document_key,
            document_name,
            current_version_number,
            current_drive_file_id,
            current_openai_file_id,
            vector_store_id,
            is_active,
            last_checked_at,
            last_synced_at
          )

          VALUES (
            $1,
            $2,
            1,
            $3,
            $4,
            $5,
            true,
            now(),
            now()
          )

          RETURNING *
        `,
        [
          key,
          file.name,
          file.id,
          uploaded.id,
          config
            .OPENAI_VECTOR_STORE_ID
        ]
      );


    const document =
      documentResult.rows[0];


    await client.query(
      `
        INSERT INTO
          knowledge_document_versions (
            knowledge_document_id,
            version_number,
            source_drive_file_id,
            original_filename,
            source_checksum,
            source_size_bytes,
            source_modified_at,
            openai_file_id,
            vector_store_id,
            version_status,
            drive_status,
            openai_status,
            indexed_at
          )

        VALUES (
          $1,
          1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          'active',
          'active_folder',
          'active',
          now()
        )
      `,
      [
        document
          .knowledge_document_id,

        file.id,

        file.name,

        checksum,

        Number(
          file.size ||
          buffer.length
        ),

        file.modifiedTime,

        uploaded.id,

        config
          .OPENAI_VECTOR_STORE_ID
      ]
    );


    await client.query(
      'COMMIT'
    );


    return document;

  } catch (error) {
    await client.query(
      'ROLLBACK'
    );

    throw error;

  } finally {
    client.release();
  }
}


async function createNewVersion({
  document,
  activeVersion,
  file,
  checksum,
  buffer,
  uploaded
}) {
  const client =
    await db.connect();


  let newVersion;


  try {
    await client.query(
      'BEGIN'
    );


    /*
     * =====================================================
     * CORRECT VERSION NUMBER
     * =====================================================
     *
     * Always derive the number from version history.
     */
    const versionNumberResult =
      await client.query(
        `
          SELECT
            COALESCE(
              MAX(version_number),
              0
            ) + 1 AS next_version

          FROM knowledge_document_versions

          WHERE knowledge_document_id =
            $1
        `,
        [
          document
            .knowledge_document_id
        ]
      );


    const nextVersion =
      Number(
        versionNumberResult
          .rows[0]
          .next_version
      );


    /*
     * Retire old active version.
     */
    if (activeVersion) {
      await client.query(
        `
          UPDATE knowledge_document_versions

          SET
            version_status =
              'retired',

            retired_reason =
              'replaced_by_newer_version',

            retired_at =
              now()

          WHERE
            knowledge_document_version_id =
              $1
        `,
        [
          activeVersion
            .knowledge_document_version_id
        ]
      );
    }


    /*
     * Create the new version.
     */
    const versionResult =
      await client.query(
        `
          INSERT INTO
            knowledge_document_versions (
              knowledge_document_id,
              version_number,
              source_drive_file_id,
              original_filename,
              source_checksum,
              source_size_bytes,
              source_modified_at,
              openai_file_id,
              vector_store_id,
              version_status,
              drive_status,
              openai_status,
              indexed_at
            )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            'active',
            'active_folder',
            'active',
            now()
          )

          RETURNING *
        `,
        [
          document
            .knowledge_document_id,

          nextVersion,

          file.id,

          file.name,

          checksum,

          Number(
            file.size ||
            buffer.length
          ),

          file.modifiedTime,

          uploaded.id,

          config
            .OPENAI_VECTOR_STORE_ID
        ]
      );


    newVersion =
      versionResult.rows[0];


    /*
     * Update logical document pointer.
     */
    await client.query(
      `
        UPDATE knowledge_documents

        SET
          document_name =
            $2,

          current_version_number =
            $3,

          current_drive_file_id =
            $4,

          current_openai_file_id =
            $5,

          vector_store_id =
            $6,

          is_active =
            true,

          removed_from_source_at =
            NULL,

          last_checked_at =
            now(),

          last_synced_at =
            now()

        WHERE knowledge_document_id =
          $1
      `,
      [
        document
          .knowledge_document_id,

        file.name,

        nextVersion,

        file.id,

        uploaded.id,

        config
          .OPENAI_VECTOR_STORE_ID
      ]
    );


    await client.query(
      'COMMIT'
    );

  } catch (error) {
    await client.query(
      'ROLLBACK'
    );

    throw error;

  } finally {
    client.release();
  }


  /*
   * Keep the rest of your existing function:
   *
   * - remove previous OpenAI file
   * - archive old Drive version
   * - update old-version statuses
   */


  return newVersion;
}


async function markDeleted(
  document
) {
  const activeVersion =
    await getActiveVersion(
      document
        .knowledge_document_id
    );


  /*
   * Remove current version from OpenAI.
   */
  if (
    activeVersion
      ?.openai_file_id
  ) {
    await removeFromOpenAI(
      activeVersion
        .openai_file_id
    );
  }


  const client =
    await db.connect();


  try {
    await client.query(
      'BEGIN'
    );


    await client.query(
      `
        UPDATE knowledge_documents

        SET
          is_active =
            false,

          removed_from_source_at =
            now(),

          last_checked_at =
            now()

        WHERE knowledge_document_id =
          $1
      `,
      [
        document
          .knowledge_document_id
      ]
    );


    if (activeVersion) {
      await client.query(
        `
          UPDATE knowledge_document_versions

          SET
            version_status =
              'deleted',

            retired_reason =
              'removed_from_source',

            deleted_at =
              now(),

            retired_at =
              COALESCE(
                retired_at,
                now()
              ),

            openai_status =
              'removed',

            removed_from_openai_at =
              now()

          WHERE
            knowledge_document_version_id =
              $1
        `,
        [
          activeVersion
            .knowledge_document_version_id
        ]
      );
    }


    await client.query(
      'COMMIT'
    );


  } catch (error) {
    await client.query(
      'ROLLBACK'
    );

    throw error;

  } finally {
    client.release();
  }
}


export async function syncKnowledge(
  triggerType = 'manual'
) {
  const counts = {
    discovered:
      0,

    created:
      0,

    updated:
      0,

    unchanged:
      0,

    duplicates:
      0,

    deleted:
      0,

    failed:
      0
  };


  const files =
    await listKnowledgePdfs();


  counts.discovered =
    files.length;


  /*
   * We identify logical documents by filename,
   * NOT by Google Drive file ID.
   */
  const seenDocumentKeys =
    new Set();


  for (
    const file
    of files
  ) {
    const documentKey =
      normalizeDocumentKey(
        file.name
      );

    const category =
      getKnowledgeCategory(
         file.name
      );


    seenDocumentKeys.add(
      documentKey
    );


    try {

      /*
       * =====================================================
       * 1. DOWNLOAD CURRENT PDF FROM ACTIVE FILES
       * =====================================================
       */
      const buffer =
        await downloadDriveFile(
          file.id
        );


      /*
       * =====================================================
       * 2. CREATE SHA-256 CHECKSUM
       * =====================================================
       */
      const checksum =
        createChecksum(
          buffer
        );


      /*
       * =====================================================
       * 3. DUPLICATE CONTENT CHECK
       * =====================================================
       *
       * Reject when:
       *
       * - another ACTIVE document already has exactly
       *   the same PDF contents
       *
       * AND
       *
       * - that document has a different logical filename
       *
       *
       * Example:
       *
       * ProductGuide.pdf
       * checksum = ABC
       *
       * CopyProductGuide.pdf
       * checksum = ABC
       *
       * → duplicate content
       *
       * This prevents uploading the same knowledge twice
       * to OpenAI under different names.
       */
      const sameContent =
        await findActiveDocumentByChecksum(
          checksum
        );


      if (
        sameContent &&
        normalizeDocumentKey(
          sameContent.document_name
        ) !==
        normalizeDocumentKey(
          file.name
        )
      ) {
        const error =
          new Error(
            `This PDF has the same content as "${sameContent.document_name}".`
          );


        error.code =
          'DUPLICATE_CONTENT';


        error.status =
          409;


        throw error;
      }


      /*
       * =====================================================
       * 4. FIND LOGICAL DOCUMENT BY FILENAME
       * =====================================================
       */
      const document =
        await getDocument(
          documentKey
        );


      /*
       * =====================================================
       * 5. NEW DOCUMENT
       * =====================================================
       */
      if (!document) {
        const uploaded =
          await uploadToOpenAI({
            buffer,

            filename:
              file.name,

            category
          });


        await createFirstVersion({
          file,
          checksum,
          buffer,
          uploaded
        });


        counts.created +=
          1;


        continue;
      }


      const activeVersion =
        await getActiveVersion(
          document
            .knowledge_document_id
        );


      /*
 * =====================================================
 * SAME DOCUMENT + SAME CONTENT
 * =====================================================
 *
 * No content change.
 *
 * Therefore:
 *
 * - do NOT create another version
 * - do NOT upload another OpenAI file
 *
 * But if Google Drive created a new file ID,
 * update the DB reference.
 */
      if (
        activeVersion &&
        activeVersion
          .source_checksum ===
        checksum
      ) {

        /*
         * Same contents but Google Drive physical file
         * changed because the file was re-uploaded.
         */
        if (
          activeVersion
            .source_drive_file_id !==
          file.id
        ) {

          await db.query(
            `
        UPDATE knowledge_documents

        SET
          current_drive_file_id =
            $2,

          last_checked_at =
            now()

        WHERE knowledge_document_id =
          $1
      `,
            [
              document
                .knowledge_document_id,

              file.id
            ]
          );


          await db.query(
            `
        UPDATE knowledge_document_versions

        SET
          source_drive_file_id =
            $2,

          source_modified_at =
            $3,

          source_size_bytes =
            $4,

          drive_status =
            'active_folder'

        WHERE knowledge_document_version_id =
          $1
      `,
            [
              activeVersion
                .knowledge_document_version_id,

              file.id,

              file.modifiedTime,

              Number(
                file.size ||
                buffer.length
              )
            ]
          );
        }


        /*
         * Record that the file was checked.
         */
        await db.query(
          `
      UPDATE knowledge_documents

      SET
        last_checked_at =
          now()

      WHERE knowledge_document_id =
        $1
    `,
          [
            document
              .knowledge_document_id
          ]
        );


        counts.unchanged +=
          1;


        continue;
      }


      /*
       * =====================================================
       * 7. SAME DOCUMENT + DIFFERENT CONTENT
       * =====================================================
       *
       * This is a NEW VERSION.
       */
      const uploaded =
        await uploadToOpenAI({
          buffer,

          filename:
            file.name,
          
          category
        });


      try {
        await createNewVersion({
          document,
          activeVersion,
          file,
          checksum,
          buffer,
          uploaded
        });

      } catch (error) {

        /*
         * New OpenAI file exists, but DB/version switching
         * failed. Remove the new OpenAI file so it does not
         * become an orphan searchable file.
         */
        await removeFromOpenAI(
          uploaded.id
        );


        throw error;
      }


      counts.updated +=
        1;


    } catch (error) {

      /*
       * =====================================================
       * DUPLICATE CONTENT ERROR
       * =====================================================
       *
       * This is useful for manual Google Drive uploads.
       *
       * It will appear in the server logs.
       *
       * If you upload through your website API instead,
       * the controller should return this same message
       * directly to the user.
       */
      if (
        error.code ===
        'DUPLICATE_CONTENT'
      ) {
        counts.duplicates +=
          1;


        console.error(
          `Duplicate PDF rejected: ${file.name}. ${error.message}`
        );


        continue;
      }


      /*
       * Any other synchronization failure.
       */
      counts.failed +=
        1;


      console.error(
        'Knowledge sync failed:',
        file.name,
        error
      );
    }
  }


  /*
   * =========================================================
   * TRUE DELETIONS
   * =========================================================
   *
   * A document is active in SQL but its logical filename
   * no longer exists in Active Files.
   */
  const {
    rows:
    activeDocuments
  } =
    await db.query(
      `
        SELECT *
        FROM knowledge_documents
        WHERE is_active = true
      `
    );


  for (
    const document
    of activeDocuments
  ) {
    if (
      seenDocumentKeys.has(
        document.document_key
      )
    ) {
      continue;
    }


    try {
      await markDeleted(
        document
      );


      counts.deleted +=
        1;


    } catch (error) {
      counts.failed +=
        1;


      console.error(
        'Deleted document handling failed:',
        document.document_name,
        error
      );
    }
  }


  console.log(
    `Knowledge sync (${triggerType}):`,
    counts
  );


  return counts;
}