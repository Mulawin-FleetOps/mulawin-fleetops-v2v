<?php
/*
 * =====================================================================
 *  tests/run_htaccess_tests.php  —  web exposure check (SECURITY_DOTPATH_BLOCK_V1)
 * =====================================================================
 *  Sends READ-ONLY GET requests to a running copy of the system and checks that private paths
 *  (.git, .env, other dot-files, backend, storage, backups, docs, tests, ...) are NOT served,
 *  while the application and its public assets still work. No database, no login, no changes.
 *
 *  RUN (whole project folder inside the web root, e.g. XAMPP htdocs or Hostinger public_html):
 *    TEST_BASE_URL=http://localhost/RP_Mulawin_FMS_V2 php tests/run_htaccess_tests.php
 *  RUN (domain document root = the public/ folder, the safest Hostinger layout):
 *    TEST_BASE_URL=https://your-domain TEST_LAYOUT=public php tests/run_htaccess_tests.php
 *  Windows (XAMPP): set TEST_BASE_URL=http://localhost/RP_Mulawin_FMS_V2
 *                   C:\xampp\php\php.exe tests\run_htaccess_tests.php
 *  Exit code 0 = every check passed.
 * =====================================================================
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }

$base = rtrim((string)getenv('TEST_BASE_URL'), '/');
$layout = getenv('TEST_LAYOUT') === 'public' ? 'public' : 'project';
if (!preg_match('#^https?://[^\s]+$#', $base)) { fwrite(STDERR, "Set TEST_BASE_URL (http:// or https://). See the header of this file.\n"); exit(2); }
$app = $layout === 'public' ? '' : '/public';   // where public/index.php is served

$pass = 0; $fail = 0; $failed = [];
function ok(bool $c, string $name, string $detail = ''): void {
    global $pass, $fail, $failed;
    if ($c) { $pass++; echo "  PASS  $name\n"; } else { $fail++; $failed[] = $name; echo "  FAIL  $name" . ($detail !== '' ? "  -> $detail" : '') . "\n"; }
}
/** GET without following redirects. Returns [status, body, content-type, location]. */
function get(string $url): array {
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'ignore_errors' => true, 'follow_location' => 0, 'timeout' => 15,
        'header' => "User-Agent: mulawin-exposure-check\r\n"]]);
    $body = @file_get_contents($url, false, $ctx);
    $headers = $http_response_header ?? [];
    $status = 0; $type = ''; $loc = '';
    foreach ($headers as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int)$m[1];
        elseif (stripos($h, 'Content-Type:') === 0) $type = trim(substr($h, 13));
        elseif (stripos($h, 'Location:') === 0) $loc = trim(substr($h, 9));
    }
    return [$status, (string)$body, $type, $loc];
}
// Text that must never appear in a response (git internals, .env keys, PHP source, SQL dumps).
const LEAK_MARKERS = ['[core]', 'repositoryformatversion', 'ref: refs/', 'DIRC', 'DB_PASS', 'MAIL_PASSWORD', 'INSTALL_TOKEN', '<?php', 'CREATE TABLE', 'declare(strict_types'];
function denied(string $path, string $label = ''): void {
    global $base;
    [$s, $body] = get($base . $path);
    $leak = array_values(array_filter(LEAK_MARKERS, fn($m) => str_contains($body, $m)));
    ok(in_array($s, [400, 401, 403, 404], true) && !$leak, 'not served: ' . ($label ?: $path), "HTTP $s" . ($leak ? ', body contains ' . implode(', ', $leak) : ''));
}

echo "Layout: $layout ($base)\n\n== A. Git repository and other dot-paths ==\n";
foreach (['/.git/config', '/.git/index', '/.git/HEAD', '/.git/logs/HEAD', '/.git/objects/info/packs', '/.git/', '/.git',
          '/.env', '/.env.example', '/.gitignore', '/.htaccess', '/.github/workflows/deploy.yml', '/.vscode/settings.json', '/.idea/workspace.xml', '/.DS_Store',
          $app . '/.htaccess', $app . '/.git/config', $app . '/assets/.git/config', '/%2Egit/config', '/.GIT/config'] as $p) denied($p);

echo "\n== B. Private project folders and files ==\n";
if ($layout === 'project') {
    foreach (['/backend/bootstrap.php', '/backend/Modules/Operations/Trips.php.pre_5h1.bak', '/config/', '/database/schema.sql', '/database/migrations/',
              '/docs/HOSTINGER_PREPARATION.md', '/scripts/create_user.php', '/storage/', '/storage/private/', '/storage/backups/', '/tests/_launcher.php',
              '/tests/README.md', '/automation/fmsauto.py', '/README.md', '/CHANGELOG.md'] as $p) denied($p);
} else {
    // Only public/ is on the web: everything else of the project simply does not exist here.
    foreach (['/../.env', '/backend/bootstrap.php', '/storage/private/', '/database/schema.sql'] as $p) denied($p);
}

echo "\n== C. The application and public assets still work ==\n";
[$s, $body, $type] = get($base . $app . '/index.php?api=whoami');
ok($s === 200 && str_contains($type, 'json') && str_contains($body, '"csrf"'), 'API answers (index.php?api=whoami)', "HTTP $s $type");
[$s, $body] = get($base . $app . '/index.php');
ok($s === 200 && str_contains($body, 'App.start()'), 'application page loads', "HTTP $s");
[$s, , $type] = get($base . $app . '/assets/css/app.css');
ok($s === 200 && str_contains($type, 'css'), 'stylesheet served (assets/css/app.css)', "HTTP $s $type");
[$s, , $type] = get($base . $app . '/assets/js/core.js');
ok($s === 200 && str_contains($type, 'javascript'), 'script served (assets/js/core.js)', "HTTP $s $type");
[$s] = get($base . $app . '/assets/vendor/bootstrap/css/bootstrap.min.css');
ok($s === 200, 'vendor asset served (bootstrap.min.css)', "HTTP $s");
if ($layout === 'project') {
    [$s, , , $loc] = get($base . '/');
    ok(in_array($s, [200, 301, 302], true), 'project root opens or forwards to the app', "HTTP $s $loc");
}
[$s] = get($base . '/.well-known/acme-challenge/mulawin-check');
ok($s !== 403, '/.well-known/ is not blocked (SSL certificate validation)', "HTTP $s");

echo "\n" . str_repeat('=', 60) . "\nRESULT: $pass passed, $fail failed\n";
if ($failed) echo "Failed:\n - " . implode("\n - ", $failed) . "\n";
exit($fail ? 1 : 0);
