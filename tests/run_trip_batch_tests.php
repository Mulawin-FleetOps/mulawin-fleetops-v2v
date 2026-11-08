<?php
/*
 * =====================================================================
 *  tests/run_trip_batch_tests.php  —  Batch trip planning
 * =====================================================================
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_trip_batch_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_trip_batch_tests.php)
 *  Drops and re-creates ONLY: mulawin_batch_fresh_test. Includes a two-process duplicate-submission test.
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('trip_batch_tests.php', 'mulawin_batch', ['fresh'], '2026-11-08_08_attendance'));
