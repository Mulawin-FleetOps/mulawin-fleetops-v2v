<?php
/**
 * Small SQL statement splitter for FleetOps migration files.
 * Does not run SQL or contact a database.
 *
 * Supports line/block comments, quotes, escaped quotes and semicolons in strings.
 * MySQL client commands (DELIMITER / SOURCE) and stored routines are deliberately
 * unsupported: review those manually instead of silently misparsing them.
 */
declare(strict_types=1);

function migrationSqlStatements(string $sql): array
{
    $statements = [];
    $buffer = '';
    $quote = '';
    $lineComment = false;
    $blockComment = false;
    $length = strlen($sql);

    for ($i = 0; $i < $length; $i++) {
        $char = $sql[$i];
        $next = $i + 1 < $length ? $sql[$i + 1] : '';

        if ($lineComment) {
            if ($char === "\n" || $char === "\r") {
                $lineComment = false;
                $buffer .= "\n";
            }
            continue;
        }
        if ($blockComment) {
            if ($char === '*' && $next === '/') {
                $blockComment = false;
                $i++;
                $buffer .= ' ';
            }
            continue;
        }
        if ($quote !== '') {
            $buffer .= $char;
            if ($char === chr(92) && $next !== '') {
                $buffer .= $next;
                $i++;
            } elseif ($char === $quote) {
                if ($next === $quote) {
                    $buffer .= $next;
                    $i++;
                } else {
                    $quote = '';
                }
            }
            continue;
        }

        if ($char === '-' && $next === '-' && ($i + 2 === $length || ctype_space($sql[$i + 2]))) {
            $lineComment = true;
            $i++;
            $buffer .= ' ';
            continue;
        }
        if ($char === '#') {
            $lineComment = true;
            $buffer .= ' ';
            continue;
        }
        if ($char === '/' && $next === '*') {
            $blockComment = true;
            $i++;
            $buffer .= ' ';
            continue;
        }
        if ($char === "'" || $char === '"' || $char === '`') {
            $quote = $char;
            $buffer .= $char;
            continue;
        }
        if ($char === ';') {
            if (trim($buffer) !== '') $statements[] = trim($buffer);
            $buffer = '';
            continue;
        }
        $buffer .= $char;
    }

    if ($quote !== '' || $blockComment) {
        throw new RuntimeException('Unclosed quote or block comment in SQL migration.');
    }
    if (trim($buffer) !== '') $statements[] = trim($buffer);

    foreach ($statements as $statement) {
        if (preg_match('/^\s*(DELIMITER|SOURCE)\b/i', $statement)) {
            throw new RuntimeException('MySQL client directives are not supported in migrations.');
        }
        if (preg_match('/^\s*CREATE\s+(?:DEFINER\s*=\s*[^ ]+\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i', $statement)) {
            throw new RuntimeException('Stored routines/triggers are not supported by this SQL splitter.');
        }
    }
    return $statements;
}
