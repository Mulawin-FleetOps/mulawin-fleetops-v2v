<?php
/*
 * =====================================================================
 *  tests/run_route_tests.php  —  Client Routes tests (Checklist #20)
 * =====================================================================
 *  RUN (needs a MySQL / MariaDB user that may create databases ending in _test):
 *    Linux / Hostinger SSH:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_route_tests.php
 *    XAMPP (Windows):        set TEST_DB_USER=root
 *                            set TEST_DB_PASS=
 *                            C:\xampp\php\php.exe tests\run_route_tests.php
 *  Optional: TEST_DB_HOST (127.0.0.1), TEST_DB_PORT (3306), TEST_DB_PREFIX (mulawin_routes)
 *  Safety rules: see tests/_launcher.php and tests/README.md. Exit code 0 = every test passed.
 *  Drops and re-creates ONLY: <prefix>_fresh_test, <prefix>_upgrade_test, <prefix>_partial_test
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('route_tests.php', 'mulawin_routes', ['fresh', 'upgrade', 'partial'], '2026-11-06_02_client_routes'));
