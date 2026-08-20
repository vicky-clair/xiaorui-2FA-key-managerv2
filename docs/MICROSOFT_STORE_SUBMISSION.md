# 🛡️ Xiaorui 2FA Security Vault — 微软商店与 Edge 扩展上架全指南

> **文档版本：** v1.0.0  
> **更新时间：** 2026-08-20  
> **覆盖平台：** Microsoft Store (Windows 桌面端) & Microsoft Edge Add-ons (浏览器插件)

---

## 📖 目录
1. [一、商店合规性评估报告 (Store Compliance Audit)](#一商店合规性评估报告-store-compliance-audit)
2. [二、准备工作：注册 Microsoft 开发者账号](#二准备工作注册-microsoft-开发者账号)
3. [三、Windows 桌面端应用上架步骤 (Microsoft Store)](#三windows-桌面端应用上架步骤-microsoft-store)
4. [四、Edge 浏览器插件上架步骤 (Edge Add-ons)](#四edge-浏览器插件上架步骤-edge-add-ons)
5. [五、商店素材与文案资源清单 (Assets & Copywriting)](#五商店素材与文案资源清单-assets--copywriting)
6. [六、常见审核驳回原因与规避方案 (Troubleshooting)](#六常见审核驳回原因与规避方案-troubleshooting)

---

## 一、商店合规性评估报告 (Store Compliance Audit)

根据 **Microsoft Store 政策 (App Developer Agreement & Store Policies 10.x/11.x)** 以及 **Microsoft Edge 扩展开发者政策**，本项目经过系统性合规自查，评估结果如下：

### 1. Windows 桌面端合规性评定：✅ **完全合格 (100% Passed)**

| 审查维度 | 微软商店政策要求 | 本项目实现情况 | 结论 |
| :--- | :--- | :--- | :---: |
| **应用安全性 (Policy 10.2)** | 严禁包含恶意软件、后门、无感窃取用户数据或执行未授权脚本 | 纯本地离线运行，零云端上传，Argon2id + AES-256-GCM 零知识强加密，无动态 `eval` 代码 | **合格** |
| **功能价值与稳定性 (Policy 10.1)** | 应用必须具备真实业务价值，且启动无崩溃、功能可独立闭环 | 提供完整的 2FA/TOTP/HOTP 动态码生成、搜索、倒计时、加密导入导出功能，19 项单元测试全通 | **合格** |
| **隐私政策与透明度 (Policy 10.5)** | 收集或处理凭据的应用必须提供清晰的隐私条款与离线声明 | 提供完整的零知识离线声明，所有数据存储在用户本地沙箱，不收集任何用户隐私或分析数据 | **合格** |
| **内容分级与年龄 (IARC)** | 必须通过国际年龄分级联盟 (IARC) 问卷评估 | 工具类应用，不含暴力、色情、赌博或争议内容，可直接获得全年龄段 (Everyone / 3+) 分级 | **合格** |
| **商业化与会员体系 (Policy 10.8)** | 必须清晰说明免费与付费区别，不得存在误导或强制消费 | 免费版支持 10 个账号，PRO 版提供无限账号与加密导出，功能界面清晰标明，透明无欺诈 | **合格** |

### 2. Edge 浏览器扩展端合规性评定：✅ **完全合格 (100% Passed)**

| 审查维度 | Edge 扩展政策要求 | 本项目实现情况 | 结论 |
| :--- | :--- | :--- | :---: |
| **单一用途原则 (Single Purpose)** | 扩展必须聚焦明确的单一功能，不得捆绑无关功能 | 专注于网页 2FA 绑定二维码的智能识别与拉起客户端导入 | **合格** |
| **权限最小化原则 (Least Privilege)** | 申报的权限必须在功能中实际使用并具备正当理由 | 仅申报 `storage`、`activeTab`、`scripting`、`contextMenus` 与 `<all_urls>`（用于 2FA 检测） | **合格** |
| **现代架构规范 (Manifest V3)** | 推荐并优先支持标准的 Manifest V3 架构 | 全面基于 Manifest V3 构建，配置了标准 Service Worker 与 Content Scripts | **合格** |
| **跨域与数据安全** | 严禁将网页抓取的图片数据发送至外部不可信服务器 | 采用 `jsQR` 在前端离线解码，图片像素不外传，100% 内存即时销毁 | **合格** |

---

## 二、准备工作：注册 Microsoft 开发者账号

上架 Windows 客户端和 Edge 插件均统一使用 **Microsoft Partner Center（微软合作伙伴中心）** 开发者账号。

1. 打开 [Microsoft Partner Center 注册页面](https://partner.microsoft.com/dashboard/account/v3/enrollment/introduction/partnership)；
2. 使用您的微软账号登录（建议使用专用企业/开发者 Outlook 或企业邮箱）；
3. 选择账号类型：
   - **个人开发者 (Individual)**：约 $19 美元（一次性注册费，永久有效，无需年费）；
   - **公司开发者 (Company)**：约 $99 美元（需要提供营业执照和企业域名验证）；
4. 填写基本开发者信息并完成信用卡支付，即可开通应用提交与发布权限。

---

## 三、Windows 桌面端应用上架步骤 (Microsoft Store)

微软商店现已全面支持 **传统 Win32 应用 (EXE/MSI)** 和 **MSIX 封装应用** 两种分发方式。

### 方式 A：标准 Win32 EXE 快速上架（推荐，最省心）

1. **登录合作伙伴中心**：进入 [Partner Center - Windows & Xbox](https://partner.microsoft.com/dashboard/apps-and-games/overview)；
2. **保留产品名称**：
   - 点击 **「Create a new app」（新建应用）**；
   - 输入并保留产品名称：`Xiaorui 2FA Security Vault`；
3. **选择分发包类型**：
   - 选择 **「Traditional desktop application (Win32)」**；
   - 填写下载 URL（可托管在 GitHub Release 或自有 CDN 上生成的 `Xiaorui 2FA Security Vault 1.0.0.exe`）及静默安装参数（单文件便携版无需额外参数）；
4. **完善应用详情 (Properties)**：
   - **类别 (Category)**：`Productivity` (生产力) / `Security` (安全)；
   - **隐私政策 URL (Privacy Policy)**：填写 GitHub 仓库中的 `SECURITY.md` 网址；
   - **支持网址 (Support URL)**：填写 GitHub Issues 网址；
5. **年龄分级 (Age Ratings)**：
   - 填写 IARC 问卷（全部选择“否/No”），自动生成通用 3+ 全球分级；
6. **商店详情与素材 (Store Listings)**：
   - 上传应用图标（300x300 图标已在 `apps/browser-extension/icons/icon-300.png` 准备完毕）；
   - 上传 1~4 张应用运行高清截图（1920x1080 或 1280x720）；
   - 粘贴我们在本文档第五部分提供的中英文介绍文案；
7. **提交审核 (Submit to the Store)**：
   - 点击提交，微软官方自动化与人工团队通常在 **24~72 小时内** 完成审核并全网上线。

---

## 四、Edge 浏览器插件上架步骤 (Edge Add-ons)

### 1. 打包扩展为 ZIP 文件
在项目根目录运行以下一键打包脚本，生成标准的提审压缩包：
```bash
# 确保编译产物为最新版本
bun run build:extension
```
提审的 ZIP 文件应包含：
- `manifest.json`
- `background.js`
- `content.js`
- `content.css`
- `popup/` 文件夹（包含 `popup.html`, `popup.css`, `popup.js`）
- `icons/` 文件夹（包含 `icon-16.png`, `icon-48.png`, `icon-128.png`, `icon-300.png`, `icon-512.png`）

### 2. 提交至 Edge 开发者控制台
1. 进入 [Microsoft Edge Add-ons 开发者管理后台](https://partner.microsoft.com/dashboard/microsoftedge/overview)；
2. 点击 **「Create new extension」（新建扩展）**；
3. **上传 ZIP 压缩包**：将上述打包好的 ZIP 包拖入上传区域，系统会自动校验 `manifest.json` 语法与权限；
4. **填写基本描述与素材 (Store Listing)**：
   - **扩展名称**：`Xiaorui 2FA Security Vault`；
   - **简短描述**：`本地零知识 2FA 动态口令管理器，支持网页 2FA 绑定二维码智能识别与安全导入。`
   - **详细描述**：使用本文档第五部分的商店说明文案；
   - **Logo 图标**：上传 `icon-300.png` (300x300) 或 `icon-128.png`；
   - **展示截图**：上传 1~3 张 1280x800 的功能截图（展示悬浮卡片拉起客户端与动态口令倒计时列表）；
5. **权限使用正当性说明 (Justification)**：
   - 针对 `<all_urls>`：`Required to detect and parse 2FA/TOTP setup QR codes across authentication setup web pages for seamless one-click import into the vault.`
   - 针对 `storage`：`Used to store user preferences and encrypted authentication records locally.`
6. **点击「Publish」（发布）**：
   - Edge 审核一般耗时 **1~3 个工作日**。

---

## 五、商店素材与文案资源清单 (Assets & Copywriting)

### 1. 核心文案资源

#### 📌 应用标题 (Title):
```
Xiaorui 2FA Security Vault - 零知识 2FA 动态口令双重认证管理器
```

#### 📌 简短摘要 (Short Description):
```
基于 Argon2id 与 AES-256-GCM 零知识本地加密的跨平台 2FA/TOTP 密钥管理器，支持网页二维码智能识别与一键秒级导入。
```

#### 📌 详细功能介绍 (Full Description - 中文):
```markdown
Xiaorui 2FA Security Vault 是一款企业级高安全性、纯本地优先（Local-First）且零知识端到端加密的双重认证（2FA / TOTP / HOTP）动态口令管理器。

✨ 核心亮点：
1. 🔒 真正的零知识本地加密：
   - 数据在落盘前均采用高强度 AES-256-GCM 强加密，主密码经 Argon2id（64MB 内存消耗、3 轮迭代）保护，坚不可摧；
   - 零云端依赖，所有密码与私钥 100% 仅保存在您的设备本地。

2. 🚀 网页二维码智能识别与极速联动：
   - 配套 Edge 浏览器扩展，进入网站 2FA 绑定页面时自动识别二维码并弹出悬浮卡片；
   - 点击一键拉起桌面端客户端，自动预填算法参数并高亮聚焦备注名输入，添加账号快人一步。

3. 🧹 内存物理清零与自动锁定防窥探：
   - 敏感密钥在内存中使用后立即物理覆写为 0，杜绝内存转储窃取；
   - 全局监听键盘鼠标无操作超时（1m / 5m / 15m / 30m）自动锁定保险库。

4. 📦 工业级 .sav 独立加密备份：
   - 支持使用独立备份密码导出与导入 .sav 离线加密文件，开放透明，拒绝厂商绑定。

5. 🎨 现代极致 UI 与三色动态倒计时：
   - 实时计算 30 秒有效倒计时，配备绿-黄-红平滑过渡微光动效，点击卡片一键秒复制验证码。
```

---

## 六、常见审核驳回原因与规避方案 (Troubleshooting)

1. **驳回原因 1：权限声明理由不充分 (Insufficient Justification)**
   - *规避方案*：在 Edge Add-ons 提交时，明确声明 `<all_urls>` 和 `scripting` 仅在检测到网页中存在标准 `otpauth://` 二维码时用于本地解析，**绝无任何网络外发行为**。
2. **驳回原因 2：缺少有效的隐私政策链接 (Missing Privacy Policy URL)**
   - *规避方案*：在 Partner Center 必须填入公开可访问的隐私政策网址（例如您的 GitHub 仓库 `SECURITY.md` 页面：`https://github.com/vicky-clair/xiaorui-2FA-key-managerv2/blob/main/SECURITY.md`）。
3. **驳回原因 3：功能测试受阻（需要登录凭据）**
   - *规避方案*：在给审核人员的「Notes for certification / 提审备注」中注明：
     > “本应用为完全离线的 2FA 管理器，无需注册在线账号。首次打开时直接在本地设置 6 位以上主密码即可进入体验全部功能。”
