param([switch]$CreateUploadKey)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$toolRoot = Join-Path $projectRoot '.android-tools'
$jdk = (Get-ChildItem "$toolRoot/java" -Directory | Select-Object -First 1).FullName
$tools = (Get-ChildItem "$toolRoot/build-tools" -Directory | Select-Object -First 1).FullName
$platform = (Get-ChildItem "$toolRoot/platform" -Directory | Select-Object -First 1).FullName
$bundletool = Join-Path $toolRoot 'bundletool.jar'
if (!$jdk -or !$tools -or !$platform -or !(Test-Path $bundletool)) {
    throw 'Faltan Java, Android Build Tools, plataforma Android o .android-tools/bundletool.jar.'
}
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk/bin;$env:PATH"
function Run-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Fallo al ejecutar $Executable ($LASTEXITCODE)" }
}
$key = Join-Path $toolRoot 'm3uplayer-upload.keystore'
$passwordFile = Join-Path $toolRoot 'upload-key-password.txt'
if (!(Test-Path $key)) {
    if (!$CreateUploadKey) { throw 'Falta la clave de carga. Para la primera publicacion usa -CreateUploadKey.' }
    if (Test-Path $passwordFile) { throw 'Ya existe un archivo de contrasena; recupera su clave antes de continuar.' }
    $random = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    [IO.File]::WriteAllText($passwordFile, [Convert]::ToBase64String($random))
    Run-Checked "$jdk/bin/keytool.exe" @('-genkeypair', '-keystore', $key, '-storepass:file', $passwordFile, '-keypass:file', $passwordFile, '-alias', 'm3uplayer-upload', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=M3U Player Upload')
}
if (!(Test-Path $passwordFile)) { throw 'Falta .android-tools/upload-key-password.txt.' }
[xml]$manifest = Get-Content android/AndroidManifest.xml
$version = $manifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
$build = Join-Path $projectRoot 'android/build/bundle'
if (Test-Path $build) {
    $resolved = (Resolve-Path $build).Path
    if ($resolved -ne "$projectRoot\android\build\bundle") { throw 'Directorio de compilacion inesperado.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Force "$build/classes", "$build/module/dex", "$build/module/manifest", "$projectRoot/dist" | Out-Null
Run-Checked 'node' @('scripts/prepare-android.js')
$androidJar = Join-Path $platform 'android.jar'
Run-Checked "$jdk/bin/javac.exe" @('-encoding', 'UTF-8', '--release', '8', '-classpath', $androidJar, '-d', "$build/classes", 'android/src/cl/m3uplayer/mobile/MainActivity.java')
$classes = @(Get-ChildItem "$build/classes" -Recurse -Filter '*.class' | ForEach-Object FullName)
Run-Checked "$tools/d8.bat" (@('--lib', $androidJar, '--min-api', '26', '--output', "$build/module/dex") + $classes)
Run-Checked "$tools/aapt2.exe" @('compile', '--dir', 'android/res', '-o', "$build/resources.zip")
Run-Checked "$tools/aapt2.exe" @('link', '--proto-format', '-o', "$build/resources.apk", '-I', $androidJar, '--manifest', 'android/AndroidManifest.xml', '-A', 'android/build/assets', "$build/resources.zip")
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory("$build/resources.apk", "$build/module")
Move-Item -LiteralPath "$build/module/AndroidManifest.xml" -Destination "$build/module/manifest/AndroidManifest.xml"
Run-Checked "$jdk/bin/jar.exe" @('--create', '--file', "$build/base.zip", '--no-manifest', '-C', "$build/module", '.')
$bundle = Join-Path $projectRoot "dist/M3U-Player-$version.aab"
Run-Checked "$jdk/bin/java.exe" @('-jar', $bundletool, 'build-bundle', "--modules=$build/base.zip", "--output=$bundle", '--overwrite')
Run-Checked "$jdk/bin/jarsigner.exe" @('-keystore', $key, '-storepass:file', $passwordFile, '-keypass:file', $passwordFile, $bundle, 'm3uplayer-upload')
Run-Checked "$jdk/bin/jarsigner.exe" @('-verify', $bundle)
Run-Checked "$jdk/bin/java.exe" @('-jar', $bundletool, 'validate', "--bundle=$bundle")
Run-Checked "$jdk/bin/keytool.exe" @('-exportcert', '-rfc', '-keystore', $key, '-storepass:file', $passwordFile, '-alias', 'm3uplayer-upload', '-file', "$projectRoot/dist/m3uplayer-upload-certificate.pem")
Write-Output "AAB firmado y validado: $bundle"
