"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_EXT = void 0;
exports.VIDEO_EXT = void 0;
exports.backgroundPath = backgroundPath;
exports.backgroundVideoPath = backgroundVideoPath;
exports.storeBackground = storeBackground;
exports.storeBackgroundVideo = storeBackgroundVideo;
exports.removeBackground = removeBackground;
exports.readBackground = readBackground;
// src/main/background.ts - the window background image.
//
// The chosen file is COPIED into the app's data directory rather than referenced in place.
// That matters: a wallpaper the user later moves, renames or deletes would otherwise leave the
// app with a broken path and no picture, and the file lives outside any sandbox the workspace
// settings impose.
//
// The copy is also downscaled if it is very large. A 40-megapixel photo does not need to be
// pushed through the IPC bridge on every window open, and the renderer only ever shows it as a
// background.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const electron_1 = require("electron");
/** Long edge of the stored copy. Wide enough for a 4K window, small enough to load instantly. */
const MAX_EDGE = 2560;
exports.ALLOWED_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
/** Background videos are stored under their own extension and streamed, never base64'd. */
exports.VIDEO_EXT = ['mp4', 'webm', 'ogv', 'mov', 'm4v'];
function backgroundPath(dataDir) {
    return node_path_1.default.join(dataDir, 'background.img');
}
/** The stored background video, whichever extension it was saved with. */
function backgroundVideoPath(dataDir) {
    for (const ext of exports.VIDEO_EXT) {
        const p = node_path_1.default.join(dataDir, `background.${ext}`);
        try {
            if (node_fs_1.default.statSync(p).isFile())
                return p;
        }
        catch { /* not this one */ }
    }
    return node_path_1.default.join(dataDir, 'background.mp4');
}
/** Writes the source image into the data directory, scaled down if it is oversized. */
function storeBackground(sourcePath, dataDir) {
    try {
        const image = electron_1.nativeImage.createFromPath(sourcePath);
        if (image.isEmpty()) {
            return { ok: false, error: 'that file could not be read as an image' };
        }
        const { width, height } = image.getSize();
        let out = image;
        if (Math.max(width, height) > MAX_EDGE) {
            const scale = MAX_EDGE / Math.max(width, height);
            out = image.resize({
                width: Math.max(1, Math.round(width * scale)),
                height: Math.max(1, Math.round(height * scale)),
                quality: 'good',
            });
        }
        removeBackground(dataDir);
        node_fs_1.default.mkdirSync(dataDir, { recursive: true });
        // always written as PNG: it is lossless and keeps transparency, and the extension is fixed
        // so a later change of source format cannot leave a stale file behind
        node_fs_1.default.writeFileSync(backgroundPath(dataDir), out.toPNG());
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}
function removeBackground(dataDir) {
    try {
        node_fs_1.default.rmSync(backgroundPath(dataDir), { force: true });
    }
    catch {
        /* nothing to remove */
    }
    for (const ext of exports.VIDEO_EXT) {
        try {
            node_fs_1.default.rmSync(node_path_1.default.join(dataDir, `background.${ext}`), { force: true });
        }
        catch {
            /* nothing to remove */
        }
    }
}
/** Copies the source video in as background.<ext>. Videos are never re-encoded. */
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
function storeBackgroundVideo(sourcePath, dataDir) {
    try {
        const stat = node_fs_1.default.statSync(sourcePath);
        if (!stat.isFile())
            return { ok: false, error: 'that file is not a video' };
        if (stat.size > MAX_VIDEO_BYTES)
            return { ok: false, error: 'that video is larger than 512 MB' };
        const ext = (node_path_1.default.extname(sourcePath) || '.mp4').replace('.', '').toLowerCase();
        node_fs_1.default.mkdirSync(dataDir, { recursive: true });
        removeBackground(dataDir);
        node_fs_1.default.copyFileSync(sourcePath, node_path_1.default.join(dataDir, `background.${ext}`));
        return { ok: true, ext };
    }
    catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}
/**
 * The image as a data URL for the renderer.
 *
 * A custom protocol would be leaner, but the renderer runs with `default-src 'self'`, so a
 * file:// or app:// URL would need a CSP change and a protocol handler. A data URL needs
 * neither, and the stored copy is bounded by MAX_EDGE so its size is predictable.
 */
function readBackground(dataDir) {
    try {
        const file = backgroundPath(dataDir);
        const stat = node_fs_1.default.statSync(file);
        if (stat.isFile() && stat.size > 0) {
            const data = node_fs_1.default.readFileSync(file);
            return { dataUrl: `data:image/png;base64,${data.toString('base64')}`, bytes: stat.size };
        }
    }
    catch {
        /* no image - try the video below */
    }
    try {
        const file = backgroundVideoPath(dataDir);
        const stat = node_fs_1.default.statSync(file);
        if (stat.isFile() && stat.size > 0)
            return { video: true, ext: node_path_1.default.extname(file).replace('.', '') };
    }
    catch {
        /* no video either */
    }
    return null;
}
