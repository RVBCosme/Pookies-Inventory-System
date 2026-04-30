/**
 * preload.js — Secure bridge between Electron main process and renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Server information
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  getVitePort: () => ipcRenderer.invoke('get-vite-port'),
  isViteEnabled: () => ipcRenderer.invoke('is-vite-enabled'),
  isServerRunning: () => ipcRenderer.invoke('is-server-running'),
  getApiUrl: () => ipcRenderer.invoke('get-api-url'),
  
  // Server management
  restartServer: () => ipcRenderer.invoke('restart-server'),
  
  // App information
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  
  // Platform info
  platform: process.platform,
  isElectron: true,
});