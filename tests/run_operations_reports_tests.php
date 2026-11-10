<?php
declare(strict_types=1);
require __DIR__.'/_launcher.php';
exit(run_isolated_tests('operations_reports_tests.php','mulawin_ops_reports',['fresh'],'2026-11-10_10_trip_dispatcher_shift'));
