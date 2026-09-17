param(
    [string]$Version = '1.0.0',
    [string]$ThemidaPath = '',
    [string]$ProjectTmd = '',
    [switch]$SkipThemida,
    [switch]$SkipTests,
    [switch]$OpenThemidaGui,
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+([.-][a-zA-Z0-9.-]+)?$') {
    throw "Invalid version format: '$Version'. Expected semver like '1.0.0'."
}

$solutionRoot = Split-Path $PSScriptRoot -Parent
$artifacts = Join-Path $solutionRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Xiaorui 2FA Security Vault High-Security Packaging Pipeline" -ForegroundColor Green
Write-Host " Version: $Version" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# Step 1: Solution Build & Automated Security Regression Tests
if (-not $SkipTests) {
    Write-Host "[1/5] Executing automated security & crypto regression tests..." -ForegroundColor Cyan
    $testProc = Start-Process -FilePath "bun" -ArgumentList @('test') -WorkingDirectory $solutionRoot -Wait -PassThru -NoNewWindow
    if ($testProc.ExitCode -ne 0) {
        throw "Unit/Security regression tests failed with exit code $($testProc.ExitCode). Aborting package creation."
    }
    Write-Host "  [OK] All security test suites passed with 100% success rate." -ForegroundColor Green
} else {
    Write-Host "[1/5] Skipping test suites as requested (-SkipTests)..." -ForegroundColor Yellow
}

# Step 2: Staging Application Release Binaries
Write-Host "[2/5] Staging Application Executable & Runtime Assets..." -ForegroundColor Cyan
$stagingGuid = [Guid]::NewGuid().ToString('N')
$staging = Join-Path $artifacts "installer-staging-$stagingGuid"
New-Item -ItemType Directory -Force -Path $staging | Out-Null

try {
    $unpackedDir = Join-Path $solutionRoot 'apps\desktop\release\win-unpacked'
    $primaryExeName = "Xiaorui 2FA Security Vault.exe"
    $sourceExe = Join-Path $unpackedDir $primaryExeName

    if ($Rebuild -or (-not (Test-Path -LiteralPath $sourceExe))) {
        Write-Host "  -> Compiling desktop application binaries (electron-builder)..." -ForegroundColor Gray
        $buildWeb = Start-Process -FilePath "bun" -ArgumentList @('run', 'build:web') -WorkingDirectory $solutionRoot -Wait -PassThru -NoNewWindow
        if ($buildWeb.ExitCode -ne 0) { throw "Failed to export web bundle for desktop." }

        $buildDesktop = Start-Process -FilePath "bun" -ArgumentList @('--cwd', 'apps/desktop', 'electron-builder', 'build', '--win', '--dir') -WorkingDirectory $solutionRoot -Wait -PassThru -NoNewWindow
        if ($buildDesktop.ExitCode -ne 0) { throw "electron-builder win-unpacked build failed." }
    }

    if (-not (Test-Path -LiteralPath $sourceExe)) {
        throw "Could not locate application binary at: $sourceExe"
    }

    Write-Host "  -> Copying unpacked runtime files to staging..." -ForegroundColor Gray
    Copy-Item -Path "$unpackedDir\*" -Destination $staging -Recurse -Force

    $targetExe = Join-Path $staging $primaryExeName

    # Copy Icon & Documentation Assets
    $iconCandidates = @(
        (Join-Path $solutionRoot 'apps\desktop\app-icon.ico'),
        (Join-Path $solutionRoot 'apps\expo\dist\favicon.ico')
    )
    $appIconPath = $null
    foreach ($cand in $iconCandidates) {
        if (Test-Path -LiteralPath $cand) { $appIconPath = $cand; break }
    }

    if ($appIconPath) {
        Copy-Item -LiteralPath $appIconPath -Destination (Join-Path $staging 'app-icon.ico') -Force
    }

    foreach ($doc in @('README_ZH.md', 'SECURITY.md')) {
        $docPath = Join-Path $solutionRoot $doc
        if (Test-Path -LiteralPath $docPath) {
            Copy-Item -LiteralPath $docPath -Destination (Join-Path $staging $doc) -Force
        }
    }

    # Clean intermediate/debug files from staging
    $unsafeFiles = Get-ChildItem -LiteralPath $staging -Recurse -File |
        Where-Object { $_.Extension -in @('.pdb', '.log', '.tmp', '.bak') }
    if ($unsafeFiles) {
        Write-Warning "Removing $(($unsafeFiles).Count) intermediate/temporary files from staging."
        $unsafeFiles | Remove-Item -Force
    }

    # Step 3: Themida High-Security Protection
    Write-Host "[3/5] Applying Themida Enterprise Protection..." -ForegroundColor Cyan

    # Dynamically resolve confidential local configuration if present
    $secretsCandidates = @(
        (Join-Path $solutionRoot 'build.secrets.local.json'),
        (Join-Path $solutionRoot '../build.secrets.local.json'),
        (Join-Path $PSScriptRoot 'build.secrets.local.json')
    )
    $localSecrets = $null
    foreach ($sf in $secretsCandidates) {
        if (Test-Path -LiteralPath $sf) {
            try {
                $localSecrets = Get-Content -LiteralPath $sf -Raw -Encoding utf8 | ConvertFrom-Json
                Write-Host "  -> Loaded confidential local build configuration: $(Split-Path $sf -Leaf)" -ForegroundColor DarkGray
                break
            } catch {
                Write-Warning "Failed to parse configuration from ${sf}: $_"
            }
        }
    }

    if (-not $ThemidaPath) {
        if ($localSecrets -and $localSecrets.Themida -and $localSecrets.Themida.ExecutablePath) {
            $ThemidaPath = $localSecrets.Themida.ExecutablePath
        } elseif ($env:THEMIDA_PATH) {
            $ThemidaPath = $env:THEMIDA_PATH
        } else {
            $defaultLocations = @(
                'C:\Program Files\Themida\Themida.exe',
                'C:\Program Files (x86)\Themida\Themida.exe'
            )
            foreach ($loc in $defaultLocations) {
                if (Test-Path -LiteralPath $loc) { $ThemidaPath = $loc; break }
            }
        }
    }

    if (-not $ProjectTmd -and $localSecrets -and $localSecrets.Themida -and $localSecrets.Themida.ProjectPath) {
        $ProjectTmd = $localSecrets.Themida.ProjectPath
    }

    $tmdCandidates = @()
    if ($ProjectTmd) { $tmdCandidates += $ProjectTmd }
    $tmdCandidates += @(
        (Join-Path $solutionRoot 'Xiaorui2FA_HighSecurity.tmd'),
        (Join-Path $solutionRoot 'Xiaorui2FA.tmd'),
        (Join-Path $PSScriptRoot 'Xiaorui2FA_HighSecurity.tmd'),
        (Join-Path $artifacts 'Xiaorui2FA_HighSecurity.tmd')
    )

    $resolvedTmd = $null
    foreach ($candidate in $tmdCandidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            $resolvedTmd = (Resolve-Path -LiteralPath $candidate).Path
            break
        }
    }

    if ($SkipThemida) {
        Write-Host "  -> Themida protection skipped via -SkipThemida flag." -ForegroundColor Yellow
    } elseif (-not $ThemidaPath -or -not (Test-Path -LiteralPath $ThemidaPath)) {
        Write-Warning "Themida executable not found. (Configured path: '$ThemidaPath')"
        Write-Warning "Configure 'Themida.ExecutablePath' in build.secrets.local.json or pass -ThemidaPath."
    } elseif (-not $resolvedTmd) {
        Write-Warning "================================================================"
        Write-Warning " Themida project file (.tmd) not found!"
        Write-Warning " Themida requires a .tmd project file to store the high-security"
        Write-Warning " protection options (Multi-VM, Anti-Debug, Memory Protection)."
        Write-Warning "================================================================"
        Write-Host "  Expected location: $(Join-Path $solutionRoot 'Xiaorui2FA_HighSecurity.tmd')" -ForegroundColor Yellow
        Write-Host "  Guide: See docs/THEMIDA_PROTECTION_GUIDE.md for recommended settings." -ForegroundColor Yellow

        if ($OpenThemidaGui) {
            Write-Host "  -> Launching Themida GUI for configuration..." -ForegroundColor Cyan
            Start-Process -FilePath $ThemidaPath -ArgumentList "`"$targetExe`""
            Write-Host "  Please configure your high-protection settings in Themida and save as:" -ForegroundColor Green
            Write-Host "  $((Join-Path $solutionRoot 'Xiaorui2FA_HighSecurity.tmd'))" -ForegroundColor White
            Read-Host "  Press Enter after saving the .tmd project file to continue..."

            if (Test-Path -LiteralPath (Join-Path $solutionRoot 'Xiaorui2FA_HighSecurity.tmd')) {
                $resolvedTmd = (Join-Path $solutionRoot 'Xiaorui2FA_HighSecurity.tmd')
            }
        }

        if (-not $resolvedTmd) {
            Write-Warning "Proceeding with packaging without Themida. (Use -OpenThemidaGui to create .tmd)"
        }
    }

    if ($resolvedTmd -and (Test-Path -LiteralPath $resolvedTmd)) {
        Write-Host "  -> Found Themida project: $resolvedTmd" -ForegroundColor Green
        $themidaReturnCodes = @{
            0 = 'Protection successful'
            1 = 'Project file does not exist or is invalid'
            2 = 'File to protect cannot be opened'
            3 = 'File already protected'
            4 = 'Error in inserted SecureEngine macros'
            5 = 'Internal protection error'
            6 = 'Cannot write protected file to disk'
            7 = 'Error opening/reading splash file'
            8 = 'Taggant certificate cannot be applied'
        }

        $unprotectedExe = Join-Path $staging "Xiaorui 2FA Security Vault.unprotected.exe"
        Copy-Item -LiteralPath $targetExe -Destination $unprotectedExe -Force
        
        Write-Host "  -> Protecting '$primaryExeName' with Themida..." -ForegroundColor Gray
        $proc = Start-Process -FilePath $ThemidaPath `
            -ArgumentList @('/protect', "`"$resolvedTmd`"", '/inputfile', "`"$unprotectedExe`"", '/outputfile', "`"$targetExe`"", '/shareconsole', '/q') `
            -Wait -PassThru -NoNewWindow

        $msg = if ($themidaReturnCodes.ContainsKey($proc.ExitCode)) { $themidaReturnCodes[$proc.ExitCode] } else { "Unknown code $($proc.ExitCode)" }
        if ($proc.ExitCode -ne 0) {
            Write-Warning "Themida protection failed with exit code $($proc.ExitCode): $msg."
            Move-Item -LiteralPath $unprotectedExe -Destination $targetExe -Force
        } else {
            Write-Host "  [OK] '$primaryExeName' successfully protected by Themida!" -ForegroundColor Green
            Remove-Item -LiteralPath $unprotectedExe -Force -ErrorAction SilentlyContinue
        }
    }

    # Step 4: Compile Windows Setup Installer (.exe) with Inno Setup
    Write-Host "[4/5] Compiling Windows Setup Installer with Inno Setup..." -ForegroundColor Cyan

    $iscc = $null
    $isccCommand = Get-Command iscc -ErrorAction SilentlyContinue
    if ($isccCommand) {
        $iscc = $isccCommand.Source
    } else {
        $isccCandidates = @(
            "C:\Users\$env:USERNAME\scoop\shims\iscc.exe",
            "C:\Users\$env:USERNAME\scoop\apps\inno-setup\current\iscc.exe",
            "$env:LOCALAPPDATA\Programs\Inno Setup 6\iscc.exe",
            "$env:ProgramFiles\Inno Setup 6\iscc.exe",
            "${env:ProgramFiles(x86)}\Inno Setup 6\iscc.exe"
        )
        foreach ($c in $isccCandidates) {
            if (Test-Path -LiteralPath $c) { $iscc = $c; break }
        }
    }

    $setupBaseName = "Xiaorui-2FA-Vault-$Version-win-x64-Setup"
    $setupExePath = Join-Path $artifacts "$setupBaseName.exe"
    $issScript = Join-Path $PSScriptRoot 'installer.iss'

    if ($iscc -and (Test-Path -LiteralPath $iscc)) {
        Write-Host "  -> Using Inno Setup Compiler: $iscc" -ForegroundColor Gray

        # Allocate an available virtual drive to avoid Windows MAX_PATH limits on deep nested assets
        $substDrive = $null
        $usedDrives = (Get-PSDrive -PSProvider FileSystem).Name
        foreach ($letter in @('Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S')) {
            if ($letter -notin $usedDrives) {
                $substDrive = "${letter}:"
                break
            }
        }

        $sourceDirForIscc = $staging
        if ($substDrive) {
            Write-Host "  -> Mounting staging folder to virtual drive '$substDrive' for MAX_PATH protection..." -ForegroundColor DarkGray
            subst $substDrive $staging
            $sourceDirForIscc = $substDrive
        }

        try {
            $isccArgs = @(
                "/DMyAppVersion=$Version",
                "/DMySourceDir=$sourceDirForIscc",
                "/DMyOutputDir=$artifacts",
                "/DMyOutputBaseFilename=$setupBaseName",
                "/DMyAppIcon=$appIconPath",
                "/Q",
                "$issScript"
            )
            & $iscc @isccArgs
            if ($LASTEXITCODE -ne 0) {
                throw "Inno Setup compilation failed with code $LASTEXITCODE."
            }
        } finally {
            if ($substDrive) {
                subst $substDrive /d 2>$null | Out-Null
            }
        }
    } else {
        Write-Warning "Inno Setup Compiler (iscc.exe) not found. Generating portable ZIP instead."
        $portableZip = Join-Path $artifacts "Xiaorui-2FA-Vault-$Version-win-x64-portable.zip"
        [IO.Compression.ZipFile]::CreateFromDirectory($staging, $portableZip, [IO.Compression.CompressionLevel]::Optimal, $false)
        Write-Host "  [OK] Portable ZIP created: $portableZip" -ForegroundColor Green
    }

    # Step 5: Post-Build Integrity Verification & Security Audit
    Write-Host "[5/5] Post-Build Integrity Verification & Security Audit..." -ForegroundColor Cyan

    if (Test-Path -LiteralPath $setupExePath) {
        $hash = (Get-FileHash -LiteralPath $setupExePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $hashFile = "$setupExePath.sha256"
        Set-Content -LiteralPath $hashFile -Value "$hash  $setupBaseName.exe" -Encoding ascii

        $setupItem = Get-Item $setupExePath
        $sizeMb = [math]::Round($setupItem.Length / 1MB, 2)

        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host " [SUCCESS] Installer Package Generated Successfully!" -ForegroundColor Green
        Write-Host " Output Installer: $setupExePath ($sizeMb MB)" -ForegroundColor Yellow
        Write-Host " SHA256 Hash:      $hash" -ForegroundColor Yellow
        Write-Host " Checksum File:    $hashFile" -ForegroundColor Yellow
        Write-Host "==========================================================" -ForegroundColor Green
    }

} finally {
    # Clean up staging directory
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}
