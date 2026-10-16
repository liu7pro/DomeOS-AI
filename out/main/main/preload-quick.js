"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/main/preload-quick.ts - the bridge for the floating command bar
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('domeosQuick', {
    send: (text) => electron_1.ipcRenderer.invoke('quick:send', text),
    cancel: () => electron_1.ipcRenderer.invoke('quick:cancel'),
    hide: () => electron_1.ipcRenderer.invoke('quick:hide'),
    expand: (expanded) => electron_1.ipcRenderer.invoke('quick:expand', expanded),
    expanded: () => electron_1.ipcRenderer.invoke('quick:expanded'),
    openMain: () => electron_1.ipcRenderer.invoke('quick:openMain'),
    state: () => electron_1.ipcRenderer.invoke('quick:state'),
    glow: () => electron_1.ipcRenderer.invoke('quick:config'),
    orb: () => electron_1.ipcRenderer.invoke('quick:orb'),
    // the orb is clicked: the panel opens and the recording session ends
    clicked: () => electron_1.ipcRenderer.invoke('quick:clicked'),
    voiceStart: () => electron_1.ipcRenderer.invoke('voice:start'),
    voiceStop: () => electron_1.ipcRenderer.invoke('voice:stop'),
    onVoice: (cb) => {
        const handler = (_e, payload) => cb(payload);
        electron_1.ipcRenderer.on('quick:voice', handler);
        return () => electron_1.ipcRenderer.removeListener('quick:voice', handler);
    },
    onEvent: (cb) => {
        const handler = (_e, payload) => cb(payload);
        electron_1.ipcRenderer.on('quick:event', handler);
        return () => electron_1.ipcRenderer.removeListener('quick:event', handler);
    },
    onState: (cb) => {
        const handler = (_e, s) => cb(s);
        electron_1.ipcRenderer.on('quick:state', handler);
        return () => electron_1.ipcRenderer.removeListener('quick:state', handler);
    },
    onReset: (cb) => {
        const handler = (_e, expanded) => cb(expanded);
        electron_1.ipcRenderer.on('quick:reset', handler);
        return () => electron_1.ipcRenderer.removeListener('quick:reset', handler);
    },
    onTheme: (cb) => {
        const handler = (_e, dark) => cb(dark);
        electron_1.ipcRenderer.on('quick:theme', handler);
        return () => electron_1.ipcRenderer.removeListener('quick:theme', handler);
    },
});
