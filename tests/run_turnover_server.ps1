# Own isolated server only. Never reads the application .env or connects to its server.
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$ownedRoot=Join-Path ([IO.Path]::GetTempPath()) ('fleetops-turnover-'+[Guid]::NewGuid().ToString('N'))
if(Test-Path -LiteralPath $ownedRoot){throw 'Unexpected existing test root'}
New-Item -ItemType Directory -Path $ownedRoot | Out-Null
$ownedRoot=(Resolve-Path -LiteralPath $ownedRoot).Path
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$testPort=$listener.LocalEndpoint.Port;$listener.Stop()
$serverProcess=$null
try {
 & 'C:\xampp\mysql\bin\mysql_install_db.exe' ('--datadir='+$ownedRoot) ('--port='+$testPort) --silent
 if($LASTEXITCODE -ne 0){throw 'Disposable initialization failed'}
 $serverProcess=Start-Process -FilePath 'C:\xampp\mysql\bin\mysqld.exe' -ArgumentList @('--no-defaults','--basedir=C:/xampp/mysql',('--datadir='+$ownedRoot),('--port='+$testPort),'--bind-address=127.0.0.1','--skip-log-bin','--innodb-buffer-pool-size=64M','--console') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $ownedRoot 'server.out') -RedirectStandardError (Join-Path $ownedRoot 'server.err')
 $env:TURNOVER_TEST_DATADIR=$ownedRoot
 $env:TEST_DB_HOST='127.0.0.1';$env:TEST_DB_PORT=[string]$testPort;$env:TEST_DB_USER='fleetops_turnover_test';$env:TEST_DB_PASS=[Guid]::NewGuid().ToString('N')
 & 'C:\xampp\php\php.exe' (Join-Path $PSScriptRoot 'turnover_server_setup.php')
 if($LASTEXITCODE -ne 0){throw 'Disposable server identity verification failed'}
 & 'C:\xampp\php\php.exe' (Join-Path $PSScriptRoot 'run_turnover_tests.php')
 $testExit=$LASTEXITCODE
} finally {
 if($serverProcess -and !$serverProcess.HasExited){Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue;$serverProcess.WaitForExit(10000)|Out-Null}
 # Only the exact new temporary directory created above may be removed.
 $resolvedRoot=[IO.Path]::GetFullPath($ownedRoot)
 $tempParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
 if((Split-Path -Parent $resolvedRoot) -ne $tempParent -or (Split-Path -Leaf $resolvedRoot) -notmatch '^fleetops-turnover-[a-f0-9]{32}$'){throw 'Refusing unsafe cleanup path'}
 Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
 Remove-Item Env:TEST_DB_PASS -ErrorAction SilentlyContinue
}
exit $testExit
