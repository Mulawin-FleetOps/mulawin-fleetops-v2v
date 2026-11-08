<?php
/*
 * =====================================================================
 *  tests/run_trip_documents_tests.php  —  Checklist #44: Diesel PO and Supplier SOA attachments
 * =====================================================================
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_trip_documents_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_trip_documents_tests.php)
 *  Drops and re-creates ONLY: mulawin_tripdocs_fresh_test. Uploads use temporary files.
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('trip_documents_tests.php', 'mulawin_tripdocs', ['fresh'], '2026-11-08_08_attendance'));
