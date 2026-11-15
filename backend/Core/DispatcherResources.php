<?php
declare(strict_types=1);
core('DispatcherAttendance');
core('FleetState');

/** Reuses regular driver/helper links, attendance sessions and the existing resource holds. */
final class DispatcherResources {
    public static function candidates(PDO $p,array $u,array $t,bool $lock=false): array {
        must(DispatcherScope::permitsTrip($u,$t),'This trip belongs to another operational group.',403);
        $out=['drivers'=>[],'trucks'=>[],'helpers'=>[],'second_drivers'=>[]];
        if(!DispatcherAttendance::ready($p))return $out;
        [$scope,$args]=DispatcherScope::personnelSql($u);
        $people=many($p,"SELECT pe.id,pe.full_name,pe.person_type FROM personnel pe WHERE pe.active=1 AND (pe.availability='Available' OR (pe.availability='On Trip' AND EXISTS(SELECT 1 FROM trip_assignments own WHERE own.resource_type='person' AND own.resource_id=pe.id AND own.trip_id=?))) $scope ORDER BY pe.full_name".($lock?' FOR UPDATE':''),[$t['id'],...$args]);
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
            FROM vehicles v WHERE v.active=1 AND v.truck_type=? AND (v.status='Available' OR (v.status='Assigned' AND EXISTS(SELECT 1 FROM trip_assignments own WHERE own.resource_type='vehicle' AND own.resource_id=v.id AND own.trip_id=?))) ORDER BY recent,v.id".($lock?' FOR UPDATE':''),[$t['truck_type'],$t['id']]);
        foreach($vehicles as $v){$pid=(int)$v['assigned_driver_id'];
            if(!isset($eligible[$pid])||!in_array($pid,array_column($out['second_drivers'],'id'),true)||FleetState::truckBlocker($p,(int)$v['id'],(int)$t['id']))continue;
            $links=(int)one($p,'SELECT COUNT(*) AS n FROM vehicles WHERE active=1 AND assigned_driver_id=?',[$pid])['n'];
            if($links!==1)continue; // Do not guess a permanent truck where the master data is ambiguous.
            $out['drivers'][]=$eligible[$pid]+['vehicle_id'=>(int)$v['id'],'plate_number'=>$v['plate_number'],'regular_helper_id'=>$v['assigned_helper_id']?(int)$v['assigned_helper_id']:null];
            $out['trucks'][]=['id'=>(int)$v['id'],'plate_number'=>$v['plate_number'],'driver_id'=>$pid,'driver_name'=>$eligible[$pid]['name'],'regular_helper_id'=>$v['assigned_helper_id']?(int)$v['assigned_helper_id']:null];
        }
        return $out;
    }
    public static function choose(array $options,array $t,array $d): array {
        $vehicle=idField($d,'vehicle_id');$primary=null;
        foreach($options['drivers'] as $r)if($r['vehicle_id']===$vehicle){$primary=$r;break;}
        must($primary!==null,'Choose an eligible, timed-in regular driver with an available linked truck.',409);
        $driver=$primary['id'];
        must(empty($d['driver_id']) || (int)$d['driver_id']===$driver,'The Driver is locked to the selected Truck.',409);
        $other=(int)optId($d,'driver2_id');$helper=(int)optId($d,'helper_id');
        if($t['truck_type']==='Car Carrier'){
            must(!$helper,'Car Carrier uses two drivers, not a helper.');
            must($other>0&&$other!==$driver&&in_array($other,array_column($options['second_drivers'],'id'),true),'Choose a second distinct, eligible, timed-in Car Carrier driver.',409);
        }else{
            must(!$other,'This truck type uses one driver and a helper.');
            must($helper>0&&in_array($helper,array_column($options['helpers'],'id'),true),'Choose an eligible, timed-in helper from your operational group.',409);
        }
        $reason = optField($d, 'helper_substitution_reason', 255);
        if ($t['truck_type'] !== 'Car Carrier' && (int)$primary['regular_helper_id'] !== $helper) must($reason !== null, 'Explain why the regular Helper is being replaced for this trip.');
        $warnings=[];foreach([...$options['drivers'],...$options['helpers'],...$options['second_drivers']] as $r)if(in_array($r['id'],[$driver,$other,$helper],true)&&!empty($r['shift_warning']))$warnings[$r['id']]=$r['name'].' ('.$r['shift_warning'].')';
        return ['ok'=>true,'vehicle_id'=>$primary['vehicle_id'],'plate'=>$primary['plate_number'],'driver_id'=>$driver,'driver2_id'=>$other?:null,'helper_id'=>$helper?:null,'helper_substitution_reason'=>$t['truck_type']!=='Car Carrier'&&(int)$primary['regular_helper_id']!==$helper?$reason:null,'shift_fallback_note'=>$warnings?'Current timed-in crew outside the planning shift in Warn mode: '.implode(', ',$warnings).'.':''];
    }
    public static function automatic(PDO $p,array $t): array {
        return ['ok'=>false,'reason'=>'Manual Dispatcher Truck selection is required.'];
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
