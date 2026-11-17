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
        $crewScope = DispatcherScope::forTruckType($u, (string)$t['truck_type']);
        [$scope,$args]=DispatcherScope::personnelSql($crewScope);
        $people=many($p,"SELECT pe.id,pe.full_name,pe.person_type FROM personnel pe WHERE pe.active=1 AND (pe.availability='Available' OR (pe.availability='On Trip' AND EXISTS(SELECT 1 FROM trip_assignments own WHERE own.resource_type='person' AND own.resource_id=pe.id AND own.trip_id=?))) $scope ORDER BY pe.full_name".($lock?' FOR UPDATE':''),[$t['id'],...$args]);
        $eligible=[];$plan=CrewAttendance::planningShift($t);
        foreach($people as $pe){
            if(DispatcherAttendance::blocker($p,$crewScope,(int)$pe['id'],(int)$t['id'],$lock))continue;
            if(FleetState::personBlocker($p,(int)$pe['id'],(int)$t['id']))continue;
            $check=CrewAttendance::assignmentCheck($p,(int)$pe['id'],$plan);
            if($check['absent']||(CrewAttendance::mode()===CrewAttendance::MODE_ENFORCE&&$check['issue']))continue;
            $eligible[(int)$pe['id']]=['id'=>(int)$pe['id'],'name'=>$pe['full_name'],'shift_warning'=>$check['issue']];
            $out[$pe['person_type']==='Driver'?'second_drivers':'helpers'][]=$eligible[(int)$pe['id']];
        }
        $vehicles=many($p,"SELECT v.id,v.plate_number,v.assigned_driver_id,v.assigned_helper_id,
            (SELECT COUNT(*) FROM trips x WHERE x.vehicle_id=v.id AND x.status='Completed' AND x.completed_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)) AS recent
            FROM vehicles v WHERE v.active=1 AND v.truck_type=? AND (v.status='Available' OR (v.status='Assigned' AND EXISTS(SELECT 1 FROM trip_assignments own WHERE own.resource_type='vehicle' AND own.resource_id=v.id AND own.trip_id=?))) ORDER BY recent,v.id".($lock?' FOR UPDATE':''),[$t['truck_type'],$t['id']]);
        $authorizations=many($p,'SELECT a.vehicle_id,a.driver_id
            FROM driver_truck_authorizations a JOIN vehicles v ON v.id=a.vehicle_id
            WHERE v.active=1 AND v.truck_type=?',[$t['truck_type']]);
        $driversByTruck=[];
        foreach($authorizations as $auth)$driversByTruck[(int)$auth['vehicle_id']][]=(int)$auth['driver_id'];
        foreach($vehicles as $v){
            if(FleetState::truckBlocker($p,(int)$v['id'],(int)$t['id']))continue;
            foreach($driversByTruck[(int)$v['id']]??[] as $pid){
                if(!isset($eligible[$pid]) || !in_array($pid,array_column($out['second_drivers'],'id'),true))continue;
                $pair=['id'=>$pid,'vehicle_id'=>(int)$v['id'],'plate_number'=>$v['plate_number'],
                    'regular_driver_id'=>$v['assigned_driver_id']?(int)$v['assigned_driver_id']:null,
                    'regular_helper_id'=>$v['assigned_helper_id']?(int)$v['assigned_helper_id']:null];
                $out['drivers'][]=$eligible[$pid]+$pair;
                $out['trucks'][]=['id'=>(int)$v['id'],'plate_number'=>$v['plate_number'],
                    'driver_id'=>$pid,'driver_name'=>$eligible[$pid]['name'],
                    'regular_helper_id'=>$pair['regular_helper_id']];
            }
        }
        return $out;
    }
    public static function choose(array $options,array $t,array $d): array {
        $vehicle=idField($d,'vehicle_id');
        $driver=idField($d,'driver_id');
        $primary=null;
        foreach($options['drivers'] as $r)
            if((int)$r['vehicle_id']===$vehicle && (int)$r['id']===$driver){$primary=$r;break;}
        must($primary!==null,'Choose an authorized, eligible Driver and available Truck for this trip.',409);
        $other=(int)optId($d,'driver2_id');$helper=(int)optId($d,'helper_id');
        if($t['truck_type']==='Car Carrier'){
            must(!($other&&$helper),'Select either a second authorized Driver or an eligible Helper, not both.',409);
            if($other){
                must($other!==$driver&&array_filter($options['drivers'],fn($pair)=>(int)$pair['id']===$other&&(int)$pair['vehicle_id']===$vehicle),'Choose a second eligible Car Carrier Driver authorized for the selected Truck.',409);
            }else{
                must($helper>0&&in_array($helper,array_column($options['helpers'],'id'),true),'Choose an eligible, timed-in Car Carrier Helper from your operational group.',409);
            }
        }else{
            must(!$other,'This truck type uses one driver and a helper.');
            must($helper>0&&in_array($helper,array_column($options['helpers'],'id'),true),'Choose an eligible, timed-in helper from your operational group.',409);
        }
        $reason = optField($d, 'helper_substitution_reason', 255);
        if ($helper && (int)$primary['regular_helper_id'] !== $helper) must($reason !== null, 'Explain why the regular Helper is being replaced for this trip.');
        $warnings=[];foreach([...$options['drivers'],...$options['helpers'],...$options['second_drivers']] as $r)if(in_array($r['id'],[$driver,$other,$helper],true)&&!empty($r['shift_warning']))$warnings[$r['id']]=$r['name'].' ('.$r['shift_warning'].')';
        return ['ok'=>true,'vehicle_id'=>$primary['vehicle_id'],'plate'=>$primary['plate_number'],'driver_id'=>$driver,'driver2_id'=>$other?:null,'helper_id'=>$helper?:null,'helper_substitution_reason'=>$helper&&(int)$primary['regular_helper_id']!==$helper?$reason:null,'shift_fallback_note'=>$warnings?'Current timed-in crew outside the planning shift in Warn mode: '.implode(', ',$warnings).'.':''];
    }
    public static function automatic(PDO $p,array $t): array {
        return ['ok'=>false,'reason'=>'Manual Dispatcher Driver and Truck selection is required.'];
    }
    public static function tripBlockers(PDO $p,array $t,bool $lock=false): array {
        if(empty($t['truck_type']))return ['Truck type is not set.'];
        $u=['id'=>0,'role'=>dispatcherRoleFor($t['truck_type'])];$why=[];
        foreach(['driver_id','driver2_id','helper_id'] as $key){if(empty($t[$key]))continue;
            if($block=FleetState::personBlocker($p,(int)$t[$key],(int)$t['id']))$why[]=$block;
            try{if($block=DispatcherAttendance::blocker($p,$u,(int)$t[$key],(int)$t['id'],$lock))$why[]=$block;}
            catch(BusinessRuleException $e){$why[]='Assigned personnel have no verified link to this operational group.';}
        }
        if(!empty($t['vehicle_id'])){
            if($block=FleetState::truckBlocker($p,(int)$t['vehicle_id'],(int)$t['id']))$why[]=$block;
            try{
                DispatcherScope::truck($p,$u,(int)$t['vehicle_id']);
                foreach(['driver_id','driver2_id'] as $col){
                    if(empty($t[$col]))continue;
                    if(!one($p,'SELECT 1 FROM driver_truck_authorizations WHERE driver_id=? AND vehicle_id=?',
                        [(int)$t[$col],(int)$t['vehicle_id']]))
                        $why[]='A trip Driver is not authorized for the assigned Truck. Reassign resources.';
                }
            }catch(BusinessRuleException $e){
                $why[]='Assigned truck is outside this operational group; an authorized correction is required.';
            }
        }
        return array_values(array_unique($why));
    }
}
