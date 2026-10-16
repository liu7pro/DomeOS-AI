"use strict";
// src/main/voice.ts - the always-running voice service.
//
// The wake phrase has to be heard while the app sits idle, which Node cannot do on its
// own, so the recognition lives in a small helper executable built on System.Speech
// (the Windows speech service). This module owns that child process: it starts it,
// reads its one-line-per-event stdout, keeps it alive, and retries with a growing
// delay - starting it without a microphone attached fails immediately, and it has to
// come back by itself once one is plugged in.
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");

let child = null;
let enabled = false;
let handler = null;
let retryTimer = null;
let retryDelay = 4000;
let lastError = '';
/** the helper sits next to the app's own executable in every install layout */
function exePath() {
    const beside = node_path_1.join(node_path_1.dirname(process.execPath), 'DomeOSVoice.exe');
    const unpackaged = node_path_1.join(__dirname, '..', '..', '..', 'app', 'DomeOSVoice.exe');
    try {
        if (node_fs_1.existsSync(beside))
            return beside;
    }
    catch {
        /* ignore */
    }
    return unpackaged;
}
function setHandler(fn) {
    handler = fn;
}
function emit(kind, text) {
    if (handler)
        handler(kind, text || '');
}
function handleLine(line) {
    const cut = line.indexOf(' ');
    const kind = cut < 0 ? line : line.slice(0, cut);
    const text = cut < 0 ? '' : line.slice(cut + 1).trim();
    if (kind === 'READY') {
        retryDelay = 4000;
        lastError = '';
        emit('READY', '');
        return;
    }
    if (kind === 'WAKE') {
        retryDelay = 4000;
        lastError = '';
        emit('WAKE', text);
        return;
    }
    if (kind === 'TEXT' || kind === 'HYP') {
        emit(kind, text);
        return;
    }
    if (kind === 'ERR') {
        lastError = text;
        emit('ERR', text);
    }
}
function scheduleRetry() {
    if (retryTimer || !enabled)
        return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        retryDelay = Math.min(30000, Math.round(retryDelay * 1.6));
        spawn();
    }, retryDelay);
}
function spawn() {
    if (!enabled || child)
        return;
    try {
        const file = exePath();
        child = (0, node_child_process_1.spawn)(file, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    }
    catch (e) {
        lastError = String(e?.message ?? e);
        emit('ERR', lastError);
        scheduleRetry();
        return;
    }
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, cut).replace(/\r$/, '').trim();
            buffer = buffer.slice(cut + 1);
            if (line)
                handleLine(line);
        }
    });
    child.on('error', () => {
        child = null;
        if (enabled)
            scheduleRetry();
    });
    child.on('exit', () => {
        child = null;
        if (enabled)
            scheduleRetry();
    });
}
function start() {
    if (enabled)
        return;
    enabled = true;
    spawn();
}
function stop() {
    enabled = false;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    retryDelay = 4000;
    const running = child;
    child = null;
    if (running) {
        try {
            running.kill();
        }
        catch {
            /* already gone */
        }
    }
}
exports.VoiceService = {
    start,
    stop,
    setHandler,
    exePath,
    isRunning: () => !!child,
    lastError: () => lastError,
};
