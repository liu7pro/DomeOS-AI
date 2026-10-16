"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUiLang = resolveUiLang;
exports.languageRules = languageRules;
function resolveUiLang(lang) {
    if (lang === 'zh-CN' || lang === 'en')
        return lang;
    try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
        const probe = `${process.env.LANG ?? ''} ${process.env.LC_ALL ?? ''} ${locale}`.toLowerCase();
        return probe.includes('zh') || probe.includes('chinese') ? 'zh-CN' : 'en';
    }
    catch {
        return 'en';
    }
}
const RULES = {
    'zh-CN': [
        'Language: answer in the language the user writes in. If the user writes Chinese, answer in Simplified Chinese (简体中文), including your tool summaries and the final report. Never switch to English on your own.',
        'Do not print your reasoning, your plan or a preamble - start with the answer or the action.',
    ],
    en: [
        'Language: answer in the language the user writes in. If the user writes Chinese, answer in Simplified Chinese; if the user writes English, answer in English. Never switch language on your own.',
        'Do not print your reasoning, your plan or a preamble - start with the answer or the action.',
    ],
};
function languageRules(lang) {
    return RULES[resolveUiLang(lang)].join('\n');
}
