<?php
declare(strict_types=1);

/**
 * Read-only executive oversight. Departmental teams retain resource management.
 * The only Head Management-owned operational masterlist is Clients.
 */
final class HeadManagement {
    public static function read(array $u,string $page,array $q): array {
        requireRole($u,'admin');
        $p=db();
        if($page==='head-fleet') return readSections([
            'vehicles'=>fn()=>many($p,"SELECT v.id,v.plate_number,v.truck_type,v.status,v.active,
                d.full_name AS driver_name,h.full_name AS helper_name,
                (SELECT t.trip_ref FROM trips t WHERE t.vehicle_id=v.id AND t.status IN ('Dispatched','In Transit') ORDER BY t.id DESC LIMIT 1) AS active_trip
                FROM vehicles v LEFT JOIN personnel d ON d.id=v.assigned_driver_id
                LEFT JOIN personnel h ON h.id=v.assigned_helper_id ORDER BY v.active DESC,v.truck_type,v.plate_number LIMIT 500"),
            'personnel'=>fn()=>many($p,"SELECT pe.id,pe.full_name,pe.person_type,pe.availability,pe.active,
                v.plate_number AS regular_truck
                FROM personnel pe LEFT JOIN vehicles v ON (v.assigned_driver_id=pe.id OR v.assigned_helper_id=pe.id) AND v.active=1
                ORDER BY pe.active DESC,pe.person_type,pe.full_name LIMIT 700"),
            'mechanics'=>fn()=>many($p,"SELECT m.id,m.full_name,m.active,
                (SELECT COUNT(*) FROM maintenance_jobs j WHERE j.assigned_mechanic_id=m.id AND j.status NOT IN ('Completed','Cancelled')) AS open_jobs
                FROM mechanics m ORDER BY m.active DESC,m.full_name LIMIT 200"),
        ]);
        if($page==='head-approvals') return readSections([
            'route_rates'=>fn()=>many($p,"SELECT r.id,r.route_ref,r.origin_label,r.destination_label,c.company_name,
                rt.id AS rate_id,rt.rate_amount,rt.entered_at
                FROM client_route_rates rt JOIN client_routes r ON r.id=rt.route_id
                JOIN clients c ON c.id=r.client_id
                WHERE rt.status='Pending Approval' ORDER BY rt.entered_at ASC LIMIT 100"),
            'maintenance'=>fn()=>many($p,"SELECT j.id,j.job_ref,j.status,j.problem,v.plate_number
                FROM maintenance_jobs j JOIN vehicles v ON v.id=j.vehicle_id
                WHERE j.status NOT IN ('Completed','Cancelled') ORDER BY j.id DESC LIMIT 100"),
            'incidents'=>fn()=>many($p,"SELECT i.id,i.incident_ref,i.status,t.trip_ref
                FROM incidents i LEFT JOIN trips t ON t.id=i.trip_id
                WHERE i.status<>'Resolved' ORDER BY i.id DESC LIMIT 100"),
            'funds'=>fn()=>many($p,"SELECT f.id,f.fund_ref,f.status,t.trip_ref
                FROM fund_requests f JOIN trips t ON t.id=f.trip_id
                WHERE f.status='Pending Approval' ORDER BY f.id DESC LIMIT 100"),
        ]);
        throw new BusinessRuleException('Unknown oversight page.',404);
    }
    public static function action(array $u,string $action,array $d): array {
        requireRole($u,'admin');
        throw new BusinessRuleException('Management oversight is read-only. Use the authorized department workflow.',403);
    }
}
