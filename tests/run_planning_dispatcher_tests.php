<?php
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('planning_dispatcher_tests.php', 'mulawin_planning', ['fresh'], '2026-11-10_10_trip_dispatcher_shift'));
