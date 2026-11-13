<?php
declare(strict_types=1);
final class LegacyRunner {
    public static function run(string $script): array {
        $root = dirname(__DIR__, 2);
        $process = proc_open([PHP_BINARY, $root . '/tests/' . $script], [0 => ['pipe','r'], 1 => ['pipe','w'], 2 => ['redirect',1]], $pipes, $root);
        if (!is_resource($process)) throw new RuntimeException('Cannot start legacy suite.');
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        $output = ''; $start = microtime(true); $exit = -1;
        while (true) {
            $output .= stream_get_contents($pipes[1]);
            $status = proc_get_status($process);
            if (!$status['running']) { $exit = $status['exitcode']; break; }
            if (microtime(true) - $start > 600) {
                proc_terminate($process); $output .= "\nSuite timed out after 600 seconds."; $exit = 124; break;
            }
            usleep(20000);
        }
        $output .= stream_get_contents($pipes[1]); fclose($pipes[1]); proc_close($process);
        // Never include credentials in PHPUnit failure output or JUnit reports.
        foreach (['TEST_DB_PASS', 'DB_PASS'] as $key) {
            $secret = getenv($key);
            if ($secret !== false && $secret !== '') $output = str_replace($secret, '[REDACTED]', $output);
        }
        return [$exit, $output];
    }
}
