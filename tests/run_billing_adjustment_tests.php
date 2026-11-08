<?php
/*
 * =====================================================================
 *  tests/run_billing_adjustment_tests.php  —  Billing Rate Approval (charges + per-trip rate adjustments)
 * =====================================================================
 *  RUN:  TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_billing_adjustment_tests.php
 *        (XAMPP: set TEST_DB_USER=root / set TEST_DB_PASS= / C:\xampp\php\php.exe tests\run_billing_adjustment_tests.php)
 *  Drops and re-creates ONLY: mulawin_billadj_fresh_test and mulawin_billadj_upgrade_test.
 *  Run from a git clone so the upgrade (old schema + migration) check can run.
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('billing_adjustment_tests.php', 'mulawin_billadj', ['fresh', 'upgrade'], '2026-11-09_09_billing_adjustments'));
