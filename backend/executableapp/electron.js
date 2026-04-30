/**
 * main.js — Pookies POS Desktop Application
 * 
 * Production-ready Electron wrapper with:
 * - Express server lifecycle management
 * - Vite dev server integration (port 5174)
 * - Proper window sizing for POS (1024x768 minimum)
 * - Security best practices
 * - Crash recovery
 * - Auto-update support structure
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // Window settings optimized for POS terminal
  window: {
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'Pookies POS',
    backgroundColor: '#FDF8F3', // Match your cream/beige theme
    icon: path.join(__dirname, 'assets', 'icon.png'),
  },
  
  // Server settings
  server: {
    port: process.env.PORT || 3001,
    script: path.join(__dirname, 'server.js'),
    maxRetries: 3,
    retryDelay: 2000,
  },
  
  // Vite dev server
  vite: {
    port: 5174,
    url: 'http://localhost:5174',
    enabled: process.env.NODE_ENV === 'development' || !fs.existsSync(path.join(__dirname, 'dist')),
  },
  
  // Development settings
  dev: {
    hotReload: process.env.NODE_ENV !== 'production',
    devTools: process.env.NODE_ENV !== 'production',
  }
};

// ─── Global State ─────────────────────────────────────────────────────────────

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;
let serverRetries = 0;

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Check if a file/directory exists
 */
function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Log with timestamp
 */
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
}

// ─── Server Management ────────────────────────────────────────────────────────

/**
 * Starts the Express/SQLite server as a child process.
 * Retries on failure up to maxRetries times.
 */
function startServer() {
  return new Promise((resolve, reject) => {
    try {
      log(`Starting server on port ${CONFIG.server.port}...`);
      
      // Check if server.js exists
      if (!exists(CONFIG.server.script)) {
        reject(new Error(`Server script not found: ${CONFIG.server.script}`));
        return;
      }
      
      serverProcess = fork(CONFIG.server.script, [], {
        env: {
          ...process.env,
          PORT: String(CONFIG.server.port),
          ELECTRON_RUN: 'true',
          NODE_ENV: process.env.NODE_ENV || 'production',
        },
        silent: false,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      // Pipe server output to Electron console
      serverProcess.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
          if (line) console.log(`[Server] ${line}`);
        });
      });

      serverProcess.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
          if (line) console.error(`[Server Error] ${line}`);
        });
      });

      serverProcess.on('error', (err) => {
        log(`Server process error: ${err.message}`);
        reject(err);
      });

      serverProcess.on('exit', (code, signal) => {
        const exitInfo = code !== null ? `code ${code}` : `signal ${signal}`;
        log(`Server exited with ${exitInfo}`);
        
        if (!isQuitting && code !== 0) {
          handleServerCrash();
        }
      });

      // Wait for server-ready message or timeout
      const timeout = setTimeout(() => {
        if (serverProcess && serverProcess.connected) {
          log('Server started (timeout)');
          serverRetries = 0;
          resolve();
        } else {
          reject(new Error('Server startup timeout'));
        }
      }, 5000);

      // Listen for ready message from server
      serverProcess.on('message', (msg) => {
        if (msg.type === 'server-ready') {
          clearTimeout(timeout);
          log(`Server ready on port ${msg.port}`);
          serverRetries = 0;
          resolve();
        }
      });

    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retry starting the server on failure
 */
async function startServerWithRetry() {
  for (let attempt = 1; attempt <= CONFIG.server.maxRetries; attempt++) {
    try {
      await startServer();
      return; // Success
    } catch (err) {
      log(`Server start attempt ${attempt}/${CONFIG.server.maxRetries} failed: ${err.message}`);
      
      if (attempt < CONFIG.server.maxRetries) {
        log(`Retrying in ${CONFIG.server.retryDelay / 1000}s...`);
        await new Promise(r => setTimeout(r, CONFIG.server.retryDelay));
      }
    }
  }
  
  throw new Error(`Server failed to start after ${CONFIG.server.maxRetries} attempts`);
}

/**
 * Handles unexpected server crashes with user notification
 */
function handleServerCrash() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Server Error',
      message: 'The inventory server has stopped unexpectedly.',
      detail: 'Your data is safe. You can restart the server or close the application.',
      buttons: ['Restart Server', 'Close App'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        // Try to restart the server
        startServerWithRetry().then(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
          }
        }).catch((err) => {
          dialog.showErrorBox('Restart Failed', 
            `Could not restart server: ${err.message}\n\nPlease restart the application manually.`
          );
        });
      } else {
        app.quit();
      }
    });
  }
}

/**
 * Gracefully stops the Express server
 */
async function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    log('Stopping server...');
    
    // Try graceful shutdown first
    serverProcess.send({ type: 'shutdown' });

    // Force kill after timeout
    const forceTimeout = setTimeout(() => {
      if (serverProcess) {
        log('Server did not shut down gracefully, forcing...');
        serverProcess.kill('SIGKILL');
      }
    }, 8000);

    serverProcess.once('exit', () => {
      clearTimeout(forceTimeout);
      log('Server stopped');
      serverProcess = null;
      resolve();
    });
  });
}

// ─── Window Management ────────────────────────────────────────────────────────

function createWindow() {
  // Check if we have an icon, use default if not
  const iconPath = exists(CONFIG.window.icon) 
    ? CONFIG.window.icon 
    : undefined;

  mainWindow = new BrowserWindow({
    width: CONFIG.window.width,
    height: CONFIG.window.height,
    minWidth: CONFIG.window.minWidth,
    minHeight: CONFIG.window.minHeight,
    title: CONFIG.window.title,
    backgroundColor: CONFIG.window.backgroundColor,
    icon: iconPath,
    
    // Security & Performance
    webPreferences: {
      nodeIntegration: false,      // Security: Don't expose Node.js to renderer
      contextIsolation: true,      // Security: Isolate renderer context
      preload: path.join(__dirname, 'preload.js'),
      devTools: CONFIG.dev.devTools,
      sandbox: false,              // Required for better-sqlite3
    },
    
    // UI Preferences
    show: false,                   // Don't show until ready
    center: true,
    autoHideMenuBar: true,         // Clean POS interface
    frame: true,                   // Keep native window frame
    
    // Prevent renderer process reuse
    paintWhenInitiallyHidden: true,
  });

  // Determine which URL to load
  let url;
  
  if (CONFIG.vite.enabled) {
    // Development: Use Vite dev server
    url = CONFIG.vite.url;
    log(`Development mode: Loading Vite from ${url}`);
  } else {
    // Production: Use Express server (which serves the built files)
    url = `http://localhost:${CONFIG.server.port}`;
    log(`Production mode: Loading app from ${url}`);
  }

  // Load the app
  mainWindow.loadURL(url).catch((err) => {
    log(`Failed to load URL: ${err.message}`);
    
    // If Vite fails, try Express directly
    if (CONFIG.vite.enabled) {
      const fallbackUrl = `http://localhost:${CONFIG.server.port}`;
      log(`Falling back to Express: ${fallbackUrl}`);
      mainWindow.loadURL(fallbackUrl);
    }
  });

  // Show window when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Open DevTools in development mode
    if (CONFIG.dev.devTools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Handle external links (open in browser, not Electron)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent title from changing
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // Handle page load failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log(`Page load failed: ${errorDescription} (${errorCode})`);
  });

  // Mark window as destroyed on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers (Bridge between frontend and Electron) ──────────────────────

function setupIPC() {
  // Server information
  ipcMain.handle('get-server-port', () => CONFIG.server.port);
  
  ipcMain.handle('get-vite-port', () => CONFIG.vite.port);
  
  ipcMain.handle('is-vite-enabled', () => CONFIG.vite.enabled);
  
  ipcMain.handle('is-server-running', () => {
    return serverProcess !== null && !serverProcess.killed;
  });

  ipcMain.handle('get-api-url', () => {
    // In dev, API is on port 3001 (proxied by Vite)
    // In prod, API is on same port as the app
    return `http://localhost:${CONFIG.server.port}`;
  });

  // Restart server (admin function)
  ipcMain.handle('restart-server', async () => {
    try {
      await stopServer();
      await startServerWithRetry();
      return { success: true, message: 'Server restarted successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // App information
  ipcMain.handle('get-app-version', () => app.getVersion());
  
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  }));

  // Window controls
  ipcMain.handle('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('maximize-window', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.handle('close-window', () => {
    if (mainWindow) mainWindow.close();
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    log('Pookies POS starting...');
    log(`Environment: ${process.env.NODE_ENV || 'production'}`);
    log(`Vite mode: ${CONFIG.vite.enabled ? 'enabled' : 'disabled'}`);
    
    // 1. Start the Express server
    await startServerWithRetry();
    
    // 2. Setup IPC handlers
    setupIPC();
    
    // 3. Create the main window
    log('Creating main window...');
    createWindow();
    
    log('App ready!');
  } catch (err) {
    log(`Failed to start: ${err.message}`);
    
    // Show error dialog
    dialog.showErrorBox(
      'Startup Error',
      `Failed to start Pookies POS:\n\n${err.message}\n\n` +
      'Please ensure:\n' +
      '• Node.js dependencies are installed (npm install)\n' +
      '• Database file exists\n' +
      '• Port 3001 is not in use'
    );
    
    app.quit();
  }
});

// macOS: Re-create window when dock icon clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Windows/Linux: Quit when all windows closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ─── Cleanup on Quit ──────────────────────────────────────────────────────────

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    
    log('Shutting down...');
    await stopServer();
    
    // Now actually quit
    app.quit();
  }
});

app.on('will-quit', () => {
  log('Goodbye! 👋');
});

// ─── Error Handling ───────────────────────────────────────────────────────────

process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error);
  
  // Don't show dialog for common non-critical errors
  const criticalErrors = ['EPERM', 'EACCES', 'ENOSPC'];
  if (criticalErrors.some(code => error.message.includes(code))) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Critical Error', 
        `${error.message}\n\nThe application may need to restart.`
      );
    }
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});
