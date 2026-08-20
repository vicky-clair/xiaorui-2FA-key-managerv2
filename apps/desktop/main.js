/**
 * @file main.js
 * @description Electron 桌面端主进程入口
 * 职责：
 * 1. 启动轻量级内嵌安全本地 HTTP 服务器（绑定 127.0.0.1 环回地址，杜绝局域网外部探测）；
 * 2. 注入 Cross-Origin 隔离标头（COOP/COEP），确保 WebAssembly (Argon2) 多线程高性能运行；
 * 3. 实现 Expo Router 单页应用 (SPA) 路由重定向与多环境静态资源自动探测（开发与打包环境兼容）；
 * 4. 创建配置持久化会话分区 (persist:xiaorui_vault) 的原生窗口。
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

/**
 * 动态探测静态 Web 编译产物所在的目录路径
 * 兼容开发模式 (monorepo) 与生产打包模式 (extraResources)
 */
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

/**
 * 启动安全本地 HTTP 文件服务器
 */
function startServer(callback) {
  const distDir = getDistDir();

  server = http.createServer((req, res) => {
    // 过滤 URL 查询参数
    const requestUrl = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(distDir, requestUrl === '/' ? 'index.html' : requestUrl);

    // SPA 路由回退：针对 Expo Router 深度路径，统一重定向至 index.html
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
        // 关键安全头：注入 COOP 与 COEP 开启 SharedArrayBuffer 隔离环境
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
    // 若固定端口被占用，自动切换为操作系统分配的随机空闲端口
    if (err.code === 'EADDRINUSE') {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        callback(port);
      });
    }
  });
}

let mainWindow = null;
let serverPort = null;
let pendingDeepLinkUri = null;

// 注册 secureauth:// 自定义系统协议，支持浏览器插件直接唤起
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('secureauth', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('secureauth');
}

/**
 * 提取命令行或参数中的深层链接 URI
 */
function extractDeepLinkFromArgs(argv) {
  for (const arg of argv) {
    if (arg && (arg.startsWith('secureauth://') || arg.startsWith('otpauth://'))) {
      return arg;
    }
  }
  return null;
}

// 检查启动参数中是否包含深层链接
const initialLink = extractDeepLinkFromArgs(process.argv);
if (initialLink) {
  pendingDeepLinkUri = initialLink;
}

// 单实例锁控制：当外部通过浏览器唤起时，不重复打开新窗口，而是将现有窗口激活并传递 2FA 数据
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      const deepLink = extractDeepLinkFromArgs(commandLine);
      if (deepLink) {
        dispatchDeepLinkToRenderer(mainWindow, deepLink);
      }
    }
  });

  // 应用程序准备就绪后启动本地服务并打开主窗口
  app.whenReady().then(() => {
    startServer((port) => {
      serverPort = port;
      mainWindow = createWindow(port);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow(serverPort);
        }
      });
    });
  });
}

// macOS 专属 open-url 事件处理
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    dispatchDeepLinkToRenderer(mainWindow, url);
  } else {
    pendingDeepLinkUri = url;
  }
});

/**
 * 向渲染进程派发深层链接 2FA 导入数据
 */
function dispatchDeepLinkToRenderer(win, uri) {
  if (!win || !win.webContents) return;
  const script = `
    if (window.__onDeepLink) {
      window.__onDeepLink(${JSON.stringify(uri)});
    } else {
      window.__pendingDeepLinkUri = ${JSON.stringify(uri)};
    }
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

/**
 * 创建主应用程序窗口
 */
function createWindow(port) {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: 'Xiaorui 2FA Security Vault',
    backgroundColor: '#090d16',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:xiaorui_vault', // 启用专属沙箱持久化会话，保障 IndexedDB/SQLite 存储
    }
  });

  win.loadURL(`http://127.0.0.1:${port}`);

  win.webContents.on('did-finish-load', () => {
    if (pendingDeepLinkUri) {
      dispatchDeepLinkToRenderer(win, pendingDeepLinkUri);
      pendingDeepLinkUri = null;
    }
  });

  return win;
}

// 所有窗口关闭时退出应用 (macOS 除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
