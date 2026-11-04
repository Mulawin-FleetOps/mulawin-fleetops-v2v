<?php
/*
 * =====================================================================
 *  backend/Modules/Maintenance/Mechanics.php  —  MECHANIC MASTERLIST
 * =====================================================================
 *  Supports Corrective Maintenance only: repairs are assigned to a mechanic
 *  chosen from this list.
 *   - Mechanic ID (MEC-001) is given by the system; the full name is unique.
 *   - Availability: Available | Assigned (has an active repair, set by the
 *     system) | Unavailable (set by hand with a reason, e.g. on leave).
 *   - A mechanic can hold only one active repair (database rule), so an
 *     Assigned or Unavailable mechanic cannot receive a new repair.
 *   - Deactivate instead of delete: the repair history is kept.
 *  Manage: Admin, Motorpool Custodian. View: Operations Head, Audit.
 *  Mechanics do not log in (no separate role is needed by the objectives).
 * =====================================================================
 */
declare(strict_types=1);

final class Mechanics {
    private const EDIT = ['admin', 'motorpool'];

    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $data = readSections([
            'mechanics' => fn() => many($p, "SELECT mc.*, m.id AS job_id, m.job_ref, m.status AS job_status, v.plate_number AS job_truck,
                    (SELECT COUNT(*) FROM maintenance_jobs x WHERE x.mechanic_id=mc.id AND x.status='Completed') AS completed_jobs
                FROM mechanics mc LEFT JOIN maintenance_jobs m ON m.active_mechanic=mc.id LEFT JOIN vehicles v ON v.id=m.vehicle_id
                ORDER BY mc.active DESC, mc.full_name"),
        ]);
        $data['can'] = ['edit' => hasRole($u, ...self::EDIT)];
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'save' => self::save($u, $d),
            'availability' => self::availability($u, $d),
            'set_active' => self::setActive($u, $d),
            'details' => self::details($u, $d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    private static function save(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = optId($d, 'id');
        $row = ['full_name' => preg_replace('/\s+/', ' ', field($d, 'full_name', 100)),
                'contact_number' => optField($d, 'contact_number', 40),
                'specialization' => optField($d, 'specialization', 150),
                'notes' => optField($d, 'notes', 255)];
        if ($row['contact_number'] !== null) must((bool)preg_match('/^[0-9+()\-\s]{7,40}$/', $row['contact_number']), 'Contact number: digits, spaces, + ( ) - only.');
        return transaction(function (PDO $p) use ($u, $id, $row) {
            must(!one($p, 'SELECT id FROM mechanics WHERE full_name=? AND id<>?', [$row['full_name'], $id ?? 0]), 'A mechanic named ' . $row['full_name'] . ' is already in the masterlist.', 409);
            if ($id) {
                must((bool)one($p, 'SELECT id FROM mechanics WHERE id=? FOR UPDATE', [$id]), 'Mechanic not found.', 404);
                $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
                run($p, "UPDATE mechanics SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
                audit($p, $u['id'], 'Mechanics', 'mechanic ' . $id, 'mechanic updated', $row['full_name']);
                return ['id' => $id, 'message' => 'Mechanic information updated.'];
            }
            $id = insert($p, 'mechanics', ['mechanic_code' => 'TMP-' . bin2hex(random_bytes(4))] + $row);
            $code = 'MEC-' . str_pad((string)$id, 3, '0', STR_PAD_LEFT);
            run($p, 'UPDATE mechanics SET mechanic_code=? WHERE id=?', [$code, $id]);
            audit($p, $u['id'], 'Mechanics', 'mechanic ' . $id, 'mechanic added', "$code " . $row['full_name']);
            return ['id' => $id, 'mechanic_code' => $code, 'message' => "Mechanic $code " . $row['full_name'] . ' added. Status: Available.'];
        });
    }

    /** Manual availability: Available or Unavailable (with reason). Assigned is set by the system. */
    private static function availability(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id');
        $to = choiceField($d, 'availability', ['Available', 'Unavailable']);
        $reason = $to === 'Unavailable' ? field($d, 'reason', 150) : null;
        return transaction(function (PDO $p) use ($u, $id, $to, $reason) {
            $m = one($p, 'SELECT * FROM mechanics WHERE id=? FOR UPDATE', [$id]);
            must($m && (int)$m['active'], 'Mechanic not found or inactive.', 404);
            $job = one($p, 'SELECT job_ref FROM maintenance_jobs WHERE active_mechanic=?', [$id]);
            if ($to === 'Unavailable') {
                must(!$job, $m['full_name'] . ' is working on ' . ($job['job_ref'] ?? '') . '. Assign that repair to another mechanic first.', 409);
                run($p, "UPDATE mechanics SET availability='Unavailable', unavailable_reason=? WHERE id=?", [$reason, $id]);
            } else {
                run($p, 'UPDATE mechanics SET availability=?, unavailable_reason=NULL WHERE id=?', [$job ? 'Assigned' : 'Available', $id]);
            }
            audit($p, $u['id'], 'Mechanics', 'mechanic ' . $id, 'mechanic availability set', $m['full_name'] . ': ' . $to . ($reason ? " ($reason)" : ''));
            return ['message' => $m['full_name'] . ' is now ' . ($to === 'Available' && $job ? 'Assigned (still on ' . $job['job_ref'] . ')' : $to) . '.'];
        });
    }

    private static function setActive(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id'); $active = !empty($d['active']) ? 1 : 0;
        return transaction(function (PDO $p) use ($u, $id, $active) {
            $m = one($p, 'SELECT * FROM mechanics WHERE id=? FOR UPDATE', [$id]);
            must((bool)$m, 'Mechanic not found.', 404);
            if (!$active) {
                $job = one($p, 'SELECT job_ref FROM maintenance_jobs WHERE active_mechanic=?', [$id]);
                must(!$job, $m['full_name'] . ' is working on ' . ($job['job_ref'] ?? '') . '. Assign that repair to another mechanic first.', 409);
            }
            run($p, "UPDATE mechanics SET active=?, availability=IF(?=1 AND availability='Assigned', 'Available', availability) WHERE id=?", [$active, $active, $id]);
            audit($p, $u['id'], 'Mechanics', 'mechanic ' . $id, $active ? 'mechanic reactivated' : 'mechanic deactivated', $m['full_name']);
            return ['message' => $m['full_name'] . ($active ? ' is active again.' : ' was deactivated. The repair history is kept.')];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'mechanics'), 'Not allowed.', 403);
        $id = idField($d, 'id'); $p = db();
        $m = one($p, 'SELECT * FROM mechanics WHERE id=?', [$id]);
        must((bool)$m, 'Mechanic not found.', 404);
        return [
            'mechanic' => $m,
            'jobs' => many($p, "SELECT m.id, m.job_ref, m.source, m.problem, m.status, m.reported_on, m.completed_on, v.plate_number
                FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id
                WHERE m.mechanic_id=? OR m.id IN (SELECT maintenance_job_id FROM maintenance_events WHERE mechanic_id=?)
                ORDER BY m.id DESC LIMIT 50", [$id, $id]),
        ];
    }
}
