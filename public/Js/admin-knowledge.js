const authCard = document.querySelector('#auth-card');
const adminKeyInput = document.querySelector('#admin-key');
const connectButton = document.querySelector('#connect-button');
const dashboard = document.querySelector('#dashboard');
const statusMessage = document.querySelector('#status-message');
const documentsBody = document.querySelector('#documents-body');
const activeCount = document.querySelector('#active-count');
const oldVersionsCount = document.querySelector('#old-versions-count');
const versionCount = document.querySelector('#version-count');
const uploadForm = document.querySelector('#upload-form');
const uploadButton = document.querySelector('#upload-button');
const fileInput = document.querySelector('#file-input');
const selectedFile = document.querySelector('#selected-file');
const dropZone = document.querySelector('#drop-zone');
const refreshButton = document.querySelector('#refresh-button');
const syncButton = document.querySelector('#sync-button');
const activeFilterButton = document.querySelector('#active-filter');
const oldVersionsFilterButton = document.querySelector('#old-versions-filter');
const allFilterButton = document.querySelector('#all-filter');
const tableTitle = document.querySelector('#table-title');
const tableHint = document.querySelector('#table-hint');

let adminKey = sessionStorage.getItem('marina_admin_key') || '';
let currentFile = null;
let allDocuments = [];
let oldVersions = [];
let currentFilter = 'active';

function showStatus(message, type = 'info') {
  statusMessage.hidden = false;
  statusMessage.className = `status ${type}`;
  statusMessage.textContent = String(message || '');
}

function hideStatus() {
  statusMessage.hidden = true;
  statusMessage.textContent = '';
}

async function adminApi(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-admin-key', adminKey);

  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    const error = new Error(data.message || 'Request failed.');
    error.status = response.status;
    error.code = data.code;
    throw error;
  }

  return data;
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

function statusBadge(value) {
  const safe = String(value || 'unknown');
  const span = document.createElement('span');
  span.className = `badge ${safe}`;
  span.textContent = safe;
  return span;
}

function createButton({ label, className, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function loadDocuments() {
  const [documentsResult, oldResult] = await Promise.all([
    adminApi('/api/knowledge/admin/documents'),
    adminApi('/api/knowledge/admin/old-versions')
  ]);

  allDocuments = documentsResult.documents || [];
  oldVersions = oldResult.versions || [];
  updateDashboardCounts();
  applyCurrentFilter();

  return { documents: allDocuments, oldVersions };
}

function updateDashboardCounts() {
  const activeDocuments = allDocuments.filter((doc) => doc.is_active);
  const totalVersions = allDocuments.reduce(
    (total, doc) => total + (doc.versions?.length || 0),
    0
  );

  activeCount.textContent = String(activeDocuments.length);
  oldVersionsCount.textContent = String(oldVersions.length);
  versionCount.textContent = String(totalVersions);
}

function updateFilterButtons() {
  for (const button of [activeFilterButton, oldVersionsFilterButton, allFilterButton]) {
    button?.classList.remove('active-filter');
  }

  if (currentFilter === 'active') {
    activeFilterButton?.classList.add('active-filter');
  } else if (currentFilter === 'old') {
    oldVersionsFilterButton?.classList.add('active-filter');
  } else {
    allFilterButton?.classList.add('active-filter');
  }
}

function applyCurrentFilter() {
  updateFilterButtons();

  if (currentFilter === 'active') {
    if (tableTitle) tableTitle.textContent = 'Active documents';
    if (tableHint) tableHint.textContent = 'Only active files are searchable by Marina.';
    renderActiveDocuments(allDocuments.filter((doc) => doc.is_active));
    return;
  }

  if (currentFilter === 'old') {
    if (tableTitle) tableTitle.textContent = 'Old Versions';
    if (tableHint) tableHint.textContent = 'These are physical PDFs currently stored in the Old Versions folder.';
    renderOldVersions(oldVersions);
    return;
  }

  if (tableTitle) tableTitle.textContent = 'All versions';
  if (tableHint) tableHint.textContent = 'Shows active, archived and permanently deleted version history.';
  renderAllVersions(allDocuments);
}

function renderEmptyRow(message) {
  documentsBody.innerHTML = '';
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 7;
  cell.textContent = message;
  row.appendChild(cell);
  documentsBody.appendChild(row);
}

function buildCommonRow({ name, key, versionNumber, status, driveStatus, openaiStatus, activityDate }) {
  const row = document.createElement('tr');
  const nameCell = document.createElement('td');
  const nameEl = document.createElement('span');
  const keyEl = document.createElement('span');
  const versionCell = document.createElement('td');
  const statusCell = document.createElement('td');
  const driveCell = document.createElement('td');
  const openaiCell = document.createElement('td');
  const activityCell = document.createElement('td');
  const actionCell = document.createElement('td');

  nameEl.className = 'document-name';
  nameEl.textContent = name || 'Unnamed document';
  keyEl.className = 'document-key';
  keyEl.textContent = key || '';
  nameCell.append(nameEl, keyEl);

  versionCell.textContent = versionNumber ? `v${versionNumber}` : '—';
  statusCell.appendChild(statusBadge(status));
  driveCell.appendChild(statusBadge(driveStatus));
  openaiCell.appendChild(statusBadge(openaiStatus));
  activityCell.textContent = formatDate(activityDate);
  actionCell.className = 'actions';

  row.append(nameCell, versionCell, statusCell, driveCell, openaiCell, activityCell, actionCell);
  return row;
}

function renderActiveDocuments(documents) {
  documentsBody.innerHTML = '';
  if (!documents.length) return renderEmptyRow('No active knowledge documents.');

  for (const doc of documents) {
    const activeVersion = doc.versions?.find((version) => version.version_status === 'active') || null;
    const row = buildCommonRow({
      name: doc.document_name,
      key: doc.document_key,
      versionNumber: activeVersion?.version_number || doc.current_version_number,
      status: 'active',
      driveStatus: activeVersion?.drive_status,
      openaiStatus: activeVersion?.openai_status,
      activityDate: doc.last_synced_at
    });

    const actionCell = row.lastElementChild;
    actionCell.appendChild(createButton({
      label: 'Versions',
      className: 'secondary-button',
      onClick: () => toggleVersions(row, doc)
    }));
    actionCell.appendChild(createButton({
      label: 'Rename',
      className: 'rename-button',
      onClick: async () => renameActiveDocument(doc)
    }));
    actionCell.appendChild(createButton({
      label: 'Delete',
      className: 'danger-button',
      onClick: async () => deleteActiveDocument(doc)
    }));

    documentsBody.appendChild(row);
  }
}

function renderOldVersions(versions) {
  documentsBody.innerHTML = '';
  if (!versions.length) return renderEmptyRow('No files currently exist in the Old Versions folder.');

  for (const version of versions) {
    const displayName = version.archived_filename || version.original_filename || version.document_name;
    const row = buildCommonRow({
      name: displayName,
      key: version.document_name,
      versionNumber: version.version_number,
      status: version.version_status,
      driveStatus: version.drive_status,
      openaiStatus: version.openai_status,
      activityDate: version.archived_at || version.retired_at || version.created_at
    });

    const actionCell = row.lastElementChild;
    actionCell.appendChild(createButton({
      label: 'Restore',
      className: 'restore-button',
      onClick: async () => restoreOldVersion(version)
    }));
    actionCell.appendChild(createButton({
      label: 'Rename',
      className: 'rename-button',
      onClick: async () => renameOldVersion(version)
    }));
    actionCell.appendChild(createButton({
      label: 'Delete',
      className: 'danger-button',
      onClick: async () => permanentlyDeleteOldVersion(version)
    }));

    documentsBody.appendChild(row);
  }
}

function renderAllVersions(documents) {
  documentsBody.innerHTML = '';
  const flattened = [];

  for (const doc of documents) {
    for (const version of doc.versions || []) {
      flattened.push({ doc, version });
    }
  }

  flattened.sort((a, b) => {
    const byName = String(a.doc.document_name || '').localeCompare(String(b.doc.document_name || ''));
    if (byName !== 0) return byName;
    return Number(b.version.version_number || 0) - Number(a.version.version_number || 0);
  });

  if (!flattened.length) return renderEmptyRow('No knowledge versions have been recorded yet.');

  for (const { doc, version } of flattened) {
    const row = buildCommonRow({
      name: version.drive_status === 'archived'
        ? (version.archived_filename || version.original_filename || doc.document_name)
        : (version.original_filename || doc.document_name),
      key: doc.document_name,
      versionNumber: version.version_number,
      status: version.version_status,
      driveStatus: version.drive_status,
      openaiStatus: version.openai_status,
      activityDate: version.archived_at || version.deleted_at || version.indexed_at || version.created_at
    });

    const actionCell = row.lastElementChild;

    if (version.drive_status === 'active_folder') {
      actionCell.appendChild(createButton({
        label: 'Versions',
        className: 'secondary-button',
        onClick: () => toggleVersions(row, doc)
      }));
      actionCell.appendChild(createButton({
        label: 'Rename',
        className: 'rename-button',
        onClick: async () => renameActiveDocument(doc)
      }));
      actionCell.appendChild(createButton({
        label: 'Delete',
        className: 'danger-button',
        onClick: async () => deleteActiveDocument(doc)
      }));
    } else if (version.drive_status === 'archived') {
      const oldVersion = {
        ...version,
        knowledge_document_id: doc.knowledge_document_id,
        document_name: doc.document_name,
        is_active: doc.is_active
      };

      actionCell.appendChild(createButton({
        label: 'Restore',
        className: 'restore-button',
        onClick: async () => restoreOldVersion(oldVersion)
      }));
      actionCell.appendChild(createButton({
        label: 'Rename',
        className: 'rename-button',
        onClick: async () => renameOldVersion(oldVersion)
      }));
      actionCell.appendChild(createButton({
        label: 'Delete',
        className: 'danger-button',
        onClick: async () => permanentlyDeleteOldVersion(oldVersion)
      }));
    } else if (version.drive_status === 'permanently_deleted') {
      const note = document.createElement('span');
      note.textContent = 'Physical file deleted';
      actionCell.appendChild(note);
    }

    documentsBody.appendChild(row);
  }
}

function toggleVersions(documentRow, doc) {
  const nextRow = documentRow.nextElementSibling;
  if (nextRow?.classList.contains('version-row')) {
    nextRow.remove();
    return;
  }

  const versionRow = document.createElement('tr');
  versionRow.className = 'version-row';
  const cell = document.createElement('td');
  cell.colSpan = 7;
  const versions = [...(doc.versions || [])].sort(
    (a, b) => Number(b.version_number || 0) - Number(a.version_number || 0)
  );

  if (!versions.length) {
    cell.textContent = 'No version history is available.';
  } else {
    const container = document.createElement('div');
    container.className = 'version-history';

    for (const version of versions) {
      const item = document.createElement('div');
      item.className = 'version-history-item';
      const title = document.createElement('strong');
      title.textContent = `Version ${version.version_number}`;
      const details = document.createElement('div');
      details.textContent = [
        `Status: ${version.version_status || 'unknown'}`,
        `Drive: ${version.drive_status || 'unknown'}`,
        `OpenAI: ${version.openai_status || 'unknown'}`,
        version.archived_filename ? `Archived as: ${version.archived_filename}` : null,
        version.permanently_deleted_at ? `Permanently deleted: ${formatDate(version.permanently_deleted_at)}` : null
      ].filter(Boolean).join(' · ');
      item.append(title, details);
      container.appendChild(item);
    }

    cell.appendChild(container);
  }

  versionRow.appendChild(cell);
  documentRow.after(versionRow);
}

async function renameActiveDocument(doc) {
  const newName = window.prompt('Enter the new PDF filename:', doc.document_name);
  if (newName === null) return;
  const cleanName = newName.trim();
  if (!cleanName) return showStatus('The filename cannot be empty.', 'error');

  showStatus(`Renaming ${doc.document_name}...`, 'info');
  try {
    const result = await adminApi(`/api/knowledge/admin/documents/${doc.knowledge_document_id}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cleanName })
    });
    showStatus(result.message, 'success');
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

async function deleteActiveDocument(doc) {
  const confirmed = window.confirm(
    `Delete "${doc.document_name}" from active knowledge?\n\nIt will be moved to Old Versions. It is NOT permanently deleted yet.`
  );
  if (!confirmed) return;

  showStatus(`Moving ${doc.document_name} to Old Versions...`, 'info');
  try {
    const result = await adminApi(`/api/knowledge/admin/documents/${doc.knowledge_document_id}`, {
      method: 'DELETE'
    });
    showStatus(result.message || 'The active document was moved to Old Versions.', 'success');
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

async function renameOldVersion(version) {
  const currentName = version.archived_filename || version.original_filename || version.document_name;
  const newName = window.prompt('Enter the new archived PDF filename:', currentName);
  if (newName === null) return;
  const cleanName = newName.trim();
  if (!cleanName) return showStatus('The filename cannot be empty.', 'error');

  showStatus(`Renaming ${currentName}...`, 'info');
  try {
    const result = await adminApi(
      `/api/knowledge/admin/documents/${version.knowledge_document_id}/versions/${version.knowledge_document_version_id}/rename`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName })
      }
    );
    showStatus(result.message, 'success');
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

async function restoreOldVersion(version) {
  const displayName = version.archived_filename || version.original_filename || version.document_name;
  const extra = version.is_active
    ? '\n\nThis logical document already has an active version. Delete that active version first.'
    : '';
  const confirmed = window.confirm(`Restore "${displayName}" as a new active version?${extra}`);
  if (!confirmed) return;

  showStatus(`Restoring ${displayName}...`, 'info');
  try {
    const result = await adminApi(
      `/api/knowledge/admin/documents/${version.knowledge_document_id}/versions/${version.knowledge_document_version_id}/restore`,
      { method: 'POST' }
    );
    showStatus(result.message, 'success');
    currentFilter = 'active';
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

async function permanentlyDeleteOldVersion(version) {
  const displayName = version.archived_filename || version.original_filename || version.document_name;
  const confirmed = window.confirm(
    `PERMANENTLY delete "${displayName}" from Google Drive?\n\nThis cannot be undone. PostgreSQL audit history will remain.`
  );
  if (!confirmed) return;

  showStatus(`Permanently deleting ${displayName}...`, 'info');
  try {
    const result = await adminApi(
      `/api/knowledge/admin/documents/${version.knowledge_document_id}/versions/${version.knowledge_document_version_id}`,
      { method: 'DELETE' }
    );
    showStatus(result.message, 'success');
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function selectFile(file) {
  currentFile = file || null;
  if (!currentFile) {
    selectedFile.textContent = '';
    uploadButton.disabled = true;
    return;
  }

  const validPdf = currentFile.type === 'application/pdf' || currentFile.name.toLowerCase().endsWith('.pdf');
  if (!validPdf) {
    currentFile = null;
    selectedFile.textContent = '';
    uploadButton.disabled = true;
    showStatus('Only PDF files are accepted.', 'error');
    return;
  }

  selectedFile.textContent = currentFile.name;
  uploadButton.disabled = false;
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  selectFile(event.dataTransfer?.files?.[0]);
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentFile) return showStatus('Please select a PDF first.', 'error');

  uploadButton.disabled = true;
  showStatus(`Uploading ${currentFile.name}...`, 'info');
  const formData = new FormData();
  formData.append('file', currentFile);

  try {
    const result = await adminApi('/api/knowledge/admin/upload', {
      method: 'POST',
      body: formData
    });
    showStatus(result.message, 'success');
    currentFile = null;
    fileInput.value = '';
    selectedFile.textContent = '';
    currentFilter = 'active';
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    uploadButton.disabled = !currentFile;
  }
});

async function runSync() {
  syncButton.disabled = true;
  showStatus('Synchronizing Google Drive, PostgreSQL and OpenAI...', 'info');
  try {
    const result = await adminApi('/api/knowledge/sync', { method: 'POST' });
    showStatus(
      [
        'Synchronization finished.',
        `Created: ${result.created || 0}`,
        `Updated: ${result.updated || 0}`,
        `Unchanged: ${result.unchanged || 0}`,
        `Duplicates: ${result.duplicates || 0}`,
        `Deleted: ${result.deleted || 0}`,
        `Failed: ${result.failed || 0}`
      ].join(' '),
      result.failed ? 'error' : 'success'
    );
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    syncButton.disabled = false;
  }
}

syncButton.addEventListener('click', runSync);
refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  hideStatus();
  try {
    await loadDocuments();
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    refreshButton.disabled = false;
  }
});

activeFilterButton.addEventListener('click', () => {
  currentFilter = 'active';
  applyCurrentFilter();
});
oldVersionsFilterButton.addEventListener('click', () => {
  currentFilter = 'old';
  applyCurrentFilter();
});
allFilterButton.addEventListener('click', () => {
  currentFilter = 'all';
  applyCurrentFilter();
});

async function connectAdmin() {
  adminKey = adminKeyInput.value.trim();
  if (!adminKey) return showStatus('Enter the administrator key.', 'error');

  connectButton.disabled = true;
  showStatus('Connecting...', 'info');
  try {
    await loadDocuments();
    sessionStorage.setItem('marina_admin_key', adminKey);
    authCard.hidden = true;
    dashboard.hidden = false;
    hideStatus();
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    connectButton.disabled = false;
  }
}

connectButton.addEventListener('click', connectAdmin);
adminKeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    connectAdmin();
  }
});

if (adminKey) {
  adminKeyInput.value = adminKey;
  loadDocuments()
    .then(() => {
      authCard.hidden = true;
      dashboard.hidden = false;
      hideStatus();
    })
    .catch(() => {
      sessionStorage.removeItem('marina_admin_key');
      adminKey = '';
      authCard.hidden = false;
      dashboard.hidden = true;
      showStatus('Your administrator session is no longer valid. Please connect again.', 'error');
    });
}
