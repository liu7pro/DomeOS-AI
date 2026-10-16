# DomeOS AI

DomeOS AI 是一个 Electron 桌面 AI 助手（Electron desktop AI agent）。

## 功能概览

- **多服务商自定义 API**：内置数十家服务商预设（OpenAI / Anthropic / Google Gemini / Ollama 兼容），支持自定义 base URL、协议与模型
- **Agent 工具调用**：读写文件、执行命令、联网搜索、思考模式，带权限确认与工作区沙箱
- **附件**：拖拽 / `Ctrl+V` / 按钮添加图片与任意文件，随消息发送
- **界面**：玻璃材质（Liquid Glass，仅玻璃边缘折射）、可自定义背景（图片 / 视频 / 纯色）、6 套主题预设与 5 种纹饰、深浅色跟随系统
- **语音**：TTS 语音合成（MiMo TTS 优先，Microsoft 系统语音兜底），合成中与播放中均可停止；内置常驻离线语音服务（Windows 语音识别）与「Hey, Dome」唤醒词、Agent Orb
- **其它**：设置以窗口内嵌面板打开、首次启动的协议阅读与新手引导、关于页双击可开 Chrome Dino

## 仓库内容

这是应用的构建产物源码快照：`out/` 为编译后的主进程（Electron main）与渲染端（renderer）代码。
**不含** `node_modules`、字体资源与安装包。

| 路径 | 说明 |
|---|---|
| `out/main/main/` | 主进程：窗口、IPC、Agent、TTS、语音服务、配置、媒体、托盘… |
| `out/renderer/` | 渲染端页面（主窗口 / 设置 / 悬浮栏）与打包后的前端资源 |
| `build.nsi` | NSIS 安装包脚本 |
| `DomeVoice.cs` | 「DomeOS AI」语音服务小程序源码（基于 Windows 语音识别 System.Speech） |

## 构建说明

1. 安装依赖并打包，产出 `out/`；
2. 编译语音服务（进程在任务管理器显示为 `DomeOS AI`）：

   ```powershell
   Add-Type -TypeDefinition (Get-Content .\DomeVoice.cs -Raw) `
     -OutputAssembly .\app\DomeOSVoice.exe `
     -OutputType ConsoleApplication -ReferencedAssemblies System.Speech
   ```

3. 用 NSIS（`makensis`）执行 `build.nsi` 生成安装包。

> 安装包体积约 156 MB，未纳入仓库；如需分发可挂到 Releases。
