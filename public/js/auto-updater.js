// ===== Auto-Updater UI =====
// Manages update detection, download progress, and install prompts.
// Depends on: app.js (escapeHtml, showToast)

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
