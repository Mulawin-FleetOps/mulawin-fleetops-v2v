"""
tests/e2e_workflow.py — developer end-to-end test of the whole PDF workflow through the API.
Use ONLY on an empty TEST database (it creates test users and records).
Needs: Python 3 + requests, the app running at BASE, and the mysql command line (MYSQL env var).
Usage: python tests/e2e_workflow.py <temporary password of admin1 created with scripts/create_user.php>
"""
import os
import requests, subprocess, sys, json

BASE = os.environ.get('FMS_URL', 'http://127.0.0.1:8080/index.php')
PW = 'TestPass12345'
fails = []

def sql(q):
    return subprocess.run(os.environ.get('MYSQL', 'mysql -u root mulawin_v2').split() + ['-N', '-e', q], capture_output=True, text=True).stdout.strip()

class S:
    def __init__(self, user, pw=PW):
        self.s = requests.Session(); self.user = user
        w = self.s.get(BASE, params={'api': 'whoami'}).json(); self.csrf = w['csrf']
        r = self.s.post(BASE + '?api=login', json={'username': user, 'password': pw, 'csrf': self.csrf}).json()
        assert r.get('ok'), (user, r)
        me = self.s.get(BASE, params={'api': 'me'}).json(); self.csrf = me['csrf']; self.me = me
    def act(self, name, data=None, expect_ok=True, label=''):
        r = self.s.post(BASE + '?api=' + name, json=data or {}, headers={'X-CSRF-Token': self.csrf})
        try: j = r.json()
        except Exception: j = {'ok': False, 'error': 'NON-JSON ' + r.text[:300]}
        if bool(j.get('ok')) != expect_ok:
            fails.append(f'{self.user} {name} {label}: expected ok={expect_ok}, got {j}')
            print('  FAIL', self.user, name, label, j)
        else:
            print('  ok  ', self.user, name, label, (j.get('data') or {}).get('message') or (j.get('error') or ''))
        return j.get('data') or j
    def page(self, page, **q):
        r = self.s.get(BASE, params={'api': 'data', 'page': page, **q})
        j = r.json()
        if not j.get('ok'): fails.append(f'{self.user} page {page}: {j}'); print('  FAIL page', self.user, page, j); return {}
        if j['data'].get('_errors'): fails.append(f'{self.user} page {page} section errors: {j["data"]["_errors"]}'); print('  FAIL sections', page, j['data']['_errors'])
        return j['data']

def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: fails.append(msg)

# ---------------------------------------------------------------- setup
admin_pw = sys.argv[1]
a = S('admin1', admin_pw)
a.act('Admin.change_password', {'current_password': admin_pw, 'new_password': PW})
a = S('admin1')
roles = ['operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher', 'motorpool', 'purchasing', 'finance', 'billing', 'payroll', 'audit']
for r in roles:
    a.act('Admin.user_save', {'username': r, 'full_name': r.replace('_', ' ').title(), 'role': r, 'password': 'Temp12345678', 'shift': 'Day'})
sql("UPDATE users SET must_change_password=0, password_hash=(SELECT password_hash FROM (SELECT password_hash FROM users WHERE username='admin1') x)")
U = {r: S(r) for r in roles}; U['admin'] = a
ops, ccd, cwd, mp, pur, fin, bil, pay, aud = (U[r] for r in roles)

print('== master data')
a.act('Admin.setting_save', {'key': 'inspection_min_minutes', 'value': '0'})
bil.act('Billing.client_save', {'name': 'MMPC', 'company_name': 'RVL MOVERS', 'payment_terms_days': 30})
bil.act('Billing.client_save', {'name': 'COCA COLA', 'company_name': 'CJ SMART FREIGHT, INC.', 'payment_terms_days': 15})
ops.act('Billing.route_save', {'origin': 'BATANGAS PORT', 'destination': 'NYK CABUYAO', 'distance_km': 143, 'toll_fee': 651})
ops.act('Billing.route_save', {'origin': '106 STA ROSA', 'destination': 'TARLAC', 'distance_km': 700, 'toll_fee': 1200})
cl = {c['name']: c['id'] for c in bil.page('clients')['clients']}; rt = {r['destination']: r['id'] for r in bil.page('clients')['routes']}
bil.act('Billing.rate_save', {'client_id': cl['MMPC'], 'route_id': rt['NYK CABUYAO'], 'truck_type': 'Car Carrier', 'rate_basis': 'Per Trip', 'amount': 15000, 'status': 'Active'})
bil.act('Billing.rate_save', {'client_id': cl['COCA COLA'], 'route_id': rt['TARLAC'], 'truck_type': 'Container', 'rate_basis': 'Per Trip', 'amount': 38000, 'status': 'Active'})
for name, t, lic in [('JUEGOS, HECTOR', 'Driver', '2028-01-01'), ('MAYORDO, ARNOLD', 'Driver', '2028-01-01'), ('RUBIA, RICKY', 'Driver', '2028-01-01'),
                     ('EXPIRED, DRIVER', 'Driver', '2020-01-01'), ('SABA, MAURICIO', 'Helper', None), ('ALEGADO, ANDRO', 'Helper', None)]:
    a.act('Fleet.person_save', {'full_name': name, 'person_type': t, 'employment_type': 'Employee', 'employment_status': 'Active', 'license_expiry': lic or '',
                                'pay_frequency': 'Weekly', 'daily_rate': 600, 'payroll_group': 'South Carrier' if t == 'Driver' else 'South Container'})
a.act('Fleet.person_save', {'full_name': 'NO LICENSE', 'person_type': 'Driver', 'employment_type': 'Employee', 'employment_status': 'Active', 'pay_frequency': 'Weekly'}, expect_ok=False, label='(driver without license must fail)')
for plate, t in [('NAJ5941', 'Car Carrier'), ('NBA1770', 'Car Carrier'), ('CBJ4550', 'Container'), ('CCE3646', 'Wing Van')]:
    a.act('Fleet.vehicle_save', {'plate_number': plate, 'truck_type': t, 'odometer_km': 50000, 'km_since_pm': 9900 if plate == 'NAJ5941' else 0, 'registration_expiry': '2026-11-10', 'insurance_expiry': '2027-05-01'})
a.act('Fleet.vehicle_save', {'plate_number': 'NAJ5941', 'truck_type': 'Car Carrier'}, expect_ok=False, label='(duplicate plate)')
pp = {p['full_name']: p['id'] for p in a.page('crew')['people']}
pay.act('Payroll.rate_save', {'route_id': rt['NYK CABUYAO'], 'truck_type': 'Car Carrier', 'driver_rate': 800, 'helper_rate': 500})

print('== Scenario A: Ops Head car carrier trip (fund before checklist, minor incident)')
r = ops.act('Trips.create', {'client_id': cl['MMPC'], 'route_id': rt['NYK CABUYAO'], 'scheduled_at': '2026-10-31T08:00', 'truck_type': 'Car Carrier'})
t1 = r['trip_id']
trip = sql(f"SELECT status, vehicle_id IS NOT NULL, driver_id, driver2_id, client_rate, units_planned FROM trips WHERE id={t1}")
print('   trip:', trip)
check(trip.startswith('Pre-Assigned'), 'Scenario A auto-assigned -> Pre-Assigned')
check(str(pp['EXPIRED, DRIVER']) not in trip.split('\t')[2:4], 'expired-license driver not assigned')
check(sql(f"SELECT COUNT(*) FROM fund_requests WHERE trip_id={t1}") == '0', 'no automatic fund (dispatcher submits it)')
cats = ccd.page('trips')['fundCategories']
check([c['name'] for c in cats] == ['Forklift Operator', 'Checker', 'Passway', 'Driver Meal Allowance', 'Helper Meal Allowance'] and sum(c['amount'] for c in cats) == 900, f'5 preset categories from the PDF ({cats})')
cwd.act('Funds.request', {'trip_id': t1, 'categories': ['Checker']}, expect_ok=False, label='(other dispatcher team blocked)')
ops.act('Funds.request', {'trip_id': t1, 'categories': ['Checker']}, expect_ok=False, label='(only the dispatcher submits)')
ccd.act('Funds.request', {'trip_id': t1, 'categories': []}, expect_ok=False, label='(needs a category)')
ccd.act('Funds.request', {'trip_id': t1, 'categories': ['Fuel']}, expect_ok=False, label='(unknown category)')
ccd.act('Funds.request', {'trip_id': t1, 'categories': ['Forklift Operator', 'Checker', 'Driver Meal Allowance'], 'extra': [{'name': 'Parking', 'amount': 50}]})
fund = sql(f"SELECT id, amount, approver_role, status, requested_by IS NOT NULL FROM fund_requests WHERE trip_id={t1}").split('\t')
check(fund[1] == '550.00' and fund[2] == 'operations_head' and fund[3] == 'Pending Approval' and fund[4] == '1', f'fund 100+100+300+50 = 550, Ops Head, Pending Approval ({fund})')
f1 = int(fund[0])
ccd.act('Funds.request', {'trip_id': t1, 'categories': ['Checker']}, expect_ok=False, label='(already has a request)')
fin.act('Funds.approve', {'fund_id': f1}, expect_ok=False, label='(finance cannot approve)')
a.act('Funds.approve', {'fund_id': f1}, expect_ok=False, label='(admin no longer approves funds)')
fin.act('Funds.release', {'fund_id': f1, 'payment_method': 'Cash', 'released_on': '2026-10-31'}, expect_ok=False, label='(not approved yet)')
ops.act('Funds.approve', {'fund_id': f1})
check(sql(f'SELECT status FROM fund_requests WHERE id={f1}') == 'Ready for Release', 'approve -> Ready for Release')
fin.act('Funds.release', {'fund_id': f1, 'payment_method': 'Cheque', 'released_on': '2026-10-31'}, expect_ok=False, label='(cheque needs number)')
fin.act('Funds.release', {'fund_id': f1, 'payment_method': 'Cash', 'released_on': '2026-10-31', 'reference_number': 'CV-1'}, label='(release before checklist)')
check(sql(f'SELECT status FROM fund_requests WHERE id={f1}') == 'Released', 'fund Released before checklist')
ccd.act('Trips.dispatch', {'trip_id': t1}, expect_ok=False, label='(dispatch before checklist blocked)')
cwd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Departure'}, expect_ok=False, label='(other dispatcher team blocked)')
ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Departure'})
tpl = ccd.page('trips')['checklist']
items_ok = {f"{s['key']}_{i+1:02d}": {'condition': 'OK', 'remarks': ''} for s in tpl for i in range(len(s['items']))}
check(len(items_ok) == 57, '57 checklist items')
bad = dict(items_ok); bad['tractor_head_18'] = {'condition': 'NOT OK', 'remarks': 'flat tire'}
r = ccd.act('Trips.checklist_departure', {'trip_id': t1, 'items': bad, 'meta': {}, 'odometer_km': 50000}, label='(NOT OK)')
check(sql(f'SELECT status FROM trips WHERE id={t1}') == 'Pre-Assigned', 'NOT OK keeps trip Pre-Assigned')
ccd.act('Trips.checklist_departure', {'trip_id': t1, 'items': items_ok, 'meta': {}, 'odometer_km': 50000}, expect_ok=False, label='(must restart checklist)')
ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Departure'})
ccd.act('Trips.checklist_departure', {'trip_id': t1, 'items': items_ok, 'meta': {'driver_1': 'x'}, 'odometer_km': 50000, 'fuel_level': 'Full'})
check(sql(f'SELECT status FROM trips WHERE id={t1}') == 'Ready for Dispatch', 'Ready for Dispatch')
ccd.act('Trips.dispatch', {'trip_id': t1}, label='(fund Released + Ready for Dispatch, no Ops clearance needed)')
check(sql(f'SELECT status FROM trips WHERE id={t1}') == 'Dispatched', 'trip Dispatched')
check(sql(f'SELECT status FROM fund_requests WHERE id={f1}') == 'Completed', 'fund Completed at dispatch')
check(sql(f'SELECT v.status FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id={t1}') == 'On Trip', 'truck On Trip')
# PDF v7: ongoing trip -> system creates a billing draft based on the route (client rate 15000 Per Trip)
check(sql(f"SELECT CONCAT(status,'|',rate_basis,'|',rate,'|',amount) FROM billing_drafts WHERE trip_id={t1}") == 'Draft|Per Trip|15000.00|15000.00', 'billing draft created at dispatch from the route rate')
d1 = sql(f'SELECT id FROM billing_drafts WHERE trip_id={t1}')
bil.act('Billing.draft_finalize', {'draft_id': d1}, expect_ok=False, label='(trip still ongoing: cannot finalize)')
bil.act('Billing.draft_verify', {'draft_id': d1}, expect_ok=False, label='(no waybill yet: cannot verify)')
ccd.act('Trips.progress', {'trip_id': t1, 'update_type': 'Delay', 'delay_cause': 'Client', 'note': 'Waiting for units'})
print('-- Scenario C.1: minor damage')
ccd.act('Trips.incident', {'trip_id': t1, 'location': '', 'details': 'x', 'problem': 'y'}, expect_ok=False, label='(location required)')
ccd.act('Trips.incident', {'trip_id': t1, 'incident_at': '2026-10-31T10:15', 'location': 'SLEX', 'details': 'Driver called: tire burst', 'problem': 'Flat tire'})
check(sql(f'SELECT status FROM trips WHERE id={t1}') == 'On Hold - Incident Reported', 'incident -> On Hold - Incident Reported')
inc1 = sql(f'SELECT id, severity IS NULL, status FROM incidents WHERE trip_id={t1}').split('\t')
check(inc1[1] == '1' and inc1[2] == 'Reported', 'severity not set by dispatcher; Maintenance assesses')
job1 = sql(f"SELECT id FROM maintenance_jobs WHERE incident_id={inc1[0]}")
ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Arrival'}, expect_ok=False, label='(arrival blocked while on hold)')
ccd.act('Trips.resume', {'trip_id': t1}, expect_ok=False, label='(not repaired yet)')
mp.act('Maintenance.job_complete', {'job_id': job1}, expect_ok=False, label='(assess first)')
ccd.act('Maintenance.assess', {'job_id': job1, 'severity': 'Minor'}, expect_ok=False, label='(dispatcher cannot assess)')
mp.act('Maintenance.assess', {'job_id': job1, 'severity': 'Minor', 'assigned_to': 'Mechanic Jun', 'notes': 'replace tire on site'})
check(sql(f'SELECT status, severity FROM incidents WHERE id={inc1[0]}') == 'Under Repair\tMinor', 'minor: Under Repair')
check(sql(f'SELECT maintenance_type, status FROM maintenance_jobs WHERE id={job1}') == 'Roadside Repair\tIn Progress', 'minor: roadside repair job in progress')
mp.act('Maintenance.job_complete', {'job_id': job1, 'notes': 'tire replaced'})
check(sql(f'SELECT status FROM incidents WHERE id={inc1[0]}') == 'Repaired - Cleared to Continue', 'Repaired - Cleared to Continue')
check(sql(f'SELECT v.status FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id={t1}') == 'On Trip', 'minor: truck stays On Trip')
ccd.act('Trips.resume', {'trip_id': t1})
check(sql(f'SELECT status, attempt_number FROM trips WHERE id={t1}') == 'In Transit\t1', 'resume -> In Transit, not a second attempt')
ccd.act('Trips.waybill_add', {'trip_id': t1, 'waybill_number': '32451', 'units': 5})
ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Arrival'})
ccd.act('Trips.arrival', {'trip_id': t1, 'items': items_ok, 'meta': {}, 'odometer_km': 49000, 'delivery_notes': 'ok'}, expect_ok=False, label='(odometer lower)')
ccd.act('Trips.arrival', {'trip_id': t1, 'items': items_ok, 'meta': {}, 'odometer_km': 50150, 'delivery_notes': 'Delivered 5 units', 'units_delivered': 5})
vid1 = sql(f'SELECT vehicle_id FROM trips WHERE id={t1}')
print('   vehicle km:', sql(f'SELECT plate_number, km_since_pm, odometer_km FROM vehicles WHERE id={vid1}'))
ccd.act('Trips.complete', {'trip_id': t1})
print('   truck after complete:', sql(f'SELECT plate_number, status, km_since_pm FROM vehicles WHERE id={vid1}'))
mpjobs = sql(f"SELECT maintenance_type, status FROM maintenance_jobs WHERE vehicle_id={vid1}")
print('   jobs on truck:', mpjobs.replace('\n', ' | '))

print('== Scenario B: container dispatcher, fund rejected and revised, major damage, second attempt')
r = cwd.act('Trips.create', {'client_id': cl['COCA COLA'], 'route_id': rt['TARLAC'], 'scheduled_at': '2026-10-31T10:00', 'truck_type': 'Container', 'container_number': 'EGSU2195124', 'container_size': '1X20'})
t2 = r['trip_id']
check(sql(f'SELECT status FROM trips WHERE id={t2}') == 'Pending Review', 'Scenario B -> Pending Review')
cwd.act('Trips.review', {'trip_id': t2, 'decision': 'approve', 'truck_type': 'Container'}, expect_ok=False, label='(only Ops Head reviews)')
ops.act('Trips.review', {'trip_id': t2, 'decision': 'approve', 'truck_type': 'Container'})
check(sql(f'SELECT status FROM trips WHERE id={t2}') == 'Pre-Assigned', 'confirmed -> Pre-Assigned')
cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Departure'}, expect_ok=False, label='(container needs booking + pre-advice first)')
cwd.act('Trips.details', {'trip_id': t2, 'client_confirmed': 1, 'pre_advice_sent': 1, 'booking_reference': 'NOM-1'})
cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Departure'})
cwd.act('Trips.checklist_departure', {'trip_id': t2, 'items': items_ok, 'meta': {}, 'odometer_km': 50000})
check(sql(f'SELECT status FROM trips WHERE id={t2}') == 'Ready for Dispatch', 'checklist before fund -> Ready for Dispatch')
cwd.act('Trips.dispatch', {'trip_id': t2}, expect_ok=False, label='(no fund yet)')
cwd.act('Funds.request', {'trip_id': t2, 'categories': ['Checker', 'Passway', 'Driver Meal Allowance', 'Helper Meal Allowance']})
f2 = sql(f'SELECT id, amount FROM fund_requests WHERE trip_id={t2}').split('\t')
check(f2[1] == '800.00', f'fund 100+200+300+200 = 800 ({f2})')
ops.act('Funds.reject', {'fund_id': f2[0], 'reason': 'add forklift'})
check(sql(f'SELECT status FROM fund_requests WHERE id={f2[0]}') == 'Rejected', 'rejected -> back to dispatcher')
cwd.act('Funds.request', {'trip_id': t2, 'categories': ['Checker']}, expect_ok=False, label='(use revise for rejected)')
ccd.act('Funds.revise', {'fund_id': f2[0], 'categories': ['Checker']}, expect_ok=False, label='(other team cannot revise)')
cwd.act('Funds.revise', {'fund_id': f2[0], 'categories': ['Forklift Operator', 'Checker', 'Passway', 'Driver Meal Allowance', 'Helper Meal Allowance'], 'extra': [{'name': 'Special handling', 'amount': 20000}]})
f2b = sql(f'SELECT status, amount, approver_role FROM fund_requests WHERE id={f2[0]}').split('\t')
check(f2b == ['Pending Approval', '20900.00', 'operations_head'], f'revised 900 + 20000 = 20900, still Ops Head (no 15k limit) ({f2b})')
ops.act('Funds.approve', {'fund_id': f2[0]})
cwd.act('Trips.dispatch', {'trip_id': t2}, expect_ok=False, label='(fund Ready for Release, not Released)')
fin.act('Funds.release', {'fund_id': f2[0], 'payment_method': 'Bank Transfer', 'released_on': '2026-10-31', 'reference_number': 'BT-77'})
cwd.act('Trips.dispatch', {'trip_id': t2})
print('-- Scenario C.2: major damage')
cwd.act('Trips.incident', {'trip_id': t2, 'location': 'NLEX', 'details': 'Engine overheat', 'problem': 'Engine'})
v2 = sql(f'SELECT vehicle_id FROM trips WHERE id={t2}')
job2 = sql(f"SELECT id FROM maintenance_jobs WHERE vehicle_id={v2} AND status<>'Completed'")
mp.act('Maintenance.assess', {'job_id': job2, 'severity': 'Major', 'notes': 'tow back to yard'})
check(sql(f'SELECT status FROM trips WHERE id={t2}') == 'For Reschedule', 'major: trip For Reschedule')
check(sql(f'SELECT status FROM vehicles WHERE id={v2}') == 'Under Maintenance', 'major: truck Under Maintenance')
mp.act('Maintenance.assess', {'job_id': job2, 'severity': 'Minor'}, expect_ok=False, label='(already assessed)')
cwd.act('Trips.reschedule', {'trip_id': t2, 'scheduled_at': '2026-11-01T06:00'}, expect_ok=False, label='(truck not repaired yet)')
mp.act('Fleet.vehicle_status', {'vehicle_id': v2, 'status': 'Available'}, expect_ok=False, label='(open job blocks Available)')
mp.act('Maintenance.cost_add', {'job_id': job2, 'cost_type': 'Labor', 'description': 'mechanic', 'amount': 2500, 'incurred_on': '2026-10-31'})
mp.act('Maintenance.job_complete', {'job_id': job2})
check(sql(f'SELECT status FROM vehicles WHERE id={v2}') == 'Available', 'repaired truck Available')
cwd.act('Trips.reschedule', {'trip_id': t2, 'scheduled_at': '2026-11-01T06:00'})
check(sql(f'SELECT status, attempt_number FROM trips WHERE id={t2}') == 'Pre-Assigned\t2', 'rescheduled: Pre-Assigned, attempt #2')
cwd.act('Trips.dispatch', {'trip_id': t2}, expect_ok=False, label='(checklist again first)')
cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Departure'})
cwd.act('Trips.checklist_departure', {'trip_id': t2, 'items': items_ok, 'meta': {}, 'odometer_km': 50020})
cwd.act('Trips.dispatch', {'trip_id': t2}, label='(Confirm Redispatch, fund optional)')
check(sql(f'SELECT status FROM trips WHERE id={t2}') == 'Dispatched', 'redispatched')
check(sql(f"SELECT COUNT(*) FROM trip_events WHERE trip_id={t2} AND event_type='redispatch confirmed (Second Attempt)'") == '1', 'Second Attempt recorded on the same trip')
check(sql(f'SELECT COUNT(*) FROM inspections WHERE trip_id={t2} AND inspection_type=\'Departure\'') == '2', 'both checklists kept (attempt 1 and 2)')
cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Arrival'})
cwd.act('Trips.arrival', {'trip_id': t2, 'items': items_ok, 'meta': {}, 'odometer_km': 50720, 'delivery_notes': 'ok'})
cwd.act('Trips.waybill_add', {'trip_id': t2, 'waybill_number': '5212'})
cwd.act('Trips.complete', {'trip_id': t2})

print('== Wing van: awaiting resources (no helper free) and cancel')
r = ops.act('Trips.create', {'client_id': cl['MMPC'], 'origin': 'A', 'destination': 'B', 'distance_km': 40, 'scheduled_at': '2026-10-31T09:00', 'truck_type': 'Wing Van'})
t3 = r['trip_id']
print('   wing van trip status:', sql(f'SELECT status FROM trips WHERE id={t3}'))
ops.act('Trips.cancel', {'trip_id': t3, 'reason': 'client cancelled'})

print('== Purchasing and inventory')
pur.act('Purchasing.supplier_save', {'name': 'Petron Parts'})
pur.act('Purchasing.part_save', {'part_number': 'TIRE-1', 'description': 'Truck tire 11R22.5', 'unit': 'pc', 'unit_cost': 6000, 'reorder_level': 2})
pid = sql("SELECT id FROM parts WHERE part_number='TIRE-1'"); sup = sql("SELECT id FROM suppliers LIMIT 1")
pur.act('Purchasing.adjust', {'part_id': pid, 'quantity': 3, 'reason': 'Opening balance (verified count)'})
mp.act('Maintenance.part_request', {'vehicle_id': vid1, 'part_id': pid, 'quantity': 2})
rq = sql("SELECT id FROM part_requests ORDER BY id DESC LIMIT 1")
pur.act('Purchasing.issue', {'request_id': rq})
check(sql(f'SELECT quantity_on_hand FROM parts WHERE id={pid}') == '1', 'stock out 3-2 = 1')
pur.act('Purchasing.pr_create', {'part_id': pid, 'quantity': 2, 'unit_cost': 6000, 'supplier_id': sup})
pr1 = sql("SELECT id, approver_role FROM purchase_requests ORDER BY id DESC LIMIT 1").split('\t')
check(pr1[1] == 'admin', '12000 > 10000 -> Admin')
a.act('Purchasing.decide', {'purchase_id': pr1[0], 'decision': 'approve'}, expect_ok=False, label='(no budget yet)')
fin.act('Finance.budget_set', {'category': 'Purchasing', 'budget_amount': 10000})
r = a.act('Purchasing.decide', {'purchase_id': pr1[0], 'decision': 'approve'})
check(sql(f'SELECT status FROM purchase_requests WHERE id={pr1[0]}') == 'Rejected - Insufficient Budget', 'system rejects: insufficient budget')
pur.act('Purchasing.pr_create', {'part_id': pid, 'quantity': 1, 'unit_cost': 6000, 'supplier_id': sup})
pr2 = sql("SELECT id, approver_role FROM purchase_requests ORDER BY id DESC LIMIT 1").split('\t')
check(pr2[1] == 'finance', '6000 <= 10000 -> Finance')
fin.act('Purchasing.decide', {'purchase_id': pr2[0], 'decision': 'approve'})
pur.act('Purchasing.po_create', {'purchase_id': pr2[0], 'ordered_on': '2026-10-31'})
po = sql('SELECT id FROM purchase_orders ORDER BY id DESC LIMIT 1')
pur.act('Purchasing.receive', {'order_id': po, 'quantity': 1, 'received_on': '2026-10-31', 'receipt_reference': 'DR-9'})
check(sql(f'SELECT quantity_on_hand FROM parts WHERE id={pid}') == '2', 'stock in +1 = 2')
check(sql("SELECT COUNT(*) FROM accounts_payable WHERE source='Purchase Order'") == '1', 'payable created')
apid = sql("SELECT id FROM accounts_payable LIMIT 1")
fin.act('Finance.payable_pay', {'payable_id': apid, 'amount': 6000, 'payment_method': 'Cheque', 'cheque_number': '000123', 'bank_name': 'BDO', 'released_on': '2026-10-31'})

print('== Billing')
check(sql(f'SELECT COUNT(*) FROM billing_drafts WHERE trip_id={t2}') == '1', 'one billing draft for the trip even with a Second Attempt')
fin.act('Billing.draft_finalize', {'draft_id': d1}, expect_ok=False, label='(only Billing finalizes)')
bil.act('Billing.draft_finalize', {'draft_id': d1}, expect_ok=False, label='(documents not verified yet)')
bil.act('Billing.invoice_create', {'client_id': cl['MMPC'], 'invoice_number': 'INV-000', 'invoice_date': '2026-10-31', 'draft_ids': [d1]}, expect_ok=False, label='(draft not finalized: no invoice)')
bil.act('Billing.draft_update', {'draft_id': d1, 'rate_basis': 'Per Trip', 'quantity': 1, 'rate': 15000, 'description': 'TRP car carrier MMPC'})
bil.act('Billing.draft_verify', {'draft_id': d1, 'docs_note': 'waybill 32451 checked'})
bil.act('Billing.draft_finalize', {'draft_id': d1})
check(sql(f'SELECT status FROM billing_drafts WHERE id={d1}') == 'Finalized', 'billing finalized (Completed + verified)')
bil.act('Billing.draft_update', {'draft_id': d1, 'rate_basis': 'Per Trip', 'quantity': 1, 'rate': 1}, expect_ok=False, label='(finalized: edit blocked)')
r = bil.act('Billing.invoice_create', {'client_id': cl['MMPC'], 'invoice_number': 'INV-001', 'invoice_date': '2026-10-31', 'draft_ids': [d1]})
bid = sql("SELECT id, due_date, net_amount FROM billings WHERE invoice_number='INV-001'").split('\t')
check(bid[1] == '2026-11-30', 'due date = invoice + 30 day terms')
check(bid[2] == '15000.00', 'invoice amount from the finalized billing')
check(sql(f'SELECT CONCAT(status,"|",billing_id) FROM billing_drafts WHERE id={d1}') == f'Invoiced|{bid[0]}', 'billing marked Invoiced')
bil.act('Billing.invoice_create', {'client_id': cl['MMPC'], 'invoice_number': 'INV-002', 'invoice_date': '2026-10-31', 'draft_ids': [d1]}, expect_ok=False, label='(trip billed twice)')
bil.act('Billing.collection_add', {'billing_id': bid[0], 'amount': 5000, 'payment_date': '2026-10-31', 'payment_method': 'Cash', 'reference': 'OR-1'})
bil.act('Billing.collection_add', {'billing_id': bid[0], 'amount': 20000, 'payment_date': '2026-10-31', 'payment_method': 'Cash', 'reference': 'OR-2'}, expect_ok=False, label='(over balance)')
check(sql(f'SELECT status FROM billings WHERE id={bid[0]}') == 'Partially Paid', 'partially paid')

print('== Payroll')
drv = sql(f'SELECT driver_id, driver2_id FROM trips WHERE id={t1}').split('\t')
rows = [{'personnel_id': drv[0], 'work_date': d, 'status': 'Present'} for d in ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']]
pay.act('Payroll.attendance_save', {'rows': rows})
fin.act('Finance.cash_advance', {'personnel_id': drv[0], 'amount': 2000, 'installment': 500, 'purpose': 'CA', 'payment_method': 'Cash', 'released_on': '2026-10-30'})
pay.act('Payroll.ledger_add', {'personnel_id': drv[0], 'ledger_type': 'Uniform', 'description': 'Uniform set', 'amount': 1800, 'installment': 500})
# date_to covers today, because trip pay uses the actual departure date (the test may run after Nov 1)
import datetime as _dt
pay.act('Payroll.period_create', {'period_name': 'Oct 26 - Nov 1', 'payroll_group': 'South Carrier', 'date_from': '2026-10-26', 'date_to': max('2026-11-01', _dt.date.today().isoformat())})
per = sql('SELECT id FROM payroll_periods ORDER BY id DESC LIMIT 1')
line = sql(f'SELECT id, days_worked, trips_count, regular_wage, trip_pay, gross_pay, total_deductions, net_pay FROM payroll_lines WHERE period_id={per} AND personnel_id={drv[0]}').split('\t')
print('   payroll line:', line)
# expected: wage 600*6=3600; trip pay 800 (1 trip with waybill); gross 4400; SSS 775/24*6=193.75; PH 75; PI 50; CA 500; uniform 500; cash bond 500 -> 1818.75; net 2581.25
check(line[3] == '3600.00' and line[4] == '800.00' and line[5] == '4400.00', 'wage 600x6, trip pay 800, gross 4400')
check(line[6] == '1818.75' and line[7] == '2581.25', f'deductions 1818.75, net 2581.25 (got {line[6]}, {line[7]})')
pay.act('Payroll.line_update', {'line_id': line[0], 'manual': {'Trade Test': 500, 'SSS Loan': 200}, 'override': {'Savings / Cash Bond': 0}})
l2 = sql(f'SELECT gross_pay, total_deductions, net_pay FROM payroll_lines WHERE id={line[0]}').split('\t')
check(l2 == ['4900.00', '1518.75', '3381.25'], f'edited line {l2}')
pay.act('Payroll.finalize', {'period_id': per})
check(sql(f"SELECT balance FROM employee_ledgers WHERE personnel_id={drv[0]} AND ledger_type='Cash Advance'") == '1500.00', 'CA balance 2000-500')
pay.act('Payroll.reopen', {'period_id': per, 'reason': 'test'})
check(sql(f"SELECT balance FROM employee_ledgers WHERE personnel_id={drv[0]} AND ledger_type='Cash Advance'") == '2000.00', 'reopen reverses CA')
pay.act('Payroll.finalize', {'period_id': per})
pay.act('Payroll.submit', {'period_id': per})
fin.act('Finance.payroll_disburse', {'period_id': per, 'payment_method': 'Bank Transfer', 'released_on': '2026-11-01'})

print('== Formula settings')
pay.act('Admin.setting_save', {'key': 'purchase_approval_threshold', 'value': '1'}, expect_ok=False, label='(payroll cannot change approval limit)')
pay.act('Admin.setting_save', {'key': 'fund_approval_threshold', 'value': '1'}, expect_ok=False, label='(15k fund limit no longer exists)')
fin.act('Admin.setting_save', {'key': 'fuel_price_per_liter', 'value': '75'})
fin.act('Admin.items_save', {'scope': 'trip_allowance', 'items': [{'name': 'Fuel', 'calc': 'fuel', 'amount': 0, 'divisor': 1, 'active': 1}]}, expect_ok=False, label='(fund categories are fixed amounts only)')
fin.act('Admin.items_save', {'scope': 'trip_allowance', 'items': [{'name': 'Checker', 'calc': 'fixed', 'amount': 150, 'divisor': 1, 'active': 1}, {'name': 'Passway', 'calc': 'fixed', 'amount': 200, 'divisor': 1, 'active': 1}]})
r = ops.act('Trips.create', {'client_id': cl['MMPC'], 'route_id': rt['NYK CABUYAO'], 'scheduled_at': '2026-11-02T08:00', 'truck_type': 'Car Carrier'})
ccd.act('Funds.request', {'trip_id': r['trip_id'], 'categories': ['Checker', 'Passway']})
check(sql(f"SELECT amount FROM fund_requests WHERE trip_id={r['trip_id']}") == '350.00', 'new request uses new preset: 150 + 200 = 350')
check(sql(f'SELECT amount FROM fund_requests WHERE id={f1}') == '550.00', 'old fund unchanged')
check('"amount":100' in sql(f'SELECT breakdown_json FROM fund_requests WHERE id={f1}').replace(' ', ''), 'old fund keeps the preset values it used')
pnl = fin.page('settings')['example']['pnl']
check(abs(pnl['net_income'] - (15000 - (143/4*75 + 651 + 450 + 750 + 769.23 + 1500 + 2307.69))) < 0.02, f"projected P&L still uses fuel ({pnl['net_income']})")

print('== Documents and backup')
s = U['admin'].s
files = {'files[]': ('orcr.pdf', b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'application/pdf')}
r = s.post(BASE + '?api=document_upload', data={'csrf': a.csrf, 'category': 'OR/CR', 'entity_type': 'vehicle', 'entity_id': vid1, 'expires_on': '2026-11-15'}, files=files).json()
check(r.get('ok'), f'upload {r}')
did = sql('SELECT id FROM documents LIMIT 1')
check(s.get(BASE, params={'api': 'document_download', 'id': did}).content.startswith(b'%PDF'), 'download works')
check(U['payroll'].s.get(BASE, params={'api': 'document_download', 'id': did}).status_code == 403, 'payroll cannot open vehicle document')
r = a.act('Admin.backup_create')
check(s.get(BASE, params={'api': 'backup_download', 'file': r.get('file')}).text.startswith('-- R.P. Mulawin'), 'backup download')

print('== Every page for every role (no errors)')
for role, sess in U.items():
    for n in sess.me['nav']:
        sess.page(n['id'])
    print('  pages ok for', role, len(sess.me['nav']))
rep = a.page('reports', **{'from': '2026-10-01', 'to': '2026-11-30', 'group': 'week'})
print('   report sections:', [x['title'] for x in rep.get('sections', [])])
print('   trip cards:', [(c['label'], c['value']) for c in rep['sections'][0]['cards']])
fleet = [x for x in rep['sections'] if x['title'].startswith('Fleet')][0]
print('   fleet rows:', [(r['plate_number'], r['down_days'], r['total_cost']) for r in fleet['tables'][0]['rows']])
dash = ops.page('dashboard'); print('   ops dashboard alerts:', [x['text'] for x in dash['alerts']])
print('== Audit trail rows:', sql('SELECT COUNT(*) FROM audit_events'))
print('\nFAILURES:', len(fails))
for f in fails: print(' -', f)
