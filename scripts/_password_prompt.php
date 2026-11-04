<?php
/*
 * scripts/_password_prompt.php — asks for a new password on the command line.
 * Used by create_user.php and reset_password.php. The password is typed twice and is
 * hidden on Linux/Mac (on Windows the typing may be visible, so make sure no one is watching).
 * For automation it can also be piped in:  echo MyPassw0rd | php scripts/create_user.php ...
 */
declare(strict_types=1);

function askNewPassword(): string {
    $isTty = function_exists('stream_isatty') ? stream_isatty(STDIN) : true;
    if (!$isTty) {                                   // piped in (one line)
        $pw = trim((string)fgets(STDIN));
        checkNewPassword($pw);
        return $pw;
    }
    $hide = DIRECTORY_SEPARATOR === '/' && trim((string)@shell_exec('command -v stty')) !== '';
    for ($try = 0; $try < 3; $try++) {
        $a = readHidden('New password (' . PASSWORD_MIN_LENGTH . '+ characters, letters and numbers): ', $hide);
        $b = readHidden('Type it again: ', $hide);
        if ($a !== $b) { fwrite(STDERR, "The two passwords are different. Try again.\n"); continue; }
        try { checkNewPassword($a); return $a; } catch (RuntimeException $e) { fwrite(STDERR, $e->getMessage() . "\n"); }
    }
    throw new RuntimeException('No valid password entered.');
}

function readHidden(string $label, bool $hide): string {
    fwrite(STDOUT, $label);
    if ($hide) shell_exec('stty -echo');
    $v = trim((string)fgets(STDIN));
    if ($hide) { shell_exec('stty echo'); fwrite(STDOUT, "\n"); }
    return $v;
}

function checkNewPassword(string $pw): void {
    if (strlen($pw) < PASSWORD_MIN_LENGTH || !preg_match('/[A-Za-z]/', $pw) || !preg_match('/\d/', $pw))
        throw new RuntimeException('Password must have at least ' . PASSWORD_MIN_LENGTH . ' characters with letters and numbers.');
}
