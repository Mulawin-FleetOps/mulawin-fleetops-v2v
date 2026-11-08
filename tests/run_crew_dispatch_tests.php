<?php
/*
 * =====================================================================
 *  tests/run_crew_dispatch_tests.php  —  Checklist #42 Phase 2: attendance enforcement
 * =====================================================================
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_crew_dispatch_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_crew_dispatch_tests.php)
 *  Drops and re-creates ONLY: mulawin_crewdisp_fresh_test
 *  Includes a two-process test (attendance changed while Confirm Dispatch runs).
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('crew_dispatch_tests.php', 'mulawin_crewdisp', ['fresh'], '2026-11-08_08_attendance'));
