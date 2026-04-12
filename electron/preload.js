const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    onMaximizeChange: (callback) => {
        ipcRenderer.on('maximize-change', (event, isMaximized) => callback(isMaximized));
    },

    // App info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    // License
    activateLicense: (key) => ipcRenderer.invoke('license-activate', key),
    validateLicense: () => ipcRenderer.invoke('license-validate'),
    deactivateLicense: () => ipcRenderer.invoke('license-deactivate'),
    getLicenseInfo: () => ipcRenderer.invoke('license-get-info'),
    getMachineId: () => ipcRenderer.invoke('license-get-machine-id'),
    onLicenseStatus: (callback) => {
        ipcRenderer.on('license-status', (event, status) => callback(status));
    },
    onLicenseStatusChanged: (callback) => {
        ipcRenderer.on('license-status-changed', (event, status) => callback(status));
    },

    // Auto-Updater
    updates: {
        // Event listeners — call once on app boot to subscribe
        onChecking: (cb) => ipcRenderer.on('update:checking', () => cb()),
        onAvailable: (cb) => ipcRenderer.on('update:available', (e, info) => cb(info)),
        onNotAvailable: (cb) => ipcRenderer.on('update:not-available', (e, info) => cb(info)),
        onProgress: (cb) => ipcRenderer.on('update:progress', (e, p) => cb(p)),
        onDownloaded: (cb) => ipcRenderer.on('update:downloaded', (e, info) => cb(info)),
        onError: (cb) => ipcRenderer.on('update:error', (e, err) => cb(err)),
        // Actions
        download: () => ipcRenderer.invoke('update:download'),
        install: () => ipcRenderer.invoke('update:install'),
        check: () => ipcRenderer.invoke('update:check')
    }
});
