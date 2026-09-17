# Themida 最高加密系数保护与终端自动化打包指南

本指南详细说明如何使用 **Themida 3.2.6.0**，为 **Xiaorui 2FA Security Vault（小睿双因素认证保险库）** 配置**商业级最高加密防护系数**，并通过终端自动化脚本一键生成加壳后的 Windows 安装包应用（Setup EXE）。

> [!TIP]
> 如果您的 Themida 安装在特定私有自定义目录，请在本地私密配置文件 `build.secrets.local.json` 中指定实际路径。公开技术文档与开源仓库中统一使用 `<THEMIDA_INSTALL_DIR>` 占位符指代，从根源防止私密路径泄漏至 GitHub。

---

## 一、Themida 保护机制与桌面应用特性

1. **核心可执行文件（PE Executable）加壳防护**：
   - 桌面端的核心入口可执行程序为 `Xiaorui 2FA Security Vault.exe`（64位 Windows 原生 PE 二进制）。
   - Themida 的 **SecureEngine** 内核直接接管该二进制的 Windows PE 结构，将原生代码段和数据段进行深度虚拟化重构，阻断 IDA Pro、Ghidra、x64dbg、Scylla、Cheat Engine 等静态逆向与动态调试工具。
2. **终端自动化的工作方式**：
   - Themida 保护引擎使用 `.tmd` 专用工程文件保存多架构虚拟机架构、反调试钩子、动态加密密钥种子等参数。
   - 在首次配置并保存 `Xiaorui2FA_HighSecurity.tmd` 后，终端打包脚本 `Package-ProtectedInstaller.ps1` 会全自动通过命令行 `/protect ... /q` 静默调用加壳，无需人工再次打开界面。

---

## 二、Themida“最高加密系数”配置指引（一次性设置）

启动 `<THEMIDA_INSTALL_DIR>\Themida.exe`（或运行 `Package-ProtectedInstaller.ps1 -OpenThemidaGui` 自动调出），按如下步骤配置最高防护：

### 1. Application Information（应用程序基础信息）
- **Input Filename**：选择项目打包好的主程序可执行文件：
  `<PROJECT_ROOT>\apps\desktop\release\win-unpacked\Xiaorui 2FA Security Vault.exe`
- **Output Filename**：可设置为临时路径（例如 `Xiaorui2FA_Protected.exe`）。
  > 注：终端打包脚本在运行时会自动通过 `/inputfile` 和 `/outputfile` 动态覆盖此路径，因此此处配置仅作为工程模板基准。

### 2. Protection Options（保护选项 —— 全部拉满）
进入左侧 **Protection Options** 面板：
- **Anti-Debugger（反调试保护）**：
  - [x] **Enable Anti-Debugger Protection**（启用多层反调试引擎）
  - [x] **Detect Kernel-Mode Debuggers**（检测 WinDbg、内核驱动级调试器）
  - [x] **Detect Hooking / Memory Breakpoints**（检测 API 挂钩、PAGE_GUARD 与硬件断点）
- **Memory Protection（内存保护与反 Dump）**：
  - [x] **Anti-Memory Dumping**（拦截 Scylla、Process Hacker、x64dbg 对解密内存的转储）
  - [x] **Real-time Memory Verification**（实时运行时内存校验，防止内存打补丁或篡改）
- **Entry Point Obfuscation（入口点深度混淆）**：
  - [x] **Entry Point Obfuscation**（将程序启动的第一批指令转换为虚拟机私有执行流，阻断逆向分析真实 OEP）
- **Anti-File Patching（防文件篡改）**：
  - [x] **Anti-File Patching**（完整性哈希校验与 PE 头防爆破，检测到字节篡改立即阻断）
- **Anti-API Monitors（反系统监控）**：
  - [x] **Detect File/Registry Monitors**（检测并防御 API Monitor、ProcMon 等系统行为分析工具）
- **Compression & Encryption（压缩与加密）**：
  - Compression Level 设置为 **Maximum / High**，对原生代码段与数据段实施高强度 AES/Blowfish 混合动态解密。

### 3. Virtual Machine（虚拟机技术 —— 终极防护核心）
进入左侧 **Virtual Machine** 面板：
- **Architecture Selection（多 CPU 虚拟机架构）**：
  - 在列表中勾选或添加多个独立的虚拟机架构：
    - `TIGER-RED`（高复杂度乱序架构）
    - `FISH-BLACK`（强变异抗反编译架构）
    - `PUMA-WHITE`（防单步跟踪架构）
    - `LION-RED`（深度混淆架构）
- **Instances（虚拟机实例数）**：
  - 将关键 VM 的 Instances 设置为 `2` 或 `3`。每次加壳都会生成完全随机的寄存器映射与专用 Opcode 执行流，逆向人员无法通用分析。
- **Boot Loader VM**：
  - 右键选择 `TIGER-RED` 或 `FISH-BLACK`，设为 **Use it in Protection Boot**（将保护引导代码自身虚拟化）。

### 4. 保存工程文件
- 点击顶部工具栏的 **Save Project**。
- 将工程文件保存为项目根目录：
  ```text
  <PROJECT_ROOT>\Xiaorui2FA_HighSecurity.tmd
  ```

---

## 三、终端一键打包与安装包应用生成

完成上述一次性工程配置后，在终端运行以下命令即可全自动完成加壳与制作安装包：

### 1. 标准完整打包（回归测试 -> Themida最高加密加壳 -> Inno Setup固实安装包）
```powershell
pwsh -File ./scripts/Package-ProtectedInstaller.ps1
```

### 2. 跳过单元测试加速打包
```powershell
pwsh -File ./scripts/Package-ProtectedInstaller.ps1 -SkipTests
```

### 3. 首次未配置 TMD 时交互式配置
```powershell
pwsh -File ./scripts/Package-ProtectedInstaller.ps1 -OpenThemidaGui
```

### 4. 仅测试安装包构建逻辑（对比未加壳版）
```powershell
pwsh -File ./scripts/Package-ProtectedInstaller.ps1 -SkipThemida -SkipTests
```

---

## 四、输出结果

打包完成后，最终产物存放于 `artifacts/` 目录：
- **安装包程序**：`artifacts/Xiaorui-2FA-Vault-1.0.0-win-x64-Setup.exe`
- **校验和文件**：`artifacts/Xiaorui-2FA-Vault-1.0.0-win-x64-Setup.exe.sha256`

### 安装包核心特性：
1. **纯单文件安装向导**：基于 Inno Setup 6 现代化界面，自动适配 Windows 10/11 暗色与浅色高分屏 DPI。
2. **桌面与开始菜单快捷方式**：自动生成高清 2FA 专属盾牌图标，支持启动运行选项。
3. **干净卸载**：完整注册于 Windows 系统“添加或删除程序”，支持一键卸载清理。
4. **极致固实压缩**：采用 `lzma2/ultra64` 固实压缩算法，最大限度压缩安装包体积。
5. **安全与防篡改**：结合 Themida 的 PE 防护与 Inno Setup 的安装完整性校验，构建双重安全壁垒。
