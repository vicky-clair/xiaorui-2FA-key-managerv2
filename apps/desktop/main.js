const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Locate the exported static web bundle
function getDistDir() {
  const localDist = path.join(__dirname, 'dist');
  if (fs.existsSync(localDist)) {
    return localDist;
  }
  const monorepoDist = path.join(__dirname, '../expo/dist');
  if (fs.existsSync(monorepoDist)) {
    return monorepoDist;
  }
  const appPathDist = path.join(app.getAppPath(), 'dist');
  if (fs.existsSync(appPathDist)) {
    return appPathDist;
  }
  return path.join(process.resourcesPath, 'dist');
}

let server;

function startServer(callback) {
  const distDir = getDistDir();

  server = http.createServer((req, res) => {
    // Clean query params
    const requestUrl = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(distDir, requestUrl === '/' ? 'index.html' : requestUrl);

    // SPA Fallback for Expo Router
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
      '.otf': 'font/otf',
      '.wasm': 'application/wasm'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === 'ENOENT') {
          res.writeHead(404);
          res.end('404 Not Found');
        } else {
          res.writeHead(500);
          res.end('Server error: ' + error.code);
        }
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(content, 'utf-8');
      }
    });
  });

  const DESKTOP_PORT = 38291;

  server.listen(DESKTOP_PORT, '127.0.0.1', () => {
    const port = server.address().port;
    callback(port);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        callback(port);
      });
    }
  });
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: 'Secure Authenticator 2FA',
    backgroundColor: '#090d16',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:xiaorui_vault',
    }
  });

  win.loadURL(`http://127.0.0.1:${port}`);

  if (!app.isPackaged) {
    // Only open DevTools in development
    // win.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  startServer((port) => {
    createWindow(port);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(port);
      }
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
