"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWindowsVoices = listWindowsVoices;
exports.speakText = speakText;
exports.cleanForSpeech = cleanForSpeech;
// src/main/tts.ts - speech synthesis for the chat window.
//
// Two engines, one shape: every call answers with WAV bytes as base64 so the renderer can
// play them through Web Audio (the page CSP allows no data:/blob: media, and the Windows
// Web Speech API ships no voices inside Electron).
//
//   * MiMo TTS - an OpenAI-compatible chat completion carrying the non-standard `audio`
//     field, which comes back as base64 audio in choices[0].message.audio.data.
//   * the Windows voices - driven through PowerShell, because System.Speech (SAPI5) and
//     Windows.Media.SpeechSynthesis (the OneCore voices the system settings list) are not
//     reachable from Node without a native module.
//
// The fallback is deliberate: MiMo is used whenever a key is configured, the Windows
// voices cover "no key / MiMo failed", so the button always speaks.
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const execFile = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** Anything longer than this is trimmed: nobody listens to a 20k-character answer. */
const MAX_SPEECH_CHARS = 8000;
const DEFAULT_STYLE = '自然、亲切、清晰的语气，语速适中，像在和朋友聊天。';
function tempDir() {
    const dir = node_path_1.default.join(node_os_1.default.tmpdir(), 'domeos-tts');
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function runPowerShell(scriptName, script, args, timeout) {
    // the script goes to a file: it is multi-line, and -File keeps the argument list simple
    const file = node_path_1.default.join(tempDir(), scriptName);
    node_fs_1.default.writeFileSync(file, '\uFEFF' + script, 'utf8');
    return execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}
// ---------------------------------------------------------------- listing the Windows voices
//
// OneCore first (these are the voices the Windows settings app lists for Narrator), then
// the classic SAPI5 ones. A display name is only ever owned by one of the two engines, so
// the name is enough to route a later synthesis request back to the right one.
const VOICES_PS = `
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime] | Out-Null
  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
    Write-Output ("onecore|" + $v.DisplayName + "|" + $v.Language + "|" + $v.Gender)
  }
} catch { }
try {
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  foreach ($v in $s.GetInstalledVoices()) {
    if ($v.Enabled) { Write-Output ("sapi|" + $v.VoiceInfo.Name + "|" + $v.VoiceInfo.Culture.Name + "|" + $v.VoiceInfo.Gender) }
  }
  $s.Dispose()
} catch { }
`;
let voicesCache = { at: 0, list: [] };
async function listWindowsVoices(force = false) {
    if (!force && Date.now() - voicesCache.at < 60_000 && voicesCache.list.length)
        return voicesCache.list;
    const { stdout } = await runPowerShell('voices.ps1', VOICES_PS, [], 60_000);
    const list = [];
    for (const line of String(stdout).split(/\r?\n/)) {
        const parts = line.split('|');
        if (parts.length < 3)
            continue;
        const [source, name, culture, gender] = parts;
        if (source !== 'onecore' && source !== 'sapi')
            continue;
        const clean = name.trim();
        if (!clean || list.some((v) => v.name === clean))
            continue;
        list.push({ source, name: clean, culture: culture.trim(), gender: (gender || '').trim() });
    }
    if (list.length)
        voicesCache = { at: Date.now(), list };
    return list;
}
// ---------------------------------------------------------------- Windows synthesis
const AWAIT_PS = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
`;
const ONECORE_PS = `
param([string]$TextFile, [string]$OutFile, [string]$Voice, [int]$Rate)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${AWAIT_PS}
[Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime] | Out-Null
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
if ($Voice) {
  $picked = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $Voice } | Select-Object -First 1
  if ($picked) { $synth.Voice = $picked }
}
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
$escaped = [System.Security.SecurityElement]::Escape($text)
$rateStr = if ($Rate -ge 0) { "+$Rate%" } else { "$Rate%" }
$lang = $synth.Voice.Language
$ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$lang'><prosody rate='$rateStr'>$escaped</prosody></speak>"
$stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$inStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
$out = [System.IO.File]::Create($OutFile)
$inStream.CopyTo($out)
$out.Close()
$inStream.Close()
Write-Output "OK"
`;
const SAPI_PS = `
param([string]$TextFile, [string]$OutFile, [string]$Voice, [int]$Rate)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) { try { $s.SelectVoice($Voice) } catch { } }
$s.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
$s.SetOutputToWaveFile($OutFile)
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
$s.Speak($text)
$s.Dispose()
Write-Output "OK"
`;
async function synthesizeWindows(text, voice, ratePercent) {
    const dir = tempDir();
    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const textFile = node_path_1.default.join(dir, `say-${stamp}.txt`);
    const outFile = node_path_1.default.join(dir, `say-${stamp}.wav`);
    node_fs_1.default.writeFileSync(textFile, text, 'utf8');
    try {
        const known = await listWindowsVoices().catch(() => []);
        const entry = known.find((v) => v.name === voice);
        const order = entry ? [entry.source] : ['onecore', 'sapi'];
        let lastError = null;
        for (const source of order) {
            const sapiRate = Math.max(-10, Math.min(10, Math.round(ratePercent / 10)));
            try {
                if (source === 'onecore') {
                    await runPowerShell('onecore.ps1', ONECORE_PS, [textFile, outFile, voice || '', String(ratePercent)], 180_000);
                }
                else {
                    await runPowerShell('sapi.ps1', SAPI_PS, [textFile, outFile, voice || '', String(sapiRate)], 180_000);
                }
                const wav = node_fs_1.default.readFileSync(outFile);
                if (wav.length > 44)
                    return wav;
                lastError = new Error('the synthesiser produced no audio');
            }
            catch (e) {
                lastError = new Error(`${source}: ${e?.message ?? e}`);
            }
        }
        throw lastError ?? new Error('no Windows voice could synthesise this text');
    }
    finally {
        try {
            node_fs_1.default.rmSync(textFile, { force: true });
        }
        catch {
            /* ignore */
        }
        try {
            node_fs_1.default.rmSync(outFile, { force: true });
        }
        catch {
            /* ignore */
        }
    }
}
// ---------------------------------------------------------------- MiMo TTS
/** Accepts both the base (…/v1) and the full endpoint (…/v1/chat/completions). */
function mimoEndpoint(base) {
    const trimmed = String(base || 'https://api.xiaomimimo.com/v1').trim().replace(/\/+$/, '');
    return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}
async function synthesizeMimo(tts, text, signal) {
    const url = mimoEndpoint(tts.mimoBase);
    const body = {
        model: tts.mimoModel || 'mimo-v2.5-tts',
        messages: [
            { role: 'user', content: tts.mimoStyle || DEFAULT_STYLE },
            { role: 'assistant', content: text },
        ],
        audio: { format: 'wav', voice: tts.mimoVoice || 'mimo_default' },
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tts.mimoKey}` },
        body: JSON.stringify(body),
        signal: signal ? (AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : signal) : AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 300);
        }
        catch {
            /* ignore */
        }
        throw new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    const json = await res.json();
    const audio = json?.choices?.[0]?.message?.audio;
    const data = typeof audio === 'string' ? audio : audio?.data;
    if (!data)
        throw new Error('the response carried no audio');
    return { data, mime: 'audio/wav', buf: Buffer.from(data, 'base64') };
}
// ---------------------------------------------------------------- the two public entry points
/**
 * Marks the text up for reading aloud: code blocks and markdown syntax would be read as
 * noise, so they are dropped or unwrapped before anything is synthesised.
 */
function cleanForSpeech(text) {
    let s = String(text ?? '');
    s = s.replace(/```[\s\S]*?(?:```|$)/g, '。');
    s = s.replace(/`([^`]*)`/g, '$1');
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // a filesystem path is noise when read aloud - keep only the last segment, so
    // "C:\Program Files (x86)\ByteDance\douyin\douyin.exe" is spoken as "douyin.exe"
    s = s.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^`"'\r\n\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]*/g, (m) => {
        const trimmed = m.replace(/[\s.,;:!?)\]}>]+$/, '');
        const parts = trimmed.split(/[\\/]+/).filter(Boolean);
        const tail = parts.length ? parts[parts.length - 1] : '';
        return tail + m.slice(trimmed.length);
    });
    s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '');
    s = s.replace(/^\s{0,3}>\s?/gm, '');
    s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
    s = s.replace(/(\*|_)([^*_\n]+)\1/g, '$2');
    s = s.replace(/^\s{0,3}[-*+]\s+/gm, '');
    s = s.replace(/^\s{0,3}\d+\.\s+/gm, '');
    s = s.replace(/^\s{0,3}[-:|\s]+$/gm, '');
    s = s.replace(/\|/g, '，');
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/\s*\n\s*/g, '。');
    s = s.replace(/。{2,}/g, '。');
    s = s.replace(/^[。，、\s]+/, '');
    s = s.trim();
    if (s.length > MAX_SPEECH_CHARS)
        s = s.slice(0, MAX_SPEECH_CHARS);
    return s;
}
/**
 * Reads a piece of text out. MiMo TTS is tried first whenever a key exists; the Windows
 * voices are the fallback, so the answer is only a failure when both are unavailable.
 */
async function speakText(cfg, rawText, signal) {
    const tts = cfg?.tts ?? {};
    const text = cleanForSpeech(rawText);
    if (!text)
        return { ok: false, error: 'nothing to read' };
    const engine = tts.engine === 'mimo' || tts.engine === 'microsoft' ? tts.engine : 'auto';
    let warning = '';
    if (engine !== 'microsoft' && tts.mimoKey) {
        try {
            const out = await synthesizeMimo(tts, text, signal);
            return { ok: true, engine: 'mimo', mime: out.mime, data: out.data };
        }
        catch (e) {
            // stopping means stopping: a cancelled run never falls through to another engine
            if (signal?.aborted)
                return { ok: false, error: 'cancelled' };
            warning = `MiMo TTS: ${e?.message ?? e}`;
        }
    }
    else if (engine === 'mimo') {
        warning = 'MiMo TTS is selected but no API key is set';
    }
    if (signal?.aborted)
        return { ok: false, error: 'cancelled' };
    try {
        const wav = await synthesizeWindows(text, (tts.msVoice || '').trim(), Math.max(-50, Math.min(100, Number(tts.msRate) || 0)));
        return { ok: true, engine: 'microsoft', mime: 'audio/wav', data: wav.toString('base64'), warning: warning || undefined };
    }
    catch (e) {
        const detail = e?.message ?? String(e);
        return { ok: false, error: warning ? `${warning} - ${detail}` : detail };
    }
}