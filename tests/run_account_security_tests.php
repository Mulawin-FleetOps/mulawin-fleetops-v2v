<?php
/*
 * =====================================================================
 *  tests/run_account_security_tests.php  —  current-password lock + email change notice
 * =====================================================================
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_account_security_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_account_security_tests.php)
 *  Drops and re-creates ONLY: mulawin_acctsec_fresh_test. Emails go to a local test receiver
 *  (tests/_smtp_sink.php on 127.0.0.1); nothing is sent to the internet.
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
$port = random_int(20000, 39999);
exit(run_isolated_tests('account_security_tests.php', 'mulawin_acctsec', ['fresh'], '2026-11-09_09_billing_adjustments', [
    'MAIL_HOST' => '127.0.0.1', 'MAIL_PORT' => (string)$port, 'MAIL_ENCRYPTION' => 'none', 'MAIL_USERNAME' => '', 'MAIL_PASSWORD' => '',
    'MAIL_FROM_ADDRESS' => 'noreply@example.test', 'MAIL_TIMEOUT' => '5', 'TEST_SMTP_PORT' => (string)$port,
]));
