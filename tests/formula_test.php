<?php
/*
 * tests/formula_test.php — checks that the formulas give the same answers
 * as the company Excel files (uses the DEFAULT values of config/formulas.php).
 *   C:\xampp\php\php.exe tests\formula_test.php
 * If you changed values in Formula Settings, the database values are used,
 * so some expected numbers below may differ on purpose.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit('CLI only');
require dirname(__DIR__) . '/backend/bootstrap.php';
core('Settings');
$fails = 0;
function same(string $what, float $got, float $want): void {
    global $fails; $ok = abs($got - $want) < 0.01; if (!$ok) $fails++;
    printf("%s %-62s got %12.2f  expected %12.2f\n", $ok ? 'PASS' : 'FAIL', $what, $got, $want);
}
// Billing P&L workbook: KM = 52+67+24 = 143, RFID = 274+94+76+76+94+37 = 651, Gross sales = 15000
same('Fuel = (143 km / 4 km per L) x 100 (P&L G54)', Settings::fuelCost(143), 3575);
$pnl = Settings::projectedPnl(15000, 143, 651);
same('P&L total expense (G36)', $pnl['total_expense'], 10002.92);
same('P&L net income (G44)', $pnl['net_income'], 4997.08);
same('P&L margin % (G46 x 100)', (float)$pnl['margin_percent'], 33.31);
// Bagong FMS PDF Scenario B step 4: preset fund categories.
$cats = array_column(Settings::computeItems('trip_allowance', [])['lines'], 'amount', 'name');
same('Fund category Forklift Operator = 100', $cats['Forklift Operator'] ?? -1, 100);
same('Fund category Checker = 100', $cats['Checker'] ?? -1, 100);
same('Fund category Passway = 200', $cats['Passway'] ?? -1, 200);
same('Fund category Driver Meal Allowance = 300', $cats['Driver Meal Allowance'] ?? -1, 300);
same('Fund category Helper Meal Allowance = 200', $cats['Helper Meal Allowance'] ?? -1, 200);
// DRIVERS PAYROLL: 6 days attendance
$d = Settings::computeItems('payroll_deduction', ['days' => 6, 'ledgers' => ['Cash Advance' => 500]]);
$by = array_column($d['lines'], 'amount', 'name');
same('SSS = (775/24) x 6 days (N14)', $by['SSS'], 193.75);
same('PhilHealth = 75 if with attendance (O14)', $by['PhilHealth'], 75);
same('Pag-IBIG = 50 if with attendance (P14)', $by['Pag-IBIG Fund'], 50);
same('Savings / cash bond = 500 if with attendance (X15)', $by['Savings / Cash Bond'], 500);
same('AR EMP - CA from cash advance installment', $by['AR EMP - CA'], 500);
$none = Settings::computeItems('payroll_deduction', ['days' => 0]);
same('No attendance -> no statutory deductions (IF(D<>"",...))', $none['total'], 0);
echo $fails ? "\n$fails FAILED\n" : "\nALL PASSED\n";
exit($fails ? 1 : 0);
