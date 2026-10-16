"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL_HINTS = exports.PRESETS = void 0;
exports.presetToConfig = presetToConfig;
exports.defaultProviders = defaultProviders;
// src/main/registry.ts - the catalogue of AI services DomeOS AI knows how to talk to.
//
// Every entry is a preset: picking one fills in the protocol, the base URL and a sensible
// default model. Users can still type over any field, so this is a starting point rather
// than a restriction.
const persona_1 = require("./persona");
/** Every preset starts from the same persona, so the character survives a provider switch. */
const SYS = persona_1.DEFAULT_SYS;
exports.PRESETS = [
    // ------------------------------------------------------------------ first party labs
    { id: 'deepseek', name: 'DeepSeek 深度求索', proto: 'openai', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keys: 'platform.deepseek.com', note: 'deepseek-chat 自动指向最新 V4.1-Flash', group: 'labs', },
    { id: 'openai', name: 'OpenAI', proto: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-6.1-sol', keys: 'platform.openai.com', note: '旗舰 gpt-6-astra；低价 gpt-6-luna', group: 'labs', },
    { id: 'anthropic', name: 'Anthropic Claude', proto: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5', keys: 'console.anthropic.com', note: '旗舰 claude-fable-5-1', group: 'labs', },
    { id: 'gemini', name: 'Google Gemini', proto: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-pro', keys: 'aistudio.google.com', note: '最新 gemini-3.8-flash', group: 'labs', },
    { id: 'xai', name: 'xAI Grok', proto: 'openai', base: 'https://api.x.ai/v1', model: 'grok-4.3', keys: 'console.x.ai', note: '2M 上下文；低价 grok-4.1-fast', group: 'labs', },
    { id: 'mistral', name: 'Mistral AI', proto: 'openai', base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', keys: 'console.mistral.ai', group: 'labs', },
    { id: 'cohere', name: 'Cohere', proto: 'openai', base: 'https://api.cohere.ai/compatibility/v1', model: 'command-a', keys: 'dashboard.cohere.com', note: 'Compatibility endpoint', group: 'labs', },
    { id: 'perplexity', name: 'Perplexity', proto: 'openai', base: 'https://api.perplexity.ai', model: 'sonar-pro', keys: 'perplexity.ai/settings/api', note: 'Answers with live web citations', group: 'labs', },
    { id: 'azure', name: 'Azure OpenAI', proto: 'openai', base: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1', model: 'gpt-6.1-sol', keys: 'portal.azure.com', note: '先把 base 换成你的资源地址', group: 'labs', },
    // ------------------------------------------------------------------ aggregators & hosting
    { id: 'openrouter', name: 'OpenRouter', proto: 'openai', base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-5.5', keys: 'openrouter.ai/keys', note: 'One key, hundreds of models', group: 'hosts', },
    { id: 'groq', name: 'Groq', proto: 'openai', base: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct', keys: 'console.groq.com', note: 'Very fast inference', group: 'hosts', },
    { id: 'together', name: 'Together AI', proto: 'openai', base: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', keys: 'api.together.xyz', group: 'hosts', },
    { id: 'fireworks', name: 'Fireworks AI', proto: 'openai', base: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama4-scout-instruct', keys: 'fireworks.ai', group: 'hosts', },
    { id: 'deepinfra', name: 'DeepInfra', proto: 'openai', base: 'https://api.deepinfra.com/v1/openai', model: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', keys: 'deepinfra.com', group: 'hosts', },
    { id: 'cerebras', name: 'Cerebras', proto: 'openai', base: 'https://api.cerebras.ai/v1', model: 'llama-4-scout-17b-16e', keys: 'cloud.cerebras.ai', group: 'hosts', },
    { id: 'sambanova', name: 'SambaNova', proto: 'openai', base: 'https://api.sambanova.ai/v1', model: 'Meta-Llama-4-Scout-17B-16E-Instruct', keys: 'cloud.sambanova.ai', group: 'hosts', },
    { id: 'nvidia', name: 'NVIDIA NIM', proto: 'openai', base: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', keys: 'ngc.nvidia.com', group: 'hosts', },
    { id: 'huggingface', name: 'HuggingFace Inference', proto: 'openai', base: 'https://router.huggingface.co/v1', model: 'auto', keys: 'huggingface.co/settings/tokens', note: 'auto 路由到最合适的开源模型', group: 'hosts', },
    { id: 'novita', name: 'Novita AI', proto: 'openai', base: 'https://api.novita.ai/v3/openai', model: 'deepseek/deepseek-v4.1-flash', keys: 'novita.ai', group: 'hosts', },
    { id: 'hyperbolic', name: 'Hyperbolic', proto: 'openai', base: 'https://api.hyperbolic.xyz/v1', model: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', keys: 'app.hyperbolic.xyz', group: 'hosts', },
    { id: 'github', name: 'GitHub Models', proto: 'openai', base: 'https://models.github.ai/inference', model: 'openai/gpt-6.1-sol', keys: 'github.com/settings/tokens', note: '用 GitHub token 免费试用各家模型', group: 'hosts', },
    // ------------------------------------------------------------------ china
    { id: 'siliconflow', name: 'SiliconFlow 硅基流动', proto: 'openai', base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V4-Flash', keys: 'siliconflow.cn', group: 'china', },
    { id: 'infini', name: '无问芯穹 InfiniAI', proto: 'openai', base: 'https://cloud.infini-ai.com/maas/v1', model: 'deepseek-ai/DeepSeek-V4-Flash', keys: 'cloud.infini-ai.com', group: 'china', },
    { id: 'volcengine', name: '火山方舟 (Volcengine)', proto: 'openai', base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-evolving', keys: 'console.volcengine.com/ark', note: '统一别名，自动指向最新豆包', group: 'china', },
    { id: 'dashscope', name: '阿里云百炼 (Qwen)', proto: 'openai', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max', keys: 'bailian.console.aliyun.com', note: 'qwen-max 自动指向最新旗舰', group: 'china', },
    { id: 'zhipu', name: '智谱 GLM', proto: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', keys: 'open.bigmodel.cn', note: '低价多模态 glm-5.3-flash', group: 'china', },
    { id: 'moonshot', name: '月之暗面 Kimi', proto: 'openai', base: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6', keys: 'platform.moonshot.cn', group: 'china', },
    { id: 'minimax', name: 'MiniMax', proto: 'openai', base: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2', keys: 'platform.minimaxi.com', group: 'china', },
    { id: 'qianfan', name: '百度千帆 ERNIE', proto: 'openai', base: 'https://qianfan.baidubce.com/v2', model: 'ernie-5.0-tianque', keys: 'console.bce.baidu.com/qianfan', group: 'china', },
    { id: 'xfyun', name: '讯飞星火 Spark', proto: 'openai', base: 'https://spark-api-open.xf-yun.com/v1', model: 'Spark-X2.5', keys: 'xinghuo.xfyun.cn', group: 'china', },
    { id: 'hunyuan', name: '腾讯混元 Hunyuan', proto: 'openai', base: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hy3', keys: 'console.cloud.tencent.com/hunyuan', group: 'china', },
    { id: 'baichuan', name: '百川 Baichuan', proto: 'openai', base: 'https://api.baichuan-ai.com/v1', model: 'Baichuan4', keys: 'platform.baichuan-ai.com', group: 'china', },
    { id: 'stepfun', name: '阶跃星辰 StepFun', proto: 'openai', base: 'https://api.stepfun.com/v1', model: 'step-5-preview', keys: 'platform.stepfun.com', group: 'china', },
    { id: 'lingyi', name: '零一万物 Yi', proto: 'openai', base: 'https://api.lingyiinac.com/v1', model: 'yi-lightning', keys: 'platform.lingyiwanwu.com', group: 'china', },
    { id: 'sensenova', name: '商汤日日新 SenseNova', proto: 'openai', base: 'https://api.sensenova.cn/compatible-mode/v1', model: 'SenseChat-5', keys: 'platform.sensenova.cn', group: 'china', },
    // ------------------------------------------------------------------ local runtimes
    { id: 'ollama', name: 'Ollama (local)', proto: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3:8b', note: 'Runs on this machine, no key', group: 'local', },
    { id: 'lmstudio', name: 'LM Studio (local)', proto: 'openai', base: 'http://127.0.0.1:1234/v1', model: 'local-model', note: 'Start the local server first', group: 'local', },
    { id: 'vllm', name: 'vLLM / llama.cpp (local)', proto: 'openai', base: 'http://127.0.0.1:8000/v1', model: 'my-model', note: 'Any OpenAI-compatible server', group: 'local', },
    // ------------------------------------------------------------------ escape hatch
    { id: 'custom', name: 'Custom (OpenAI compatible)', proto: 'openai', base: 'http://127.0.0.1:8000/v1', model: 'my-model', note: 'Point it anywhere', group: 'custom', },
];
/** Suggestions for the model combobox, per protocol. */
exports.MODEL_HINTS = {
    openai: [
        'deepseek-chat', 'deepseek-v4.1-flash', 'deepseek-v4-pro',
        'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-sol',
        'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1',
        'gemini-3.8-flash', 'grok-4.3', 'grok-4.1-fast',
        'mistral-large-latest', 'command-a', 'sonar-pro',
        'glm-5.3', 'glm-5.3-flash', 'kimi-k2.6', 'qwen-max',
        'doubao-seed-evolving', 'hy3', 'ernie-5.0-tianque', 'MiniMax-M2',
        'anthropic/claude-sonnet-5.5', 'meta-llama/Llama-4-Scout-17B-16E-Instruct', 'auto',
    ],
    anthropic: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
    gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.1-pro', 'gemini-3.1-flash'],
    ollama: ['qwen3:8b', 'deepseek-v4-flash:16b', 'llama4:scout', 'llama3.2', 'glm-5:9b', 'mistral', 'phi4'],
};
function presetToConfig(preset, keepKey = '') {
    return {
        id: preset.id,
        name: preset.name,
        proto: preset.proto,
        base: preset.base,
        model: preset.model,
        key: keepKey,
        sysPrompt: SYS,
        temp: 0.7,
        maxTok: 0,
    };
}
function defaultProviders() {
    // the six that get a slot out of the box; everything else is one click away in Settings
    const featured = ['deepseek', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama'];
    return featured.map((id) => {
        const preset = exports.PRESETS.find((p) => p.id === id) ?? exports.PRESETS[0];
        return presetToConfig(preset);
    });
}
