<?php
/*
 * =====================================================================
 *  backend/bootstrap.php  —  shared core used by every module
 * =====================================================================
 *  What is inside:
 *    1. .env reader and PHP session setup
 *    2. Database connection (PDO, MySQL / MariaDB)
 *    3. JSON response helpers and the BusinessRuleException
 *    4. Input validation helpers (text, id, money, date)
 *    5. Small query helpers (one, many, run)
 *    6. Roles, current user and permission checks
 *    7. Audit log and database transaction helper
 *
 *  Modules (backend/Modules/*.php) only use these helpers, so a problem
 *  inside one module file does not affect the other modules.
 * =====================================================================
 */
declare(strict_types=1);

// ---------------------------------------------------------------------
// 1. ENVIRONMENT (.env in the project root) AND SESSION
// ---------------------------------------------------------------------
function envValue(string $key, string $default = ''): string {
    static $values = null;
    if ($values === null) {
        $values = [];
        $file = dirname(__DIR__) . '/.env';
        if (is_file($file)) {
            foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
                [$name, $value] = explode('=', $line, 2);
                $values[trim($name)] = trim($value, " \t\r\n\"'");
            }
        }
    }
    if (array_key_exists($key, $values)) return $values[$key];
    $fromEnv = getenv($key);
    return $fromEnv === false ? $default : $fromEnv;
}

date_default_timezone_set(envValue('APP_TIMEZONE', 'Asia/Manila'));

// Inactive sessions end after this many minutes (default 60).
const SESSION_IDLE_MINUTES_DEFAULT = 60;

if (PHP_SAPI !== 'cli' && session_status() !== PHP_SESSION_ACTIVE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Strict');
    ini_set('session.cookie_secure', (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? '1' : '0');
    session_name(envValue('SESSION_NAME', 'rp_mulawin_fms_v2'));
    session_start();
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    // strict-origin-when-cross-origin: map tile and search requests carry the site address, as the
    // map provider requires (the old "same-origin" sent no Referer, which caused the 403 tiles).
    header('Referrer-Policy: strict-origin-when-cross-origin');
}

// ---------------------------------------------------------------------
// 2. DATABASE
// ---------------------------------------------------------------------
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = 'mysql:host=' . envValue('DB_HOST', '127.0.0.1') . ';port=' . envValue('DB_PORT', '3306')
         . ';dbname=' . envValue('DB_NAME', 'mulawin_v2') . ';charset=utf8mb4';
    $pdo = new PDO($dsn, envValue('DB_USER', 'root'), envValue('DB_PASS'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    // Keep MySQL dates in the same timezone as PHP (Asia/Manila).
    $pdo->exec("SET time_zone = '" . (new DateTime())->format('P') . "'");
    return $pdo;
}

// ---------------------------------------------------------------------
// 3. JSON RESPONSES AND BUSINESS RULE ERRORS
// ---------------------------------------------------------------------
function jsonOut(array $value, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}
function fail(string $message, int $code = 400): never { jsonOut(['ok' => false, 'error' => $message], $code); }

/** Thrown when a rule is broken. Caught by public/index.php; any open transaction is rolled back first. */
final class BusinessRuleException extends DomainException {
    public function __construct(string $message, public readonly int $httpStatus = 400) { parent::__construct($message); }
}
/** must(condition, message): stop the request with a clear message if the condition is false. */
function must(bool $condition, string $message, int $code = 400): void {
    if (!$condition) throw new BusinessRuleException($message, $code);
}

// ---------------------------------------------------------------------
// 4. INPUT HELPERS  (every value from the browser is checked here)
// ---------------------------------------------------------------------
function inputData(): array {
    // Forms with files are sent as multipart/form-data: the normal fields are in
    // the "payload" field (JSON) and the files are in $_FILES (see Core/Files.php).
    if (str_starts_with(strtolower((string)($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart/form-data')) {
        $parsed = json_decode((string)($_POST['payload'] ?? '{}'), true);
        must(is_array($parsed), 'Invalid request data.');
        return $parsed;
    }
    $raw = file_get_contents('php://input');
    $parsed = json_decode($raw ?: '{}', true);
    must(is_array($parsed), 'Invalid request data.');
    return $parsed;
}
function textLength(string $v): int { return function_exists('mb_strlen') ? mb_strlen($v) : strlen($v); }
/** Shortens text to $n characters (safe for Filipino letters like ñ). */
function cut(string $v, int $n): string { return function_exists('mb_substr') ? mb_substr($v, 0, $n) : substr($v, 0, $n); }

/** Text field. $required=false returns '' when empty. */
function field(array $d, string $key, int $max = 255, bool $required = true): string {
    $val = $d[$key] ?? '';
    if (is_int($val) || is_float($val)) $val = (string)$val;
    must(is_string($val), "Invalid $key.");
    $v = trim($val);
    must(textLength($v) <= $max, ucfirst(str_replace('_', ' ', $key)) . " is too long (max $max characters).");
    if ($required) must($v !== '', ucfirst(str_replace('_', ' ', $key)) . ' is required.');
    return $v;
}
/** Optional text: returns null when empty. */
function optField(array $d, string $key, int $max = 255): ?string {
    $v = field($d, $key, $max, false);
    return $v === '' ? null : $v;
}
/** Positive whole-number id. */
function idField(array $d, string $key): int {
    $id = filter_var($d[$key] ?? null, FILTER_VALIDATE_INT);
    must($id !== false && $id > 0, 'Please choose a valid ' . str_replace('_', ' ', preg_replace('/_id$/', '', $key)) . '.');
    return (int)$id;
}
/** Optional id: null when blank. */
function optId(array $d, string $key): ?int {
    $v = $d[$key] ?? null;
    if ($v === null || $v === '' || $v === 0 || $v === '0') return null;
    return idField($d, $key);
}
/** Money with up to 2 decimals. $allowZero lets 0.00 pass. */
function moneyField(array $d, string $key, bool $allowZero = false): string {
    $v = trim(str_replace(',', '', (string)($d[$key] ?? '')));
    must((bool)preg_match('/^\d{1,10}(?:\.\d{1,2})?$/', $v) && ($allowZero || (float)$v > 0),
        ucfirst(str_replace('_', ' ', $key)) . ' must be a ' . ($allowZero ? '' : 'positive ') . 'amount with up to two decimals.');
    return number_format((float)$v, 2, '.', '');
}
function optMoney(array $d, string $key): ?string {
    $v = trim((string)($d[$key] ?? ''));
    return $v === '' ? null : moneyField($d, $key, true);
}
/** Whole number >= $min. */
function intField(array $d, string $key, int $min = 0, bool $required = true): ?int {
    $raw = $d[$key] ?? '';
    if (!$required && ($raw === '' || $raw === null)) return null;
    $v = filter_var($raw, FILTER_VALIDATE_INT);
    must($v !== false && $v >= $min, ucfirst(str_replace('_', ' ', $key)) . " must be a whole number of at least $min.");
    return (int)$v;
}
/** Decimal number >= 0. */
function numberField(array $d, string $key, bool $required = true): ?float {
    $raw = trim(str_replace(',', '', (string)($d[$key] ?? '')));
    if (!$required && $raw === '') return null;
    must(is_numeric($raw) && (float)$raw >= 0, ucfirst(str_replace('_', ' ', $key)) . ' must be a number.');
    return (float)$raw;
}
/** Date YYYY-MM-DD. */
function dateField(array $d, string $key, bool $required = true): ?string {
    $v = field($d, $key, 10, $required);
    if ($v === '') return null;
    must((bool)DateTimeImmutable::createFromFormat('!Y-m-d', $v), ucfirst(str_replace('_', ' ', $key)) . ' is not a valid date.');
    return $v;
}
/** Date and time from <input type="datetime-local"> (YYYY-MM-DDTHH:MM). */
function dateTimeField(array $d, string $key): string {
    $v = field($d, $key, 25);
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $v) ?: DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $v);
    must((bool)$dt, ucfirst(str_replace('_', ' ', $key)) . ' is not a valid date and time.');
    return $dt->format('Y-m-d H:i:s');
}
/** Value must be one of the allowed choices. */
function choiceField(array $d, string $key, array $allowed, bool $required = true): ?string {
    $v = field($d, $key, 80, $required);
    if ($v === '' && !$required) return null;
    must(in_array($v, $allowed, true), 'Invalid ' . str_replace('_', ' ', $key) . '.');
    return $v;
}

// ---------------------------------------------------------------------
// 5. QUERY HELPERS  (always prepared statements)
// ---------------------------------------------------------------------
function one(PDO $pdo, string $sql, array $args = []): ?array {
    $stmt = $pdo->prepare($sql); $stmt->execute($args); return $stmt->fetch() ?: null;
}
function many(PDO $pdo, string $sql, array $args = []): array {
    $stmt = $pdo->prepare($sql); $stmt->execute($args); return $stmt->fetchAll();
}
function run(PDO $pdo, string $sql, array $args = []): int {
    $stmt = $pdo->prepare($sql); $stmt->execute($args); return $stmt->rowCount();
}
function insert(PDO $pdo, string $table, array $row): int {
    must((bool)preg_match('/^[a-z_]+$/', $table), 'Invalid table.');
    $cols = array_keys($row);
    foreach ($cols as $c) must((bool)preg_match('/^[a-z0-9_]+$/', $c), 'Invalid column.');
    $sql = 'INSERT INTO ' . $table . ' (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')';
    $pdo->prepare($sql)->execute(array_values($row));
    return (int)$pdo->lastInsertId();
}
/** Simple reference number like TRP-2026-0001 built from the record id. */
function refNumber(string $prefix, int $id): string {
    return $prefix . '-' . date('Y') . '-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT);
}

// ---------------------------------------------------------------------
// 6. ROLES AND CURRENT USER
//    Role names follow PDF #11 "User Roles and Access Requirements".
//    "admin" = Admin / Head Management (Objective 4).
// ---------------------------------------------------------------------
const ROLE_LABELS = [
    'admin'                        => 'Admin (Head Management)',
    'operations_head'              => 'Operations Head',
    'car_carrier_dispatcher'       => 'Car Carrier Dispatcher',
    'container_wingvan_dispatcher' => 'Container / Wing Van Dispatcher',
    'motorpool'                    => 'Motorpool Custodian',
    'purchasing'                   => 'Purchasing Officer',
    'finance'                      => 'Finance',
    'billing'                      => 'Billing and Collection',
    'audit'                        => 'Audit',
];
const TRUCK_TYPES = ['Car Carrier', 'Container', 'Wing Van'];

// Minimum password length. Palitan ang numero kung gusto ng mas mahaba o mas maikli.
// Kailangan din may letra at numero ang password (halimbawa: test1234).
const PASSWORD_MIN_LENGTH = 8;

function allowedRoles(): array { return array_keys(ROLE_LABELS); }
function roleIsDispatcher(string $role): bool {
    return in_array($role, ['car_carrier_dispatcher', 'container_wingvan_dispatcher'], true);
}
/** Which dispatcher role handles a truck type (PDF: Car Carrier vs Container / Wing Van dispatchers). */
function dispatcherRoleFor(string $truckType): string {
    return $truckType === 'Car Carrier' ? 'car_carrier_dispatcher' : 'container_wingvan_dispatcher';
}

/** Signed-in user, re-read from the database on every request (deactivation takes effect at once). */
function currentUser(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $id = (int)($_SESSION['uid'] ?? 0);
    if (!$id) throw new BusinessRuleException('Please log in.', 401);
    // Idle timeout
    $idle = (int)envValue('SESSION_IDLE_MINUTES', (string)SESSION_IDLE_MINUTES_DEFAULT);
    if ($idle > 0 && isset($_SESSION['last_seen']) && time() - (int)$_SESSION['last_seen'] > $idle * 60) {
        session_unset();
        throw new BusinessRuleException('Your session expired. Please log in again.', 401);
    }
    $_SESSION['last_seen'] = time();
    $u = one(db(), 'SELECT id, username, email, full_name, role, shift FROM users WHERE id=? AND active=1', [$id]);
    if (!$u) { session_unset(); throw new BusinessRuleException('Session is no longer valid.', 401); }
    // Napalitan ang password pagkatapos mag-login ang session na ito (halimbawa ni-reset ng Admin o gamit ang recovery code).
    core('AccountSecurity');
    if (AccountSecurity::sessionOutdated((int)$u['id'])) { session_unset(); throw new BusinessRuleException('Your password was changed. Please log in again.', 401); }
    must(in_array($u['role'], allowedRoles(), true), 'Account role is not allowed.', 403);
    $u['id'] = (int)$u['id'];
    $u['role_label'] = ROLE_LABELS[$u['role']];
    return $cache = $u;
}
function hasRole(array $u, string ...$roles): bool { return in_array($u['role'], $roles, true); }
function requireRole(array $u, string ...$roles): void {
    must(hasRole($u, ...$roles), 'Your role is not allowed to do this.', 403);
}

// ---------------------------------------------------------------------
// 7. AUDIT LOG AND TRANSACTIONS
// ---------------------------------------------------------------------
/** Records who did what. $uid = null means "System" (automatic action). */
function audit(PDO $pdo, ?int $uid, string $area, string $record, string $action, string $details = ''): void {
    $pdo->prepare('INSERT INTO audit_events (actor_id, area, record_ref, action, details) VALUES (?,?,?,?,?)')
        ->execute([$uid, $area, $record, $action, cut($details, 1000)]);
}
/** Runs $cb inside a database transaction; everything is undone if an error happens. */
function transaction(callable $cb, ?PDO $connection = null): mixed {
    $p = $connection ?? db();
    if ($p->inTransaction()) return $cb($p);   // nested call: reuse the open transaction
    $p->beginTransaction();
    try { $out = $cb($p); $p->commit(); storedFiles(null, true); return $out; }
    catch (Throwable $e) {
        if ($p->inTransaction()) $p->rollBack();
        // Files saved during the failed transaction are deleted too, so no orphan files remain.
        foreach (storedFiles(null, true) as $f) @unlink($f);
        throw $e;
    }
}
/** Keeps the list of files saved during the current transaction (see Core/Files.php). */
function storedFiles(?string $add = null, bool $reset = false): array {
    static $list = [];
    if ($add !== null) $list[] = $add;
    $out = $list;
    if ($reset) $list = [];
    return $out;
}

/** Loads a core helper file once (backend/Core/Name.php). */
function core(string $name): void {
    must((bool)preg_match('/^[A-Za-z]+$/', $name), 'Invalid core file.');
    require_once __DIR__ . '/Core/' . $name . '.php';
}
