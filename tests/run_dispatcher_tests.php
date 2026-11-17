<?php
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('dispatcher_tests.php', 'mulawin_dispatcher', ['fresh'], '2026-11-08_08_attendance'));
