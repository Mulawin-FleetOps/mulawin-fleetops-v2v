<?php
declare(strict_types=1);
/**
 * Transcribed from supplied pre-departure checklist scans.
 * These labels are taken from the source (including original spellings).
 * This module is loaded only when inspection features are requested.
 */
final class Checklist {
    public static function sections(): array {
        return [
            ['key'=>'tractor_head','title'=>'TRACTOR HEAD','items'=>[
                'WINSHIELD', 'SIDE/WIDE/BALL MIRROR (5pcs.)', 'WIPER ARM & WIPER BLADE (3pairs)',
                'DOORS WINDOW GLASS (2pcs.)', 'DOORS DRIVER/PASSENGER (2pcs.)',
                'HEAD LIGHTS (LH & RH)', 'SIGNAL LIGHTS', 'CLEARANCE LIGHT (8pcs.)',
                'TAIL LIGHTS (LH & RH)', 'BACK HORN', 'DIESEL TANK', 'TANK COVER',
                'BATTERIES', 'TOOL BOX', 'PLATE LIGHT', 'HYDRAULIC HOSE & COUPLING',
                'AIR HOSE AND GLAD HAND', 'TIRES', 'SPARE TIRE', 'AIRCON',
            ]],
            ['key'=>'accessories','title'=>'ACCESSORIES','items'=>[
                'BULL BAR', 'BACK & FOG LIGHT (2pcs.)', 'WIND BRAKER', 'SHORT FIT',
                'JACK AND HANDLE', 'TIRE WRENCH (TH & TR)', 'TRAFFIC CONES (2pcs.)',
                'TIRE CHOKES (2pcs.)', 'TIRE COVER/HUB CAPS (4pcs.)', 'MUD GUARD (4pcs.)',
                'EWD (RED/ORANGE) (2pcs.)', 'FIRE EXTINGUISHER', 'RH & LH STAINLESS LADDER',
                'CELLPHONE', 'HARD HAT', 'FIRST AID KIT', 'KEY HANGER', 'OIL SPILL KIT',
            ]],
            ['key'=>'trailer','title'=>'TRAILER','items'=>[
                'CLEARANCE LIGHT (24pcs.)', 'TAIL LIGHT LH & RH', 'BACK LIGHT', 'BACK-UP T-LIGHT',
                'BACK HORN', 'RATCHET TIE DOWN', 'IRON/ALLOY LADDER', 'LASHING CABLE',
                'TIRE LH & RH', 'LANDING GEARS', 'HYDRAULIC CYLINDERS LH & RH',
            ]],
            ['key'=>'documents','title'=>'DOCUMENTS','items'=>[
                "DRIVER'S LICENSE", 'O.R LATEST (TRACTOR AND TRAILER)', 'C.R (TRACTOR AND TRAILER)',
            ]],
            ['key'=>'ppe','title'=>'PPE','items'=>[
                'REFLECTORIZED TOP', 'REFLECTORIZED PANTS', 'CLOSED SHOES', 'BUMP CAP', 'GLOVES',
            ]],
        ];
    }

    /** All 57 entries must have a deliberate result; NOT OK is recorded, not erased. */
    public static function validate(array $data): array {
        $items=$data['items']??null;
        must(is_array($items),'Checklist items are required.');
        $validated=[];$hasNotOk=false;$count=0;
        foreach (self::sections() as $section) {
            foreach ($section['items'] as $i=>$label) {
                $key=$section['key'].'_'.str_pad((string)($i+1),2,'0',STR_PAD_LEFT);
                $entry=$items[$key]??null;
                must(is_array($entry),'Missing checklist item: '.$section['title'].' #'.($i+1));
                $condition=$entry['condition']??null;
                must(in_array($condition,['OK','NOT OK'],true),'Check OK or NOT OK: '.$label);
                $remark=$entry['remarks']??'';
                must(is_string($remark) && (function_exists('mb_strlen') ? mb_strlen(trim($remark)) : strlen(trim($remark)))<=250,'Invalid remarks for: '.$label);
                $validated[$key]=['condition'=>$condition,'remarks'=>trim($remark)];
                $hasNotOk = $hasNotOk || $condition==='NOT OK';
                $count++;
            }
        }
        must(count($items)===$count,'Unrecognized checklist items; reload the form.');
        $meta=$data['meta']??[];
        must(is_array($meta),'Invalid checklist header fields.');
        $allowed=['truck_number','driver_1','driver_2','joint_dispatcher','approved_by_operations','guard_on_duty'];
        $cleanMeta=[];
        foreach ($allowed as $key) {
            $value=$meta[$key]??'';
            must(is_string($value) && (function_exists('mb_strlen') ? mb_strlen(trim($value)) : strlen(trim($value)))<=120,'Invalid checklist field: '.$key);
            $cleanMeta[$key]=trim($value);
        }
        return ['items'=>$validated,'meta'=>$cleanMeta,'has_not_ok'=>$hasNotOk,
                'source'=>'User-provided checklist scans: page 1 and continuation',
                'template_version'=>'scans-v1'];
    }
}
