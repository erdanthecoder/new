/* Quoldek for Windows.
 *
 * The app is not a browser pointed at the website. It runs the whole thing on
 * this computer: the pages, the quizzes and the live game all come from here,
 * and the phones in the room join over the school's own wifi. Nothing needs the
 * internet, which is the point — school wifi is unreliable and school firewalls
 * block things, and neither can stop a lesson that never leaves the building.
 */
const { app, BrowserWindow, ipcMain, Menu, dialog, shell, screen, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

const { Server, lanAddress } = require('./server.js');
const { Settings } = require('./settings.js');

/* Where the site's own files are. Packaged, they sit unpacked beside the app so
 * the server can read them straight off disk; in development they are the very
 * same static/ the website is built from, one level up. */
const CANDIDATES = [
  path.join(process.resourcesPath || '', 'app', 'static'),
  path.join(__dirname, 'static'),
  path.join(__dirname, '..', 'static')
];
const ROOT = CANDIDATES.find(dir => {
  try { return fs.existsSync(path.join(dir, 'play.html')); } catch { return false; }
}) || CANDIDATES[CANDIDATES.length - 1];

let server = null, settings = null, home = null, board = null, prefs = null;

const dataDir = () => app.getPath('userData');
const quizFolder = () => path.join(dataDir(), 'quizzes');
const base = () => `http://127.0.0.1:${server.port}`;

/* ── windows ──────────────────────────────────────────── */

function windowOptions(extra) {
  return Object.assign({
    backgroundColor: '#120C24',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // the app's own pages sit beside static/, which they draw the logo from
      additionalArguments: []
    }
  }, extra);
}

function openHome() {
  home = new BrowserWindow(windowOptions({
    width: 1280, height: 860, minWidth: 900, minHeight: 620, show: false,
    title: 'Quoldek', icon: path.join(__dirname, 'build', 'icon.png')
  }));
  home.once('ready-to-show', () => home.show());
  home.on('closed', () => { home = null; });
  // the app's own front door, not the website's — a launcher, with the address
  // everyone types pinned where the teacher can point at it
  home.loadURL(base() + '/app/ui/home.html');
  return home;
}

/* The board belongs on the projector. If there is a second screen it opens
 * there full screen, because that is where the room is looking; if there is
 * only one, it opens as a big window rather than taking over the laptop. */
function openBoard(pin) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const other = displays.find(d => d.id !== primary.id);
  const target = (settings.values.boardOnSecondScreen && other) ? other : primary;
  const fill = settings.values.boardFullScreen && !!other;

  if (board && !board.isDestroyed()) { board.focus(); board.loadURL(`${base()}/host?pin=${pin}`); return; }
  board = new BrowserWindow(windowOptions({
    x: target.workArea.x + (fill ? 0 : 40),
    y: target.workArea.y + (fill ? 0 : 40),
    width: fill ? target.workArea.width : Math.min(1500, target.workArea.width - 80),
    height: fill ? target.workArea.height : Math.min(950, target.workArea.height - 80),
    fullscreen: fill,
    title: 'Quoldek — live game',
    icon: path.join(__dirname, 'build', 'icon.png')
  }));
  board.on('closed', () => { board = null; });
  board.loadURL(`${base()}/host?pin=${pin}`);
}

function openSettings() {
  if (prefs && !prefs.isDestroyed()) { prefs.focus(); return; }
  prefs = new BrowserWindow(windowOptions({
    width: 640, height: 800, resizable: false, minimizable: false, maximizable: false,
    title: 'Settings', parent: home || undefined, modal: false,
    autoHideMenuBar: true
  }));
  prefs.setMenu(null);
  prefs.on('closed', () => { prefs = null; });
  prefs.loadFile(path.join(__dirname, 'ui', 'settings.html'));
}

/* ── the menu ─────────────────────────────────────────── */
function buildMenu() {
  const template = [
    { label: 'Quiz', submenu: [
      { label: 'Home', accelerator: 'CmdOrCtrl+1',
        click: () => (home ? home.loadURL(base() + '/app/ui/home.html') : openHome()) },
      { label: 'New quiz', accelerator: 'CmdOrCtrl+N',
        click: () => home && home.webContents.executeJavaScript('go("new")').catch(() => {}) },
      { type: 'separator' },
      { label: 'Import a quiz file…', click: importQuizFile },
      { label: 'Open the quiz folder', click: () => shell.openPath(quizFolder()) },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' }
    ] },
    { label: 'Game', submenu: [
      { label: 'Full screen board', accelerator: 'F11',
        click: () => board && !board.isDestroyed() && board.setFullScreen(!board.isFullScreen()) },
      { label: 'Bring the board to the front', click: () => board && !board.isDestroyed() && board.focus() },
      { type: 'separator' },
      { label: 'Show the join address', click: showJoinAddress }
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'toggleDevTools' }
    ] },
    { label: 'Help', submenu: [
      { label: 'How players join', click: showJoinAddress },
      { label: 'Quoldek on the web', click: () => shell.openExternal('https://quoldek.web.app') }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showJoinAddress() {
  const where = `http://${lanAddress()}:${server.port}/play`;
  dialog.showMessageBox(home || undefined, {
    type: 'info',
    title: 'How players join',
    message: 'Everyone types this into their phone:',
    detail: `${where}\n\nTheir phone has to be on the same wifi as this computer. `
          + 'Nothing here goes over the internet.',
    buttons: ['Copy the address', 'Close'],
    defaultId: 0, cancelId: 1
  }).then(({ response }) => {
    if (response === 0) require('electron').clipboard.writeText(where);
  });
}

/* ── files ────────────────────────────────────────────── */
async function importQuizFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(home || undefined, {
    title: 'Import a quiz', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Quoldek quiz', extensions: ['json'] }]
  });
  if (canceled) return { imported: 0 };
  let imported = 0;
  for (const file of filePaths) {
    try {
      const quiz = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!quiz || !Array.isArray(quiz.questions)) continue;
      // a fresh id, so importing a copy never overwrites the original
      quiz.id = Math.random().toString(36).slice(2, 10);
      server.store.save(quiz);
      imported++;
    } catch { /* not a quiz file */ }
  }
  if (imported && home) home.reload();
  return { imported };
}

async function exportQuiz(id) {
  const quiz = server.store.get(id);
  if (!quiz) return { saved: false };
  const safe = (quiz.title || 'quiz').replace(/[^\w \-]+/g, '').trim() || 'quiz';
  const { canceled, filePath } = await dialog.showSaveDialog(home || undefined, {
    title: 'Save the quiz', defaultPath: safe + '.json',
    filters: [{ name: 'Quoldek quiz', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, JSON.stringify(quiz, null, 2), 'utf8');
  return { saved: true, filePath };
}

/* ── what the pages may ask for ───────────────────────── */
function wireBridge() {
  ipcMain.handle('settings:read', () => settings.values);
  ipcMain.handle('settings:write', (_e, values) => {
    settings.patch(values);
    if (nativeTheme) {
      nativeTheme.themeSource = settings.values.theme;
    }
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', settings.values);
    return settings.values;
  });
  ipcMain.handle('settings:reset', () => {
    settings.reset();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', settings.values);
    return settings.values;
  });
  ipcMain.handle('join:info', () => ({
    host: `${lanAddress()}:${server.port}`,
    url: `http://${lanAddress()}:${server.port}/play`,
    port: server.port,
    folder: quizFolder()
  }));
  ipcMain.handle('board:open', (_e, pin) => { openBoard(String(pin || '')); return true; });
  ipcMain.handle('quizzes:folder', () => shell.openPath(quizFolder()));
  ipcMain.handle('settings:open', () => { openSettings(); return true; });
  ipcMain.handle('quizzes:export', (_e, id) => exportQuiz(String(id || '')));
  ipcMain.handle('quizzes:import', () => importQuizFile());
}

/* ── starting up ──────────────────────────────────────── */
async function boot() {
  settings = new Settings(path.join(dataDir(), 'settings.json'));
  if (nativeTheme) nativeTheme.themeSource = settings.values.theme;

  server = new Server({ root: ROOT, dataDir: dataDir(), port: settings.values.port,
                        appRoot: __dirname, settings });
  try {
    await server.listen();
  } catch (err) {
    // something else already has the port; let the computer choose one instead
    server = new Server({ root: ROOT, dataDir: dataDir(), port: 0, appRoot: __dirname, settings });
    await server.listen();
  }

  wireBridge();
  buildMenu();
  openHome();
}

// one copy of the app, or the second one cannot have the port and the teacher
// ends up with two half-working windows
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (home) { if (home.isMinimized()) home.restore(); home.focus(); } });
  app.whenReady().then(boot);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (server) server.close(); });
}

/* Nothing in the app may navigate itself somewhere else, and a link to the wider
 * web opens in the teacher's own browser rather than inside the app. */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(base())) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(base()) && !url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
});
