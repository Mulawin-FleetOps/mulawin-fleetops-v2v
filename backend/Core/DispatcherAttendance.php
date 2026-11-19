<?php
declare(strict_types=1);
core('DispatcherScope');
core('CrewAttendance');

final class DispatcherAttendance {
    /**
     * Dispatcher attendance day is 06:00–05:59 Philippine time, independent
     * of the configurable Day / Night reporting shift labels.
     */
    public static function dutyDate(?DateTimeImmutable $at = null): string {
        $at ??= new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
        return $at->setTimezone(new DateTimeZone('Asia/Manila'))
            ->modify('-6 hours')->format('Y-m-d');
    }
    public static function ready(PDO $p): bool {
        return (bool)one($p,"SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dispatcher_attendance_sessions'");
    }
    public static function current(PDO $p, int $id, bool $lock = false): ?array {
        return one($p,'SELECT * FROM dispatcher_attendance_sessions WHERE personnel_id=? AND time_out IS NULL' . ($lock?' FOR UPDATE':''),[$id]);
    }
    public static function isCurrent(array $session, array $shift): bool {
        return empty($session['time_out']); // Open sessions do not expire at shift boundaries or midnight.
    }
    public static function absent(PDO $p,int $id,?array $session=null,bool $lock=false): bool {
        $since=$session['time_in']??date('Y-m-d').' 00:00:00';
        // Admin daily attendance (attendance_daily) is the Absent authority; a back-dated mark for an earlier date does not apply.
        $mark=one($p,'SELECT status FROM attendance_daily WHERE personnel_id=? AND marked_at>=? AND duty_date>=DATE(?) ORDER BY marked_at DESC,id DESC LIMIT 1'.($lock?' LOCK IN SHARE MODE':''),[$id,$since,$since]);
        return ($mark['status']??null)==='Absent';
    }
    /** Resolve the operational group from an employee's verified regular truck links.
     * A multi-type dispatcher records attendance for the actual truck group,
     * not an arbitrary primary login role. */
    private static function personnelGroup(PDO $p, array $u, int $id): string {
        $hasGroup=DispatcherScope::attendanceGroupReady($p);
        $person=one($p,'SELECT person_type'.($hasGroup?', attendance_group':'').' FROM personnel WHERE id=?',[$id]);
        must((bool)$person,'Personnel record was not found.',404);
        if($person['person_type']==='Driver'){
            $rows=many($p,'SELECT DISTINCT v.truck_type FROM driver_truck_authorizations da
                JOIN vehicles v ON v.id=da.vehicle_id
                WHERE da.driver_id=? AND v.active=1 ORDER BY v.truck_type',[$id]);
        }else{
            $rows=many($p,'SELECT DISTINCT v.truck_type FROM vehicles v
                WHERE v.active=1 AND v.assigned_helper_id=? ORDER BY v.truck_type',[$id]);
        }
        $groups=array_values(array_unique(array_map(fn($v)=>dispatcherRoleFor((string)$v['truck_type']),$rows)));
        $types=DispatcherScope::types($u);
        // A Driver may be authorized for both operational groups but may only
        // have one active Time In session. Use the currently scoped group.
        $requested=$u['role'];
        if(in_array($requested,$groups,true))return $requested;
        if ($groups) {
            must((bool)array_filter($rows,fn($v)=>in_array($v['truck_type'],$types,true)),
                'Personnel is outside this Dispatcher account.',403);
        }
        if (!$groups && in_array($person['attendance_group'] ?? null, ['car_carrier_dispatcher', 'container_wingvan_dispatcher'], true)) {
            must(in_array($person['attendance_group'], array_map('dispatcherRoleFor', $types), true),
                'Personnel attendance group is outside this Dispatcher account.', 403);
            return $person['attendance_group'];
        }
        must(count($groups)===1,'Select an authorized operational group before recording attendance.',409);
        return $groups[0];
    }
    public static function blocker(PDO $p, array $u, int $id, ?int $tripId = null, bool $lock = false): ?string {
        $pe=DispatcherScope::attendancePerson($p,$u,$id,$lock);
        if(!(int)$pe['active'])return 'Personnel record is inactive.';
        if(!self::ready($p))return 'Dispatcher attendance migration has not been installed.';
        $session=self::current($p,$id,$lock);
        $groupRole=self::personnelGroup($p,$u,$id);
        if(!$session||!self::isCurrent($session,[])||$session['dispatcher_role']!==$groupRole)return $pe['full_name'].' must have an open Time In session in this operational group.';
        if(self::absent($p,$id,$session,$lock))return $pe['full_name'].' is marked Absent; the authorized attendance record must be corrected.';
        core('FleetState');$reason=FleetState::personBlocker($p,$id,$tripId);
        return $reason&&str_contains($reason,' is already on ')?$pe['full_name'].' is held by another active trip.':$reason;
    }
    public static function read(array $u, array $q=[]): array {
        DispatcherScope::types($u);$p=db();[$scope,$args]=DispatcherScope::attendancePersonnelSql($u, 'pe', $p);$ready=self::ready($p);
        $rows=many($p,"SELECT pe.id,pe.full_name,pe.person_type,pe.duty_shift,pe.availability,
            (CASE WHEN pe.person_type='Driver' THEN EXISTS(
                SELECT 1 FROM driver_truck_authorizations da JOIN vehicles av ON av.id=da.vehicle_id
                WHERE da.driver_id=pe.id AND av.active=1)
              ELSE EXISTS(SELECT 1 FROM vehicles v WHERE v.active=1 AND v.assigned_helper_id=pe.id)
            END) AS has_truck_link,
            EXISTS(SELECT 1 FROM trip_assignments a WHERE a.resource_type='person' AND a.resource_id=pe.id) AS assigned FROM personnel pe WHERE pe.active=1 $scope ORDER BY pe.person_type,pe.full_name",$args);
        $shift=CrewAttendance::shiftFor();
        $attendanceDate=self::dutyDate();
        core('FleetState');
        foreach($rows as &$r){
            try { $groupRole=self::personnelGroup($p,$u,(int)$r['id']); }
            catch (BusinessRuleException $e) { $groupRole=null; }
            $s=($ready&&$groupRole)?one($p,'SELECT id,time_in,time_out,duty_date,duty_shift FROM dispatcher_attendance_sessions WHERE personnel_id=? AND dispatcher_role=? ORDER BY id DESC LIMIT 1',[$r['id'],$groupRole]):null;
            $foreignOpen=$ready&&$groupRole&&(bool)one($p,'SELECT 1 FROM dispatcher_attendance_sessions WHERE personnel_id=? AND dispatcher_role<>? AND time_out IS NULL',[$r['id'],$groupRole]);
            $r['assigned']=(bool)$r['assigned']||(bool)FleetState::personTrip($p,(int)$r['id']);
            // Keep an open session visible across midnight. A closed session from
            // an earlier duty date belongs in History, not today's action row.
            $closedToday=$s&&$s['time_out']&&$s['duty_date']===$attendanceDate;
            $shown=$s&&(!$s['time_out']||$closedToday)?$s:null;
            $r['session']=$shown;
            $r['attendance_status']=$shown?(!$shown['time_out']?'Timed In':'Timed Out'):'Not Timed In';
            $r['action']=$shown&&!$shown['time_out']?'Time Out':($closedToday?'Completed':'Time In');
            $r['can_record']=$ready&&$groupRole!==null&&($r['action']==='Time Out'?!$r['assigned']:($r['action']==='Time In'&&!self::absent($p,(int)$r['id'])));
            $r['action_reason']=$r['action']==='Completed'
                ?'Time In and Time Out are already recorded for this attendance date.'
                :($r['can_record']?'':($r['action']==='Time Out'?'Personnel are held by an active trip or returning vehicle.':'Admin attendance conflict must be corrected before Time In.'));
            if($groupRole===null){$r['action_reason']='Assign an authorized attendance group in the Driver / Helper masterlist before recording Time In.';}
            if($foreignOpen){$r['can_record']=false;$r['attendance_status']='Attendance review required';$r['action_reason']='An open attendance session requires authorized coordination before recording attendance in this group.';}
        }unset($r);
        return ['rows'=>$rows,'shift'=>$shift,'attendance_date'=>$attendanceDate,
            'reset_time'=>'06:00','schema_ready'=>$ready];
    }
    public static function history(array $u,array $d): array {
        DispatcherScope::types($u);$id=idField($d,'personnel_id');$p=db();$pe=DispatcherScope::attendancePerson($p,$u,$id);
        must(self::ready($p),'Install the Dispatcher attendance migration first.',409);
        $groupRole=self::personnelGroup($p,$u,$id);
        return ['person'=>$pe,'sessions'=>many($p,'SELECT s.id,s.duty_date,s.duty_shift,s.time_in,s.time_out,iu.full_name AS timed_in_by_name,ou.full_name AS timed_out_by_name FROM dispatcher_attendance_sessions s JOIN users iu ON iu.id=s.timed_in_by LEFT JOIN users ou ON ou.id=s.timed_out_by WHERE s.personnel_id=? AND s.dispatcher_role=? ORDER BY s.id DESC LIMIT 500',[$id,$groupRole])];
    }
    /**
     * Bulk checklist uses exactly the same validation and authorization as an
     * individual Time In / Time Out. Either all rows succeed, or none do.
     */
    public static function batch(array $u,array $d): array {
        DispatcherScope::types($u);
        $action=choiceField($d,'operation',['time_in','time_out']);
        $items=$d['items']??null;
        must(is_array($items)&&count($items)>=1&&count($items)<=50,'Select between 1 and 50 eligible personnel.');
        $batchKey=strtolower(field($d,'request_key',36));
        must((bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/',$batchKey),
            'Invalid attendance request key.');
        $ids=[];
        foreach($items as $item){
            must(is_array($item),'Invalid checklist entry.');
            $id=idField($item,'personnel_id');
            must(!isset($ids[$id]),'The checklist contains duplicate personnel.',409);
            $ids[$id]=$item;
        }
        ksort($ids,SORT_NUMERIC); // consistent locking order across concurrent checklists
        return transaction(function(PDO $p)use($u,$action,$ids,$batchKey,$d){
            $count=0;
            foreach($ids as $id=>$item){
                $hash=hash('sha256',$batchKey.':'.$action.':'.$id);
                $key=substr($hash,0,8).'-'.substr($hash,8,4).'-4'.substr($hash,13,3).'-a'.substr($hash,17,3).'-'.substr($hash,20,12);
                $payload=['personnel_id'=>$id,'request_key'=>$key];
                if($action==='time_in'){
                    $payload['time_in_at']=$d['time_in_at']??null;
                }else{
                    $payload['session_id']=idField($item,'session_id');
                }
                self::record($u,$action,$payload);
                $count++;
            }
            return ['message'=>$count.' attendance record'.($count===1?'':'s').' saved successfully.','count'=>$count];
        });
    }
    public static function record(array $u,string $action,array $d): array {
        DispatcherScope::types($u);must(in_array($action,['time_in','time_out'],true),'Unknown attendance operation.',404);
        $id=idField($d,'personnel_id');$key=strtolower(field($d,'request_key',36));
        must((bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/',$key),'Invalid attendance request key.');
        return transaction(function(PDO $p)use($u,$action,$id,$key,$d){
            $pe=DispatcherScope::attendancePerson($p,$u,$id,true);must((int)$pe['active']===1,'Personnel record is inactive.',409);
            $groupRole=self::personnelGroup($p,$u,$id);
            must(self::ready($p),'Install the Dispatcher attendance migration first.',409);
            $column=$action==='time_in'?'request_key':'time_out_key';$old=one($p,"SELECT id,personnel_id,dispatcher_role FROM dispatcher_attendance_sessions WHERE $column=?",[$key]);
            if($old){must((int)$old['personnel_id']===$id&&$old['dispatcher_role']===$groupRole,'Request key belongs to another record.',409);return ['message'=>'Attendance operation was already recorded.','session_id'=>$old['id'],'duplicate'=>true];}
            $s=self::current($p,$id,true);$shift=CrewAttendance::shiftFor();
            if($action==='time_in'){
                // The Dispatcher may record the actual arrival time instead of
                // always accepting the server clock. Legacy clients can omit it.
                $selected = $d['time_in_at'] ?? null;
                $timeIn = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
                if ($selected !== null) {
                    must(is_string($selected) && preg_match('/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$/D', $selected) === 1,
                        'Select a valid Time In date and time.', 400);
                    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d\\TH:i', $selected, new DateTimeZone('Asia/Manila'));
                    must($parsed !== false && $parsed->format('Y-m-d\\TH:i') === $selected,
                        'Select a valid Time In date and time.', 400);
                    must($parsed <= $timeIn, 'Time In cannot be in the future.', 409);
                    must($parsed >= $timeIn->modify('-24 hours'),
                        'Time In can be recorded for the past 24 hours only.', 409);
                    $timeIn = $parsed;
                }
                $shift = CrewAttendance::shiftFor($timeIn->getTimestamp());
                $attendanceDate = self::dutyDate($timeIn);
                must($attendanceDate === self::dutyDate(),
                    'Time In must be within the current attendance day (6:00 AM to 5:59 AM Philippine time).',409);
                must(!$s,'There is already an open attendance session. Refresh the roster.',409);
                // Locking the personnel row above serializes attempts; one
                // attendance cycle is allowed per person and duty date.
                must(!one($p,'SELECT id FROM dispatcher_attendance_sessions WHERE personnel_id=? AND duty_date=? LIMIT 1',
                    [$id,$attendanceDate]),
                    'Time In and Time Out have already been recorded for this attendance date.',409);
                // An earlier selected time must not bypass a current Absent
                // mark, nor an Absent mark recorded after the chosen arrival.
                must(!self::absent($p,$id,null,true)
                    && !self::absent($p,$id,['time_in'=>$timeIn->format('Y-m-d H:i:s')],true),
                    'Personnel is marked Absent for this shift; an authorized correction is required.',409);
                $latest=one($p,'SELECT time_out FROM dispatcher_attendance_sessions WHERE personnel_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[$id]);
                must(!$latest || ($latest['time_out'] !== null && $latest['time_out'] <= $timeIn->format('Y-m-d H:i:s')),
                    'Time In must be after the preceding Time Out.',409);
                run($p,'INSERT INTO dispatcher_attendance_sessions(personnel_id,dispatcher_role,duty_date,duty_shift,time_in,timed_in_by,request_key) VALUES(?,?,?,?,?,?,?)',
                    [$id,$groupRole,$attendanceDate,$shift['shift'],$timeIn->format('Y-m-d H:i:s'),$u['id'],$key]);$sessionId=(int)$p->lastInsertId();
            }else{
                must($s&&(int)$s['id']===idField($d,'session_id'),'This attendance session has changed. Refresh the roster.',409);
                must($s['dispatcher_role']===$groupRole,'This session belongs to another operational group.',403);
                core('FleetState');
                must(!FleetState::personTrip($p,$id,null,true),'Time Out is blocked while personnel are held by an active trip or returning vehicle.',409);
                run($p,'UPDATE dispatcher_attendance_sessions SET time_out=NOW(),timed_out_by=?,time_out_key=? WHERE id=? AND time_out IS NULL',[$u['id'],$key,$s['id']]);$sessionId=(int)$s['id'];
            }
            audit($p,$u['id'],'Attendance','personnel '.$id,$action==='time_in'?'dispatcher time in':'dispatcher time out','Session #'.$sessionId.'; '.$shift['date'].' '.$shift['shift']);
            return ['message'=>$action==='time_in'?'Time In recorded.':'Time Out recorded. Attendance is complete until the next 6:00 AM reset.','session_id'=>$sessionId];
        });
    }
}
