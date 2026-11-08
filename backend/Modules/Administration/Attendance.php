<?php
/* CHECKLIST_42_ATTENDANCE_PHASE1_V1: Admin-only attendance record; not availability. */
declare(strict_types=1);
core('Notify');
core('Settings');
core('CrewAttendance');

final class Attendance {
    private static function dateValue(array $d): string {
        $date = (string)($d['duty_date'] ?? date('Y-m-d'));
        $v = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        must($v && $v->format('Y-m-d') === $date, 'Invalid attendance date.');
        must($date <= date('Y-m-d'), 'Cannot mark future attendance.', 409);
        return $date;
    }
    private static function group(array $d): array {
        $kind = choiceField($d, 'kind', ['Driver', 'Mechanic']);
        $shift = choiceField($d, 'duty_shift', ['Day', 'Night']);
        return [$kind,$shift];
    }
    private static function roster(PDO $p, string $kind, string $shift, string $date): array {
        if ($kind === 'Driver') {
            // CHECKLIST_42_ATTENDANCE_PHASE2_V1: the crew roster ('Driver' kind, kept for compatibility) lists drivers AND helpers.
            return many($p, "SELECT pe.id, pe.full_name, pe.person_type, pe.availability, am.status, am.marked_at
              FROM personnel pe LEFT JOIN attendance_marks am ON am.personnel_id=pe.id AND am.duty_date=? AND am.duty_shift=?
              WHERE pe.active=1 AND pe.person_type IN ('Driver','Helper') AND pe.duty_shift=? ORDER BY pe.person_type, pe.full_name", [$date,$shift,$shift]);
        }
        return many($p, "SELECT mc.id, mc.full_name, mc.availability, am.status, am.marked_at
          FROM mechanics mc LEFT JOIN attendance_marks am ON am.mechanic_id=mc.id AND am.duty_date=? AND am.duty_shift=?
          WHERE mc.active=1 AND mc.duty_shift=? ORDER BY mc.full_name", [$date,$shift,$shift]);
    }
    public static function action(array $u, string $action, array $d): array {
        requireRole($u, 'admin');
        return match ($action) {
            'list' => self::listing($d),
            'save' => self::save($u,$d),
            default => throw new BusinessRuleException('Unknown attendance action.',404),
        };
    }
    private static function listing(array $d): array {
        $date=self::dateValue($d); [$kind,$shift]=self::group($d);
        $rows=self::roster(db(),$kind,$shift,$date);
        return ['rows'=>$rows,'date'=>$date,'shift'=>$shift,'kind'=>$kind,
          'marked'=>count(array_filter($rows,fn($r)=>$r['status']!==null)),'total'=>count($rows),
          // Phase 2 preparation: crew without a shift are in no roster; Admin assigns their shift in the Masterlist.
          'unassigned'=>$kind==='Driver' ? CrewAttendance::unassignedCrew(db()) : []];
    }
    private static function save(array $u,array $d): array {
        $date=self::dateValue($d); [$kind,$shift]=self::group($d);
        $items=$d['items']??null;
        must(is_array($items) && count($items)<=1000,'Invalid attendance checklist.');
        return transaction(function(PDO $p) use ($u,$date,$kind,$shift,$items) {
            $rows=self::roster($p,$kind,$shift,$date);
            $valid=array_fill_keys(array_map(fn($r)=>(int)$r['id'],$rows),true);
            $column=$kind==='Driver'?'personnel_id':'mechanic_id';
            $seen=[]; $count=0;
            foreach($items as $item) {
                must(is_array($item),'Invalid attendance record.');
                $id=(int)($item['id']??0);
                must($id>0 && isset($valid[$id]) && !isset($seen[$id]),'Unknown, duplicated or wrong-shift staff.',409);
                $seen[$id]=true;
                $value=$item['status']??null;
                must(in_array($value,['Present','Absent',null],true),'Attendance must be Present, Absent or blank.');
                $old=one($p,"SELECT id,status FROM attendance_marks WHERE duty_date=? AND duty_shift=? AND $column=? FOR UPDATE",[$date,$shift,$id]);
                if ($value===null) {
                    if($old){run($p,'DELETE FROM attendance_marks WHERE id=?',[$old['id']]); audit($p,$u['id'],'Attendance',strtolower($kind).' '.$id,"$date $shift attendance cleared");}
                } elseif($old) {
                    if ($old['status']!==$value) {run($p,'UPDATE attendance_marks SET status=?,marked_by=?,marked_at=NOW() WHERE id=?',[$value,$u['id'],$old['id']]);
                      auditWithChanges($p,$u['id'],'Attendance',strtolower($kind).' '.$id,'attendance updated',"$date $shift",['Status'=>$old['status']],['Status'=>$value]);}
                } else {
                    run($p,"INSERT INTO attendance_marks (duty_date,duty_shift,$column,status,marked_by) VALUES (?,?,?,?,?)",[$date,$shift,$id,$value,$u['id']]);
                    auditWithChanges($p,$u['id'],'Attendance',strtolower($kind).' '.$id,'attendance marked',"$date $shift",[],['Status'=>$value]);
                }
                if($value!==null)$count++;
            }
            // A full roster must be submitted; otherwise partial saving might hide pending people.
            must(count($items)===count($rows),'The roster changed. Reload Attendance and try again.',409);
            if($count===count($rows)) Notify::resolve($p,'att-'.$date.'-'.$shift.'-'.$kind);
            return ['message'=>"$kind $shift attendance saved ($count/".count($rows)." marked)."];
        });
    }
    /** Refresh-safe bell reminder. Requires an Admin session and runs after configured shift start. */
    public static function remind(PDO $p): void {
        // Every shift that has started today plus the shift in progress (a shift that crossed midnight keeps
        // its start date). Same boundaries as CrewAttendance::shiftFor for both start-hour orderings.
        $due=CrewAttendance::dueShifts();
        $noShift=count(CrewAttendance::unassignedCrew($p));
        if ($noShift>0) Notify::roles($p,['admin'],'Shift not assigned',"$noShift active driver(s)/helper(s) have no Day/Night shift and cannot be marked in Attendance. Assign their shift in the Drivers & Helpers masterlist.",'crew','att-noshift');
        else Notify::resolve($p,'att-noshift');
        foreach ($due as [$shift,$date]) {
            foreach (['Driver','Mechanic'] as $kind) {
                $rows=self::roster($p,$kind,$shift,$date);
                $missing=count(array_filter($rows,fn($r)=>$r['status']===null));
                if($missing>0) Notify::roles($p,['admin'],'Attendance required',"$shift shift: $missing ".($kind==='Driver'?'crew (driver/helper)':$kind)." attendance record(s) not marked for $date.",$kind==='Driver'?'crew':'mechanics','att-'.$date.'-'.$shift.'-'.$kind);
                else Notify::resolve($p,'att-'.$date.'-'.$shift.'-'.$kind);
            }
        }
    }
}
