<#
  NetWalk 托盘常驻脚本（Windows）

  职责：
    1. 在任务栏右下角显示 NetWalk 图标（双击打开界面、右键出菜单）
    2. 接收「老板键」指令：一键隐藏/恢复所有浏览器窗口与 NetWalk 自己的控制台窗口

  与 Node 的通信：
    - Node -> 本脚本：把命令写进 CmdFile（UTF8），本脚本每 250ms 轮询一次
      （不用 stdin 是因为消息循环里阻塞读管道会把图标卡死）
    - 本脚本 -> Node：stdout 逐行输出 open / toggle / quit / ready / state:xxx / err:xxx

  参数：
    OwnerPid  NetWalk 主进程 PID；它没了本脚本自动退出
    CmdFile   命令文件路径
    ExePath   NetWalk 可执行文件路径（用于提取图标）
#>
param(
  [int]$OwnerPid = 0,
  [string]$CmdFile = '',
  [string]$ExePath = '',
  [string]$AppName = 'NetWalk',
  [string]$ExtraProc = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

try { Add-Type -AssemblyName System.Windows.Forms | Out-Null } catch { Emit 'err:no-winforms'; exit 3 }
try { Add-Type -AssemblyName System.Drawing | Out-Null } catch { Emit 'err:no-drawing'; exit 3 }

# 需要一并隐藏的浏览器进程名（不含 .exe）
$browserNames = @(
  'chrome', 'msedge', 'firefox', 'iexplore', 'opera', 'brave', 'vivaldi',
  '360chrome', '360se', 'QQBrowser', 'SogouExplorer', 'liebao', 'Maxthon',
  'Chromium', 'Edg', 'whale', 'Twinkstar'
)
if ($ExtraProc) {
  $browserNames += ($ExtraProc -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$hiddenHandles = New-Object System.Collections.Generic.List[IntPtr]
$isHidden = $false

# 隐藏窗口要 P/Invoke 调 user32。C# 现场编译要 8~10 秒，所以：
#   1) 编译结果存成 DLL，第二次起直接加载（省掉编译）
#   2) 第一次也放到图标显示之后再编译，用户不用干等
$winApiSrc = @'
using System;
using System.Runtime.InteropServices;
public class NWWin {
  public delegate bool EnumCb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCb cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@

function Ensure-WinApi {
  if ('NWWin' -as [type]) { return $true }
  $dll = ''
  if ($CmdFile) { $dll = Join-Path (Split-Path -Parent $CmdFile) 'NWWin.dll' }
  if ($dll -and (Test-Path -LiteralPath $dll)) {
    try { Add-Type -Path $dll | Out-Null; return $true } catch { }
  }
  if ($dll) {
    try {
      Add-Type -TypeDefinition $winApiSrc -OutputAssembly $dll -OutputType Library | Out-Null
      Add-Type -Path $dll | Out-Null
      return $true
    } catch { }
  }
  try { Add-Type -TypeDefinition $winApiSrc | Out-Null; return $true } catch { Emit 'err:no-winapi'; return $false }
}

function Test-OwnerAlive {
  if ($OwnerPid -le 0) { return $true }
  $p = Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

function Get-TargetHandles {
  $empty = New-Object System.Collections.Generic.List[IntPtr]
  if (-not ('NWWin' -as [type])) { return $empty }
  $targets = @{}
  if ($OwnerPid -gt 0) { $targets[[int]$OwnerPid] = $true }
  foreach ($n in $browserNames) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { $targets[[int]$_.Id] = $true }
  }
  if ($targets.Count -eq 0) { return $empty }
  $found = New-Object System.Collections.Generic.List[IntPtr]
  $cb = [NWWin+EnumCb]{
    param([IntPtr]$h, [IntPtr]$l)
    $p = 0
    [void][NWWin]::GetWindowThreadProcessId($h, [ref]$p)
    if ($targets.ContainsKey([int]$p) -and [NWWin]::IsWindowVisible($h)) { $found.Add($h) }
    return $true
  }
  [void][NWWin]::EnumWindows($cb, [IntPtr]::Zero)
  return $found
}

function Invoke-BossHide {
  if (-not ('NWWin' -as [type])) { Ensure-WinApi | Out-Null }
  if (-not ('NWWin' -as [type])) { Emit 'err:winapi-not-ready'; return }
  $hs = Get-TargetHandles
  foreach ($h in $hs) {
    if (-not $hiddenHandles.Contains($h)) { $hiddenHandles.Add($h) }
    [void][NWWin]::ShowWindow($h, 0)   # SW_HIDE：任务栏里也不留痕迹
  }
  $script:isHidden = $true
  Emit 'state:hidden'
}

function Invoke-BossShow {
  foreach ($h in $hiddenHandles) {
    [void][NWWin]::ShowWindow($h, 9)          # SW_RESTORE
    [void][NWWin]::SetForegroundWindow($h)
  }
  $hiddenHandles.Clear()
  $script:isHidden = $false
  Emit 'state:visible'
}

function Invoke-BossToggle {
  if ($script:isHidden) { Invoke-BossShow } else { Invoke-BossHide }
}

# ---------- 图标 ----------
function New-FallbackIcon {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 26, 40))
  $g.FillEllipse($bg, 0, 0, 31, 31)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 88, 200, 255)), 2
  $g.DrawEllipse($pen, 1, 1, 29, 29)
  $font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
  $g.DrawString('N', $font, [System.Drawing.Brushes]::White, 7, 4)
  $g.Dispose()
  $ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  return $ico
}

$icon = $null
try {
  if ($ExePath -and (Test-Path -LiteralPath $ExePath)) {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
  }
} catch { $icon = $null }
if ($null -eq $icon) { $icon = New-FallbackIcon }

# ---------- 托盘 ----------
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icon
$ni.Text = $AppName
$ni.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('打开 NetWalk 面板')
$miHide = $menu.Items.Add('隐藏窗口（老板键）')
$menu.Items.Add('-') | Out-Null
$miQuit = $menu.Items.Add('退出 NetWalk')
$ni.ContextMenuStrip = $menu

$miOpen.Add_Click({ Emit 'open' })
$miHide.Add_Click({ Invoke-BossToggle })
$miQuit.Add_Click({ Emit 'quit' })
$ni.Add_DoubleClick({ Emit 'open' })

function Show-Balloon([string]$text) {
  try {
    $ni.BalloonTipTitle = $AppName
    $ni.BalloonTipText = $text
    $ni.ShowBalloonTip(3000)
  } catch { }
}

# ---------- 命令轮询 ----------
$lastStamp = [long]0
# 只处理本次启动之后写入的命令，上一轮遗留的（比如 quit）不算数
$bootTicks = [datetime]::UtcNow.Ticks
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  try {
    if (-not (Test-OwnerAlive)) { Emit 'owner-gone'; $timer.Stop(); [System.Windows.Forms.Application]::Exit() }
  } catch { }

  if (-not $CmdFile) { return }
  if (-not (Test-Path -LiteralPath $CmdFile)) { return }
  try {
    $fi = Get-Item -LiteralPath $CmdFile
    if ($fi.LastWriteTimeUtc.Ticks -eq $script:lastStamp) { return }
    $script:lastStamp = $fi.LastWriteTimeUtc.Ticks
    if ($fi.LastWriteTimeUtc.Ticks -lt $script:bootTicks) { return }
    $txt = ([System.IO.File]::ReadAllText($CmdFile, [System.Text.Encoding]::UTF8) + '').Trim()
    if (-not $txt) { return }
    if ($txt -eq 'hide') { Invoke-BossHide }
    elseif ($txt -eq 'show') { Invoke-BossShow }
    elseif ($txt -eq 'toggle') { Invoke-BossToggle }
    elseif ($txt -eq 'quit') { Emit 'quit'; $timer.Stop(); [System.Windows.Forms.Application]::Exit() }
    elseif ($txt.StartsWith('tip:')) { Show-Balloon $txt.Substring(4) }
  } catch { }
})
$timer.Start()

# 图标先出来，用户马上能看到；隐藏窗口要用的 P/Invoke 之后再编译
Emit 'ready'
Ensure-WinApi | Out-Null

try {
  [System.Windows.Forms.Application]::Run() | Out-Null
} finally {
  try { $timer.Stop(); $ni.Visible = $false; $ni.Dispose() } catch { }
}
