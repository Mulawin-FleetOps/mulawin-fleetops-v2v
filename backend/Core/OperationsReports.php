<?php
declare(strict_types=1);

/** Operations Head reporting only. No writes, inferred assignment history, or financial fields. */
final class OperationsReports {
    public const TITLES = ['trips'=>'Trip Reports','trucks'=>'Truck Utilization','incidents'=>'Incident Reports'];
    public static function filters(array $q, ?DateTimeImmutable $now=null): array {
        $zone=new DateTimeZone('Asia/Manila');$today=($now??new DateTimeImmutable('now',$zone))->setTimezone($zone)->setTime(0,0);
        $report=choiceField($q,'report',array_keys(self::TITLES),false)??'trips';
        $range=choiceField($q,'date_range',['today','week','month','custom'],false)??(isset($q['from'])||isset($q['to'])?'custom':'month');
        if($range==='custom'){$from=self::date($q['from']??null);$to=self::date($q['to']??null);must($from<=$to,'Start Date must be on or before End Date.');}
        else{$to=$today->format('Y-m-d');$from=match($range){'today'=>$to,'week'=>$today->modify('monday this week')->format('Y-m-d'),default=>$today->format('Y-m-01')};}
        $search=optField($q,'search',200)??'';
        return ['report'=>$report,'date_range'=>$range,'from'=>$from,'to'=>$to,'truck_type'=>choiceField($q,'truck_type',TRUCK_TYPES,false)??'','search'=>$search];
    }
    private static function date(mixed $value):string {
        must(is_string($value)&&preg_match('/^\d{4}-\d{2}-\d{2}$/',$value),'Choose valid Start Date and End Date values.');
        $date=DateTimeImmutable::createFromFormat('!Y-m-d',$value,new DateTimeZone('Asia/Manila'));
        must($date&&$date->format('Y-m-d')===$value&&checkdate((int)substr($value,5,2),(int)substr($value,8,2),(int)substr($value,0,4)),'Choose valid Start Date and End Date values.');return $value;
    }
    public static function columns(string $report):array {
        return match($report){
            'trips'=>[['Trip ID','trip_ref'],['Client','client'],['Truck Type','truck_type'],['Route','route'],['Scheduled Date','scheduled_at','datetime'],['Status','status','badge']],
            'trucks'=>[['Plate Number','plate_number'],['Truck Type','truck_type'],['Assigned Driver','driver_name'],['Number of Trips','trip_count','count'],['Current Operational Status','status','badge']],
            'incidents'=>[['Incident ID','incident_ref'],['Trip ID','trip_ref'],['Truck Type','truck_type'],['Incident Type','incident_type'],['Date Reported','reported_at','datetime'],['Status','status','badge']],
        };
    }
    /** Metrics and chart are computed after search from the same complete record set. */
    public static function summarize(string $report,array $rows):array {
        if($report==='trips'){
            $completed=count(array_filter($rows,fn($r)=>$r['status']==='Completed'));
            $progress=count(array_filter($rows,fn($r)=>in_array($r['status'],['Dispatched','In Transit'],true)));
            $hold=count(array_filter($rows,fn($r)=>$r['status']==='On Hold - Incident Reported'));
            $cards=[['Total Trips',count($rows)],['Completed Trips',$completed],['In Progress',$progress],['Trips On Hold',$hold]];
            $chart=['title'=>'Trip Status Overview','labels'=>['Completed','In Progress','On Hold','Other'],'values'=>[$completed,$progress,$hold,count($rows)-$completed-$progress-$hold]];
        }elseif($report==='trucks'){
            $used=count(array_filter($rows,fn($r)=>(int)$r['trip_count']>0));$unused=count($rows)-$used;
            $cards=[['Total Trucks',count($rows)],['Trucks Used',$used],['Total Trips Recorded',(int)array_sum(array_column($rows,'trip_count'))],['Trucks Not Used',$unused]];
            $chart=['title'=>'Truck Usage Overview','labels'=>['Used Trucks','Not Used'],'values'=>[$used,$unused]];
        }else{
            $resolved=count(array_filter($rows,fn($r)=>$r['status']==='Resolved'));$open=count($rows)-$resolved;
            $cards=[['Total Incidents',count($rows)],['Resolved Incidents',$resolved],['Open Incidents',$open],['Trips Affected',count(array_unique(array_column($rows,'trip_id')))]];
            $chart=['title'=>'Incident Status Overview','labels'=>['Resolved','Open'],'values'=>[$resolved,$open]];
        }
        return ['cards'=>array_map(fn($c)=>['label'=>$c[0],'value'=>$c[1]],$cards),'chart'=>$chart];
    }
    public static function matchingRows(string $report,array $rows,string $search):array {
        if($search==='')return $rows;$keys=array_column(self::columns($report),1);
        return array_values(array_filter($rows,fn($r)=>mb_stripos(implode(' ',array_map(fn($k)=>(string)($r[$k]??''),$keys)),$search)!==false));
    }
    private static function dataset(PDO $p,array $f):array {
        $start=$f['from'].' 00:00:00';$end=(new DateTimeImmutable($f['to'],new DateTimeZone('Asia/Manila')))->modify('+1 day')->format('Y-m-d').' 00:00:00';
        $type=$f['truck_type'];$args=[$start,$end];
        if($f['report']==='trips'){
            $where=$type!==''?' AND t.truck_type=?':'';if($type!=='')$args[]=$type;
            $rows=many($p,"SELECT t.id,t.trip_ref,c.company_name AS client,t.truck_type,CONCAT(t.pickup_point,' → ',t.delivery_point) AS route,t.scheduled_at,t.status FROM trips t JOIN clients c ON c.id=t.client_id WHERE t.scheduled_at>=? AND t.scheduled_at<? $where ORDER BY t.scheduled_at DESC,t.id DESC",$args);
        }elseif($f['report']==='trucks'){
            $where=$type!==''?' WHERE v.truck_type=?':'';if($type!=='')$args[]=$type;
            $rows=many($p,"SELECT v.id,v.plate_number,v.truck_type,d.full_name AS driver_name,v.status,COUNT(DISTINCT t.id) AS trip_count FROM vehicles v LEFT JOIN personnel d ON d.id=v.assigned_driver_id LEFT JOIN trips t ON t.vehicle_id=v.id AND t.dispatched_at>=? AND t.dispatched_at<? $where GROUP BY v.id,v.plate_number,v.truck_type,d.full_name,v.status ORDER BY trip_count DESC,v.plate_number,v.id",$args);
            foreach($rows as &$row)$row['trip_count']=(int)$row['trip_count'];unset($row);
        }else{
            $where=$type!==''?' AND v.truck_type=?':'';if($type!=='')$args[]=$type;
            $rows=many($p,"SELECT i.id,i.incident_ref,i.trip_id,t.trip_ref,v.truck_type,i.incident_type,i.created_at AS reported_at,i.status FROM incidents i JOIN trips t ON t.id=i.trip_id JOIN vehicles v ON v.id=i.vehicle_id WHERE i.created_at>=? AND i.created_at<? $where ORDER BY i.created_at DESC,i.id DESC",$args);
        }
        return self::matchingRows($f['report'],$rows,$f['search']);
    }
    public static function page(array $f,array $rows,int $requested=1):array {
        $total=count($rows);$pages=max(1,(int)ceil($total/10));$page=min(max(1,$requested),$pages);
        $note=match($f['report']){
            'trips'=>'Trips are grouped by scheduled date (PHT); status is their current recorded status.',
            'trucks'=>'All registered trucks, including inactive records. Usage counts retained trip records by dispatch date (PHT). Earlier truck reassignments and attempts cannot be reconstructed.',
            default=>'Incidents are grouped by reporting time (PHT), not the time the incident occurred. Cleared-to-continue incidents remain open until marked Resolved.',
        };
        return ['filters'=>$f,'title'=>self::TITLES[$f['report']],'columns'=>self::columns($f['report']),'rows'=>array_slice($rows,($page-1)*10,10),'total'=>$total,'page'=>$page,'pages'=>$pages,'pageSize'=>10,'note'=>$note]+self::summarize($f['report'],$rows);
    }
    public static function read(array $u,array $q):array {
        requireRole($u,'operations_head');$f=self::filters($q);$page=intField($q,'report_page',1,false,1000000)??1;
        return ['operationsReport'=>self::page($f,self::dataset(db(),$f),$page)];
    }
    /** Only the visible, authorized report columns are exported; spreadsheet formula text is neutralized. */
    public static function csv(string $report,array $rows):string {
        $file=fopen('php://temp','w+');must($file!==false,'Could not prepare the report export. Retry the export.',503);
        $columns=self::columns($report);fwrite($file,"\xEF\xBB\xBF");fputcsv($file,array_column($columns,0),',','"','');
        foreach($rows as $row){$values=[];foreach($columns as $column){$v=(string)($row[$column[1]]??'');if(preg_match('/^[\s\x00-\x1F]*[=+@-]/u',$v))$v="'".$v;$values[]=$v;}fputcsv($file,$values,',','"','');}
        rewind($file);$csv=stream_get_contents($file);fclose($file);must($csv!==false,'Could not read the report export. Retry the export.',503);return $csv;
    }
    public static function export(array $u,array $q):array {
        requireRole($u,'operations_head');$f=self::filters($q);$rows=self::dataset(db(),$f);
        return ['filename'=>match($f['report']){'trips'=>'trip-report','trucks'=>'truck-utilization',default=>'incident-report'}.'-'.$f['from'].'-to-'.$f['to'].'.csv','mime'=>'text/csv;charset=utf-8','csv'=>self::csv($f['report'],$rows),'recordCount'=>count($rows)];
    }
    public static function incident(array $u,array $q):array {
        requireRole($u,'operations_head');$id=idField($q,'id');
        $row=one(db(),"SELECT i.*,t.trip_ref,t.status AS trip_status,v.plate_number,m.job_ref,m.status AS job_status FROM incidents i JOIN trips t ON t.id=i.trip_id JOIN vehicles v ON v.id=i.vehicle_id LEFT JOIN maintenance_jobs m ON m.incident_id=i.id WHERE i.id=? ORDER BY m.id DESC LIMIT 1",[$id]);
        must((bool)$row,'Incident report not found.',404);return ['incident'=>$row];
    }
}
