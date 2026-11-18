<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
final class ChecklistTest extends TestCase {
    private static function payload(): array {
        require_once dirname((new ReflectionClass(Actions::class))->getFileName()) . '/Modules/Operations/Inspections/Checklist.php';
        $items=[];
        foreach (Checklist::sections() as $section) foreach ($section['items'] as $i=>$label) $items[$section['key'].'_'.str_pad((string)($i+1),2,'0',STR_PAD_LEFT)] = ['condition'=>'OK','remarks'=>''];
        return ['items'=>$items];
    }
    public function testAllItemsAndNotOkFindingPreserved(): void {
        $d=self::payload(); $r=Checklist::validate($d);
        self::assertCount(57, $r['items']); self::assertFalse($r['has_not_ok']);
        $key=array_key_first($d['items']); $d['items'][$key]=['condition'=>'NOT OK','remarks'=>' Tire damage '];
        $r=Checklist::validate($d); self::assertTrue($r['has_not_ok']); self::assertSame('Tire damage',$r['items'][$key]['remarks']);
    }
    public function testTractorAndTrailerProblemsAreClassifiedAsTruckDefects(): void {
        $d=self::payload();
        $d['items']['tractor_head_18']=['condition'=>'NOT OK','remarks'=>'Sidewall cut'];
        $d['items']['trailer_09']=['condition'=>'NOT OK','remarks'=>'Worn tire'];
        $validated=Checklist::validate($d);
        $defects=Checklist::truckDefects($validated);
        self::assertCount(2,$defects);
        self::assertStringContainsString('Sidewall cut',implode(' ',$defects));
        self::assertStringContainsString('Worn tire',implode(' ',$defects));
    }

    public function testDocumentPpeAndAccessoriesFailuresDoNotCreateTruckDefects(): void {
        $d=self::payload();
        $d['items']['documents_01']=['condition'=>'NOT OK','remarks'=>'Expired'];
        $d['items']['ppe_01']=['condition'=>'NOT OK','remarks'=>'Missing'];
        $d['items']['accessories_15']=['condition'=>'NOT OK','remarks'=>'Missing kit'];
        $validated=Checklist::validate($d);
        self::assertTrue($validated['has_not_ok']);
        self::assertSame([],Checklist::truckDefects($validated));
    }

    public static function invalidCases(): iterable {
        foreach (['missing','extra','condition','remarks','meta'] as $case) yield $case => [$case];
    }
    #[DataProvider('invalidCases')]
    public function testInvalidInspectionRejected(string $case): void {
        $d=self::payload(); $key=array_key_first($d['items']);
        switch ($case) {
            case 'missing': unset($d['items'][$key]); break;
            case 'extra': $d['items']['invented']=['condition'=>'OK']; break;
            case 'condition': $d['items'][$key]['condition']='SKIP'; break;
            case 'remarks': $d['items'][$key]['remarks']=str_repeat('x',251); break;
            case 'meta': $d['meta']=['guard_on_duty'=>[]]; break;
        }
        $this->expectException(BusinessRuleException::class); Checklist::validate($d);
    }
}
