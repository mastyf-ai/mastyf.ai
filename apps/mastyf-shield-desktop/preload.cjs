'use strict';

/**
 * Preload bridge for Mastyf Shield.
 * Exposes status/IPC only — never evaluates policy or AIA.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mastyfShield', {
  getStatus: () => ipcRenderer.invoke('shield:status'),
  restartGateway: () => ipcRenderer.invoke('shield:restart-gateway'),
  restartBff: () => ipcRenderer.invoke('shield:restart-bff'),
  openLogs: () => ipcRenderer.invoke('shield:open-logs'),
  getGuardStatus: () => ipcRenderer.invoke('shield:guard-status'),
  openDeepLink: (target) => ipcRenderer.invoke('shield:open-deeplink', target),
  retryHealthGate: () => ipcRenderer.invoke('shield:retry-gate'),
  licenseStatus: () => ipcRenderer.invoke('shield:license-status'),
  activateLicense: (token) => ipcRenderer.invoke('shield:activate-license', token),
  openExternal: (url) => ipcRenderer.invoke('shield:open-external', url),
});
