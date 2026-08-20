# 📝 更新日志 (CHANGELOG)

所有关于 **Xiaorui 2FA Security Vault** 的重要版本更新与功能迭代记录均在此列出。

---

## [1.1.0] - 2026-08-20

### 🚀 新增功能 (Features)
- **品牌全面升级**：项目与全平台组件正式更名为 **Xiaorui 2FA Security Vault**。
- **系统级深度链接联动 (`secureauth://`)**：
  - 浏览器插件在网页识别到 2FA 二维码后，支持一键点击 `[ 🚀 确认并拉起软件 ]`；
  - 桌面端 Electron 单实例锁捕获协议参数，自动置顶窗口并弹出「添加 2FA」模态框，智能预填参数并高亮聚焦文件名/备注输入框；
  - **锁定状态无缝衔接**：若桌面端处于锁定状态，用户输入主密码解锁后自动弹出该 2FA 账号的添加界面。
- **跨域 Canvas 穿透引擎 (CORS Tainted Canvas Bypass)**：
  - 针对托管于第三方 CDN 图床的 2FA 二维码，构建「本地 Canvas $\rightarrow$ 前端 Fetch Blob $\rightarrow$ Background 强权限代理通道」三级穿透抓取体系；
  - 引入 `jsQR` 配合硬件级 `BarcodeDetector` 双引擎解码，毫秒级完成纯前端离线识别。
- **双规范 Manifest V3 扩展**：
  - 同步兼容 Chrome、Edge 与 Mozilla Firefox（支持 `background.scripts` 与 `service_worker` 双轨加载）。
- **扩展快捷工具栏**：
  - 新增 `[ 🔍 扫描当前网页 ]` 主动扫描与 `[ 📷 选图识别导入 ]` 截图识别入口。
- **微软应用商店与 Edge Add-ons 准备**：
  - 生成 16、48、128、256、300、512 全尺寸高清 Store 图标；
  - 新增 `bun run package:extension-zip` 一键提审压缩脚本；
  - 编写完整的《微软商店与 Edge 扩展上架全指南》(`docs/MICROSOFT_STORE_SUBMISSION.md`)。

### 🐞 缺陷修复与稳定性优化 (Bug Fixes & Improvements)
- **修复 URL 协议类型提取为空报错**：解决特定 JS 环境下 `new URL("otpauth://totp/...")` 提取 `host` 为空导致的 `不支持的 2FA 类型: ` 异常，全面升级为稳健正则表达式引擎。
- **Base32 容错纠错**：自动过滤空格、连字符、等号填充，并智能修复易混淆字符（`0` $\rightarrow$ `O`，`1` $\rightarrow$ `I`，`8` $\rightarrow$ `B`），彻底解决 `密钥格式无效` 报错。
- **打包稳定性增强**：优化 Windows 便携版单文件打包流程，避免进程占用锁冲突。

---

## [1.0.0] - 2026-08-19

### 🛡️ 核心架构与基础功能 (Initial Release)
- **零知识本地加密体系**：
  - 基于 **Argon2id**（64MB 内存消耗、3 轮迭代、16 字节随机盐）的主密码派生；
  - 基于 **AES-256-GCM** 的双层信封加密模型（KEK + DEK），所有敏感数据在落盘 SQLite 之前全量加密。
- **端到端内存安全**：
  - 提供 `wipeBytes` 物理擦除保障，敏感密钥在使用完毕及锁定时全 `0` 覆写，杜绝 V8 堆内存转储泄露。
- **动态口令算法**：
  - 严格遵循 RFC 6238 (TOTP) 与 RFC 4226 (HOTP) 标准，支持 SHA-1 / SHA-256 / SHA-512。
- **全局无感自动锁定**：
  - 监听键盘、鼠标、滚动等全局用户活动，超时自动物理销毁内存密钥并锁定。
- **离线加密备份 (`.sav`)**：
  - 支持使用独立的备份密码导出与导入高强度二次加密的 `.sav` 备份文件，无任何厂商锁定。
- **全平台自适应 UI**：
  - 现代化两行式弹性工具栏设计、深色/浅色高质感主题切换、三色平滑微光倒计时进度条。
- **单文件便携 EXE**：
  - 打包生成 Windows 免安装绿色版 `Xiaorui 2FA Security Vault 1.0.0.exe`。
- **自动化测试套件**：
  - 19 项全量单元测试（密码学加解密、篡改校验、Argon2id 派生、内存清零、Base32 容错解析、RFC 测试向量及备份还原）。
