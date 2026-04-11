const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const http = require('http');

// electron-updater is loaded lazily so a missing module never blocks app boot
// (e.g. when running in dev mode where it isn't strictly required).
let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    console.warn('[Updater] electron-updater not loaded:', e.message);
}

let mainWindow = null;
let serverReady = false;
let updateCheckInterval = null;

const PORT = process.env.PORT || 3000;
const LICENSE_API = 'https://mailflow.zeabur.app';
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// --- License Management ---
function getLicenseFilePath() {
    return path.join(app.getPath('userData'), 'license.json');
}

function getMachineId() {
    // Generate a stable machine ID from hardware info
    const info = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus()[0]?.model || ''}-${os.totalmem()}`;
    return crypto.createHash('sha256').update(info).digest('hex').substring(0, 32);
}

function getSavedLicense() {
    try {
        const data = fs.readFileSync(getLicenseFilePath(), 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function saveLicense(licenseKey, machineId) {
    fs.writeFileSync(getLicenseFilePath(), JSON.stringify({ license_key: licenseKey, machine_id: machineId }));
}

function clearLicense() {
    try { fs.unlinkSync(getLicenseFilePath()); } catch {}
}

function licenseRequest(endpoint, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const url = new URL(endpoint, LICENSE_API);
        const mod = url.protocol === 'https:' ? https : http;
        const req = mod.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 15000
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(responseData) });
                } catch {
                    resolve({ status: res.statusCode, data: { error: responseData } });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        req.write(data);
        req.end();
    });
}

async function activateLicense(licenseKey) {
    const machineId = getMachineId();
    try {
        const res = await licenseRequest('/api/activate', { license_key: licenseKey, machine_id: machineId });
        if (res.status === 200) {
            saveLicense(licenseKey, machineId);
            return { success: true, data: res.data };
        }
        return { success: false, error: res.data.error || 'Activation failed' };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function validateLicense() {
    const saved = getSavedLicense();
    if (!saved) {
        console.log('[License] No saved license — showing activation screen');
        return { valid: false, reason: 'no_license' };
    }
    console.log(`[License] Validating with server for key ${saved.license_key.substring(0, 4)}••••...`);
    try {
        const res = await licenseRequest('/api/validate', { license_key: saved.license_key, machine_id: saved.machine_id });

        // Explicit server rejection — expired, revoked, invalid, etc.
        if (res.status !== 200 || res.data.valid === false) {
            console.log('[License] Server rejected license:', res.data.error || res.status);
            return { valid: false, reason: res.data.error || 'License invalid' };
        }

        // Server says active but the data includes an expiry that has already passed
        const expiresRaw = res.data.expires_at || res.data.expiry || res.data.expires || res.data.valid_until;
        if (expiresRaw) {
            const expiryMs = new Date(expiresRaw).getTime();
            if (!isNaN(expiryMs) && expiryMs < Date.now()) {
                console.log('[License] License has expired on', expiresRaw);
                return { valid: false, reason: 'expired', data: res.data };
            }
        }

        console.log('[License] Validated successfully by server');
        return { valid: true, data: res.data };
    } catch (err) {
        // Network error — allow cached license to work so the user isn't
        // locked out of the app for flaky internet. This is logged so the
        // offline state is traceable.
        console.log('[License] Server unreachable, allowing offline use:', err.message);
        return { valid: true, offline: true };
    }
}

// --- Auto-Updater (electron-updater) ---
function setupAutoUpdater() {
    if (!autoUpdater) {
        console.log('[Updater] Skipped — electron-updater not available');
        return;
    }
    // We control the prompt UX from the renderer — don't auto-download
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // On Windows, electron-updater verifies SHA512 from latest.yml against the
    // downloaded installer regardless of code-signing status.
    autoUpdater.allowPrerelease = false;

    const send = (channel, payload) => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send(channel, payload);
        }
    };

    autoUpdater.on('checking-for-update', () => {
        console.log('[Updater] Checking for update…');
        send('update:checking');
    });
    autoUpdater.on('update-available', (info) => {
        console.log('[Updater] Update available:', info.version);
        send('update:available', {
            version: info.version,
            releaseNotes: info.releaseNotes || '',
            releaseDate: info.releaseDate || ''
        });
    });
    autoUpdater.on('update-not-available', (info) => {
        console.log('[Updater] No update available (current ' + (info?.version || '?') + ')');
        send('update:not-available', { version: info?.version });
    });
    autoUpdater.on('download-progress', (progress) => {
        send('update:progress', {
            percent: Math.round(progress.percent || 0),
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total
        });
    });
    autoUpdater.on('update-downloaded', (info) => {
        console.log('[Updater] Update downloaded:', info.version);
        send('update:downloaded', {
            version: info.version,
            releaseNotes: info.releaseNotes || ''
        });
    });
    autoUpdater.on('error', (err) => {
        console.error('[Updater] Error:', err?.message || err);
        send('update:error', { message: err?.message || String(err) });
    });

    // Initial check 5 seconds after window is ready (gives the server time to boot)
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(e => console.warn('[Updater] check failed:', e.message));
    }, 5000);

    // Recurring check every 4 hours
    updateCheckInterval = setInterval(() => {
        autoUpdater.checkForUpdates().catch(e => console.warn('[Updater] check failed:', e.message));
    }, UPDATE_CHECK_INTERVAL_MS);
}

async function startServer() {
    // Set user data path for database and uploads (app must be ready first)
    process.env.MAILFLOW_USER_DATA = app.getPath('userData');
    process.env.MAILFLOW_SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');
    try {
        // Dynamic import for ESM server module
        const server = await import(
            'file://' + path.join(__dirname, '..', 'server.mjs').replace(/\\/g, '/')
        );
        serverReady = true;
        console.log('Express server started successfully');
        return server;
    } catch (error) {
        console.error('Failed to start server:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('MailFlow 2.0',
            `Could not start server: ${error.message}\n\nMake sure no other instance is running.`);
        app.quit();
    }
}

function createWindow() {
    const iconPath = path.join(__dirname, '..', 'public', 'img', 'logo.ico');
    const appIcon = nativeImage.createFromPath(iconPath);

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1280,
        minHeight: 720,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#050508',
        icon: appIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('maximize-change', true);
    });

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('maximize-change', false);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// App lifecycle
app.on('ready', async () => {
    // IPC handlers for window controls
    ipcMain.handle('window-minimize', () => {
        mainWindow?.minimize();
    });

    ipcMain.handle('window-maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });

    ipcMain.handle('window-close', () => {
        mainWindow?.close();
    });

    ipcMain.handle('window-is-maximized', () => {
        return mainWindow?.isMaximized() || false;
    });

    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });

    // License IPC handlers
    ipcMain.handle('license-activate', async (event, licenseKey) => {
        return await activateLicense(licenseKey);
    });

    ipcMain.handle('license-validate', async () => {
        return await validateLicense();
    });

    ipcMain.handle('license-deactivate', () => {
        clearLicense();
        return { success: true };
    });

    ipcMain.handle('license-get-info', () => {
        return getSavedLicense();
    });

    // Auto-updater IPC handlers
    ipcMain.handle('update:download', async () => {
        if (!autoUpdater) return { error: 'updater unavailable' };
        try {
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (e) {
            return { error: e.message || String(e) };
        }
    });
    ipcMain.handle('update:install', () => {
        if (!autoUpdater) return { error: 'updater unavailable' };
        // quitAndInstall ends the current process and runs the new installer
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
        return { success: true };
    });
    ipcMain.handle('update:check', async () => {
        if (!autoUpdater) return { error: 'updater unavailable' };
        try {
            const result = await autoUpdater.checkForUpdates();
            return { success: true, updateInfo: result?.updateInfo || null };
        } catch (e) {
            return { error: e.message || String(e) };
        }
    });

    // Validate license before starting
    const licenseResult = await validateLicense();

    // Always create window — it will show activation screen or main app
    await startServer();
    if (serverReady) {
        createWindow();
        // Send license status to renderer once loaded
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('license-status', licenseResult);
            // Start auto-updater after the renderer is ready to receive events
            setupAutoUpdater();
        });
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (mainWindow === null && serverReady) {
        createWindow();
    }
});
