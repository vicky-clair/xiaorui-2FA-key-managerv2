# 🛡️ 安全策略与开发红线 (Security Policy & Red Lines)

## 🚨 核心开发红线 (Development Red Lines)

为确保本项目达到顶级安全与零知识（Zero-Knowledge）防护标准，**所有代码贡献与维护必须严格恪守以下红线**：

1. **🚫 严禁上传明文密钥：** 绝对禁止将 2FA / TOTP 明文 Secret 上传至任何远程服务器或第三方接口。
2. **🚫 严禁打印敏感日志：** 绝对禁止在 `console.log`、系统崩溃报告或调试信息中输出用户主密码、解密后明文密钥或加密派生 Key。
3. **🚫 严禁明文持久化：** 数据库（SQLite）中必须全量存储 AES-256-GCM 密文字节，严禁存储明文 Vault 或明文条目。
4. **🚫 严禁在客户端保存许可私钥：** 正式商业授权必须采用非对称签名校验，客户端只能内置公钥，严禁硬编码私钥。
5. **🚫 严禁无授权跨进程访问：** 后续浏览器扩展或辅助进程不得直接绕过认证读取本地数据库。
6. **🚫 严禁长期持久化 VaultKey：** 解锁后的内存数据密钥只能通过带 `wipeBytes` 擦除保证的上下文流转，超时（自动锁定）或退出时必须物理清零覆盖。
7. **🚫 严禁在 LocalStorage / Cookie 中保存 Secret：** Web 存储极易受到 XSS 或扩展脚本窥探，明文密钥严禁进入此类非安全存储。
8. **🚫 严禁在系统 KeyChain 中明文存密码：** 主密码只存在于用户大脑中，不可被明文托管。
9. **🚫 严禁动态代码执行：** 绝对禁止使用 `eval()`、`new Function()` 等危险函数处理用户输入、导入内容或二维码扫描数据。
10. **🚫 严禁放宽插件权限：** 浏览器插件不得恢复 `<all_urls>`，不得默认启用 `all_frames` 或 `match_about_blank`。
11. **🚫 严禁破坏桌面端 CSP 基线：** Electron/Expo Web 必须保留 `worker-src 'self' blob:`，否则 expo-sqlite 的 Web Worker 会被拦截，打包软件会卡在初始化界面。

---

## 💾 数据存储与物理销毁 (Data Storage & Destruction)

- **本地存储位置**：
  - Windows: `%APPDATA%\Xiaorui 2FA Security Vault\Partitions\xiaorui_vault\`
  - 数据文件包括本地 SQLite 加密数据库及用户偏好配置。
- **物理销毁原则**：
  - 本应用没有任何云端数据库或同步服务器，所有信息仅保存在本地设备。
  - 删除 `%APPDATA%\Xiaorui 2FA Security Vault` 目录即彻底物理抹除所有本地密文，**数据彻底销毁且无法逆向找回**。

---

## 🛡️ 防数据丢失指引 (Data Loss Prevention)

- **主密码不可找回**：主密码采用 Argon2id 散列，未在任何地方明文存储。若遗忘主密码，无法通过“找回密码”重置。
- **定期加密备份**：用户应养成定期点击 `📦 导出备份` 的习惯，生成独立的 `.sav` 加密备份文件，并妥善保存在安全的离线介质（如移动硬盘、U 盘）中。

---

## 🧭 当前安全状态与后续工作

- `bun audit` 当前仍会报告 `extract-zip <=2.0.1` 与 `image-size <=2.0.2` 的上游传递依赖漏洞。项目代码不直接处理任意用户上传的 zip、ICNS、JXL 或 HEIF 文件；后续应跟踪 Electron/Expo/React Native 上游修复。
- `packages/core/src/services/EntitlementService.ts` 中的 PRO 激活逻辑仍是占位格式校验，不是不可伪造的许可证体系。`PRO-TEST-0000-0000`、`VIP-TEST-0000-0000`、`PREMIUM-LIFETIME-ACCESS` 只能用于本地功能测试。
- 正式商业化前必须改为服务端或离线工具私钥签发、客户端公钥验签。正式激活可以持久化，但只能持久化签名 license blob 或可重新验签的授权状态，不能持久化未签名的裸激活码。
