<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DriverLicenseEligibilityTest extends TestCase {
    public static function licenseCases(): iterable {
        yield 'missing number'=>[null,'2099-01-01',true];
        yield 'empty number'=>['','2099-01-01',true];
        yield 'whitespace number'=>['  ','2099-01-01',true];
        yield 'missing expiry'=>['FIX-LICENSE',null,true];
        yield 'missing both'=>[null,null,true];
        yield 'expired'=>['FIX-LICENSE',date('Y-m-d',strtotime('-1 day')),true];
        yield 'valid today'=>['FIX-LICENSE',date('Y-m-d'),false];
        yield 'valid future'=>['FIX-LICENSE','2099-01-01',false];
    }
    #[DataProvider('licenseCases')]
    public function testDriverEligibilityDoesNotRewriteRecords(?string $number,?string $expiry,bool $blocked):void {
        $p=$this->database('Driver',$number,$expiry);$before=$p->query('SELECT * FROM personnel')->fetchAll();
        $reason=FleetState::personBlocker($p,1);
        self::assertSame($blocked,$reason!==null);if($blocked)self::assertStringContainsString('license',$reason);
        self::assertSame($before,$p->query('SELECT * FROM personnel')->fetchAll());
    }
    public function testHelpersDoNotRequireDriverLicenseFields():void {
        self::assertNull(FleetState::personBlocker($this->database('Helper',null,null),1));
    }
    private function database(string $type,?string $number,?string $expiry):PDO {
        core('FleetState');
        $p=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $p->exec('CREATE TABLE personnel(id INTEGER PRIMARY KEY,full_name TEXT,active INTEGER,availability TEXT,person_type TEXT,license_number TEXT,license_expiry TEXT); CREATE TABLE trips(id INTEGER PRIMARY KEY,trip_ref TEXT,status TEXT,driver_id INTEGER,driver2_id INTEGER,helper_id INTEGER); CREATE TABLE trip_assignments(resource_type TEXT,resource_id INTEGER,trip_id INTEGER)');
        $p->prepare("INSERT INTO personnel VALUES(1,'Fixture Person',1,'Available',?,?,?)")->execute([$type,$number,$expiry]);return $p;
    }
}
