const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const root = path.join(__dirname, '..');
let backend, backendPort, window, quitting = false;
const token = randomBytes(32).toString('hex');

async function startBackend() {
  const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.TERRAIN_PYTHON || (existsSync(localPython) ? localPython : (process.platform === 'win32' ? 'python' : 'python3'));
  return new Promise((resolve, reject) => {
    let ready = false, errors = '';
    backend = spawn(python, [path.join(root, 'backend/server.py')], {
      cwd: root, windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1', TERRAIN_API_TOKEN: token, TERRAIN_PARENT_PID: String(process.pid) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => { backend.kill(); reject(new Error('Python 后端启动超时')); }, 20000);
    backend.stderr.on('data', chunk => { errors = (errors + chunk).slice(-3000); });
    backend.on('error', error => { clearTimeout(timer); reject(error); });
    backend.on('exit', () => {
      clearTimeout(timer);
      if (!ready) reject(new Error(errors || 'Python 后端意外退出'));
      else if (!quitting) {
        dialog.showErrorBox('地形引擎已停止', '请重新启动应用。\n' + errors);
        app.quit();
      }
    });
    readline.createInterface({ input: backend.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.ready && Number.isInteger(message.port)) {
          ready = true; backendPort = message.port; clearTimeout(timer); resolve();
        }
      } catch { /* Non-protocol output is ignored. */ }
    });
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 930, minHeight: 680,
    backgroundColor: '#f6f7f3', title: '山海 · 城市生长工作台',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  // Disabling timer throttling also keeps document.hidden false in Electron.
  // Report native visibility separately so painting can still sleep.
  const reportVisibility = () => window.webContents.send('terrain:visibility', window.isVisible() && !window.isMinimized());
  for (const event of ['show', 'hide', 'minimize', 'restore']) window.on(event, reportVisibility);
  window.webContents.on('did-finish-load', reportVisibility);
  window.loadFile(path.join(root, 'renderer/index.html'));
}

ipcMain.handle('terrain:generate', async (_event, options) => {
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Terrain-Token': token },
    body: JSON.stringify(options), signal: AbortSignal.timeout(180000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '地形引擎请求失败');
  return result;
});
ipcMain.handle('city:request', async (_event, { action, payload }) => {
  if (!['create','saves','load','import','state','command','step','save','checkpoint','export','inspect','route','branch','close','preview','query','compare','summary','scenario','renewal_preview','traffic','clock','simulate'].includes(action)) throw new Error('未知城市操作');
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/city/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Terrain-Token': token },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(180000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '城市引擎请求失败');
  return result;
});
ipcMain.handle('city:save-file', async (_event, { filename, text, type }) => {
  if (typeof text !== 'string' || text.length > 350000000 || !['csv','json'].includes(type)) throw new Error('无效的导出数据');
  const safeName = String(filename).replace(/[\\/:\0]/g, '_').slice(0, 120);
  const result = await dialog.showSaveDialog(window, { title: '导出城市数据', defaultPath: path.join(app.getPath('documents'), safeName),
    filters: [{ name: type.toUpperCase(), extensions: [type] }] });
  if (result.canceled) return { canceled: true };
  await fs.writeFile(result.filePath, text, 'utf8');
  return { path: result.filePath, canceled: false };
});
ipcMain.handle('terrain:export', async (_event, { dataUrl, filename }) => {
  if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 50000000) throw new Error('无效的 PNG 文件');
  const safeName = String(filename).replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 100);
  const result = await dialog.showSaveDialog(window, { title: '导出地图', defaultPath: path.join(app.getPath('pictures'), safeName), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
  if (result.canceled) return { canceled: true };
  await fs.writeFile(result.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return { canceled: false, path: result.filePath };
});

app.whenReady().then(async () => {
  try { await startBackend(); createWindow(); }
  catch (error) { dialog.showErrorBox('无法启动地形引擎', `${error.message}\n\n请在项目目录运行 npm run setup:python，或通过 TERRAIN_PYTHON 指定已安装 NumPy 的 Python。`); app.quit(); }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; if (backend) backend.kill(); });
