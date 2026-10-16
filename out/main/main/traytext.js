"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trayT = trayT;
function resolve(lang) {
    if (lang === 'zh-CN' || lang === 'en')
        return lang;
    try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
        const sys = process.env.LANG || process.env.LC_ALL || locale;
        return /^zh/i.test(String(sys)) || String(sys).toLowerCase().includes('chinese') ? 'zh-CN' : 'en';
    }
    catch {
        return 'en';
    }
}
const TABLE = {
    trayShowHide: ['显示 / 隐藏窗口  ({hotkey})', 'Show / hide  ({hotkey})'],
    trayTheme: ['主题', 'Theme'],
    themeAuto: ['跟随系统', 'Follow system'],
    themeLight: ['浅色', 'Light'],
    themeDark: ['深色', 'Dark'],
    trayLanguage: ['界面语言 / Language', 'Language / 界面语言'],
    trayOpenConfig: ['打开配置文件', 'Open config file'],
    trayOpenData: ['打开数据目录', 'Open data folder'],
    trayQuit: ['退出 DomeOS AI', 'Quit DomeOS AI'],
    trayTooltip: ['DomeOS Team AI Agent  ·  {hotkey}  ·  {light}', 'DomeOS Team AI Agent  ·  {hotkey}  ·  {light}'],
    notifyHidden: [
        '我还在后台运行，按 {hotkey} 可以叫我出来。',
        'Still running in the background - press {hotkey} to bring me back.',
    ],
    notifyHotkeyTaken: [
        '快捷键 {hotkey} 被其它程序占用了，请在设置里换一个。',
        'The hotkey {hotkey} is taken by another app - pick another one in Settings.',
    ],
    trayQuick: ['快捷指令栏  ({hotkey})', 'Quick command bar  ({hotkey})'],
    trayPerm: ['权限', 'Permission'],
    trayPermWorkspace: ['仅工作区内', 'Workspace only'],
    trayPermMachine: ['整个电脑（所有硬盘）', 'Whole computer (all drives)'],
    trayPermAsk: ['操作前询问我', 'Ask me before acting'],
    trayPermAuto: ['直接执行，不询问', 'Run without asking'],
    notifyQuickHotkeyTaken: [
        '快捷指令栏的快捷键 {hotkey} 被占用了，请在设置里换一个。',
        'The quick bar hotkey {hotkey} is taken - pick another one in Settings.',
    ],
    pickFolderTitle: ['选择工作区文件夹', 'Choose a workspace folder'],
    pickFolderButton: ['使用此文件夹', 'Use this folder'],
    pickImageTitle: ['选择背景图片', 'Choose a background image'],
    pickImageButton: ['使用这张图片', 'Use this image'],
    imageFiles: ['图片', 'Images'],
};
/** Returns a translator bound to the resolved language. */
function trayT(lang) {
    const idx = resolve(lang) === 'zh-CN' ? 0 : 1;
    return (key, vars) => {
        let text = TABLE[key][idx];
        if (vars)
            for (const k of Object.keys(vars))
                text = text.split(`{${k}}`).join(vars[k]);
        return text;
    };
}
