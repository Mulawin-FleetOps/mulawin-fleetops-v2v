<?php
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('trip_approval_tests.php', 'mulawin_approvals', ['fresh'], '2026-11-08_08_attendance'));
