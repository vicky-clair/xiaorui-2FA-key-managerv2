<div align="center">

# 🛡️ Secure Authenticator (2FA 密钥管理器)

**新一代本地优先、零知识端到端加密的跨平台 2FA / TOTP / HOTP 动态口令管理工具**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?logo=bun)](https://bun.sh/)
[![Expo](https://img.shields.io/badge/Platform-Expo%20%2F%20React%20Native-black?logo=expo)](https://expo.dev/)
[![Electron](https://img.shields.io/badge/Desktop-Electron%2032-47848F?logo=electron)](https://www.electronjs.org/)
[![Cryptography](https://img.shields.io/badge/Security-AES--256--GCM%20%2B%20Argon2id-success)](packages/core)
[![Tests](https://img.shields.io/badge/Tests-19%2F19%20Passing-brightgreen)](tests/)

[English Documentation](README.md) • [🛠️ 架构与开发文档](docs/DEVELOPMENT.md) • [📦 下载免安装 EXE 单文件](apps/desktop/release)

</div>

---

## ✨ 核心特性

- 🔒 **真正的零知识本地加密（Zero-Knowledge）：** 所有 2FA 密钥、账户备注与元数据在写入 SQLite 数据库前均使用 **AES-256-GCM** 进行强加密，任何明文绝不落地。
- 🛡️ **抗 GPU/ASIC 矿机暴力破解：** 主密码派生严格遵循 OWASP 安全基准，采用 **Argon2id**（64MB 内存消耗、3 轮迭代、16 字节随机盐）。
- 🧹 **主动内存物理清零（Memory Zeroization）：** 内存中的敏感密钥使用完毕及锁定时立即调用 `wipeBytes` 覆盖为 0，防止 JavaScript V8 堆内存被转储截获。
- ⏱️ **全局智能无感自动锁定（Auto-Lock）：** 全局监听键盘、鼠标、触摸与滚动事件，闲置超时（1分钟 / 5分钟 / 15分钟 / 30分钟 / 从不）自动物理擦除密钥并锁定保险库。
- 📦 **专属高强度加密备份（`.sav`）：** 支持使用独立的备份密码导出与导入 `.sav` 文件，基于 AES-256-GCM 封装，开放透明，无任何厂商锁定。
- 🎨 **响应式两行式高阶工具栏：**
  - **第 1 行（系统与安全）：** 品牌 Logo + PRO VIP 尊贵徽章 + 实时在线账号数 + `👑 会员中心` + `⏱️ 5m 自动锁` + `☀️/🌙 主题切换` + `🔒 立即锁定`。
  - **第 2 行（业务操作栏）：** 弹性自适应搜索框 + `+ 添加 2FA`（科技蓝高亮）+ `📥 导入备份` + `📦 导出备份`。
- 🌈 **三色微光动态倒计时进度条：** 动态计算剩余秒数，伴随平滑颜色过渡（绿 $\rightarrow$ 琥珀黄 $\rightarrow$ 珊瑚红），一目了然。
- 🖥️ **绿色免安装单文件 EXE：** Windows 10/11 双击即用，内置完整 Electron 运行时与离线加密引擎，零外部环境依赖。

---

## 🏗️ 架构与安全模型

```
+-----------------------------------------------------------------------+
|                            用户交互界面 (UI)                          |
|           (React Native / Expo Web / Electron 原生窗口)               |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                         应用核心层 (@sa/core)                         |
|  - 双层信封加密模型 (Argon2id KEK + AES-256-GCM DEK)                  |
|  - RFC 6238 TOTP / RFC 4226 HOTP 动态口令引擎 (SHA1/SHA256/SHA512)     |
|  - 内存物理擦除保障 (wipeBytes)                                       |
|  - 零知识加密备份服务 (.sav)                                          |
|  - 商业化会员与特性门禁 (Free vs PRO)                                 |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                        数据持久化层 (@sa/storage)                     |
|  - SQLite (expo-sqlite) + Kysely 类型安全查询构建器                   |
|  - PRAGMA 动态热升级迁移与索引优化                                    |
+-----------------------------------------------------------------------+
```

---

## 🚀 快速上手

### 环境要求
- [Bun](https://bun.sh/) (推荐 v1.1.0 或更高版本)
- Node.js (v18+) 及 Git

### 1. 安装项目依赖
```bash
git clone https://github.com/vicky-clair/xiaorui-2FA-key-managerv2.git
cd xiaorui-2FA-key-managerv2
bun install
```

### 2. 启动开发模式
```bash
# 启动 Web 端调试
bun run dev:expo

# 启动 Electron 桌面端窗口调试
bun run desktop
```

### 3. 执行自动化测试
```bash
bun test
```
> **19 项单元测试全部通过**，涵盖 AES-256-GCM 加解密、篡改校验、Argon2id 派生、内存清零、Base32 容错解析、RFC 6238 标准测试向量及 `.sav` 备份还原。

---

## 📦 打包生成 Windows 独立 EXE 程序

只需在项目根目录执行一条命令，即可全自动完成 Web 编译与绿色单文件打包：

```bash
bun run build:exe
```

生成的单文件程序位于：
```
apps/desktop/release/Secure Authenticator 1.0.0.exe
```
无需安装任何环境，双击即可在任何 Windows 电脑上直接运行！

---

## 💎 Free 免费版 vs PRO 专业版权益对比

| 功能特性 | 免费版 (Free) | PRO 专业会员 (PRO) |
| :--- | :---: | :---: |
| **2FA 账号数量** | 最多支持 10 个 | **无限账号 (Unlimited)** |
| **端到端加密备份导出 (`.sav`)** | ❌ | **✅ 支持 AES-256 专属导出** |
| **备份还原与导入** | ✅ 支持 (保障数据迁移权) | **✅ 完整支持** |
| **自定义自动锁定倒计时** | ✅ 支持 (1m/5m/15m/30m/从不) | **✅ 高级安全管理** |
| **深色 / 浅色高质感主题切换** | ✅ 支持 | **✅ 支持** |
| **三色平滑动态倒计时进度条** | ✅ 支持 | **✅ 支持** |

---

## 🔒 安全建议

1. **切勿泄露您的主密码或 `.sav` 备份文件及备份密码。**
2. 在公共或多人工位电脑上使用时，建议开启 **1分钟或5分钟自动锁定**。
3. 导出备份时，建议设置与保险库主密码不同的高强度专属备份密码。

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开放源代码。
