<?php
if(!isset($out,$in,$untouched)||envValue('APP_ENV')!=='test')throw new RuntimeException('Isolated selected-turnover fixture required');
test_guard([envValue('DB_NAME')]);
$socket=stream_socket_server('tcp://127.0.0.1:0',$errno,$errstr);if(!$socket)throw new RuntimeException('Private HTTP port unavailable');$port=(int)substr(strrchr(stream_socket_get_name($socket,false),':'),1);fclose($socket);
$sessionDir=__DIR__.'/selected-http-sessions';mkdir($sessionDir,0700,true);
$server=proc_open([PHP_BINARY,'-d','session.save_path='.$sessionDir,'-d','display_errors=0','-d','log_errors=1','-d','error_log='.$sessionDir.'/php.log','-S','127.0.0.1:'.$port,'-t',dirname(__DIR__).'/public'],[0=>['pipe','r'],1=>['file',$sessionDir.'/server.out','a'],2=>['file',$sessionDir.'/server.err','a']],$serverPipes);fclose($serverPipes[0]);
$http=function(string $jar,string $api,?array $data=null,?string $csrf=null)use($port){$ch=curl_init('http://127.0.0.1:'.$port.'/?api='.urlencode($api));$headers=['Content-Type: application/json'];if($csrf!==null)$headers[]='X-CSRF-Token: '.$csrf;curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_COOKIEFILE=>$jar,CURLOPT_COOKIEJAR=>$jar,CURLOPT_TIMEOUT=>8,CURLOPT_HTTPHEADER=>$headers]);if($data!==null)curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($data)]);$text=curl_exec($ch);$code=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);unset($ch);return [$code,json_decode((string)$text,true)];};
try{
 for($i=0;$i<40;$i++){$connection=@stream_socket_client('tcp://127.0.0.1:'.$port,$errno,$errstr,0.1);if($connection){fclose($connection);break;}usleep(100000);}
 $sessions=[];foreach(['out'=>$out,'in'=>$in] as $name=>$user){$jar=$sessionDir.'/'.$name.'.cookies';[$code,$who]=$http($jar,'whoami');needSelectedHttp($code===200&&isset($who['csrf']),'Private HTTP session bootstrap');[$code,$login]=$http($jar,'login',['username'=>'selected_'.$name,'password'=>'Isolated-selected-only-42!','csrf'=>$who['csrf']]);turn_ok($code===200&&!empty($login['ok']),'Real HTTP password login authenticates selected '.$name);[$code,$who]=$http($jar,'whoami');$sessions[$name]=[$jar,$who['csrf']];}
 [$oj,$oc]=$sessions['out'];[$ij,$ic]=$sessions['in'];
 [$status,$bad]=$http($oj,'Trips.turnover_preview',['trip_ids'=>[]],$oc);turn_ok($status===400,'Authenticated API rejects empty selection');
 [$status,$bad]=$http($oj,'Trips.turnover_preview',['trip_ids'=>[$untouched,$untouched]],$oc);turn_ok($status===400,'Authenticated API rejects duplicate selection');
 [$status,$pv]=$http($oj,'Trips.turnover_preview',['trip_ids'=>[$untouched]],$oc);turn_ok($status===200&&count($pv['data']['rows']??[])===1,'Authenticated API previews only selected work');
 $payload=['incoming_id'=>$in['id'],'trip_ids'=>[$untouched],'fingerprint'=>$pv['data']['fingerprint'],'request_key'=>turn_key()];[$status,$h]=$http($oj,'Trips.turnover_endorse',$payload,$oc);turn_ok($status===200,'Authenticated API endorses selected work');$header=$h['data']['turnover_id'];
 [$status,$repeated]=$http($oj,'Trips.turnover_endorse',$payload,$oc);turn_ok($status===200&&!empty($repeated['data']['duplicate']),'Authenticated endorsement retry remains idempotent');
 [$status,$bad]=$http($oj,'Trips.turnover_accept',['turnover_id'=>$header],$oc);turn_ok($status===403,'Authenticated outgoing account cannot accept');
 [$status,$detail]=$http($ij,'Trips.turnover_details',['turnover_id'=>$header],$ic);turn_ok($status===200&&count($detail['data']['current_rows']??[])===1,'Authenticated incoming account reviews current referenced status');
 [$status,$accepted]=$http($ij,'Trips.turnover_accept',['turnover_id'=>$header],$ic);turn_ok($status===200,'Authenticated incoming account accepts selected set');
 [$status,$again]=$http($ij,'Trips.turnover_accept',['turnover_id'=>$header],$ic);turn_ok($status===200&&!empty($again['data']['duplicate']),'Authenticated repeated acceptance is safe');
 [$status,$denied]=$http($oj,'Trips.progress',['trip_id'=>$untouched,'update_type'=>'Progress','note'=>'Denied test'], $oc);turn_ok($status===403,'Authenticated outgoing mutation is denied after selected acceptance');
 [$status,$denied]=$http($ij,'Trips.turnover_preview',['trip_ids'=>[$untouched]],'invalid-csrf');turn_ok($status===403,'Selected turnover preserves HTTP CSRF enforcement');
}finally{proc_terminate($server);proc_close($server);}
function needSelectedHttp(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
