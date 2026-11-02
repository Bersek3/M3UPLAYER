$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$toolRoot = Join-Path $projectRoot '.android-tools'
$jdkRoot = (Get-ChildItem -LiteralPath "$toolRoot/java" -Directory | Select-Object -First 1).FullName
$buildTools = (Get-ChildItem -LiteralPath "$toolRoot/build-tools" -Directory | Select-Object -First 1).FullName
$platform = (Get-ChildItem -LiteralPath "$toolRoot/platform" -Directory | Select-Object -First 1).FullName
if (!$jdkRoot -or !$buildTools -or !$platform) { throw 'Faltan Java o las herramientas Android en .android-tools.' }
$env:JAVA_HOME = $jdkRoot
$env:PATH = "$jdkRoot/bin;$env:PATH"
function Run-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Fallo al ejecutar $Executable ($LASTEXITCODE)" }
}
Run-Checked 'node' @('scripts/prepare-android.js')
$build = Join-Path $projectRoot 'android/build'
New-Item -ItemType Directory -Force "$build/classes", "$build/dex", "$projectRoot/dist" | Out-Null
$androidJar = Join-Path $platform 'android.jar'
$javaSource = Join-Path $projectRoot 'android/src/cl/m3uplayer/mobile/MainActivity.java'
Run-Checked "$jdkRoot/bin/javac.exe" @('-encoding', 'UTF-8', '--release', '8', '-classpath', $androidJar, '-d', "$build/classes", $javaSource)
$classFiles = @(Get-ChildItem -LiteralPath "$build/classes" -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
Run-Checked "$buildTools/d8.bat" (@('--lib', $androidJar, '--min-api', '26', '--output', "$build/dex") + $classFiles)
Run-Checked "$buildTools/aapt.exe" @('package', '-f', '-M', "$projectRoot/android/AndroidManifest.xml", '-S', "$projectRoot/android/res", '-A', "$build/assets", '-I', $androidJar, '-F', "$build/unsigned.apk")
Push-Location -LiteralPath "$build/dex"
try { Run-Checked "$buildTools/aapt.exe" @('add', "$build/unsigned.apk", 'classes.dex') }
finally { Pop-Location }
Run-Checked "$buildTools/zipalign.exe" @('-f', '4', "$build/unsigned.apk", "$build/aligned.apk")
$key = Join-Path $toolRoot 'm3uplayer-personal.keystore'
if (!(Test-Path -LiteralPath $key)) {
    Run-Checked "$jdkRoot/bin/keytool.exe" @('-genkeypair', '-keystore', $key, '-storepass', 'android', '-keypass', 'android', '-alias', 'm3uplayer', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=M3U Player Personal')
}
$apk = Join-Path $projectRoot 'dist/M3U-Player-1.5.0.apk'
Run-Checked "$buildTools/apksigner.bat" @('sign', '--ks', $key, '--ks-key-alias', 'm3uplayer', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $apk, "$build/aligned.apk")
Run-Checked "$buildTools/apksigner.bat" @('verify', '--verbose', $apk)
Run-Checked "$buildTools/aapt.exe" @('dump', 'badging', $apk)
Write-Output "APK creado: $apk"
