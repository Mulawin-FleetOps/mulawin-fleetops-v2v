<?php
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('inventory_finance_tests.php', 'mulawin_invfin', ['fresh'], '2026-11-09_09_billing_adjustments'));
