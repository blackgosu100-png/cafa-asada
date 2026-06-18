param(
  [Parameter(Mandatory = $true)][string]$ChatName,
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $false)][string]$Message = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "Review doc file not found: $FilePath"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

function Find-KakaoTalk {
  $candidates = @(
    "$env:LOCALAPPDATA\Kakao\KakaoTalk\KakaoTalk.exe",
    "$env:ProgramFiles\Kakao\KakaoTalk\KakaoTalk.exe",
    "${env:ProgramFiles(x86)}\Kakao\KakaoTalk\KakaoTalk.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
  return "KakaoTalk.exe"
}

function Focus-KakaoTalk {
  $processes = Get-Process -Name "KakaoTalk" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  foreach ($process in $processes) {
    if ([Microsoft.VisualBasic.Interaction]::AppActivate($process.Id)) {
      return $true
    }
  }
  return [Microsoft.VisualBasic.Interaction]::AppActivate("KakaoTalk")
}

$kakao = Find-KakaoTalk
Start-Process -FilePath $kakao | Out-Null
Start-Sleep -Seconds 3

if (-not (Focus-KakaoTalk)) {
  throw "KakaoTalk window not found. Please check PC KakaoTalk is installed and logged in."
}

# Open chat search and enter the target chat room.
[System.Windows.Forms.SendKeys]::SendWait("^f")
Start-Sleep -Milliseconds 500
[System.Windows.Forms.Clipboard]::SetText($ChatName)
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 1

if ($Message.Trim()) {
  [System.Windows.Forms.Clipboard]::SetText($Message)
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds 700
}

$files = New-Object System.Collections.Specialized.StringCollection
[void]$files.Add((Resolve-Path -LiteralPath $FilePath).Path)
[System.Windows.Forms.Clipboard]::SetFileDropList($files)
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Seconds 1
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 500

Write-Output "sent"
