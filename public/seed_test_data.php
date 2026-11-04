<?php
/*
 * public/seed_test_data.php — load the complete TEST data from the browser
 * (for hosting without SSH, e.g. Hostinger shared hosting). Same work as
 * scripts/seed_test_data.php.
 *
 * DISABLED unless ALL of these are true:
 *   1. SEED_TEST_TOKEN in .env has 32 or more characters,
 *   2. you are logged in to Mulawin FleetOps as the Admin (same browser),
 *   3. you type the same token and YES in the form.
 * After loading the data: clear SEED_TEST_TOKEN in .env (or delete this file).
 * Use only on a TEST copy. It adds missing data and never deletes anything.
 */
declare(strict_types=1);
define('FMS_SEED_WEB', true);
require dirname(__DIR__) . '/backend/bootstrap.php';
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$token = envValue('SEED_TEST_TOKEN', '');
if (strlen($token) < 32) { http_response_code(403); exit('Disabled. Set SEED_TEST_TOKEN (32+ characters) in .env to use this page, then clear it after use.'); }
try { $u = currentUser(); } catch (Throwable $e) { http_response_code(403); exit('Log in to Mulawin FleetOps as the Admin first (same browser), then open this page again.'); }
if ($u['role'] !== 'admin') { http_response_code(403); exit('Only the Admin can load test data.'); }

require dirname(__DIR__) . '/scripts/seed_test_data.php';

// Show a report made earlier (reports are in storage/test_data, which the web cannot open directly).
if (isset($_GET['report'])) {
    $name = basename((string)$_GET['report']);
    $file = dirname(__DIR__) . '/storage/test_data/' . $name;
    if (!preg_match('/^test_data_report_\d{8}_\d{6}\.html$/', $name) || !is_file($file)) { http_response_code(404); exit('Report not found.'); }
    header('Content-Type: text/html; charset=utf-8');
    readfile($file);
    exit;
}

if (!isset($_SESSION['seed_csrf'])) $_SESSION['seed_csrf'] = bin2hex(random_bytes(24));
$log = []; $error = ''; $report = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($_SESSION['seed_csrf'], (string)($_POST['csrf'] ?? ''))) $error = 'Security token rejected. Reload the page.';
    elseif (!hash_equals($token, (string)($_POST['token'] ?? ''))) $error = 'Wrong SEED_TEST_TOKEN.';
    elseif (trim((string)($_POST['confirm'] ?? '')) !== 'YES') $error = 'Type YES to confirm.';
    else {
        try {
            @set_time_limit(300);
            $r = fmsSeedTestData(function ($s) use (&$log) { $log[] = $s; });
            $report = basename($r['report']);
        } catch (Throwable $e) { $error = 'FAILED: ' . $e->getMessage() . ' Nothing was saved.'; }
    }
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
$reports = array_reverse(array_map('basename', glob(dirname(__DIR__) . '/storage/test_data/test_data_report_*.html') ?: []));
?><!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Load test data · Mulawin FleetOps</title>
<link rel="stylesheet" href="assets/vendor/bootstrap/css/bootstrap.min.css"></head>
<body class="bg-light"><main class="container py-4" style="max-width:820px">
<h1 class="h4">Load complete test data</h1>
<p class="text-muted">Signed in as <?= $h($u['full_name']) ?> (Admin). Completes the masterlists (trucks, drivers, helpers, clients with files and rates, mechanics, parts, suppliers, budget),
adds special test cases, and writes a report of the expected automatic assignments. It never deletes anything and can be run again.</p>
<?php if ($error): ?><div class="alert alert-danger"><?= $h($error) ?></div><?php endif; ?>
<?php if ($log): ?><div class="alert alert-success"><b>Done.</b><ul class="mb-0"><?php foreach ($log as $l): ?><li><?= $h($l) ?></li><?php endforeach; ?></ul></div>
<p><a class="btn btn-primary" href="?report=<?= $h($report) ?>" target="_blank">Open the test basis report</a></p>
<p class="text-danger small">Now clear SEED_TEST_TOKEN in .env (or delete public/seed_test_data.php) so this page is disabled again.</p><?php endif; ?>
<form method="post" class="card card-body mb-4">
  <input type="hidden" name="csrf" value="<?= $h($_SESSION['seed_csrf']) ?>">
  <label class="form-label" for="tk">SEED_TEST_TOKEN (from .env)</label>
  <input class="form-control mb-3" type="password" id="tk" name="token" autocomplete="off" required>
  <label class="form-label" for="cf">Type YES to load the test data into this database</label>
  <input class="form-control mb-3" id="cf" name="confirm" autocomplete="off" required>
  <button class="btn btn-dark" type="submit">Load test data</button>
</form>
<?php if ($reports): ?><h2 class="h6">Earlier reports</h2><ul><?php foreach (array_slice($reports, 0, 10) as $r): ?><li><a href="?report=<?= $h($r) ?>" target="_blank"><?= $h($r) ?></a></li><?php endforeach; ?></ul><?php endif; ?>
</main></body></html>
