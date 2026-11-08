<?php
/*
 * =====================================================================
 *  tests/run_fund_release_tests.php  —  Cash-only trip fund release (#36) and Trip Fund tabs (#37)
 * =====================================================================
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_fund_release_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_fund_release_tests.php)
 *  Drops and re-creates ONLY: mulawin_funds_fresh_test
 *  Includes a two-process concurrency test (two Finance users releasing the same fund).
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('fund_release_tests.php', 'mulawin_funds', ['fresh'], '2026-11-08_08_attendance'));
