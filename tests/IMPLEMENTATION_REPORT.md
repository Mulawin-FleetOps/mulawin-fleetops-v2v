# Automated testing implementation ? 2026-11-10

## Delivered

PHPUnit 11.5.57 is reused without reinstalling dependencies. phpunit.xml provides Safe (default), Unit,
Integration and Feature suites. Composer test aliases accept normal PHPUnit arguments, including filters,
testdox and --log-junit. `composer test:all` selects Safe, Integration and Feature together.

Existing procedural assertions are preserved. Eleven original database suites and the Apache exposure
script are wrapped as separate processes. The new inventory/finance suite extends actual implemented
stock and payable workflows. PHPUnit reports one result per legacy script; failing output includes its
individual assertion results. The 600-second subprocess limit reports timeout as failure.

The default test bootstrap uses a temporary backend/config copy and an unusable local DB endpoint.
It never loads the project's .env. Integration launchers still use temporary project copies with their
own .env and explicit TEST_DB credentials. Database names are unique per run, local-only and end in
_test. Allowlist, exact configuration and temporary-directory identity are checked. Reset and cleanup
require the run-specific database ownership token. Existing test databases are never adopted by name.
Legacy route helpers and raw cleanup statements now delegate to these protections.

Shared date/calendar validation was corrected: PHP previously normalized invalid dates and times.
The validators now require exact calendar round trips. Regression cases cover invalid dates, leap days,
invalid hours/minutes and both supported schedule formats.

## Executed evidence

- Safe suite: **282 tests, 302 assertions, passed**, PHP 8.2.12 / PHPUnit 11.5.57.
- JUnit: tests/reports/safe.xml (generated, ignored by Git).
- Integration + Feature: **13 skipped** (12 database scripts, 1 Apache script).
- JUnit: tests/reports/external.xml records the skips, not passes.
- Every tests/**/*.php file and backend/bootstrap.php passed PHP syntax validation.
- Composer test alias and a filtered DatabaseSafety run passed (10 tests, 19 assertions).
- Composer manifest validation passed with the existing missing-license metadata warning.
- git diff --check passed.
- Direct batch launcher without TEST_DB_USER refused to execute before database access.

No destructive database tests were executed. No application database credentials were used, copied to
reports or inferred. TEST_DB_USER/PASS were unavailable, and TEST_BASE_URL was unset. The new ownership
marker/reset paths have database-free refusal coverage but still require live isolated DB verification.
The new inventory/finance suite is syntax-checked only, not claimed as passing.

## Remaining scope

This delivery establishes a unified runner, strengthens isolation, adds unit and authorization coverage,
and adds stock/payable scenarios. It does **not** constitute exhaustive coverage of every requested
business scenario. Dedicated maintenance repair/verification and purchase receipt matrices, collections,
financial summaries, comprehensive incident recovery and all state/role combinations remain to be
implemented and database-verified. Existing suites exercise portions of these workflows; see the
pre-implementation COVERAGE_INVENTORY.md for exact assertions.

Quantity expansion remains a proposed feature and has no falsely passing implementation test.
Corrective maintenance remains the maintenance model. No Delayed trip status was introduced.
No production dependencies were upgraded, application schema migrated or test account created.

To unblock database execution, supply explicit credentials for a local MySQL user restricted to the
chosen disposable test prefix, enable FLEETOPS_DB_TESTS=1 and run composer test:integration.
To unblock HTTP execution, supply TEST_BASE_URL pointing to the intended Apache deployment and run
composer test:feature. Credentials belong in the environment, not committed files or chat logs.
