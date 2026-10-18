/**
 * Electron preload — deliberately minimal. The web UI is plain React with
 * no Node access (contextIsolation + sandbox on); nothing privileged is
 * exposed today. Future desktop-only capabilities (e.g. native file dialogs
 * for photo upload) get explicit, narrow contextBridge APIs here.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('singularityDesktop', {
  platform: process.platform,
  isDesktop: true,
});
