#!/usr/bin/env python3
"""
tests/system_test.py  -  Mulawin FleetOps automated SYSTEM TEST (XAMPP or Hostinger)

GAMITIN LANG SA TEST COPY. HUWAG SA LIVE NA SYSTEM.
Gumagawa ito ng test accounts, clients, trucks, crew, trips, funds, billing, payroll at iba pa.
Lahat ng test record ay may tag na "TEST-<run>" para madaling makita.

Ano ang ginagawa:
  1. Pipili ka: 1) XAMPP (local)  o  2) Hostinger (test copy online)
  2. Ilalagay mo ang Admin username at password (at iba pang accounts kung meron).
     Ang wala, gagawin ng script (isang account kada role).
  3. Susubukan ang buong workflow ng PDF sa API: Scenario A, B, C, funds, checklist, dispatch,
     incident, maintenance, purchasing, inventory, billing drafts, invoice, collections,
     finance, payroll, formula settings, documents, backup, at mga bawal na gawain (negative tests).
  4. Bubuksan ang browser (Chromium) at iki-click ang bawat page, tab at sub-tab ng bawat role,
     may screenshot.
  5. Gagawa ng HTML report: tests/reports/system_test_<petsa>/report.html

Kailangan: Python 3.9+ at  pip install requests playwright  tapos  python -m playwright install chromium
Takbo:     python tests/system_test.py            (may menu)
           python tests/system_test.py --help     (para sa options na walang tanong)
Guide:     tests/SYSTEM_TEST_GUIDE.md
"""
import argparse, datetime as dt, pathlib, getpass, html, json, os, re, secrets, shutil, string, subprocess, sys, time, traceback, webbrowser

try:
    import requests
except ImportError:
    print('Kulang ang Python package na "requests". I-run muna:  pip install requests playwright')
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ACCOUNTS_FILE = os.path.join(HERE, 'system_test_accounts.json')
TIMEOUT = 90
ROLES = ['operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher', 'motorpool',
         'purchasing', 'finance', 'billing', 'payroll', 'audit']
ROLE_SHORT = {'admin': 'adm', 'operations_head': 'ops', 'car_carrier_dispatcher': 'ccd', 'container_wingvan_dispatcher': 'cwd',
              'motorpool': 'mp', 'purchasing': 'pur', 'finance': 'fin', 'billing': 'bil', 'payroll': 'pay', 'audit': 'aud'}
ROLE_LABEL = {'admin': 'Admin', 'operations_head': 'Operations Head', 'car_carrier_dispatcher': 'Car Carrier Dispatcher',
              'container_wingvan_dispatcher': 'Container / Wing Van Dispatcher', 'motorpool': 'Motorpool', 'purchasing': 'Purchasing',
              'finance': 'Finance', 'billing': 'Billing', 'payroll': 'Payroll', 'audit': 'Audit'}

BASE = ''          # .../index.php (API + app)
NOW = dt.datetime.now()
RUN = NOW.strftime('%m%d%H%M%S')
TAG = f'TEST-{RUN}'
TODAY = dt.date.today()
D = TODAY.isoformat()
TOM = (TODAY + dt.timedelta(days=1)).isoformat()
REPORT_DIR = os.path.join(HERE, 'reports', 'system_test_' + NOW.strftime('%Y%m%d_%H%M%S'))


# ----------------------------------------------------------------------------- recorder
class Recorder:
    def __init__(self):
        self.rows = []          # {section, kind, actor, role, action, expect, ok, passed, message}
        self.section_name = 'Setup'
        self.sections = []
        self.shots = []         # {role, user, page, file, problems}
        self.accounts = []      # {role, username, password, source}
        self.notes = []
        self.started = time.time()

    def section(self, name):
        self.section_name = name
        self.sections.append(name)
        print('\n== ' + name)

    def _add(self, row):
        row['section'] = self.section_name
        self.rows.append(row)
        mark = 'PASS' if row['passed'] else 'FAIL'
        who = f"[{row['actor']}] " if row.get('actor') else ''
        print(f"  {mark} {who}{row['action']}  {row.get('message', '')}"[:220])

    def step(self, api, action, label, expect, ok, message):
        passed = True if expect is None else (ok == expect)
        self._add({'kind': 'step', 'actor': api.user if api else '', 'role': api.role if api else '',
                   'action': (label + '  (' + action + ')') if label else action,
                   'expect': 'info' if expect is None else ('allowed' if expect else 'blocked'),
                   'ok': ok, 'passed': passed, 'message': str(message or '')})

    def check(self, cond, what, detail=''):
        self._add({'kind': 'check', 'actor': '', 'role': '', 'action': what, 'expect': 'check', 'ok': bool(cond),
                   'passed': bool(cond), 'message': str(detail or '')})
        return bool(cond)

    def fail(self, what, detail=''):
        return self.check(False, what, detail)

    def info(self, what, detail=''):
        self._add({'kind': 'info', 'actor': '', 'role': '', 'action': what, 'expect': 'info', 'ok': True, 'passed': True, 'message': str(detail)})

    @property
    def failures(self):
        return [r for r in self.rows if not r['passed']]


REC = Recorder()


# ----------------------------------------------------------------------------- API client
class Api:
    def __init__(self, user, pw, role=None):
        self.user, self.pw, self.role = user, pw, role
        self.s = requests.Session()
        self.csrf, self.me = '', {}

    def _json(self, r):
        try:
            return r.json()
        except Exception:
            return {'ok': False, 'error': f'HTTP {r.status_code}, hindi JSON ang sagot: ' + r.text[:200].replace('\n', ' ')}

    def whoami(self):
        r = self.s.get(BASE, params={'api': 'whoami'}, timeout=TIMEOUT)
        j = self._json(r)
        self.csrf = j.get('csrf', '')
        return j

    def login(self, record=True):
        try:
            self.whoami()
            r = self.s.post(BASE + '?api=login', json={'username': self.user, 'password': self.pw, 'csrf': self.csrf}, timeout=TIMEOUT)
            j = self._json(r)
        except Exception as e:
            j = {'ok': False, 'error': str(e)}
        if j.get('ok'):
            self.me = self._json(self.s.get(BASE, params={'api': 'me'}, timeout=TIMEOUT))
            self.csrf = self.me.get('csrf', '')
            self.role = (self.me.get('user') or {}).get('role', self.role)
        if record:
            REC.step(self, 'login', f'Login as {self.user}', True, bool(j.get('ok')), j.get('error', '') or f'role: {self.role}')
        return bool(j.get('ok')), j.get('error', '')

    @property
    def must_change(self):
        return bool(int((self.me.get('user') or {}).get('must_change_password') or 0))

    @property
    def nav(self):
        return [n['id'] for n in self.me.get('nav', [])]

    def act(self, name, data=None, expect=True, label=''):
        try:
            r = self.s.post(BASE + '?api=' + name, json=data or {}, headers={'X-CSRF-Token': self.csrf}, timeout=TIMEOUT)
            j = self._json(r)
        except Exception as e:
            j = {'ok': False, 'error': 'Connection error: ' + str(e)}
        ok = bool(j.get('ok'))
        d = j.get('data') if isinstance(j.get('data'), dict) else {}
        msg = j.get('error') or d.get('warning') or d.get('message') or ''
        REC.step(self, name, label, expect, ok, msg)
        return d

    def page(self, page, quiet=False, **q):
        try:
            r = self.s.get(BASE, params={'api': 'data', 'page': page, **q}, timeout=TIMEOUT)
            j = self._json(r)
        except Exception as e:
            j = {'ok': False, 'error': str(e)}
        if not j.get('ok'):
            if not quiet:
                REC.step(self, 'data', f'Open page "{page}"', True, False, j.get('error'))
            return {}
        data = j.get('data') or {}
        if data.get('_errors'):
            REC.step(self, 'data', f'Open page "{page}" (some sections failed)', True, False, json.dumps(data['_errors'])[:300])
        return data

    def page_status(self, page):
        r = self.s.get(BASE, params={'api': 'data', 'page': page}, timeout=TIMEOUT)
        j = self._json(r)
        return bool(j.get('ok')), j.get('error', '')


# ----------------------------------------------------------------------------- helpers
def gen_password():
    alphabet = string.ascii_letters + string.digits
    return 'Tst' + ''.join(secrets.choice(alphabet) for _ in range(11)) + str(secrets.randbelow(90) + 10)


def money(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def same(a, b):
    return money(a) is not None and money(b) is not None and abs(money(a) - money(b)) < 0.005


def ask(prompt, default=''):
    v = input(prompt + (f' [{default}]' if default else '') + ': ').strip()
    return v or default


def yes(prompt, default=False):
    v = input(prompt + (' (Y/n): ' if default else ' (y/N): ')).strip().lower()
    return default if not v else v in ('y', 'yes', 'o', 'oo')


def find(rows, **kw):
    for r in rows or []:
        if all(str(r.get(k)) == str(v) for k, v in kw.items()):
            return r
    return {}


def find_all(rows, **kw):
    return [r for r in rows or [] if all(str(r.get(k)) == str(v) for k, v in kw.items())]


def resolve_base(url):
    """Accept the folder link or the index.php link; return the index.php that answers ?api=whoami."""
    url = url.strip()
    if not re.match(r'^https?://', url):
        url = 'http://' + url
    cands = [url] if url.lower().endswith('.php') else [url.rstrip('/') + '/public/index.php', url.rstrip('/') + '/index.php']
    for c in cands:
        try:
            r = requests.get(c, params={'api': 'whoami'}, timeout=30, allow_redirects=False)
            if r.status_code == 200 and 'csrf' in r.json():
                return c
        except Exception:
            pass
    return None


def load_saved_accounts():
    try:
        with open(ACCOUNTS_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_accounts(base, acc):
    allacc = load_saved_accounts()
    allacc[base] = acc
    try:
        with open(ACCOUNTS_FILE, 'w', encoding='utf-8') as f:
            json.dump(allacc, f, indent=2)
    except Exception as e:
        print('  (hindi na-save ang accounts file: %s)' % e)


# ----------------------------------------------------------------------------- XAMPP fresh database
def read_env():
    env = {}
    path = os.path.join(ROOT, '.env')
    if not os.path.exists(path):
        return None
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def find_exe(env_var, candidates, names):
    if os.environ.get(env_var):
        return os.environ[env_var]
    for c in candidates:
        if os.path.exists(c):
            return c
    for n in names:
        w = shutil.which(n)
        if w:
            return w
    return None


def xampp_reset(admin_user, assume_yes=False):
    """Drop and re-create the database from .env, import schema.sql + extension.sql, create the first Admin.
    Returns (username, password) of the new admin, or None."""
    env = read_env()
    if not env:
        print('Walang .env sa project folder. Hindi ma-reset ang database.')
        return None
    host, port, name = env.get('DB_HOST', '127.0.0.1'), env.get('DB_PORT', '3306'), env.get('DB_NAME', '')
    user, pw = env.get('DB_USER', 'root'), env.get('DB_PASS', '')
    if host not in ('127.0.0.1', 'localhost') or not name:
        print(f'Ang DB_HOST ({host}) ay hindi local. Ang reset ay para lang sa XAMPP sa computer na ito.')
        return None
    mysql = find_exe('MYSQL_EXE', [r'C:\xampp\mysql\bin\mysql.exe'], ['mysql', 'mariadb'])
    php = find_exe('PHP_EXE', [r'C:\xampp\php\php.exe'], ['php'])
    if not mysql or not php:
        print('Hindi makita ang mysql.exe o php.exe ng XAMPP (C:\\xampp\\mysql\\bin\\mysql.exe, C:\\xampp\\php\\php.exe).')
        return None
    print(f'\nBUBURAHIN ang LAHAT ng laman ng database "{name}" sa {host} at gagawa ng bagong empty database.')
    if not assume_yes and input('I-type ang RESET para ituloy: ').strip() != 'RESET':
        print('Hindi itinuloy ang reset.')
        return None
    base_cmd = [mysql, '--default-character-set=utf8mb4', '-h', host, '-P', str(port), '-u', user] + ([f'-p{pw}'] if pw else [])
    q = f"DROP DATABASE IF EXISTS `{name}`; CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    r = subprocess.run(base_cmd + ['-e', q], capture_output=True, text=True)
    if r.returncode:
        print('Hindi na-reset ang database:', r.stderr.strip())
        return None
    for f in ('schema.sql', 'extension.sql'):
        with open(os.path.join(ROOT, 'database', f), 'rb') as fh:
            r = subprocess.run(base_cmd + [name], stdin=fh, capture_output=True)
        if r.returncode:
            print(f'Error sa import ng {f}:', r.stderr.decode(errors='ignore').strip())
            return None
    r = subprocess.run([php, os.path.join(ROOT, 'scripts', 'create_user.php'), 'admin', admin_user, 'System Test Admin'],
                       capture_output=True, text=True, cwd=ROOT)
    m = re.search(r'Temporary password \(shown once\):\s*(\S+)', r.stdout)
    if not m:
        print('Hindi nagawa ang Admin:', (r.stdout + r.stderr).strip())
        return None
    print(f'Bagong empty database "{name}" at Admin "{admin_user}" ay nagawa na.')
    return admin_user, m.group(1)


# ----------------------------------------------------------------------------- accounts
U = {}   # role -> Api


def ensure_password_changed(api, interactive, new_pw=None):
    """First login rule: if the account must change its password, change it (test accounts) or ask the tester."""
    if not api.must_change:
        return True
    if not new_pw:
        if not interactive:
            new_pw = gen_password()
        else:
            print(f'  Ang account na {api.user} ay kailangang magpalit ng password (unang login).')
            new_pw = getpass.getpass('  Bagong password para dito (12+ letters at numbers, Enter = auto): ') or gen_password()
    api.act('Admin.change_password', {'current_password': api.pw, 'new_password': new_pw}, label='First login: change password')
    api.pw = new_pw
    ok, _ = api.login(record=False)
    return ok and not api.must_change


def setup_accounts(admin_user, admin_pw, given, interactive, reuse=True):
    REC.section('1. Login at mga account')
    a = Api(admin_user, admin_pw, 'admin')
    ok, err = a.login()
    if not ok:
        REC.fail('Admin login', err)
        return False
    if a.role != 'admin':
        REC.fail('Ang ibinigay na account ay hindi Admin', a.role)
        return False
    if not ensure_password_changed(a, interactive):
        REC.fail('Admin password change', 'hindi napalitan')
        return False
    REC.accounts.append({'role': 'admin', 'username': a.user, 'password': a.pw if a.pw != admin_pw else '(ibinigay ng tester)',
                         'source': 'tester'})
    U['admin'] = a
    # Limit bawat role: pansamantalang "walang limit" para makagawa ng test accounts (ibinabalik sa dulo).
    lim = a.page('users', quiet=True).get('limits')
    if lim:
        SNAP['limits'] = lim
        a.act('Admin.role_limits_save', {'limits': {r: '0' for r in ROLES}}, label='Role limits off during the test (restored at the end)')
    saved = load_saved_accounts().get(BASE, {}) if reuse else {}
    created = dict(saved)
    for role in ROLES:
        api = None
        if role in given:
            u, p = given[role]
            api = Api(u, p, role)
            ok, err = api.login()
            if ok and api.role == role and ensure_password_changed(api, interactive):
                REC.accounts.append({'role': role, 'username': u, 'password': '(ibinigay ng tester)' if api.pw == p else api.pw, 'source': 'tester'})
                U[role] = api
                continue
            REC.fail(f'Account na ibinigay para sa {role} ay hindi magamit', err or f'role ng account: {api.role}')
        if role in saved:
            api = Api(saved[role]['username'], saved[role]['password'], role)
            ok, _ = api.login(record=False)
            if ok and api.role == role and ensure_password_changed(api, False):
                REC.info(f'Ginamit ulit ang test account ng nakaraang run para sa {ROLE_LABEL[role]}', api.user)
                created[role] = {'username': api.user, 'password': api.pw}
                REC.accounts.append({'role': role, 'username': api.user, 'password': api.pw, 'source': 'test account (dati)'})
                U[role] = api
                continue
        uname = f't_{ROLE_SHORT[role]}_{RUN}'
        temp, final = gen_password(), gen_password()
        a.act('Admin.user_save', {'username': uname, 'full_name': f'Test {ROLE_LABEL[role]} {RUN}', 'role': role, 'password': temp,
                                  'shift': 'Day'}, label=f'Admin creates test account for {ROLE_LABEL[role]}')
        api = Api(uname, temp, role)
        ok, err = api.login()
        if not ok:
            continue
        REC.check(api.must_change, f'{uname}: new account must change password at first login')
        ensure_password_changed(api, False, final)
        created[role] = {'username': uname, 'password': api.pw}
        REC.accounts.append({'role': role, 'username': uname, 'password': api.pw, 'source': 'ginawa ng script'})
        U[role] = api
    save_accounts(BASE, {k: v for k, v in created.items() if k in ROLES})
    missing = [r for r in ROLES if r not in U]
    return REC.check(not missing, 'May account na gumagana para sa lahat ng 10 roles', ', '.join(missing))


# ----------------------------------------------------------------------------- test context
C = {'trip_client': {}}


def trip(tid):
    data = U['admin'].page('trip_records', client_id=C['trip_client'].get(tid, ''))
    return find(data.get('trips'), id=tid), data


def tstatus(tid):
    return trip(tid)[0].get('status')


def fund_of(tid):
    rows = find_all(U['admin'].page('funds').get('funds'), trip_id=tid)
    rows.sort(key=lambda r: int(r['id']))
    return rows[-1] if rows else {}


def fund(fid):
    return find(U['admin'].page('funds').get('funds'), id=fid)


def vehicle(vid):
    return find(U['admin'].page('fleet').get('vehicles'), id=vid)


def draft_of(tid):
    return find(U['billing'].page('billing').get('drafts'), trip_id=tid)


def incident_of(tid):
    rows = find_all(U['admin'].page('incidents').get('incidents'), trip_id=tid)
    rows.sort(key=lambda r: int(r['id']))
    return rows[-1] if rows else {}


def jobs_of(vid):
    return find_all(U['motorpool'].page('maintenance').get('jobs'), vehicle_id=vid)


def checklist_items():
    tpl = U['car_carrier_dispatcher'].page('trips').get('checklist') or []
    return {f"{s['key']}_{i + 1:02d}": {'condition': 'OK', 'remarks': ''} for s in tpl for i in range(len(s['items']))}


# ----------------------------------------------------------------------------- settings snapshot / restore
SNAP = {}


def snapshot_settings():
    a = U['admin']
    st = a.page('settings')
    SNAP['values'] = {v['key']: v for v in st.get('values', [])}
    SNAP['items'] = {s['scope']: s.get('items', []) for s in st.get('scopes', [])}
    SNAP['budget'] = U['finance'].page('purchasing').get('budget') or {}


def restore_settings():
    REC.section('15. Ibalik ang settings na binago ng test')
    a = U['admin']
    if SNAP.get('limits'):
        a.act('Admin.role_limits_save', {'limits': {r: str(v) for r, v in SNAP['limits'].items()}}, label='Restore the limits per role')
        now = a.page('users').get('limits') or {}
        REC.check(all(int(now.get(r, -1)) == int(v) for r, v in SNAP['limits'].items()), 'Limits per role are back to the original values')
    for key in ('inspection_min_minutes', 'fuel_price_per_liter'):
        v = SNAP.get('values', {}).get(key)
        if not v:
            continue
        if int(v.get('is_default') or 0):
            a.act('Admin.setting_reset', {'key': key}, label=f'Restore {key} to default')
        else:
            a.act('Admin.setting_save', {'key': key, 'value': str(v.get('value'))}, label=f'Restore {key} = {v.get("value")}')
    items = SNAP.get('items', {}).get('trip_allowance')
    if items is not None:
        U['finance'].act('Admin.items_save', {'scope': 'trip_allowance', 'items': items}, label='Restore trip fund categories')
        now = U['admin'].page('settings')
        cur = find(now.get('scopes'), scope='trip_allowance').get('items', [])
        REC.check([(i['name'], money(i['amount']), int(i['active'])) for i in cur] == [(i['name'], money(i['amount']), int(i['active'])) for i in items],
                  'Fund categories are back to the original values')
    b = SNAP.get('budget')
    if b:
        U['finance'].act('Finance.budget_set', {'category': 'Purchasing', 'budget_amount': b['budget_amount'],
                                               'period_start': b.get('period_start') or '', 'period_end': b.get('period_end') or ''},
                         label='Restore Purchasing budget amount')
        REC.notes.append('Purchasing budget: naibalik ang amount (PHP %s), pero ang "used" ay nag-reset sa 0 dahil bagong budget record ito.' % b['budget_amount'])
    elif 'budget_set_by_test' in C:
        REC.notes.append('Walang Purchasing budget bago ang test. Naiwan ang test budget (PHP %s); palitan sa Finance > Budget kung kailangan.' % C['budget_set_by_test'])


# ----------------------------------------------------------------------------- test sections
def t_security():
    REC.section('2. Security: login, session, CSRF')
    anon = Api('(walang login)', '')
    w = anon.whoami()
    REC.check(w.get('ok') and not w.get('signedIn') and w.get('csrf'), 'whoami answers and is not signed in')
    ok, err = anon.page_status('dashboard')
    REC.check(not ok, 'Page data is blocked without login', err)
    bad = Api(U['audit'].user, 'wrong-password-123')
    ok, err = bad.login(record=False)
    REC.check(not ok, 'Wrong password is refused', err)
    bad.user = f'nobody_{RUN}'  # ibang username para hindi ma-lock ang test account (ang lock ng account ay nasa 14c)
    for _ in range(4):
        bad.login(record=False)
    bad.user, bad.pw = U['audit'].user, U['audit'].pw
    ok, err = bad.login(record=False)
    REC.check(not ok and 'Too many' in (err or ''), 'After 5 wrong tries, even the right password waits 15 minutes (same browser session)', err)
    s = requests.Session()
    s.get(BASE, params={'api': 'whoami'}, timeout=TIMEOUT)
    r = s.post(BASE + '?api=login', json={'username': U['audit'].user, 'password': U['audit'].pw, 'csrf': 'bad'}, timeout=TIMEOUT)
    REC.check(not U['audit']._json(r).get('ok'), 'Login without the right CSRF token is refused')
    r = U['admin'].s.post(BASE + '?api=Admin.notifications_read', json={}, headers={'X-CSRF-Token': 'wrong'}, timeout=TIMEOUT)
    REC.check(not U['admin']._json(r).get('ok'), 'An action with a wrong CSRF token is refused')
    U['audit'].act('Trips.create', {'client_id': 1, 'scheduled_at': f'{D}T08:00', 'truck_type': 'Car Carrier'}, expect=False, label='Audit is read-only: cannot create a trip')
    U['audit'].act('Admin.user_save', {'username': 'x_' + RUN, 'full_name': 'x', 'role': 'audit', 'password': gen_password()}, expect=False,
                   label='Audit cannot create accounts')
    U['finance'].act('Admin.user_save', {'username': 'y_' + RUN, 'full_name': 'y', 'role': 'audit', 'password': gen_password()}, expect=False,
                     label='Only Admin creates accounts')


def t_master():
    REC.section('3. Master data: clients, routes, rates, crew, trucks')
    a, bil, ops, pay = U['admin'], U['billing'], U['operations_head'], U['payroll']
    snapshot_settings()
    a.act('Admin.setting_save', {'key': 'inspection_min_minutes', 'value': '0'}, label='Checklist minimum minutes = 0 for the test (restored at the end)')
    c1, c2 = f'{TAG} MMPC', f'{TAG} COCA COLA'
    bil.act('Billing.client_save', {'name': c1, 'company_name': 'RVL MOVERS (test)', 'payment_terms_days': 30}, label='Billing adds client (30 day terms)')
    bil.act('Billing.client_save', {'name': c2, 'company_name': 'CJ SMART FREIGHT (test)', 'payment_terms_days': 15}, label='Billing adds client (15 day terms)')
    U['audit'].act('Billing.client_save', {'name': f'{TAG} X'}, expect=False, label='Audit cannot add a client')
    ops.act('Billing.route_save', {'origin': 'BATANGAS PORT', 'destination': f'{TAG} NYK CABUYAO', 'distance_km': 143, 'toll_fee': 651}, label='Ops Head adds route')
    ops.act('Billing.route_save', {'origin': '106 STA ROSA', 'destination': f'{TAG} TARLAC', 'distance_km': 700, 'toll_fee': 1200}, label='Ops Head adds route')
    cp = bil.page('clients')
    C['cl1'], C['cl2'] = find(cp.get('clients'), name=c1).get('id'), find(cp.get('clients'), name=c2).get('id')
    C['rt1'], C['rt2'] = find(cp.get('routes'), destination=f'{TAG} NYK CABUYAO').get('id'), find(cp.get('routes'), destination=f'{TAG} TARLAC').get('id')
    REC.check(all([C['cl1'], C['cl2'], C['rt1'], C['rt2']]), 'Clients and routes are saved', C)
    bil.act('Billing.rate_save', {'client_id': C['cl1'], 'route_id': C['rt1'], 'truck_type': 'Car Carrier', 'rate_basis': 'Per Trip', 'amount': 15000, 'status': 'Active'},
            label='Client rate: car carrier PHP 15,000 per trip')
    bil.act('Billing.rate_save', {'client_id': C['cl2'], 'route_id': C['rt2'], 'truck_type': 'Container', 'rate_basis': 'Per Trip', 'amount': 38000, 'status': 'Active'},
            label='Client rate: container PHP 38,000 per trip')
    group = TAG
    C['group'] = group
    crew = [('d1', f'{TAG} JUEGOS, HECTOR', 'Driver', (TODAY + dt.timedelta(days=700)).isoformat()),
            ('d2', f'{TAG} MAYORDO, ARNOLD', 'Driver', (TODAY + dt.timedelta(days=700)).isoformat()),
            ('d3', f'{TAG} RUBIA, RICKY', 'Driver', (TODAY + dt.timedelta(days=700)).isoformat()),
            ('dx', f'{TAG} EXPIRED, DRIVER', 'Driver', '2020-01-01'),
            ('h1', f'{TAG} SABA, MAURICIO', 'Helper', None), ('h2', f'{TAG} ALEGADO, ANDRO', 'Helper', None)]
    for key, name, typ, lic in crew:
        a.act('Fleet.person_save', {'full_name': name, 'person_type': typ, 'license_expiry': lic or '', 'license_number': f'L-{RUN}-{key}' if lic else '',
                                    'pay_frequency': 'Weekly', 'daily_rate': 600, 'payroll_group': group}, label=f'Admin adds {typ.lower()}')
    a.act('Fleet.person_save', {'full_name': f'{TAG} NO LICENSE', 'person_type': 'Driver', 'pay_frequency': 'Weekly'}, expect=False, label='Driver without license expiry is refused')
    a.act('Fleet.person_save', {'full_name': f'{TAG} OFFICE STAFF', 'person_type': 'Admin Staff', 'pay_frequency': 'Weekly'}, expect=False,
          label='PDF v6: only drivers and helpers (other staff types refused)')
    people = a.page('crew').get('people')
    C['p'] = {k: find(people, full_name=n).get('id') for k, n, _, _ in crew}
    REC.check(all(C['p'].values()), 'Drivers and helpers are saved', C['p'])
    mpage = U['motorpool'].page('maintenance')
    pm = money(mpage.get('pmInterval')) or 10000
    C['pm'] = pm
    trucks = [('cc1', 'Car Carrier', pm - 100, (TODAY + dt.timedelta(days=10)).isoformat()), ('cc2', 'Car Carrier', 0, None),
              ('ct1', 'Container', 0, None), ('wv1', 'Wing Van', 0, None)]
    C['plates'] = {}
    for key, typ, kms, reg in trucks:
        plate = f'T{RUN[-6:]}{key.upper()}'
        C['plates'][key] = plate
        a.act('Fleet.vehicle_save', {'plate_number': plate, 'truck_type': typ, 'odometer_km': 50000, 'km_since_pm': kms,
                                     'registration_expiry': reg or (TODAY + dt.timedelta(days=365)).isoformat(),
                                     'insurance_expiry': (TODAY + dt.timedelta(days=300)).isoformat()}, label=f'Admin adds {typ} truck')
    a.act('Fleet.vehicle_save', {'plate_number': C['plates']['cc1'], 'truck_type': 'Car Carrier'}, expect=False, label='Duplicate plate number is refused')
    vs = a.page('fleet').get('vehicles')
    C['v'] = {k: find(vs, plate_number=p).get('id') for k, p in C['plates'].items()}
    REC.check(all(C['v'].values()), 'Trucks are saved', C['v'])
    pay.act('Payroll.rate_save', {'route_id': C['rt1'], 'truck_type': 'Car Carrier', 'driver_rate': 800, 'helper_rate': 500}, label='Payroll: trip pay rate driver 800 / helper 500')
    U['billing'].act('Payroll.rate_save', {'route_id': C['rt2'], 'truck_type': 'Container', 'driver_rate': 1, 'helper_rate': 1}, expect=False, label='Billing cannot set trip pay rates')


def t_scenario_a():
    REC.section('4. Scenario A: Ops Head car carrier trip, fund, checklist, dispatch, minor incident (C.1), complete')
    ops, ccd, cwd, fin, a, mp, bil = (U[r] for r in ('operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher', 'finance', 'admin', 'motorpool', 'billing'))
    r = ops.act('Trips.create', {'client_id': C['cl1'], 'route_id': C['rt1'], 'scheduled_at': f'{D}T08:00', 'truck_type': 'Car Carrier'},
                label='Ops Head creates a car carrier trip from the client')
    t1 = r.get('trip_id')
    C['t1'] = t1
    C['trip_client'][t1] = C['cl1']
    st = tstatus(t1)
    REC.check(st in ('Pre-Assigned', 'Awaiting Resources'), 'Scenario A: no review needed (auto-assign)', st)
    ops.act('Trips.reassign', {'trip_id': t1, 'vehicle_id': C['v']['cc1'], 'driver_id': C['p']['dx'], 'reason': 'test'}, expect=False,
            label='Driver with expired license cannot be assigned')
    ccd.act('Trips.reassign', {'trip_id': t1, 'vehicle_id': C['v']['cc1'], 'driver_id': C['p']['d1'], 'reason': 'test'}, expect=False,
            label='Only Ops Head changes the assignment')
    ops.act('Trips.reassign', {'trip_id': t1, 'vehicle_id': C['v']['cc1'], 'driver_id': C['p']['d1'], 'reason': 'System test: use test truck and crew'},
            label='Ops Head assigns the test truck and driver')
    t = trip(t1)[0]
    REC.check(t.get('status') == 'Pre-Assigned' and str(t.get('vehicle_id')) == str(C['v']['cc1']) and str(t.get('driver_id')) == str(C['p']['d1']),
              'Trip is Pre-Assigned to the test truck and driver', t.get('status'))
    cats = ccd.page('trips').get('fundCategories') or []
    C['cats'] = cats
    REC.check(len(cats) > 0, 'Trip fund categories are available', ', '.join(f"{c['name']} {c['amount']}" for c in cats))
    pick = [c['name'] for c in cats[:3]]
    expect_amt = sum(money(c['amount']) for c in cats[:3]) + 50
    cwd.act('Funds.request', {'trip_id': t1, 'categories': pick[:1]}, expect=False, label='Other dispatcher team cannot request the fund')
    ops.act('Funds.request', {'trip_id': t1, 'categories': pick[:1]}, expect=False, label='Only the dispatcher submits the fund request')
    ccd.act('Funds.request', {'trip_id': t1, 'categories': []}, expect=False, label='Fund request needs at least one category')
    ccd.act('Funds.request', {'trip_id': t1, 'categories': ['NOT-A-CATEGORY']}, expect=False, label='Unknown category is refused')
    ccd.act('Funds.request', {'trip_id': t1, 'categories': pick, 'extra': [{'name': 'Parking', 'amount': 50}]}, label='Dispatcher requests the trip fund')
    f = fund_of(t1)
    C['f1'], C['f1_amount'] = f.get('id'), expect_amt
    REC.check(same(f.get('amount'), expect_amt) and f.get('approver_role') == 'operations_head' and f.get('status') == 'Pending Approval',
              f'Fund = categories + extra = {expect_amt:,.2f}, for Ops Head approval', f"{f.get('amount')} / {f.get('approver_role')} / {f.get('status')}")
    f1 = C['f1']
    ccd.act('Funds.request', {'trip_id': t1, 'categories': pick[:1]}, expect=False, label='Second fund request for the same trip is refused')
    fin.act('Funds.approve', {'fund_id': f1}, expect=False, label='Finance cannot approve trip funds')
    a.act('Funds.approve', {'fund_id': f1}, expect=False, label='Admin does not approve trip funds')
    fin.act('Funds.release', {'fund_id': f1, 'payment_method': 'Cash', 'released_on': D}, expect=False, label='Cannot release before approval')
    ops.act('Funds.approve', {'fund_id': f1}, label='Ops Head approves the fund')
    REC.check(fund(f1).get('status') == 'Ready for Release', 'Approved fund is Ready for Release')
    fin.act('Funds.release', {'fund_id': f1, 'payment_method': 'Cheque', 'released_on': D}, expect=False, label='Cheque release needs a cheque number')
    fin.act('Funds.release', {'fund_id': f1, 'payment_method': 'Cash', 'released_on': D, 'reference_number': f'CV-{RUN}'}, label='Finance releases the fund (cash)')
    REC.check(fund(f1).get('status') == 'Released', 'Fund is Released (before checklist is allowed)')
    ccd.act('Trips.dispatch', {'trip_id': t1}, expect=False, label='Cannot dispatch before the checklist')
    cwd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Departure'}, expect=False, label='Other dispatcher team cannot do the checklist')
    ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Departure'}, label='Dispatcher starts the departure checklist')
    items = checklist_items()
    C['items'] = items
    REC.check(len(items) == 57, 'Checklist has 57 items (PDF)', len(items))
    bad = dict(items)
    first = list(items)[17] if len(items) > 17 else list(items)[0]
    bad[first] = {'condition': 'NOT OK', 'remarks': 'flat tire'}
    ccd.act('Trips.checklist_departure', {'trip_id': t1, 'items': bad, 'meta': {}, 'odometer_km': 50000}, label='Checklist with one NOT OK item')
    REC.check(tstatus(t1) == 'Pre-Assigned', 'NOT OK item keeps the trip Pre-Assigned')
    ccd.act('Trips.checklist_departure', {'trip_id': t1, 'items': items, 'meta': {}, 'odometer_km': 50000}, expect=False, label='Must start the checklist again')
    ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Departure'}, label='Start the checklist again')
    ccd.act('Trips.checklist_departure', {'trip_id': t1, 'items': items, 'meta': {'driver_1': 'test'}, 'odometer_km': 50000, 'fuel_level': 'Full'},
            label='All items OK')
    REC.check(tstatus(t1) == 'Ready for Dispatch', 'Trip is Ready for Dispatch')
    ccd.act('Trips.dispatch', {'trip_id': t1}, label='Confirm Dispatch')
    REC.check(tstatus(t1) == 'Dispatched', 'Trip is Dispatched')
    REC.check(fund(f1).get('status') == 'Completed', 'Fund becomes Completed at dispatch')
    REC.check(vehicle(C['v']['cc1']).get('status') == 'On Trip', 'Truck is On Trip')
    dr = draft_of(t1)
    C['d1'] = dr.get('id')
    REC.check(dr.get('status') == 'Draft' and dr.get('rate_basis') == 'Per Trip' and same(dr.get('rate'), 15000) and same(dr.get('amount'), 15000),
              'PDF v7: billing draft is created at dispatch from the client rate (15,000 per trip)', f"{dr.get('status')} {dr.get('rate')}")
    bil.act('Billing.draft_finalize', {'draft_id': C['d1']}, expect=False, label='Cannot finalize while the trip is ongoing')
    bil.act('Billing.draft_verify', {'draft_id': C['d1']}, expect=False, label='Cannot verify documents without a waybill')
    ccd.act('Trips.progress', {'trip_id': t1, 'update_type': 'Delay', 'delay_cause': 'Client', 'note': 'Waiting for units'}, label='Dispatcher posts a delay update')
    # Scenario C.1 minor damage
    ccd.act('Trips.incident', {'trip_id': t1, 'location': '', 'details': 'x', 'problem': 'y'}, expect=False, label='Incident needs a location')
    ccd.act('Trips.incident', {'trip_id': t1, 'incident_at': f'{D}T10:15', 'location': 'SLEX', 'details': 'Driver called: tire burst', 'problem': 'Flat tire'},
            label='Dispatcher reports an incident')
    REC.check(tstatus(t1) == 'On Hold - Incident Reported', 'Trip is On Hold - Incident Reported')
    inc = incident_of(t1)
    REC.check(inc.get('severity') in (None, '') and inc.get('status') == 'Reported', 'Severity is not set by the dispatcher (Maintenance assesses)')
    job = find(jobs_of(C['v']['cc1']), incident_id=inc.get('id'))
    job1 = job.get('id')
    ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Arrival'}, expect=False, label='Arrival checklist blocked while On Hold')
    ccd.act('Trips.resume', {'trip_id': t1}, expect=False, label='Cannot resume before the repair')
    mp.act('Maintenance.job_complete', {'job_id': job1}, expect=False, label='Motorpool must assess first')
    ccd.act('Maintenance.assess', {'job_id': job1, 'severity': 'Minor'}, expect=False, label='Dispatcher cannot assess')
    mp.act('Maintenance.assess', {'job_id': job1, 'severity': 'Minor', 'assigned_to': 'Mechanic Jun', 'notes': 'replace tire on site'}, label='Motorpool: Minor')
    inc = incident_of(t1)
    REC.check(inc.get('status') == 'Under Repair' and inc.get('severity') == 'Minor', 'Minor: incident Under Repair')
    j = find(jobs_of(C['v']['cc1']), id=job1)
    REC.check(j.get('maintenance_type') == 'Roadside Repair' and j.get('status') == 'In Progress', 'Minor: roadside repair job In Progress')
    mp.act('Maintenance.job_complete', {'job_id': job1, 'notes': 'tire replaced'}, label='Motorpool completes the roadside repair')
    REC.check(incident_of(t1).get('status') == 'Repaired - Cleared to Continue', 'Incident: Repaired - Cleared to Continue')
    REC.check(vehicle(C['v']['cc1']).get('status') == 'On Trip', 'Minor: truck stays On Trip')
    ccd.act('Trips.resume', {'trip_id': t1}, label='Dispatcher resumes the trip')
    t = trip(t1)[0]
    REC.check(t.get('status') == 'In Transit' and str(t.get('attempt_number')) == '1', 'Resume = In Transit, still the first attempt')
    ccd.act('Trips.waybill_add', {'trip_id': t1, 'waybill_number': f'W{RUN}1', 'units': 5}, label='Dispatcher records the waybill')
    ccd.act('Trips.checklist_start', {'trip_id': t1, 'inspection_type': 'Arrival'}, label='Start the arrival checklist')
    ccd.act('Trips.arrival', {'trip_id': t1, 'items': items, 'meta': {}, 'odometer_km': 49000, 'delivery_notes': 'ok'}, expect=False, label='Odometer lower than departure is refused')
    ccd.act('Trips.arrival', {'trip_id': t1, 'items': items, 'meta': {}, 'odometer_km': 50150, 'delivery_notes': 'Delivered 5 units', 'units_delivered': 5},
            label='Arrival checklist (150 km)')
    ccd.act('Trips.complete', {'trip_id': t1}, label='Complete the trip')
    REC.check(tstatus(t1) == 'Completed', 'Trip is Completed')
    v = vehicle(C['v']['cc1'])
    sched = find_all(U['motorpool'].page('maintenance').get('schedules'), vehicle_id=C['v']['cc1'])
    pmjobs = [x for x in jobs_of(C['v']['cc1']) if x.get('maintenance_type') == 'Preventive Maintenance']
    REC.check(bool(sched or pmjobs), f'Truck passed the PM interval ({C["pm"]:,.0f} km): preventive maintenance is scheduled',
              f"truck status {v.get('status')}, km since PM {v.get('km_since_pm')}")


def t_scenario_b():
    REC.section('5. Scenario B: container dispatcher, Ops review, fund rejected and revised, major damage (C.2), Second Attempt')
    ops, ccd, cwd, fin, mp = (U[r] for r in ('operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher', 'finance', 'motorpool'))
    items = C['items']
    r = cwd.act('Trips.create', {'client_id': C['cl2'], 'route_id': C['rt2'], 'scheduled_at': f'{D}T10:00', 'truck_type': 'Container',
                                 'container_number': 'EGSU2195124', 'container_size': '1X20'}, label='Container dispatcher creates a delivery request')
    t2 = r.get('trip_id')
    C['t2'] = t2
    C['trip_client'][t2] = C['cl2']
    REC.check(tstatus(t2) == 'Pending Review', 'Scenario B: Pending Review by the Ops Head')
    cwd.act('Trips.review', {'trip_id': t2, 'decision': 'approve', 'truck_type': 'Container'}, expect=False, label='Only Ops Head reviews')
    ops.act('Trips.review', {'trip_id': t2, 'decision': 'approve', 'truck_type': 'Container'}, label='Ops Head confirms the request')
    REC.check(tstatus(t2) in ('Pre-Assigned', 'Awaiting Resources'), 'Confirmed request is assigned')
    ops.act('Trips.reassign', {'trip_id': t2, 'vehicle_id': C['v']['ct1'], 'driver_id': C['p']['d2'], 'reason': 'test'}, expect=False,
            label='Container trip needs a helper')
    ops.act('Trips.reassign', {'trip_id': t2, 'vehicle_id': C['v']['ct1'], 'driver_id': C['p']['d2'], 'helper_id': C['p']['h1'], 'reason': 'System test'},
            label='Ops Head assigns the test container truck, driver and helper')
    REC.check(tstatus(t2) == 'Pre-Assigned', 'Trip is Pre-Assigned')
    cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Departure'}, expect=False, label='Container needs booking and pre-advice first')
    cwd.act('Trips.details', {'trip_id': t2, 'client_confirmed': 1, 'pre_advice_sent': 1, 'booking_reference': f'NOM-{RUN}'}, label='Booking and pre-advice recorded')
    cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Departure'}, label='Departure checklist start')
    cwd.act('Trips.checklist_departure', {'trip_id': t2, 'items': items, 'meta': {}, 'odometer_km': 50000}, label='Checklist OK before the fund')
    REC.check(tstatus(t2) == 'Ready for Dispatch', 'Ready for Dispatch (checklist first, fund later is allowed)')
    cwd.act('Trips.dispatch', {'trip_id': t2}, expect=False, label='Cannot dispatch without a released fund')
    cats = C['cats']
    pick = [c['name'] for c in cats[1:5]] or [cats[0]['name']]
    amt = sum(money(c['amount']) for c in cats if c['name'] in pick)
    cwd.act('Funds.request', {'trip_id': t2, 'categories': pick}, label='Dispatcher requests the fund')
    f = fund_of(t2)
    f2 = f.get('id')
    C['f2'] = f2
    REC.check(same(f.get('amount'), amt), f'Fund amount = {amt:,.2f}', f.get('amount'))
    ops.act('Funds.reject', {'fund_id': f2, 'reason': 'add forklift'}, label='Ops Head rejects the fund')
    REC.check(fund(f2).get('status') == 'Rejected', 'Rejected fund goes back to the dispatcher')
    cwd.act('Funds.request', {'trip_id': t2, 'categories': pick}, expect=False, label='Use Revise for a rejected fund')
    ccd.act('Funds.revise', {'fund_id': f2, 'categories': pick}, expect=False, label='Other dispatcher team cannot revise')
    all_names = [c['name'] for c in cats]
    amt2 = sum(money(c['amount']) for c in cats) + 20000
    cwd.act('Funds.revise', {'fund_id': f2, 'categories': all_names, 'extra': [{'name': 'Special handling', 'amount': 20000}]}, label='Dispatcher revises the fund')
    f = fund(f2)
    REC.check(f.get('status') == 'Pending Approval' and same(f.get('amount'), amt2) and f.get('approver_role') == 'operations_head',
              f'Revised fund {amt2:,.2f} still goes to the Ops Head (no 15k limit)', f"{f.get('status')} {f.get('amount')} {f.get('approver_role')}")
    ops.act('Funds.approve', {'fund_id': f2}, label='Ops Head approves')
    cwd.act('Trips.dispatch', {'trip_id': t2}, expect=False, label='Ready for Release is not enough to dispatch')
    fin.act('Funds.release', {'fund_id': f2, 'payment_method': 'Bank Transfer', 'released_on': D, 'reference_number': f'BT-{RUN}'}, label='Finance releases (bank transfer)')
    cwd.act('Trips.dispatch', {'trip_id': t2}, label='Confirm Dispatch')
    REC.check(tstatus(t2) == 'Dispatched', 'Trip is Dispatched')
    # Scenario C.2 major damage
    cwd.act('Trips.incident', {'trip_id': t2, 'location': 'NLEX', 'details': 'Engine overheat', 'problem': 'Engine'}, label='Dispatcher reports engine trouble')
    vid = C['v']['ct1']
    open_jobs = [j for j in jobs_of(vid) if j.get('status') != 'Completed']
    job2 = open_jobs[0]['id'] if open_jobs else None
    mp.act('Maintenance.assess', {'job_id': job2, 'severity': 'Major', 'notes': 'tow back to yard'}, label='Motorpool: Major')
    REC.check(tstatus(t2) == 'For Reschedule', 'Major: trip For Reschedule')
    REC.check(vehicle(vid).get('status') == 'Under Maintenance', 'Major: truck Under Maintenance')
    mp.act('Maintenance.assess', {'job_id': job2, 'severity': 'Minor'}, expect=False, label='Already assessed')
    cwd.act('Trips.reschedule', {'trip_id': t2, 'scheduled_at': f'{TOM}T06:00'}, expect=False, label='Cannot reschedule while the truck is not repaired')
    mp.act('Fleet.vehicle_status', {'vehicle_id': vid, 'status': 'Available'}, expect=False, label='Open job blocks Available')
    mp.act('Maintenance.cost_add', {'job_id': job2, 'cost_type': 'Labor', 'description': 'mechanic', 'amount': 2500, 'incurred_on': D}, label='Motorpool adds labor cost 2,500')
    mp.act('Maintenance.job_complete', {'job_id': job2}, label='Repair completed')
    REC.check(vehicle(vid).get('status') == 'Available', 'Repaired truck is Available')
    cwd.act('Trips.reschedule', {'trip_id': t2, 'scheduled_at': f'{TOM}T06:00'}, label='Dispatcher reschedules for tomorrow')
    t = trip(t2)[0]
    REC.check(t.get('status') == 'Pre-Assigned' and str(t.get('attempt_number')) == '2', 'Rescheduled: Pre-Assigned, attempt #2', f"{t.get('status')} #{t.get('attempt_number')}")
    r = ops.act('Trips.create', {'client_id': C['cl1'], 'route_id': C['rt1'], 'scheduled_at': f'{TOM}T07:00', 'truck_type': 'Car Carrier'},
                label='Another trip on the same day (double booking test)')
    tx = r.get('trip_id')
    C['trip_client'][tx] = C['cl1']
    ops.act('Trips.reassign', {'trip_id': tx, 'vehicle_id': C['v']['cc2'], 'driver_id': C['p']['d2'], 'reason': 'test'}, expect=False,
            label='Driver already on another trip that day is refused (double booking)')
    ops.act('Trips.cancel', {'trip_id': tx, 'reason': 'system test cleanup'}, label='Cancel the extra trip')
    cwd.act('Trips.dispatch', {'trip_id': t2}, expect=False, label='Checklist again before redispatch')
    cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Departure'}, label='Checklist (second attempt)')
    cwd.act('Trips.checklist_departure', {'trip_id': t2, 'items': items, 'meta': {}, 'odometer_km': 50020}, label='Checklist OK')
    cwd.act('Trips.dispatch', {'trip_id': t2}, label='Confirm Redispatch (fund optional)')
    t, data = trip(t2)
    REC.check(t.get('status') == 'Dispatched', 'Redispatched')
    REC.check(len(find_all(data.get('events'), trip_id=t2, event_type='redispatch confirmed (Second Attempt)')) == 1, 'Second Attempt recorded on the same trip')
    REC.check(len(find_all(data.get('inspections'), trip_id=t2, inspection_type='Departure')) == 2, 'Both departure checklists are kept')
    cwd.act('Trips.checklist_start', {'trip_id': t2, 'inspection_type': 'Arrival'}, label='Arrival checklist start')
    cwd.act('Trips.arrival', {'trip_id': t2, 'items': items, 'meta': {}, 'odometer_km': 50720, 'delivery_notes': 'ok'}, label='Arrival checklist')
    cwd.act('Trips.waybill_add', {'trip_id': t2, 'waybill_number': f'W{RUN}2'}, label='Waybill')
    cwd.act('Trips.complete', {'trip_id': t2}, label='Complete')
    REC.check(tstatus(t2) == 'Completed', 'Container trip Completed')
    rows = [d for d in U['billing'].page('billing').get('drafts', []) if str(d.get('trip_id')) == str(t2)]
    REC.check(len(rows) == 1, 'Only one billing draft for the trip even with a Second Attempt')


def t_wingvan():
    REC.section('6. Wing van trip and cancellation')
    ops = U['operations_head']
    r = ops.act('Trips.create', {'client_id': C['cl1'], 'origin': 'A', 'destination': f'{TAG} B', 'distance_km': 40, 'scheduled_at': f'{D}T09:00',
                                 'truck_type': 'Wing Van'}, label='Ops Head creates a wing van trip (free text route)')
    t3 = r.get('trip_id')
    C['trip_client'][t3] = C['cl1']
    REC.info('Wing van trip status after auto-assign', tstatus(t3))
    U['container_wingvan_dispatcher'].act('Trips.cancel', {'trip_id': t3, 'reason': 'x'}, expect=False, label='Only Ops Head cancels')
    ops.act('Trips.cancel', {'trip_id': t3, 'reason': 'client cancelled'}, label='Ops Head cancels the trip')
    REC.check(tstatus(t3) == 'Cancelled', 'Trip Cancelled')
    ops.act('Trips.cancel', {'trip_id': C['t1'], 'reason': 'x'}, expect=False, label='A completed trip cannot be cancelled')


def t_maintenance():
    REC.section('7. Maintenance: jobs, schedules, truck status')
    mp, a = U['motorpool'], U['admin']
    vid = C['v']['cc2']
    mp.act('Maintenance.schedule_add', {'vehicle_id': vid, 'maintenance_type': 'Change oil', 'due_on': (TODAY + dt.timedelta(days=7)).isoformat(), 'notes': TAG},
           label='Motorpool schedules maintenance')
    sid = find(mp.page('maintenance').get('schedules'), vehicle_id=vid, maintenance_type='Change oil', status='Scheduled').get('id')
    mp.act('Maintenance.schedule_cancel', {'schedule_id': sid, 'reason': 'test'}, label='Cancel the schedule')
    mp.act('Maintenance.schedule_add', {'vehicle_id': vid, 'maintenance_type': 'Brake check', 'due_on': D}, label='Schedule another one')
    sid = find(mp.page('maintenance').get('schedules'), vehicle_id=vid, maintenance_type='Brake check', status='Scheduled').get('id')
    mp.act('Maintenance.schedule_start', {'schedule_id': sid}, label='Start the schedule (creates a job)')
    js = [j for j in jobs_of(vid) if j.get('status') != 'Completed']
    REC.check(bool(js), 'Starting a schedule opens a maintenance job')
    if js:
        mp.act('Maintenance.job_update', {'job_id': js[0]['id'], 'status': 'Waiting for Parts', 'assigned_to': 'Mechanic Jun'}, label='Job: Waiting for Parts')
        mp.act('Maintenance.job_complete', {'job_id': js[0]['id'], 'notes': 'done'}, label='Job completed')
    mp.act('Maintenance.job_add', {'vehicle_id': vid, 'maintenance_type': 'Repair', 'description': f'{TAG} aircon repair'}, label='Motorpool adds a repair job')
    js = [j for j in jobs_of(vid) if j.get('status') != 'Completed']
    REC.check(vehicle(vid).get('status') == 'Under Maintenance', 'Truck with an open repair job is Under Maintenance', vehicle(vid).get('status'))
    if js:
        mp.act('Maintenance.job_complete', {'job_id': js[0]['id']}, label='Repair completed')
    REC.check(vehicle(vid).get('status') == 'Available', 'Truck is Available again')
    mp.act('Fleet.vehicle_status', {'vehicle_id': vid, 'status': 'Unavailable', 'reason': 'x'}, expect=False, label='Motorpool cannot set Unavailable (Admin only)')
    a.act('Fleet.vehicle_status', {'vehicle_id': vid, 'status': 'Unavailable', 'reason': 'registration renewal'}, label='Admin sets the truck Unavailable')
    a.act('Fleet.vehicle_status', {'vehicle_id': vid, 'status': 'Available', 'reason': 'back'}, label='Admin sets it Available')
    U['operations_head'].act('Fleet.person_availability', {'id': C['p']['h2'], 'availability': 'Unavailable'}, label='Ops Head marks a helper Unavailable')
    U['operations_head'].act('Fleet.person_availability', {'id': C['p']['h2'], 'availability': 'Available'}, label='Back to Available')
    U['motorpool'].act('Fleet.person_availability', {'id': C['p']['h2'], 'availability': 'Unavailable'}, expect=False, label='Motorpool cannot change crew availability')


def t_purchasing():
    REC.section('8. Purchasing and inventory')
    pur, mp, fin, a = U['purchasing'], U['motorpool'], U['finance'], U['admin']
    pur.act('Purchasing.supplier_save', {'name': f'{TAG} Petron Parts'}, label='Purchasing adds a supplier')
    pp = pur.page('purchasing')
    thr = money(pp.get('threshold')) or 10000
    unit = round(thr * 0.6, 2)
    pn = f'T{RUN}-TIRE'
    pur.act('Purchasing.part_save', {'part_number': pn, 'description': f'{TAG} Truck tire', 'unit': 'pc', 'unit_cost': unit, 'reorder_level': 2}, label='Purchasing adds a part')
    inv = pur.page('inventory')
    pid = find(inv.get('parts'), part_number=pn).get('id')
    sup = find(pur.page('purchasing').get('suppliers'), name=f'{TAG} Petron Parts').get('id')
    C['part'] = pid
    mp.act('Purchasing.adjust', {'part_id': pid, 'quantity': 3, 'reason': 'x'}, expect=False, label='Motorpool cannot adjust stock')
    pur.act('Purchasing.adjust', {'part_id': pid, 'quantity': 3, 'reason': 'Opening balance (verified count)'}, label='Opening stock 3')
    mp.act('Maintenance.part_request', {'vehicle_id': C['v']['cc1'], 'part_id': pid, 'quantity': 2}, label='Motorpool requests 2 parts')
    rq = [r for r in find_all(pur.page('inventory').get('requests'), part_id=pid)]
    pur.act('Purchasing.issue', {'request_id': rq[-1]['id'] if rq else 0}, label='Purchasing issues the parts')
    REC.check(money(find(pur.page('inventory').get('parts'), id=pid).get('quantity_on_hand')) == 1, 'Stock out: 3 - 2 = 1')
    mp.act('Maintenance.part_request', {'vehicle_id': C['v']['cc1'], 'part_id': pid, 'quantity': 50}, label='Motorpool requests 50 (more than stock)')
    rq = find_all(pur.page('inventory').get('requests'), part_id=pid)
    big = [r for r in rq if str(r.get('requested_qty')) == '50']
    pur.act('Purchasing.issue', {'request_id': big[-1]['id'] if big else 0}, expect=False, label='Cannot issue more than the stock')
    pur.act('Purchasing.not_available', {'request_id': big[-1]['id'] if big else 0}, label='Purchasing marks it Not Available')
    b = pp.get('budget') or {}
    if not b:
        pur.act('Purchasing.pr_create', {'part_id': pid, 'quantity': 1, 'unit_cost': unit, 'supplier_id': sup}, label='Purchase request (no budget yet)')
        pr0 = sorted(find_all(pur.page('purchasing').get('requests'), part_id=pid), key=lambda r: int(r['id']))[-1]
        fin.act('Purchasing.decide', {'purchase_id': pr0['id'], 'decision': 'approve'}, expect=False, label='Cannot approve without a Purchasing budget')
        fin.act('Purchasing.decide', {'purchase_id': pr0['id'], 'decision': 'reject', 'notes': 'test'}, expect=None, label='(info) reject the test request')
    budget = thr
    fin.act('Finance.budget_set', {'category': 'Purchasing', 'budget_amount': budget}, label=f'Finance sets the Purchasing budget to {budget:,.2f} (restored at the end)')
    C['budget_set_by_test'] = budget
    pur.act('Purchasing.pr_create', {'part_id': pid, 'quantity': 2, 'unit_cost': unit, 'supplier_id': sup}, label=f'Purchase request {2 * unit:,.2f} (above the {thr:,.0f} limit)')
    pr1 = sorted(find_all(pur.page('purchasing').get('requests'), part_id=pid), key=lambda r: int(r['id']))[-1]
    REC.check(pr1.get('approver_role') == 'admin', 'Above the limit: Admin approves')
    fin.act('Purchasing.decide', {'purchase_id': pr1['id'], 'decision': 'approve'}, expect=False, label='Finance cannot approve above the limit')
    a.act('Purchasing.decide', {'purchase_id': pr1['id'], 'decision': 'approve'}, label='Admin approves')
    pr1 = find(pur.page('purchasing').get('requests'), id=pr1['id'])
    REC.check(pr1.get('status') == 'Rejected - Insufficient Budget', 'System rejects: Insufficient Budget', pr1.get('status'))
    pur.act('Purchasing.pr_create', {'part_id': pid, 'quantity': 1, 'unit_cost': unit, 'supplier_id': sup}, label=f'Purchase request {unit:,.2f} (within the limit)')
    pr2 = sorted(find_all(pur.page('purchasing').get('requests'), part_id=pid), key=lambda r: int(r['id']))[-1]
    REC.check(pr2.get('approver_role') == 'finance', 'Within the limit: Finance approves')
    a.act('Purchasing.decide', {'purchase_id': pr2['id'], 'decision': 'approve'}, expect=False, label='Admin does not approve within the limit')
    fin.act('Purchasing.decide', {'purchase_id': pr2['id'], 'decision': 'approve'}, label='Finance approves')
    pur.act('Purchasing.po_create', {'purchase_id': pr2['id'], 'ordered_on': D}, label='Purchasing creates the PO')
    po = find(pur.page('purchasing').get('orders'), purchase_request_id=pr2['id'])
    pur.act('Purchasing.receive', {'order_id': po.get('id'), 'quantity': 1, 'received_on': D, 'receipt_reference': f'DR-{RUN}'}, label='Purchasing receives the item')
    REC.check(money(find(pur.page('inventory').get('parts'), id=pid).get('quantity_on_hand')) == 2, 'Stock in: 1 + 1 = 2')
    pay = [p for p in fin.page('finance').get('payables', []) if p.get('source') == 'Purchase Order' and same(p.get('amount'), unit)
           and str(p.get('source_id')) in (str(po.get('id')), str(pr2['id']))]
    REC.check(bool(pay), 'Receiving creates a payable for Finance')
    if pay:
        fin.act('Finance.payable_pay', {'payable_id': pay[0]['id'], 'amount': unit, 'payment_method': 'Cheque', 'cheque_number': f'{RUN}',
                                        'bank_name': 'BDO', 'released_on': D}, label='Finance pays the supplier (cheque)')
        p2 = find(fin.page('finance').get('payables'), id=pay[0]['id'])
        REC.check(same(p2.get('paid_amount'), unit), 'Payable fully paid', p2.get('status'))


def t_billing():
    REC.section('9. Billing: drafts, verify documents, finalize, invoice, collections (PDF v7)')
    bil, fin = U['billing'], U['finance']
    d1, d2 = C.get('d1'), draft_of(C['t2']).get('id')
    fin.act('Billing.draft_finalize', {'draft_id': d1}, expect=False, label='Only Billing finalizes')
    bil.act('Billing.draft_finalize', {'draft_id': d1}, expect=False, label='Documents not verified yet')
    bil.act('Billing.invoice_create', {'client_id': C['cl1'], 'invoice_number': f'INV-{RUN}-0', 'invoice_date': D, 'draft_ids': [d1]}, expect=False,
            label='Draft not finalized: no invoice')
    bil.act('Billing.draft_update', {'draft_id': d1, 'rate_basis': 'Per Trip', 'quantity': 1, 'rate': 15000, 'description': 'TRP car carrier (test)'},
            label='Billing reviews the draft')
    bil.act('Billing.draft_verify', {'draft_id': d1, 'docs_note': 'waybill checked'}, label='Billing verifies the documents')
    bil.act('Billing.draft_verify', {'draft_id': d1}, expect=False, label='Already verified')
    bil.act('Billing.draft_finalize', {'draft_id': d1}, label='Billing finalizes')
    REC.check(draft_of(C['t1']).get('status') == 'Finalized', 'Billing is Finalized (Completed + verified)')
    bil.act('Billing.draft_update', {'draft_id': d1, 'rate_basis': 'Per Trip', 'quantity': 1, 'rate': 1}, expect=False, label='Finalized: editing is blocked')
    bil.act('Billing.invoice_create', {'client_id': C['cl2'], 'invoice_number': f'INV-{RUN}-X', 'invoice_date': D, 'draft_ids': [d1]}, expect=False,
            label='Draft of another client is refused')
    bil.act('Billing.invoice_create', {'client_id': C['cl1'], 'invoice_number': f'INV-{RUN}-1', 'invoice_date': D, 'draft_ids': [d1]}, label='Create the invoice')
    inv = find(bil.page('billing').get('invoices'), invoice_number=f'INV-{RUN}-1')
    due = (TODAY + dt.timedelta(days=30)).isoformat()
    REC.check(str(inv.get('due_date'))[:10] == due, 'Due date = invoice date + 30 day terms', inv.get('due_date'))
    REC.check(same(inv.get('net_amount'), 15000), 'Invoice amount comes from the finalized billing', inv.get('net_amount'))
    REC.check(not draft_of(C['t1']), 'Billing is now Invoiced (no longer in drafts)')
    bil.act('Billing.invoice_create', {'client_id': C['cl1'], 'invoice_number': f'INV-{RUN}-2', 'invoice_date': D, 'draft_ids': [d1]}, expect=False,
            label='A trip cannot be billed twice')
    bil.act('Billing.collection_add', {'billing_id': inv.get('id'), 'amount': 5000, 'payment_date': D, 'payment_method': 'Cash', 'reference': f'OR-{RUN}'},
            label='Collection 5,000')
    bil.act('Billing.collection_add', {'billing_id': inv.get('id'), 'amount': 20000, 'payment_date': D, 'payment_method': 'Cash', 'reference': 'x'}, expect=False,
            label='Collection above the balance is refused')
    REC.check(find(bil.page('billing').get('invoices'), id=inv.get('id')).get('status') == 'Partially Paid', 'Invoice is Partially Paid')
    # container trip: finalize, return to draft, invoice and cancel
    bil.act('Billing.draft_verify', {'draft_id': d2, 'docs_note': 'waybill checked'}, label='Verify documents (container trip)')
    bil.act('Billing.draft_finalize', {'draft_id': d2}, label='Finalize')
    bil.act('Billing.draft_reopen', {'draft_id': d2, 'reason': 'wrong rate'}, label='Return to draft')
    REC.check(draft_of(C['t2']).get('status') == 'Draft', 'Returned to Draft')
    bil.act('Billing.draft_finalize', {'draft_id': d2}, label='Finalize again')
    bil.act('Billing.invoice_create', {'client_id': C['cl2'], 'invoice_number': f'INV-{RUN}-3', 'invoice_date': D, 'draft_ids': [d2]}, label='Invoice the container trip')
    inv3 = find(bil.page('billing').get('invoices'), invoice_number=f'INV-{RUN}-3')
    REC.check(same(inv3.get('net_amount'), 38000), 'Container invoice 38,000')
    bil.act('Billing.invoice_cancel', {'billing_id': inv.get('id'), 'reason': 'x'}, expect=False, label='Invoice with collections cannot be cancelled')
    bil.act('Billing.invoice_cancel', {'billing_id': inv3.get('id'), 'reason': 'test cancel'}, label='Cancel the container invoice')
    REC.check(draft_of(C['t2']).get('status') == 'Finalized', 'Cancelled invoice returns the billing to Finalized (ready to invoice again)')


def t_finance():
    REC.section('10. Finance: liquidation, expenses, payables, cash advance')
    fin = U['finance']
    spent = C['f1_amount'] - 50
    fin.act('Funds.liquidate', {'fund_id': C['f1'], 'liquidated_amount': C['f1_amount'] + 1}, expect=False, label='Spent cannot be more than released')
    fin.act('Funds.liquidate', {'fund_id': C['f1'], 'liquidated_amount': spent, 'liquidation_notes': 'returned 50'}, label='Finance records the liquidation')
    fin.act('Funds.liquidate', {'fund_id': C['f1'], 'liquidated_amount': spent}, expect=False, label='Cannot liquidate twice')
    fin.act('Finance.expense_add', {'category': 'Office', 'amount': 150, 'incurred_on': D, 'payee': TAG, 'description': f'{TAG} office supplies'}, label='Finance records an expense')
    U['billing'].act('Finance.expense_add', {'category': 'Office', 'amount': 1, 'incurred_on': D}, expect=False, label='Billing cannot record expenses')
    fin.act('Finance.payable_add', {'payee': f'{TAG} Supplier', 'description': f'{TAG} payable', 'amount': 1000, 'due_on': TOM}, label='Finance adds a payable')
    p = [x for x in fin.page('finance').get('payables', []) if x.get('description') == f'{TAG} payable']
    if REC.check(bool(p), 'Payable saved'):
        fin.act('Finance.payable_pay', {'payable_id': p[0]['id'], 'amount': 2000, 'payment_method': 'Cash', 'released_on': D}, expect=False, label='Payment above balance refused')
        fin.act('Finance.payable_pay', {'payable_id': p[0]['id'], 'amount': 400, 'payment_method': 'Cash', 'released_on': D}, label='Partial payment 400')
        REC.check(same(find(fin.page('finance').get('payables'), id=p[0]['id']).get('paid_amount'), 400), 'Paid amount 400')


def ledger(pid, typ):
    return find(U['payroll'].page('balances').get('ledgers'), personnel_id=pid, ledger_type=typ)


def t_payroll():
    REC.section('11. Payroll (drivers and helpers)')
    pay, fin = U['payroll'], U['finance']
    REC.notes.append('Payroll C13: hinihintay pa ang sagot ng kumpanya kung per trip lang ang sahod ng driver. Ang test ay sumusunod sa kasalukuyang Formula Settings.')
    pid = C['p']['d1']
    days = [(TODAY - dt.timedelta(days=i)).isoformat() for i in range(5, -1, -1)]
    pay.act('Payroll.attendance_save', {'rows': [{'personnel_id': pid, 'work_date': d, 'status': 'Present'} for d in days]}, label='Attendance: 6 days present')
    fin.act('Finance.cash_advance', {'personnel_id': pid, 'amount': 2000, 'installment': 500, 'purpose': 'CA', 'payment_method': 'Cash', 'released_on': D},
            label='Finance releases a cash advance 2,000 (500 per payroll)')
    pay.act('Payroll.ledger_add', {'personnel_id': pid, 'ledger_type': 'Uniform', 'description': 'Uniform set', 'amount': 1800, 'installment': 500},
            label='Uniform balance 1,800 (500 per payroll)')
    start, end = (TODAY - dt.timedelta(days=6)).isoformat(), (TODAY + dt.timedelta(days=1)).isoformat()
    pay.act('Payroll.period_create', {'period_name': f'{TAG} payroll', 'payroll_group': C['group'], 'date_from': start, 'date_to': end}, label='Create the payroll period')
    pg = pay.page('payroll')
    per = find(pg.get('periods'), period_name=f'{TAG} payroll')
    C['period'] = per.get('id')
    line = find(pay.page('payroll', period_id=per.get('id')).get('lines'), period_id=per.get('id'), personnel_id=pid) or \
        find(pg.get('lines'), period_id=per.get('id'), personnel_id=pid)
    REC.check(bool(line), 'Payroll line for the test driver')
    if not line:
        return
    earn = json.loads(line.get('earnings_json') or '{}') if isinstance(line.get('earnings_json'), str) else (line.get('earnings_json') or {})
    ded = json.loads(line.get('deductions_json') or '{}') if isinstance(line.get('deductions_json'), str) else (line.get('deductions_json') or {})
    REC.check(str(line.get('days_worked')).split('.')[0] == '6', 'Days worked = 6', line.get('days_worked'))
    REC.check(same(line.get('regular_wage'), 600 * 6), 'Regular wage = 600 x 6', line.get('regular_wage'))
    REC.check(same(line.get('trip_pay'), 800), 'Trip pay = 800 (1 completed trip with waybill)', line.get('trip_pay'))
    e_sum = sum(money(x.get('amount')) or 0 for x in earn.get('lines', []))
    d_sum = sum(money(x.get('amount')) or 0 for x in ded.get('lines', []))
    REC.check(same(line.get('gross_pay'), money(line.get('regular_wage')) + money(line.get('trip_pay')) + e_sum), 'Gross = wage + trip pay + other earnings', line.get('gross_pay'))
    REC.check(same(line.get('total_deductions'), d_sum), 'Total deductions = sum of the deduction lines', line.get('total_deductions'))
    REC.check(same(line.get('net_pay'), money(line.get('gross_pay')) - money(line.get('total_deductions'))), 'Net = gross - deductions', line.get('net_pay'))
    by_ledger = {x.get('ledger'): money(x.get('amount')) for x in ded.get('lines', []) if x.get('ledger')}
    if 'Cash Advance' in by_ledger:
        REC.check(by_ledger['Cash Advance'] == 500, 'Cash advance installment 500 is deducted', by_ledger['Cash Advance'])
    if 'Uniform' in by_ledger:
        REC.check(by_ledger['Uniform'] == 500, 'Uniform installment 500 is deducted', by_ledger['Uniform'])
    m_earn = next((x['name'] for x in earn.get('lines', []) if x.get('calc') == 'manual'), None)
    m_ded = next((x['name'] for x in ded.get('lines', []) if x.get('calc') == 'manual'), None)
    manual = {}
    if m_earn: manual[m_earn] = 500
    if m_ded: manual[m_ded] = 200
    if manual:
        pay.act('Payroll.line_update', {'line_id': line['id'], 'manual': manual}, label=f'Typed amounts: {manual}')
        l2 = find(pay.page('payroll', period_id=per.get('id')).get('lines'), id=line['id']) or find(pay.page('payroll').get('lines'), id=line['id'])
        REC.check(same(l2.get('gross_pay'), money(line['gross_pay']) + (500 if m_earn else 0)) and
                  same(l2.get('total_deductions'), money(line['total_deductions']) + (200 if m_ded else 0)),
                  'Typed amounts change gross and deductions', f"{l2.get('gross_pay')} / {l2.get('total_deductions')}")
    fin.act('Payroll.finalize', {'period_id': per['id']}, expect=False, label='Finance cannot finalize payroll')
    pay.act('Payroll.finalize', {'period_id': per['id']}, label='Payroll finalizes')
    if 'Cash Advance' in by_ledger:
        REC.check(same(ledger(pid, 'Cash Advance').get('balance'), 1500), 'Cash advance balance 2,000 - 500 = 1,500')
    pay.act('Payroll.line_update', {'line_id': line['id'], 'manual': {}}, expect=False, label='Finalized payroll cannot be edited')
    pay.act('Payroll.reopen', {'period_id': per['id'], 'reason': 'test'}, label='Payroll reopens')
    if 'Cash Advance' in by_ledger:
        REC.check(same(ledger(pid, 'Cash Advance').get('balance'), 2000), 'Reopen reverses the cash advance deduction')
    pay.act('Payroll.finalize', {'period_id': per['id']}, label='Finalize again')
    pay.act('Payroll.submit', {'period_id': per['id']}, label='Submit to Finance')
    pay.act('Finance.payroll_disburse', {'period_id': per['id'], 'payment_method': 'Bank Transfer', 'released_on': D}, expect=False, label='Payroll cannot disburse')
    fin.act('Finance.payroll_disburse', {'period_id': per['id'], 'payment_method': 'Bank Transfer', 'released_on': D}, label='Finance disburses the payroll')
    REC.check(find(pay.page('payroll').get('periods'), id=per['id']).get('status') in ('Disbursed', 'Paid', 'Released'), 'Payroll is disbursed',
              find(pay.page('payroll').get('periods'), id=per['id']).get('status'))
    u = ledger(pid, 'Uniform')
    if u:
        bal = money(u.get('balance'))
        pay.act('Payroll.ledger_payment', {'ledger_id': u['id'], 'amount': 100, 'note': 'paid in cash'}, label='Employee pays 100 on the uniform balance')
        REC.check(same(ledger(pid, 'Uniform').get('balance'), bal - 100), 'Uniform balance goes down by 100')


def t_formula():
    REC.section('12. Formula Settings')
    pay, fin, ops, ccd, a = U['payroll'], U['finance'], U['operations_head'], U['car_carrier_dispatcher'], U['admin']
    pay.act('Admin.setting_save', {'key': 'purchase_approval_threshold', 'value': '1'}, expect=False, label='Payroll cannot change the purchase approval limit')
    pay.act('Admin.setting_save', {'key': 'fund_approval_threshold', 'value': '1'}, expect=False, label='15k fund limit no longer exists')
    st = a.page('settings')
    fuel = find(st.get('values'), key='fuel_price_per_liter')
    pnl0 = (st.get('example') or {}).get('pnl', {}).get('net_income')
    if fuel:
        fin.act('Admin.setting_save', {'key': 'fuel_price_per_liter', 'value': str((money(fuel['value']) or 70) + 5)}, label='Finance raises the fuel price by 5 (restored at the end)')
        pnl1 = (a.page('settings').get('example') or {}).get('pnl', {}).get('net_income')
        REC.check(pnl0 is not None and pnl1 is not None and money(pnl1) < money(pnl0), 'Projected P&L goes down when fuel goes up', f'{pnl0} -> {pnl1}')
    fin.act('Admin.items_save', {'scope': 'trip_allowance', 'items': [{'name': 'Fuel', 'calc': 'fuel', 'amount': 0, 'divisor': 1, 'active': 1}]}, expect=False,
            label='Fund categories are fixed amounts only')
    orig = SNAP['items'].get('trip_allowance') or []
    active = [i for i in orig if int(i.get('active') or 0)]
    if len(active) >= 2:
        changed = [dict(i, amount=money(i['amount']) + 50) if i['name'] in (active[0]['name'], active[1]['name']) else i for i in orig]
        fin.act('Admin.items_save', {'scope': 'trip_allowance', 'items': changed}, label='Finance raises two fund categories by 50 each')
        r = ops.act('Trips.create', {'client_id': C['cl1'], 'route_id': C['rt1'], 'scheduled_at': f'{TOM}T08:00', 'truck_type': 'Car Carrier'}, label='New trip for the new preset')
        t4 = r.get('trip_id')
        C['t4'] = t4
        C['trip_client'][t4] = C['cl1']
        ccd.act('Funds.request', {'trip_id': t4, 'categories': [active[0]['name'], active[1]['name']]}, expect=None, label='Fund request uses the new preset')
        expect = money(active[0]['amount']) + money(active[1]['amount']) + 100
        f = fund_of(t4)
        if f:
            REC.check(same(f.get('amount'), expect), f'New request uses the new amounts ({expect:,.2f})', f.get('amount'))
        else:
            REC.info('Trip had no free car carrier for tomorrow; new-preset fund not tested', tstatus(t4))
        REC.check(same(fund(C['f1']).get('amount'), C['f1_amount']), 'Old fund keeps its amount')
        ops.act('Trips.cancel', {'trip_id': t4, 'reason': 'system test cleanup'}, label='Cancel the extra trip')


def t_documents():
    REC.section('13. Documents and backup')
    a = U['admin']
    files = {'files[]': ('orcr.pdf', b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'application/pdf')}
    r = a.s.post(BASE + '?api=document_upload', data={'csrf': a.csrf, 'category': 'OR/CR', 'entity_type': 'vehicle', 'entity_id': C['v']['cc1'],
                                                       'expires_on': (TODAY + dt.timedelta(days=14)).isoformat()}, files=files, timeout=TIMEOUT)
    j = a._json(r)
    REC.check(j.get('ok'), 'Admin uploads the truck OR/CR (PDF)', j.get('error', ''))
    bad = {'files[]': ('virus.exe', b'MZ\x90\x00 not allowed', 'application/octet-stream')}
    j2 = a._json(a.s.post(BASE + '?api=document_upload', data={'csrf': a.csrf, 'category': 'OR/CR', 'entity_type': 'vehicle', 'entity_id': C['v']['cc1']},
                          files=bad, timeout=TIMEOUT))
    REC.check(not j2.get('ok'), 'Non-document file types are refused', j2.get('error', ''))
    docs = [d for d in a.page('documents').get('documents', []) if d.get('entity_type') == 'vehicle' and str(d.get('entity_id')) == str(C['v']['cc1'])]
    if REC.check(bool(docs), 'Document is listed'):
        did = docs[0]['id']
        REC.check(a.s.get(BASE, params={'api': 'document_download', 'id': did}, timeout=TIMEOUT).content.startswith(b'%PDF'), 'Download works')
        REC.check(U['payroll'].s.get(BASE, params={'api': 'document_download', 'id': did}, timeout=TIMEOUT).status_code == 403, 'Payroll cannot open truck documents')
    r = a.act('Admin.backup_create', label='Admin creates a database backup')
    if r.get('file'):
        txt = a.s.get(BASE, params={'api': 'backup_download', 'file': r.get('file')}, timeout=TIMEOUT * 2).text
        REC.check(txt.startswith('-- R.P. Mulawin'), 'Backup file downloads')
    U['finance'].act('Admin.backup_create', expect=False, label='Only Admin makes backups')


def t_language():
    REC.section('14b. Wika ng screen (English o Tagalog, naka-save sa account)')
    for role in ('audit', 'payroll'):
        api = U[role]
        api.act('Admin.set_language', {'language': 'xx'}, expect=False, label='Only English or Tagalog')
        api.act('Admin.set_language', {'language': 'tl'}, label=f'{ROLE_LABEL[role]} picks Tagalog for own account')
        api.login(record=False)
        REC.check((api.me.get('user') or {}).get('language') == 'tl', f'{ROLE_LABEL[role]}: language is saved on the account (tl)')
        api.act('Admin.set_language', {'language': 'en'}, label='Back to English (default)')
        api.login(record=False)
        REC.check((api.me.get('user') or {}).get('language') == 'en', f'{ROLE_LABEL[role]}: back to English')


def t_account_security():
    REC.section('14c. Account security: limit bawat role, recovery code, lock ng account')
    a = U['admin']
    a.act('Admin.role_limits_save', {'limits': {'admin': '0'}}, expect=False, label='The Admin limit cannot be 0')
    a.act('Admin.role_limits_save', {'limits': {'payroll': 'x'}}, expect=False, label='Limit must be a number')
    a.act('Admin.role_limits_save', {'limits': {'payroll': '1'}}, label='Payroll limit = 1')
    a.act('Admin.user_save', {'username': f't_pay2_{RUN}', 'full_name': 'Second payroll', 'role': 'payroll', 'password': gen_password()}, expect=False,
          label='A full role cannot get another account')
    a.act('Admin.role_limits_save', {'limits': {'car_carrier_dispatcher': '1'}}, label='Car carrier dispatchers = 1 per shift')
    a.act('Admin.user_save', {'username': f't_ccd2_{RUN}', 'full_name': 'Second day dispatcher', 'role': 'car_carrier_dispatcher', 'shift': 'Day',
                               'password': gen_password()}, expect=False, label='Day shift is full (per shift limit)')
    a.act('Admin.role_limits_save', {'limits': {'payroll': '0', 'car_carrier_dispatcher': '0'}}, label='Back to no limit for the rest of the test')
    page = a.page('users')
    REC.check('limits' in page and 'counts' in page, 'User Accounts shows the limits and the active count per role')
    # Pansamantalang Admin para sa recovery at lock test (hindi ginagalaw ang password ng Admin ng tester).
    n_admin = int((page.get('counts') or {}).get('admin', 1))
    a.act('Admin.role_limits_save', {'limits': {'admin': str(n_admin + 1)}}, label='Admin limit +1 for a temporary test Admin (restored at the end)')
    tmp_user, tmp_temp, tmp_pw = f't_adm_{RUN}', gen_password(), gen_password()
    a.act('Admin.user_save', {'username': tmp_user, 'full_name': f'Temporary Admin {RUN}', 'role': 'admin', 'password': tmp_temp}, label='Temporary Admin for the recovery test')
    t = Api(tmp_user, tmp_temp, 'admin')
    t.login()
    ensure_password_changed(t, False, tmp_pw)
    REC.check((t.me.get('user') or {}).get('recovery_ready') is False, 'New Admin has no recovery code yet (dashboard reminder shows)')
    t.act('Admin.recovery_code_create', {'current_password': 'wrong-pass-1'}, expect=False, label='Recovery code needs the current password')
    code = t.act('Admin.recovery_code_create', {'current_password': t.pw}, label='Admin makes a recovery code').get('code', '')
    REC.check(bool(re.fullmatch(r'[A-Z2-9]{4}(-[A-Z2-9]{4}){3}', code)), 'Recovery code looks like XXXX-XXXX-XXXX-XXXX')
    U['finance'].act('Admin.recovery_code_create', {'current_password': U['finance'].pw}, expect=False, label='Only Admin has a recovery code')
    rec = Api('(recovery page)', '')
    def recover(user, c, new):
        rec.s = requests.Session(); rec.whoami()
        r = rec.s.post(BASE + '?api=recover', json={'username': user, 'code': c, 'new_password': new, 'csrf': rec.csrf}, timeout=TIMEOUT)
        return rec._json(r)
    j = recover(tmp_user, 'AAAA-BBBB-CCCC-DDDD', gen_password())
    REC.check(not j.get('ok'), 'Recovery: wrong code is refused', j.get('error'))
    j = recover(U['finance'].user, code, gen_password())
    REC.check(not j.get('ok'), 'Recovery: only for Admin accounts', j.get('error'))
    new_pw = gen_password()
    j = recover(tmp_user, code.lower().replace('-', ' '), new_pw)
    REC.check(j.get('ok'), 'Recovery: right code sets a new password (dashes and small letters are fine)', (j.get('data') or {}).get('message') or j.get('error'))
    ok, err = t.page_status('dashboard')
    REC.check(not ok and 'password was changed' in (err or ''), 'The old session of that Admin is signed out after the reset', err)
    j = recover(tmp_user, code, gen_password())
    REC.check(not j.get('ok'), 'Recovery code works one time only', j.get('error'))
    t = Api(tmp_user, new_pw, 'admin')
    ok, _ = t.login()
    REC.check(ok, 'Login with the new password works')
    # Lock ng account: 5 maling password kahit magkakaibang browser session
    for i in range(4):
        Api(tmp_user, f'wrong-{i}-pass').login(record=False)
    ok, err = Api(tmp_user, 'wrong-4-pass').login(record=False)
    REC.check(not ok and 'locked' in (err or ''), '5 wrong passwords (from different browsers) lock the account', err)
    ok, err = Api(tmp_user, new_pw).login(record=False)
    REC.check(not ok and 'locked' in (err or ''), 'Even the right password waits while the account is locked', err)
    tid = find(a.page('users').get('users'), username=tmp_user).get('id')
    reset_pw = gen_password()
    a.act('Admin.user_password', {'user_id': tid, 'password': reset_pw}, label='Admin resets the password (also unlocks the account)')
    ok, err = Api(tmp_user, reset_pw).login(record=False)
    REC.check(ok, 'After the reset the account is unlocked', err)
    a.act('Admin.user_toggle', {'user_id': tid, 'active': 0}, label='Deactivate the temporary Admin')


def t_access():
    REC.section('14. Access per role: allowed pages load, other pages are blocked')
    all_pages = set()
    for api in U.values():
        all_pages.update(api.nav)
    for role in ['admin'] + ROLES:
        api = U[role]
        bad = []
        for p in api.nav:
            ok, err = api.page_status(p)
            if not ok:
                bad.append(f'{p}: {err}')
            else:
                api.page(p)  # records section errors
        REC.check(not bad, f'{ROLE_LABEL[role]}: all {len(api.nav)} menu pages load', '; '.join(bad))
        leak = [p for p in sorted(all_pages - set(api.nav)) if api.page_status(p)[0]]
        REC.check(not leak, f'{ROLE_LABEL[role]}: pages outside the menu are blocked', ', '.join(leak))
    rep = U['admin'].page('reports', **{'from': (TODAY - dt.timedelta(days=30)).isoformat(), 'to': TOM, 'group': 'week'})
    REC.check(len(rep.get('sections', [])) > 0, 'Reports & Analytics builds with a date range', ', '.join(s.get('title', '') for s in rep.get('sections', [])))


def t_cleanup():
    REC.section('16. Cleanup of test resources')
    a = U['admin']
    for k, vid in C.get('v', {}).items():
        a.act('Fleet.vehicle_active', {'vehicle_id': vid, 'active': 0}, expect=None, label=f'Deactivate test truck {C["plates"][k]}')
    for k, pid in C.get('p', {}).items():
        U['operations_head'].act('Fleet.person_availability', {'id': pid, 'availability': 'Unavailable'}, expect=None, label='Mark test crew Unavailable')
    REC.notes.append(f'Ang test data ay may tag na "{TAG}" (clients, routes, crew, trucks, parts, invoices). Hindi ito binubura ng script; '
                     'gumamit ng test copy o i-reset ang XAMPP database pagkatapos.')


# ----------------------------------------------------------------------------- browser click-through
def t_browser():
    REC.section('17. Browser: bawat page, tab at sub-tab ng bawat role (may screenshots)')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        REC.fail('Playwright is not installed', 'pip install playwright  at  python -m playwright install chromium')
        return
    os.makedirs(os.path.join(REPORT_DIR, 'shots'), exist_ok=True)
    app = BASE
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as e:
            REC.fail('Chromium did not start', str(e).splitlines()[0] + '  ->  python -m playwright install chromium')
            return
        for role in ['admin'] + ROLES:
            api = U.get(role)
            if not api:
                continue
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
            page = ctx.new_page()
            page.set_default_timeout(20000)
            errors = []
            page.on('pageerror', lambda e, errors=errors: errors.append('page error: ' + str(e)))
            page.on('console', lambda m, errors=errors: errors.append('console: ' + m.text) if m.type == 'error' else None)
            try:
                page.goto(app)
                page.fill('#lgU', api.user)
                page.fill('#lgP', 'definitely-wrong-1')
                page.click('button[type=submit]')
                page.wait_for_timeout(800)
                REC.check(page.query_selector('#pageContent') is None, f'{api.user}: wrong password stays on the login screen')
                REC.check(page.input_value('#lgU') == api.user, f'{api.user}: username stays filled in after a wrong password')
                errors.clear()
                page.fill('#lgU', api.user)
                page.fill('#lgP', api.pw)
                page.click('button[type=submit]')
                page.wait_for_selector('#pageContent', timeout=20000)
            except Exception as e:
                REC.fail(f'{ROLE_LABEL[role]}: browser login', str(e).splitlines()[0])
                ctx.close()
                continue
            navs = page.eval_on_selector_all('[data-nav]', 'a => [...new Set(a.map(x => x.dataset.nav))]')
            problems = []
            for n in navs:
                before = len(errors)
                try:
                    page.goto(app + '#' + n)
                    page.wait_for_timeout(300)
                    try:
                        page.wait_for_function("() => !document.querySelector('#pageBody .spinner-border')", timeout=20000)
                    except Exception:
                        problems.append(f'{n}: still loading after 20 seconds')
                    clicks = 0

                    def click_all(sel):
                        nonlocal clicks
                        k = len(page.query_selector_all(sel))
                        for i in range(k):
                            els = page.query_selector_all(sel)
                            if i < len(els) and els[i].is_visible():
                                els[i].click()
                                clicks += 1
                                page.wait_for_timeout(80)
                        return k

                    top = '#pageBody .nav-tabs > li > [data-tab]'
                    sub = '#pageBody .sub-tabs [data-tab]'
                    n_top = len(page.query_selector_all(top))
                    for i in range(max(n_top, 1)):
                        if n_top:
                            page.query_selector_all(top)[i].click()
                            clicks += 1
                            page.wait_for_timeout(120)
                        n_sub = len(page.query_selector_all(sub))
                        for j in range(max(n_sub, 1)):
                            if n_sub:
                                els = page.query_selector_all(sub)
                                if j < len(els):
                                    els[j].click()
                                    clicks += 1
                                    page.wait_for_timeout(100)
                            click_all('#pageBody [data-pick]')
                            click_all('#pageBody [data-chartmore] button')
                            down = page.query_selector('#pageBody .module-down')
                            if down:
                                problems.append(f'{n}: ' + down.inner_text()[:150])
                    if n_top:
                        page.query_selector_all(top)[0].click()
                        page.wait_for_timeout(150)
                    page.evaluate('window.scrollTo(0, 0)')
                    fname = f'{ROLE_SHORT[role]}_{n}.png'
                    page.screenshot(path=os.path.join(REPORT_DIR, 'shots', fname))
                    new_err = errors[before:]
                    problems += [f'{n}: {e}' for e in new_err]
                    REC.shots.append({'role': role, 'user': api.user, 'page': n, 'file': 'shots/' + fname, 'clicks': clicks, 'problems': new_err})
                except Exception as e:
                    problems.append(f'{n}: {str(e).splitlines()[0]}')
            REC.check(not problems, f'{ROLE_LABEL[role]}: {len(navs)} pages clicked (tabs, sub-tabs, tables, charts) with no errors', '; '.join(problems)[:1500])
            # Dashboard cards: bawat card na may link ay bubukas sa tamang page (at tab), walang error
            try:
                page.goto(app + '#dashboard')
                page.wait_for_selector('#pageBody .stat-card', timeout=20000)
                n_cards = len(page.query_selector_all('#pageBody .stat-card.clickable'))
                bad_cards = []
                for i in range(n_cards):
                    page.goto(app + '#dashboard')
                    page.wait_for_selector('#pageBody .stat-card.clickable', timeout=20000)
                    card = page.query_selector_all('#pageBody .stat-card.clickable')[i]
                    label = card.query_selector('.stat-label').inner_text()
                    target = card.get_attribute('data-go') or ''
                    before = len(errors)
                    card.click()
                    page.wait_for_timeout(400)
                    try:
                        page.wait_for_function("() => !document.querySelector('#pageBody .spinner-border')", timeout=20000)
                    except Exception:
                        pass
                    want_page = target.split('#')[0].split('?')[0]
                    got_page = page.evaluate('location.hash.slice(1).split("?")[0]')
                    want_tab = dict(x.split('=', 1) for x in target.split('#')[1].split('&')).get('_') if '#' in target else None
                    tab_ok = True
                    if want_tab:
                        act = page.query_selector('#pageBody .nav-tabs > li > .active')
                        tab_ok = bool(act) and act.get_attribute('data-tab') == want_tab
                    if got_page != want_page or not tab_ok or len(errors) > before or page.query_selector('#pageBody .module-down'):
                        bad_cards.append(f'{label} -> {target} (opened {got_page})')
                REC.check(not bad_cards, f'{ROLE_LABEL[role]}: {n_cards} dashboard cards open the right page and tab', '; '.join(bad_cards))
            except Exception as e:
                REC.fail(f'{ROLE_LABEL[role]}: dashboard card links', str(e).splitlines()[0])
            # Reports & Analytics: Print (this section at all sections) may laman, header at period
            if 'reports' in navs:
                try:
                    page.goto(app + '#reports')
                    page.wait_for_selector('#repPrint', timeout=20000)
                    n_sec = len(page.query_selector_all('#pageBody .nav-tabs > li > [data-tab]'))
                    page.evaluate('window.print = () => { window.__printed = (window.__printed || 0) + 1; }')
                    for mode in ('one', 'all'):
                        page.click('#repPrint')
                        page.click(f'[data-print="{mode}"]')
                        page.wait_for_timeout(1200)
                        got = page.evaluate("() => ({n: document.querySelectorAll('#printArea .print-report section').length, head: (document.querySelector('#printArea .pr-head') || {}).innerText || '', printed: window.__printed || 0})")
                        want = 1 if mode == 'one' else n_sec
                        REC.check(got['n'] == want and 'Period' in got['head'] and 'Printed by' in got['head'],
                                  f'{ROLE_LABEL[role]}: Reports Print ({"this section" if mode == "one" else "all sections"}) has the header and {want} section(s)', f"{got['n']} section(s)")
                    page.evaluate('document.getElementById("printArea").innerHTML = ""')
                except Exception as e:
                    REC.fail(f'{ROLE_LABEL[role]}: Reports print', str(e).splitlines()[0])
            # phone width: no sideways scrolling on the first page
            try:
                page.set_viewport_size({'width': 390, 'height': 844})
                page.goto(app + '#' + (navs[0] if navs else 'dashboard'))
                page.wait_for_timeout(800)
                over = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
                fname = f'{ROLE_SHORT[role]}_phone.png'
                page.screenshot(path=os.path.join(REPORT_DIR, 'shots', fname))
                REC.shots.append({'role': role, 'user': api.user, 'page': 'phone view', 'file': 'shots/' + fname, 'clicks': 0, 'problems': []})
                REC.check(over <= 2, f'{ROLE_LABEL[role]}: phone width has no sideways scrolling', f'{over}px wider' if over > 2 else '')
            except Exception as e:
                REC.fail(f'{ROLE_LABEL[role]}: phone view', str(e).splitlines()[0])
            ctx.close()
        # Mapa: preview ng ruta sa Add route (Google Maps embed na walang API key)
        try:
            a = U['admin']
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
            page = ctx.new_page()
            page.set_default_timeout(20000)
            page.goto(app)
            page.fill('#lgU', a.user)
            page.fill('#lgP', a.pw)
            page.click('button[type=submit]')
            page.wait_for_selector('#pageContent')
            page.goto(app + '#clients')
            page.wait_for_selector('[data-n="r"]')
            page.click('[data-n="r"]')
            page.wait_for_selector('.modal.show [name=origin]')
            page.fill('.modal.show [name=origin]', 'Batangas Port')
            page.fill('.modal.show [name=destination]', 'Cabuyao, Laguna')
            page.wait_for_timeout(1300)
            src = page.get_attribute('.modal.show iframe', 'src') or ''
            link = page.get_attribute('.modal.show .route-map a', 'href') or ''
            REC.check('maps.google.com/maps?saddr=' in src and 'output=embed' in src and 'google.com/maps/dir' in link,
                      'Add route: map preview of the route and "Open in Google Maps" link', src[:120])
            ctx.close()
        except Exception as e:
            REC.fail('Route map preview', str(e).splitlines()[0])
        # Tagalog: buong menu ng Admin sa Tagalog (walang error), at palit pabalik sa English gamit ang dropdown ng pangalan
        try:
            a = U['admin']
            a.act('Admin.set_language', {'language': 'tl'}, label='Admin switches to Tagalog for the browser check')
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
            page = ctx.new_page()
            page.set_default_timeout(20000)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(app)
            page.fill('#lgU', a.user)
            page.fill('#lgP', a.pw)
            page.click('button[type=submit]')
            page.wait_for_selector('#dashRefresh')
            page.wait_for_timeout(500)
            REC.check('I-refresh' in page.inner_text('#dashRefresh') and page.evaluate('document.documentElement.lang') == 'tl',
                      'Tagalog: the screen is in Tagalog after login', page.inner_text('#dashRefresh').strip())
            bad = []
            navs = page.eval_on_selector_all('[data-nav]', 'a => [...new Set(a.map(x => x.dataset.nav))]')
            for n in navs:
                page.goto(app + '#' + n)
                page.wait_for_timeout(300)
                try:
                    page.wait_for_function("() => !document.querySelector('#pageBody .spinner-border')", timeout=20000)
                except Exception:
                    bad.append(f'{n}: still loading')
                if page.query_selector('#pageBody .module-down'):
                    bad.append(f'{n}: ' + page.inner_text('#pageBody .module-down')[:120])
                if n in ('dashboard', 'trips', 'billing', 'payroll', 'settings'):
                    fname = f'tl_adm_{n}.png'
                    page.screenshot(path=os.path.join(REPORT_DIR, 'shots', fname))
                    REC.shots.append({'role': 'admin', 'user': a.user, 'page': n + ' (Tagalog)', 'file': 'shots/' + fname, 'clicks': 0, 'problems': []})
            REC.check(not bad and not errors, f'Tagalog: all {len(navs)} Admin pages open with no errors', '; '.join(bad + errors)[:800])
            page.goto(app + '#dashboard')
            page.wait_for_selector('#dashRefresh')
            page.click('.profile-trigger')
            with page.expect_navigation():
                page.click('[data-lang="en"]')
            page.wait_for_selector('#dashRefresh')
            page.wait_for_timeout(500)
            REC.check(page.inner_text('#dashRefresh').strip() == 'Refresh', 'Language menu: switching back to English works', page.inner_text('#dashRefresh').strip())
            ctx.close()
        except Exception as e:
            REC.fail('Tagalog browser check', str(e).splitlines()[0])
            U['admin'].act('Admin.set_language', {'language': 'en'}, expect=None, label='Back to English')
        browser.close()


# ----------------------------------------------------------------------------- report
def write_report(mode, url):
    os.makedirs(REPORT_DIR, exist_ok=True)
    total, fails = len(REC.rows), len(REC.failures)
    secs = int(time.time() - REC.started)
    e = html.escape
    out = [f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>System test {e(TAG)}</title><style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f5f7f5;color:#1d2b22}} header{{background:#14532d;color:#fff;padding:18px 28px}}
header h1{{margin:0;font-size:22px}} header .gold{{color:#f4c430}} main{{padding:20px 28px;max-width:1500px}}
.cards{{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0 20px}} .card{{background:#fff;border-radius:10px;padding:12px 18px;box-shadow:0 1px 3px #0002;min-width:150px}}
.card b{{display:block;font-size:24px}} .pass{{color:#15803d}} .fail{{color:#b91c1c}}
table{{border-collapse:collapse;width:100%;background:#fff;font-size:13px;margin-bottom:8px}} th,td{{border-bottom:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}}
th{{background:#ecfdf5}} tr.f td{{background:#fef2f2}} .badge{{display:inline-block;padding:1px 8px;border-radius:10px;font-weight:600;font-size:12px}}
.bp{{background:#dcfce7;color:#166534}} .bf{{background:#fee2e2;color:#991b1b}} .bi{{background:#e0e7ff;color:#3730a3}}
details{{background:#fff;border-radius:10px;margin:10px 0;box-shadow:0 1px 3px #0001}} summary{{padding:10px 14px;cursor:pointer;font-weight:600}}
.shots{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;padding:10px}} .shots a{{display:block;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:6px;text-decoration:none;color:#1d2b22;font-size:12px}}
.shots img{{width:100%;border-radius:4px}} .muted{{color:#6b7280}} .warn{{background:#fff7ed;border-left:4px solid #f59e0b;padding:10px 14px;margin:10px 0}}
</style></head><body><header><h1>Mulawin FleetOps <span class="gold">System Test Report</span></h1>
<div>{e(TAG)} &middot; {e(NOW.strftime('%B %d, %Y %I:%M %p'))} &middot; {e(mode)} &middot; {e(url)}</div></header><main>
<div class="cards"><div class="card">Result<b class="{'pass' if not fails else 'fail'}">{'ALL PASSED' if not fails else str(fails) + ' FAILED'}</b></div>
<div class="card">Checks and steps<b>{total}</b></div><div class="card">Passed<b class="pass">{total - fails}</b></div>
<div class="card">Failed<b class="fail">{fails}</b></div><div class="card">Screenshots<b>{len(REC.shots)}</b></div><div class="card">Time<b>{secs // 60}m {secs % 60}s</b></div></div>
<div class="warn">Test copy lang ito dapat. Ang lahat ng test record ay may tag na <b>{e(TAG)}</b>.</div>"""]
    if fails:
        out.append('<h2 class="fail">Mga FAIL</h2><table><tr><th>Section</th><th>Who</th><th>Step / check</th><th>Expected</th><th>Message</th></tr>')
        for r in REC.failures:
            out.append(f"<tr class='f'><td>{e(r['section'])}</td><td>{e(r['actor'])}</td><td>{e(r['action'])}</td><td>{e(r['expect'])}</td><td>{e(r['message'])}</td></tr>")
        out.append('</table>')
    out.append('<h2>Accounts na ginamit</h2><table><tr><th>Role</th><th>Username</th><th>Password</th><th>Source</th></tr>')
    for acc in REC.accounts:
        out.append(f"<tr><td>{e(ROLE_LABEL.get(acc['role'], acc['role']))}</td><td>{e(acc['username'])}</td><td><code>{e(acc['password'])}</code></td><td>{e(acc['source'])}</td></tr>")
    out.append('</table><p class="muted">Naka-save din ang test accounts sa tests/system_test_accounts.json para magamit ulit sa susunod na run.</p>')
    if REC.notes:
        out.append('<h2>Notes</h2><ul>' + ''.join(f'<li>{e(n)}</li>' for n in REC.notes) + '</ul>')
    out.append('<h2>Detalye kada section</h2>')
    for s in REC.sections:
        rows = [r for r in REC.rows if r['section'] == s]
        nf = sum(1 for r in rows if not r['passed'])
        out.append(f"<details{' open' if nf else ''}><summary>{e(s)} &nbsp; <span class='badge {'bf' if nf else 'bp'}'>{len(rows) - nf}/{len(rows)} passed</span></summary>"
                   '<table><tr><th>#</th><th>Result</th><th>Who (role)</th><th>Step / check</th><th>Expected</th><th>Message from the system</th></tr>')
        for i, r in enumerate(rows, 1):
            badge = '<span class="badge bi">INFO</span>' if r['expect'] == 'info' else (
                '<span class="badge bp">PASS</span>' if r['passed'] else '<span class="badge bf">FAIL</span>')
            who = f"{e(r['actor'])} <span class='muted'>({e(ROLE_LABEL.get(r['role'], r['role']))})</span>" if r['actor'] else ''
            out.append(f"<tr class='{'' if r['passed'] else 'f'}'><td>{i}</td><td>{badge}</td><td>{who}</td><td>{e(r['action'])}</td><td>{e(r['expect'])}</td><td>{e(r['message'])}</td></tr>")
        out.append('</table></details>')
    if REC.shots:
        out.append('<h2>Screenshots</h2>')
        for role in ['admin'] + ROLES:
            sh = [x for x in REC.shots if x['role'] == role]
            if not sh:
                continue
            out.append(f"<details><summary>{e(ROLE_LABEL[role])} ({e(sh[0]['user'])}) &middot; {len(sh)} screenshots</summary><div class='shots'>")
            for x in sh:
                prob = f"<div class='fail'>{e('; '.join(x['problems']))[:300]}</div>" if x['problems'] else ''
                out.append(f"<a href='{e(x['file'])}' target='_blank'><img loading='lazy' src='{e(x['file'])}'><div><b>{e(x['page'])}</b> "
                           f"<span class='muted'>{x['clicks']} clicks</span></div>{prob}</a>")
            out.append('</div></details>')
    out.append('</main></body></html>')
    path = os.path.join(REPORT_DIR, 'report.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    with open(os.path.join(REPORT_DIR, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump({'tag': TAG, 'mode': mode, 'url': url, 'rows': REC.rows, 'accounts': REC.accounts, 'notes': REC.notes}, f, indent=1)
    return path


# ----------------------------------------------------------------------------- main
def main():
    global BASE
    ap = argparse.ArgumentParser(description='Mulawin FleetOps automated system test (TEST COPY ONLY).')
    ap.add_argument('--mode', choices=['xampp', 'hostinger'])
    ap.add_argument('--url', help='Link ng system (folder o index.php)')
    ap.add_argument('--admin-user')
    ap.add_argument('--admin-pass')
    ap.add_argument('--accounts', help='JSON file: {"billing": ["user","pass"], ...} para sa ibang accounts na meron na')
    ap.add_argument('--reset', action='store_true', help='XAMPP lang: bagong empty database bago mag-test')
    ap.add_argument('--no-browser', action='store_true', help='Huwag patakbuhin ang browser click-through')
    ap.add_argument('--new-accounts', action='store_true', help='Huwag gamitin ulit ang test accounts ng nakaraang run')
    ap.add_argument('--yes', action='store_true', help='Walang tanong (para sa automation)')
    args = ap.parse_args()
    interactive = not args.yes
    try:
        sys.stdout.reconfigure(errors='replace')   # Windows console: never crash on special characters
    except Exception:
        pass

    print('=' * 70)
    print(' Mulawin FleetOps  -  Automated System Test')
    print(' BABALA: Gamitin lang sa TEST COPY. Huwag sa live na system ng kumpanya.')
    print('=' * 70)
    mode = args.mode
    if not mode:
        print('Saan itetest?\n  1) XAMPP (local sa computer na ito)\n  2) Hostinger (test copy online)')
        mode = {'1': 'xampp', '2': 'hostinger'}.get(ask('Piliin 1 o 2', '1'), 'xampp')
    default_url = 'http://localhost/RP_Mulawin_FMS_V2/' if mode == 'xampp' else ''
    url = args.url or ask('Link ng system', default_url)
    if not url:
        print('Walang link.')
        return 2
    if mode == 'hostinger':
        print('\nMagdadagdag ito ng test records sa database ng link na ito: ' + url)
        if interactive and input('Siguradong TEST COPY ito? I-type ang TEST para ituloy: ').strip() != 'TEST':
            print('Hindi itinuloy.')
            return 2
    admin_user, admin_pw = args.admin_user, args.admin_pass
    if mode == 'xampp' and (args.reset or (interactive and yes('Gusto mo bang i-reset sa bagong EMPTY database bago mag-test?'))):
        u = admin_user or (ask('Username ng bagong Admin', 'admin') if interactive else 'admin')
        res = xampp_reset(u, assume_yes=args.yes)
        if not res:
            return 2
        admin_user, admin_pw = res
        try:
            os.remove(ACCOUNTS_FILE)
        except OSError:
            pass
    BASE = resolve_base(url)
    if not BASE:
        print(f'Hindi ma-reach ang system sa {url}. I-check ang link (dapat bukas ang login page) at kung naka-on ang Apache/MySQL.')
        return 2
    print('System found: ' + BASE)
    if not admin_user:
        admin_user = ask('Admin username')
    if not admin_pw:
        admin_pw = getpass.getpass('Admin password: ')
    given = {}
    if args.accounts:
        with open(args.accounts, encoding='utf-8') as f:
            given = {k: tuple(v) for k, v in json.load(f).items() if k in ROLES}
    elif interactive and yes('May iba ka pang account na gusto mong gamitin (hindi Admin)?'):
        for role in ROLES:
            u = input(f'  {ROLE_LABEL[role]} username (Enter = gagawa ang script): ').strip()
            if u:
                given[role] = (u, getpass.getpass(f'  {ROLE_LABEL[role]} password: '))
    run_browser = not args.no_browser and (not interactive or yes('Isama ang browser click-through (mas matagal, may screenshots)?', True))

    ok = setup_accounts(admin_user, admin_pw, given, interactive, reuse=not args.new_accounts)
    if ok:
        sections = [t_security, t_master, t_scenario_a, t_scenario_b, t_wingvan, t_maintenance, t_purchasing, t_billing, t_finance,
                    t_payroll, t_formula, t_documents, t_language, t_account_security, t_access]
        try:
            for fn in sections:
                try:
                    fn()
                except Exception as ex:
                    REC.fail(f'Section stopped because of an error: {fn.__name__}', ''.join(traceback.format_exception_only(type(ex), ex)).strip())
                    traceback.print_exc()
        finally:
            try:
                restore_settings()
            except Exception as ex:
                REC.fail('Restore settings', str(ex))
            try:
                t_cleanup()
            except Exception as ex:
                REC.fail('Cleanup', str(ex))
        if run_browser:
            try:
                t_browser()
            except Exception as ex:
                REC.fail('Browser test stopped', str(ex))
    path = write_report(mode.upper(), BASE)
    print('\n' + '=' * 70)
    print(f' RESULT: {len(REC.rows) - len(REC.failures)} passed, {len(REC.failures)} failed')
    for r in REC.failures[:30]:
        print(f"  FAIL [{r['section']}] {r['actor']} {r['action']}: {r['message']}"[:220])
    print(' Report: ' + path)
    print('=' * 70)
    if interactive:
        try:
            webbrowser.open(pathlib.Path(path).resolve().as_uri())
        except Exception:
            pass
    return 0 if not REC.failures else 1


if __name__ == '__main__':
    sys.exit(main())
