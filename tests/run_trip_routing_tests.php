<?php
/*
 * =====================================================================
 *  tests/run_trip_routing_tests.php  —  Road distance in Trip Management (Checklist #5 Phase 3)
 * =====================================================================
 *  No real call to openrouteservice is made (fake transport).
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_trip_routing_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_trip_routing_tests.php)
 *  Drops and re-creates ONLY: <prefix>_fresh_test, <prefix>_partial_test  (prefix: mulawin_trips)
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('trip_routing_tests.php', 'mulawin_trips', ['fresh', 'partial'], '2026-11-07_07_trip_routing'));
