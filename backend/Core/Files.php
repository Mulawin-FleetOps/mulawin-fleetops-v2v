<?php
/*
 * =====================================================================
 *  backend/Core/Files.php  —  files sent together with a form
 * =====================================================================
 *  Used when a step REQUIRES supporting documents in the same save, for example:
 *    - client profile + signature + accreditation files (PDF #12 Scenario A step 2)
 *    - trip completion + waybill + acknowledgement receipt (PDF #12 step 11, PDF #13)
 *    - repair confirmation + photos / documents (PDF #12 Maintenance)
 *    - client payment + acknowledgement receipt (PDF #12 Accounting)
 *  Files are saved in storage/private with random names and listed in the
 *  documents table. If the transaction fails, the saved files are deleted
 *  (see transaction() in bootstrap.php), so no half-saved records remain.
 * =====================================================================
 */
declare(strict_types=1);

final class Files {
    public const MIME = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    public const MAX_BYTES = 10000000; // 10 MB per file

    /** Normalised list of uploaded files of one input name (single or multiple). */
    public static function list(string $field): array {
        $f = $_FILES[$field] ?? null;
        if (!is_array($f)) return [];
        $out = [];
        if (is_array($f['name'])) {
            foreach ($f['name'] as $i => $n) {
                if (($f['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
                $out[] = ['name' => $n, 'tmp_name' => $f['tmp_name'][$i], 'error' => $f['error'][$i], 'size' => $f['size'][$i]];
            }
        } elseif (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            $out[] = $f;
        }
        return $out;
    }

    public static function has(string $field): bool { return (bool)self::list($field); }

    /**
     * Saves every file of $field and links it to the record.
     * Must be called inside transaction(). Returns the new document ids.
     */
    public static function store(PDO $p, array $u, string $field, string $entityType, ?int $entityId, string $category,
                                 bool $required = false, string $label = '', ?string $expiresOn = null): array {
        $files = self::list($field);
        if ($required) must((bool)$files, 'Please attach: ' . ($label ?: $category) . '.');
        must(count($files) <= 20, 'Attach at most 20 files at a time.');
        $dir = dirname(__DIR__, 2) . '/storage/private';
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        $ids = [];
        foreach ($files as $file) {
            $name = basename((string)$file['name']);
            must(($file['error'] ?? 1) === UPLOAD_ERR_OK, 'Upload failed for ' . $name . '. Check the PHP upload size limit.');
            $bytes = (int)$file['size'];
            must($bytes > 0 && $bytes <= self::MAX_BYTES, $name . ' is empty or larger than 10 MB.');
            must(is_uploaded_file($file['tmp_name']) || (PHP_SAPI === 'cli' && is_file($file['tmp_name'])), 'Invalid upload.');
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
            must(isset(self::MIME[$mime]), 'Only PDF, JPG, PNG and WebP files are allowed (' . $name . ').');
            $storage = bin2hex(random_bytes(20)) . '.' . self::MIME[$mime];
            $target = $dir . '/' . $storage;
            $ok = is_uploaded_file($file['tmp_name']) ? move_uploaded_file($file['tmp_name'], $target) : copy($file['tmp_name'], $target);
            must($ok, 'Could not save the file. Check the folder permissions of storage/private.', 500);
            storedFiles($target);
            $ids[] = insert($p, 'documents', ['category' => $category, 'entity_type' => $entityType, 'entity_id' => $entityId,
                'original_filename' => cut($name, 220), 'storage_name' => $storage, 'mime_type' => $mime, 'byte_size' => $bytes,
                'expires_on' => $expiresOn, 'uploaded_by' => $u['id']]);
        }
        if ($ids) audit($p, $u['id'], 'Documents', $entityType . ' ' . ($entityId ?? ''), 'document uploaded', $category . ' x' . count($ids));
        return $ids;
    }

    /** Number of documents of a category linked to a record. */
    public static function count(PDO $p, string $entityType, int $entityId, string $category): int {
        return (int)one($p, 'SELECT COUNT(*) AS n FROM documents WHERE entity_type=? AND entity_id=? AND category=?', [$entityType, $entityId, $category])['n'];
    }

    /** Documents linked to a record (for detail screens). */
    public static function of(PDO $p, string $entityType, int $entityId): array {
        return many($p, 'SELECT d.id, d.category, d.original_filename, d.mime_type, d.byte_size, d.expires_on, d.created_at, u.full_name AS uploader
                         FROM documents d JOIN users u ON u.id=d.uploaded_by WHERE d.entity_type=? AND d.entity_id=? ORDER BY d.id', [$entityType, $entityId]);
    }
}
