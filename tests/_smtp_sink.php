<?php
/*
 * tests/_smtp_sink.php  —  tiny local SMTP receiver for the tests (CLI only).
 * Accepts mail on 127.0.0.1:<port> and saves each message as a file in <dir>. Nothing is sent anywhere.
 * Started and stopped by tests/account_security_tests.php.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || $argc < 3) { exit(2); }
$port = (int)$argv[1]; $dir = $argv[2];
$srv = @stream_socket_server("tcp://127.0.0.1:$port", $errno, $errstr);
if (!$srv) { fwrite(STDERR, "SMTP sink: $errstr\n"); exit(1); }
file_put_contents($dir . '/ready', '1');
$n = 0;
while ($c = @stream_socket_accept($srv, -1)) {
    fwrite($c, "220 sink ready\r\n");
    $rcpt = []; $data = null;
    while (($line = fgets($c)) !== false) {
        if ($data !== null) {
            if (rtrim($line, "\r\n") === '.') {
                file_put_contents(sprintf('%s/mail_%020d_%04d.eml', $dir, hrtime(true), ++$n), 'X-Rcpt: ' . implode(',', $rcpt) . "\r\n" . $data);
                $data = null; $rcpt = []; fwrite($c, "250 queued\r\n");
            } else $data .= $line;
            continue;
        }
        $cmd = strtoupper(substr(trim($line), 0, 4));
        if ($cmd === 'EHLO' || $cmd === 'HELO') fwrite($c, "250 sink\r\n");
        elseif ($cmd === 'RCPT') { if (preg_match('/<([^>]*)>/', $line, $m)) $rcpt[] = $m[1]; fwrite($c, "250 ok\r\n"); }
        elseif ($cmd === 'DATA') { $data = ''; fwrite($c, "354 go ahead\r\n"); }
        elseif ($cmd === 'QUIT') { fwrite($c, "221 bye\r\n"); break; }
        else fwrite($c, "250 ok\r\n");   // MAIL, RSET, NOOP
    }
    fclose($c);
}
