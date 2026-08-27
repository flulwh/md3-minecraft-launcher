<# 
.SYNOPSIS
    一键启动 Minecraft Launcher (前端 + 后端)
#>

$ErrorActionPreference = "Stop"

# 代理设置 (Clash 默认端口 7890)
$proxy = "http://127.0.0.1:7890"
$env:HTTP_PROXY  = $proxy
$env:HTTPS_PROXY = $proxy

Write-Host "=== Minecraft Launcher 启动器 ===" -ForegroundColor Cyan
Write-Host "代理: $proxy" -ForegroundColor Gray
Write-Host ""

$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

function Check-Java17 {
    try {
        $java = & java -version 2>&1
        if ($java -match 'version "1[789]\.' -or $java -match 'version "2[0-9]\.') {
            Write-Host "✓ 检测到 Java 17+" -ForegroundColor Green
            return $true
        }
    } catch {}
    Write-Host "⚠ 未检测到 Java 17+ (Forge 1.20.1+ 需要)" -ForegroundColor Yellow
    Write-Host "  请安装: https://adoptium.net/temurin/releases/?version=17" -ForegroundColor Gray
    return $false
}

function Start-Backend {
    Write-Host "`n[1/2] 启动后端..." -ForegroundColor Cyan
    Set-Location $backend
    $proc = Start-Process pwsh -ArgumentList "-NoExit", "-Command", "corepack pnpm dev" -PassThru
    Write-Host "  后端 PID: $($proc.Id)" -ForegroundColor Gray
    return $proc
}

function Start-Frontend {
    Write-Host "`n[2/2] 启动前端..." -ForegroundColor Cyan
    Set-Location $frontend
    $proc = Start-Process pwsh -ArgumentList "-NoExit", "-Command", "corepack pnpm dev" -PassThru
    Write-Host "  前端 PID: $($proc.Id)" -ForegroundColor Gray
    return $proc
}

# 主流程
Check-Java17 | Out-Null

$backendProc = Start-Backend
Start-Sleep 3  # 等后端先起来

$frontendProc = Start-Frontend

Write-Host "`n=== 启动完成 ===" -ForegroundColor Green
Write-Host "后端:  http://127.0.0.1:8787" -ForegroundColor Cyan
Write-Host "前端:  http://127.0.0.1:5173 (Electron 窗口会自动弹出)" -ForegroundColor Cyan
Write-Host ""
Write-Host "关闭窗口即可停止所有进程" -ForegroundColor Gray

# 保持脚本运行，等待用户关闭
Read-Host "`n按 Enter 退出并停止所有进程"

# 清理
Stop-Process $backendProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process $frontendProc.Id -Force -ErrorAction SilentlyContinue
Write-Host "已停止所有进程" -ForegroundColor Green
