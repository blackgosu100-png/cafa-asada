$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dist = Join-Path $root "dist\windows"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Add-Type -AssemblyName System.Windows.Forms

function Compile-CSharp {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )

  $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
  $params = New-Object System.CodeDom.Compiler.CompilerParameters
  $params.GenerateExecutable = $true
  $params.OutputAssembly = $OutputPath
  $params.CompilerOptions = "/target:winexe /platform:anycpu"
  $params.ReferencedAssemblies.Add("System.dll") | Out-Null
  $params.ReferencedAssemblies.Add("System.Core.dll") | Out-Null
  $params.ReferencedAssemblies.Add("System.Windows.Forms.dll") | Out-Null

  $result = $provider.CompileAssemblyFromFile($params, $SourcePath)
  if ($result.Errors.HasErrors) {
    $messages = $result.Errors | ForEach-Object { "$($_.FileName):$($_.Line): $($_.ErrorText)" }
    throw ($messages -join [Environment]::NewLine)
  }
}

$launcher = Join-Path $dist "CafeAsada.exe"
$installer = Join-Path $dist "CafeAsadaInstaller.exe"

Compile-CSharp -SourcePath (Join-Path $PSScriptRoot "CafeAsadaLauncher.cs") -OutputPath $launcher
Compile-CSharp -SourcePath (Join-Path $PSScriptRoot "CafeAsadaInstaller.cs") -OutputPath $installer

$filesToCopy = @(
  ".gitignore",
  "build_hot_video_source.py",
  "build_review_docx.py",
  "cafe_post_generator.html",
  "cafe_viral_generator.html",
  "codex_draft_schema.json",
  "codex_local_server.js",
  "codex_output_schema.json",
  "codex_source_analysis_schema.json",
  "codex_title_schema.json",
  "crawl_naver_full_content.js",
  "desire_empathy_source.txt",
  "extract_youtube_transcript.py",
  "hot_video_develop_source.txt",
  "hot_video_title_source.txt",
  "index.html",
  "naver_review_copy_helper.html",
  "start_cafe_generator.cmd"
)

foreach ($file in $filesToCopy) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $dist $file) -Force
}

$vendorSource = Join-Path $root "vendor"
if (Test-Path $vendorSource) {
  $vendorTarget = Join-Path $dist "vendor"
  New-Item -ItemType Directory -Force -Path $vendorTarget | Out-Null
  Get-ChildItem -LiteralPath $vendorSource -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\__pycache__\\' -and $_.FullName -notmatch '\\vendor\\python\\bin\\' } |
    ForEach-Object {
      $relative = $_.FullName.Substring($vendorSource.Length).TrimStart('\')
      $target = Join-Path $vendorTarget $relative
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
}

"Built package: $dist"
