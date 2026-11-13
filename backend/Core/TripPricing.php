<?php
declare(strict_types=1);
core('Settings');
core('Routing');

/** Contract and fuel are separate sources. Historical invoices are never recalculated implicitly. */
final class TripPricing {
    public static function ready(PDO $p): bool {
        return (int)(one($p,"SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('pricing_settings_history','billing_pricing')")['n']??0)===2;
    }
    public static function date(string $at): string {
        return (new DateTimeImmutable($at,new DateTimeZone('Asia/Manila')))->setTimezone(new DateTimeZone('Asia/Manila'))->format('Y-m-d');
    }
    public static function quote(PDO $p,array $trip,string $at,?array $saved=null): array {
        $q=['at'=>$at,'date'=>self::date($at),'fixed'=>null,'fuel'=>null,'total'=>null,'missing'=>[]];
        if(!self::ready($p)){$q['missing'][]='Pricing migration 13 is required';return $q;}
        $rate=one($p,"SELECT * FROM client_route_rates WHERE route_id=? AND rate_type='Flat' AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) AND status IN ('Approved','Superseded') ORDER BY version_no DESC LIMIT 1",[$trip['client_route_id']??0,$at,$at]);
        if($rate){$q['rate_id']=(int)$rate['id'];$q['rate_version']=(int)$rate['version_no'];$q['fixed']=$rate['rate_amount'];}else $q['missing'][]='Verified fixed route rate at dispatch';
        if(isset($saved['rate_id'])){$q['rate_id']=$saved['rate_id'];$q['rate_version']=$saved['rate_version'];$q['fixed']=$saved['fixed'];$q['missing']=array_values(array_diff($q['missing'],['Verified fixed route rate at dispatch']));}
        foreach(['diesel','efficiency'=>$trip['truck_type'],'garage'] as $name=>$key){if(is_int($name))$name=$key;$row=$saved[$name.'_source']??Settings::pricingAt($p,$key,$at);$q[$name.'_source']=$row;$q[$name.'_value']=$row?json_decode($row['value_json'],true,512,JSON_THROW_ON_ERROR):null;if(!$row)$q['missing'][]=$name;}
        $q['delivery_km']=$saved['delivery_km']??null;$q['garage_km']=$saved['garage_km']??null;
        foreach(['garage_provider','delivery_provider'] as $provider)if(isset($saved[$provider]))$q[$provider]=$saved[$provider];
        $q['route_snapshot']=$saved['route_snapshot']??one($p,'SELECT * FROM client_routes WHERE id=?',[$trip['client_route_id']??0]);
        if($saved===null||$q['garage_km']===null||$q['delivery_km']===null){
            // Use road distance only; manual/edited contract km are not a fuel fallback.
            $route=$q['route_snapshot'];
            if($q['delivery_km']===null&&$route&&$route['distance_source']==='Map')$q['delivery_km']=$route['distance_km'];
            $g=$q['garage_value'];
            $canResolve=$saved===null||$q['date']===date('Y-m-d');
            if($q['delivery_km']===null&&$canResolve&&$route&&$route['origin_lat']!==null&&$route['destination_lat']!==null){
                try{$road=Routing::route($p,(int)($trip['dispatcher_id']??$trip['created_by']??0),[(float)$route['origin_lat'],(float)$route['origin_lng']],[(float)$route['destination_lat'],(float)$route['destination_lng']],$route['route_option']?:Routing::DEFAULT_OPTION);$q['delivery_km']=$road['distance_km'];$q['delivery_provider']=$road['provider'];}catch(RoutingUnavailable|BusinessRuleException $e){$q['missing'][]='Delivery road routing unavailable';}
            }
            if($q['garage_km']===null&&$canResolve&&$g&&$route&&$route['origin_lat']!==null&&$route['origin_lng']!==null){
                if((float)$g['lat']===(float)$route['origin_lat']&&(float)$g['lng']===(float)$route['origin_lng']){$q['garage_km']='0.00';$q['garage_provider']='Verified identical garage and pickup coordinates';}
                else try{$road=Routing::route($p,(int)($trip['dispatcher_id']??$trip['created_by']??0),[(float)$g['lat'],(float)$g['lng']],[(float)$route['origin_lat'],(float)$route['origin_lng']],$route['route_option']?:Routing::DEFAULT_OPTION);$q['garage_km']=$road['distance_km'];$q['garage_provider']=$road['provider'];}catch(RoutingUnavailable|BusinessRuleException $e){$q['missing'][]='Garage road routing unavailable';}
            }
        }
        if($saved!==null&&$q['date']!==date('Y-m-d')&&($q['garage_km']===null||$q['delivery_km']===null))$q['missing'][]='Historical road distance cannot be inferred from current routing';
        foreach(['diesel','efficiency'] as $key)if(isset($q[$key.'_value'])&&(!is_numeric($q[$key.'_value']['value']??null)||(float)$q[$key.'_value']['value']<=0))$q['missing'][]='Invalid '.$key.' source';
        if($q['delivery_km']===null)$q['missing'][]='Verified pickup-to-delivery road distance';
        if($q['garage_km']===null)$q['missing'][]='Verified garage-to-pickup road distance';
        $fuelMissing=array_diff($q['missing'],['Verified fixed route rate at dispatch']);
        if(!$fuelMissing){
            $q['liters']=round(((float)$q['delivery_km']+(float)$q['garage_km'])/(float)$q['efficiency_value']['value'],6);
            // MariaDB DECIMAL performs the authoritative money rounding, not browser arithmetic.
            $q['fuel']=one($p,'SELECT ROUND((CAST(? AS DECIMAL(12,2))+CAST(? AS DECIMAL(12,2)))/CAST(? AS DECIMAL(10,4))*CAST(? AS DECIMAL(12,4)),2) amount',[$q['delivery_km'],$q['garage_km'],$q['efficiency_value']['value'],$q['diesel_value']['value']])['amount'];
            if($q['fixed']!==null)$q['total']=one($p,'SELECT CAST(? AS DECIMAL(14,2))+CAST(? AS DECIMAL(14,2)) amount',[$q['fixed'],$q['fuel']])['amount'];
        }
        return $q;
    }
    public static function saved(PDO $p,int $id): ?array {
        if(!self::ready($p))return null;
        $row=one($p,'SELECT snapshot_json FROM billing_pricing WHERE billing_id=?',[$id]);
        return $row?json_decode($row['snapshot_json'],true,512,JSON_THROW_ON_ERROR):null;
    }
    /** Read-only impact proposal. Never manufactures historical garage distances. */
    public static function proposal(PDO $p,array $b): array {
        $saved=self::saved($p,(int)$b['id']);
        $trip=one($p,'SELECT * FROM trips WHERE id=?',[$b['trip_id']]);
        $q=$saved?self::quote($p,$trip,$saved['at'],$saved):['missing'=>['Historical dispatch pricing/distance snapshot unavailable'],'total'=>null];
        $proposed=$q['total']===null?null:one($p,'SELECT CAST(? AS DECIMAL(14,2))+CAST(? AS DECIMAL(14,2)) amount',[$q['total'],$b['charges_total']])['amount'];
        $open=in_array($b['status'],['Ongoing','For Billing'],true)&&!$b['invoice_number']&&(float)$b['amount_paid']===0.0;
        $result=['billing_id'=>$b['id'],'status'=>$b['status'],'existing'=>$b['total_amount'],'proposed'=>$proposed,'missing'=>$q['missing'],'can_apply'=>$open&&$proposed!==null&&(float)$proposed>0,'correction'=>$open?'Verified open-record recalculation only':'Review proposal only; preserve invoice and payment allocations','pricing'=>$q];
        $result['fingerprint']=hash('sha256',json_encode([$b,$result],JSON_THROW_ON_ERROR));return $result;
    }
}
