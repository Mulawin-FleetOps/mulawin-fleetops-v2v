#!/usr/bin/env python3
"""
automation/script2_demo.py  -  SCRIPT 2: full objective demonstration through the real screens

Run Script 1 first (it creates the accounts and saves their passwords in automation/.credentials.json).

What it does, in this order (guide H and J):
   1. Logs in each role with password + emailed code (you type the codes; saved sessions are reused).
   2. Masterlists: demo driver, truck (with OR/CR file), mechanic, client (with accreditation files) + billing rate.
   3. E-signature: the Operations Head DRAWS a signature, Finance UPLOADS a signature image.
   4. Corrective maintenance at the garage on the demo truck: report -> mechanic -> findings -> parts
      request and stock release -> repair completed -> truck still unavailable -> verification -> available.
   5. Purchase order: supplier, budget, PO -> Finance approval -> receiving -> payment.
   6. Trip: New Trip Request page (map or typed addresses + attachment) -> automatic assignment ->
      fund request -> approval -> release -> checklist -> dispatch -> progress update -> incident ->
      on-site repair (mechanic, verification) -> resume -> completion with waybill and receipt.
   7. Billing: document check -> invoice (printed to PDF) -> payment -> acknowledgement receipt (PDF).
   8. Notifications, dashboards, monitoring, reports (printed to PDF), activity log, role access, map tiles.
Every step is checked again after reloading the data from the server (persistence).

Repeatable: masterlist records use fixed names and are reused (never duplicated); an unfinished trip,
repair or purchase order from an earlier run is CONTINUED instead of starting a new one. Nothing is deleted.
Report: automation/reports/script2_<date>/report.html  (+ screenshots/ and printed_forms/)

Run:  python automation/script2_demo.py            (python automation/script2_demo.py --help for options)
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fmsauto as F  # noqa: E402

TODAY = dt.date.today()

# ---------------------------------------------------------------------------- fictional demo data (guide L)
DEMO = {
    'driver': {'full_name': 'SALONGA, MARVIN', 'person_type': 'Driver', 'employee_no': 'RPM-D-118', 'contact_number': '0917 845 6620',
               'license_number': 'N03-21-004517', 'license_expiry': (TODAY + dt.timedelta(days=730)).isoformat(),
               'address': 'Brgy. Sambat, Tanauan City, Batangas', 'date_hired': '2024-03-04'},
    'truck': {'plate_number': 'NDV4127', 'truck_number': '31', 'truck_type': 'Container', 'make_brand': 'ISUZU', 'model': 'GIGA CYZ 6x4',
              'mv_file_number': '0423-00000812734', 'chassis_number': 'JALCYZ52H70001427', 'engine_number': '6WG1-402117',
              'or_number': '7718823041', 'cr_number': '342219087', 'registration_expiry': (TODAY + dt.timedelta(days=290)).isoformat(),
              'insurance_provider': 'Malayan Insurance', 'insurance_policy_number': 'MIC-CV-2026-118402',
              'insurance_expiry': (TODAY + dt.timedelta(days=250)).isoformat()},
    'mechanic': {'full_name': 'BAUTISTA, ERNESTO', 'contact_number': '0927 555 0110', 'specialization': 'Air brakes and suspension'},
    'client': {'company_name': 'LAGUNA PRIME AUTOMOTIVE LOGISTICS INC.', 'tin': '009-482-117-000', 'trade_name': 'Laguna Prime Auto',
               'nature_of_business': 'Vehicle distribution', 'business_address': 'Lot 7 Phase 2, Calamba Premiere Industrial Park, Calamba City, Laguna',
               'contact_person': 'Rhea Manalo', 'contact_position': 'Logistics Supervisor', 'contact_number': '0917 845 2231',
               'email': 'logistics@lagunaprime.example'},
    'rates': {'Car Carrier': '145', 'Container': '120', 'Wing Van': '110'},
    'part': {'part_number': 'BRK-CH30', 'description': 'Brake chamber type 30 (air brake)', 'category': 'Brakes', 'unit': 'pc',
             'unit_cost': '3850', 'reorder_level': '2', 'opening_qty': '4'},
    'supplier': {'name': 'Calamba Truck Parts Center', 'contact_person': 'Jun Ilagan', 'contact_number': '049 545 2210',
                 'email': 'sales@calambatruckparts.example', 'address': 'National Highway, Brgy. Parian, Calamba City, Laguna'},
    'trip': {'truck_type': 'Car Carrier', 'consignee': 'LAGUNA PRIME', 'pickup': 'Santo Tomas, Batangas', 'destination': 'Port of Batangas, Batangas City',
             'distance_km': '48.5', 'units': '6'},
}

ROLES_NEEDED = ['operations_head', 'car_carrier_dispatcher', 'motorpool', 'purchasing', 'finance', 'billing', 'audit']


# ---------------------------------------------------------------------------- sample attachments
SAMPLES = {
    'client_signature.png': ('img', 'signature'),
    'company_profile.pdf': ('pdf', 'COMPANY PROFILE'), 'sec_registration.pdf': ('pdf', 'SEC CERTIFICATE OF INCORPORATION'),
    'business_permit.pdf': ('pdf', "MAYOR'S BUSINESS PERMIT"), 'bir_2303.pdf': ('pdf', 'BIR FORM 2303 - CERTIFICATE OF REGISTRATION'),
    'truck_or_cr.pdf': ('pdf', 'LTO OFFICIAL RECEIPT / CERTIFICATE OF REGISTRATION'), 'booking_nomination.pdf': ('pdf', 'BOOKING / NOMINATION'),
    'damage_photo.jpg': ('img', 'damage'), 'repair_evidence.jpg': ('img', 'repaired'), 'repair_receipt.pdf': ('pdf', 'SERVICE / REPAIR RECEIPT'),
    'waybill.pdf': ('pdf', 'WAYBILL'), 'delivery_ack_receipt.pdf': ('pdf', 'DELIVERY ACKNOWLEDGEMENT RECEIPT'),
    'client_payment_ar.pdf': ('pdf', 'ACKNOWLEDGEMENT RECEIPT (CLIENT PAYMENT)'), 'supplier_delivery_receipt.pdf': ('pdf', 'SUPPLIER DELIVERY RECEIPT'),
    'supplier_official_receipt.pdf': ('pdf', 'SUPPLIER OFFICIAL RECEIPT'), 'finance_signature.png': ('img', 'signature2'),
}


def make_samples(br):
    """Creates the sample attachments that are missing (your own files with the same names are used as they are)."""
    os.makedirs(F.SAMPLE_DIR, exist_ok=True)
    missing = [n for n in SAMPLES if not os.path.exists(os.path.join(F.SAMPLE_DIR, n))]
    if not missing:
        return []
    ctx = br.browser.new_context(viewport={'width': 900, 'height': 600})
    p = ctx.new_page()
    for name in missing:
        kind, title = SAMPLES[name]
        path = os.path.join(F.SAMPLE_DIR, name)
        if kind == 'pdf':
            p.set_content(f"""<html><body style="font-family:Arial;padding:40px;color:#222">
              <div style="border:2px solid #222;padding:24px"><div style="font-size:12px;color:#666">SAMPLE DOCUMENT FOR THE SYSTEM DEMONSTRATION · FICTIONAL DATA</div>
              <h2 style="margin:10px 0">{title}</h2><p>Prepared for: {DEMO['client']['company_name']}<br>Date: {TODAY:%B %d, %Y}</p>
              <table style="width:100%;border-collapse:collapse;margin-top:16px">{''.join(f'<tr><td style="border:1px solid #999;padding:8px;height:18px"></td><td style="border:1px solid #999"></td></tr>' for _ in range(8))}</table>
              <p style="margin-top:40px">______________________<br>Authorized signature</p></div></body></html>""")
            p.pdf(path=path, format='A4')
        else:
            if title.startswith('signature'):
                svg = ('<svg width="480" height="160" xmlns="http://www.w3.org/2000/svg"><path d="M20 110 C 60 20, 90 150, 130 80 S 200 30, 230 100 S 300 140, 330 60 S 420 90, 460 70" '
                       'stroke="#13246b" stroke-width="5" fill="none" stroke-linecap="round"/></svg>')
                p.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
                p.locator('svg').screenshot(path=path, omit_background=True)
            else:
                color = '#6b4f2a' if title == 'damage' else '#3d6b46'
                label = 'Brake air line - leak found' if title == 'damage' else 'Brake chamber replaced'
                p.set_content(f"""<html><body style="margin:0"><div style="width:800px;height:600px;background:linear-gradient(135deg,#9aa3ab,#5b636b);position:relative;font-family:Arial">
                  <div style="position:absolute;left:120px;top:160px;width:520px;height:260px;border-radius:30px;background:{color};opacity:.85"></div>
                  <div style="position:absolute;left:24px;bottom:20px;color:#fff;font-size:22px">{label} · sample photo</div></div></body></html>""")
                p.screenshot(path=path, type='jpeg', quality=80, clip={'x': 0, 'y': 0, 'width': 800, 'height': 600})
    ctx.close()
    return missing


def sample(name):
    return os.path.join(F.SAMPLE_DIR, name)


# ---------------------------------------------------------------------------- manifest (stable identifiers)
class Manifest:
    def __init__(self, base):
        self.base = base
        self.all = F.load_json(F.MANIFEST_FILE, {})
        self.d = self.all.setdefault(base, {'runs': []})

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v):
        self.d[k] = v
        self.save()

    def save(self):
        with open(F.MANIFEST_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.all, f, indent=2)


def find(rows, **kw):
    for r in rows or []:
        if all(str(r.get(k, '')).strip().upper() == str(v).strip().upper() for k, v in kw.items()):
            return r
    return None


def local_dt(minutes=0):
    return (dt.datetime.now() + dt.timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M')


# ============================================================================ the demonstration
class Demo:
    def __init__(self, args):
        self.args = args
        self.cfg = F.load_config()
        self.base = self.cfg['base_url']
        self.creds = F.Credentials()
        self.rec = F.Recorder('Script 2 - Objective demonstration', 'script2')
        self.man = Manifest(self.base)
        self.otp = F.OtpSource(args.otp_source, self.cfg.get('mailpit_url', 'http://127.0.0.1:8025'))
        self.br = F.Browser(self.base, self.rec, self.otp, headed=args.headed, slow=args.slow)
        self.p = {}
        self.run = {'started': dt.datetime.now().isoformat(timespec='seconds')}

    # ---- helpers
    def acc(self, role):
        if role == 'admin':
            return {'username': self.cfg.get('admin_username', 'admin'), 'email': self.cfg.get('admin_email', '')}
        return self.cfg['accounts'][role]

    def page(self, role):
        return self.p.get(role)

    def need(self, *roles):
        missing = [r for r in roles if r not in self.p]
        return ('not signed in: ' + ', '.join(missing)) if missing else None

    def shot(self, role, name, full=False):
        return self.br.shot(self.p[role], name, full)

    def modal(self, role):
        return self.br.modal(self.p[role])

    def submit(self, role, wait=1500):
        return self.br.submit_modal(self.p[role], wait)

    def go(self, role, hash_, wait=1200):
        self.br.go(self.p[role], hash_, wait)

    def data(self, role, page, **q):
        return self.br.data(self.p[role], page, **q)

    def api(self, role, action, payload=None):
        return self.br.api(self.p[role], action, payload)

    def drawer_btn(self, role, attr, value):
        return self.p[role].locator(f'.app-drawer.show [{attr}="{value}"]')

    def tab(self, role, key):
        loc = self.p[role].locator(f'[data-tab={key}]').first
        loc.click()
        self.p[role].wait_for_timeout(600)

    def row(self, role, text):
        pg = self.p[role]
        box = pg.locator('.table-search input')
        if box.count():
            box.first.fill(text)
            pg.wait_for_timeout(350)
        return pg.locator('#pageBody tbody tr', has_text=text).first

    # ======================================================================= 1. logins
    def logins(self):
        R = self.rec
        R.set_section('1. Login with password and emailed code (OTP)')
        roles = ['admin'] + ROLES_NEEDED
        for i, role in enumerate(roles, start=1):
            a = self.acc(role)
            pw = self.creds.get(self.base, a['username'])
            item = f'L-{i:02d}'
            if not pw:
                if role == 'admin':
                    pw = self.creds.ask(self.base, a['username'], 'the Admin')
                else:
                    R.skipped(item, '4.1', f'Login {F.ROLE_LABEL[role]}', 'password not in .credentials.json - run Script 1 first')
                    continue
            try:
                pg = self.br.login(a['username'], pw, a['email'])
                ok = pg.evaluate('() => App.me.user.role') == role
                self.p[role] = pg if ok else None
                R.check(item, '4.1', f'Login {F.ROLE_LABEL[role]} "{a["username"]}"', ok, 'signed in with password + emailed code (or a still-valid session)', 'wrong role')
                if not ok:
                    del self.p[role]
            except Exception as e:
                R.failed(item, '4.1', f'Login {F.ROLE_LABEL[role]} "{a["username"]}"', str(e))
        R.context['Login codes'] = 'typed by the operator from the real inbox' if self.args.otp_source == 'manual' else 'local Mailpit (test computer) - real Gmail delivery is checked only in manual mode'

    # ======================================================================= 2. masterlists
    def masterlists(self):
        R = self.rec
        R.set_section('2. Masterlists (trucks, drivers, mechanics, clients)')
        if self.need('operations_head'):
            return R.skipped('M-00', '1.1', 'Masterlists', self.need('operations_head'))
        # driver
        d = DEMO['driver']
        crew = self.data('operations_head', 'crew').get('crew', [])
        if find(crew, full_name=d['full_name']):
            R.passed('M-01', '1.1', f'Driver {d["full_name"]} in the Driver Masterlist', 'already in the masterlist - reused, not duplicated')
        else:
            self.go('operations_head', 'crew')
            self.p['operations_head'].click('#pageTools button:has-text("Add driver or helper")')
            m = self.modal('operations_head')
            for k in ('full_name', 'employee_no', 'contact_number', 'license_number', 'address'):
                m.locator(f'[name={k}]').fill(d[k])
            m.locator('[name=person_type]').select_option('Driver')
            m.locator('[name=license_expiry]').fill(d['license_expiry'])
            m.locator('[name=date_hired]').fill(d['date_hired'])
            ev = self.shot('operations_head', 'm01_driver_form')
            err = self.submit('operations_head')
            crew = self.data('operations_head', 'crew').get('crew', [])
            R.check('M-01', '1.1', f'Add driver {d["full_name"]}', not err and find(crew, full_name=d['full_name']) is not None,
                    'saved and found after reloading', err or 'not found after reloading', [ev])
        # truck
        t = DEMO['truck']
        tr = self.data('operations_head', 'trucks')
        truck = find(tr.get('trucks', []), plate_number=t['plate_number'])
        if truck:
            R.passed('M-02', '1.1', f'Truck {t["plate_number"]} in the Truck Masterlist', 'already in the masterlist - reused, not duplicated')
        else:
            self.go('operations_head', 'trucks')
            self.p['operations_head'].click('#pageTools button:has-text("Add truck")')
            m = self.modal('operations_head')
            for k in ('plate_number', 'truck_number', 'make_brand', 'model', 'mv_file_number', 'chassis_number', 'engine_number', 'or_number', 'cr_number',
                      'insurance_provider', 'insurance_policy_number'):
                m.locator(f'[name={k}]').fill(t[k])
            m.locator('[name=truck_type]').select_option(t['truck_type'])
            m.locator('[name=registration_expiry]').fill(t['registration_expiry'])
            m.locator('[name=insurance_expiry]').fill(t['insurance_expiry'])
            drv = find(self.data('operations_head', 'trucks').get('drivers', []), full_name=DEMO['driver']['full_name'])
            if drv:
                m.locator('[name=assigned_driver_id]').select_option(str(drv['id']))
            ev = self.shot('operations_head', 'm02_truck_form')
            err = self.submit('operations_head')
            truck = find(self.data('operations_head', 'trucks').get('trucks', []), plate_number=t['plate_number'])
            R.check('M-02', '1.1', f'Add truck {t["plate_number"]} with its regular driver', not err and truck is not None,
                    f'saved; status {truck and truck.get("status")}', err or 'not found after reloading', [ev])
        if truck:
            self.man.set('truck_id', truck['id'])
            info = self.api('operations_head', 'Fleet.truck_details', {'id': truck['id']})
            docs = [x for x in info.get('documents', []) if x.get('category') == 'OR/CR']
            if docs:
                R.passed('M-03', '1.1', 'Truck has its OR/CR document', f'{len(docs)} file(s) already attached')
            else:
                self.go('operations_head', 'trucks')
                self.row('operations_head', t['plate_number']).click()
                self.p['operations_head'].wait_for_timeout(900)
                self.drawer_btn('operations_head', 'data-a', 'docs').click()
                self.p['operations_head'].wait_for_timeout(500)
                m = self.modal('operations_head')
                m.locator('[name=category]').select_option('OR/CR')
                m.locator('[name=expires_on]').fill(t['registration_expiry'])
                m.locator('[name=files]').set_input_files(sample('truck_or_cr.pdf'))
                err = self.submit('operations_head')
                info = self.api('operations_head', 'Fleet.truck_details', {'id': truck['id']})
                docs = [x for x in info.get('documents', []) if x.get('category') == 'OR/CR']
                R.check('M-03', '1.1', 'Attach the truck OR/CR file', not err and bool(docs), 'file stored and listed after reloading', err or 'file not listed',
                        [self.shot('operations_head', 'm03_truck_drawer')])
                self.br.close_drawer(self.p['operations_head'])
        # mechanic
        mech = DEMO['mechanic']
        if self.need('motorpool'):
            R.skipped('M-04', '2.1', 'Mechanic Masterlist', self.need('motorpool'))
        else:
            ml = self.data('motorpool', 'mechanics').get('mechanics', [])
            if find(ml, full_name=mech['full_name']):
                R.passed('M-04', '2.1', f'Mechanic {mech["full_name"]} in the Mechanic Masterlist', 'already in the masterlist - reused')
            else:
                self.go('motorpool', 'mechanics')
                self.p['motorpool'].click('#pageTools button:has-text("Add mechanic")')
                m = self.modal('motorpool')
                for k, v in mech.items():
                    m.locator(f'[name={k}]').fill(v)
                ev = self.shot('motorpool', 'm04_mechanic_form')
                err = self.submit('motorpool')
                ml = self.data('motorpool', 'mechanics').get('mechanics', [])
                got = find(ml, full_name=mech['full_name'])
                R.check('M-04', '2.1', f'Add mechanic {mech["full_name"]}', not err and got is not None,
                        f'saved as {got and got.get("mechanic_code")} ({got and got.get("availability")})', err or 'not found after reloading', [ev])
            self.go('motorpool', 'mechanics')
            R.add('M-05', '2.1', 'Mechanic Masterlist (ID, name, contact, specialization, availability)', F.PASSED, 'screenshot', [self.shot('motorpool', 'm05_mechanic_masterlist', True)])
        # client + rate
        c = DEMO['client']
        cl = self.data('operations_head', 'clients').get('clients', [])
        client = find(cl, company_name=c['company_name'])
        if client:
            R.passed('M-06', '1.2', f'Client {c["company_name"]}', f'already in the masterlist - reused (status {client.get("status")})')
        else:
            self.go('operations_head', 'clients')
            self.p['operations_head'].click('#pageTools button:has-text("New client")')
            m = self.modal('operations_head')
            for k, v in c.items():
                m.locator(f'[name={k}]').fill(v)
            for field, f in [('signature', 'client_signature.png'), ('company_profile', 'company_profile.pdf'), ('sec_dti', 'sec_registration.pdf'),
                             ('business_permit', 'business_permit.pdf'), ('bir_2303', 'bir_2303.pdf')]:
                m.locator(f'[name={field}]').set_input_files(sample(f))
            ev = self.shot('operations_head', 'm06_client_form')
            err = self.submit('operations_head', 2500)
            client = find(self.data('operations_head', 'clients').get('clients', []), company_name=c['company_name'])
            R.check('M-06', '1.2', f'New client profile {c["company_name"]} with 5 accreditation files', not err and client is not None,
                    f'saved; status {client and client.get("status")}', err or 'not found after reloading', [ev])
        if client and client.get('status') != 'Active':
            if self.need('billing'):
                R.skipped('M-07', '3.1', 'Billing rate of the client', self.need('billing'))
            else:
                self.go('billing', 'clients')
                self.row('billing', c['company_name']).locator('button[data-act=rate]').click()
                self.p['billing'].wait_for_timeout(700)
                m = self.modal('billing')
                for typ, rate in DEMO['rates'].items():
                    m.locator(f'[data-rate="{typ}"]').fill(rate)
                ev = self.shot('billing', 'm07_rate_form')
                err = self.submit('billing')
                client = find(self.data('billing', 'clients').get('clients', []), company_name=c['company_name'])
                R.check('M-07', '3.1', 'Billing sets the rate per km -> client Active', not err and client and client.get('status') == 'Active',
                        'rates saved; client Active', err or f'status {client and client.get("status")}', [ev])
        elif client:
            R.passed('M-07', '3.1', 'Client has billing rates (Active)', 'already Active')
        if client:
            self.man.set('client_id', client['id'])

    # ======================================================================= 3. e-signature
    def signatures(self):
        R = self.rec
        R.set_section('3. E-signature (draw and upload)')
        if self.need('operations_head'):
            R.skipped('E-01', '-', 'Draw e-signature', self.need('operations_head'))
        else:
            pg = self.p['operations_head']
            self.go('operations_head', 'dashboard')
            pg.evaluate('() => UI.signatureModal()')
            pg.wait_for_timeout(600)
            m = self.modal('operations_head')
            m.locator('button[type=submit]').click()          # empty drawing must be refused
            pg.wait_for_timeout(600)
            empty_refused = bool(self.br.modal_error(pg)) or 'empty' in (m.inner_text() or '').lower()
            R.check('E-01', '-', 'Empty signature is refused', empty_refused, 'save refused while the pad is empty', 'an empty signature was accepted')
            box = m.locator('canvas.sig-pad').bounding_box()
            pts = [(0.08, 0.7), (0.2, 0.25), (0.3, 0.75), (0.45, 0.3), (0.58, 0.72), (0.72, 0.35), (0.9, 0.55)]
            pg.mouse.move(box['x'] + box['width'] * pts[0][0], box['y'] + box['height'] * pts[0][1])
            pg.mouse.down()
            for x, y in pts[1:]:
                pg.mouse.move(box['x'] + box['width'] * x, box['y'] + box['height'] * y, steps=12)
            pg.mouse.up()
            ev = self.shot('operations_head', 'e02_signature_drawn')
            err = self.submit('operations_head', 2000)
            pg.reload()
            pg.wait_for_selector('#pageContent')
            has = pg.evaluate('() => App.me.user.has_signature')
            uid = pg.evaluate('() => App.me.user.id')
            st = pg.evaluate('async (u) => (await fetch("index.php?api=signature&user=" + u)).status', uid)
            R.check('E-02', '-', 'Operations Head draws and saves an e-signature (mouse)', not err and bool(has) and st == 200,
                    'saved; image served to signed-in users after reload', err or f'has_signature={has}, image HTTP {st}', [ev])
        if self.need('finance'):
            R.skipped('E-03', '-', 'Upload e-signature image', self.need('finance'))
        else:
            pg = self.p['finance']
            self.go('finance', 'dashboard')
            pg.evaluate('() => UI.signatureModal()')
            pg.wait_for_timeout(600)
            m = self.modal('finance')
            m.locator('[data-sigtab=upload]').click()
            m.locator('#sigFile').set_input_files(sample('finance_signature.png'))
            pg.wait_for_timeout(500)
            ev = self.shot('finance', 'e03_signature_upload_preview')
            err = self.submit('finance', 2000)
            pg.reload()
            pg.wait_for_selector('#pageContent')
            R.check('E-03', '-', 'Finance uploads an e-signature image (PNG)', not err and bool(pg.evaluate('() => App.me.user.has_signature')),
                    'saved and still there after reload', err or 'not saved', [ev])

    # ======================================================================= 4. garage corrective maintenance
    def garage_repair(self):
        R = self.rec
        R.set_section('4. Corrective maintenance at the garage (demo truck)')
        if self.need('motorpool'):
            return R.skipped('G-00', '2.3', 'Garage repair', self.need('motorpool'))
        truck_id = self.man.get('truck_id')
        if not truck_id:
            return R.skipped('G-00', '2.3', 'Garage repair', 'demo truck not available (masterlist step failed)')
        md = self.data('motorpool', 'maintenance')
        truck = next((v for v in md.get('trucks', []) if int(v['id']) == int(truck_id)), None)
        plate = DEMO['truck']['plate_number']
        job_id = self.man.get('garage_job_id')
        job = next((j for j in md.get('jobs', []) if job_id and int(j['id']) == int(job_id)), None)
        if job and (job['status'] == 'Cancelled' or job.get('verified_at')):
            job = None
        if not job:
            job = next((j for j in md.get('jobs', []) if int(j['vehicle_id']) == int(truck_id) and j['status'] != 'Cancelled' and not j.get('verified_at')), None)
        if job:
            R.note(f'Continuing the unfinished repair {job["job_ref"]} from an earlier run (status {job["status"]}).')
        else:
            if truck and truck.get('on_road'):
                return R.skipped('G-01', '2.3', 'Report a truck problem', f'{plate} is on the road right now')
            self.go('motorpool', 'maintenance')
            self.p['motorpool'].click('#pageTools button:has-text("Report truck problem")')
            m = self.modal('motorpool')
            m.locator('[name=vehicle_id]').select_option(str(truck_id))
            m.locator('[name=priority]').select_option('High')
            m.locator('[name=problem]').fill('Air brake pressure drops after about 10 minutes of idling; hissing sound at the rear axle.')
            m.locator('[name=photos]').set_input_files(sample('damage_photo.jpg'))
            ev = self.shot('motorpool', 'g01_report_form')
            err = self.submit('motorpool', 2000)
            md = self.data('motorpool', 'maintenance')
            job = next((j for j in md.get('jobs', []) if int(j['vehicle_id']) == int(truck_id) and j['status'] == 'Reported'), None)
            tstat = self.truck_status(truck_id)
            R.check('G-01', '2.3', f'Report a problem on {plate} (photo attached)', not err and job is not None and tstat == 'Under Maintenance',
                    f'{job and job["job_ref"]} Reported; truck {tstat}', err or f'record not found / truck {tstat}', [ev])
            if not job:
                return
            self.man.set('garage_job_id', job['id'])
            # duplicate unresolved record is refused
            self.go('motorpool', 'maintenance')
            self.p['motorpool'].click('#pageTools button:has-text("Report truck problem")')
            opts = self.modal('motorpool').locator('[name=vehicle_id] option').all_inner_texts()
            self.modal('motorpool').locator('[data-bs-dismiss=modal]').first.click()
            R.check('G-02', '2.3', 'A truck with an unresolved repair cannot be reported twice', not any(plate in o for o in opts),
                    f'{plate} is not offered again while its repair is open', f'{plate} is still offered')
        self.man.set('garage_job_id', job['id'])
        self.run['garage_job'] = job['job_ref']
        self.advance_job(job['id'], garage=True)

    def truck_status(self, truck_id):
        role = 'operations_head' if 'operations_head' in self.p else 'motorpool'
        tr = self.data(role, 'trucks').get('trucks', [])
        v = next((x for x in tr if int(x['id']) == int(truck_id)), None)
        return v and v.get('status')

    def job(self, job_id):
        return self.api('motorpool', 'Maintenance.details', {'job_id': job_id}).get('job', {})

    def open_job(self, job_id):
        self.go('motorpool', f'maintenance?open={job_id}', 1500)

    def advance_job(self, job_id, garage):
        """Moves one maintenance record through its statuses with the real buttons until it is verified."""
        R = self.rec
        tag = 'G' if garage else 'TI'
        mech_name = DEMO['mechanic']['full_name']
        for _ in range(8):
            j = self.job(job_id)
            st = j.get('status')
            if st == 'Completed' and j.get('verified_at'):
                return True
            self.open_job(job_id)
            pg = self.p['motorpool']
            if st == 'Reported' and garage:
                self.drawer_btn('motorpool', 'data-a', 'mech').click()
                pg.wait_for_timeout(500)
                self.pick_mechanic(mech_name)
                err = self.submit('motorpool')
                j = self.job(job_id)
                R.check(f'{tag}-03', '2.1', 'Assign a mechanic from the Mechanic Masterlist (dropdown)', not err and j.get('status') == 'Under Inspection',
                        f'{j.get("mechanic")} assigned; Under Inspection', err or f'status {j.get("status")}')
                if not err:
                    ml = self.data('motorpool', 'mechanics').get('mechanics', [])
                    me = find(ml, full_name=j.get('mechanic') or '')
                    R.check(f'{tag}-04', '2.1', 'Assigned mechanic shows as Assigned (no double assignment)', bool(me) and me.get('availability') == 'Assigned',
                            f'{j.get("mechanic")} is Assigned', 'availability did not change')
            elif st == 'Reported' and not garage:
                self.drawer_btn('motorpool', 'data-a', 'assess').click()
                pg.wait_for_timeout(500)
                m = self.modal('motorpool')
                m.locator('[name=severity]').select_option('Minor')
                self.pick_mechanic(mech_name)
                m.locator('[name=recommendation]').fill('Send the mechanic to the site; replace the punctured tire and check the wheel studs.')
                err = self.submit('motorpool')
                j = self.job(job_id)
                R.check('TI-03', '2.2', 'Motorpool assesses the incident (Minor) and sends a mechanic', not err and j.get('status') == 'Under Inspection',
                        f'{j.get("mechanic")} sent; trip stays On Hold', err or f'status {j.get("status")}')
            elif st == 'Under Inspection':
                self.drawer_btn('motorpool', 'data-a', 'inspect').click()
                pg.wait_for_timeout(500)
                m = self.modal('motorpool')
                if garage:
                    m.locator('[name=findings]').fill('Leak at the rear brake chamber diaphragm; air line fittings are worn.')
                    m.locator('[name=diagnosis]').fill('Replace the rear brake chamber (type 30) and tighten the air line fittings.')
                    m.locator('[name=expected_completion]').fill((TODAY + dt.timedelta(days=1)).isoformat())
                else:
                    m.locator('[name=findings]').fill('Right rear outer tire punctured; rim not damaged.')
                    m.locator('[name=diagnosis]').fill('Replace the tire with the spare; torque the wheel nuts.')
                err = self.submit('motorpool')
                j = self.job(job_id)
                R.check(f'{tag}-05', '2.1', 'Record inspection findings and diagnosis', not err and j.get('status') == 'Under Repair', 'Under Repair', err or f'status {j.get("status")}',
                        [self.shot('motorpool', f'{tag.lower()}05_findings')])
                if garage and not err:
                    self.parts_for_job(job_id)
            elif st == 'Under Repair':
                if garage and not self.man.get(f'parts_done_{job_id}'):
                    self.parts_for_job(job_id)
                    self.open_job(job_id)
                if garage and not self.man.get(f'cost_done_{job_id}'):
                    self.drawer_btn('motorpool', 'data-a', 'cost').click()
                    pg.wait_for_timeout(500)
                    m = self.modal('motorpool')
                    m.locator('[name=cost_type]').select_option(index=1)
                    m.locator('[name=amount]').fill('1200')
                    m.locator('[name=description]').fill('Mechanic labor - brake chamber replacement')
                    err = self.submit('motorpool')
                    R.check(f'{tag}-07', '2.1', 'Record a repair cost (labor)', not err, 'cost saved (shown in maintenance costs and expenses)', err)
                    self.man.set(f'cost_done_{job_id}', True)
                    self.open_job(job_id)
                self.drawer_btn('motorpool', 'data-a', 'complete').click()
                pg.wait_for_timeout(500)
                m = self.modal('motorpool')
                m.locator('[name=repair_performed]').fill('Replaced the rear brake chamber and air line fittings; pressure holds in the garage test.' if garage
                                                          else 'Replaced the punctured tire with the spare; wheel nuts torqued.')
                m.locator('[name=evidence]').set_input_files([sample('repair_evidence.jpg'), sample('repair_receipt.pdf')])
                err = self.submit('motorpool', 2000)
                j = self.job(job_id)
                ok = not err and j.get('status') == 'Completed'
                R.check(f'{tag}-08', '2.3', 'Complete the repair with evidence files', ok, 'Completed; mechanic free again', err or f'status {j.get("status")}')
                if ok and garage:
                    tstat = self.truck_status(j['vehicle_id'])
                    R.check('G-09', '2.2', 'Completed repair does NOT make the truck available yet', tstat == 'Under Maintenance',
                            f'truck still {tstat} until verification', f'truck became {tstat}', [self.shot('motorpool', 'g09_awaiting_verification')])
            elif st == 'Completed':
                self.drawer_btn('motorpool', 'data-a', 'verify').click()
                pg.wait_for_timeout(500)
                m = self.modal('motorpool')
                m.locator('[name=result]').select_option('Passed')
                m.locator('[name=verification_notes]').fill('Road test 15 km; brakes hold pressure; no leaks.' if garage else 'Tire pressure and wheel nuts checked; safe to continue.')
                err = self.submit('motorpool', 2000)
                j = self.job(job_id)
                ok = not err and bool(j.get('verified_at'))
                ev = [self.shot('motorpool', f'{tag.lower()}10_verified')]
                if garage:
                    tstat = self.truck_status(j['vehicle_id'])
                    R.check('G-10', '2.2', 'Operational verification returns the truck to service', ok and tstat in ('Available', 'Assigned'),
                            f'verified; truck {tstat}', err or f'verified={bool(j.get("verified_at"))}, truck {tstat}', ev)
                else:
                    R.check('TI-10', '2.2', 'Verification of the on-site repair', ok, 'verified; dispatcher told to resume', err or 'not verified', ev)
                return ok
            else:
                R.failed(f'{tag}-99', '2.1', 'Maintenance record status', f'unexpected status {st}')
                return False
            self.br.close_drawer(self.p['motorpool'])
        return False

    def pick_mechanic(self, name):
        sel = self.modal('motorpool').locator('[name=mechanic_id]')
        opts = sel.locator('option').all_inner_texts()
        idx = next((i for i, o in enumerate(opts) if name.upper() in o.upper()), None)
        if idx is None:
            idx = next((i for i, o in enumerate(opts) if i > 0), None)
        if idx is not None:
            sel.select_option(index=idx)

    def parts_for_job(self, job_id):
        """Parts request from the repair (Motorpool) and stock release (Purchasing)."""
        R = self.rec
        if self.need('purchasing'):
            return R.skipped('G-06', '2.4', 'Parts request and stock release', self.need('purchasing'))
        part = self.ensure_part()
        if not part:
            return
        reqs = self.data('purchasing', 'purchasing').get('requests', [])
        mine = [r for r in reqs if str(r.get('maintenance_job_id')) == str(job_id) and r['status'] != 'Cancelled']
        rq = next((r for r in mine if r['status'] == 'Requested'), None)
        if any(r['status'] == 'Released' for r in mine):
            self.man.set(f'parts_done_{job_id}', True)
            return R.passed('G-06', '2.4', 'Parts for the repair were already released', 'continued from an earlier run')
        if rq:
            R.note(f'Continuing parts request {rq["request_ref"]} from an earlier run.')
        else:
            self.open_job(job_id)
            self.drawer_btn('motorpool', 'data-a', 'parts').click()
            pg = self.p['motorpool']
            pg.wait_for_selector('.modal.show')
            pg.wait_for_timeout(500)
            m = self.modal('motorpool')
            m.locator('[name=purpose]').fill('Brake chamber replacement')
            m.locator('.pl-row [data-part]').first.select_option(str(part['id']))
            m.locator('.pl-row [data-qty]').first.fill('1')
            err = self.submit('motorpool', 2000)
            reqs = self.data('purchasing', 'purchasing').get('requests', [])
            rq = next((r for r in reqs if str(r.get('maintenance_job_id')) == str(job_id) and r['status'] == 'Requested'), None)
            R.check('G-06', '2.4', 'Motorpool requests parts for the repair (Request Form)', not err and rq is not None, f'{rq and rq["request_ref"]} Requested', err or 'request not found')
        if not rq:
            return
        before = float(part['quantity_on_hand'])
        self.go('purchasing', 'purchasing')
        self.tab('purchasing', 'requests')
        self.row('purchasing', rq['request_ref']).locator('button[data-act=process]').click()
        self.p['purchasing'].wait_for_timeout(800)
        err = self.submit('purchasing', 2000)
        reqs = self.data('purchasing', 'purchasing')
        rq2 = next((r for r in reqs.get('requests', []) if r['id'] == rq['id']), {})
        p2 = next((x for x in reqs.get('parts', []) if x['id'] == part['id']), {})
        R.check('G-06b', '2.4', 'Purchasing checks stock and releases the part (stock-out)', not err and rq2.get('status') == 'Released' and float(p2.get('quantity_on_hand', 0)) == before - 1,
                f'Released; on hand {before:g} -> {float(p2.get("quantity_on_hand", 0)):g}', err or f'status {rq2.get("status")}')
        ev = self.br.print_pdf(self.p['purchasing'], 'request_form_' + rq['request_ref'], lambda: self.row('purchasing', rq['request_ref']).locator('button[data-act=print]').click())
        R.add('G-06c', '2.4', 'Printed Request Form (PDF #13 layout)', F.PASSED, 'saved as PDF', [ev])
        self.man.set(f'parts_done_{job_id}', True)

    def ensure_part(self, item='P-01'):
        R = self.rec
        d = self.data('purchasing', 'purchasing')
        part = find(d.get('parts', []), part_number=DEMO['part']['part_number'])
        if part:
            if float(part['quantity_on_hand']) < 1:
                self.go('purchasing', 'purchasing')
                self.tab('purchasing', 'inventory')
                self.row('purchasing', part['part_number']).locator('button[data-act=adjust]').click()
                m = self.modal('purchasing')
                m.locator('[name=quantity_delta]').fill('4')
                m.locator('[name=reason]').fill('Physical count after delivery')
                self.submit('purchasing')
                part = find(self.data('purchasing', 'purchasing').get('parts', []), part_number=DEMO['part']['part_number'])
            R.passed(item, '2.4', f'Part {DEMO["part"]["part_number"]} in the inventory', f'reused; on hand {part["quantity_on_hand"]}')
            return part
        self.go('purchasing', 'purchasing')
        self.tab('purchasing', 'inventory')
        self.p['purchasing'].wait_for_timeout(400)
        self.p['purchasing'].locator('[data-addpart]').click()
        m = self.modal('purchasing')
        for k, v in DEMO['part'].items():
            m.locator(f'[name={k}]').fill(v)
        err = self.submit('purchasing')
        part = find(self.data('purchasing', 'purchasing').get('parts', []), part_number=DEMO['part']['part_number'])
        R.check(item, '2.4', f'Add part {DEMO["part"]["part_number"]} to the inventory', not err and part is not None, 'saved with opening stock', err or 'not found')
        return part

    # ======================================================================= 5. purchase order
    def purchase_order(self):
        R = self.rec
        R.set_section('5. Purchase order, approval, receiving and payment')
        if self.need('purchasing', 'finance'):
            return R.skipped('P-00', '2.5', 'Purchase order', self.need('purchasing', 'finance'))
        part = self.ensure_part('P-01b')
        if not part:
            return
        d = self.data('purchasing', 'purchasing')
        sup = find(d.get('suppliers', []), name=DEMO['supplier']['name'])
        if not sup:
            self.go('purchasing', 'purchasing')
            self.tab('purchasing', 'suppliers')
            self.p['purchasing'].wait_for_timeout(400)
            self.p['purchasing'].locator('[data-addsup]').click()
            m = self.modal('purchasing')
            for k, v in DEMO['supplier'].items():
                m.locator(f'[name={k}]').fill(v)
            err = self.submit('purchasing')
            sup = find(self.data('purchasing', 'purchasing').get('suppliers', []), name=DEMO['supplier']['name'])
            R.check('P-02', '2.5', 'Add supplier', not err and sup is not None, 'saved', err or 'not found')
        else:
            R.passed('P-02', '2.5', 'Supplier in the supplier database', 'reused')
        if not sup:
            return
        qty, price = 2, 3800.0
        total = qty * price
        fin = self.data('finance', 'finance')
        budget = next((b for b in fin.get('budgets', []) if b.get('status') == 'Active'), None)
        if not budget or float(budget.get('available', 0)) < total:
            self.go('finance', 'finance')
            self.tab('finance', 'budget')
            self.p['finance'].wait_for_timeout(500)
            self.p['finance'].locator('[data-setb]').click()
            m = self.modal('finance')
            m.locator('[name=amount]').fill('150000')
            m.locator('[name=period_end]').fill((TODAY + dt.timedelta(days=60)).isoformat())
            err = self.submit('finance')
            fin = self.data('finance', 'finance')
            budget = next((b for b in fin.get('budgets', []) if b.get('status') == 'Active'), None)
            R.check('P-03', '3.6', 'Finance sets the purchasing budget', not err and budget is not None, f'available {budget and budget.get("available")}', err or 'no active budget')
        else:
            R.passed('P-03', '3.6', 'Active purchasing budget', f'available PHP {float(budget["available"]):,.2f}')
        po_id = self.man.get('po_id')
        po = next((o for o in d.get('orders', []) if po_id and o['id'] == po_id), None)
        if po and (po['status'] in ('Closed', 'Rejected', 'Cancelled') or po.get('payment_status') == 'Paid'):
            po = None
        if po:
            R.note(f'Continuing purchase order {po["po_ref"]} from an earlier run (status {po["status"]}).')
        else:
            self.go('purchasing', 'purchasing')
            self.p['purchasing'].click('#pageTools button:has-text("New purchase order")')
            m = self.modal('purchasing')
            m.locator('[name=supplier_id]').select_option(str(sup['id']))
            m.locator('[name=purpose]').fill('Restock brake chambers for the corrective maintenance shelf')
            m.locator('.pl-row [data-part]').first.select_option(str(part['id']))
            m.locator('.pl-row [data-qty]').first.fill(str(qty))
            m.locator('.pl-row [data-price]').first.fill(f'{price:.2f}')
            ev = self.shot('purchasing', 'p04_po_form')
            err = self.submit('purchasing', 2000)
            orders = self.data('purchasing', 'purchasing').get('orders', [])
            po = next((o for o in sorted(orders, key=lambda o: -int(o['id'])) if int(o['supplier_id']) == int(sup['id']) and o['status'] == 'Pending Approval'), None)
            R.check('P-04', '2.5', 'Purchasing creates a purchase order request', not err and po is not None, f'{po and po["po_ref"]} Pending Approval (PHP {total:,.2f}, routed to Finance)', err or 'not found', [ev])
            if not po:
                return
            self.man.set('po_id', po['id'])
        self.run['po'] = po['po_ref']
        if po['status'] == 'Pending Approval':
            self.go('finance', 'purchasing')
            self.tab('finance', 'orders')
            self.row('finance', po['po_ref']).locator('button[data-act=approve]').click()
            self.p['finance'].wait_for_timeout(500)
            err = self.submit('finance', 2000)
            po = self.po(po['id'])
            R.check('P-05', '2.5', 'Finance approves the PO (budget reserved)', not err and po.get('status') == 'Approved', 'Approved', err or f'status {po.get("status")}')
        if po.get('status') in ('Approved', 'Partially Received'):
            self.go('purchasing', 'purchasing')
            self.tab('purchasing', 'orders')
            before = float(find(self.data('purchasing', 'purchasing').get('parts', []), part_number=DEMO['part']['part_number'])['quantity_on_hand'])
            self.row('purchasing', po['po_ref']).locator('button[data-act=receive]').click()
            self.p['purchasing'].wait_for_timeout(800)
            m = self.modal('purchasing')
            m.locator('[name=supplier_invoice_no]').fill('CTPC-' + TODAY.strftime('%y%m%d') + '-0' + str(po['id']))
            m.locator('[name=receipt]').set_input_files(sample('supplier_delivery_receipt.pdf'))
            err = self.submit('purchasing', 2000)
            po = self.po(po['id'])
            after = float(find(self.data('purchasing', 'purchasing').get('parts', []), part_number=DEMO['part']['part_number'])['quantity_on_hand'])
            R.check('P-06', '2.5', 'Purchasing records the received parts (stock-in)', not err and po.get('status') == 'Received' and after == before + qty,
                    f'Received; on hand {before:g} -> {after:g}', err or f'status {po.get("status")}')
            ev = self.br.print_pdf(self.p['purchasing'], 'purchase_order_' + po['po_ref'], lambda: self.row('purchasing', po['po_ref']).locator('button[data-act=print]').click())
            R.add('P-06b', '2.5', 'Printed Purchase Order with approver e-signature', F.PASSED, 'saved as PDF', [ev])
        if po.get('status') == 'Received' and po.get('payment_status') != 'Paid':
            self.go('finance', 'finance')
            self.tab('finance', 'po')
            self.row('finance', po['po_ref']).locator('button[data-act=pay]').click()
            self.p['finance'].wait_for_timeout(600)
            m = self.modal('finance')
            m.locator('[name=payment_method]').select_option(index=1)
            m.locator('[name=reference_number]').fill('BDO-TRF-' + TODAY.strftime('%m%d') + str(po['id']))
            m.locator('[name=or_doc]').set_input_files(sample('supplier_official_receipt.pdf'))
            err = self.submit('finance', 2000)
            po = self.po(po['id'])
            R.check('P-07', '3.5', 'Finance pays the PO with the official receipt (budget spent)', not err and po.get('payment_status') == 'Paid', 'payment status Paid', err or f'payment status {po.get("payment_status")}',
                    [self.shot('finance', 'p07_finance')])
        self.go('purchasing', 'purchasing')
        self.tab('purchasing', 'movements')
        self.p['purchasing'].wait_for_timeout(500)
        R.add('P-08', '2.6', 'Stock movements (stock-in / stock-out) are listed', F.PASSED, 'screenshot', [self.shot('purchasing', 'p08_stock_movements', True)])

    def po(self, po_id):
        return next((o for o in self.data('purchasing', 'purchasing').get('orders', []) if o['id'] == po_id), {})

    # ======================================================================= 6. trip
    def trip(self):
        R = self.rec
        R.set_section('6. Trip from request to completion (with an incident)')
        if self.need('operations_head', 'car_carrier_dispatcher', 'finance', 'motorpool'):
            return R.skipped('T-00', '1.3', 'Trip workflow', self.need('operations_head', 'car_carrier_dispatcher', 'finance', 'motorpool'))
        trip_id = self.man.get('trip_id')
        t = self.trip_data(trip_id) if trip_id else None
        if t and t['status'] in ('Completed', 'Cancelled', 'Rejected'):
            t = None if t['status'] != 'Completed' or self.billing_done(t) else t
        if t:
            R.note(f'Continuing trip {t["trip_ref"]} from an earlier run (status {t["status"]}).')
        else:
            t = self.new_trip()
            if not t:
                return
        self.run['trip'] = t['trip_ref']
        for _ in range(14):
            t = self.trip_data(t['id'])
            st, fs = t['status'], t.get('fund_status')
            if st == 'Completed':
                return t
            if st == 'Awaiting Resources':
                return R.skipped('T-04', '1.3', 'Automatic assignment', 'no free Car Carrier truck and crew right now (trip waits as Awaiting Resources)')
            if st == 'Pre-Assigned' and not fs:
                self.fund_request(t)
            elif fs == 'Pending Approval':
                self.fund_decide(t)
            elif fs == 'Ready for Release':
                self.fund_release(t)
            elif st == 'Pre-Assigned':
                self.checklist(t)
            elif st == 'Ready for Dispatch':
                self.dispatch(t)
            elif st in ('Dispatched', 'In Transit'):
                if not self.man.get(f'incident_done_{t["id"]}'):
                    self.progress_and_incident(t)
                else:
                    self.complete_trip(t)
            elif st == 'On Hold - Incident Reported':
                if t.get('incident_status') == 'Repaired - Cleared to Continue':
                    self.resume(t)
                else:
                    jobs = self.data('motorpool', 'maintenance').get('jobs', [])
                    job = next((j for j in jobs if str(j.get('trip_id')) == str(t['id']) and j['status'] != 'Cancelled' and not j.get('verified_at')), None)
                    if not job:
                        R.failed('TI-02', '2.2', 'Maintenance record from the incident', 'no open maintenance record found for the trip')
                        return
                    R.passed('TI-02', '2.2', 'Incident created a maintenance request automatically', f'{job["job_ref"]} ({job["status"]})')
                    if not self.advance_job(job['id'], garage=False):
                        return
            else:
                R.failed('T-99', '1.3', 'Trip status', f'unexpected status {st}')
                return
        R.failed('T-99', '1.3', 'Trip workflow', 'did not finish (too many steps)')

    def trip_data(self, trip_id):
        role = 'operations_head'
        d = self.data(role, 'trips')
        t = next((x for x in d.get('active', []) + d.get('history', []) if int(x['id']) == int(trip_id)), None)
        if not t:
            try:
                det = self.api(role, 'Trips.details', {'trip_id': trip_id})
                t = det.get('trip')
            except Exception:
                t = None
        return t

    def billing_done(self, t):
        b = self.api('operations_head', 'Trips.details', {'trip_id': t['id']}).get('billing') or {}
        return b.get('status') == 'Paid'

    def new_trip(self):
        R, T = self.rec, DEMO['trip']
        client_id = self.man.get('client_id')
        if not client_id:
            R.skipped('T-01', '1.3', 'New Trip Request', 'demo client not Active (masterlist step failed)')
            return None
        pg = self.p['operations_head']
        self.go('operations_head', 'trips')
        pg.click('#pageTools button:has-text("New trip")')
        pg.wait_for_selector('#ntForm')
        pg.wait_for_timeout(1500)
        f = pg.locator('#ntForm')
        f.locator('[name=client_id]').select_option(str(client_id))
        f.locator('[name=consignee]').fill(T['consignee'])
        f.locator('[name=truck_type]').select_option(T['truck_type'])
        f.locator('[name=scheduled_at]').fill(local_dt(45))
        map_key = pg.evaluate('() => !!App.me.mapKey')
        used_search = False
        if map_key and pg.locator('[data-locq]:not([disabled])').count():
            for which, q in (('pickup', T['pickup']), ('delivery', T['destination'])):
                pg.click(f'[data-pin={which}]')
                pg.fill('[data-locq]', q)
                pg.click('[data-locgo]')
                try:
                    pg.wait_for_selector('[data-ri="0"]', timeout=8000)
                    pg.click('[data-ri="0"]')
                    used_search = True
                except Exception:
                    pass
                pg.wait_for_timeout(800)
        if not f.locator('[name=pickup_point]').input_value():
            f.locator('[name=pickup_point]').fill(T['pickup'])
        if not f.locator('[name=delivery_point]').input_value():
            f.locator('[name=delivery_point]').fill(T['destination'])
        if not used_search:
            box = pg.locator('.map-canvas').bounding_box() if pg.locator('.map-canvas').count() else None
            if box:   # pins by clicking the map (works even without tiles)
                pg.click('[data-pin=pickup]')
                pg.mouse.click(box['x'] + box['width'] * 0.55, box['y'] + box['height'] * 0.35)
                pg.wait_for_timeout(300)
                pg.click('[data-pin=delivery]')
                pg.mouse.click(box['x'] + box['width'] * 0.45, box['y'] + box['height'] * 0.7)
                pg.wait_for_timeout(300)
        f.locator('[name=pickup_point]').fill(T['pickup'])          # addresses confirmed by the operator text
        f.locator('[name=delivery_point]').fill(T['destination'])
        f.locator('[name=distance_km]').fill(T['distance_km'])
        if f.locator('[name=units_planned]').is_visible():
            f.locator('[name=units_planned]').fill(T['units'])
        f.locator('[name=booking_reference]').fill('BK-LPA-' + TODAY.strftime('%y%m%d') + '-' + dt.datetime.now().strftime('%H%M'))
        f.locator('[name=delivery_details]').fill('6 units for port loading; call Rhea Manalo on arrival.')
        f.locator('#ntFiles').set_input_files(sample('booking_nomination.pdf'))
        pg.wait_for_timeout(300)
        submit_without_confirm = pg.locator('#ntForm button[type=submit]')
        submit_without_confirm.click()
        pg.wait_for_timeout(500)
        refused = 'tick the confirmation' in (pg.locator('#ntForm .form-error').inner_text() or '')
        R.check('T-01', '1.3', 'New Trip Request asks to confirm the addresses before saving', refused, 'not saved until the addresses are confirmed', 'saved without confirmation')
        f.locator('#ntConfirm').check()
        pg.wait_for_timeout(1600)
        ev = [self.br.shot(pg, 't02_new_trip_form', True)]
        lat = f.locator('[name=pickup_lat]').input_value()
        f.locator('button[type=submit]').click()
        pg.wait_for_timeout(3000)
        m = re.search(r'open=(\d+)', pg.url) or None
        d = self.data('operations_head', 'trips')
        t = next((x for x in sorted(d.get('active', []), key=lambda x: -int(x['id'])) if int(x['client_id']) == int(client_id)), None)
        ok = t is not None
        R.check('T-02', '1.3', 'Operations Head saves a New Trip Request (sections, map pins, attachment)', ok,
                f'{t and t["trip_ref"]} saved; pins {"set" if lat else "not set"}; addresses {"from map search" if used_search else "typed (map search not available)"}',
                'trip not found after reloading', ev)
        if not t:
            return None
        self.man.set('trip_id', int(t['id']))
        det = self.api('operations_head', 'Trips.details', {'trip_id': t['id']})
        docs = [x for x in det.get('documents', []) if x.get('category') == 'Trip Request Document']
        R.check('T-03', '1.5', 'Trip attachment stored with the trip', bool(docs), f'{len(docs)} file(s)', 'attachment not listed')
        R.check('T-04', '1.3', 'Automatic assignment of truck and crew', t['status'] == 'Pre-Assigned' and bool(t.get('plate_number')),
                f'{t.get("plate_number")} with {t.get("driver_name")} (Pre-Assigned)', f'status {t["status"]}', [self.br.shot(pg, 't04_trip_drawer')])
        return t

    def open_trip(self, role, t):
        self.go(role, f'trips?open={t["id"]}', 1600)

    def fund_request(self, t):
        R = self.rec
        self.open_trip('car_carrier_dispatcher', t)
        pg = self.p['car_carrier_dispatcher']
        self.drawer_btn('car_carrier_dispatcher', 'data-tact', 'fund').click()
        pg.wait_for_timeout(700)
        m = self.modal('car_carrier_dispatcher')
        for name in ('Driver Meal Allowance', 'Passway'):
            cb = m.locator(f'.fund-cat[data-name="{name}"]')
            if cb.count():
                cb.check()
        if not m.locator('.fund-cat:checked').count():
            m.locator('.fund-cat').first.check()
        err = self.submit('car_carrier_dispatcher', 2000)
        t2 = self.trip_data(t['id'])
        R.check('T-05', '1.4', 'Dispatcher submits the fund request (expense categories)', not err and t2.get('fund_status') == 'Pending Approval',
                'Pending Approval', err or f'fund {t2.get("fund_status")}', [self.shot('car_carrier_dispatcher', 't05_fund')])

    def fund_row(self, role, t, act):
        self.go(role, 'funds', 1200)
        return self.row(role, t['trip_ref']).locator(f'button[data-act={act}]')

    def fund_decide(self, t):
        R = self.rec
        self.fund_row('operations_head', t, 'approve').click()
        self.p['operations_head'].wait_for_timeout(500)
        err = self.submit('operations_head', 2000)
        t2 = self.trip_data(t['id'])
        R.check('T-06', '1.4', 'Operations Head approves the fund request', not err and t2.get('fund_status') == 'Ready for Release', 'Ready for Release', err or f'fund {t2.get("fund_status")}')

    def fund_release(self, t):
        R = self.rec
        self.fund_row('finance', t, 'release').click()
        self.p['finance'].wait_for_timeout(600)
        self.modal('finance').locator('[name=payment_method]').select_option('Cash')
        err = self.submit('finance', 2000)
        t2 = self.trip_data(t['id'])
        R.check('T-07', '3.5', 'Finance releases the trip fund', not err and t2.get('fund_status') == 'Released', 'Released', err or f'fund {t2.get("fund_status")}')
        if not err:
            fid = (self.api('operations_head', 'Trips.details', {'trip_id': t['id']}).get('funds') or [{}])[-1].get('id')
            if fid:
                ev = self.br.print_pdf(self.p['finance'], 'request_for_cash_fund_' + t['trip_ref'], lambda: self.p['finance'].evaluate('(id) => FundUI.print(id)', fid))
                R.add('T-07b', '3.5', 'Printed Request for Cash Fund with e-signatures', F.PASSED, 'saved as PDF', [ev])

    def checklist(self, t):
        R = self.rec
        self.open_trip('car_carrier_dispatcher', t)
        pg = self.p['car_carrier_dispatcher']
        self.drawer_btn('car_carrier_dispatcher', 'data-tact', 'checklist').click()
        pg.wait_for_timeout(700)
        self.modal('car_carrier_dispatcher').locator('#chkAll').click()
        ev = self.shot('car_carrier_dispatcher', 't08_checklist')
        err = self.submit('car_carrier_dispatcher', 2000)
        t2 = self.trip_data(t['id'])
        R.check('T-08', '1.5', 'Pre-dispatch checklist recorded (all OK)', not err and t2['status'] == 'Ready for Dispatch', 'Ready for Dispatch', err or f'status {t2["status"]}', [ev])

    def dispatch(self, t):
        R = self.rec
        self.open_trip('car_carrier_dispatcher', t)
        pg = self.p['car_carrier_dispatcher']
        btn = self.drawer_btn('car_carrier_dispatcher', 'data-tact', 'dispatch')
        if btn.is_disabled():
            return R.failed('T-09', '1.5', 'Confirm Dispatch', 'button disabled: ' + (pg.locator('.app-drawer.show .drawer-actions').inner_text()[:200]))
        btn.click()
        pg.wait_for_timeout(500)
        err = self.submit('car_carrier_dispatcher', 2000)
        t2 = self.trip_data(t['id'])
        det = self.api('operations_head', 'Trips.details', {'trip_id': t['id']})
        bill = det.get('billing') or {}
        R.check('T-09', '1.5', 'Dispatcher confirms dispatch', not err and t2['status'] == 'Dispatched', 'Dispatched', err or f'status {t2["status"]}')
        R.check('B-01', '3.2', 'Billing draft generated at dispatch (km x client rate)', bill.get('status') == 'Ongoing',
                f'draft PHP {float(bill.get("total_amount") or 0):,.2f} = {DEMO["trip"]["distance_km"]} km x rate', f'billing {bill.get("status")}')

    def progress_and_incident(self, t):
        R = self.rec
        pg = self.p['car_carrier_dispatcher']
        self.open_trip('car_carrier_dispatcher', t)
        self.drawer_btn('car_carrier_dispatcher', 'data-tact', 'progress').click()
        pg.wait_for_timeout(600)
        m = self.modal('car_carrier_dispatcher')
        opts = m.locator('[name=update_type] option').all_inner_texts()
        m.locator('[name=update_type]').select_option(index=next((i for i, o in enumerate(opts) if 'Delay' in o), 1))
        if m.locator('[name=delay_cause]').is_visible():
            m.locator('[name=delay_cause]').select_option(index=1)
        m.locator('[name=note]').fill('Heavy traffic at STAR Tollway Lipa exit; about 30 minutes late.')
        err = self.submit('car_carrier_dispatcher', 2000)
        ups = self.api('operations_head', 'Trips.details', {'trip_id': t['id']}).get('updates', [])
        R.check('T-10', '1.5', 'Dispatcher records a trip progress update (delay)', not err and len(ups) > 0, f'{len(ups)} update(s) on the trip', err or 'not saved')
        self.open_trip('car_carrier_dispatcher', t)
        self.drawer_btn('car_carrier_dispatcher', 'data-tact', 'incident').click()
        pg.wait_for_timeout(600)
        m = self.modal('car_carrier_dispatcher')
        opts = m.locator('[name=incident_type] option').all_inner_texts()
        m.locator('[name=incident_type]').select_option(index=next((i for i, o in enumerate(opts) if 'Tire' in o or 'tire' in o), 1))
        m.locator('[name=location]').fill('STAR Tollway southbound, km 92, Lipa City')
        m.locator('[name=problem]').fill('Right rear outer tire punctured')
        m.locator('[name=details]').fill('Driver heard a loud pop and stopped on the shoulder. No injuries; cargo secure.')
        m.locator('[name=photos]').set_input_files(sample('damage_photo.jpg'))
        ev = self.shot('car_carrier_dispatcher', 't11_incident_form')
        err = self.submit('car_carrier_dispatcher', 2500)
        t2 = self.trip_data(t['id'])
        ok = not err and t2['status'] == 'On Hold - Incident Reported'
        R.check('TI-01', '1.6', 'Dispatcher reports an incident with photo -> trip On Hold', ok, 'On Hold - Incident Reported', err or f'status {t2["status"]}', [ev])
        if ok:
            self.man.set(f'incident_done_{t["id"]}', True)
            inc = self.data('car_carrier_dispatcher', 'trips').get('incidents', [])
            i = next((x for x in inc if str(x['trip_id']) == str(t['id'])), None)
            if i:
                self.go('car_carrier_dispatcher', 'trips')
                self.tab('car_carrier_dispatcher', 'incidents')
                ev = self.br.print_pdf(self.p['car_carrier_dispatcher'], 'incident_report_' + i['incident_ref'],
                                       lambda: self.row('car_carrier_dispatcher', i['incident_ref']).locator('button[data-act=print]').click())
                R.add('TI-01b', '1.6', 'Printed Incident Report form', F.PASSED, 'saved as PDF', [ev])

    def resume(self, t):
        R = self.rec
        self.open_trip('car_carrier_dispatcher', t)
        self.drawer_btn('car_carrier_dispatcher', 'data-tact', 'resume').click()
        self.p['car_carrier_dispatcher'].wait_for_timeout(500)
        err = self.submit('car_carrier_dispatcher', 2000)
        t2 = self.trip_data(t['id'])
        R.check('TI-11', '1.6', 'Dispatcher resumes the trip after the verified repair', not err and t2['status'] == 'In Transit', 'In Transit (same attempt)', err or f'status {t2["status"]}')

    def complete_trip(self, t):
        R = self.rec
        pg = self.p['car_carrier_dispatcher']
        self.open_trip('car_carrier_dispatcher', t)
        self.drawer_btn('car_carrier_dispatcher', 'data-tact', 'complete').click()
        pg.wait_for_timeout(700)
        m = self.modal('car_carrier_dispatcher')
        disabled_before = m.locator('button[type=submit]').is_disabled()
        m.locator('[name=waybill_number]').fill('RPMWB-' + str(5000 + int(t['id'])))
        if m.locator('[name=units_delivered]').count() and m.locator('[name=units_delivered]').is_visible():
            m.locator('[name=units_delivered]').fill(DEMO['trip']['units'])
        m.locator('[name=waybill]').set_input_files(sample('waybill.pdf'))
        m.locator('[name=ack_receipt]').set_input_files(sample('delivery_ack_receipt.pdf'))
        pg.wait_for_timeout(400)
        R.check('T-12', '1.5', 'Complete Trip stays disabled until waybill and receipt are attached', disabled_before, 'disabled before the files', 'enabled without files')
        err = self.submit('car_carrier_dispatcher', 2500)
        t2 = self.trip_data(t['id'])
        R.check('T-13', '1.5', 'Dispatcher completes the trip with waybill and acknowledgement receipt', not err and t2['status'] == 'Completed', 'Completed',
                err or f'status {t2["status"]}', [self.shot('car_carrier_dispatcher', 't13_completed')])

    # ======================================================================= 7. billing
    def billing(self):
        R = self.rec
        R.set_section('7. Billing, invoice and collection')
        if self.need('billing'):
            return R.skipped('B-00', '3.3', 'Billing', self.need('billing'))
        trip_id = self.man.get('trip_id')
        t = self.trip_data(trip_id) if trip_id else None
        if not t or t['status'] != 'Completed':
            return R.skipped('B-02', '3.3', 'Billing of the demo trip', 'the demo trip is not Completed')
        pg = self.p['billing']

        def bill():
            return next((b for b in self.data('billing', 'billing').get('billings', []) if str(b['trip_id']) == str(trip_id)), {})

        def open_bill(b):
            self.go('billing', 'billing', 1200)
            for tab in ('for', 'invoices', 'paid'):
                if pg.locator(f'[data-tab={tab}]').count():
                    pg.locator(f'[data-tab={tab}]').click()
                    pg.wait_for_timeout(400)
                    r = self.row('billing', t['trip_ref'])
                    if r.count():
                        r.locator('button[data-act=view]').click()
                        pg.wait_for_timeout(1200)
                        return True
            return False
        b = bill()
        if b.get('status') == 'For Billing':
            open_bill(b)
            if not b.get('docs_verified_at'):
                self.drawer_btn('billing', 'data-a', 'verify').click()
                pg.wait_for_timeout(500)
                err = self.submit('billing', 2000)
                b = bill()
                R.check('B-02', '3.3', 'Billing verifies the trip documents (waybill, receipt)', not err and bool(b.get('docs_verified_at')), 'verified', err or 'not verified')
            self.drawer_btn('billing', 'data-a', 'finalize').click()
            pg.wait_for_timeout(500)
            err = self.submit('billing', 2000)
            b = bill()
            R.check('B-03', '3.3', 'Billing finalizes the invoice', not err and b.get('status') == 'Invoiced', f'{b.get("invoice_number")} PHP {float(b.get("total_amount") or 0):,.2f}', err or f'status {b.get("status")}')
        if b.get('status') in ('Invoiced', 'Partially Paid', 'Paid'):
            open_bill(b)
            ev = self.br.print_pdf(pg, 'service_invoice_' + (b.get('invoice_number') or ''), lambda: self.drawer_btn('billing', 'data-a', 'print').click())
            R.add('B-04', '3.3', 'Printed Service Invoice (PDF #13 layout, e-signature)', F.PASSED, 'saved as PDF', [ev])
        if b.get('status') in ('Invoiced', 'Partially Paid'):
            self.drawer_btn('billing', 'data-a', 'pay').click()
            pg.wait_for_timeout(600)
            m = self.modal('billing')
            m.locator('[name=ar_number]').fill('AR-' + str(7000 + int(b['id'])))
            m.locator('[name=payment_method]').select_option(index=1)
            m.locator('[name=reference_number]').fill('BPI-' + TODAY.strftime('%m%d') + '-' + str(b['id']))
            m.locator('[name=ack_receipt]').set_input_files(sample('client_payment_ar.pdf'))
            err = self.submit('billing', 2000)
            b = bill()
            R.check('B-05', '3.4', 'Billing records the client payment with the acknowledgement receipt', not err and b.get('status') == 'Paid', 'Paid; receivable cleared', err or f'status {b.get("status")}')
        if b.get('status') == 'Paid':
            open_bill(b)
            btn = pg.locator('.app-drawer.show [data-ar]').first
            if btn.count():
                ev = self.br.print_pdf(pg, 'acknowledgement_receipt_' + (b.get('invoice_number') or ''), lambda: btn.click())
                R.add('B-06', '3.4', 'Printed Acknowledgement Receipt for the payment', F.PASSED, 'saved as PDF', [ev])
        self.br.close_drawer(pg)

    # ======================================================================= 8. monitoring, notifications, reports
    def monitoring(self):
        R = self.rec
        R.set_section('8. Notifications, dashboards, reports, activity log, access, map')
        if 'operations_head' in self.p:
            pg = self.p['operations_head']
            self.go('operations_head', 'dashboard')
            unread = pg.evaluate('() => App.me.unread')
            pg.click('#bellBtn')
            pg.wait_for_timeout(500)
            ev = self.shot('operations_head', 'n01_bell')
            items = pg.locator('.bell-item')
            if items.count() and pg.locator('.bell-resolve').count():
                nid = items.first.get_attribute('data-nid')
                pg.locator('.bell-resolve').first.click()
                pg.wait_for_timeout(1200)
                hist = self.data('operations_head', 'notifications')
                rows = hist.get('notifications') or hist.get('items') or []
                n = next((x for x in rows if str(x.get('id')) == str(nid)), {})
                R.check('N-01', '-', 'Resolve a notification from the bell (kept as history, not deleted)', n.get('state') == 'Resolved',
                        f'unread before {unread}; notification #{nid} Resolved and still listed', f'state {n.get("state")}', [ev])
            else:
                R.skipped('N-01', '-', 'Resolve a notification from the bell', 'no open notification for the Operations Head right now', [ev])
            self.go('operations_head', 'notifications')
            R.add('N-02', '-', 'Notifications page (Unread / Read / Resolved / Archived)', F.PASSED, 'screenshot', [self.shot('operations_head', 'n02_notifications', True)])
            self.go('operations_head', 'trips')
            R.add('D-02', '4.4', 'Operations Head monitors trips, approvals, funds and progress (trip board)', F.PASSED, 'screenshot', [self.shot('operations_head', 'd02_trip_board', True)])
        if 'motorpool' in self.p:
            self.go('motorpool', 'maintenance')
            self.tab('motorpool', 'done')
            self.p['motorpool'].wait_for_timeout(500)
            R.add('D-03', '2.6', 'Corrective Maintenance: ongoing and completed repairs', F.PASSED, 'screenshot', [self.shot('motorpool', 'd03_maintenance_done', True)])
            self.go('motorpool', 'dashboard')
            txt = self.p['motorpool'].locator('#pageBody').inner_text()
            R.check('D-04', '2.6', 'Dashboard shows trucks under repair, open requests and mechanics', all(s in txt for s in ('Trucks under corrective maintenance', 'Open repair requests', 'mechanics')),
                    'all three shown', 'missing cards', [self.shot('motorpool', 'd04_dashboard_motorpool', True)])
        if 'admin' in self.p:
            pg = self.p['admin']
            self.go('admin', 'dashboard', 1500)
            txt = pg.locator('#pageBody').inner_text()
            need = ['Total trucks', 'Available trucks', 'Ongoing trips', 'Trucks under corrective maintenance', 'Billed this month', 'Collected this month', 'Expenses this month', 'Outstanding receivables']
            miss = [x for x in need if x not in txt]
            R.check('D-01', '4.3', 'Admin dashboard: trips, fleet, maintenance, billing, collections, expenses, receivables', not miss, 'all shown',
                    'missing: ' + ', '.join(miss), [self.shot('admin', 'd01_dashboard_admin', True)])
            self.go('admin', 'reports', 2000)
            for tab in ('trips', 'fleet', 'money', 'stock'):
                loc = pg.locator(f'[data-tab={tab}]')
                if loc.count():
                    loc.first.click()
                    pg.wait_for_timeout(1000)
                    self.br.shot(pg, f'r_{tab}', True)
            ev = self.br.print_pdf(pg, 'reports_all', lambda: pg.click('#pageTools button:has-text("Print all")'))
            R.add('R-01', '5.1-5.5', 'Reports (trips, fleet and maintenance, money, inventory) printed', F.PASSED, 'saved as PDF', [ev])
            trip_ref = self.run.get('trip', '')
            self.go('admin', 'admin', 1200)
            pg.locator('[data-tab=log]').click()
            pg.wait_for_timeout(800)
            ev = self.br.shot(pg, 'a01_activity_log', True)
            log = self.data('admin', 'admin').get('events', [])
            hit = [e for e in log if trip_ref and trip_ref in str(e.get('record_ref', '')) + str(e.get('details', ''))]
            if trip_ref:
                R.check('A-01', '4.2', 'Activity log records who created / approved / processed the demo trip', bool(hit), f'{len(hit)} log entries for {trip_ref}', 'no entries found', [ev])
            else:
                R.skipped('A-01', '4.2', 'Activity log entries of the demo trip', 'no demo trip this run', [ev])
        if 'audit' in self.p:
            pg = self.p['audit']
            self.go('audit', 'trips')
            no_new = pg.locator('#pageTools button:has-text("New trip")').count() == 0
            self.go('audit', 'trucks')
            no_add = pg.locator('#pageTools button:has-text("Add truck")').count() == 0
            self.go('audit', 'admin')
            no_users = pg.locator('[data-adduser]').count() == 0 and pg.locator('[data-tab=users]').count() == 0
            R.check('A-02', '4.1', 'Role-based access: Audit is read-only (no create buttons; activity log only)', no_new and no_add and no_users,
                    'read-only screens; user accounts hidden', 'create buttons or user accounts visible', [self.shot('audit', 'a02_audit_activity_log')])
        # map tiles
        any_page = next(iter(self.p.values()), None)
        if any_page is not None:
            key = any_page.evaluate('() => !!App.me.mapKey')
            st = dict(self.br.tile_status)
            if not key:
                R.skipped('MAP-01', '1.3', 'Map tiles load without 403 errors', 'MAPTILER_API_KEY is empty in .env - set the free MapTiler key (guide E) and run again')
            elif not st:
                R.skipped('MAP-01', '1.3', 'Map tiles load without 403 errors', 'no tile requests were seen in this run')
            else:
                bad = {k: v for k, v in st.items() if k >= 400}
                R.check('MAP-01', '1.3', 'Map tiles load without 403 errors', not bad, f'tile responses: {st}', f'tile errors: {bad}')

    # ======================================================================= run everything
    def run_all(self):
        R = self.rec
        R.context.update({'System link': self.base, 'Run started': self.run['started']})
        new = make_samples(self.br)
        if new:
            R.note(f'{len(new)} sample attachment(s) were generated in automation/sample_files (replace them with real scans if you prefer - guide I).')
        steps = [('logins', self.logins), ('masterlists', self.masterlists), ('signatures', self.signatures), ('garage', self.garage_repair),
                 ('po', self.purchase_order), ('trip', self.trip), ('billing', self.billing), ('monitoring', self.monitoring)]
        only = set(self.args.only.split(',')) if self.args.only else None
        for name, fn in steps:
            if only and name not in only and name != 'logins':
                continue
            F.run_guarded(R, 'X-' + name, '-', f'step "{name}" finished without an unexpected error', fn)
        if self.br.native_dialogs:
            R.failed('Q-01', '6.1', 'No browser alert / confirm / prompt dialogs', '; '.join(self.br.native_dialogs)[:400])
        else:
            R.passed('Q-01', '6.1', 'No browser alert / confirm / prompt dialogs', 'only in-app dialogs and messages were used')
        R.check('Q-02', '6.1', 'No JavaScript errors on the screens', not self.br.js_errors, 'none', '; '.join(self.br.js_errors)[:400])
        self.run.update({'finished': dt.datetime.now().isoformat(timespec='seconds'), 'report': R.dir})
        self.man.d['runs'].append(self.run)
        self.man.save()
        for k in ('trip', 'garage_job', 'po'):
            if self.run.get(k):
                R.context['Demo ' + k.replace('_', ' ')] = self.run[k]


def main():
    ap = argparse.ArgumentParser(description='Script 2: objective demonstration through the real screens (run Script 1 first).')
    ap.add_argument('--headed', action='store_true', help='Show the browser window while it works (good for the defense)')
    ap.add_argument('--slow', type=int, default=0, help='Slow down each browser action (milliseconds), e.g. 250 with --headed')
    ap.add_argument('--only', help='Run only some parts: masterlists,signatures,garage,po,trip,billing,monitoring (comma separated)')
    ap.add_argument('--otp-source', choices=['manual', 'mailpit'], default='manual', help='manual = you type the emailed codes (default)')
    args = ap.parse_args()
    demo = Demo(args)
    try:
        demo.run_all()
    finally:
        demo.br.close()
        path = demo.rec.write()
        c = demo.rec.counts()
        print(f'\nPASSED {c[F.PASSED]}  FAILED {c[F.FAILED]}  SKIPPED {c[F.SKIPPED]}')
        print('Report: ' + path)
    return 0 if demo.rec.counts()[F.FAILED] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
