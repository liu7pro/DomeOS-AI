"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickBar = void 0;
// src/main/quickbar.ts - the always-ready command bar.
//
// A frameless, transparent, always-on-top window that hugs the work area. Its edges are
// the light strip (drawn by the renderer, so the gradient can flow around the whole
// outline) and its top strip carries the input box. Press the hotkey, type, Enter: the
// agent runs the turn and the answer streams into the bar.
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
/** room for the glow and the drop shadow around the panel */
const MARGIN = 18;
/** the window is tall enough for the expanded panel; collapsed only the orb shows */
const HEIGHT = 268;
/** the collapsed orb keeps the window out of the way */
const WIDTH_COLLAPSED = 116;
class QuickBar {
    /** exposed so the --quickshot verification hook can photograph the bar */
    win = null;
    ready = false;
    open = false;
    busy = false;
    /** whether the renderer has unfolded the panel */
    expanded = false;
    /** true only for the very first wake of this run: the orb shows its bars waving */
    wave = false;
    threadId = '';
    workspace = '';
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    // ------------------------------------------------------------------ window
    create() {
        const wa = electron_1.screen.getPrimaryDisplay().workArea;
        const win = new electron_1.BrowserWindow({
            x: wa.x + MARGIN,
            y: wa.y + MARGIN,
            width: Math.max(480, wa.width - MARGIN * 2),
            height: HEIGHT,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: false,
            show: false,
            backgroundColor: '#00000000',
            title: 'DomeOS AI',
            webPreferences: {
                preload: node_path_1.default.join(__dirname, 'preload-quick.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                backgroundThrottling: false,
                spellcheck: false,
            },
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        const query = new URLSearchParams({ theme: this.deps.isDark() ? 'dark' : 'light' }).toString();
        if (this.deps.devUrl)
            win.loadURL(`${this.deps.devUrl}/quickbar.html?${query}`);
        else
            win.loadFile(node_path_1.default.join(__dirname, '..', '..', 'renderer', 'quickbar.html'), { search: query });
        win.webContents.once('did-finish-load', () => {
            this.ready = true;
            this.pushState();
        });
        // clicking away should not lose the typed command; hide instead of closing
        win.on('blur', () => {
            if (this.open && !this.busy)
                this.hide();
        });
        win.on('closed', () => {
            this.win = null;
            this.ready = false;
        });
        return win;
    }
    ensure() {
        if (!this.win || this.win.isDestroyed()) {
            this.win = this.create();
            this.ready = false;
        }
        return this.win;
    }
    pushState() {
        if (!this.win || this.win.isDestroyed() || !this.ready)
            return;
        const state = {
            open: this.open,
            busy: this.busy,
            wave: this.wave,
            hotkey: this.deps.getHotkey(),
            threadId: this.threadId,
            workspace: this.workspace,
        };
        this.win.webContents.send('quick:state', state);
    }
    // ------------------------------------------------------------------ lifecycle
    setWorkspace(root) {
        this.workspace = root;
        this.pushState();
    }
    /** The collapsed orb sits at the top centre of the work area. */
    collapsedBounds() {
        const wa = electron_1.screen.getPrimaryDisplay().workArea;
        return {
            x: Math.round(wa.x + (wa.width - WIDTH_COLLAPSED) / 2),
            y: wa.y + MARGIN,
            width: WIDTH_COLLAPSED,
            height: HEIGHT,
        };
    }
    /** The expanded panel stretches across the work area. */
    expandedBounds() {
        const wa = electron_1.screen.getPrimaryDisplay().workArea;
        return {
            x: wa.x + MARGIN,
            y: wa.y + MARGIN,
            width: Math.max(480, wa.width - MARGIN * 2),
            height: HEIGHT,
        };
    }
    /** Wakes the bar up and hands it a conversation id. */
    show(threadId, workspace, expanded = false, wave = false) {
        const win = this.ensure();
        if (win.isMinimized())
            win.restore();
        this.threadId = threadId;
        this.workspace = workspace;
        this.open = true;
        this.expanded = expanded;
        this.wave = wave;
        win.setBounds(expanded ? this.expandedBounds() : this.collapsedBounds());
        win.showInactive();
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
        win.focus();
        win.webContents.send('quick:reset', expanded);
        this.pushState();
        setTimeout(() => this.pushState(), 60);
    }
    /** The renderer tells us whether the panel is unfolded, so the window can follow. */
    setExpanded(expanded) {
        if (this.expanded === expanded)
            return;
        this.expanded = expanded;
        if (!this.win || this.win.isDestroyed() || !this.open)
            return;
        this.win.setBounds(expanded ? this.expandedBounds() : this.collapsedBounds());
    }
    hide() {
        if (!this.open)
            return;
        this.open = false;
        this.busy = false;
        this.expanded = false;
        this.wave = false;
        this.pushState();
        if (this.win && !this.win.isDestroyed())
            this.win.hide();
    }
    toggle(threadId, workspace, expanded = false) {
        if (this.open)
            this.hide();
        else
            this.show(threadId, workspace, expanded);
    }
    isOpen() {
        return this.open;
    }
    isExpanded() {
        return this.expanded;
    }
    /** runs a script in the panel's window, for verification */
    probe(script) {
        if (!this.win || this.win.isDestroyed())
            return Promise.resolve('no window');
        return this.win.webContents.executeJavaScript(script);
    }
    setBusy(busy) {
        this.busy = busy;
        this.pushState();
    }
    /** Clears the first-wake pulse, e.g. once the orb has been clicked. */
    clearWave() {
        if (!this.wave)
            return;
        this.wave = false;
        this.pushState();
    }
    /** Forwards one recognised utterance to the bar. */
    sendVoice(kind, text) {
        if (!this.win || this.win.isDestroyed() || !this.ready)
            return;
        this.win.webContents.send('quick:voice', { kind, text });
    }
    /** Forwards one agent event to the bar. */
    emit(event) {
        if (!this.win || this.win.isDestroyed() || !this.ready)
            return;
        this.win.webContents.send('quick:event', event);
    }
    notifyTheme() {
        if (!this.win || this.win.isDestroyed() || !this.ready)
            return;
        this.win.webContents.send('quick:theme', this.deps.isDark());
    }
    refreshHotkey() {
        this.pushState();
    }
    /** Wires the renderer's requests. `deps` own what actually happens. */
    attachIpc(ipcMain) {
        ipcMain.handle('quick:send', async (_e, text) => {
            const value = String(text ?? '').trim();
            if (!value || this.busy)
                return;
            this.busy = true;
            this.pushState();
            try {
                await this.deps.onSend(value, this.threadId);
            }
            finally {
                this.busy = false;
                this.pushState();
            }
        });
        ipcMain.handle('quick:cancel', () => {
            this.deps.onCancel();
            this.busy = false;
            this.pushState();
        });
        ipcMain.handle('quick:hide', () => this.hide());
        ipcMain.handle('quick:expand', (_e, expanded) => {
            this.setExpanded(!!expanded);
            return true;
        });
        // the renderer asks for the initial layout instead of trusting an event that may race
        // with its own mount
        ipcMain.handle('quick:expanded', () => this.expanded);
        ipcMain.handle('quick:openMain', () => this.deps.onOpenMain(this.threadId));
        ipcMain.handle('quick:state', () => ({
            open: this.open,
            busy: this.busy,
            wave: this.wave,
            hotkey: this.deps.getHotkey(),
            threadId: this.threadId,
            workspace: this.workspace,
        }));
        // the orb is clicked: the popup opens, recording stops, and the pulse is spent
        ipcMain.handle('quick:clicked', () => {
            this.clearWave();
            this.deps.onVoiceStop?.();
            return true;
        });
        ipcMain.handle('voice:start', () => this.deps.onVoiceStart?.() ?? { ok: false, error: 'unavailable' });
        ipcMain.handle('voice:stop', () => {
            this.deps.onVoiceStop?.();
            return true;
        });
        ipcMain.handle('quick:config', () => this.deps.getGlow());
        ipcMain.handle('quick:orb', () => this.deps.getOrb());
    }
    destroy() {
        if (this.win && !this.win.isDestroyed())
            this.win.destroy();
        this.win = null;
    }
}
exports.QuickBar = QuickBar;
