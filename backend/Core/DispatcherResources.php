<?php
declare(strict_types=1);
core('DispatcherAttendance');
core('FleetState');

/** Reuses regular driver/helper links, attendance sessions and the existing resource holds. */
final class DispatcherResources {
    public static function candidates(PDO $p,array $u,array $t,bool $lock=false): array {
        must(DispatcherScope::permitsTrip($u,$t),'This trip belongs to another operational group.',403);
        $out=['drivers'=>[],'helpers'=>[],'second_drivers'=>[]];
        if(!DispatcherAttendance::ready($p))return $out;
        [$scope,$args]=DispatcherScope::personnelSql($u);
        $people=many($p,"SELECT pe.id,pe.full_name,pe.person_type FROM personnel pe WHERE pe.active=1 AND pe.availability='Available' $scope ORDER BY pe.full_name".($lock?' FOR UPDATE':''),$args);
        $eligible=[];$plan=CrewAttendance::planningShift($t);
        foreach($people as $pe){
            if(DispatcherAttendance::blocker($p,$u,(int)$pe['id'],(int)$t['id'],$lock))continue;
            $check=CrewAttendance::assignmentCheck($p,(int)$pe['id'],$plan);
            if($check['absent']||(CrewAttendance::mode()===CrewAttendance::MODE_ENFORCE&&$check['issue']))continue;
            $eligible[(int)$pe['id']]=['id'=>(int)$pe['id'],'name'=>$pe['full_name'],'shift_warning'=>$check['issue']];
            $out[$pe['person_type']==='Driver'?'second_drivers':'helpers'][]=$eligible[(int)$pe['id']];
        }
        $vehicles=many($p,"SELECT v.id,v.plate_number,v.assigned_driver_id,v.assigned_helper_id,
            (SELECT COUNT(*) FROM trips x WHERE x.vehicle_id=v.id AND x.status='Completed' AND x.completed_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)) AS recent
            FROM vehicles v WHERE v.active=1 AND v.truck_type=? AND v.status='Available' ORDER BY recent,v.id".($lock?' FOR UPDATE':''),[$t['truck_type']]);
        foreach($vehicles as $v){$pid=(int)$v['assigned_driver_id'];
            if(!isset($eligible[$pid])||!in_array($pid,array_column($out['second_drivers'],'id'),true)||FleetState::truckBlocker($p,(int)$v['id'],(int)$t['id']))continue;
            $links=(int)one($p,'SELECT COUNT(*) AS n FROM vehicles WHERE active=1 AND assigned_driver_id=?',[$pid])['n'];
            if($links!==1)continue; // Do not guess a permanent truck where the master data is ambiguous.
            $out['drivers'][]=$eligible[$pid]+['vehicle_id'=>(int)$v['id'],'plate_number'=>$v['plate_number'],'regular_helper_id'=>$v['assigned_helper_id']?(int)$v['assigned_helper_id']:null];
        }
        return $out;
    }
    public static function choose(array $options,array $t,array $d): array {
        $driver=idField($d,'driver_id');$vehicle=idField($d,'vehicle_id');$primary=null;
        foreach($options['drivers'] as $r)if($r['id']===$driver){$primary=$r;break;}
        must($primary!==null,'Choose an eligible, timed-in regular driver with an available linked truck.',409);
        must($vehicle===$primary['vehicle_id'],'The truck must be the selected driver\'s permanent truck.',409);
        $other=(int)optId($d,'driver2_id');$helper=(int)optId($d,'helper_id');
        if($t['truck_type']==='Car Carrier'){
            must(!$helper,'Car Carrier uses two drivers, not a helper.');
            must($other>0&&$other!==$driver&&in_array($other,array_column($options['second_drivers'],'id'),true),'Choose a second distinct, eligible, timed-in Car Carrier driver.',409);
        }else{
            must(!$other,'This truck type uses one driver and a helper.');
            must($helper>0&&in_array($helper,array_column($options['helpers'],'id'),true),'Choose an eligible, timed-in helper from your operational group.',409);
        }
        $warnings=[];foreach([...$options['drivers'],...$options['helpers'],...$options['second_drivers']] as $r)if(in_array($r['id'],[$driver,$other,$helper],true)&&!empty($r['shift_warning']))$warnings[$r['id']]=$r['name'].' ('.$r['shift_warning'].')';
        return ['ok'=>true,'vehicle_id'=>$primary['vehicle_id'],'plate'=>$primary['plate_number'],'driver_id'=>$driver,'driver2_id'=>$other?:null,'helper_id'=>$helper?:null,'shift_fallback_note'=>$warnings?'Current timed-in crew outside the planning shift in Warn mode: '.implode(', ',$warnings).'.':''];
    }
    public static function automatic(PDO $p,array $t): array {
        if(empty($t['truck_type']))return ['ok'=>false,'reason'=>'Truck type is not set.'];
        $u=['id'=>0,'role'=>dispatcherRoleFor($t['truck_type']),'shift'=>$t['dispatcher_shift']??null];$options=self::candidates($p,$u,$t,true);
        foreach($options['drivers'] as $driver){
            $d=['driver_id'=>$driver['id'],'vehicle_id'=>$driver['vehicle_id']];
            if($t['truck_type']==='Car Carrier'){$other=array_values(array_filter($options['second_drivers'],fn($r)=>$r['id']!==$driver['id']));if(!$other)continue;$d['driver2_id']=$other[0]['id'];}
            else{if(!$options['helpers'])continue;$ids=array_column($options['helpers'],'id');$d['helper_id']=in_array($driver['regular_helper_id'],$ids,true)?$driver['regular_helper_id']:$ids[0];}
            return self::choose($options,$t,$d);
        }
        return ['ok'=>false,'reason'=>'No eligible timed-in regular driver, linked operational truck, and required crew are currently available.'];
    }
    public static function tripBlockers(PDO $p,array $t,bool $lock=false): array {
        if(empty($t['truck_type']))return ['Truck type is not set.'];
        $u=['id'=>0,'role'=>dispatcherRoleFor($t['truck_type'])];$why=[];
        foreach(['driver_id','driver2_id','helper_id'] as $key){if(empty($t[$key]))continue;
            try{if($block=DispatcherAttendance::blocker($p,$u,(int)$t[$key],(int)$t['id'],$lock))$why[]=$block;}
            catch(BusinessRuleException $e){$why[]='Assigned personnel have no verified link to this operational group.';}
        }
        if(!empty($t['vehicle_id'])){try{$v=DispatcherScope::truck($p,$u,(int)$t['vehicle_id']);if((int)$v['assigned_driver_id']!==(int)$t['driver_id'])$why[]='Assigned truck does not match the regular driver; an authorized assignment correction is required.';}catch(BusinessRuleException $e){$why[]='Assigned truck is outside this operational group; an authorized correction is required.';}}
        return array_values(array_unique($why));
    }
}
