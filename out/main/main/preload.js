"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/main/preload.ts - the only bridge between the renderer and Node/Electron
const electron_1 = require("electron");
const api = {
    getConfig: () => electron_1.ipcRenderer.invoke('config:get'),
    setConfig: (patch) => electron_1.ipcRenderer.invoke('config:set', patch),
    listModels: () => electron_1.ipcRenderer.invoke('models:list'),
    modelsFor: (provider) => electron_1.ipcRenderer.invoke('models:for', provider),
    presets: () => electron_1.ipcRenderer.invoke('registry:presets'),
    defaultPersona: () => electron_1.ipcRenderer.invoke('persona:default'),
    pickBackground: () => electron_1.ipcRenderer.invoke('background:pick'),
    clearBackground: () => electron_1.ipcRenderer.invoke('background:clear'),
    backgroundImage: () => electron_1.ipcRenderer.invoke('background:image'),
    ttsSpeak: (text, key) => electron_1.ipcRenderer.invoke('tts:speak', text, key),
    ttsCancel: (key) => electron_1.ipcRenderer.invoke('tts:cancel', key),
    ttsVoices: () => electron_1.ipcRenderer.invoke('tts:voices'),
    aiControllerPath: () => electron_1.ipcRenderer.invoke('aicontroller:path'),
    aiControllerLaunch: () => electron_1.ipcRenderer.invoke('aicontroller:launch'),
    aiControllerStop: () => electron_1.ipcRenderer.invoke('aicontroller:stop'),
    aiControllerSync: () => electron_1.ipcRenderer.invoke('aicontroller:sync'),
    aiControllerSyncPaths: () => electron_1.ipcRenderer.invoke('aicontroller:sync-paths'),
    openSettings: (section) => electron_1.ipcRenderer.invoke('settings:open', section ?? ''),
    closeSettings: () => electron_1.ipcRenderer.invoke('settings:close'),
    mediaState: () => electron_1.ipcRenderer.invoke('media:state'),
    mediaCommand: (action) => electron_1.ipcRenderer.invoke('media:command', action),
    mediaRefresh: () => electron_1.ipcRenderer.invoke('media:refresh'),
    onSettingsSection: (cb) => {
        const handler = (_e, section) => cb(section);
        electron_1.ipcRenderer.on('settings:section', handler);
        return () => electron_1.ipcRenderer.removeListener('settings:section', handler);
    },
    onSettingsInline: (cb) => {
        const handler = (_e, section) => cb(section);
        electron_1.ipcRenderer.on('settings:inline', handler);
        return () => electron_1.ipcRenderer.removeListener('settings:inline', handler);
    },
    onSettingsInlineClose: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.on('settings:inline-close', handler);
        return () => electron_1.ipcRenderer.removeListener('settings:inline-close', handler);
    },
    onMediaChanged: (cb) => {
        const handler = (_e, s) => cb(s);
        electron_1.ipcRenderer.on('media:changed', handler);
        return () => electron_1.ipcRenderer.removeListener('media:changed', handler);
    },
    send: (req) => electron_1.ipcRenderer.invoke('chat:send', req),
    cancel: (id) => electron_1.ipcRenderer.invoke('chat:cancel', id),
    approve: (id, callId, allow) => electron_1.ipcRenderer.invoke('chat:approve', id, callId, allow),
    onChatEvent: (cb) => {
        const handler = (_e, payload) => cb(payload);
        electron_1.ipcRenderer.on('chat:event', handler);
        return () => electron_1.ipcRenderer.removeListener('chat:event', handler);
    },
    onOpenThread: (cb) => {
        const handler = (_e, id) => cb(id);
        electron_1.ipcRenderer.on('thread:open', handler);
        return () => electron_1.ipcRenderer.removeListener('thread:open', handler);
    },
    onNewChat: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.on('chat:new', handler);
        return () => electron_1.ipcRenderer.removeListener('chat:new', handler);
    },
    onConfigChanged: (cb) => {
        const handler = (_e, c) => cb(c);
        electron_1.ipcRenderer.on('config:changed', handler);
        return () => electron_1.ipcRenderer.removeListener('config:changed', handler);
    },
    threads: () => electron_1.ipcRenderer.invoke('threads:list'),
    thread: (id) => electron_1.ipcRenderer.invoke('threads:get', id),
    saveThread: (thread) => electron_1.ipcRenderer.invoke('threads:save', thread),
    deleteThread: (id) => electron_1.ipcRenderer.invoke('threads:delete', id),
    renameThread: (id, title) => electron_1.ipcRenderer.invoke('threads:rename', id, title),
    workspace: () => electron_1.ipcRenderer.invoke('workspace:get'),
    pickWorkspace: () => electron_1.ipcRenderer.invoke('workspace:pick'),
    setWorkspace: (root) => electron_1.ipcRenderer.invoke('workspace:set', root),
    tree: (depth) => electron_1.ipcRenderer.invoke('workspace:tree', depth),
    readFile: (path) => electron_1.ipcRenderer.invoke('workspace:read', path),
    resolvedTheme: () => electron_1.ipcRenderer.invoke('theme:resolved'),
    onThemeChanged: (cb) => {
        const handler = (_e, t) => cb(t);
        electron_1.ipcRenderer.on('theme:changed', handler);
        return () => electron_1.ipcRenderer.removeListener('theme:changed', handler);
    },
    quickShow: () => electron_1.ipcRenderer.invoke('quick:show'),
    paths: () => electron_1.ipcRenderer.invoke('paths'),
    openPath: (target) => electron_1.ipcRenderer.invoke('shell:open', target),
    openExternal: (url) => electron_1.ipcRenderer.invoke('shell:external', url),
    version: () => electron_1.ipcRenderer.invoke('app:version'),
    quit: () => electron_1.ipcRenderer.send('app:quit'),
    newChat: () => electron_1.ipcRenderer.send('app:newchat'),
    setBadge: (n) => electron_1.ipcRenderer.send('app:badge', n),
    openConfigFolder: () => electron_1.ipcRenderer.send('folder:config'),
    openDataFolder: () => electron_1.ipcRenderer.send('folder:data'),
    isMaximised: () => electron_1.ipcRenderer.invoke('window:isMaximised'),
    onMaximised: (cb) => {
        const handler = (_e, v) => cb(v);
        electron_1.ipcRenderer.on('window:maximised', handler);
        return () => electron_1.ipcRenderer.removeListener('window:maximised', handler);
    },
    minimise: () => electron_1.ipcRenderer.send('window:minimise'),
    toggleMaximise: () => electron_1.ipcRenderer.send('window:maximise'),
    close: () => electron_1.ipcRenderer.send('window:close'),
};
electron_1.contextBridge.exposeInMainWorld('domeos', api);
