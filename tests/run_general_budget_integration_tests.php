<?php
declare(strict_types=1);
require __DIR__ . '/_launcher.php';
exit(run_isolated_tests('general_budget_integration_tests.php','mulawin_genbudget',['fresh'],'2026-11-19_02_part_type_name_brand'));
