<?php
declare(strict_types=1);
require __DIR__.'/_launcher.php';
exit(run_isolated_tests('operations_v43_tests.php','mulawin_v43',['fresh','upgrade'],'2026-11-11_11_operations_v43'));
