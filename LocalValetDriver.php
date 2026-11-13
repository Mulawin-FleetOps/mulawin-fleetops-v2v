<?php
declare(strict_types=1);

/** Project-only Herd routing. Nginx does not process the Apache .htaccess files. */
final class LocalValetDriver extends \Valet\Drivers\ValetDriver
{
    public function serves(string $sitePath, string $siteName, string $uri): bool
    {
        return is_file($sitePath . '/public/index.php');
    }

    private function safePath(string $uri): string
    {
        $path = str_replace('\\', '/', rawurldecode($uri));
        if (str_contains($path, "\0")
            || preg_match('~(^|/)\.(?!well-known(?:/|$))~i', $path)
            || preg_match('~^/(backend|config|database|docs|scripts|storage|tests|automation)(/|$)~i', $path)
            || preg_match('~\.(sql|log|txt|md|csv|json|py|bat|bak)$~i', $path)) {
            http_response_code(403);
            exit('Forbidden');
        }
        return $path;
    }

    public function isStaticFile(string $sitePath, string $siteName, string $uri): string|false
    {
        $path = $this->safePath($uri);
        $root = str_replace('\\', '/', (string) realpath($sitePath . '/public'));
        $file = realpath($root . $path);
        if ($file === false || !is_file($file)) return false;
        $file = str_replace('\\', '/', $file);
        if (!str_starts_with(strtolower($file), strtolower($root . '/'))) {
            http_response_code(403);
            exit('Forbidden');
        }
        // PHP is executed only through the explicit front-controller allowlist below.
        return preg_match('~\.(php\d*|phtml|phar)$~i', $file) ? false : $file;
    }

    public function frontControllerPath(string $sitePath, string $siteName, string $uri): ?string
    {
        $path = $this->safePath($uri);
        if (!in_array($path, ['/', '/index.php', '/install.php'], true)) {
            http_response_code(404);
            exit('Not found');
        }
        $script = $path === '/' ? '/index.php' : $path;
        $_SERVER['DOCUMENT_ROOT'] = $sitePath . '/public';
        $_SERVER['SCRIPT_FILENAME'] = $sitePath . '/public' . $script;
        $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = $script;
        return $_SERVER['SCRIPT_FILENAME'];
    }
}
