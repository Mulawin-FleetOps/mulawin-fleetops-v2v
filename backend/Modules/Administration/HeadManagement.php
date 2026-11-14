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
        if ($page === 'head-trips') return self::tripsRead($p);
        if($page==='head-fleet') return readSections([
            'fleet_summary'=>fn()=>one($p,"SELECT
                (SELECT COUNT(*) FROM vehicles) AS total_trucks,
                (SELECT COUNT(*) FROM vehicles WHERE active=1 AND status='Available') AS available_trucks,
                (SELECT COUNT(*) FROM personnel WHERE active=1 AND person_type IN ('Driver','Helper')) AS active_crew,
                (SELECT COUNT(*) FROM vehicles WHERE active=1 AND status='Under Maintenance') AS under_maintenance"),
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
                (SELECT COUNT(*) FROM maintenance_jobs j WHERE j.active_mechanic=m.id AND j.status NOT IN ('Completed','Cancelled')) AS open_jobs
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
    /** Executive read projection: no operational actions, sensitive documents or mutations. */
    private static function tripsRead(PDO $p): array {
        return readSections([
            'summary' => fn() => one($p, "SELECT
                COUNT(*) AS total,
                COALESCE(SUM(status IN ('Pending Review','Awaiting Resources','Pre-Assigned','Ready for Dispatch','For Reschedule')),0) AS scheduled,
                COALESCE(SUM(status IN ('Dispatched','In Transit','On Hold - Incident Reported')),0) AS ongoing,
                COALESCE(SUM(status='Completed' AND DATE(completed_at)=CURDATE()),0) AS completed_today,
                COALESCE(SUM(status IN ('On Hold - Incident Reported','For Reschedule') OR (status IN ('Pending Review','Awaiting Resources','Pre-Assigned','Ready for Dispatch') AND scheduled_at<NOW())),0) AS delayed_problem
                FROM trips"),
            'active' => fn() => self::tripRows($p, false),
            // A saved, verifiable route geometry, not a simulated GPS location.
            'route_preview' => fn() => one($p, "SELECT t.id,t.trip_ref,t.pickup_point,t.delivery_point,
                t.pickup_lat,t.pickup_lng,t.delivery_lat,t.delivery_lng,r.geometry AS route_geometry
                FROM trips t JOIN trip_routes r ON r.trip_id=t.id
                WHERE r.geometry IS NOT NULL AND LENGTH(r.geometry)>10
                  AND t.pickup_lat IS NOT NULL AND t.pickup_lng IS NOT NULL
                  AND t.delivery_lat IS NOT NULL AND t.delivery_lng IS NOT NULL
                ORDER BY t.scheduled_at DESC,t.id DESC LIMIT 1"),

            'history' => fn() => self::tripRows($p, true),
            'incidents' => fn() => many($p, "SELECT i.id,i.trip_id,i.incident_ref,i.status,i.severity,i.incident_at,
                t.trip_ref,c.company_name AS client,v.plate_number
                FROM incidents i JOIN trips t ON t.id=i.trip_id
                JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=i.vehicle_id
                ORDER BY i.id DESC LIMIT 300"),
        ]);
    }

    private static function tripRows(PDO $p,bool $closed): array {
        $status=$closed ? "IN ('Completed','Cancelled','Rejected')" : "NOT IN ('Completed','Cancelled','Rejected')";
        return many($p, "SELECT t.id,t.trip_ref,t.status,t.pickup_point,t.delivery_point,t.truck_type,
            t.scheduled_at,t.dispatched_at,t.completed_at,t.dispatcher_shift,
            c.company_name AS client,v.plate_number,
            d.full_name AS driver_name,h.full_name AS helper_name, d2.full_name AS driver2_name,
            COALESCE(owner.full_name,dispatcher.full_name) AS dispatcher_name,
            (SELECT COUNT(*) FROM incidents i WHERE i.trip_id=t.id AND i.status<>'Resolved') AS open_incidents
            FROM trips t JOIN clients c ON c.id=t.client_id
            LEFT JOIN vehicles v ON v.id=t.vehicle_id
            LEFT JOIN personnel d ON d.id=t.driver_id
            LEFT JOIN personnel h ON h.id=t.helper_id
            LEFT JOIN personnel d2 ON d2.id=t.driver2_id
            LEFT JOIN users dispatcher ON dispatcher.id=t.dispatcher_id
            LEFT JOIN trip_responsibilities rsp ON rsp.trip_id=t.id
            LEFT JOIN users owner ON owner.id=rsp.current_dispatcher_id
            WHERE t.status $status
            ORDER BY t.scheduled_at DESC,t.id DESC LIMIT 500");
    }

    private static function tripDetails(PDO $p,array $d): array {
        $id=idField($d,'trip_id');
        $trip=one($p,"SELECT t.id,t.trip_ref,t.status,t.scheduled_at,t.dispatched_at,t.completed_at,
            t.pickup_point,t.delivery_point,t.truck_type,t.dispatcher_shift,t.delivery_notes,
            c.company_name AS client,v.plate_number,d.full_name AS driver_name,
            d2.full_name AS driver2_name,h.full_name AS helper_name,
            COALESCE(owner.full_name,dispatcher.full_name) AS dispatcher_name,
            f.status AS fund_status,f.amount AS fund_amount
            FROM trips t JOIN clients c ON c.id=t.client_id
            LEFT JOIN vehicles v ON v.id=t.vehicle_id
            LEFT JOIN personnel d ON d.id=t.driver_id
            LEFT JOIN personnel d2 ON d2.id=t.driver2_id
            LEFT JOIN personnel h ON h.id=t.helper_id
            LEFT JOIN users dispatcher ON dispatcher.id=t.dispatcher_id
            LEFT JOIN trip_responsibilities rsp ON rsp.trip_id=t.id
            LEFT JOIN users owner ON owner.id=rsp.current_dispatcher_id
            LEFT JOIN fund_requests f ON f.trip_id=t.id AND f.attempt_number=t.attempt_number
            WHERE t.id=?",[$id]);
        must((bool)$trip,'Trip not found.',404);
        return [
            'trip'=>$trip,
            'events'=>many($p,"SELECT e.event_type,e.from_status,e.to_status,e.notes,e.created_at,
                u.full_name AS actor FROM trip_events e LEFT JOIN users u ON u.id=e.actor_id
                WHERE e.trip_id=? ORDER BY e.id DESC LIMIT 100",[$id]),
            'updates'=>many($p,"SELECT up.update_type,up.delay_cause,up.note,up.created_at,
                u.full_name AS actor FROM trip_updates up LEFT JOIN users u ON u.id=up.actor_id
                WHERE up.trip_id=? ORDER BY up.id DESC LIMIT 100",[$id]),
            'incidents'=>many($p,"SELECT incident_ref,status,severity,incident_at,problem
                FROM incidents WHERE trip_id=? ORDER BY id DESC LIMIT 50",[$id]),
            'read_only'=>true,
        ];
    }

    public static function action(array $u,string $action,array $d): array {
        requireRole($u,'admin');
        if ($action === 'trip_details') return self::tripDetails(db(),$d);
        throw new BusinessRuleException('Management oversight is read-only. Use the authorized department workflow.',403);
    }
}
