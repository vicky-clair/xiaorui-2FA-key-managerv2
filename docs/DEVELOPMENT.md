# Xiaorui 2FA Security Vault 开发文档

> 当前版本：v1.1.1-security  
> 更新时间：2026-09-05  
> 适用对象：后续维护者、插件开发者、打包发布人员、安全审查人员

本文档是项目当前状态的权威开发说明。旧文档中的 Electron 32、浏览器插件 `<all_urls>` 权限、PowerShell `Compress-Archive` 打包方式等内容已经过时，后续开发请以本文档为准。

---

## 1. 项目定位

Xiaorui 2FA Security Vault 是一个本地优先、离线可用、零知识的 2FA/TOTP/HOTP 管理器。

核心约束：

- 2FA Secret 不上传服务器，不写入日志，不明文落盘。
- 本地数据落盘前必须经过 AES-256-GCM 加密。
- 主密码只用于派生密钥，不保存、不回传、不可找回。
- 浏览器插件只负责识别和导入 `otpauth://`，不能绕过桌面端认证读取保险库。
- 桌面端通过 Electron 承载 Expo Web 静态包，运行时仅绑定 `127.0.0.1` 本地 HTTP 服务。

---

## 2. Monorepo 结构

```text
xiaorui-2FA-key-managerv2/
├── apps/
│   ├── expo/                    # React Native + Expo Router 主应用
│   │   ├── src/app/index.tsx    # 保险库、TOTP 卡片、导入导出、自动锁定 UI
│   │   ├── src/providers/       # 数据库与主题 Provider
│   │   └── server.js            # 本地 Web 静态服务，供调试/预览使用
│   ├── desktop/                 # Electron 桌面宿主
│   │   ├── main.js              # 本地 HTTP 服务、CSP、安全导航、deep link
│   │   └── package.json         # electron-builder 配置
│   └── browser-extension/        # Chrome/Edge Manifest V3 插件
│       ├── src/                 # TS 源码
│       ├── background.js         # 构建产物
│       ├── content.js            # 构建产物
│       ├── popup/popup.js        # 构建产物
│       └── release/              # 插件 zip 输出目录
├── packages/
│   ├── core/                    # 密码学、TOTP、保险库、备份、权益门禁
│   └── storage/                 # expo-sqlite + Kysely 数据访问
├── scripts/                     # 插件构建、图标生成、zip 打包脚本
├── tests/                       # Bun 单元测试
├── docs/                        # 开发与上架文档
├── package.json                 # 根脚本、依赖 overrides
└── biome.json                   # 代码风格与生成文件忽略规则
```

---

## 3. 当前关键版本

根依赖以 `bun.lock` 为准。安全相关版本如下：

| 组件 | 当前约束 | 说明 |
| :--- | :--- | :--- |
| Electron | `^39.8.1` | 实际锁定到 `39.8.10`，用于避开旧 Electron 漏洞线 |
| electron-builder | `^26.15.0` | 实际锁定到 `26.15.3` |
| electron-builder-squirrel-windows | `^26.15.3` | 显式加入，避免锁文件残留旧 25.x 可选依赖链 |
| Expo | `~57.0.14` | 主应用 Web 导出与移动端框架 |
| React Native | `0.86.2` | Expo 57 对应版本 |

根 `package.json` 使用 `overrides` 固定已知传递依赖修复版：

- `qs@^6.16.0`
- `decode-uri-component@^0.5.0`
- `@xmldom/xmldom@^0.9.12`
- `uuid@11.1.1`

---

## 4. 密码学与数据安全

### 4.1 保险库加密模型

主流程：

1. 用户输入主密码。
2. `Argon2id` 使用随机 salt 派生 KEK。
3. 随机生成 256-bit Vault Key。
4. Vault Key 被 KEK 通过 AES-256-GCM 加密后保存。
5. 每条 2FA entry 的明文 payload 使用 Vault Key 通过 AES-256-GCM 加密后保存到 SQLite。

实现位置：

- `packages/core/src/services/VaultService.ts`
- `packages/core/src/crypto/aes.ts`
- `packages/core/src/crypto/aes.native.ts`
- `packages/storage/src/database/index.ts`
- `packages/storage/src/repositories/index.ts`

开发红线：

- 不允许把 `vaultKey`、主密码、TOTP secret 打到日志。
- 不允许把明文 secret 放进 `localStorage`、cookie、URL query 或崩溃报告。
- 使用完临时 `Uint8Array` 密钥后应调用 `wipeBytes()`。
- 新增导入格式时必须先完成大小限制、结构校验和加密参数校验。

### 4.2 TOTP 参数校验

TOTP/HOTP 参数已做边界校验：

- digits：仅允许 6 到 8 位。
- period：仅允许 10 到 300 秒。
- counter：必须是非负安全整数。
- algorithm：仅允许 `SHA1`、`SHA256`、`SHA512`。

实现位置：`packages/core/src/crypto/totp.ts`

不要为了兼容外部二维码放宽这些边界。异常二维码应提示用户，而不是让运行时进入异常状态。

### 4.3 加密备份 `.sav`

备份导入已加安全边界：

- 最大备份文件大小：10 MB。
- 最大 entry 数量：10000。
- KDF 参数限制：iterations、memory、parallelism、hashLength 必须落在安全范围内。

实现位置：`packages/core/src/services/BackupService.ts`

新增备份版本时必须保持向后兼容，并给测试补上错误密码、损坏内容、异常参数和超大输入场景。

---

## 5. 桌面端安全模型

桌面端入口：`apps/desktop/main.js`

运行方式：

1. Electron 主进程启动本地 HTTP 静态服务。
2. 服务只监听 `127.0.0.1`，默认端口 `38291`，端口占用时自动切换随机端口。
3. BrowserWindow 载入 `http://127.0.0.1:<port>`。
4. 静态资源请求使用 `path.resolve(root, "." + pathname)` 做根目录边界检查，防止路径穿越。
5. Electron 禁止新窗口，并拦截非本地 origin 的导航。

必须保留的安全响应头：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none'
```

重要说明：`worker-src 'self' blob:` 不能删除。Expo Web + expo-sqlite 在 cross-origin isolated 环境中会通过 `URL.createObjectURL(new Blob(...))` 创建 SQLite worker。删除该项会导致打包软件启动后数据库初始化卡住，界面一直转圈。

---

## 6. 浏览器插件安全模型

插件目录：`apps/browser-extension`

当前 Manifest V3 权限：

```json
{
  "permissions": ["storage", "activeTab", "scripting", "contextMenus"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "all_frames": false,
      "match_about_blank": false
    }
  ]
}
```

注意：不要恢复 `<all_urls>`，也不要默认打开 `all_frames` 或 `match_about_blank`。插件只应扫描普通 HTTP/HTTPS 页面中的 2FA 设置二维码。

后台图片抓取限制：

- 只接受来自本扩展的 sender。
- 只允许 `http:` / `https:` 图片 URL。
- `credentials: "omit"`，避免带上站点 cookie。
- `cache: "no-store"`。
- 只接受 `image/*` MIME。
- 图片大小上限 5 MB。

插件端保险库 KDF：

- 新建插件 vault 使用 `PBKDF2-SHA256`，迭代次数 `600000`。
- 旧插件 vault 迭代次数 `100000`，解锁后会迁移到新参数并重写 verifier/entry。
- 迁移逻辑在 `apps/browser-extension/src/background.ts` 的 `migrateVaultKdfIfNeeded()`。

---

## 7. 本地存储

桌面端使用 Electron 持久化分区：

```text
partition: persist:xiaorui_vault
```

Windows 常见数据目录：

```text
%APPDATA%\Xiaorui 2FA Security Vault\Partitions\xiaorui_vault\
```

删除该目录会删除本机密文数据库和偏好数据。因为项目没有云同步，没有主密码找回机制，所以删除后无法恢复，除非用户提前导出 `.sav` 备份。

---

## 8. 常用命令

安装依赖：

```bash
bun install
```

开发调试：

```bash
# Expo Web
bun run dev:expo

# Electron 桌面端
bun run desktop
```

质量检查：

```bash
bun run lint
bun test
bun audit
```

Web 静态导出：

```bash
bun run build:web
```

桌面端打包：

```bash
# 生成 NSIS 安装包和 portable 便携版
bun run --cwd apps/desktop build:exe

# 根脚本只生成 portable
bun run build:exe

# 生成 AppX/MSIX 方向产物
bun run build:msix
```

浏览器插件：

```bash
# 生成 background.js/content.js/popup.js
bun run build:extension

# 生成商店上传 zip
bun run package:extension-zip
```

---

## 9. 打包产物位置

桌面端：

```text
apps/desktop/release/Xiaorui 2FA Security Vault Setup 1.0.0.exe
apps/desktop/release/Xiaorui 2FA Security Vault 1.0.0.exe
apps/desktop/release/win-unpacked/Xiaorui 2FA Security Vault.exe
```

浏览器插件：

```text
apps/browser-extension/release/xiaorui-2fa-security-vault-extension.zip
apps/browser-extension/
```

浏览器开发者模式加载时选择 `apps/browser-extension/` 目录；提交商店时上传 release zip。

---

## 10. 发布前检查清单

每次发布前必须执行：

```bash
bun run lint
bun test
bun run build:web
bun run package:extension-zip
bun run --cwd apps/desktop build:exe
bun audit
```

人工检查：

- 新打包的桌面软件能打开到设置/解锁界面，而不是一直转圈。
- 新用户可以创建 vault。
- 已有 vault 可以解锁。
- 新增 TOTP 后验证码刷新正常。
- `.sav` 导出和导入正常。
- 插件可以识别 `otpauth://` 二维码并拉起桌面端。
- 插件 manifest 中不含 `<all_urls>`。
- 桌面端 CSP 中保留 `worker-src 'self' blob:`。

---

## 11. 已知安全债务

### 11.1 上游依赖审计残留

截至 2026-09-05，`bun audit` 仍报告 3 个上游传递依赖漏洞：

- `extract-zip <=2.0.1`：来自 Electron；当前 npm 最新仍为 `2.0.1`。
- `image-size <=2.0.2`：来自 Expo/React Native/React Native Worklets；当前 npm 最新仍为 `2.0.2`。

当前项目代码不直接处理任意用户上传的 zip、ICNS、JXL 或 HEIF 文件。后续应跟踪 Electron、Expo、React Native 更新，一旦上游替换或修复依赖，应立即刷新锁文件并复审。

### 11.2 PRO 授权仍是占位校验

`packages/core/src/services/EntitlementService.ts` 当前通过 `PRO-`、`VIP-` 或固定字符串识别 PRO。这不是强安全授权机制，只适合内测或占位。

当前可用于功能测试的临时激活码：

```text
PRO-TEST-0000-0000
VIP-TEST-0000-0000
PREMIUM-LIFETIME-ACCESS
```

这些测试码的目的只是让开发者验证 PRO 功能入口，例如无限账号、备份导出和会员界面。当前实现不会把测试激活状态持久化为可信授权；关闭软件后重新打开，需要再次输入测试码。这是刻意设计，避免占位授权被误当作正式商业授权。

正式商业化前必须改为签名许可证：

- 客户端只内置公钥。
- 服务端或离线发码工具用私钥签发 license。
- license payload 至少包含 `tier`、`expiresAt`、`deviceLimit`、`issuedAt`、`licenseId`。
- 客户端验证签名、有效期和吊销策略。
- 验签通过后只持久化签名后的 license blob 或其安全派生状态，不持久化裸激活码。
- 正式激活状态应随应用重启稳定恢复，但任何本地持久化状态都必须能被公钥验签重新确认。

在签名许可证完成前，不要在文档或商店材料中宣称“不可伪造离线授权”。

建议的正式激活数据流：

```text
用户输入正式激活码
  -> 解析 signed license payload
  -> 使用客户端内置公钥验签
  -> 校验 tier / expiresAt / issuedAt / licenseId
  -> 持久化 signed license blob
  -> 每次启动重新验签并恢复 PRO 状态
```

---

## 12. 常见问题

### 打包后一直转圈

优先检查 `apps/desktop/main.js` 的 CSP 是否包含：

```text
worker-src 'self' blob:
```

缺少它时，expo-sqlite 的 Web Worker 会被 CSP 拦截，`DatabaseProvider` 无法完成初始化。

### 插件 zip 打包失败

旧脚本依赖 PowerShell `Compress-Archive`，在某些 Windows 执行策略下会失败。当前脚本已改为调用系统 `tar -a -cf` 生成 zip，不依赖 PowerShell profile 或 Archive 模块。

### 桌面安装包构建失败，提示无法写入 electron-builder Cache

NSIS 工具链会写入：

```text
%LOCALAPPDATA%\electron-builder\Cache\
```

在受限环境中需要允许 Electron Builder 写入该目录，或预先准备缓存。

### 修改 CSP 后如何验证

执行：

```bash
bun run --cwd apps/desktop build:exe
```

然后运行：

```text
apps/desktop/release/win-unpacked/Xiaorui 2FA Security Vault.exe
```

如果能进入设置/解锁页面，说明数据库 worker 初始化正常。

---

## 13. 维护原则

- 优先修源代码中的安全边界，再处理依赖审计。
- 生成文件可以由脚本更新，但源文件必须作为主要审查对象。
- 修改加密格式、备份格式、KDF 参数时必须补测试。
- 修改打包脚本后必须实际生成桌面包和插件 zip。
- 修改 Electron CSP 后必须运行打包后的 exe 进行人工验证。
- 不要用 lint ignore 掩盖安全问题；`biome.json` 的 ignore 只应覆盖生成物和构建目录。
