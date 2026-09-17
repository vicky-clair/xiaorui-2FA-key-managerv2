; Inno Setup 6 Script for Xiaorui 2FA Security Vault
; Preprocessor definitions expected (can be passed via /D on CLI):
;   #define MyAppName "Xiaorui 2FA Security Vault"
;   #define MyAppVersion "1.0.0"
;   #define MyAppPublisher "Xiaorui"
;   #define MyAppURL "https://github.com/vicky-clair/xiaorui-2FA-key-managerv2"
;   #define MyAppExeName "Xiaorui 2FA Security Vault.exe"
;   #define MySourceDir "..\artifacts\staging"
;   #define MyOutputDir "..\artifacts"
;   #define MyOutputBaseFilename "Xiaorui-2FA-Vault-1.0.0-win-x64-Setup"
;   #define MyAppIcon "..\apps\desktop\app-icon.ico"

#ifndef MyAppName
  #define MyAppName "Xiaorui 2FA Security Vault"
#endif

#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#ifndef MyAppPublisher
  #define MyAppPublisher "Xiaorui"
#endif

#ifndef MyAppURL
  #define MyAppURL "https://github.com/vicky-clair/xiaorui-2FA-key-managerv2"
#endif

#ifndef MyAppExeName
  #define MyAppExeName "Xiaorui 2FA Security Vault.exe"
#endif

#ifndef MySourceDir
  #define MySourceDir "..\artifacts\staging"
#endif

#ifndef MyOutputDir
  #define MyOutputDir "..\artifacts"
#endif

#ifndef MyOutputBaseFilename
  #define MyOutputBaseFilename "Xiaorui-2FA-Vault-Setup"
#endif

#ifndef MyAppIcon
  #define MyAppIcon "..\apps\desktop\app-icon.ico"
#endif

[Setup]
; Unique application identifier
AppId={{D37E68F1-4B79-4B57-B2A8-A63897A4E81C}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Xiaorui 2FA Security Vault
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#MyOutputDir}
OutputBaseFilename={#MyOutputBaseFilename}
SetupIconFile={#MyAppIcon}
SolidCompression=yes
Compression=lzma2/ultra64
LZMAUseSeparateProcess=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
DisableProgramGroupPage=auto
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} v{#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Windows High-Security Installer
VersionInfoProductName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app-icon.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app-icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
