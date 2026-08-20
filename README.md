<div align="center">

# 🛡️ Xiaorui 2FA Security Vault (2FA Key Manager)

**Next-Generation, Local-First, Zero-Knowledge 2FA/TOTP/HOTP Desktop & Mobile Key Manager**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?logo=bun)](https://bun.sh/)
[![Expo](https://img.shields.io/badge/Platform-Expo%20%2F%20React%20Native-black?logo=expo)](https://expo.dev/)
[![Electron](https://img.shields.io/badge/Desktop-Electron%2032-47848F?logo=electron)](https://www.electronjs.org/)
[![Cryptography](https://img.shields.io/badge/Security-AES--256--GCM%20%2B%20Argon2id-success)](packages/core)
[![Tests](https://img.shields.io/badge/Tests-19%2F19%20Passing-brightgreen)](tests/)

[📖 中文说明文档 (Chinese Documentation)](README_ZH.md) • [🛠️ 架构与开发文档 (Development Guide)](docs/DEVELOPMENT.md) • [📦 下载单文件 EXE (Releases)](apps/desktop/release)

</div>

---

## ✨ Key Features

- 🔒 **True Zero-Knowledge Security:** All secrets, accounts, and metadata are encrypted locally via **AES-256-GCM** before touching SQLite storage. No unencrypted plaintext ever leaves your machine.
- 🛡️ **GPU/ASIC-Resistant Key Derivation:** Master passwords are protected by **Argon2id** (64MB memory cost, 3 iterations, 16-byte cryptographically secure salt) following the OWASP gold standard.
- 🧹 **Active In-Memory Zeroization:** Sensitive keys in memory are actively wiped (`wipeBytes`) immediately after use and upon locking, preventing V8 memory dump exploits.
- ⏱️ **Configurable Auto-Lock:** Monitors global user inactivity (mouse, keyboard, touch, scroll) and automatically locks the vault (1m, 5m, 15m, 30m, or never).
- 📦 **Encrypted Zero-Knowledge Backup (`.sav`):** Export and restore your 2FA accounts with a separate master backup password using authenticated AES-256-GCM. No vendor lock-in.
- 🎨 **Adaptive Premium Two-Row Interface:**
  - **Row 1:** Brand identity, VIP badge, account counter, PRO Membership center, Auto-lock duration capsule, Dark/Light theme toggle, and Instant Lock.
  - **Row 2:** Instant search bar, `+ Add 2FA`, `📥 Import Backup`, and `📦 Export Backup`.
- 🌈 **Tricolor Dynamic Countdown Bar:** Visual real-time TOTP progress with smooth color transitions (Green $\rightarrow$ Amber $\rightarrow$ Crimson) and precise remaining seconds indicator.
- 🖥️ **Portable Standalone Executable:** Ready-to-run single file `.exe` on Windows 10/11 with zero runtime dependencies.

---

## 🏗️ Architecture & Security Model

```
+-----------------------------------------------------------------------+
|                            USER INTERFACE                             |
|           (React Native / Expo Web / Electron Native Window)          |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                         APPLICATION CORE (@sa/core)                   |
|  - Envelope Encryption (Argon2id KEK + AES-256-GCM DEK)              |
|  - RFC 6238 TOTP / RFC 4226 HOTP Engine (SHA-1 / SHA-256 / SHA-512)    |
|  - In-Memory Key Wipe (wipeBytes)                                     |
|  - Encrypted Backup Service (.sav)                                    |
|  - Feature Gate & Entitlement Service (Free vs PRO)                   |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                       PERSISTENCE LAYER (@sa/storage)                 |
|  - SQLite (expo-sqlite) + Kysely Type-Safe Query Builder             |
|  - PRAGMA Automated Schema Migration & Indexed Vaults                 |
+-----------------------------------------------------------------------+
```

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) (v1.1.0 or higher recommended)
- Node.js (v18+) & Git

### 1. Installation
```bash
git clone https://github.com/vicky-clair/xiaorui-2FA-key-managerv2.git
cd xiaorui-2FA-key-managerv2
bun install
```

### 2. Development Mode
```bash
# Start Web UI in browser
bun run dev:expo

# Start Desktop Application (Electron)
bun run desktop
```

### 3. Run Test Suite
```bash
bun test
```
> **19 passing tests** covering AES-256-GCM encryption, tampering detection, Argon2id derivation, memory wiping, Base32 RFC 4648 parsing, RFC 6238 TOTP vectors, and encrypted `.sav` backup/restore.

---

## 📦 Building Standalone Windows Executable (.exe)

You can compile and bundle the entire application into a single, standalone portable executable:

```bash
bun run build:exe
```

The output file will be generated at:
```
apps/desktop/release/Xiaorui 2FA Security Vault 1.0.0.exe
```
Simply double-click the `.exe` to run anywhere on Windows without installing any dependencies!

---

## 💎 Free vs PRO Feature Matrix

| Feature | Free Tier | PRO Membership |
| :--- | :---: | :---: |
| **Max 2FA Accounts** | Up to 10 accounts | **Unlimited** |
| **Encrypted Backup Export (`.sav`)** | ❌ | **✅ Full AES-256-GCM Export** |
| **Backup Import & Restore** | ✅ Supported | **✅ Supported** |
| **Auto-Lock Timeout Customization** | ✅ (1m / 5m / 15m / 30m / Never) | **✅ Advanced Security** |
| **Dark / Light Modern Themes** | ✅ Supported | **✅ Supported** |
| **Tricolor Dynamic Progress Indicator** | ✅ Supported | **✅ Supported** |

---

## 🔒 Security Best Practices

1. **Never share your master password or `.sav` backup files with anyone.**
2. **Always enable the auto-lock feature** when using the application on shared or workplace computers.
3. Keep your backup password distinct from your primary vault master password.

---

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).