"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaService = void 0;
// src/main/media.ts - control whatever is playing in the background.
//
// Windows gives apps a media-session API (SMTC): the same one behind the volume-flyout
// controls. It is a WinRT interface, which Electron cannot call directly, so one PowerShell
// worker is kept alive for the whole session and answered over stdin/stdout. Polling happens
// here, on a slow timer, so an idle app costs almost nothing.
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const electron_1 = require("electron");
const EMPTY = { ok: false, sessions: [], active: null };
/** Where the worker script lives, in dev and inside the packaged app. */
function workerPath() {
    // build.ps1 copies the script next to the compiled main process, so both a dev run and the
    // packaged app find it without guessing at relative paths
    const candidates = [
        node_path_1.default.join(__dirname, 'tools', 'smtc-worker.ps1'),
        node_path_1.default.join(electron_1.app.getAppPath(), 'out', 'main', 'tools', 'smtc-worker.ps1'),
        node_path_1.default.join(process.resourcesPath ?? '', 'tools', 'smtc-worker.ps1'),
        node_path_1.default.join(electron_1.app.getAppPath(), '..', 'tools', 'smtc-worker.ps1'),
    ];
    for (const c of candidates) {
        try {
            if (node_fs_1.default.existsSync(c))
                return c;
        }
        catch {
            /* keep looking */
        }
    }
    return '';
}
function powershellPath() {
    const full = node_path_1.default.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return node_fs_1.default.existsSync(full) ? full : 'powershell.exe';
}
class MediaService {
    child = null;
    buffer = '';
    timer = null;
    state = EMPTY;
    listeners = new Set();
    nextId = 1;
    starting = false;
    failures = 0;
    stopped = false;
    available = false;
    /** true once a state line has arrived, i.e. SMTC works on this machine */
    isAvailable() {
        return this.available;
    }
    getState() {
        return this.state;
    }
    onState(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    emit() {
        for (const cb of this.listeners) {
            try {
                cb(this.state);
            }
            catch {
                /* a broken listener must not stop the poll */
            }
        }
    }
    start(intervalMs = 1000) {
        if (this.stopped || this.child || this.starting)
            return;
        const script = workerPath();
        if (!script) {
            this.fail('the media worker script was not found');
            return;
        }
        this.starting = true;
        try {
            const child = (0, node_child_process_1.spawn)(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
            this.child = child;
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', (chunk) => this.consume(chunk));
            child.stderr.on('data', () => {
                /* PowerShell writes progress noise here; the JSON channel is stdout */
            });
            child.on('exit', () => {
                this.child = null;
                this.starting = false;
                this.available = false;
                if (this.timer) {
                    clearInterval(this.timer);
                    this.timer = null;
                }
                // one restart, then give up: a machine without SMTC must not spawn forever
                if (!this.stopped && this.failures < 2) {
                    this.failures++;
                    setTimeout(() => this.start(intervalMs), 4000);
                }
            });
            child.on('error', () => {
                this.starting = false;
                this.child = null;
            });
            this.timer = setInterval(() => this.poll(), Math.max(500, intervalMs));
        }
        catch (e) {
            this.starting = false;
            this.fail('could not start the media worker: ' + (e?.message ?? e));
        }
    }
    stop() {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        const child = this.child;
        this.child = null;
        if (child) {
            try {
                child.stdin.write(JSON.stringify({ action: 'quit' }) + '\n');
            }
            catch {
                /* the pipe may already be gone */
            }
            setTimeout(() => {
                try {
                    child.kill();
                }
                catch {
                    /* already dead */
                }
            }, 400);
        }
    }
    fail(message) {
        this.available = false;
        this.state = { ...EMPTY, error: message };
        this.emit();
    }
    consume(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            const text = line.trim();
            if (!text || text[0] !== '{')
                continue;
            let msg;
            try {
                msg = JSON.parse(text);
            }
            catch {
                continue;
            }
            if (msg?.type === 'state' && msg.state) {
                this.available = msg.state.ok !== false;
                this.state = {
                    ok: msg.state.ok !== false,
                    error: msg.state.error,
                    sessions: Array.isArray(msg.state.sessions) ? msg.state.sessions : [],
                    active: msg.state.active ?? null,
                };
                this.emit();
            }
            else if (msg?.type === 'result' && msg.state) {
                if (msg.state.ok === false) {
                    this.state = { ...this.state, error: msg.state.error };
                    this.emit();
                }
            }
        }
    }
    send(payload) {
        const child = this.child;
        if (!child || child.killed)
            return false;
        try {
            child.stdin.write(JSON.stringify(payload) + '\n');
            return true;
        }
        catch {
            return false;
        }
    }
    poll() {
        if (this.state.sessions.length === 0 && !this.available) {
            // nothing has ever answered: do not keep asking a dead worker
            return;
        }
        this.send({ action: 'state' });
    }
    /** Sends a transport command; playback state comes back on the next state line. */
    command(action, session) {
        return this.send({ id: this.nextId++, action, session });
    }
    /** Asks for a fresh state right now, for when the user opens the panel. */
    refresh() {
        this.send({ action: 'state' });
    }
}
exports.MediaService = MediaService;
