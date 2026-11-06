<?php
/*
 * =====================================================================
 *  tests/run_map_tests.php  —  Road distance / OpenStreetMap tests (Checklist #5)
 * =====================================================================
 *  No real call to openrouteservice is made (fake transport + local mock server).
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_map_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_map_tests.php)
 *  Drops and re-creates ONLY: <prefix>_fresh_test, <prefix>_partial_test  (prefix: mulawin_maps)
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('map_tests.php', 'mulawin_maps', ['fresh', 'partial'], '2026-11-06_04_maps_routing'));
