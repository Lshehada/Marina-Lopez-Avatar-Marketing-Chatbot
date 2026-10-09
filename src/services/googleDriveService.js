import {
  Readable
} from 'node:stream';

import {
  drive
} from '../config/google.js';

import {
  config
} from '../config/index.js';


/*
 * =========================================================
 * LIST ACTIVE KNOWLEDGE PDFS
 * =========================================================
 *
 * GOOGLE_DRIVE_FOLDER_ID must point to:
 *
 * Shared Drive
 *   └── Marina Knowledge
 *       └── Active Files
 *
 * Old Versions is a different folder and is NOT scanned.
 */
export async function listKnowledgePdfs() {
  const result =
    await drive.files.list({
      q: [
        `'${config.GOOGLE_DRIVE_FOLDER_ID}' in parents`,
        `mimeType = 'application/pdf'`,
        'trashed = false'
      ].join(' and '),

      fields:
        'files(id,name,mimeType,modifiedTime,size,parents,trashed)',

      orderBy:
        'modifiedTime asc',

      pageSize:
        1000,

      /*
       * IMPORTANT FOR SHARED DRIVES
       */
      supportsAllDrives:
        true,

      includeItemsFromAllDrives:
        true
    });


  return result.data.files || [];
}


/*
 * =========================================================
 * DOWNLOAD PDF
 * =========================================================
 */
export async function downloadDriveFile(
  fileId
) {
  const response =
    await drive.files.get(
      {
        fileId,

        alt:
          'media',

        /*
         * IMPORTANT FOR SHARED DRIVES
         */
        supportsAllDrives:
          true
      },
      {
        responseType:
          'arraybuffer'
      }
    );


  return Buffer.from(
    response.data
  );
}


/*
 * =========================================================
 * GET FILE METADATA
 * =========================================================
 */
export async function getDriveFile(
  fileId
) {
  try {
    const response =
      await drive.files.get({
        fileId,

        fields:
          'id,name,parents,trashed,modifiedTime,size,mimeType',

        /*
         * IMPORTANT FOR SHARED DRIVES
         */
        supportsAllDrives:
          true
      });


    return response.data;

  } catch (error) {
    if (
      error?.code === 404 ||
      error?.response?.status === 404
    ) {
      return null;
    }


    throw error;
  }
}


/*
 * =========================================================
 * UPLOAD PDF TO ACTIVE FILES
 * =========================================================
 */
export async function uploadPdfToActiveFolder({
  buffer,
  filename
}) {
  console.log(
    'Uploading PDF to Active Files:',
    filename
  );


  const response =
    await drive.files.create({
      requestBody: {
        name:
          filename,

        parents: [
          config
            .GOOGLE_DRIVE_FOLDER_ID
        ]
      },

      media: {
        mimeType:
          'application/pdf',

        body:
          Readable.from(
            buffer
          )
      },

      fields:
        'id,name,mimeType,modifiedTime,size,parents',

      /*
       * IMPORTANT FOR SHARED DRIVES
       */
      supportsAllDrives:
        true
    });


  console.log(
    'Google Drive upload successful:',
    response.data
  );


  return response.data;
}


/*
 * =========================================================
 * MOVE FILE TO OLD VERSIONS
 * =========================================================
 *
 * Used when:
 *
 * - a newer version replaces the current version
 * - admin deletes an active document
 *
 * This does NOT permanently delete the file.
 *
 * Active Files
 *      ↓
 * Old Versions
 */
export async function moveFileToOldVersions({
  fileId,
  archivedName
}) {
  console.log(
    'Moving file to Old Versions:',
    {
      fileId,
      archivedName
    }
  );


  const file =
    await getDriveFile(
      fileId
    );


  if (!file) {
    console.error(
      'Google Drive file not found:',
      fileId
    );


    return {
      success:
        false,

      missing:
        true,

      file:
        null
    };
  }


  const oldVersionsId =
    config
      .GOOGLE_DRIVE_OLD_VERSIONS_FOLDER_ID;


  console.log(
    'Current Drive parents:',
    file.parents
  );


  console.log(
    'Old Versions folder:',
    oldVersionsId
  );


  /*
   * =====================================================
   * FILE ALREADY ARCHIVED
   * =====================================================
   */
  if (
    file.parents?.includes(
      oldVersionsId
    )
  ) {
    const response =
      await drive.files.update({
        fileId,

        requestBody: {
          name:
            archivedName,

          trashed:
            false
        },

        fields:
          'id,name,parents,trashed',

        supportsAllDrives:
          true
      });


    console.log(
      'File already in Old Versions. Rename successful:',
      response.data
    );


    return {
      success:
        true,

      missing:
        false,

      file:
        response.data
    };
  }


  const currentParents =
    file.parents || [];


  /*
   * =====================================================
   * MOVE ACTIVE FILE INTO OLD VERSIONS
   * =====================================================
   */
  const response =
    await drive.files.update({
      fileId,

      addParents:
        oldVersionsId,

      removeParents:
        currentParents.join(','),

      requestBody: {
        name:
          archivedName,

        trashed:
          false
      },

      fields:
        'id,name,parents,trashed',

      supportsAllDrives:
        true
    });


  console.log(
    'Google Drive archive successful:',
    response.data
  );


  return {
    success:
      true,

    missing:
      false,

    file:
      response.data
  };
}


/*
 * =========================================================
 * REMOVE FAILED NEW UPLOAD
 * =========================================================
 *
 * Failed dashboard uploads are moved to Drive Trash.
 */
export async function trashDriveFile(
  fileId
) {
  if (!fileId) {
    return;
  }


  console.log(
    'Moving failed upload to trash:',
    fileId
  );


  await drive.files.update({
    fileId,

    requestBody: {
      trashed:
        true
    },

    fields:
      'id,trashed',

    supportsAllDrives:
      true
  });
}


/*
 * =========================================================
 * RENAME GOOGLE DRIVE FILE
 * =========================================================
 *
 * Works for:
 *
 * - Active Files
 * - Old Versions
 */
export async function renameDriveFile({
  fileId,
  newName
}) {
  console.log(
    'Google Drive rename requested:',
    {
      fileId,
      newName
    }
  );


  const existing =
    await getDriveFile(
      fileId
    );


  if (!existing) {
    const error =
      new Error(
        'The Google Drive file could not be found.'
      );


    error.code =
      'DRIVE_FILE_NOT_FOUND';


    error.status =
      404;


    throw error;
  }


  console.log(
    'Current Google Drive filename:',
    existing.name
  );


  const response =
    await drive.files.update({
      fileId,

      requestBody: {
        name:
          newName
      },

      fields:
        'id,name,parents,trashed',

      supportsAllDrives:
        true
    });


  console.log(
    'Google Drive rename successful:',
    response.data
  );


  return response.data;
}


/*
 * =========================================================
 * RESTORE FILE TO ACTIVE FILES
 * =========================================================
 *
 * Moves an archived PDF from:
 *
 * Old Versions
 *
 * back to:
 *
 * Active Files
 */
export async function moveFileToActiveFolder({
  fileId,
  activeName
}) {
  console.log(
    'Restoring file to Active Files:',
    {
      fileId,
      activeName
    }
  );


  const file =
    await getDriveFile(
      fileId
    );


  if (!file) {
    const error =
      new Error(
        'The archived Google Drive file no longer exists.'
      );


    error.code =
      'ARCHIVED_FILE_NOT_FOUND';


    error.status =
      404;


    throw error;
  }


  const currentParents =
    file.parents ||
    [];


  console.log(
    'Restore current parents:',
    currentParents
  );


  console.log(
    'Active Files folder:',
    config.GOOGLE_DRIVE_FOLDER_ID
  );


  /*
   * Already in Active Files.
   */
  if (
    currentParents.includes(
      config.GOOGLE_DRIVE_FOLDER_ID
    )
  ) {
    const renamed =
      await renameDriveFile({
        fileId,

        newName:
          activeName
      });


    return {
      ...renamed,

      modifiedTime:
        file.modifiedTime,

      size:
        file.size
    };
  }


  /*
   * Move from Old Versions → Active Files.
   */
  const response =
    await drive.files.update({
      fileId,

      addParents:
        config
          .GOOGLE_DRIVE_FOLDER_ID,

      removeParents:
        currentParents.join(','),

      requestBody: {
        name:
          activeName,

        trashed:
          false
      },

      fields:
        'id,name,parents,trashed,modifiedTime,size',

      supportsAllDrives:
        true
    });


  console.log(
    'Google Drive restore successful:',
    response.data
  );


  return response.data;
}

/*
 * =========================================================
 * PERMANENTLY DELETE GOOGLE DRIVE FILE
 * =========================================================
 *
 * IMPORTANT:
 *
 * This does NOT move the file to Trash.
 * The actual Drive file is permanently destroyed.
 *
 * Intended only for files already inside Old Versions.
 */
export async function permanentlyDeleteDriveFile(
  fileId
) {
  if (!fileId) {
    const error =
      new Error(
        'Google Drive file ID is required.'
      );

    error.status =
      400;

    error.code =
      'DRIVE_FILE_ID_REQUIRED';

    throw error;
  }


  console.log(
    'Permanent Drive deletion requested:',
    fileId
  );


  try {
    await drive.files.delete({
      fileId,

      supportsAllDrives:
        true
    });


    console.log(
      'Google Drive file permanently deleted:',
      fileId
    );


    return {
      success:
        true
    };

  } catch (error) {
    if (
      error?.code === 404 ||
      error?.response?.status === 404
    ) {
      /*
       * File is already gone.
       *
       * Treat that as effectively deleted.
       */
      return {
        success:
          true,

        alreadyMissing:
          true
      };
    }


    throw error;
  }
}