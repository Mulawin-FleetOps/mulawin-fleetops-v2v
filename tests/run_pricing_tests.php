<?php
declare(strict_types=1);
require __DIR__.'/_launcher.php';
exit(run_isolated_tests('pricing_tests.php','mulawin_pricing',['fresh','upgrade'],'2026-11-13_13_fixed_route_fuel',[],true));
