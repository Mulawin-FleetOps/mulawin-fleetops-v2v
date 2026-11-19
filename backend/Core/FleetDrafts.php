<?php
/* Account-owned unfinished fleet forms. No draft ever creates an operational record. */
declare(strict_types=1);

final class FleetDrafts {
    private const TYPES = ['driver','helper','truck'];
    private const FIELDS = [
        'driver' => ['full_name','person_type','attendance_group','employee_no','contact_number','date_hired',
            'license_number','license_expiry','address','notes','auth_truck','regular_helper_choice'],
        'helper' => ['full_name','person_type','attendance_group','employee_no','contact_number','date_hired',
            'license_number','license_expiry','address','notes'],
        'truck' => ['plate_number','truck_type','truck_number','make_brand','model','mv_file_number',
            'chassis_number','engine_number','or_number','cr_number','registration_expiry',
            'insurance_provider','insurance_policy_number','insurance_expiry','notes'],
    ];

    private static function ready(PDO $p): bool {
        return (bool)one($p, "SELECT 1 AS ok FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fleet_form_drafts'");
    }

    public static function action(array $u, string $action, array $d): array {
        requireRole($u, 'operations_head');
        $p = db();
        must(self::ready($p), 'Fleet drafts migration is not installed yet.', 503);
        $type = (string)($d['draft_type'] ?? '');
        must(in_array($type, self::TYPES, true), 'Unknown fleet draft type.', 422);
        $owner = (int)$u['id'];
        if ($action === 'draft_get') {
            $row = one($p, 'SELECT id,fields_json,updated_at FROM fleet_form_drafts
                WHERE owner_id=? AND draft_type=? LIMIT 1', [$owner,$type]);
            if (!$row) return ['draft'=>null];
            $fields = json_decode((string)$row['fields_json'], true);
            return ['draft'=>['id'=>(int)$row['id'],'fields'=>is_array($fields)?$fields:[],
                'updated_at'=>$row['updated_at']]];
        }
        if ($action === 'draft_save') {
            $fields = $d['fields'] ?? null;
            must(is_array($fields), 'Invalid draft fields.', 422);
            $allowed = self::FIELDS[$type];
            $clean = [];
            foreach ($fields as $key => $value) {
                must(is_string($key) && strlen($key) <= 80 && in_array($key,$allowed,true),
                    'Unsupported draft field.', 422);
                must(is_string($value) && strlen($value) <= 1000, 'Draft field is too long.', 422);
                $clean[$key] = $value;
            }
            must(count($clean) <= 32, 'Too many draft fields.', 422);
            $json = json_encode($clean, JSON_THROW_ON_ERROR);
            run($p, 'INSERT INTO fleet_form_drafts(owner_id,draft_type,fields_json) VALUES(?,?,?)
                ON DUPLICATE KEY UPDATE fields_json=VALUES(fields_json),updated_at=CURRENT_TIMESTAMP',
                [$owner,$type,$json]);
            $saved = one($p, 'SELECT id,updated_at FROM fleet_form_drafts
                WHERE owner_id=? AND draft_type=?', [$owner,$type]);
            return ['draft_id'=>(int)$saved['id'],'updated_at'=>$saved['updated_at'],
                'message'=>'Draft saved. You can continue it later.'];
        }
        if ($action === 'draft_discard') {
            run($p, 'DELETE FROM fleet_form_drafts WHERE owner_id=? AND draft_type=?', [$owner,$type]);
            return ['message'=>'Draft discarded.'];
        }
        throw new BusinessRuleException('Unknown draft action.', 404);
    }

    /** Called only after the actual masterlist record has passed validation and saved. */
    public static function complete(PDO $p, array $u, array $d, string $type): void {
        $id = $d['draft_id'] ?? '';
        if ($id === '' || $id === null) return;
        must(ctype_digit((string)$id) && (int)$id > 0, 'Invalid draft reference.', 422);
        must(self::ready($p), 'Fleet drafts are not installed.', 503);
        run($p, 'DELETE FROM fleet_form_drafts WHERE id=? AND owner_id=? AND draft_type=?',
            [(int)$id,(int)$u['id'],$type]);
    }
}
