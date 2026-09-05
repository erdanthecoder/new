/* The narrow bridge between the pages and the app.
 *
 * The pages are the same ones the website serves and are treated with the same
 * suspicion: they get this handful of named things and no access to Node at all.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('Quoldek', {
  desktop: true,
  settings: {
    read: () => ipcRenderer.invoke('settings:read'),
    write: (values) => ipcRenderer.invoke('settings:write', values),
    reset: () => ipcRenderer.invoke('settings:reset')
  },
  joinInfo: () => ipcRenderer.invoke('join:info'),
  openBoard: (pin) => ipcRenderer.invoke('board:open', pin),
  openJoin: () => ipcRenderer.invoke('join:open'),
  // pin, and optionally the address of another computer on the wifi
  join: (pin, where) => ipcRenderer.invoke('join:go', { pin, where }),
  openQuizFolder: () => ipcRenderer.invoke('quizzes:folder'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  exportQuiz: (id) => ipcRenderer.invoke('quizzes:export', id),
  importQuizFile: () => ipcRenderer.invoke('quizzes:import'),
  onSettingsChanged: (fn) => {
    const handler = (_e, values) => { try { fn(values); } catch { /* page's problem */ } };
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.off('settings:changed', handler);
  }
});

/* The address a phone should be told to type is put into the page by the server
 * as it serves it, not from here: with context isolation this file's `window` is
 * not the page's, and the page reads that address the moment its script runs. */
