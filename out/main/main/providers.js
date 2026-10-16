"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeProvider = activeProvider;
exports.buildChatRequest = buildChatRequest;
exports.makeAccumulator = makeAccumulator;
exports.extractErrorMessage = extractErrorMessage;
exports.hintForStatus = hintForStatus;
exports.streamChat = streamChat;
exports.listModels = listModels;
const trimSlash = (s) => s.replace(/\/+$/, '');
/** messages may carry a plain string or a text+image part list; normalise both */
function splitContent(content) {
    if (typeof content === 'string')
        return { text: content, images: [] };
    if (!Array.isArray(content))
        return { text: content == null ? '' : String(content), images: [] };
    const text = content.filter((p) => p && p.type === 'text').map((p) => p.text ?? '').join('\n');
    const images = content.filter((p) => p && p.type === 'image' && p.data);
    return { text, images };
}
function activeProvider(cfg) {
    return cfg.providers[cfg.active] ?? cfg.providers[0];
}
// ---------------------------------------------------------------- request bodies
function openAiTools(tools) {
    return tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}
/** Converts our JSON-Schema subset into the declaration shape Gemini wants. */
function toGeminiSchema(schema) {
    if (!schema || typeof schema !== 'object')
        return { type: 'STRING' };
    const map = {
        string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN',
        array: 'ARRAY', object: 'OBJECT',
    };
    const out = {};
    const type = map[String(schema.type ?? 'object')] ?? 'STRING';
    out.type = type;
    if (schema.description)
        out.description = String(schema.description);
    if (type === 'OBJECT' && schema.properties) {
        out.properties = {};
        for (const k of Object.keys(schema.properties))
            out.properties[k] = toGeminiSchema(schema.properties[k]);
        if (Array.isArray(schema.required) && schema.required.length)
            out.required = schema.required;
    }
    if (type === 'ARRAY' && schema.items)
        out.items = toGeminiSchema(schema.items);
    return out;
}
function buildChatRequest(provider, messages, tools = []) {
    const base = trimSlash(provider.base);
    const headers = { 'Content-Type': 'application/json' };
    const useTools = tools.length > 0;
    // the caller usually passes its own system turn; fall back to the profile prompt so
    // every protocol always sees one, even for plain message lists
    let convo = messages;
    if (provider.sysPrompt && !messages.some((m) => m.role === 'system')) {
        convo = [{ role: 'system', content: provider.sysPrompt }, ...messages];
    }
    if (provider.proto === 'openai' || provider.proto === 'ollama') {
        const isOllama = provider.proto === 'ollama';
        const body = {
            model: provider.model,
            stream: true,
            messages: convo.map((m) => {
                if (m.role === 'tool') {
                    return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
                }
                if (m.role === 'assistant' && m.tool_calls?.length) {
                    return {
                        role: 'assistant',
                        content: m.content || '',
                        tool_calls: m.tool_calls.map((c) => ({
                            id: c.id,
                            type: 'function',
                            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
                        })),
                    };
                }
                const sc = splitContent(m.content);
                if (isOllama) {
                    const om = { role: m.role, content: sc.text };
                    if (sc.images.length)
                        om.images = sc.images.map((im) => im.data);
                    return om;
                }
                if (!sc.images.length)
                    return { role: m.role, content: sc.text };
                const parts = [];
                if (sc.text)
                    parts.push({ type: 'text', text: sc.text });
                for (const im of sc.images)
                    parts.push({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } });
                return { role: m.role, content: parts };
            }),
        };
        if (isOllama) {
            body.options = { temperature: provider.temp, num_predict: provider.maxTok > 0 ? provider.maxTok : -1 };
            if (useTools)
                body.tools = openAiTools(tools);
        }
        else {
            body.temperature = provider.temp;
            if (provider.maxTok > 0)
                body.max_tokens = provider.maxTok;
            if (useTools) {
                body.tools = openAiTools(tools);
                body.tool_choice = 'auto';
            }
        }
        if (provider.key)
            headers.Authorization = `Bearer ${provider.key}`;
        const url = isOllama ? `${base}/api/chat` : `${base}/chat/completions`;
        return { url, safeUrl: url, headers, body: JSON.stringify(body) };
    }
    if (provider.proto === 'anthropic') {
        headers['x-api-key'] = provider.key;
        headers['anthropic-version'] = '2023-06-01';
        const msgs = [];
        for (const m of convo) {
            if (m.role === 'system')
                continue;
            if (m.role === 'tool') {
                msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] });
                continue;
            }
            if (m.role === 'assistant' && m.tool_calls?.length) {
                const content = [];
                if (m.content)
                    content.push({ type: 'text', text: m.content });
                for (const c of m.tool_calls)
                    content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
                msgs.push({ role: 'assistant', content });
                continue;
            }
            const sc = splitContent(m.content);
            if (!sc.images.length) {
                msgs.push({ role: m.role, content: sc.text });
            }
            else {
                const parts = [];
                if (sc.text)
                    parts.push({ type: 'text', text: sc.text });
                for (const im of sc.images)
                    parts.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
                msgs.push({ role: m.role, content: parts });
            }
        }
        const body = {
            model: provider.model,
            max_tokens: provider.maxTok > 0 ? provider.maxTok : 8192,
            temperature: provider.temp,
            stream: true,
            messages: msgs,
        };
        const sys = convo.find((m) => m.role === 'system')?.content || provider.sysPrompt;
        if (sys)
            body.system = sys;
        if (useTools) {
            body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
        }
        return { url: `${base}/messages`, safeUrl: `${base}/messages`, headers, body: JSON.stringify(body) };
    }
    // gemini
    const contents = [];
    for (const m of convo) {
        if (m.role === 'system')
            continue;
        if (m.role === 'tool') {
            contents.push({
                role: 'user',
                parts: [{ functionResponse: { name: m.name ?? 'tool', response: { result: m.content } } }],
            });
            continue;
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
            const parts = [];
            if (m.content)
                parts.push({ text: m.content });
            for (const c of m.tool_calls)
                parts.push({ functionCall: { name: c.name, args: c.args ?? {} } });
            contents.push({ role: 'model', parts });
            continue;
        }
        const sc = splitContent(m.content);
        const gParts = [];
        if (sc.text)
            gParts.push({ text: sc.text });
        for (const im of sc.images)
            gParts.push({ inline_data: { mime_type: im.mime, data: im.data } });
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: gParts });
    }
    const body = {
        contents,
        generationConfig: { temperature: provider.temp, ...(provider.maxTok > 0 ? { maxOutputTokens: provider.maxTok } : {}) },
    };
    const sys = messages.find((m) => m.role === 'system')?.content || provider.sysPrompt;
    if (sys)
        body.systemInstruction = { parts: [{ text: sys }] };
    if (useTools) {
        body.tools = [{ functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: toGeminiSchema(t.parameters),
                })) }];
    }
    const url = `${base}/models/${encodeURIComponent(provider.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.key)}`;
    return { url, safeUrl: `${base}/models/${encodeURIComponent(provider.model)}:streamGenerateContent`, headers, body: JSON.stringify(body) };
}
function makeAccumulator(proto, hooks) {
    let text = '';
    let sawAnything = false;
    const calls = [];
    /** openai: index -> partial call; anthropic: block index -> id/name/json */
    const pending = new Map();
    const idFor = (raw) => raw || `call_${Math.random().toString(36).slice(2, 10)}`;
    const feed = (line) => {
        let s = line.trim();
        if (!s || s.startsWith(':'))
            return;
        if (s.startsWith('data:'))
            s = s.slice(5).trim();
        if (!s || s === '[DONE]')
            return;
        let json;
        try {
            json = JSON.parse(s);
        }
        catch {
            return;
        }
        sawAnything = true;
        if (proto === 'anthropic') {
            const type = json?.type;
            if (type === 'content_block_start') {
                const block = json?.content_block;
                if (block?.type === 'tool_use') {
                    pending.set(Number(json.index), { id: idFor(block.id), name: String(block.name ?? ''), json: '' });
                }
                else if (typeof block?.text === 'string' && block.text) {
                    text += block.text;
                    hooks.onDelta(block.text);
                }
                return;
            }
            if (type === 'content_block_delta') {
                const d = json?.delta;
                if (d?.type === 'text_delta' && typeof d.text === 'string') {
                    text += d.text;
                    hooks.onDelta(d.text);
                }
                else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
                    const slot = pending.get(Number(json.index));
                    if (slot)
                        slot.json += d.partial_json;
                }
                return;
            }
            return;
        }
        if (proto === 'gemini') {
            const parts = json?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                for (const p of parts) {
                    if (p?.thought)
                        continue;
                    if (typeof p?.text === 'string' && p.text) {
                        text += p.text;
                        hooks.onDelta(p.text);
                    }
                    if (p?.functionCall) {
                        calls.push({
                            id: idFor(p.functionCall.id),
                            name: String(p.functionCall.name ?? ''),
                            args: (p.functionCall.args ?? {}),
                        });
                    }
                }
            }
            return;
        }
        if (proto === 'ollama') {
            const msg = json?.message;
            if (typeof msg?.content === 'string' && msg.content) {
                text += msg.content;
                hooks.onDelta(msg.content);
            }
            if (Array.isArray(msg?.tool_calls)) {
                for (const c of msg.tool_calls) {
                    const fn = c?.function ?? {};
                    let args = {};
                    if (fn.arguments && typeof fn.arguments === 'object')
                        args = fn.arguments;
                    else if (typeof fn.arguments === 'string') {
                        try {
                            args = JSON.parse(fn.arguments);
                        }
                        catch {
                            args = {};
                        }
                    }
                    calls.push({ id: idFor(c.id), name: String(fn.name ?? ''), args });
                }
            }
            return;
        }
        // openai compatible
        const choice = json?.choices?.[0];
        if (!choice)
            return;
        const delta = choice.delta ?? choice.message ?? {};
        if (typeof delta?.content === 'string' && delta.content) {
            text += delta.content;
            hooks.onDelta(delta.content);
        }
        const list = delta?.tool_calls;
        if (Array.isArray(list)) {
            for (const tc of list) {
                const idx = Number(tc?.index ?? calls.length);
                let slot = pending.get(idx);
                if (!slot) {
                    slot = { id: idFor(tc?.id), name: String(tc?.function?.name ?? tc?.name ?? ''), json: '' };
                    pending.set(idx, slot);
                }
                if (tc?.id)
                    slot.id = String(tc.id);
                if (tc?.function?.name)
                    slot.name = String(tc.function.name);
                if (typeof tc?.function?.arguments === 'string')
                    slot.json += tc.function.arguments;
            }
        }
    };
    return {
        get text() {
            return text;
        },
        get calls() {
            return calls;
        },
        get sawAnything() {
            return sawAnything;
        },
        feed,
        finish() {
            for (const slot of pending.values()) {
                if (!slot.name)
                    continue;
                let args = {};
                const raw = slot.json.trim();
                if (raw) {
                    try {
                        args = JSON.parse(raw);
                    }
                    catch {
                        args = { _raw: raw };
                    }
                }
                calls.push({ id: slot.id, name: slot.name, args });
            }
            const assistant = text || calls.length ? { role: 'assistant', content: text, tool_calls: calls } : null;
            return {
                text,
                toolCalls: calls,
                ok: true,
                wire: assistant,
            };
        },
    };
}
/** Error payloads come back as plain JSON, or wrapped in an SSE frame. */
function extractErrorMessage(proto, raw) {
    const tryJson = (s) => {
        try {
            const j = JSON.parse(s);
            const msg = j?.error?.message ?? j?.error?.type ?? j?.message ?? j?.detail;
            if (typeof msg === 'string' && msg.trim())
                return msg.trim();
        }
        catch {
            /* not json */
        }
        return '';
    };
    const whole = tryJson(raw.trim());
    if (whole)
        return whole;
    for (const line of raw.split(/\r?\n/)) {
        const s = line.trim();
        if (!s || s.startsWith(':'))
            continue;
        const payload = s.startsWith('data:') ? s.slice(5).trim() : s;
        if (!payload || payload === '[DONE]')
            continue;
        const msg = tryJson(payload);
        if (msg)
            return msg;
    }
    return '';
}
function hintForStatus(status) {
    switch (status) {
        case 401: return 'err.key';
        case 402: return 'err.balance';
        case 403: return 'err.denied';
        case 404: return 'err.notfound';
        case 429: return 'err.quota';
        default: return status >= 500 ? 'err.server' : undefined;
    }
}
/** Runs one streaming turn. Never throws; failures come back as { ok:false }. */
async function streamChat(provider, messages, tools, hooks, signal) {
    let req;
    try {
        req = buildChatRequest(provider, messages, tools);
    }
    catch (e) {
        return { text: '', toolCalls: [], ok: false, hint: String(e), wire: null };
    }
    hooks.onStatus(`POST ${req.safeUrl}`);
    let res;
    try {
        res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal });
    }
    catch (e) {
        if (signal.aborted)
            return { text: '', toolCalls: [], ok: true, wire: null };
        return { text: '', toolCalls: [], ok: false, hint: `err.network ${e?.message ?? e}`, wire: null };
    }
    if (!res.ok) {
        let detail = '';
        try {
            detail = extractErrorMessage(provider.proto, await res.text());
        }
        catch {
            /* ignore */
        }
        if (detail.length > 900)
            detail = detail.slice(0, 900) + '...';
        return {
            text: '',
            toolCalls: [],
            ok: false,
            hint: `${hintForStatus(res.status) ?? 'err.http'} ${res.status} ${detail || res.statusText}`,
            wire: null,
        };
    }
    if (!res.body)
        return { text: '', toolCalls: [], ok: false, hint: 'err.network empty response body', wire: null };
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const acc = makeAccumulator(provider.proto, hooks);
    let buffer = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                acc.feed(buffer.slice(0, nl).replace(/\r$/, ''));
                buffer = buffer.slice(nl + 1);
            }
        }
        if (buffer.trim())
            acc.feed(buffer);
    }
    catch (e) {
        if (signal.aborted)
            return acc.finish();
        const partial = acc.finish();
        return { ...partial, ok: false, hint: `err.network ${e?.message ?? e}` };
    }
    const result = acc.finish();
    if (!result.text && !result.toolCalls.length && !acc.sawAnything) {
        return { text: '', toolCalls: [], ok: false, hint: 'err.empty', wire: null };
    }
    return result;
}
/** Best effort model list for the providers that expose one. */
async function listModels(provider) {
    const base = trimSlash(provider.base);
    try {
        if (provider.proto === 'ollama') {
            const r = await fetch(`${base}/api/tags`);
            if (!r.ok)
                return [];
            const j = await r.json();
            return Array.isArray(j?.models) ? j.models.map((m) => String(m?.name ?? '')).filter(Boolean) : [];
        }
        if (provider.proto === 'openai') {
            const r = await fetch(`${base}/models`, {
                headers: provider.key ? { Authorization: `Bearer ${provider.key}` } : {},
            });
            if (!r.ok)
                return [];
            const j = await r.json();
            return Array.isArray(j?.data) ? j.data.map((m) => String(m?.id ?? '')).filter(Boolean) : [];
        }
        if (provider.proto === 'gemini') {
            const r = await fetch(`${base}/models?key=${encodeURIComponent(provider.key)}`);
            if (!r.ok)
                return [];
            const j = await r.json();
            return Array.isArray(j?.models)
                ? j.models.map((m) => String(m?.name ?? '').replace(/^models\//, '')).filter(Boolean)
                : [];
        }
    }
    catch {
        /* offline is fine */
    }
    return [];
}
