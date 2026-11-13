<?php
declare(strict_types=1);
core('DispatcherScope');

/** Explicit account responsibility. Original trip planning and dispatch actors are untouched. */
final class DispatcherTurnover {
    public static function ready(PDO $p): bool {
        return (int)(one($p,"SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('trip_responsibilities','dispatcher_turnovers','dispatcher_turnover_trips')")['n']??0)===3;
    }
    private static function installed(PDO $p): void { must(self::ready($p),'Install and verify the additive Dispatcher turnover migration before using account responsibility.',409); }
    private static function account(PDO $p,int $id,?string $role=null,bool $lock=true): array {
        $u=one($p,'SELECT id,full_name,role,shift,active FROM users WHERE id=?'.($lock?' FOR UPDATE':''),[$id]);
        must($u&&(int)$u['active']===1&&roleIsDispatcher($u['role'])&&($role===null||$u['role']===$role),'Choose an active Dispatcher account in the same truck group.',403);
        return $u;
    }
    /** Explicit planning choice, rechecked under the account lock when the trip is saved. */
    public static function planningAccount(PDO $p,array $planning,int $id,bool $lock=true): array {
        self::installed($p);
        $account=self::account($p,$id,$planning['dispatcher_role'],$lock);
        must($account['shift']===$planning['dispatcher_shift'],'Choose an active responsible Dispatcher account matching the planned group and shift.',409);
        return $account;
    }
    private static function workSql(): string {
        return "(t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected') OR EXISTS(SELECT 1 FROM trip_assignments a WHERE a.trip_id=t.id AND a.resource_type='vehicle') OR EXISTS(SELECT 1 FROM incidents i WHERE i.trip_id=t.id AND i.status<>'Resolved'))";
    }
    /** Caller holds the target users row FOR UPDATE until its account change commits. */
    public static function guardAccountChange(PDO $p,int $id,bool $dispatcherRelated): void {
        must($p->inTransaction(),'Account safeguards require a transaction.',409);
        if(!self::ready($p)){
            must(!$dispatcherRelated,'Install and verify the Dispatcher turnover schema before deactivating a Dispatcher or changing its role/shift. Responsibility cannot be checked safely.',409);
            return;
        }
        // Locking reads see current committed state even if earlier account validation opened a snapshot.
        // Every initial assignment, endorsement and acceptance also locks the participant users rows.
        $pending=many($p,"SELECT id FROM dispatcher_turnovers WHERE status='Pending' AND (outgoing_id=? OR incoming_id=?) ORDER BY id LIMIT 5 FOR UPDATE",[$id,$id]);
        $work=many($p,'SELECT t.trip_ref FROM trips t JOIN trip_responsibilities r ON r.trip_id=t.id WHERE r.current_dispatcher_id=? AND '.self::workSql().' ORDER BY t.id LIMIT 5 FOR UPDATE',[$id]);
        $reasons=[];
        if($work)$reasons[]='outstanding trips: '.implode(', ',array_column($work,'trip_ref')).' (up to 5 shown)';
        if($pending)$reasons[]='pending turnovers: #'.implode(', #',array_column($pending,'id')).' (up to 5 shown)';
        must(!$reasons,'Account change blocked by '.implode('; ',$reasons).'. Keep both Dispatcher accounts active with their current role/shift. Complete normal Endorse → Accept for outstanding responsibility and resolve pending turnovers before retrying.',409);
    }
    private static function selectedIds(array $d): array {
        must(isset($d['trip_ids'])&&is_array($d['trip_ids'])&&array_is_list($d['trip_ids'])&&count($d['trip_ids'])>0,'Select at least one eligible trip.');
        $ids=[];foreach($d['trip_ids'] as $value){must((is_int($value)||is_string($value))&&preg_match('/^[1-9][0-9]*$/',(string)$value)&&filter_var($value,FILTER_VALIDATE_INT)!==false,'Invalid selected trip.');$ids[]=(int)$value;}
        must(count(array_unique($ids))===count($ids),'Duplicate trip selections are not allowed.');sort($ids,SORT_NUMERIC);return $ids;
    }
    private static function eligibleSql(): string {
        return "(t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected') OR (t.status='Completed' AND EXISTS(SELECT 1 FROM trip_assignments a WHERE a.trip_id=t.id AND a.resource_type='vehicle')))";
    }
    private static function eligible(PDO $p,array $t): bool {
        if(in_array($t['status'],['Pending Review','Cancelled','Rejected'],true))return false;
        return $t['status']!=='Completed'||(bool)one($p,"SELECT 1 FROM trip_assignments WHERE trip_id=? AND resource_type='vehicle'",[$t['id']]);
    }
    private static function summary(PDO $p,?int $account,bool $lock=false,?array $ids=null,bool $eligibleOnly=true): array {
        if($ids===[])return [];
        $where=[];$args=[];if($account!==null){$where[]='r.current_dispatcher_id=?';$args[]=$account;}if($eligibleOnly)$where[]=self::eligibleSql();if($ids!==null){$where[]='t.id IN ('.implode(',',array_fill(0,count($ids),'?')).')';$args=array_merge($args,$ids);}
        $rows=many($p,"SELECT t.id,t.trip_ref,t.status,t.dispatcher_role,t.dispatcher_shift,t.dispatcher_id,t.truck_type,t.scheduled_at,t.vehicle_id,t.driver_id,t.driver2_id,t.helper_id,
            r.version,r.current_dispatcher_id,
            (SELECT x.turnover_id FROM dispatcher_turnover_trips x WHERE x.pending_trip_id=t.id) AS pending_turnover_id,
            (SELECT v.plate_number FROM vehicles v WHERE v.id=t.vehicle_id) AS plate_number,
            (SELECT p.full_name FROM personnel p WHERE p.id=t.driver_id) AS driver_name,
            (SELECT p.full_name FROM personnel p WHERE p.id=t.driver2_id) AS driver2_name,
            (SELECT p.full_name FROM personnel p WHERE p.id=t.helper_id) AS helper_name,
            (SELECT f.status FROM fund_requests f WHERE f.trip_id=t.id AND f.attempt_number=t.attempt_number ORDER BY f.id DESC LIMIT 1) AS fund_status FROM trips t JOIN trip_responsibilities r ON r.trip_id=t.id
            WHERE ".implode(' AND ',$where?:['1=1']).' ORDER BY t.id'.($lock?' FOR UPDATE':''),$args);
        foreach($rows as &$r){
            $r['holds']=many($p,'SELECT resource_type,resource_id,role FROM trip_assignments WHERE trip_id=? ORDER BY resource_type,resource_id',[$r['id']]);
            $r['incidents']=many($p,"SELECT i.id,i.incident_ref,i.status,m.job_ref,m.status AS repair_status FROM incidents i LEFT JOIN maintenance_jobs m ON m.incident_id=i.id WHERE i.trip_id=? ORDER BY i.id",[$r['id']]);
        }unset($r);return $rows;
    }
    private static function fingerprint(array $rows): string { return hash('sha256',json_encode($rows,JSON_THROW_ON_ERROR)); }
    public static function action(array $u,string $action,array $d): array {
        must(roleIsDispatcher($u['role'])||$u['role']==='operations_head','Not authorized to use turnover.',403);
        if($action==='assign_initial')requireRole($u,'operations_head');
        elseif(in_array($action,['preview','endorse','accept'],true))must(roleIsDispatcher($u['role']),'Only Dispatchers endorse or accept turnover.',403);
        elseif(!in_array($action,['list','details'],true))throw new BusinessRuleException('Unknown turnover action.',404);
        if($action==='list')return self::listing($u);
        try{return transaction(function(PDO $p)use($u,$action,$d){
            self::installed($p);
            if($action==='assign_initial'){
                $id=idField($d,'trip_id');$t=one($p,'SELECT * FROM trips WHERE id=? FOR UPDATE',[$id]);must((bool)$t,'Trip not found.',404);
                must(in_array($t['dispatcher_role'],['car_carrier_dispatcher','container_wingvan_dispatcher'],true),'The trip has no valid original Dispatcher group; review it without fabricating historical responsibility.',409);
                $incoming=self::account($p,idField($d,'dispatcher_id'),$t['dispatcher_role']);
                must(in_array($t['truck_type'],DispatcherScope::types($incoming),true),'Truck group mismatch.',403);
                must(!one($p,'SELECT trip_id FROM trip_responsibilities WHERE trip_id=? FOR UPDATE',[$id]),'Initial responsibility is already recorded. Use formal turnover.',409);
                run($p,'INSERT INTO trip_responsibilities(trip_id,initial_dispatcher_id,current_dispatcher_id,assigned_by) VALUES(?,?,?,?)',[$id,$incoming['id'],$incoming['id'],$u['id']]);
                audit($p,$u['id'],'Trips','trip '.$id,'initial responsibility assigned','Responsible Dispatcher account #'.$incoming['id']);
                Notify::user($p,(int)$incoming['id'],'Trip responsibility',$t['trip_ref'].' is assigned to your account.','trips');
                return ['message'=>'Initial responsibility recorded. Original trip assignments are unchanged.'];
            }
            if($action==='preview'||$action==='endorse'){
                $actor=self::account($p,(int)$u['id'],$u['role']);
                $selected=($action==='endorse'||array_key_exists('trip_ids',$d))?self::selectedIds($d):null;
                if($action==='endorse'){
                    $key=strtolower(field($d,'request_key',36));must((bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/',$key),'Invalid request key.');
                    $old=one($p,'SELECT id,outgoing_id,incoming_id FROM dispatcher_turnovers WHERE request_key=?',[$key]);
                    if($old){must((int)$old['outgoing_id']===(int)$u['id']&&(int)$old['incoming_id']===idField($d,'incoming_id'),'Request key conflict.',409);$oldIds=array_map('intval',array_column(many($p,'SELECT trip_id FROM dispatcher_turnover_trips WHERE turnover_id=? ORDER BY trip_id',[$old['id']]),'trip_id'));must($oldIds===$selected,'Request key belongs to a different selected set.',409);return ['message'=>'Turnover already endorsed.','turnover_id'=>$old['id'],'duplicate'=>true];}
                }
                $rows=self::summary($p,(int)$u['id'],$action==='endorse',$selected);
                if($selected!==null)must(count($rows)===count($selected),'A selected trip is no longer eligible or assigned to your account. Refresh and select again.',409);
                foreach($rows as $t)must(DispatcherScope::permitsTrip($actor,$t),'Turnover contains work outside your account or truck group.',403);
                if($action==='preview')return ['rows'=>$rows,'fingerprint'=>self::fingerprint($rows)];
                must((bool)$rows,'No outstanding work is available to endorse.',409);
                $incoming=self::account($p,idField($d,'incoming_id'),$actor['role']);
                must($incoming['id']!==$actor['id'],'Choose a different incoming account.',409);
                must(hash_equals(self::fingerprint($rows),field($d,'fingerprint',64)),'The work changed after review. Review the latest summary before endorsing.',409);
                $id=insert($p,'dispatcher_turnovers',['outgoing_id'=>$actor['id'],'incoming_id'=>$incoming['id'],'dispatcher_role'=>$actor['role'],'request_key'=>$key,'remarks'=>optField($d,'remarks',1000)]);
                foreach($rows as $t){
                    must(!one($p,'SELECT turnover_id FROM dispatcher_turnover_trips WHERE pending_trip_id=?',[$t['id']]),'A referenced trip already has a pending turnover.',409);
                    run($p,'INSERT INTO dispatcher_turnover_trips(turnover_id,trip_id,responsibility_version,summary_json,pending_trip_id) VALUES(?,?,?,?,?)',[$id,$t['id'],$t['version'],json_encode($t,JSON_THROW_ON_ERROR),$t['id']]);
                }
                audit($p,$u['id'],'Trips','turnover '.$id,'turnover endorsed','Recipient #'.$incoming['id'].'; '.count($rows).' trip(s)');
                Notify::user($p,(int)$incoming['id'],'Pending turnover','Review turnover #'.$id.' before accepting.','trips');
                return ['message'=>'Turnover endorsed. You retain responsibility until acceptance.','turnover_id'=>$id];
            }
            $id=idField($d,'turnover_id');$h=one($p,'SELECT * FROM dispatcher_turnovers WHERE id=? FOR UPDATE',[$id]);must((bool)$h,'Turnover not found.',404);
            must($u['role']==='operations_head'||($u['role']===$h['dispatcher_role']&&in_array((int)$u['id'],[(int)$h['outgoing_id'],(int)$h['incoming_id']],true)),'This turnover is not addressed to your account.',403);
            $items=many($p,'SELECT trip_id,responsibility_version,summary_json FROM dispatcher_turnover_trips WHERE turnover_id=? ORDER BY trip_id',[$id]);
            $h['outgoing_name']=one($p,'SELECT full_name FROM users WHERE id=?',[$h['outgoing_id']])['full_name']??null;$h['incoming_name']=one($p,'SELECT full_name FROM users WHERE id=?',[$h['incoming_id']])['full_name']??null;
            if($action==='details')return ['turnover'=>$h,'rows'=>array_map(fn($r)=>json_decode($r['summary_json'],true,512,JSON_THROW_ON_ERROR),$items),'current_rows'=>self::summary($p,null,false,array_map('intval',array_column($items,'trip_id')),false)];
            must((int)$h['incoming_id']===(int)$u['id'],'Only the named recipient can accept turnover.',403);
            must(!array_key_exists('trip_ids',$d)&&!array_key_exists('exclude_trip_ids',$d),'Partial acceptance is not supported. Review the entire recorded turnover.',409);
            self::account($p,(int)$h['outgoing_id'],$h['dispatcher_role']);$incoming=self::account($p,(int)$u['id'],$h['dispatcher_role']);
            if($h['status']==='Accepted')return ['message'=>'Turnover already accepted.','duplicate'=>true];
            must($h['status']==='Pending'&&(bool)$items,'Turnover is not pending.',409);
            foreach($items as $item){
                $t=one($p,'SELECT * FROM trips WHERE id=? FOR UPDATE',[$item['trip_id']]);
                $r=one($p,'SELECT * FROM trip_responsibilities WHERE trip_id=? FOR UPDATE',[$item['trip_id']]);
                must($t&&self::eligible($p,$t),'A referenced trip is no longer eligible. No responsibility was transferred.',409);
                must($r&&(int)$r['current_dispatcher_id']===(int)$h['outgoing_id']&&(int)$r['version']===(int)$item['responsibility_version'],'Responsibility changed. This turnover requires authorized review.',409);
                must($t['dispatcher_role']===$incoming['role']&&in_array($t['truck_type'],DispatcherScope::types($incoming),true),'Trip truck group changed. Turnover cannot be partially accepted.',409);
                run($p,'UPDATE trip_responsibilities SET current_dispatcher_id=?,version=version+1 WHERE trip_id=?',[$incoming['id'],$item['trip_id']]);
                run($p,'UPDATE dispatcher_turnover_trips SET pending_trip_id=NULL WHERE turnover_id=? AND trip_id=?',[$id,$item['trip_id']]);
                run($p,"INSERT INTO trip_events(trip_id,actor_id,event_type,from_status,to_status,notes) VALUES(?,?,'Dispatcher turnover accepted',?,?,?)",[$item['trip_id'],$u['id'],$t['status'],$t['status'],'Turnover #'.$id.'; outgoing #'.$h['outgoing_id'].'; incoming #'.$u['id']]);
            }
            run($p,"UPDATE dispatcher_turnovers SET status='Accepted',accepted_by=?,accepted_at=NOW() WHERE id=?",[$u['id'],$id]);
            audit($p,$u['id'],'Trips','turnover '.$id,'turnover accepted',count($items).' trip(s); original assignment fields unchanged');
            return ['message'=>'Turnover accepted. Operational responsibility transferred.'];
        });}catch(PDOException $e){if(in_array((int)($e->errorInfo[1]??0),[1062,1205,1213],true))throw new BusinessRuleException('Concurrent turnover conflict. Refresh responsibility and review before retrying.',409);throw $e;}
    }
    private static function listing(array $u): array {
        $p=db();if(!self::ready($p))return ['schema_ready'=>false,'rows'=>[],'accounts'=>[],'unowned'=>[]];
        $ops=$u['role']==='operations_head';$args=$ops?[]:[$u['id'],$u['id']];
        $rows=many($p,'SELECT h.*,o.full_name AS outgoing_name,i.full_name AS incoming_name FROM dispatcher_turnovers h JOIN users o ON o.id=h.outgoing_id JOIN users i ON i.id=h.incoming_id'.($ops?'':' WHERE (h.outgoing_id=? OR h.incoming_id=?)').' ORDER BY h.id DESC LIMIT 500',$args);
        $accounts=many($p,"SELECT id,full_name,role,shift FROM users WHERE active=1 AND role IN ('car_carrier_dispatcher','container_wingvan_dispatcher')".($ops?'':' AND role=?').' ORDER BY full_name',$ops?[]:[$u['role']]);
        $unowned=$ops?many($p,"SELECT t.id,t.trip_ref,t.dispatcher_role,t.dispatcher_shift,t.truck_type FROM trips t LEFT JOIN trip_responsibilities r ON r.trip_id=t.id WHERE r.trip_id IS NULL AND t.dispatcher_role IN ('car_carrier_dispatcher','container_wingvan_dispatcher') ORDER BY ".self::workSql().' DESC,t.id DESC LIMIT 1000'):[];
        return ['schema_ready'=>true,'rows'=>$rows,'accounts'=>$accounts,'unowned'=>$unowned];
    }
}
