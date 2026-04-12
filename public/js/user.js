// ===== User Dashboard JavaScript =====

let smtpConfigs = [];
let campaigns = [];
let attachments = [];

// ===== Campaign preview + spam score =====
async function showCampaignPreview() {
    // Pull current draft from the campaign editor (works even if not saved)
    const subject = document.getElementById('campaignSubject').value;
    const contentType = document.getElementById('contentType').value;
    const body = document.getElementById('campaignBody').value;
    const body_html = contentType === 'html' ? body : null;
    const body_text = contentType === 'text' ? body : null;

    if (!subject && !body) {
        showToast('Add a subject or body first to preview', 'warning');
        return;
    }

    showToast('Building preview…', 'info');
    try {
        const result = await api('/user/campaigns/preview', {
            method: 'POST',
            body: JSON.stringify({ subject, body_html, body_text })
        });
        renderPreview(result);
        document.getElementById('previewModal').classList.add('active');
    } catch (error) {
        showToast('Preview failed: ' + error.message, 'error');
    }
}

function renderPreview(result) {
    document.getElementById('previewSubject').textContent = result.subject || '(no subject)';

    // Render HTML in an iframe — sandboxed so any inline scripts can't run
    const iframe = document.getElementById('previewIframe');
    iframe.srcdoc = result.html || `<pre style="font-family:monospace;padding:20px;color:#111">${escapeHtml(result.text || '(no body)')}</pre>`;

    // Spam score badge
    const badge = document.getElementById('previewSpamBadge');
    const score = result.score || {};
    badge.className = 'badge ' + ({
        good: 'badge-success',
        warn: 'badge-warning',
        bad: 'badge-danger'
    }[score.level] || 'badge-gray');
    badge.textContent = `Spam Score: ${score.score || 0}/10 — ${score.levelText || ''}`;

    // Spam report
    const report = document.getElementById('previewSpamReportContent');
    const sections = [];

    if (score.flags && score.flags.length > 0) {
        const flagItems = score.flags.map(f => `<span class="badge badge-yellow" style="margin:2px">${f.word} (${f.count})</span>`).join('');
        sections.push(`<div><strong>Trigger words:</strong> ${flagItems}</div>`);
    }
    if (score.reasons && score.reasons.length > 0) {
        sections.push(`<div style="margin-top:6px"><strong>Other warnings:</strong><ul style="margin:4px 0 0 18px;padding:0">${score.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`);
    }
    if (sections.length === 0) {
        sections.push('<div style="color:var(--green)">No spam triggers detected. This email looks clean.</div>');
    }
    report.innerHTML = sections.join('');
}

function closePreviewModal() {
    document.getElementById('previewModal').classList.remove('active');
    const iframe = document.getElementById('previewIframe');
    if (iframe) iframe.srcdoc = '';
}

// ===== Auto-Updater UI =====
// State machine: hidden → checking → available → downloading → downloaded
let updateState = { phase: 'hidden', version: null, percent: 0 };

function renderUpdateBanner() {
    const banner = document.getElementById('updateBanner');
    if (!banner) return;

    if (updateState.phase === 'hidden') {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }

    let icon, text, actions;

    if (updateState.phase === 'available') {
        icon = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>';
        text = `<strong>Version ${escapeHtml(updateState.version)}</strong> is available.`;
        actions = `
            <button class="btn btn-primary btn-sm" onclick="startUpdateDownload()">Download</button>
            <button class="btn btn-secondary btn-sm" onclick="dismissUpdateBanner()">Later</button>
        `;
    } else if (updateState.phase === 'downloading') {
        icon = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"/></svg>';
        text = `<strong>Downloading update ${escapeHtml(updateState.version)}…</strong>
            <div class="update-progress-bar"><div class="update-progress-fill" style="width:${updateState.percent}%"></div></div>`;
        actions = `<span style="font-family:var(--mono);font-size:11px;color:var(--text-2)">${updateState.percent}%</span>`;
    } else if (updateState.phase === 'downloaded') {
        icon = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
        text = `<strong>Update ${escapeHtml(updateState.version)} ready.</strong> Restart the app to install.`;
        actions = `
            <button class="btn btn-primary btn-sm" onclick="installUpdateNow()">Restart Now</button>
            <button class="btn btn-secondary btn-sm" onclick="dismissUpdateBanner()">Later</button>
        `;
    }

    banner.innerHTML = `
        <div class="update-banner-icon">${icon}</div>
        <div class="update-banner-text">${text}</div>
        <div class="update-banner-actions">${actions}</div>
    `;
    banner.style.display = 'flex';
}

async function startUpdateDownload() {
    updateState.phase = 'downloading';
    updateState.percent = 0;
    renderUpdateBanner();
    try {
        const result = await window.electronAPI.updates.download();
        if (result?.error) {
            showToast('Download failed: ' + result.error, 'error');
            updateState.phase = 'available';
            renderUpdateBanner();
        }
    } catch (err) {
        showToast('Download failed: ' + err.message, 'error');
        updateState.phase = 'available';
        renderUpdateBanner();
    }
}

async function installUpdateNow() {
    if (!confirm('Restart MailFlow now to install the update? Unsaved campaigns will be paused.')) return;
    try {
        await window.electronAPI.updates.install();
    } catch (err) {
        showToast('Install failed: ' + err.message, 'error');
    }
}

function dismissUpdateBanner() {
    updateState.phase = 'hidden';
    renderUpdateBanner();
}

async function manualUpdateCheck() {
    showToast('Checking for updates…', 'info');
    try {
        const result = await window.electronAPI.updates.check();
        if (result?.error) {
            showToast('Check failed: ' + result.error, 'error');
            return;
        }
        // The check fires events back through the listeners — but if no update
        // is available, we want to give the user explicit feedback right now.
        // Wait a moment for the events to land, then show a toast if banner
        // is still hidden.
        setTimeout(() => {
            if (updateState.phase === 'hidden') {
                showToast('You are up to date', 'success');
            }
        }, 1500);
    } catch (err) {
        showToast('Check failed: ' + err.message, 'error');
    }
}

// Subscribe to update events on app boot
function initAutoUpdater() {
    if (!window.electronAPI || !window.electronAPI.updates) {
        console.log('[Updater] electronAPI.updates not available — running in browser?');
        return;
    }
    const u = window.electronAPI.updates;

    u.onAvailable((info) => {
        updateState = { phase: 'available', version: info.version, percent: 0 };
        renderUpdateBanner();
    });

    u.onProgress((p) => {
        if (updateState.phase === 'downloading') {
            updateState.percent = p.percent || 0;
            renderUpdateBanner();
        }
    });

    u.onDownloaded((info) => {
        updateState = { phase: 'downloaded', version: info.version, percent: 100 };
        renderUpdateBanner();
    });

    u.onError((err) => {
        // Silent — don't bother user about transient network errors
        console.warn('[Updater]', err?.message || err);
    });

    u.onNotAvailable(() => {
        // Don't show anything if no update — quiet by design
        console.log('[Updater] No update available');
    });
}

// Run as soon as the script loads
initAutoUpdater();

// ===== Backup / Restore =====
async function exportBackup() {
    showToast('Building backup…', 'info');
    try {
        const token = localStorage.getItem('accessToken');
        const res = await fetch('/api/user/backup/export', {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        if (!res.ok) throw new Error('Backup request failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mailflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Backup downloaded', 'success');
    } catch (error) {
        showToast('Export failed: ' + error.message, 'error');
    }
}

function handleImportBackup(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const replace = document.getElementById('backupReplaceExisting').checked;
    const confirmMsg = replace
        ? 'Restore from backup and REPLACE items with the same name? This cannot be undone.'
        : 'Restore from backup? Items with names that already exist will be skipped.';
    if (!confirm(confirmMsg)) {
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const envelope = JSON.parse(e.target.result);
            showToast('Restoring backup…', 'info');
            const result = await api('/user/backup/import', {
                method: 'POST',
                body: JSON.stringify({ envelope, replace_existing: replace })
            });
            const i = result.imported || {};
            const totals = Object.entries(i)
                .filter(([k, v]) => v > 0)
                .map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`)
                .join(', ');
            showToast(`Restored: ${totals || 'nothing'} (${result.errors?.length || 0} errors)`, 'success');
            // Reload current page data
            loadCampaigns();
            loadSmtpConfigs();
            loadAttachments();
            loadSettings();
        } catch (err) {
            showToast('Import failed: ' + err.message, 'error');
        }
        event.target.value = '';
    };
    reader.onerror = () => showToast('Failed to read file', 'error');
    reader.readAsText(file);
}

// ===== Background Image (Appearance preference) =====
// Stored in localStorage so it survives restarts. Image is a data URL, capped
// at ~3 MB to stay under the localStorage quota.
const BG_IMAGE_KEY = 'appearance:bgImage';
const BG_DIM_KEY = 'appearance:bgDim';
const BG_BLUR_KEY = 'appearance:bgBlur';
const BG_CLEARED_KEY = 'appearance:bgCleared'; // set when user explicitly opted out of the default
const BG_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
// Built-in default wallpaper that ships with MailFlow. Used when the user
// hasn't uploaded their own image and hasn't explicitly cleared the background.
const BG_DEFAULT_URL = 'img/backgrounds/mailflow-hero.svg';

/**
 * Resolve which background image to show right now.
 *   - User upload wins if present.
 *   - Otherwise, the bundled default wallpaper, unless the user explicitly
 *     cleared it (then nothing).
 */
function resolveBackgroundSource() {
    const userImg = localStorage.getItem(BG_IMAGE_KEY);
    if (userImg) return userImg;
    if (localStorage.getItem(BG_CLEARED_KEY) === '1') return null;
    return BG_DEFAULT_URL;
}

/**
 * Apply the current saved background to <body>. Called on app boot and
 * whenever the user uploads/clears the image or changes dim/blur.
 */
function applyBackgroundImage() {
    const img = resolveBackgroundSource();
    const dimPct = Number(localStorage.getItem(BG_DIM_KEY) ?? 75);
    const blurPx = Number(localStorage.getItem(BG_BLUR_KEY) ?? 0);

    document.body.style.setProperty('--bg-dim', (dimPct / 100).toFixed(2));
    document.body.style.setProperty('--bg-blur', `${blurPx}px`);

    if (img) {
        document.body.style.backgroundImage = `url("${img}")`;
        document.body.classList.add('has-bg-image');
    } else {
        document.body.style.backgroundImage = '';
        document.body.classList.remove('has-bg-image');
    }
}

/**
 * Populate the Appearance card controls from localStorage. Called when the
 * user navigates to the Account page.
 */
function loadBackgroundSettings() {
    const resolved = resolveBackgroundSource();
    const isCustom = !!localStorage.getItem(BG_IMAGE_KEY);
    const dimPct = Number(localStorage.getItem(BG_DIM_KEY) ?? 75);
    const blurPx = Number(localStorage.getItem(BG_BLUR_KEY) ?? 0);

    const dimInput = document.getElementById('bgDimInput');
    const dimValue = document.getElementById('bgDimValue');
    const blurInput = document.getElementById('bgBlurInput');
    const blurValue = document.getElementById('bgBlurValue');
    const preview = document.getElementById('bgPreview');
    const status = document.getElementById('bgStatusLabel');

    if (dimInput) dimInput.value = dimPct;
    if (dimValue) dimValue.textContent = `${dimPct}%`;
    if (blurInput) blurInput.value = blurPx;
    if (blurValue) blurValue.textContent = `${blurPx}px`;

    if (preview) {
        if (resolved) {
            preview.style.backgroundImage = `url("${resolved}")`;
            preview.classList.add('has-image');
        } else {
            preview.style.backgroundImage = '';
            preview.classList.remove('has-image');
        }
    }

    if (status) {
        if (isCustom) {
            status.textContent = 'Using your uploaded image';
        } else if (resolved) {
            status.textContent = 'Using the built-in MailFlow wallpaper';
        } else {
            status.textContent = 'No background image';
        }
    }

    // The Remove Background button is contextual — its label changes based on
    // current state so the user always knows what clicking will do.
    const clearBtn = document.getElementById('bgClearBtn');
    if (clearBtn) {
        if (isCustom) {
            clearBtn.textContent = 'Restore Default Wallpaper';
        } else if (resolved) {
            clearBtn.textContent = 'Hide Background';
        } else {
            clearBtn.textContent = 'Restore Default Wallpaper';
        }
    }
}

function handleBackgroundImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Please choose an image file', 'error');
        return;
    }
    if (file.size > BG_IMAGE_MAX_BYTES) {
        showToast(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 3 MB.`, 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        try {
            localStorage.setItem(BG_IMAGE_KEY, dataUrl);
            localStorage.removeItem(BG_CLEARED_KEY);
        } catch (err) {
            showToast('Image is too large to store. Try a smaller file.', 'error');
            event.target.value = '';
            return;
        }
        applyBackgroundImage();
        loadBackgroundSettings();
        showToast('Background updated', 'success');
        event.target.value = '';
    };
    reader.onerror = () => showToast('Failed to read image', 'error');
    reader.readAsDataURL(file);
}

// Slider events fire continuously while dragging — write to localStorage on a
// debounce to avoid hundreds of synchronous writes per drag, and apply only the
// cheap CSS-variable overlay (not the full background-image URL) for instant
// visual feedback.
let bgPersistTimer = null;
function persistBgSettingDebounced(key, value) {
    bgPersistTimer && clearTimeout(bgPersistTimer);
    bgPersistTimer = setTimeout(() => {
        try { localStorage.setItem(key, String(value)); } catch {}
    }, 150);
}

function applyBackgroundOverlay(dimPct, blurPx) {
    document.body.style.setProperty('--bg-dim', (dimPct / 100).toFixed(2));
    document.body.style.setProperty('--bg-blur', `${blurPx}px`);
}

function handleBackgroundDimChange(event) {
    const value = Number(event.target.value);
    const blur = Number(localStorage.getItem(BG_BLUR_KEY) ?? 0);
    applyBackgroundOverlay(value, blur);
    persistBgSettingDebounced(BG_DIM_KEY, value);
    const label = document.getElementById('bgDimValue');
    if (label) label.textContent = `${value}%`;
}

function handleBackgroundBlurChange(event) {
    const value = Number(event.target.value);
    const dim = Number(localStorage.getItem(BG_DIM_KEY) ?? 75);
    applyBackgroundOverlay(dim, value);
    persistBgSettingDebounced(BG_BLUR_KEY, value);
    const label = document.getElementById('bgBlurValue');
    if (label) label.textContent = `${value}px`;
}

/**
 * "Remove Background" / "Reset to Default" three-state flow:
 *   - If the user has a custom upload → remove it, revert to built-in default.
 *   - If currently on the built-in default → hide it entirely (plain theme).
 *   - If already hidden → restore the built-in default.
 */
function clearBackgroundImage() {
    const hasCustom = !!localStorage.getItem(BG_IMAGE_KEY);
    const isCleared = localStorage.getItem(BG_CLEARED_KEY) === '1';

    if (hasCustom) {
        if (!confirm('Remove your uploaded image and restore the MailFlow default wallpaper?')) return;
        localStorage.removeItem(BG_IMAGE_KEY);
        localStorage.removeItem(BG_CLEARED_KEY);
        showToast('Restored MailFlow default wallpaper', 'success');
    } else if (!isCleared) {
        if (!confirm('Hide the background wallpaper? You can restore it anytime.')) return;
        localStorage.setItem(BG_CLEARED_KEY, '1');
        showToast('Background hidden', 'success');
    } else {
        localStorage.removeItem(BG_CLEARED_KEY);
        showToast('Restored MailFlow default wallpaper', 'success');
    }

    applyBackgroundImage();
    loadBackgroundSettings();
}

// Apply the saved background as soon as the script loads so there's no flash
// of the default background on app startup.
applyBackgroundImage();

// ===== Campaign Monitors Map =====
// Each running or recently-completed campaign has its own entry, keyed by
// campaignId. This replaces the old singleton eventSource/currentCampaignId
// pattern so multiple campaigns can run and be monitored concurrently.
//
// Entry shape:
//   {
//     campaignId:  number,
//     name:        string,
//     eventSource: EventSource | null,
//     state: {
//       total, sent, failed,
//       status:   'starting' | 'running' | 'completed' | 'stopped' | 'failed',
//       statusText: string,      // e.g. "Sending 45/240"
//       log:      Array<{ kind, text, time }>,
//       startedAt: number (ms)
//     },
//     subscribers: Set<fn>       // callbacks invoked on any state change
//   }
const campaignMonitors = new Map();
// Exposed on window so app.html's inline go() can read/write it without hoisting issues
window.currentlyViewedMonitorId = null;

function getMonitor(id) {
    return campaignMonitors.get(Number(id));
}

function createMonitor(campaignId, name) {
    const id = Number(campaignId);
    if (campaignMonitors.has(id)) return campaignMonitors.get(id);
    const monitor = {
        campaignId: id,
        name: name || `Campaign ${id}`,
        eventSource: null,
        state: {
            total: 0,
            sent: 0,
            failed: 0,
            status: 'starting',
            statusText: 'Starting…',
            log: [],
            startedAt: Date.now()
        },
        subscribers: new Set()
    };
    campaignMonitors.set(id, monitor);
    return monitor;
}

function removeMonitor(campaignId) {
    const id = Number(campaignId);
    const m = campaignMonitors.get(id);
    if (!m) return;
    if (m.eventSource) {
        try { m.eventSource.close(); } catch {}
        m.eventSource = null;
    }
    campaignMonitors.delete(id);
    renderRunningStrip();
}

function subscribeMonitor(campaignId, fn) {
    const m = getMonitor(campaignId);
    if (!m) return () => {};
    m.subscribers.add(fn);
    return () => m.subscribers.delete(fn);
}

function notifyMonitor(campaignId) {
    const m = getMonitor(campaignId);
    if (!m) return;
    for (const fn of m.subscribers) {
        try { fn(m); } catch (e) { console.error('[Monitor subscriber error]', e); }
    }
    renderRunningStrip();
}

function appendMonitorLog(monitor, kind, text) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    monitor.state.log.push({ kind, text, time });
    // Cap log at 500 entries to keep memory sane
    if (monitor.state.log.length > 500) {
        monitor.state.log.splice(0, monitor.state.log.length - 500);
    }
}

/**
 * Pipe a single SSE event into a monitor's state. Kept separate from DOM
 * so any subscriber (strip tab, monitor page, etc.) can react independently.
 */
function handleMonitorEvent(campaignId, data) {
    const m = getMonitor(campaignId);
    if (!m) return;
    const s = m.state;

    switch (data.event) {
        case 'start':
            s.total = data.data?.total || 0;
            s.status = 'running';
            s.statusText = `Sending 0/${s.total}`;
            appendMonitorLog(m, 'info', `Starting ${s.total} emails…`);
            break;

        case 'sent':
            s.sent = data.data?.sent || s.sent;
            s.failed = data.data?.failed || s.failed;
            s.statusText = `Sending ${s.sent + s.failed}/${s.total}`;
            appendMonitorLog(m, 'sent', `[SENT] ${data.data?.email || ''}`);
            break;

        case 'failed':
            s.sent = data.data?.sent || s.sent;
            s.failed = data.data?.failed || s.failed;
            s.statusText = `Sending ${s.sent + s.failed}/${s.total}`;
            appendMonitorLog(m, 'failed', `[FAILED] ${data.data?.email || ''}: ${data.data?.error || ''}`);
            break;

        case 'complete':
            s.status = 'completed';
            s.statusText = 'Completed';
            s.sent = data.data?.sent ?? s.sent;
            s.failed = data.data?.failed ?? s.failed;
            appendMonitorLog(m, 'info', `[COMPLETE] Sent: ${s.sent}, Failed: ${s.failed}`);
            if (m.eventSource) { try { m.eventSource.close(); } catch {} m.eventSource = null; }
            loadCampaigns();
            break;

        case 'stopped':
            s.status = 'stopped';
            s.statusText = 'Stopped';
            appendMonitorLog(m, 'warning', '[STOPPED] Campaign stopped by user');
            if (m.eventSource) { try { m.eventSource.close(); } catch {} m.eventSource = null; }
            loadCampaigns();
            break;

        case 'error':
            s.status = 'failed';
            s.statusText = 'Error';
            appendMonitorLog(m, 'failed', `[ERROR] ${data.data?.message || 'Unknown error'}`);
            if (m.eventSource) { try { m.eventSource.close(); } catch {} m.eventSource = null; }
            break;
    }

    notifyMonitor(campaignId);
}

function getMonitorPercent(m) {
    if (!m || !m.state.total) return 0;
    return Math.min(100, Math.round(((m.state.sent + m.state.failed) / m.state.total) * 100));
}

// ===== View mode (grid / list) persistence =====
// Each page remembers its own preference in localStorage so users can mix.
// Grid is the default for every page per user's preference.
function getViewMode(pageName) {
    try {
        return localStorage.getItem('viewMode:' + pageName) || 'grid';
    } catch {
        return 'grid';
    }
}

function setViewMode(pageName, mode) {
    try {
        localStorage.setItem('viewMode:' + pageName, mode);
    } catch {}
}

/**
 * Toggle view mode for a page and call its render function again.
 * Expected render function name: 'render' + capitalized pageName (e.g. renderCampaigns)
 */
function toggleViewMode(pageName, mode) {
    setViewMode(pageName, mode);
    // Find and call the render function by naming convention
    const fnMap = {
        campaigns: 'renderCampaigns',
        recipients: 'renderRecipientLists',
        subjects: 'renderSubjectsList',
        senders: 'renderSendersList',
        links: 'renderLinksList',
        proxies: 'renderProxiesTable',
        attachments: 'renderAttachments',
        templates: 'renderTemplatesTable',
        logs: 'renderLogs'
    };
    const fnName = fnMap[pageName];
    if (fnName && typeof window[fnName] === 'function') {
        window[fnName]();
    }
}

/**
 * Render the grid/list toggle buttons. Call from each render function to
 * insert the toggle into the corresponding page header's toggle slot.
 */
function renderViewToggle(pageName) {
    const slot = document.getElementById('viewToggle-' + pageName);
    if (!slot) return;
    const current = getViewMode(pageName);
    slot.innerHTML = `
        <div class="view-toggle">
            <button class="${current === 'grid' ? 'active' : ''}" onclick="toggleViewMode('${pageName}', 'grid')" title="Grid view">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4h7v7H4V4zm0 9h7v7H4v-7zm9-9h7v7h-7V4zm0 9h7v7h-7v-7z"/></svg>
            </button>
            <button class="${current === 'list' ? 'active' : ''}" onclick="toggleViewMode('${pageName}', 'list')" title="List view">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
        </div>
    `;
}

// ===== Draft Auto-Save =====
// Serializes the campaign form to localStorage so an accidentally-closed modal
// doesn't lose the user's work.
const DRAFT_FIELDS = [
    'campaignName', 'campaignSubject', 'campaignBody', 'contentType',
    'campaignRecipients', 'campaignReplyTo'
];
let draftSaveTimer = null;

function draftKey(campaignId) {
    return `campaignDraft:${campaignId || 'new'}`;
}

function serializeCampaignDraft() {
    const data = { saved_at: Date.now() };
    for (const id of DRAFT_FIELDS) {
        const el = document.getElementById(id);
        if (el) data[id] = el.value;
    }
    return data;
}

function saveCampaignDraft() {
    try {
        const id = document.getElementById('campaignId')?.value || '';
        const data = serializeCampaignDraft();
        // Only save if there's something meaningful
        if (data.campaignName || data.campaignSubject || data.campaignBody || data.campaignRecipients) {
            localStorage.setItem(draftKey(id), JSON.stringify(data));
        }
    } catch (e) {
        console.warn('[Draft] save failed:', e);
    }
}

function debouncedDraftSave() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(saveCampaignDraft, 2000);
}

function clearCampaignDraft() {
    try {
        const id = document.getElementById('campaignId')?.value || '';
        localStorage.removeItem(draftKey(id));
    } catch (e) { /* ignore */ }
}

function loadCampaignDraft() {
    try {
        const id = document.getElementById('campaignId')?.value || '';
        const raw = localStorage.getItem(draftKey(id));
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function applyCampaignDraft(draft) {
    if (!draft) return;
    for (const id of DRAFT_FIELDS) {
        if (draft[id] !== undefined) {
            const el = document.getElementById(id);
            if (el) el.value = draft[id];
        }
    }
    // Trigger content-type UI update
    if (draft.contentType) {
        try { setContentType(draft.contentType); } catch (e) { /* ignore */ }
    }
}

function showDraftRestoreBanner(draft) {
    if (!draft) return;
    const banner = document.getElementById('draftRestoreBanner');
    if (!banner) return;
    const ts = new Date(draft.saved_at).toLocaleString();
    banner.querySelector('.draft-time').textContent = ts;
    banner.style.display = 'flex';
}

function hideDraftRestoreBanner() {
    const banner = document.getElementById('draftRestoreBanner');
    if (banner) banner.style.display = 'none';
}

function restoreDraftClick() {
    const draft = loadCampaignDraft();
    if (draft) {
        applyCampaignDraft(draft);
        showToast('Draft restored', 'success');
    }
    hideDraftRestoreBanner();
}

function discardDraftClick() {
    clearCampaignDraft();
    hideDraftRestoreBanner();
    showToast('Draft discarded', 'info');
}

function attachDraftAutoSave() {
    for (const id of DRAFT_FIELDS) {
        const el = document.getElementById(id);
        if (el && !el._draftBound) {
            el.addEventListener('input', debouncedDraftSave);
            el.addEventListener('change', debouncedDraftSave);
            el._draftBound = true;
        }
    }
}

// ===== Drag-and-drop CSV recipient import =====
// Parses a CSV file, auto-detects the email column, and populates the
// campaign recipients textarea. Validation + dedup happens server-side on save.
function parseCsvLine(line) {
    // Simple CSV parser that handles quoted fields with commas
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"') {
            cur += '"'; i++;
        } else if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            out.push(cur); cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out.map(s => s.trim());
}

function extractEmailsFromCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    // Detect if there's a header row with an "email" column
    const firstCells = parseCsvLine(lines[0]).map(c => c.toLowerCase());
    let emailIdx = firstCells.findIndex(c => c === 'email' || c === 'e-mail' || c === 'email_address' || c === 'mail');
    let startRow = 0;

    if (emailIdx >= 0) {
        startRow = 1; // Skip header
    } else {
        // No header — try to find which column contains emails by scanning first data row
        const sample = parseCsvLine(lines[0]);
        emailIdx = sample.findIndex(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
        if (emailIdx < 0) emailIdx = 0; // Fall back to first column
    }

    const emails = [];
    for (let i = startRow; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const email = cells[emailIdx]?.trim();
        if (email) emails.push(email);
    }
    return emails;
}

function handleRecipientsFileDrop(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv' || file.type === 'text/plain';
    if (!isCsv) {
        showToast('Only .csv and .txt files are supported', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target.result;
            const emails = extractEmailsFromCsv(text);
            if (emails.length === 0) {
                showToast('No emails found in file', 'warning');
                return;
            }
            const textarea = document.getElementById('campaignRecipients');
            if (textarea.value.trim()) {
                // Append, don't overwrite
                textarea.value = textarea.value.trim() + '\n' + emails.join('\n');
            } else {
                textarea.value = emails.join('\n');
            }
            showToast(`Loaded ${emails.length} emails from ${file.name}`, 'success');
            debouncedDraftSave();
        } catch (err) {
            console.error('CSV parse error:', err);
            showToast('Failed to parse file: ' + err.message, 'error');
        }
    };
    reader.onerror = () => showToast('Failed to read file', 'error');
    reader.readAsText(file);
}

function initRecipientsDropzone() {
    const dropzone = document.getElementById('recipientsDropzone');
    if (!dropzone || dropzone._bound) return;
    dropzone._bound = true;

    ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragging');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Only remove dragging on drop or when leaving the dropzone itself
            if (evt === 'drop' || e.target === dropzone) {
                dropzone.classList.remove('dragging');
            }
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        handleRecipientsFileDrop(file);
    });
}

// ===== Animation Helpers =====
function animateCounters() {
    const counters = document.querySelectorAll('.stat-value[data-target]');
    counters.forEach(counter => {
        const target = parseInt(counter.dataset.target) || 0;
        const duration = 1500;
        const startTime = performance.now();

        function updateCounter(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function for smooth animation
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const current = Math.floor(target * easeOutQuart);

            counter.textContent = current.toLocaleString();

            if (progress < 1) {
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = target.toLocaleString();
                counter.classList.add('animate');
            }
        }

        requestAnimationFrame(updateCounter);
    });
}

// Add staggered entrance animation to elements
function animateElements(selector, delay = 100) {
    const elements = document.querySelectorAll(selector);
    elements.forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        setTimeout(() => {
            el.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * delay);
    });
}

// ===== Page Navigation =====
function showPage(pageId) {
    // Load page data (navigation is handled by app.html go() function)
    switch(pageId) {
        case 'campaigns':
            loadCampaigns();
            break;
        case 'smtp':
            loadSmtpConfigs();
            break;
        case 'attachments':
            loadAttachments();
            break;
        case 'templates':
            loadEmailTemplates();
            break;
        case 'placeholders':
            break;
        case 'inboxFinder':
            loadInboxFinder();
            break;
        case 'account':
            loadAccountData();
            break;
        case 'recipients':
        case 'subjects':
        case 'senders':
        case 'links':
        case 'proxies':
            loadSettings();
            break;
        case 'sending':
            loadSendingSettings();
            loadDeliverabilitySettings();
            break;
        case 'unsubscribes':
            loadUnsubscribes();
            break;
    }
}

// ===== Unsubscribes =====
let unsubscribesList = [];

async function loadUnsubscribes() {
    try {
        const data = await api('/user/unsubscribes');
        unsubscribesList = data.unsubscribes || [];
        renderUnsubscribes();
    } catch (error) {
        showToast('Failed to load unsubscribes: ' + error.message, 'error');
    }
}

function renderUnsubscribes() {
    const container = document.getElementById('unsubscribesContainer');
    const countBadge = document.getElementById('unsubscribesCount');
    if (!container) return;

    if (countBadge) countBadge.textContent = unsubscribesList.length;

    if (unsubscribesList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg class="empty-state-icon" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
                <h3 class="empty-state-title">No unsubscribes yet</h3>
                <p class="empty-state-text">When recipients click the unsubscribe link in your emails they'll appear here automatically.</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="tbl-wrap"><table>
            <thead><tr><th>Email</th><th>Source</th><th>Campaign</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
            ${unsubscribesList.map(u => `
                <tr>
                    <td><strong>${escapeHtml(u.email)}</strong></td>
                    <td><span class="badge badge-gray">${escapeHtml(u.source || 'link')}</span></td>
                    <td>${u.campaign_id ? `#${u.campaign_id}` : '-'}</td>
                    <td>${formatDate(u.unsubscribed_at)}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" onclick="removeUnsubscribe('${escapeHtml(u.email)}')" title="Re-allow sending to this address">Remove</button>
                    </td>
                </tr>
            `).join('')}
            </tbody>
        </table></div>
    `;
}

function showAddUnsubscribeModal() {
    document.getElementById('addUnsubscribeEmail').value = '';
    document.getElementById('addUnsubscribeModal').classList.add('active');
    setTimeout(() => document.getElementById('addUnsubscribeEmail').focus(), 100);
}
function closeAddUnsubscribeModal() {
    document.getElementById('addUnsubscribeModal').classList.remove('active');
}

async function submitAddUnsubscribe() {
    const email = document.getElementById('addUnsubscribeEmail').value.trim();
    if (!email || !email.includes('@')) {
        showToast('Enter a valid email', 'warning');
        return;
    }
    try {
        await api('/user/unsubscribes', { method: 'POST', body: JSON.stringify({ email }) });
        showToast('Added to unsubscribe list', 'success');
        closeAddUnsubscribeModal();
        loadUnsubscribes();
    } catch (error) {
        showToast('Failed: ' + error.message, 'error');
    }
}

async function removeUnsubscribe(email) {
    if (!confirm(`Remove ${email} from the unsubscribe list? Future campaigns will be able to reach them again.`)) return;
    try {
        await api(`/user/unsubscribes/${encodeURIComponent(email)}`, { method: 'DELETE' });
        showToast('Removed from unsubscribe list', 'success');
        loadUnsubscribes();
    } catch (error) {
        showToast('Failed: ' + error.message, 'error');
    }
}

// ===== Recipient list cleanup =====
function showCleanListDialog(listId) {
    const list = (settingsData.recipientLists || []).find(l => l.id === listId);
    if (!list) return showToast('List not found', 'error');
    document.getElementById('cleanListId').value = listId;
    document.getElementById('cleanListName').textContent = list.name;
    document.getElementById('cleanRemoveInvalid').checked = true;
    document.getElementById('cleanRemoveDuplicates').checked = true;
    document.getElementById('cleanRemoveUnsubscribes').checked = true;
    document.getElementById('cleanRemoveFailed').checked = false;
    document.getElementById('cleanFailedThreshold').value = 2;
    document.getElementById('cleanListModal').classList.add('active');
}

function closeCleanListModal() {
    document.getElementById('cleanListModal').classList.remove('active');
}

async function submitCleanList() {
    const id = document.getElementById('cleanListId').value;
    const payload = {
        remove_invalid: document.getElementById('cleanRemoveInvalid').checked,
        remove_duplicates: document.getElementById('cleanRemoveDuplicates').checked,
        remove_unsubscribes: document.getElementById('cleanRemoveUnsubscribes').checked,
        remove_failed: document.getElementById('cleanRemoveFailed').checked,
        failed_threshold: parseInt(document.getElementById('cleanFailedThreshold').value) || 2
    };

    try {
        const result = await api(`/user/settings/recipients/${id}/clean`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const r = result.removed || {};
        const summary = [
            r.invalid ? `${r.invalid} invalid` : null,
            r.duplicates ? `${r.duplicates} duplicates` : null,
            r.unsubscribed ? `${r.unsubscribed} unsubscribed` : null,
            r.failed ? `${r.failed} failed` : null
        ].filter(Boolean).join(' • ');
        const removedTotal = (r.invalid || 0) + (r.duplicates || 0) + (r.unsubscribed || 0) + (r.failed || 0);
        if (removedTotal === 0) {
            showToast(`Nothing to clean — list already in good shape (${result.remaining} remain)`, 'info');
        } else {
            showToast(`Removed ${removedTotal} (${summary}) — ${result.remaining} remain`, 'success');
        }
        closeCleanListModal();
        loadSettings();
    } catch (error) {
        showToast('Cleanup failed: ' + error.message, 'error');
    }
}

function exportUnsubscribesCsv() {
    if (unsubscribesList.length === 0) {
        showToast('Nothing to export', 'warning');
        return;
    }
    const rows = [
        ['email', 'source', 'campaign_id', 'unsubscribed_at'].join(','),
        ...unsubscribesList.map(u => [
            u.email,
            u.source || '',
            u.campaign_id || '',
            u.unsubscribed_at || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unsubscribes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${unsubscribesList.length} unsubscribes`, 'success');
}

// ===== Dashboard =====
async function loadDashboard() {
    try {
        const data = await api('/user/dashboard');

        // Update stats with staggered animation
        document.getElementById('dashboardStats').innerHTML = `
            <div class="stat-card slide-in-up" style="animation-delay: 0.1s;">
                <div class="stat-icon">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-value" data-target="${data.stats.campaigns?.total_campaigns || 0}">0</div>
                    <div class="stat-label">Total Campaigns</div>
                </div>
            </div>
            <div class="stat-card slide-in-up" style="animation-delay: 0.2s;">
                <div class="stat-icon success">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-value" data-target="${data.stats.emails_sent || 0}">0</div>
                    <div class="stat-label">Emails Sent</div>
                </div>
            </div>
            <div class="stat-card slide-in-up" style="animation-delay: 0.3s;">
                <div class="stat-icon warning">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-value" data-target="${data.smtp_count || 0}">0</div>
                    <div class="stat-label">SMTP Servers</div>
                </div>
            </div>
            <div class="stat-card slide-in-up" style="animation-delay: 0.4s;">
                <div class="stat-icon">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-value" data-target="${data.stats.remaining || 0}">0</div>
                    <div class="stat-label">Emails Remaining</div>
                </div>
            </div>
        `;

        // Animate counters
        animateCounters();

        // Update email usage
        const used = data.stats.emails_sent || 0;
        const limit = data.stats.email_limit || 100;
        const percent = Math.min(100, (used / limit) * 100).toFixed(1);

        document.getElementById('emailUsageText').textContent = `${used} / ${limit} emails used`;
        document.getElementById('emailUsagePercent').textContent = `${percent}%`;
        document.getElementById('emailUsageFill').style.width = `${percent}%`;

        // Update recent campaigns
        const tbody = document.getElementById('recentCampaignsBody');
        if (data.recent_campaigns && data.recent_campaigns.length > 0) {
            tbody.innerHTML = data.recent_campaigns.map(c => `
                <tr>
                    <td>${escapeHtml(c.name)}</td>
                    <td><span class="badge badge-${getStatusClass(c.status)}">${c.status}</span></td>
                    <td>${c.sent_count || 0}</td>
                    <td>${c.failed_count || 0}</td>
                    <td>${formatDate(c.created_at)}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No campaigns yet. Create your first campaign!</td></tr>';
        }

    } catch (error) {
        showToast('Failed to load dashboard: ' + error.message, 'error');
    }
}

// ===== Campaigns =====
async function loadCampaigns() {
    try {
        const data = await api('/user/campaigns');
        campaigns = data.campaigns || [];

        // Also load SMTP configs for the dropdown
        const smtpData = await api('/user/smtp');
        smtpConfigs = smtpData.smtp_configs || [];

        // Also load attachments for the dropdown
        const attachData = await api('/user/attachments');
        attachments = attachData.attachments || [];

        renderCampaigns();
    } catch (error) {
        showToast('Failed to load campaigns: ' + error.message, 'error');
    }
}

/**
 * Render the running-strip above the workspace. Called whenever a monitor
 * changes state or when monitors are added/removed. Hides the strip entirely
 * if no monitors exist.
 */
function renderRunningStrip() {
    const strip = document.getElementById('runningStrip');
    if (!strip) return;

    if (campaignMonitors.size === 0) {
        strip.style.display = 'none';
        strip.innerHTML = '';
        return;
    }

    const tabs = [];
    tabs.push('<span class="running-strip-label">Running</span>');
    for (const [id, m] of campaignMonitors) {
        const percent = getMonitorPercent(m);
        const statusClass = `status-${m.state.status}`;
        const isActive = window.currentlyViewedMonitorId === id ? ' active' : '';
        const percentText = (m.state.status === 'completed' || m.state.status === 'stopped' || m.state.status === 'failed')
            ? m.state.statusText
            : `${percent}%`;
        tabs.push(`
            <div class="running-tab ${statusClass}${isActive}" onclick="go('monitor:${id}')" title="${escapeHtml(m.name)}">
                <span class="running-tab-dot"></span>
                <span class="running-tab-name">${escapeHtml(m.name)}</span>
                <span class="running-tab-progress">${percentText}</span>
                <button class="running-tab-close" onclick="event.stopPropagation();closeMonitor(${id})" title="Close">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
        `);
    }

    strip.innerHTML = tabs.join('');
    strip.style.display = 'flex';
}

/**
 * Render the full monitor page for one campaign. Subscribes to its monitor
 * so the log and counters update live while the page is open.
 */
function renderMonitorPage(campaignId) {
    const id = Number(campaignId);
    const container = document.getElementById('monitorPageContent');
    if (!container) return;
    const m = getMonitor(id);

    if (!m) {
        container.innerHTML = `
            <div class="page-hdr"><div><h1>Campaign Monitor</h1><p>No active monitor for this campaign</p></div></div>
            <div class="card card-fill"><div class="empty-state">
                <h3 class="empty-state-title">Nothing to show</h3>
                <p class="empty-state-text">This campaign isn't currently being monitored.</p>
                <button class="btn btn-primary" onclick="go('campaigns')">Back to Campaigns</button>
            </div></div>`;
        return;
    }

    // Render once now, then subscribe for live updates
    const paint = () => {
        const pct = getMonitorPercent(m);
        const statusBadge = {
            starting:  '<span class="badge badge-info">Starting</span>',
            running:   '<span class="badge badge-info">Running</span>',
            completed: '<span class="badge badge-success">Completed</span>',
            stopped:   '<span class="badge badge-warning">Stopped</span>',
            failed:    '<span class="badge badge-danger">Failed</span>'
        }[m.state.status] || '';

        const canStop = (m.state.status === 'running' || m.state.status === 'starting');
        const canClose = !canStop;

        const logHtml = m.state.log.map(e => `
            <div class="monitor-log-entry ${e.kind}">
                <span class="monitor-log-timestamp">${e.time}</span>${escapeHtml(e.text)}
            </div>
        `).join('');

        container.innerHTML = `
            <div class="monitor-header">
                <div>
                    <div class="monitor-title">${escapeHtml(m.name)} ${statusBadge}</div>
                    <div class="monitor-subtitle">${escapeHtml(m.state.statusText)}</div>
                </div>
                <div class="btn-row">
                    ${canStop ? `<button class="btn btn-danger" onclick="stopMonitor(${id})">Stop Sending</button>` : ''}
                    ${canClose ? `<button class="btn btn-secondary" onclick="closeMonitor(${id})">Close Monitor</button>` : ''}
                    <button class="btn btn-secondary" onclick="go('campaigns')">Back to Campaigns</button>
                </div>
            </div>

            <div class="monitor-stats">
                <div class="monitor-stat">
                    <div class="monitor-stat-label">Total</div>
                    <div class="monitor-stat-value">${m.state.total}</div>
                </div>
                <div class="monitor-stat">
                    <div class="monitor-stat-label">Sent</div>
                    <div class="monitor-stat-value success">${m.state.sent}</div>
                </div>
                <div class="monitor-stat">
                    <div class="monitor-stat-label">Failed</div>
                    <div class="monitor-stat-value danger">${m.state.failed}</div>
                </div>
                <div class="monitor-stat">
                    <div class="monitor-stat-label">Remaining</div>
                    <div class="monitor-stat-value accent">${Math.max(0, m.state.total - m.state.sent - m.state.failed)}</div>
                </div>
            </div>

            <div class="monitor-progress-row">
                <div class="monitor-progress-header">
                    <div class="monitor-progress-status">${escapeHtml(m.state.statusText)}</div>
                    <div class="monitor-progress-percent">${pct}%</div>
                </div>
                <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
            </div>

            <div class="monitor-log" id="monitorLog-${id}">${logHtml || '<div class="monitor-log-entry info">Waiting for events…</div>'}</div>
        `;

        // Auto-scroll the log to the bottom
        const logEl = document.getElementById(`monitorLog-${id}`);
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
    };

    paint();

    // Tear down any previous subscription on this page (prevents leaks when
    // switching between monitors) then subscribe this one.
    if (container._unsubscribe) {
        try { container._unsubscribe(); } catch {}
    }
    container._unsubscribe = subscribeMonitor(id, paint);
}

function renderCampaigns() {
    const container = document.getElementById('campaignsContainer');
    if (!container) return;
    renderViewToggle('campaigns');

    if (campaigns.length === 0) {
        container.innerHTML = `
            <div class="card card-fill"><div class="empty-state">
                <svg class="empty-state-icon" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                <h3 class="empty-state-title">No Campaigns Yet</h3>
                <p class="empty-state-text">Create your first campaign to start sending emails.</p>
                <button class="btn btn-primary" onclick="showNewCampaignModal()">+ New Campaign</button>
            </div></div>`;
        return;
    }

    // Build per-campaign action buttons (shared between grid and table)
    const actionsHtml = (c) => `
        ${c.status === 'draft' || c.status === 'paused' ? `
            <button class="btn btn-success btn-sm" onclick="startCampaign(${c.id})" title="Send">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </button>
        ` : ''}
        ${c.status === 'sent' || c.status === 'completed' || c.status === 'failed' ? `
            <button class="btn btn-primary btn-sm" onclick="resendCampaign(${c.id})" title="Resend">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </button>
        ` : ''}
        ${c.status === 'sending' ? `
            <button class="btn btn-danger btn-sm" onclick="stopCampaign(${c.id})" title="Stop">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/></svg>
            </button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" onclick="editCampaign(${c.id})" title="Edit">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="duplicateCampaign(${c.id})" title="Clone">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
        </button>
        ${(c.status === 'draft' || c.status === 'paused') ? `
            <button class="btn btn-secondary btn-sm" onclick="openScheduleDialog(${c.id})" title="Schedule">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </button>
        ` : ''}
        <button class="btn btn-danger btn-sm" onclick="deleteCampaign(${c.id})" title="Delete">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
    `;

    if (getViewMode('campaigns') === 'grid') {
        container.innerHTML = `<div class="item-grid">${campaigns.map(c => `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-title">${escapeHtml(c.name)}</div>
                    <div class="item-card-badges">
                        <span class="badge badge-${getStatusClass(c.status)}">${c.status}</span>
                        ${c.scheduled_at && c.status === 'draft' ? `<span class="badge badge-blue" title="Scheduled ${c.scheduled_at}">⏰</span>` : ''}
                    </div>
                </div>
                <div class="item-card-subtitle">${escapeHtml(c.subject)}</div>
                <div class="item-card-meta">
                    <span><strong>${c.total_recipients || 0}</strong> recipients</span>
                    <span><strong>${c.sent_count || 0}</strong> sent</span>
                    ${c.failed_count > 0 ? `<span style="color:var(--red)"><strong>${c.failed_count}</strong> failed</span>` : ''}
                </div>
                <div class="item-card-progress">
                    <div class="progress"><div class="progress-fill" style="width:${getProgressPercent(c)}%"></div></div>
                </div>
                <div class="item-card-actions">${actionsHtml(c)}</div>
            </div>
        `).join('')}</div>`;
    } else {
        // List / table view
        container.innerHTML = `
            <div class="card card-fill"><div class="tbl-wrap"><table>
                <thead><tr><th>Name</th><th>Subject</th><th>Recipients</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                ${campaigns.map(c => `
                    <tr>
                        <td>${escapeHtml(c.name)}</td>
                        <td>${escapeHtml(c.subject)}</td>
                        <td>${c.total_recipients || 0}</td>
                        <td>
                            <span class="badge badge-${getStatusClass(c.status)}">${c.status}</span>
                            ${c.scheduled_at && c.status === 'draft' ? `<span class="badge badge-blue" title="Scheduled">⏰ ${formatScheduledAt(c.scheduled_at)}</span>` : ''}
                        </td>
                        <td>
                            <div class="progress" style="width:100px"><div class="progress-fill" style="width:${getProgressPercent(c)}%"></div></div>
                        </td>
                        <td><div class="actions-row">${actionsHtml(c)}</div></td>
                    </tr>
                `).join('')}
                </tbody>
            </table></div></div>
        `;
    }
}

let currentAttachment = null; // Store attachment data

async function showNewCampaignModal() {
    document.getElementById('campaignModalTitle').textContent = 'New Campaign';
    document.getElementById('campaignForm').reset();
    document.getElementById('campaignId').value = '';
    currentAttachment = null;
    document.getElementById('attachmentFileName').textContent = '';

    // Reset attachment source
    document.getElementById('attachmentSource').value = 'none';
    document.getElementById('libraryAttachmentOptions').style.display = 'none';
    document.getElementById('uploadAttachmentOptions').style.display = 'none';

    // Reset content type to HTML
    setContentType('html');

    // Load rotation lists and populate dropdowns (includes SMTP multi-select)
    await loadRotationLists();

    // Reset rotation data
    resetRotationData();

    // Populate library attachments dropdown
    populateLibraryAttachmentSelect();

    // Populate saved templates dropdown
    await populateTemplatesDropdown();

    document.getElementById('campaignModal').classList.add('active');

    // Draft autosave: bind listeners and check for existing unsaved draft
    attachDraftAutoSave();
    initRecipientsDropzone();
    const existingDraft = loadCampaignDraft();
    if (existingDraft) {
        showDraftRestoreBanner(existingDraft);
    } else {
        hideDraftRestoreBanner();
    }
}

// Saved templates handling
let savedTemplates = [];

async function loadSavedTemplates() {
    try {
        const data = await api('/user/templates');
        savedTemplates = data.templates || [];
        return savedTemplates;
    } catch (error) {
        console.error('Error loading templates:', error);
        savedTemplates = [];
        return [];
    }
}

async function populateTemplatesDropdown() {
    const select = document.getElementById('campaignTemplateSelect');
    if (!select) return;

    await loadSavedTemplates();

    select.innerHTML = '<option value="">-- Select a saved template --</option>';

    if (savedTemplates.length === 0) {
        select.innerHTML += '<option value="" disabled>No saved templates yet</option>';
    } else {
        savedTemplates.forEach(template => {
            const date = new Date(template.created_at).toLocaleDateString();
            select.innerHTML += `<option value="${template.id}">${template.name} (${date})</option>`;
        });
    }
}

function loadTemplateToBody() {
    const select = document.getElementById('campaignTemplateSelect');
    const templateId = select?.value;
    if (!templateId) return;

    const template = savedTemplates.find(t => t.id == templateId);
    if (template && template.html_content) {
        document.getElementById('campaignBody').value = template.html_content;
        setContentType('html');
        showToast(`Template "${template.name}" loaded`, 'success');
    }
}

async function refreshTemplatesList() {
    await populateTemplatesDropdown();
    showToast('Templates refreshed', 'success');
}

function handleAttachmentChange(input) {
    const file = input.files[0];
    const fileNameEl = document.getElementById('attachmentFileName');

    if (file) {
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            showToast('Attachment must be less than 10MB', 'error');
            input.value = '';
            currentAttachment = null;
            fileNameEl.textContent = '';
            return;
        }

        // Read file as base64
        const reader = new FileReader();
        reader.onload = function(e) {
            currentAttachment = {
                name: file.name,
                type: file.type,
                size: file.size,
                content: e.target.result.split(',')[1] // Remove data:...;base64, prefix
            };
            fileNameEl.textContent = `📎 ${file.name} (${formatFileSize(file.size)})`;
        };
        reader.readAsDataURL(file);
    } else {
        currentAttachment = null;
        fileNameEl.textContent = '';
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function removeAttachment() {
    currentAttachment = null;
    document.getElementById('campaignAttachment').value = '';
    document.getElementById('attachmentFileName').textContent = '';
}

function closeCampaignModal() {
    document.getElementById('campaignModal').classList.remove('active');
    // Cancel any pending debounced draft save
    clearTimeout(draftSaveTimer);
    hideDraftRestoreBanner();
}

async function saveCampaign() {
    const id = document.getElementById('campaignId').value;
    let name = document.getElementById('campaignName').value;
    if (!name) {
        name = 'Campaign ' + new Date().toLocaleString();
    }
    const subject = document.getElementById('campaignSubject').value;
    const bodyContent = document.getElementById('campaignBody').value;
    const contentType = document.getElementById('contentType').value;
    const recipientsText = document.getElementById('campaignRecipients').value;
    const reply_to = document.getElementById('campaignReplyTo').value || null;

    // Set body based on content type
    const body_html = contentType === 'html' ? bodyContent : null;
    const body_text = contentType === 'text' ? bodyContent : null;

    // Get first selected SMTP as default (rotation handled separately)
    const smtpSelect = document.getElementById('smtpIdsSelect');
    const selectedSmtps = Array.from(smtpSelect.selectedOptions).map(opt => opt.value);
    const smtp_config_id = selectedSmtps[0] || null;

    // Determine attachment source
    const attachmentSource = document.getElementById('attachmentSource').value;
    let attachment = null;
    let attachment_id = null;
    let attachment_format = 'html';
    let attachment_custom_name = null;

    if (attachmentSource === 'library') {
        // Library attachment
        attachment_id = document.getElementById('libraryAttachmentSelect').value || null;
        attachment_format = document.getElementById('attachmentFormat').value || 'html';
        attachment_custom_name = document.getElementById('attachmentCustomName').value.trim() || null;
    } else if (attachmentSource === 'upload' && currentAttachment) {
        // Direct upload
        attachment = {
            name: currentAttachment.name,
            content: currentAttachment.content,
            type: currentAttachment.type
        };
    }

    if (!name) {
        showToast('Please fill in campaign name', 'error');
        return;
    }

    if (!smtp_config_id) {
        showToast('Please select at least one SMTP server', 'error');
        return;
    }

    // Get rotation data
    const rotationData = getRotationData();

    // Check if subject is provided either manually or via rotation list
    const hasSubjectList = rotationData.subjects_list && rotationData.subjects_list.length > 0;
    if (!subject && !hasSubjectList) {
        showToast('Please enter a subject or select a subject list from Advanced: Content Rotation', 'error');
        return;
    }

    try {
        let campaignId = id;

        const campaignData = {
            name, subject, body_html, body_text, smtp_config_id, reply_to,
            attachment, attachment_id, attachment_format, attachment_custom_name,
            ...rotationData
        };

        if (id) {
            // Update existing
            await api(`/user/campaigns/${id}`, {
                method: 'PUT',
                body: JSON.stringify(campaignData)
            });
        } else {
            // Create new
            const data = await api('/user/campaigns', {
                method: 'POST',
                body: JSON.stringify(campaignData)
            });
            campaignId = data.campaign.id;
        }

        // Replace recipients with what's in the form
        if (recipientsText.trim()) {
            const rawLines = recipientsText.split('\n').map(e => e.trim()).filter(e => e);

            if (rawLines.length > 0) {
                const result = await api(`/user/campaigns/${campaignId}/recipients`, {
                    method: 'PUT',
                    body: JSON.stringify({ recipients: rawLines.map(email => ({ email })) })
                });
                // Show detailed import summary if anything was skipped
                if (result && (result.invalid > 0 || result.duplicates > 0)) {
                    const parts = [`Imported ${result.imported}`];
                    if (result.invalid > 0) parts.push(`${result.invalid} invalid`);
                    if (result.duplicates > 0) parts.push(`${result.duplicates} duplicate`);
                    showToast(parts.join(' • '), result.invalid > 0 ? 'warning' : 'info');
                }
            }
        }

        // Auto-save letter as template
        const letterContent = body_html || body_text;
        if (letterContent && name) {
            try {
                // Check if a template with same name already exists and update it
                const existing = savedTemplates.find(t => t.name === name);
                if (existing) {
                    await api(`/user/templates/${existing.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ name, html_content: letterContent })
                    });
                } else {
                    await api('/user/templates', {
                        method: 'POST',
                        body: JSON.stringify({ name, html_content: letterContent })
                    });
                }
            } catch (e) { /* template save is non-critical */ }
        }

        showToast(id ? 'Campaign updated!' : 'Campaign created!', 'success');
        clearCampaignDraft();
        closeCampaignModal();
        loadCampaigns();

    } catch (error) {
        showToast('Failed to save campaign: ' + error.message, 'error');
    }
}

async function editCampaign(id) {
    try {
        const data = await api(`/user/campaigns/${id}`);
        const c = data.campaign;

        document.getElementById('campaignModalTitle').textContent = 'Edit Campaign';
        document.getElementById('campaignId').value = c.id;
        document.getElementById('campaignName').value = c.name;
        document.getElementById('campaignSubject').value = c.subject;
        document.getElementById('campaignReplyTo').value = c.reply_to || '';

        // Set content type and body
        if (c.body_text && !c.body_html) {
            setContentType('text');
            document.getElementById('campaignBody').value = c.body_text || '';
        } else {
            setContentType('html');
            document.getElementById('campaignBody').value = c.body_html || '';
        }

        // Handle existing attachment - determine source
        currentAttachment = null;
        document.getElementById('campaignAttachment').value = '';
        const fileNameEl = document.getElementById('attachmentFileName');
        fileNameEl.textContent = '';

        // Populate library attachments dropdown first
        populateLibraryAttachmentSelect();

        // Populate saved templates dropdown
        await populateTemplatesDropdown();

        if (c.attachment_id) {
            // Library attachment
            document.getElementById('attachmentSource').value = 'library';
            document.getElementById('libraryAttachmentOptions').style.display = 'block';
            document.getElementById('uploadAttachmentOptions').style.display = 'none';
            document.getElementById('libraryAttachmentSelect').value = c.attachment_id;
            document.getElementById('attachmentFormat').value = c.attachment_format || 'html';
            document.getElementById('attachmentCustomName').value = c.attachment_custom_name || '';
        } else if (c.attachment_name) {
            // Direct upload attachment
            document.getElementById('attachmentSource').value = 'upload';
            document.getElementById('libraryAttachmentOptions').style.display = 'none';
            document.getElementById('uploadAttachmentOptions').style.display = 'block';
            fileNameEl.textContent = `📎 ${c.attachment_name} (existing)`;
            currentAttachment = { name: c.attachment_name, existing: true };
        } else {
            // No attachment
            document.getElementById('attachmentSource').value = 'none';
            document.getElementById('libraryAttachmentOptions').style.display = 'none';
            document.getElementById('uploadAttachmentOptions').style.display = 'none';
        }

        // Load rotation lists and set rotation data (including SMTP multi-select)
        await loadRotationLists();
        setRotationData(c);

        // Ensure at least the primary SMTP is selected if no rotation list
        if (c.smtp_config_id && !c.smtp_rotation_list_id) {
            const smtpSelect = document.getElementById('smtpIdsSelect');
            for (const opt of smtpSelect.options) {
                opt.selected = opt.value == c.smtp_config_id;
            }
        }

        // Show existing recipients
        document.getElementById('campaignRecipients').value =
            data.recipients.map(r => r.email).join('\n');

        document.getElementById('campaignModal').classList.add('active');

        // Draft autosave + dropzone: bind listeners and check for existing unsaved draft
        attachDraftAutoSave();
        initRecipientsDropzone();
        const existingDraft = loadCampaignDraft();
        if (existingDraft && existingDraft.saved_at > (new Date(c.updated_at || c.created_at).getTime())) {
            showDraftRestoreBanner(existingDraft);
        } else {
            hideDraftRestoreBanner();
        }

    } catch (error) {
        showToast('Failed to load campaign: ' + error.message, 'error');
    }
}

async function cloneCampaign(id) {
    try {
        const data = await api(`/user/campaigns/${id}`);
        const c = data.campaign;

        document.getElementById('campaignModalTitle').textContent = 'New Campaign (from Template)';
        document.getElementById('campaignId').value = ''; // No ID = creates new
        document.getElementById('campaignName').value = c.name + ' (copy)';
        document.getElementById('campaignSubject').value = c.subject;
        document.getElementById('campaignReplyTo').value = c.reply_to || '';

        if (c.body_text && !c.body_html) {
            setContentType('text');
            document.getElementById('campaignBody').value = c.body_text || '';
        } else {
            setContentType('html');
            document.getElementById('campaignBody').value = c.body_html || '';
        }

        currentAttachment = null;
        document.getElementById('campaignAttachment').value = '';
        document.getElementById('attachmentFileName').textContent = '';
        populateLibraryAttachmentSelect();
        await populateTemplatesDropdown();

        if (c.attachment_id) {
            document.getElementById('attachmentSource').value = 'library';
            document.getElementById('libraryAttachmentOptions').style.display = 'block';
            document.getElementById('uploadAttachmentOptions').style.display = 'none';
            document.getElementById('libraryAttachmentSelect').value = c.attachment_id;
            document.getElementById('attachmentFormat').value = c.attachment_format || 'html';
            document.getElementById('attachmentCustomName').value = c.attachment_custom_name || '';
        } else {
            document.getElementById('attachmentSource').value = 'none';
            document.getElementById('libraryAttachmentOptions').style.display = 'none';
            document.getElementById('uploadAttachmentOptions').style.display = 'none';
        }

        await loadRotationLists();
        setRotationData(c);

        if (c.smtp_config_id) {
            const smtpSelect = document.getElementById('smtpIdsSelect');
            for (const opt of smtpSelect.options) {
                opt.selected = opt.value == c.smtp_config_id;
            }
        }

        // Leave recipients empty for user to fill
        document.getElementById('campaignRecipients').value = '';

        document.getElementById('campaignModal').classList.add('active');
        showToast('Template loaded — add recipients and send', 'info');
    } catch (error) {
        showToast('Failed to load template: ' + error.message, 'error');
    }
}

// ===== Campaign scheduling =====
function formatScheduledAt(iso) {
    if (!iso) return '';
    try {
        // SQLite format: "2026-04-11 15:00:00"
        const d = new Date(iso.replace(' ', 'T') + 'Z');
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}

/**
 * Open a small browser prompt to pick a datetime and schedule the campaign.
 * Uses prompt() for simplicity — a full modal would be overkill for v1.
 */
async function openScheduleDialog(campaignId) {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign) return;

    // Build default value: current scheduled time, or now + 1 hour
    const existing = campaign.scheduled_at;
    const defaultDate = existing
        ? new Date(existing.replace(' ', 'T') + 'Z')
        : new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const defaultStr = `${defaultDate.getFullYear()}-${pad(defaultDate.getMonth() + 1)}-${pad(defaultDate.getDate())}T${pad(defaultDate.getHours())}:${pad(defaultDate.getMinutes())}`;

    const message = existing
        ? `Campaign "${campaign.name}" is currently scheduled for ${formatScheduledAt(existing)}.\n\nEnter new date/time (YYYY-MM-DDTHH:MM) or leave blank to cancel the schedule:`
        : `Schedule campaign "${campaign.name}"\n\nEnter date/time (YYYY-MM-DDTHH:MM):`;

    const input = prompt(message, defaultStr);
    if (input === null) return; // User cancelled

    // Empty string = clear schedule
    const scheduled_at = input.trim() === '' ? null : input.trim();

    try {
        const result = await api(`/user/campaigns/${campaignId}/schedule`, {
            method: 'POST',
            body: JSON.stringify({ scheduled_at })
        });
        showToast(result.message, 'success');
        loadCampaigns();
    } catch (error) {
        showToast('Failed to schedule: ' + error.message, 'error');
    }
}

/**
 * One-click clone — hits the backend, refreshes the campaigns list.
 * For the "load as template into editor" flow, use cloneCampaign() instead.
 */
async function duplicateCampaign(id) {
    try {
        const result = await api(`/user/campaigns/${id}/clone`, { method: 'POST' });
        showToast(`Cloned: ${result.campaign?.name || 'copy created'}`, 'success');
        loadCampaigns();
    } catch (error) {
        showToast('Failed to clone campaign: ' + error.message, 'error');
    }
}

async function deleteCampaign(id) {
    if (!confirm('Are you sure you want to delete this campaign?')) return;

    try {
        await api(`/user/campaigns/${id}`, { method: 'DELETE' });
        showToast('Campaign deleted', 'success');
        loadCampaigns();
    } catch (error) {
        showToast('Failed to delete campaign: ' + error.message, 'error');
    }
}

/**
 * Kick off a campaign. Creates a monitor, opens an SSE connection, and
 * navigates to the monitor page. Multiple campaigns can run concurrently —
 * each has its own monitor entry in `campaignMonitors`.
 */
async function startCampaign(id) {
    const campaignId = Number(id);
    const campaign = campaigns.find(c => c.id === campaignId) || { name: `Campaign ${campaignId}` };

    // Re-use existing monitor if one already exists (e.g. user clicked Send again)
    let monitor = getMonitor(campaignId);
    if (!monitor) {
        monitor = createMonitor(campaignId, campaign.name);
    } else {
        // Reset state for a fresh run
        monitor.name = campaign.name;
        monitor.state.sent = 0;
        monitor.state.failed = 0;
        monitor.state.total = 0;
        monitor.state.status = 'starting';
        monitor.state.statusText = 'Starting…';
        monitor.state.log = [];
        monitor.state.startedAt = Date.now();
    }

    appendMonitorLog(monitor, 'info', 'Sending start request…');
    renderRunningStrip();

    // Navigate to the monitor page immediately so the user sees feedback
    go('monitor:' + campaignId);

    try {
        const result = await api(`/send/${campaignId}/start`, { method: 'POST' });
        appendMonitorLog(monitor, 'info', `Campaign started — ${result.pending || 'unknown'} recipients pending`);
        monitor.state.status = 'running';
        notifyMonitor(campaignId);

        // Open the SSE connection
        const token = localStorage.getItem('accessToken');
        const es = new EventSource(`/api/send/${campaignId}/progress${token ? '?token=' + encodeURIComponent(token) : ''}`);
        monitor.eventSource = es;

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleMonitorEvent(campaignId, data);
            } catch (e) {
                console.error('Failed to parse SSE event:', e);
            }
        };

        es.onerror = () => {
            const m = getMonitor(campaignId);
            if (!m) return;
            // Only treat it as disconnect if campaign isn't already finished
            if (m.state.status === 'running' || m.state.status === 'starting') {
                appendMonitorLog(m, 'warning', 'Connection interrupted. Results may be incomplete.');
                notifyMonitor(campaignId);
            }
            if (m.eventSource) { try { m.eventSource.close(); } catch {} m.eventSource = null; }
        };
    } catch (error) {
        console.error('Start campaign error:', error);
        monitor.state.status = 'failed';
        monitor.state.statusText = 'Failed to start';
        appendMonitorLog(monitor, 'failed', `Error: ${error.message}`);
        notifyMonitor(campaignId);
        showToast('Failed to start campaign: ' + error.message, 'error');
    }
}

/**
 * Stop a specific campaign monitor. Calls the backend stop endpoint.
 */
async function stopMonitor(campaignId) {
    try {
        await api(`/send/${campaignId}/stop`, { method: 'POST' });
        // The SSE 'stopped' event will update the UI
    } catch (error) {
        showToast('Failed to stop: ' + error.message, 'error');
    }
}

/**
 * Close a monitor tab — removes it from the running strip. If the campaign
 * is still active, it first stops it, then removes. If it was the currently-
 * viewed monitor, navigate back to Campaigns.
 */
async function closeMonitor(campaignId) {
    const id = Number(campaignId);
    const m = getMonitor(id);
    if (!m) return;

    // Still running? Ask for confirmation and stop it first
    if (m.state.status === 'running' || m.state.status === 'starting') {
        if (!confirm(`"${m.name}" is still running. Stop and close?`)) return;
        await stopMonitor(id);
    }

    removeMonitor(id);
    if (window.currentlyViewedMonitorId === id) {
        window.currentlyViewedMonitorId = null;
        go('campaigns');
    }
}

/**
 * Legacy alias kept in case any table-rendered stopCampaign() buttons still exist.
 * Delegates to the monitor-aware stopMonitor().
 */
async function stopCampaign(id) {
    const numId = Number(id);
    // Prefer the monitor flow if a monitor exists
    if (getMonitor(numId)) {
        return stopMonitor(numId);
    }
    // Fallback: direct API call for campaigns that were started in a previous session
    try {
        await api(`/send/${numId}/stop`, { method: 'POST' });
        showToast('Campaign stopped', 'success');
        loadCampaigns();
    } catch (error) {
        showToast('Failed to stop campaign: ' + error.message, 'error');
    }
}

async function resendCampaign(id) {
    if (!confirm('Are you sure you want to resend this campaign? This will reset and resend to all recipients.')) {
        return;
    }

    try {
        // First reset the campaign status
        await api(`/user/campaigns/${id}/reset`, { method: 'POST' });
        showToast('Campaign reset for resending...', 'info');

        // Then start it
        await loadCampaigns();
        startCampaign(id);
    } catch (error) {
        showToast('Failed to resend campaign: ' + error.message, 'error');
    }
}

// ===== SMTP =====
async function loadSmtpConfigs() {
    try {
        const data = await api('/user/smtp');
        smtpConfigs = data.smtp_configs || [];
        renderSmtpConfigs();
    } catch (error) {
        showToast('Failed to load SMTP configs: ' + error.message, 'error');
    }
}

function renderSmtpConfigs() {
    const container = document.getElementById('smtpList');
    if (!container) return;
    renderViewToggle('smtp');
    const providerLabels = { smtp: 'SMTP', sendgrid: 'SendGrid', mailgun: 'Mailgun', amazon_ses: 'Amazon SES', postmark: 'Postmark', sparkpost: 'SparkPost', gsuite: 'Gmail/GSuite' };

    if (smtpConfigs.length === 0) {
        container.innerHTML = `
            <div class="card card-fill"><div class="empty-state">
                <svg class="empty-state-icon" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"/>
                </svg>
                <h3 class="empty-state-title">No Email Servers</h3>
                <p class="empty-state-text">Add your first email server or API provider to start sending.</p>
                <button class="btn btn-primary" onclick="showNewSmtpModal()">+ Add Email Server</button>
            </div></div>
        `;
        return;
    }

    const actionsHtml = (s) => `
        <button class="btn btn-info btn-sm" onclick="testSavedSmtp(${s.id})" title="Test connection">Test</button>
        ${!s.is_active ? `<button class="btn btn-secondary btn-sm" onclick="activateSmtp(${s.id})">Set Active</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="editSmtp(${s.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSmtp(${s.id})">Delete</button>
    `;

    if (getViewMode('smtp') === 'grid') {
        container.innerHTML = `<div class="item-grid">${smtpConfigs.map(s => {
            const prov = s.provider || 'smtp';
            const provLabel = providerLabels[prov] || prov.toUpperCase();
            const isApi = ['sendgrid', 'mailgun', 'postmark', 'sparkpost'].includes(prov);
            const detail = isApi
                ? (s.from_email || s.api_domain || 'API')
                : `${escapeHtml(s.host || '')}:${s.port} \u2022 ${escapeHtml(s.username || '')}`;
            return `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-title">${escapeHtml(s.name)}</div>
                    <div class="item-card-badges">
                        <span class="badge badge-accent">${provLabel}</span>
                        ${s.is_active ? '<span class="badge badge-green">Active</span>' : ''}
                    </div>
                </div>
                <div class="item-card-subtitle" style="font-family:var(--mono);font-size:11px">${detail}</div>
                <div class="item-card-actions">${actionsHtml(s)}</div>
            </div>`;
        }).join('')}</div>`;
    } else {
        container.innerHTML = `
            <div class="card card-fill"><div class="tbl-wrap"><table>
                <thead><tr><th>Name</th><th>Provider</th><th>Host / From</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                ${smtpConfigs.map(s => {
                    const prov = s.provider || 'smtp';
                    const provLabel = providerLabels[prov] || prov.toUpperCase();
                    const isApi = ['sendgrid', 'mailgun', 'postmark', 'sparkpost'].includes(prov);
                    const detail = isApi
                        ? escapeHtml(s.from_email || s.api_domain || 'API')
                        : `${escapeHtml(s.host || '')}:${s.port} \u2022 ${escapeHtml(s.username || '')}`;
                    return `
                    <tr>
                        <td><strong>${escapeHtml(s.name)}</strong></td>
                        <td><span class="badge badge-accent">${provLabel}</span></td>
                        <td style="font-family:var(--mono);font-size:11px">${detail}</td>
                        <td>${s.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
                        <td><div class="actions-row">${actionsHtml(s)}</div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div></div>
        `;
    }
}

function showNewSmtpModal() {
    document.getElementById('smtpModalTitle').textContent = 'Add Email Server';
    document.getElementById('smtpForm').reset();
    document.getElementById('smtpId').value = '';
    document.getElementById('smtpPort').value = '587';
    document.getElementById('smtpProvider').value = 'smtp';
    if (typeof toggleSmtpProvider === 'function') toggleSmtpProvider();
    document.getElementById('smtpModal').classList.add('active');
}

function closeSmtpModal() {
    document.getElementById('smtpModal').classList.remove('active');
}

/**
 * Test a previously-saved SMTP config directly from the grid/list (no modal).
 * The backend loads and decrypts the stored credentials server-side.
 */
async function testSavedSmtp(id) {
    showToast('Testing connection…', 'info');
    try {
        const data = await api(`/user/smtp/${id}/test`, { method: 'POST' });
        showToast(data.message || 'Connection successful!', 'success');
    } catch (error) {
        showToast('Test failed: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function testSmtp() {
    const provider = document.getElementById('smtpProvider').value;
    const isApiProvider = ['sendgrid', 'mailgun', 'postmark', 'sparkpost'].includes(provider);

    const payload = { provider };

    if (isApiProvider) {
        const apiKey = document.getElementById('smtpApiKey').value;
        if (!apiKey) { showToast('Fill in the API key first', 'warning'); return; }
        payload.api_key = apiKey;
        if (provider === 'mailgun') {
            payload.api_domain = document.getElementById('smtpApiDomain').value;
            payload.api_region = document.getElementById('smtpApiRegion').value;
            if (!payload.api_domain) { showToast('Fill in the Mailgun domain', 'warning'); return; }
        }
        if (provider === 'sparkpost') {
            payload.api_region = document.getElementById('smtpApiRegionOnly').value;
        }
    } else {
        payload.host = document.getElementById('smtpHost').value;
        payload.port = parseInt(document.getElementById('smtpPort').value);
        payload.auth_type = document.getElementById('smtpAuthType').value;
        payload.secure = document.getElementById('smtpSecure').value;
        payload.username = document.getElementById('smtpUsername').value;
        payload.password = document.getElementById('smtpPassword').value;
        if (provider === 'amazon_ses') {
            payload.api_region = document.getElementById('smtpApiRegionOnly').value;
        }

        if (provider === 'smtp' && !payload.host) { showToast('Fill in the host first', 'warning'); return; }
        if (provider === 'smtp' && payload.auth_type !== 'none' && (!payload.username || !payload.password)) {
            showToast('Fill in credentials for this auth type', 'warning'); return;
        }
    }

    showToast('Testing connection...', 'info');
    try {
        const data = await api('/user/smtp/test', { method: 'POST', body: JSON.stringify(payload) });
        showToast(data.message || 'Connection successful!', 'success');
    } catch (error) {
        showToast('Test failed: ' + error.message, 'error');
    }
}

async function saveSmtp() {
    const id = document.getElementById('smtpId').value;
    const provider = document.getElementById('smtpProvider').value;
    const isApiProvider = ['sendgrid', 'mailgun', 'postmark', 'sparkpost'].includes(provider);

    const data = {
        name: document.getElementById('smtpName').value,
        provider,
        from_email: document.getElementById('smtpFromEmail').value,
        from_name: document.getElementById('smtpFromName').value
    };

    if (isApiProvider) {
        const apiKey = document.getElementById('smtpApiKey').value;
        if (!id && !apiKey) { showToast('API key is required', 'error'); return; }
        if (apiKey) data.api_key = apiKey;
        if (provider === 'mailgun') {
            data.api_domain = document.getElementById('smtpApiDomain').value;
            data.api_region = document.getElementById('smtpApiRegion').value;
            if (!data.api_domain) { showToast('Mailgun domain is required', 'error'); return; }
        }
        if (provider === 'sparkpost') {
            data.api_region = document.getElementById('smtpApiRegionOnly').value;
        }
    } else {
        data.host = document.getElementById('smtpHost').value;
        data.port = parseInt(document.getElementById('smtpPort').value);
        data.auth_type = document.getElementById('smtpAuthType').value;
        data.secure = document.getElementById('smtpSecure').value;
        data.username = document.getElementById('smtpUsername').value;
        data.password = document.getElementById('smtpPassword').value;

        if (provider === 'amazon_ses') {
            data.api_region = document.getElementById('smtpApiRegionOnly').value;
        }

        if (provider === 'smtp' && !data.host) { showToast('Please fill in the host', 'error'); return; }
        if (provider === 'smtp' && data.auth_type !== 'none' && !id && (!data.username || !data.password)) {
            showToast('Credentials are required for this auth type', 'error'); return;
        }
    }

    try {
        if (id) {
            await api(`/user/smtp/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await api('/user/smtp', { method: 'POST', body: JSON.stringify(data) });
        }

        showToast(id ? 'Configuration updated!' : 'Configuration added!', 'success');
        closeSmtpModal();
        loadSmtpConfigs();
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

function editSmtp(id) {
    const smtp = smtpConfigs.find(s => s.id === id);
    if (!smtp) return;

    document.getElementById('smtpForm').reset();
    document.getElementById('smtpId').value = smtp.id;
    document.getElementById('smtpName').value = smtp.name || '';
    document.getElementById('smtpProvider').value = smtp.provider || 'smtp';

    // SMTP fields
    document.getElementById('smtpHost').value = smtp.host || '';
    document.getElementById('smtpPort').value = smtp.port || 587;
    document.getElementById('smtpAuthType').value = smtp.auth_type || 'login';
    if (smtp.secure === 1 || smtp.port === 465) {
        document.getElementById('smtpSecure').value = 'ssl';
    } else if (smtp.port === 25) {
        document.getElementById('smtpSecure').value = 'none';
    } else {
        document.getElementById('smtpSecure').value = 'starttls';
    }
    document.getElementById('smtpUsername').value = smtp.username || '';
    document.getElementById('smtpPassword').value = '';

    // API fields
    document.getElementById('smtpApiKey').value = '';
    document.getElementById('smtpApiDomain').value = smtp.api_domain || '';
    // Set region dropdowns
    if (smtp.api_region) {
        const regionSelect = document.getElementById('smtpApiRegion');
        const regionOnlySelect = document.getElementById('smtpApiRegionOnly');
        if (regionSelect) regionSelect.value = smtp.api_region;
        // Defer setting regionOnly until after toggleSmtpProvider sets the options
        setTimeout(() => { if (regionOnlySelect) regionOnlySelect.value = smtp.api_region; }, 0);
    }

    // From fields
    document.getElementById('smtpFromEmail').value = smtp.from_email || '';
    document.getElementById('smtpFromName').value = smtp.from_name || '';

    // Toggle UI for provider
    if (typeof toggleSmtpProvider === 'function') toggleSmtpProvider();
    if (smtp.provider === 'smtp' || !smtp.provider) toggleSmtpAuth();
    document.getElementById('smtpModal').classList.add('active');
}

async function deleteSmtp(id) {
    if (!confirm('Are you sure you want to delete this SMTP configuration?')) return;

    try {
        await api(`/user/smtp/${id}`, { method: 'DELETE' });
        showToast('SMTP deleted', 'success');
        loadSmtpConfigs();
    } catch (error) {
        showToast('Failed to delete SMTP: ' + error.message, 'error');
    }
}

async function activateSmtp(id) {
    try {
        await api(`/user/smtp/${id}/activate`, { method: 'POST' });
        showToast('SMTP activated', 'success');
        loadSmtpConfigs();
    } catch (error) {
        showToast('Failed to activate SMTP: ' + error.message, 'error');
    }
}

// ===== Attachment Library =====
async function loadAttachments() {
    try {
        const data = await api('/user/attachments');
        attachments = data.attachments || [];
        renderAttachments();
        populateLibraryAttachmentSelect();
    } catch (error) {
        showToast('Failed to load attachments: ' + error.message, 'error');
    }
}

function renderAttachments() {
    const container = document.getElementById('attachmentsContainer');
    if (!container) return;
    renderViewToggle('attachments');

    if (attachments.length === 0) {
        container.innerHTML = `
            <div class="card card-fill"><div class="empty-state">
                <svg class="empty-state-icon" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                <h3 class="empty-state-title">No Attachments Yet</h3>
                <p class="empty-state-text">Create HTML templates or upload files to attach to campaigns.</p>
                <button class="btn btn-primary" onclick="showAttachmentModal()">+ New Attachment</button>
            </div></div>`;
        return;
    }

    const actionsHtml = (a, isFile) => `
        <button class="btn btn-secondary btn-sm" onclick="editLibraryAttachment(${a.id})">Edit</button>
        ${!isFile ? `<button class="btn btn-secondary btn-sm" onclick="previewSavedAttachment(${a.id}, 'html')">Preview</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="deleteLibraryAttachment(${a.id})">Delete</button>
    `;

    if (getViewMode('attachments') === 'grid') {
        container.innerHTML = `<div class="item-grid">${attachments.map(a => {
            const isFile = !!a.file_name;
            const type = isFile ? getFileExtension(a.file_name).toUpperCase() : 'HTML';
            const size = isFile ? formatFileSize(a.file_size) : formatFileSize(new Blob([a.html_content || '']).size);
            const typeBadge = getFileTypeBadge(type);
            return `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-title">${escapeHtml(a.name)}</div>
                    <div class="item-card-badges">${typeBadge}</div>
                </div>
                <div class="item-card-subtitle">${escapeHtml(a.description) || (isFile ? escapeHtml(a.file_name) : 'HTML template')}</div>
                <div class="item-card-meta">
                    <span><strong>${size}</strong></span>
                    ${a.tags ? `<span>${escapeHtml(a.tags)}</span>` : ''}
                </div>
                <div class="item-card-actions">${actionsHtml(a, isFile)}</div>
            </div>`;
        }).join('')}</div>`;
    } else {
        container.innerHTML = `
            <div class="card card-fill"><div class="tbl-wrap"><table>
                <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Description</th><th>Tags</th><th>Actions</th></tr></thead>
                <tbody>
                ${attachments.map(a => {
                    const isFile = !!a.file_name;
                    const type = isFile ? getFileExtension(a.file_name).toUpperCase() : 'HTML';
                    const size = isFile ? formatFileSize(a.file_size) : formatFileSize(new Blob([a.html_content || '']).size);
                    return `
                    <tr>
                        <td><strong>${escapeHtml(a.name)}</strong>${isFile ? '<br><span class="form-hint">' + escapeHtml(a.file_name) + '</span>' : ''}</td>
                        <td>${getFileTypeBadge(type)}</td>
                        <td>${size}</td>
                        <td>${escapeHtml(a.description) || '-'}</td>
                        <td>${a.tags ? escapeHtml(a.tags) : '-'}</td>
                        <td><div style="display:flex;gap:4px">${actionsHtml(a, isFile)}</div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div></div>`;
    }
}

function getFileExtension(filename) {
    return (filename || '').split('.').pop() || '';
}

function getFileTypeBadge(type) {
    const colors = {
        'HTML': 'badge-blue', 'PDF': 'badge-red', 'DOCX': 'badge-blue', 'DOC': 'badge-blue',
        'XLSX': 'badge-green', 'XLS': 'badge-green', 'CSV': 'badge-green',
        'JPG': 'badge-yellow', 'JPEG': 'badge-yellow', 'PNG': 'badge-yellow', 'GIF': 'badge-yellow', 'WEBP': 'badge-yellow',
        'SVG': 'badge-info', 'TXT': 'badge-gray', 'ZIP': 'badge-gray'
    };
    return `<span class="badge ${colors[type] || 'badge-gray'}">${type}</span>`;
}

function populateLibraryAttachmentSelect() {
    const select = document.getElementById('libraryAttachmentSelect');
    if (!select) return;

    select.innerHTML = '<option value="">Select from library...</option>' +
        attachments.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
}

let libraryFileData = null; // Stores file upload for library attachments

function showAttachmentModal() {
    document.getElementById('attachmentModalTitle').textContent = 'New Attachment';
    document.getElementById('attachmentLibraryForm').reset();
    document.getElementById('editAttachmentId').value = '';
    document.getElementById('attachmentType').value = 'html';
    document.getElementById('attachmentHtmlGroup').style.display = 'block';
    document.getElementById('attachmentFileGroup').style.display = 'none';
    document.getElementById('attachmentFileInfo').textContent = '';
    document.getElementById('previewAttachmentBtn').style.display = '';
    libraryFileData = null;
    document.getElementById('attachmentLibraryModal').classList.add('active');
}

function toggleAttachmentType() {
    const type = document.getElementById('attachmentType').value;
    document.getElementById('attachmentHtmlGroup').style.display = type === 'html' ? 'block' : 'none';
    document.getElementById('attachmentFileGroup').style.display = type === 'file' ? 'block' : 'none';
    document.getElementById('previewAttachmentBtn').style.display = type === 'html' ? '' : 'none';
}

function handleLibraryFileChange(input) {
    const file = input.files[0];
    const infoEl = document.getElementById('attachmentFileInfo');
    if (!file) { libraryFileData = null; infoEl.textContent = ''; return; }

    if (file.size > 10 * 1024 * 1024) {
        showToast('File must be less than 10MB', 'error');
        input.value = '';
        libraryFileData = null;
        infoEl.textContent = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        libraryFileData = {
            name: file.name,
            type: file.type,
            size: file.size,
            content: e.target.result.split(',')[1]
        };
        infoEl.innerHTML = '<strong>' + escapeHtml(file.name) + '</strong> (' + formatFileSize(file.size) + ')';
        // Auto-fill attachment name if empty
        const nameInput = document.getElementById('attachmentName');
        if (!nameInput.value) {
            nameInput.value = file.name.replace(/\.[^/.]+$/, '');
        }
    };
    reader.readAsDataURL(file);
}

function closeAttachmentModal() {
    document.getElementById('attachmentLibraryModal').classList.remove('active');
}

async function editLibraryAttachment(id) {
    try {
        const data = await api(`/user/attachments/${id}`);
        const a = data.attachment;

        document.getElementById('attachmentModalTitle').textContent = 'Edit Attachment';
        document.getElementById('editAttachmentId').value = a.id;
        document.getElementById('attachmentName').value = a.name;
        document.getElementById('attachmentDescription').value = a.description || '';
        document.getElementById('attachmentTags').value = a.tags || '';

        libraryFileData = null;
        if (a.file_name) {
            document.getElementById('attachmentType').value = 'file';
            document.getElementById('attachmentHtmlGroup').style.display = 'none';
            document.getElementById('attachmentFileGroup').style.display = 'block';
            document.getElementById('attachmentFileInfo').innerHTML = '<strong>' + escapeHtml(a.file_name) + '</strong> (' + formatFileSize(a.file_size) + ')';
            document.getElementById('previewAttachmentBtn').style.display = 'none';
            document.getElementById('attachmentHtmlContent').value = '';
        } else {
            document.getElementById('attachmentType').value = 'html';
            document.getElementById('attachmentHtmlGroup').style.display = 'block';
            document.getElementById('attachmentFileGroup').style.display = 'none';
            document.getElementById('previewAttachmentBtn').style.display = '';
            document.getElementById('attachmentHtmlContent').value = a.html_content || '';
        }

        document.getElementById('attachmentLibraryModal').classList.add('active');
    } catch (error) {
        showToast('Failed to load attachment: ' + error.message, 'error');
    }
}

async function saveLibraryAttachment() {
    const id = document.getElementById('editAttachmentId').value;
    const attachType = document.getElementById('attachmentType').value;
    const data = {
        name: document.getElementById('attachmentName').value,
        description: document.getElementById('attachmentDescription').value,
        tags: document.getElementById('attachmentTags').value
    };

    if (!data.name) {
        showToast('Name is required', 'error');
        return;
    }

    if (attachType === 'html') {
        data.html_content = document.getElementById('attachmentHtmlContent').value;
        if (!data.html_content) {
            showToast('HTML content is required', 'error');
            return;
        }
    } else if (attachType === 'file') {
        if (!libraryFileData && !id) {
            showToast('Please select a file to upload', 'error');
            return;
        }
        if (libraryFileData) {
            data.file_name = libraryFileData.name;
            data.file_content = libraryFileData.content;
            data.file_type = libraryFileData.type;
            data.file_size = libraryFileData.size;
        }
    }

    try {
        if (id) {
            await api(`/user/attachments/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Attachment updated!', 'success');
        } else {
            await api('/user/attachments', { method: 'POST', body: JSON.stringify(data) });
            showToast('Attachment created!', 'success');
        }

        closeAttachmentModal();
        loadAttachments();
    } catch (error) {
        showToast('Failed to save attachment: ' + error.message, 'error');
    }
}

async function deleteLibraryAttachment(id) {
    if (!confirm('Are you sure you want to delete this attachment?')) return;

    try {
        await api(`/user/attachments/${id}`, { method: 'DELETE' });
        showToast('Attachment deleted', 'success');
        loadAttachments();
    } catch (error) {
        showToast('Failed to delete attachment: ' + error.message, 'error');
    }
}

async function previewLibraryAttachment(format) {
    const htmlContent = document.getElementById('attachmentHtmlContent').value;
    if (!htmlContent) {
        showToast('Enter HTML content to preview', 'error');
        return;
    }

    // For simple HTML preview, just show in iframe
    const frame = document.getElementById('attachmentPreviewFrame');
    frame.srcdoc = htmlContent;
    document.getElementById('attachmentPreviewModal').classList.add('active');
}

async function previewSavedAttachment(id, format) {
    try {
        const data = await api(`/user/attachments/${id}/preview`, {
            method: 'POST',
            body: JSON.stringify({ format })
        });

        const frame = document.getElementById('attachmentPreviewFrame');

        if (format === 'html') {
            // Decode base64 and show HTML
            const html = atob(data.content);
            frame.srcdoc = html;
        } else {
            // For other formats, create blob and show
            const blob = base64ToBlob(data.content, data.mimeType);
            frame.src = URL.createObjectURL(blob);
        }

        document.getElementById('attachmentPreviewModal').classList.add('active');
    } catch (error) {
        showToast('Failed to preview: ' + error.message, 'error');
    }
}

function closeAttachmentPreview() {
    document.getElementById('attachmentPreviewModal').classList.remove('active');
    document.getElementById('attachmentPreviewFrame').srcdoc = '';
    document.getElementById('attachmentPreviewFrame').src = 'about:blank';
}

async function downloadAttachment(id, format) {
    try {
        const response = await fetch(`/api/user/attachments/${id}/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ format })
        });

        if (!response.ok) throw new Error('Download failed');

        const blob = await response.blob();
        const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || `attachment.${format}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        showToast(`Downloaded as ${format.toUpperCase()}`, 'success');
    } catch (error) {
        showToast('Failed to download: ' + error.message, 'error');
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

function toggleAttachmentSource() {
    const source = document.getElementById('attachmentSource').value;
    const libraryOptions = document.getElementById('libraryAttachmentOptions');
    const uploadOptions = document.getElementById('uploadAttachmentOptions');

    libraryOptions.style.display = source === 'library' ? 'block' : 'none';
    uploadOptions.style.display = source === 'upload' ? 'block' : 'none';
}

function toggleSmtpRotationType() {
    const smtpSelect = document.getElementById('smtpIdsSelect');
    const rotationGroup = document.getElementById('smtpRotationTypeGroup');
    const selectedCount = Array.from(smtpSelect.selectedOptions).length;
    rotationGroup.style.display = selectedCount > 1 ? 'block' : 'none';
}

function setContentType(type) {
    const htmlToggle = document.getElementById('htmlToggle');
    const textToggle = document.getElementById('textToggle');
    const contentTypeInput = document.getElementById('contentType');
    const bodyTextarea = document.getElementById('campaignBody');
    const previewBtn = document.getElementById('previewBtn');

    contentTypeInput.value = type;

    if (type === 'html') {
        htmlToggle.classList.add('active');
        textToggle.classList.remove('active');
        bodyTextarea.placeholder = '<p>Hello {RECIPIENT_NAME},</p>\n<a href="{LINK}">Click Here</a>';
        bodyTextarea.classList.add('code-editor');
        previewBtn.style.display = 'inline-flex';
    } else {
        textToggle.classList.add('active');
        htmlToggle.classList.remove('active');
        bodyTextarea.placeholder = 'Hello {RECIPIENT_NAME},\n\nClick here: {LINK}\n\nBest regards';
        bodyTextarea.classList.remove('code-editor');
        previewBtn.style.display = 'none';
    }
}

// ===== Rotation Functions =====
let rotationLists = { subjectLists: [], senderLists: [], linkLists: [] };

async function loadRotationLists() {
    try {
        const data = await api('/user/settings/all');
        rotationLists = data;
        populateRotationDropdowns();
    } catch (error) {
        console.log('Could not load rotation lists');
    }
}

function populateRotationDropdowns() {
    // SMTP rotation select
    const smtpSelect = document.getElementById('smtpIdsSelect');
    if (smtpSelect) {
        smtpSelect.innerHTML = smtpConfigs.map(s =>
            `<option value="${s.id}">${escapeHtml(s.name)}</option>`
        ).join('');
    }

    // Recipient lists dropdown
    const recipientSelect = document.getElementById('recipientListSelect');
    if (recipientSelect) {
        recipientSelect.innerHTML = '<option value="">-- Select Saved List --</option>' +
            (rotationLists.recipientLists || []).map(l =>
                `<option value="${l.id}">${escapeHtml(l.name)} (${l.count || l.recipients?.length || 0} recipients)</option>`
            ).join('');
    }

    // Subject lists dropdown
    const subjectSelect = document.getElementById('subjectListSelect');
    if (subjectSelect) {
        subjectSelect.innerHTML = '<option value="">Single subject only</option>' +
            (rotationLists.subjectLists || []).map(l =>
                `<option value="${l.id}">${escapeHtml(l.name)} (${l.subjects?.length || 0} items)</option>`
            ).join('');
    }

    // Sender lists dropdown
    const senderSelect = document.getElementById('senderListSelect');
    if (senderSelect) {
        senderSelect.innerHTML = '<option value="">Use SMTP default</option>' +
            (rotationLists.senderLists || []).map(l =>
                `<option value="${l.id}">${escapeHtml(l.name)} (${l.senders?.length || 0} items)</option>`
            ).join('');
    }

    // Link lists dropdown
    const linkSelect = document.getElementById('linkListSelect');
    if (linkSelect) {
        linkSelect.innerHTML = '<option value="">No link rotation</option>' +
            (rotationLists.linkLists || []).map(l =>
                `<option value="${l.id}">${escapeHtml(l.name)} (${l.links.length} items)</option>`
            ).join('');
    }
}

function getRotationData() {
    // Get selected SMTP IDs
    const smtpSelect = document.getElementById('smtpIdsSelect');
    const smtpIdsList = Array.from(smtpSelect.selectedOptions).map(opt => parseInt(opt.value));

    // Get selected lists
    const subjectListId = document.getElementById('subjectListSelect').value;
    const senderListId = document.getElementById('senderListSelect').value;
    const linkListId = document.getElementById('linkListSelect').value;

    // Get actual items from selected lists
    let subjectsList = [];
    if (subjectListId) {
        const list = rotationLists.subjectLists.find(l => l.id == subjectListId);
        if (list) subjectsList = list.subjects;
    }

    let senderNamesList = [];
    if (senderListId) {
        const list = rotationLists.senderLists.find(l => l.id == senderListId);
        if (list) senderNamesList = list.senders;
    }

    let ctaLinksList = [];
    if (linkListId) {
        const list = rotationLists.linkLists.find(l => l.id == linkListId);
        console.log('[getRotationData] Looking for link list:', linkListId, 'Found:', list);
        if (list) ctaLinksList = list.links;
    }

    // Debug log
    console.log('[getRotationData] Rotation data:', {
        linkListId,
        ctaLinksList,
        subjectListId,
        subjectsList,
        availableLinkLists: rotationLists.linkLists
    });

    return {
        rotate_smtp: smtpIdsList.length > 1,
        smtp_rotation_type: smtpIdsList.length > 1 ? document.getElementById('smtpRotationType').value : 'round_robin',
        rotate_subjects: subjectsList.length > 0,
        rotate_senders: senderNamesList.length > 0,
        rotate_cta: ctaLinksList.length > 0,
        smtp_ids_list: smtpIdsList.length > 0 ? smtpIdsList : null,
        subjects_list: subjectsList.length > 0 ? subjectsList : null,
        sender_names_list: senderNamesList.length > 0 ? senderNamesList : null,
        cta_links_list: ctaLinksList.length > 0 ? ctaLinksList : null,
        // Store list IDs for editing
        subject_list_id: subjectListId || null,
        sender_list_id: senderListId || null,
        link_list_id: linkListId || null
    };
}

function setRotationData(campaign) {
    // Set SMTP IDs
    if (campaign.smtp_ids_list) {
        const smtpIds = typeof campaign.smtp_ids_list === 'string'
            ? JSON.parse(campaign.smtp_ids_list)
            : campaign.smtp_ids_list;
        const smtpSelect = document.getElementById('smtpIdsSelect');
        Array.from(smtpSelect.options).forEach(opt => {
            opt.selected = smtpIds.includes(parseInt(opt.value));
        });
    }

    // Restore SMTP rotation type
    if (campaign.smtp_rotation_type) {
        document.getElementById('smtpRotationType').value = campaign.smtp_rotation_type;
    }
    toggleSmtpRotationType();

    // For now, we can't restore which list was selected since we only store items
    // Just reset the dropdowns
    document.getElementById('subjectListSelect').value = '';
    document.getElementById('senderListSelect').value = '';
    document.getElementById('linkListSelect').value = '';
}

function resetRotationData() {
    const smtpSelect = document.getElementById('smtpIdsSelect');
    if (smtpSelect) {
        Array.from(smtpSelect.options).forEach(opt => opt.selected = false);
    }

    const subjectSelect = document.getElementById('subjectListSelect');
    if (subjectSelect) subjectSelect.value = '';

    const senderSelect = document.getElementById('senderListSelect');
    if (senderSelect) senderSelect.value = '';

    const linkSelect = document.getElementById('linkListSelect');
    if (linkSelect) linkSelect.value = '';
}

// ===== Recipient Lists =====
let recipientLists = [];

function showRecipientListModal(id = null) {
    document.getElementById('recipientListForm').reset();
    document.getElementById('recipientListId').value = '';
    document.getElementById('recipientListModalTitle').textContent = 'New Recipient List';
    document.getElementById('recipientListCount').textContent = '0';

    if (id) {
        editRecipientList(id);
    } else {
        document.getElementById('recipientListModal').classList.add('active');
    }

    // Add input listener for preview
    document.getElementById('recipientListItems').addEventListener('input', updateRecipientPreview);
}

function closeRecipientListModal() {
    document.getElementById('recipientListModal').classList.remove('active');
}

function updateRecipientPreview() {
    const text = document.getElementById('recipientListItems').value;
    const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('email,'));
    document.getElementById('recipientListCount').textContent = lines.length;
}

async function editRecipientList(id) {
    try {
        const list = settingsData.recipientLists?.find(l => l.id === id);
        if (!list) return;

        document.getElementById('recipientListModalTitle').textContent = 'Edit Recipient List';
        document.getElementById('recipientListId').value = id;
        document.getElementById('recipientListName').value = list.name;
        document.getElementById('recipientListDescription').value = list.description || '';

        // Convert recipients array to text
        const recipients = list.recipients || [];
        if (recipients.length > 0 && typeof recipients[0] === 'object') {
            // Has custom fields - convert to CSV
            const keys = Object.keys(recipients[0]);
            const header = keys.join(',');
            const rows = recipients.map(r => keys.map(k => r[k] || '').join(','));
            document.getElementById('recipientListItems').value = header + '\n' + rows.join('\n');
        } else {
            // Simple email list
            document.getElementById('recipientListItems').value = recipients.map(r => typeof r === 'string' ? r : r.email).join('\n');
        }

        updateRecipientPreview();
        document.getElementById('recipientListModal').classList.add('active');
    } catch (error) {
        showToast('Failed to load recipient list', 'error');
    }
}

async function saveRecipientList() {
    const id = document.getElementById('recipientListId').value;
    const name = document.getElementById('recipientListName').value.trim();
    const description = document.getElementById('recipientListDescription').value.trim();
    const text = document.getElementById('recipientListItems').value.trim();

    if (!name || !text) {
        showToast('Name and recipients are required', 'error');
        return;
    }

    // Parse recipients
    const lines = text.split('\n').filter(line => line.trim());
    let recipients = [];

    // Check if first line looks like a CSV header
    const firstLine = lines[0];
    if (firstLine && firstLine.includes(',') && firstLine.toLowerCase().includes('email')) {
        // CSV format with headers
        const headers = firstLine.split(',').map(h => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const recipient = {};
            headers.forEach((h, idx) => {
                recipient[h] = values[idx] || '';
            });
            if (recipient.email) {
                recipients.push(recipient);
            }
        }
    } else {
        // Simple format - email or email,name,company
        for (const line of lines) {
            const parts = line.split(',').map(p => p.trim());
            if (parts[0] && parts[0].includes('@')) {
                recipients.push({
                    email: parts[0],
                    name: parts[1] || '',
                    company: parts[2] || ''
                });
            }
        }
    }

    if (recipients.length === 0) {
        showToast('No valid recipients found', 'error');
        return;
    }

    try {
        if (id) {
            await api(`/user/settings/recipients/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ name, description, recipients })
            });
            showToast('Recipient list updated', 'success');
        } else {
            await api('/user/settings/recipients', {
                method: 'POST',
                body: JSON.stringify({ name, description, recipients })
            });
            showToast(`Recipient list saved with ${recipients.length} recipients`, 'success');
        }

        closeRecipientListModal();
        loadSettings();
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

async function deleteRecipientList(id) {
    if (!confirm('Delete this recipient list?')) return;
    try {
        await api(`/user/settings/recipients/${id}`, { method: 'DELETE' });
        showToast('Deleted', 'success');
        loadSettings();
    } catch (error) {
        showToast('Failed to delete', 'error');
    }
}

function loadRecipientList() {
    const select = document.getElementById('recipientListSelect');
    const listId = select.value;

    if (!listId) return;

    // Try rotationLists first (used in campaign modal), then settingsData
    const lists = rotationLists.recipientLists || settingsData.recipientLists || [];
    const list = lists.find(l => l.id == listId);
    if (!list) return;

    const recipients = list.recipients || [];
    let text = '';

    if (recipients.length > 0 && typeof recipients[0] === 'object') {
        // Has custom fields - convert to CSV format for textarea
        const keys = Object.keys(recipients[0]);
        recipients.forEach(r => {
            text += keys.map(k => r[k] || '').join(',') + '\n';
        });
    } else {
        text = recipients.map(r => typeof r === 'string' ? r : r.email).join('\n');
    }

    document.getElementById('campaignRecipients').value = text.trim();
    showToast(`Loaded ${recipients.length} recipients from "${list.name}"`, 'success');
}

function populateRecipientListDropdown() {
    const select = document.getElementById('recipientListSelect');
    if (!select) return;

    const lists = settingsData.recipientLists || [];
    select.innerHTML = '<option value="">-- Select Saved List --</option>' +
        lists.map(l => `<option value="${l.id}">${escapeHtml(l.name)} (${l.count || l.recipients?.length || 0})</option>`).join('');
}

function renderRecipientLists() {
    const container = document.getElementById('recipientsContainer');
    if (!container) return;
    renderViewToggle('recipients');

    const lists = settingsData.recipientLists || [];

    if (lists.length === 0) {
        container.innerHTML = `
            <div class="card card-fill"><div class="empty-state">
                <svg class="empty-state-icon" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                <h3 class="empty-state-title">No Recipient Lists</h3>
                <p class="empty-state-text">Create your first mailing list to send campaigns to.</p>
                <button class="btn btn-primary" onclick="showRecipientListModal()">+ New List</button>
            </div></div>`;
        return;
    }

    const actionsHtml = (l) => `
        <button class="btn btn-info btn-sm" onclick="showCleanListDialog(${l.id})" title="Remove unsubscribes / dupes / failures">Clean</button>
        <button class="btn btn-secondary btn-sm" onclick="editRecipientList(${l.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRecipientList(${l.id})">Delete</button>
    `;

    if (getViewMode('recipients') === 'grid') {
        container.innerHTML = `<div class="item-grid">${lists.map(l => `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-title">${escapeHtml(l.name)}</div>
                    <div class="item-card-badges"><span class="badge badge-info">${l.count || l.recipients?.length || 0}</span></div>
                </div>
                <div class="item-card-subtitle">${escapeHtml(l.description) || 'No description'}</div>
                <div class="item-card-meta"><span>Created <strong>${formatDate(l.created_at)}</strong></span></div>
                <div class="item-card-actions">${actionsHtml(l)}</div>
            </div>
        `).join('')}</div>`;
    } else {
        container.innerHTML = `
            <div class="card card-fill"><div class="tbl-wrap"><table>
                <thead><tr><th>Name</th><th>Description</th><th>Recipients</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                ${lists.map(l => `
                    <tr>
                        <td><strong>${escapeHtml(l.name)}</strong></td>
                        <td>${escapeHtml(l.description) || '-'}</td>
                        <td><span class="badge badge-info">${l.count || l.recipients?.length || 0}</span></td>
                        <td>${formatDate(l.created_at)}</td>
                        <td><div class="actions-row">${actionsHtml(l)}</div></td>
                    </tr>
                `).join('')}
                </tbody>
            </table></div></div>`;
    }
}

// ===== Settings =====
let settingsData = { subjectLists: [], senderLists: [], linkLists: [], recipientLists: [], proxies: [], sendingSettings: {} };
let currentSettingsTab = 'recipients';

async function loadSettings() {
    try {
        const data = await api('/user/settings/all');
        settingsData = data;
        // Render all list pages
        renderRecipientLists();
        renderSubjectsList();
        renderSendersList();
        renderLinksList();
        renderProxiesTable();
    } catch (error) {
        showToast('Failed to load settings: ' + error.message, 'error');
    }
}

/**
 * Shared grid/list renderer for simple "name + items" lists (subjects, senders, links).
 */
function renderSimpleList(pageName, containerId, lists, type, itemsKey, itemLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;
    renderViewToggle(pageName);

    if (!lists || lists.length === 0) {
        container.innerHTML = `
            <div class="card card-fill"><div class="empty-state">
                <h3 class="empty-state-title">No ${itemLabel} Lists</h3>
                <p class="empty-state-text">Create your first ${itemLabel.toLowerCase()} list to use in rotation.</p>
                <button class="btn btn-primary" onclick="showListModal('${type}')">+ Add List</button>
            </div></div>`;
        return;
    }

    const actionsHtml = (l) => `
        <button class="btn btn-secondary btn-sm" onclick="editList('${type}', ${l.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteList('${type}', ${l.id})">Delete</button>
    `;

    if (getViewMode(pageName) === 'grid') {
        container.innerHTML = `<div class="item-grid">${lists.map(l => {
            const items = l[itemsKey] || [];
            const preview = items.slice(0, 3).map(i => escapeHtml(String(i).substring(0, 50))).join(' • ') + (items.length > 3 ? ' …' : '');
            return `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-title">${escapeHtml(l.name)}</div>
                    <div class="item-card-badges"><span class="badge badge-info">${items.length}</span></div>
                </div>
                <div class="item-card-subtitle">${preview || 'Empty'}</div>
                <div class="item-card-actions">${actionsHtml(l)}</div>
            </div>`;
        }).join('')}</div>`;
    } else {
        container.innerHTML = `
            <div class="card card-fill"><div class="tbl-wrap"><table>
                <thead><tr><th>Name</th><th>Items</th><th>Actions</th></tr></thead>
                <tbody>
                ${lists.map(l => {
                    const items = l[itemsKey] || [];
                    return `
                    <tr>
                        <td><strong>${escapeHtml(l.name)}</strong></td>
                        <td>
                            <span class="badge badge-info">${items.length} items</span>
                            <span class="text-muted" style="font-size:11px;margin-left:8px">${items.slice(0, 2).map(i => escapeHtml(String(i).substring(0, 30))).join(', ')}${items.length > 2 ? '…' : ''}</span>
                        </td>
                        <td><div class="actions-row">${actionsHtml(l)}</div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div></div>`;
    }
}

function renderSubjectsList() { renderSimpleList('subjects', 'subjectsContainer', settingsData.subjectLists, 'subjects', 'subjects', 'Subject'); }
function renderSendersList()  { renderSimpleList('senders',  'sendersContainer',  settingsData.senderLists,  'senders',  'senders',  'Sender'); }
function renderLinksList()    { renderSimpleList('links',    'linksContainer',    settingsData.linkLists,    'links',    'links',    'Link'); }

// showSettingsTab is no longer needed — each section is its own page now
function showSettingsTab(tab) {
    // no-op, kept for backward compatibility with any onclick references
}
function renderSettingsTab(tab) {
    // no-op
}

async function loadEmailTemplates() {
    await loadSavedTemplates();
    renderTemplatesTable();
}

function renderTemplatesTable() {
    const container = document.getElementById('templatesContainer');
    if (!container) return;
    renderViewToggle('templates');

    if (!savedTemplates || savedTemplates.length === 0) {
        container.innerHTML = `
            <div class="card card-fill"><div class="empty-state">
                <svg class="empty-state-icon" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                <h3 class="empty-state-title">No Templates Yet</h3>
                <p class="empty-state-text">Templates get saved automatically when you save a campaign with content.</p>
            </div></div>`;
        return;
    }

    const actionsHtml = (t) => `
        <button class="btn btn-secondary btn-sm" onclick="previewTemplate(${t.id})">Preview</button>
        <button class="btn btn-secondary btn-sm" onclick="editTemplate(${t.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTemplate(${t.id})">Delete</button>
    `;

    if (getViewMode('templates') === 'grid') {
        container.innerHTML = `<div class="item-grid">${savedTemplates.map(t => `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-title">${escapeHtml(t.name)}</div>
                </div>
                <div class="item-card-subtitle">${escapeHtml(t.description || 'HTML template')}</div>
                <div class="item-card-meta"><span>Created <strong>${new Date(t.created_at).toLocaleDateString()}</strong></span></div>
                <div class="item-card-actions">${actionsHtml(t)}</div>
            </div>
        `).join('')}</div>`;
    } else {
        container.innerHTML = `
            <div class="card card-fill"><div class="tbl-wrap"><table>
                <thead><tr><th>Name</th><th>Description</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                ${savedTemplates.map(t => `
                    <tr>
                        <td><strong>${escapeHtml(t.name)}</strong></td>
                        <td style="max-width:200px" class="text-muted">${escapeHtml(t.description || '-')}</td>
                        <td>${new Date(t.created_at).toLocaleDateString()}</td>
                        <td><div class="actions-row">${actionsHtml(t)}</div></td>
                    </tr>
                `).join('')}
                </tbody>
            </table></div></div>`;
    }
}

async function previewTemplate(id) {
    const template = savedTemplates.find(t => t.id === id);
    if (!template) return;

    const previewWindow = window.open('', '_blank', 'width=700,height=600');
    previewWindow.document.write(template.html_content);
    previewWindow.document.close();
}

// ===== New Template editor =====
function showNewTemplateModal() {
    document.getElementById('templateModalTitle').textContent = 'New Template';
    document.getElementById('templateId').value = '';
    document.getElementById('templateName').value = '';
    document.getElementById('templateDescription').value = '';
    document.getElementById('templateTags').value = '';
    document.getElementById('templateHtmlContent').value = '';
    document.getElementById('templateModal').classList.add('active');
    setTimeout(() => document.getElementById('templateName').focus(), 100);
}

function closeTemplateModal() {
    document.getElementById('templateModal').classList.remove('active');
}

async function editTemplate(id) {
    const template = savedTemplates.find(t => t.id === id);
    if (!template) return;
    document.getElementById('templateModalTitle').textContent = 'Edit Template';
    document.getElementById('templateId').value = template.id;
    document.getElementById('templateName').value = template.name || '';
    document.getElementById('templateDescription').value = template.description || '';
    document.getElementById('templateTags').value = template.tags || '';
    document.getElementById('templateHtmlContent').value = template.html_content || '';
    document.getElementById('templateModal').classList.add('active');
}

async function saveTemplate() {
    const id = document.getElementById('templateId').value;
    const name = document.getElementById('templateName').value.trim();
    const html_content = document.getElementById('templateHtmlContent').value;
    const description = document.getElementById('templateDescription').value.trim();
    const tags = document.getElementById('templateTags').value.trim();

    if (!name) return showToast('Template name is required', 'error');
    if (!html_content) return showToast('HTML content is required', 'error');

    try {
        if (id) {
            await api(`/user/templates/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ name, html_content, description, tags })
            });
            showToast('Template updated', 'success');
        } else {
            await api('/user/templates', {
                method: 'POST',
                body: JSON.stringify({ name, html_content, description, tags })
            });
            showToast('Template created', 'success');
        }
        closeTemplateModal();
        await loadEmailTemplates();
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

function previewTemplateHtml() {
    const html = document.getElementById('templateHtmlContent').value;
    if (!html) return showToast('Add HTML content first', 'warning');
    const win = window.open('', '_blank', 'width=700,height=700');
    win.document.write(html);
    win.document.close();
}

async function deleteTemplate(id) {
    const template = savedTemplates.find(t => t.id === id);
    if (!template) return;

    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;

    try {
        await api(`/user/templates/${id}`, { method: 'DELETE' });
        showToast('Template deleted', 'success');
        await loadEmailTemplates();
    } catch (error) {
        showToast(error.message || 'Failed to delete template', 'error');
    }
}

function renderProxiesTable() {
    const container = document.getElementById('proxiesContainer');
    if (!container) return;
    renderViewToggle('proxies');

    const proxies = settingsData.proxies || [];
    if (proxies.length === 0) {
        container.innerHTML = `
            <div class="card card-fill"><div class="empty-state">
                <h3 class="empty-state-title">No Proxies Configured</h3>
                <p class="empty-state-text">Add a proxy to route outgoing connections.</p>
                <button class="btn btn-primary" onclick="showProxyModal()">+ Add Proxy</button>
            </div></div>`;
        return;
    }

    const actionsHtml = (p) => `
        <button class="btn btn-secondary btn-sm" onclick="editProxy(${p.id})">Edit</button>
        <button class="btn btn-${p.is_active ? 'warning' : 'success'} btn-sm" onclick="toggleProxy(${p.id})">${p.is_active ? 'Pause' : 'Enable'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProxy(${p.id})">Delete</button>
    `;

    if (getViewMode('proxies') === 'grid') {
        container.innerHTML = `<div class="item-grid">${proxies.map(p => `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-title">${escapeHtml(p.name)}</div>
                    <div class="item-card-badges">
                        <span class="badge badge-info">${p.proxy_type.toUpperCase()}</span>
                        <span class="badge badge-${p.is_active ? 'success' : 'default'}">${p.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                </div>
                <div class="item-card-subtitle">${escapeHtml(p.host)}:${p.port}</div>
                <div class="item-card-meta">${p.username ? '<span>Authenticated</span>' : '<span>No auth</span>'}</div>
                <div class="item-card-actions">${actionsHtml(p)}</div>
            </div>
        `).join('')}</div>`;
        return;
    }

    // Legacy list view
    container.innerHTML = `
        <div class="card card-fill"><div class="tbl-wrap"><table>
            <thead><tr><th>Name</th><th>Type</th><th>Host</th><th>Port</th><th>Auth</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
            ${proxies.map(p => `
                <tr>
                    <td><strong>${escapeHtml(p.name)}</strong></td>
                    <td><span class="badge badge-info">${p.proxy_type.toUpperCase()}</span></td>
                    <td>${escapeHtml(p.host)}</td>
                    <td>${p.port}</td>
                    <td>${p.username ? '✓' : '-'}</td>
                    <td><span class="badge badge-${p.is_active ? 'success' : 'default'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td><div class="actions-row">${actionsHtml(p)}</div></td>
                </tr>
            `).join('')}
            </tbody>
        </table></div></div>
    `;
}

async function loadSendingSettings() {
    // Always fetch fresh from the server so we don't show stale cached values
    // after the user saves and navigates away/back.
    let s = {};
    try {
        const data = await api('/user/settings/all');
        settingsData = data;
        s = data.sendingSettings || {};
    } catch (e) {
        console.error('Failed to load sending settings:', e);
        // Fall back to cached copy only on network error
        s = settingsData.sendingSettings || {};
    }
    // Use ?? not || so that 0 is preserved (e.g. delay = 0 must not become 1000)
    document.getElementById('settingsThreads').value = s.threads ?? 1;
    const delayInput = document.getElementById('settingsDelay');
    if (delayInput) delayInput.value = s.delay_min ?? 1000;
    document.getElementById('settingsRetryFailed').checked = !!s.retry_failed;
    document.getElementById('settingsUseProxy').checked = !!s.use_proxy;
}

async function saveSendingSettings(e) {
    if (e) e.preventDefault();
    try {
        const delay = parseInt(document.getElementById('settingsDelay').value);
        const threads = parseInt(document.getElementById('settingsThreads').value);
        const retry_failed = document.getElementById('settingsRetryFailed').checked;
        const use_proxy = document.getElementById('settingsUseProxy').checked;

        const payload = {
            threads: isNaN(threads) ? 1 : threads,
            // Backend still has separate delay_min/delay_max columns — send the same value to both
            delay_min: isNaN(delay) ? 0 : delay,
            delay_max: isNaN(delay) ? 0 : delay,
            retry_failed,
            use_proxy
        };

        await api('/user/settings/sending', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        // Update the local cache so a subsequent navigate-away/back shows the new values
        // even if the load-from-server call fails
        settingsData.sendingSettings = {
            ...settingsData.sendingSettings,
            ...payload
        };

        showToast('Settings saved!', 'success');
    } catch (error) {
        showToast('Failed to save settings: ' + error.message, 'error');
    }
}

// --- Deliverability Testing ---
async function loadDeliverabilitySettings() {
    try {
        const settings = await api('/user/settings/test');
        document.getElementById('testEnabled').checked = settings.test_enabled;
        document.getElementById('testEmail').value = settings.test_email || '';
        document.getElementById('testInterval').value = settings.test_interval || 50;
    } catch (error) {
        console.error('Failed to load deliverability settings:', error);
    }
}

async function saveDeliverabilitySettings() {
    const testEmail = document.getElementById('testEmail').value.trim();
    const testInterval = parseInt(document.getElementById('testInterval').value) || 50;
    const testEnabled = document.getElementById('testEnabled').checked;

    if (testEnabled && !testEmail) {
        showToast('Please enter a test email address', 'error');
        return;
    }

    if (testEnabled && !testEmail.includes('@')) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    if (testInterval < 10) {
        showToast('Test interval must be at least 10 emails', 'error');
        return;
    }

    try {
        await api('/user/settings/test', {
            method: 'PUT',
            body: JSON.stringify({
                test_email: testEmail,
                test_interval: testInterval,
                test_enabled: testEnabled
            })
        });
        showToast('Deliverability settings saved!', 'success');
    } catch (error) {
        showToast('Failed to save settings: ' + error.message, 'error');
    }
}

async function sendManualTestEmail() {
    const testEmail = document.getElementById('testEmail').value.trim();

    if (!testEmail) {
        showToast('Please enter a test email address first', 'error');
        return;
    }

    if (!testEmail.includes('@')) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    try {
        showToast('Sending test email...', 'info');
        const result = await api('/user/settings/test/send', {
            method: 'POST',
            body: JSON.stringify({ test_email: testEmail })
        });
        showToast(result.message || 'Test email sent!', 'success');
    } catch (error) {
        showToast('Failed to send test email: ' + error.message, 'error');
    }
}

// --- List Modal ---
function showListModal(type) {
    document.getElementById('listType').value = type;
    document.getElementById('listId').value = '';
    document.getElementById('listName').value = '';
    document.getElementById('listItems').value = '';

    const labels = { subjects: 'Subject Lines', senders: 'Sender Names', links: 'CTA Links' };
    document.getElementById('listModalTitle').textContent = 'New ' + labels[type] + ' List';
    document.getElementById('listItemsLabel').textContent = labels[type] + ' (one per line) *';

    document.getElementById('listModal').classList.add('active');
}

function closeListModal() {
    document.getElementById('listModal').classList.remove('active');
}

// Add item to list items textarea
function addToListItems(item) {
    const textarea = document.getElementById('listItems');
    const currentItems = textarea.value.trim();

    // Check if item already exists
    const lines = currentItems.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.includes(item)) {
        showToast('Item already in list', 'info');
        return;
    }

    textarea.value = currentItems ? currentItems + '\n' + item : item;
    showToast('Added to list', 'success');
}

async function editList(type, id) {
    const listArrays = { subjects: 'subjectLists', senders: 'senderLists', links: 'linkLists' };
    const itemKeys = { subjects: 'subjects', senders: 'senders', links: 'links' };
    const list = settingsData[listArrays[type]].find(l => l.id === id);
    if (!list) return;

    document.getElementById('listType').value = type;
    document.getElementById('listId').value = id;
    document.getElementById('listName').value = list.name;
    document.getElementById('listItems').value = (list[itemKeys[type]] || []).join('\n');

    const labels = { subjects: 'Subject Lines', senders: 'Sender Names', links: 'CTA Links' };
    document.getElementById('listModalTitle').textContent = 'Edit ' + labels[type] + ' List';
    document.getElementById('listItemsLabel').textContent = labels[type] + ' (one per line) *';

    document.getElementById('listModal').classList.add('active');
}

async function saveList() {
    const type = document.getElementById('listType').value;
    const id = document.getElementById('listId').value;
    const name = document.getElementById('listName').value.trim();
    const items = document.getElementById('listItems').value.split('\n').map(i => i.trim()).filter(i => i);

    if (!name || items.length === 0) {
        showToast('Name and at least one item required', 'error');
        return;
    }

    const itemKey = { subjects: 'subjects', senders: 'senders', links: 'links' }[type];
    const data = { name, [itemKey]: items };

    try {
        if (id) {
            await api(`/user/settings/${type}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await api(`/user/settings/${type}`, { method: 'POST', body: JSON.stringify(data) });
        }
        showToast('List saved!', 'success');
        closeListModal();
        loadSettings();
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

async function deleteList(type, id) {
    if (!confirm('Delete this list?')) return;
    try {
        await api(`/user/settings/${type}/${id}`, { method: 'DELETE' });
        showToast('Deleted', 'success');
        loadSettings();
    } catch (error) {
        showToast('Failed to delete', 'error');
    }
}

// --- Proxy Modal ---
function showProxyModal() {
    document.getElementById('proxyId').value = '';
    document.getElementById('proxyForm').reset();
    document.getElementById('proxyModalTitle').textContent = 'Add Proxy';
    document.getElementById('proxyModal').classList.add('active');
}

function closeProxyModal() {
    document.getElementById('proxyModal').classList.remove('active');
}

function editProxy(id) {
    const proxy = settingsData.proxies.find(p => p.id === id);
    if (!proxy) return;

    document.getElementById('proxyId').value = id;
    document.getElementById('proxyName').value = proxy.name;
    document.getElementById('proxyType').value = proxy.proxy_type;
    document.getElementById('proxyHost').value = proxy.host;
    document.getElementById('proxyPort').value = proxy.port;
    document.getElementById('proxyUsername').value = proxy.username || '';
    document.getElementById('proxyPassword').value = '';
    document.getElementById('proxyModalTitle').textContent = 'Edit Proxy';
    document.getElementById('proxyModal').classList.add('active');
}

async function saveProxy() {
    const id = document.getElementById('proxyId').value;
    const data = {
        name: document.getElementById('proxyName').value.trim(),
        proxy_type: document.getElementById('proxyType').value,
        host: document.getElementById('proxyHost').value.trim(),
        port: parseInt(document.getElementById('proxyPort').value),
        username: document.getElementById('proxyUsername').value.trim() || null,
        password: document.getElementById('proxyPassword').value || null
    };

    if (!data.name || !data.host || !data.port) {
        showToast('Name, host, and port required', 'error');
        return;
    }

    try {
        if (id) {
            await api(`/user/settings/proxies/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await api('/user/settings/proxies', { method: 'POST', body: JSON.stringify(data) });
        }
        showToast('Proxy saved!', 'success');
        closeProxyModal();
        loadSettings();
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

async function toggleProxy(id) {
    try {
        await api(`/user/settings/proxies/${id}/toggle`, { method: 'POST' });
        loadSettings();
    } catch (error) {
        showToast('Failed to toggle', 'error');
    }
}

async function deleteProxy(id) {
    if (!confirm('Delete this proxy?')) return;
    try {
        await api(`/user/settings/proxies/${id}`, { method: 'DELETE' });
        showToast('Deleted', 'success');
        loadSettings();
    } catch (error) {
        showToast('Failed to delete', 'error');
    }
}

// ===== Account =====
async function loadAccountData() {
    try {
        const userData = await api('/auth/me');
        currentUser = userData.user;

        const emailEl = document.getElementById('accountEmail');
        const nameEl = document.getElementById('accountName');
        if (emailEl) emailEl.value = currentUser.email;
        if (nameEl) nameEl.value = currentUser.name || '';
    } catch (error) {
        showToast('Failed to load account data: ' + error.message, 'error');
    }

    // Refresh license info from the server every time the Account page loads
    if (typeof loadLicenseInfo === 'function') {
        try { await loadLicenseInfo(); } catch {}
    }

    // Populate the Appearance card controls from localStorage
    if (typeof loadBackgroundSettings === 'function') {
        loadBackgroundSettings();
    }
}

async function updateProfile(event) {
    event.preventDefault();

    const name = document.getElementById('accountName').value;

    try {
        await api('/auth/profile', {
            method: 'PUT',
            body: JSON.stringify({ name })
        });
        showToast('Profile updated!', 'success');
    } catch (error) {
        showToast('Failed to update profile: ' + error.message, 'error');
    }
}

// ===== Email Preview =====
let currentPreviewMode = 'desktop';

function previewEmail() {
    const content = document.getElementById('campaignBody').value;

    if (!content.trim()) {
        showToast('Add some email content first to preview', 'warning');
        return;
    }

    showPreview(content);
}

function showPreview(content) {
    // Replace placeholders with sample data
    const previewContent = replacePlaceholdersForPreview(content);

    // Show modal
    document.getElementById('previewModal').classList.add('active');

    // Reset to desktop mode
    togglePreviewMode('desktop');

    // Load content into iframe
    const iframe = document.getElementById('previewFrame');
    iframe.srcdoc = previewContent;
}

function replacePlaceholdersForPreview(content) {
    const sampleData = {
        '{RECIPIENT_NAME}': 'John',
        '{RECIPIENT_EMAIL}': 'john.doe@example.com',
        '{RECIPIENT_DOMAIN}': 'example.com',
        '{RECIPIENT_DOMAIN_NAME}': 'Example',
        '{CURRENT_DATE}': new Date().toLocaleDateString(),
        '{CURRENT_TIME}': new Date().toLocaleTimeString(),
        '{RANDOM_NUMBER10}': '1234567890',
        '{RANDOM_STRING}': 'abc123xyz',
        '{RANDOM_MD5}': 'd41d8cd98f00b204e9800998ecf8427e',
        '{FAKE_COMPANY}': 'Acme Corporation',
        '{FAKE_COMPANY_EMAIL}': 'contact@acme.com'
    };

    let result = content;
    for (const [placeholder, value] of Object.entries(sampleData)) {
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    // Wrap in basic HTML if not a complete document
    if (!result.toLowerCase().includes('<!doctype') && !result.toLowerCase().includes('<html')) {
        result = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
    </style>
</head>
<body>
${result}
</body>
</html>`;
    }

    return result;
}

function togglePreviewMode(mode) {
    currentPreviewMode = mode;
    const container = document.getElementById('previewContainer');
    const iframe = document.getElementById('previewFrame');
    const desktopBtn = document.getElementById('previewDesktopBtn');
    const mobileBtn = document.getElementById('previewMobileBtn');

    if (mode === 'mobile') {
        container.style.maxWidth = '375px';
        iframe.style.height = '667px';
        if (mobileBtn) mobileBtn.classList.add('active');
        if (desktopBtn) desktopBtn.classList.remove('active');
    } else {
        container.style.maxWidth = '700px';
        iframe.style.height = '500px';
        if (desktopBtn) desktopBtn.classList.add('active');
        if (mobileBtn) mobileBtn.classList.remove('active');
    }
}

// ===== Helpers =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function closeProgressModal() {
    document.getElementById('progressModal').classList.remove('active');
}

function closeAttachmentLibraryModal() {
    document.getElementById('attachmentLibraryModal').classList.remove('active');
}

function closeAttachmentPreviewModal() {
    document.getElementById('attachmentPreviewModal').classList.remove('active');
}

function closeInboxFinderResultsModal() {
    document.getElementById('inboxFinderResultsModal').classList.remove('active');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
}

function getStatusClass(status) {
    const classes = {
        'draft': 'default',
        'sending': 'warning',
        'completed': 'success',
        'paused': 'info',
        'failed': 'danger'
    };
    return classes[status] || 'default';
}

function getProgressPercent(campaign) {
    if (!campaign.total_recipients) return 0;
    return ((campaign.sent_count + campaign.failed_count) / campaign.total_recipients * 100).toFixed(0);
}

async function updateUserInfo() {
    try {
        const data = await api('/auth/me');
        currentUser = data.user;

        // Update UI elements if they exist
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');

        if (userNameEl) userNameEl.textContent = currentUser.name || currentUser.email;
        if (userAvatarEl) userAvatarEl.textContent = (currentUser.name || currentUser.email).charAt(0).toUpperCase();
    } catch (error) {
        console.error('Auth error:', error);
    }
}

// ===== Inbox Domain Finder =====
let inboxFinderTests = [];

// Toggle between manual input and list selection for Inbox Finder RECIPIENTS
function toggleInboxRecipientInput() {
    const source = document.getElementById('inboxTestRecipientSource').value;
    const manualGroup = document.getElementById('inboxManualRecipientsGroup');
    const listGroup = document.getElementById('inboxRecipientListGroup');
    const listPreviewGroup = document.getElementById('inboxListRecipientsGroup');

    if (source === 'list') {
        if (manualGroup) manualGroup.style.display = 'none';
        if (listGroup) listGroup.style.display = 'block';
        if (listPreviewGroup) listPreviewGroup.style.display = 'flex';
        // Populate recipient lists if not already done
        populateInboxRecipientLists();
    } else {
        if (manualGroup) manualGroup.style.display = 'flex';
        if (listGroup) listGroup.style.display = 'none';
        if (listPreviewGroup) listPreviewGroup.style.display = 'none';
    }
    updateInboxCombinationsPreview();
}

// Store loaded recipient lists for preview
let inboxRecipientLists = [];

// Populate recipient lists dropdown for Inbox Finder
async function populateInboxRecipientLists() {
    const select = document.getElementById('inboxTestRecipientList');
    if (!select) return;

    try {
        const data = await api('/user/settings/recipients');
        inboxRecipientLists = data.lists || [];

        select.innerHTML = '<option value="">-- Select Recipient List --</option>' +
            inboxRecipientLists.map(l => {
                const recipients = l.recipients || [];
                const count = Array.isArray(recipients) ? recipients.length : 0;
                return `<option value="${l.id}" data-count="${count}">${escapeHtml(l.name)} (${count} recipients)</option>`;
            }).join('');
    } catch (error) {
        console.error('Failed to load recipient lists:', error);
    }
}

// Load recipient emails from selected list and preview them
async function loadRecipientListEmails() {
    const listId = document.getElementById('inboxTestRecipientList')?.value;
    const previewTextarea = document.getElementById('inboxListRecipientsPreview');

    if (!previewTextarea) return;

    if (!listId) {
        previewTextarea.value = '';
        updateInboxCombinationsPreview();
        return;
    }

    const selectedList = inboxRecipientLists.find(l => l.id == listId);
    if (!selectedList) {
        previewTextarea.value = '';
        updateInboxCombinationsPreview();
        return;
    }

    const recipients = selectedList.recipients || [];
    // Extract full email addresses (not just usernames)
    const emails = recipients.map(item => {
        if (typeof item === 'string') return item;
        return item.email || item.value || '';
    }).filter(e => e && e.includes('@'));

    previewTextarea.value = emails.join('\n');
    updateInboxCombinationsPreview();
}

// Update combinations preview for Inbox Finder
// Shows: senders x recipients = total tests
function updateInboxCombinationsPreview() {
    // Count sender usernames
    const usernamesInput = document.getElementById('inboxTestUsernames');
    const senderUsernames = usernamesInput?.value.split('\n').filter(u => u.trim()).length || 0;

    // Count sender domains
    const domainsInput = document.getElementById('inboxTestDomains');
    const senderDomains = domainsInput?.value.split('\n').filter(d => d.trim()).length || 0;

    // Calculate sender combinations
    const senderCombinations = senderUsernames * senderDomains;

    // Update sender combinations preview
    const senderPreview = document.getElementById('senderCombinationsPreview');
    if (senderPreview) {
        senderPreview.textContent = `${senderCombinations} sender combination${senderCombinations !== 1 ? 's' : ''}`;
    }

    // Count recipients based on source
    const source = document.getElementById('inboxTestRecipientSource')?.value || 'manual';
    let recipientCount = 0;

    if (source === 'list') {
        // Count from the list preview textarea
        const previewTextarea = document.getElementById('inboxListRecipientsPreview');
        recipientCount = previewTextarea?.value.split('\n').filter(e => e.trim()).length || 0;
    } else {
        // Count from manual entry
        const recipientsInput = document.getElementById('inboxTestRecipients');
        recipientCount = recipientsInput?.value.split('\n').filter(e => e.trim()).length || 0;
    }

    // Total tests = senders x recipients
    const totalTests = senderCombinations * recipientCount;

    const preview = document.getElementById('combinationsPreview');
    if (preview) {
        preview.textContent = `${totalTests} tests will be sent (${senderCombinations} senders × ${recipientCount} recipients)`;
    }
}

async function loadInboxFinder() {
    await loadSmtpConfigs(); // Ensure SMTPs are loaded
    await loadInboxFinderTests();
    setupInboxFinderForm();
}

function setupInboxFinderForm() {
    // Populate SMTP dropdown
    const smtpSelect = document.getElementById('inboxTestSmtp');
    smtpSelect.innerHTML = '<option value="">Select SMTP...</option>' +
        smtpConfigs.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.host)})</option>`).join('');

    // Set initial state for recipient source
    const sourceSelect = document.getElementById('inboxTestRecipientSource');
    if (sourceSelect) {
        sourceSelect.value = 'manual';
        toggleInboxRecipientInput();
    }

    // Update combinations preview on input
    const usernamesInput = document.getElementById('inboxTestUsernames');
    const domainsInput = document.getElementById('inboxTestDomains');
    const recipientListSelect = document.getElementById('inboxTestRecipientList');

    if (usernamesInput) {
        usernamesInput.addEventListener('input', updateInboxCombinationsPreview);
    }
    if (domainsInput) {
        domainsInput.addEventListener('input', updateInboxCombinationsPreview);
    }
    if (recipientListSelect) {
        recipientListSelect.addEventListener('change', updateInboxCombinationsPreview);
    }

    // Form submit
    document.getElementById('inboxFinderForm').onsubmit = async (e) => {
        e.preventDefault();
        await startInboxFinderTest();
    };
}

async function loadInboxFinderTests() {
    try {
        const data = await api('/inbox-finder/tests');
        inboxFinderTests = data.tests || [];

        // Calculate stats
        const totalSent = inboxFinderTests.reduce((sum, t) => sum + (t.sent_count || 0), 0);
        const totalFailed = inboxFinderTests.reduce((sum, t) => sum + (t.failed_count || 0), 0);

        document.getElementById('inboxFinderTotalTests').textContent = inboxFinderTests.length;
        document.getElementById('inboxFinderTotalSent').textContent = totalSent;
        document.getElementById('inboxFinderTotalFailed').textContent = totalFailed;

        renderInboxFinderTests();
    } catch (error) {
        showToast('Failed to load tests: ' + error.message, 'error');
    }
}

function renderInboxFinderTests() {
    const tbody = document.getElementById('inboxFinderTestsBody');

    if (inboxFinderTests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No tests yet. Create your first test above!</td></tr>';
        return;
    }

    tbody.innerHTML = inboxFinderTests.map(t => {
        const statusBadge = {
            'pending': '<span class="badge badge-default">Pending</span>',
            'running': '<span class="badge badge-warning">Running</span>',
            'completed': '<span class="badge badge-success">Completed</span>',
            'cancelled': '<span class="badge badge-danger">Cancelled</span>'
        }[t.status] || '<span class="badge badge-default">Unknown</span>';

        return `
            <tr>
                <td><strong>${escapeHtml(t.name || 'Unnamed Test')}</strong></td>
                <td>${escapeHtml(t.smtp_name || 'Unknown')}</td>
                <td>${t.total_combinations}</td>
                <td><span class="text-success">${t.sent_count || 0}</span></td>
                <td><span class="text-danger">${t.failed_count || 0}</span></td>
                <td>${statusBadge}</td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <div class="actions-row">
                        <button class="btn btn-secondary btn-sm" onclick="viewInboxFinderResults(${t.id})" title="View Results">
                            👁️
                        </button>
                        ${t.status === 'running' ?
                            `<button class="btn btn-warning btn-sm" onclick="cancelInboxFinderTest(${t.id})" title="Cancel">✗</button>` :
                            `<button class="btn btn-danger btn-sm" onclick="deleteInboxFinderTest(${t.id})" title="Delete">🗑️</button>`
                        }
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function startInboxFinderTest() {
    const smtpId = document.getElementById('inboxTestSmtp').value;
    const name = document.getElementById('inboxTestName').value.trim();
    const recipientSource = document.getElementById('inboxTestRecipientSource')?.value || 'manual';

    if (!smtpId) {
        showToast('Please select an SMTP server', 'error');
        return;
    }

    // Get SENDER usernames (always from manual entry)
    const usernamesText = document.getElementById('inboxTestUsernames').value;
    const usernames = usernamesText.split('\n').map(u => u.trim()).filter(u => u);

    // Get SENDER domains (always from manual entry)
    const domainsText = document.getElementById('inboxTestDomains').value;
    const domains = domainsText.split('\n').map(d => d.trim()).filter(d => d);

    // Get RECIPIENTS based on source
    let recipients = [];

    if (recipientSource === 'list') {
        // Get recipients from selected list
        const listId = document.getElementById('inboxTestRecipientList').value;
        if (!listId) {
            showToast('Please select a recipient list', 'error');
            return;
        }

        try {
            const data = await api('/user/settings/recipients');
            const lists = data.lists || [];
            const selectedList = lists.find(l => l.id == listId);

            if (!selectedList) {
                showToast('Selected list not found', 'error');
                return;
            }

            const listRecipients = selectedList.recipients || [];
            // Extract full email addresses
            recipients = listRecipients.map(item => {
                if (typeof item === 'string') return item;
                return item.email || item.value || '';
            }).filter(e => e && e.includes('@'));
        } catch (error) {
            showToast('Failed to load recipient list: ' + error.message, 'error');
            return;
        }
    } else {
        // Manual entry of recipient emails
        const recipientsText = document.getElementById('inboxTestRecipients').value;
        recipients = recipientsText.split('\n').map(e => e.trim()).filter(e => e && e.includes('@'));
    }

    // Validation
    if (usernames.length === 0) {
        showToast('Please enter at least one sender username', 'error');
        return;
    }

    if (domains.length === 0) {
        showToast('Please enter at least one sender domain', 'error');
        return;
    }

    if (recipients.length === 0) {
        showToast('Please enter at least one recipient email address', 'error');
        return;
    }

    const senderCombinations = usernames.length * domains.length;
    const totalTests = senderCombinations * recipients.length;

    if (totalTests > 1000) {
        showToast(`Maximum 1000 tests allowed (you have ${totalTests}). Reduce senders or recipients.`, 'error');
        return;
    }

    try {
        showToast(`Starting test: ${senderCombinations} senders × ${recipients.length} recipients = ${totalTests} emails...`, 'info');

        await api('/inbox-finder/tests', {
            method: 'POST',
            body: JSON.stringify({
                smtp_config_id: parseInt(smtpId),
                name: name || undefined,
                usernames,
                domains,
                recipients
            })
        });

        showToast('Test started! Emails are being sent...', 'success');

        // Clear form
        document.getElementById('inboxFinderForm').reset();
        document.getElementById('combinationsPreview').textContent = '0 tests will be sent (0 senders × 0 recipients)';
        document.getElementById('senderCombinationsPreview').textContent = '0 sender combinations';

        // Reset source to manual
        const sourceSelect = document.getElementById('inboxTestRecipientSource');
        if (sourceSelect) {
            sourceSelect.value = 'manual';
            toggleInboxRecipientInput();
        }

        // Reload tests
        loadInboxFinderTests();

        // Start polling for updates
        startInboxFinderPolling();

    } catch (error) {
        showToast('Failed to start test: ' + error.message, 'error');
    }
}

let inboxFinderPollInterval = null;

function startInboxFinderPolling() {
    // Poll every 3 seconds to check for running test updates
    if (inboxFinderPollInterval) {
        clearInterval(inboxFinderPollInterval);
    }

    inboxFinderPollInterval = setInterval(async () => {
        const hasRunning = inboxFinderTests.some(t => t.status === 'running');
        if (!hasRunning) {
            clearInterval(inboxFinderPollInterval);
            inboxFinderPollInterval = null;
            return;
        }

        await loadInboxFinderTests();
    }, 3000);
}

async function viewInboxFinderResults(testId) {
    try {
        const data = await api(`/inbox-finder/tests/${testId}`);
        const test = data.test;
        const results = data.results || [];

        // Update summary
        const sentCount = results.filter(r => r.status === 'sent').length;
        const failedCount = results.filter(r => r.status === 'failed').length;
        const pendingCount = results.filter(r => r.status === 'pending').length;

        document.getElementById('inboxFinderResultsSummary').innerHTML = `
            <div style="display: flex; gap: 2rem; justify-content: center;">
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--accent-success);">${sentCount}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">Sent</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--accent-danger);">${failedCount}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">Failed</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--text-muted);">${pendingCount}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">Pending</div>
                </div>
            </div>
            <div style="text-align: center; margin-top: 1rem; font-size: 0.9rem; color: var(--text-secondary);">
                <strong>Test:</strong> ${escapeHtml(test.name || 'Unnamed')} |
                <strong>SMTP:</strong> ${escapeHtml(test.smtp_name || 'Unknown')}
            </div>
        `;

        // Update results table
        const tbody = document.getElementById('inboxFinderResultsBody');
        tbody.innerHTML = results.map(r => {
            const statusBadge = r.status === 'sent'
                ? '<span class="badge badge-success">✓ Sent</span>'
                : r.status === 'failed'
                    ? '<span class="badge badge-danger">✗ Failed</span>'
                    : '<span class="badge badge-default">Pending</span>';

            return `
                <tr>
                    <td><strong>${escapeHtml(r.email)}</strong></td>
                    <td>${statusBadge}</td>
                    <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);">
                        ${r.error_message ? escapeHtml(r.error_message) : '-'}
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('inboxFinderResultsModal').classList.add('active');

    } catch (error) {
        showToast('Failed to load results: ' + error.message, 'error');
    }
}

async function cancelInboxFinderTest(testId) {
    if (!confirm('Are you sure you want to cancel this test?')) return;

    try {
        await api(`/inbox-finder/tests/${testId}/cancel`, { method: 'POST' });
        showToast('Test cancelled', 'success');
        loadInboxFinderTests();
    } catch (error) {
        showToast('Failed to cancel test: ' + error.message, 'error');
    }
}

async function deleteInboxFinderTest(testId) {
    if (!confirm('Are you sure you want to delete this test and all results?')) return;

    try {
        await api(`/inbox-finder/tests/${testId}`, { method: 'DELETE' });
        showToast('Test deleted', 'success');
        loadInboxFinderTests();
    } catch (error) {
        showToast('Failed to delete test: ' + error.message, 'error');
    }
}

// ===== Initialize =====
// Note: app.html DOMContentLoaded calls initApp() + setActivePage('campaigns')
// which triggers showPage('campaigns') -> loadCampaigns().
// No additional init needed here.
