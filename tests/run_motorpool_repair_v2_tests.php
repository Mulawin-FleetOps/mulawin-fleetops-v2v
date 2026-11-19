<?php
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('motorpool_repair_v2_tests.php','mulawin_mpv2',['fresh'],'2026-11-19_03_motorpool_repair_catalogs'));
