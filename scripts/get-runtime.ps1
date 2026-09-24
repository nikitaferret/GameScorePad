# Восстанавливает портативный Python рядом с приложением.
#
# Запуск из корня проекта:
#   powershell -ExecutionPolicy Bypass -File scripts\get-runtime.ps1
#
# Скрипт скачивает официальный embeddable-дистрибутив CPython с python.org
# и распаковывает его в runtime\python — именно туда, откуда его ждёт *.bat.
# Ничего не устанавливается в систему, прав администратора не требуется.

$ErrorActionPreference = 'Stop'

$Version = '3.12.10'
$Url     = "https://www.python.org/ftp/python/$Version/python-$Version-embed-amd64.zip"

$Root   = Split-Path -Parent $PSScriptRoot
$Target = Join-Path $Root 'runtime\python'
$Exe    = Join-Path $Target 'python.exe'

if (Test-Path $Exe) {
    Write-Host "Runtime уже на месте: $Target"
    & $Exe --version
    exit 0
}

$Zip = Join-Path $env:TEMP "python-$Version-embed-amd64.zip"

Write-Host "Скачиваю $Url"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Write-Host "Распаковываю в $Target"
Expand-Archive -Path $Zip -DestinationPath $Target -Force
Remove-Item $Zip -Force

& $Exe --version
Write-Host ""
Write-Host "Готово. Запускайте .bat из корня проекта."
