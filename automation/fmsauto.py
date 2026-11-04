"""
automation/fmsauto.py - shared helpers for the two demonstration scripts.

  script1_init_accounts.py  creates / checks the user accounts through the Admin screens
  script2_demo.py           demonstrates every objective through the real screens

Rules these helpers enforce (see guide H and M):
  * Everything is done through the browser screens, like a person would. No database access.
  * Logging in uses the real email code (OTP). By default YOU type the code from your inbox.
  * Passwords are never printed, never written to reports or screenshots. They live only in
    automation/.credentials.json (ignored by git, readable by your Windows/Linux user only).
  * A result is PASSED only after the action was done AND checked again after reloading the
    data from the server. FAILED = done but wrong / error. SKIPPED = not done, with the reason.

Needs: Python 3.9+ and Playwright  (pip install playwright, then: python -m playwright install chromium)
"""
import datetime as dt
import getpass
import html
import json
import os
import re
import secrets
import string
import sys
import time
import traceback

# Windows consoles may not show every character (names with accents, peso sign): never crash on printing.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors='replace')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, 'config.json')
CONFIG_EXAMPLE = os.path.join(HERE, 'config.example.json')
CRED_FILE = os.path.join(HERE, '.credentials.json')
SESSION_DIR = os.path.join(HERE, '.sessions')
SAMPLE_DIR = os.path.join(HERE, 'sample_files')
REPORTS_DIR = os.path.join(HERE, 'reports')
MANIFEST_FILE = os.path.join(HERE, 'demo_manifest.json')

ROLE_LABEL = {'admin': 'Admin (Head Management)', 'operations_head': 'Operations Head', 'car_carrier_dispatcher': 'Car Carrier Dispatcher',
              'container_wingvan_dispatcher': 'Container / Wing Van Dispatcher', 'motorpool': 'Motorpool Custodian',
              'purchasing': 'Purchasing Officer', 'finance': 'Finance', 'billing': 'Billing and Collection', 'audit': 'Audit'}

PASSED, FAILED, SKIPPED = 'PASSED', 'FAILED', 'SKIPPED'


# ============================================================================ small utilities
def now_stamp():
    return dt.datetime.now().strftime('%Y%m%d_%H%M%S')


def mask_email(email):
    """a***@gmail.com - enough to recognise, not enough to copy."""
    if not email or '@' not in email:
        return email or ''
    name, dom = email.split('@', 1)
    return (name[:1] + '***' + ('+' + name.split('+', 1)[1] if '+' in name else '')) + '@' + dom


def strong_password(length=16):
    """Random password with upper, lower case letters and digits (the system needs letters and numbers)."""
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = ''.join(secrets.choice(alphabet) for _ in range(length))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and sum(c.isdigit() for c in pw) >= 2:
            return pw


def load_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        sys.exit(f'{os.path.basename(path)} is not valid JSON ({e}). Fix or delete the file, then run again.')


def save_private_json(path, data):
    """Writes a JSON file that only the current user can read (credentials, sessions)."""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def load_config():
    if not os.path.exists(CONFIG_FILE):
        sys.exit('automation/config.json is missing.\n'
                 'Copy automation/config.example.json to automation/config.json and fill in the link and the email addresses (guide H).')
    cfg = load_json(CONFIG_FILE, {})
    base = (cfg.get('base_url') or '').strip().rstrip('/')
    if not base:
        sys.exit('config.json: "base_url" is empty (example: http://localhost/RP_Mulawin_FMS_V2/public).')
    if base.endswith('index.php'):
        base = base[:-len('index.php')].rstrip('/')
    cfg['base_url'] = base
    cfg.setdefault('accounts', {})
    return cfg


class Credentials:
    """Passwords per username, kept in automation/.credentials.json (never printed)."""
    def __init__(self):
        self.data = load_json(CRED_FILE, {})

    def get(self, base, username):
        return self.data.get(base, {}).get(username)

    def set(self, base, username, password):
        self.data.setdefault(base, {})[username] = password
        save_private_json(CRED_FILE, self.data)

    def ask(self, base, username, label):
        pw = self.get(base, username)
        if pw:
            return pw
        pw = getpass.getpass(f'Password of {label} "{username}" (typing is hidden): ')
        if not pw:
            sys.exit('No password given.')
        if input('Save this password in automation/.credentials.json for the next runs? (y/N): ').strip().lower() == 'y':
            self.set(base, username, pw)
        return pw


# ============================================================================ results and report
class Recorder:
    """Collects PASSED / FAILED / SKIPPED results with evidence and writes the HTML + JSON report."""
    def __init__(self, title, script_name):
        self.title, self.script_name = title, script_name
        self.started = dt.datetime.now()
        self.dir = os.path.join(REPORTS_DIR, script_name + '_' + now_stamp())
        os.makedirs(os.path.join(self.dir, 'screenshots'), exist_ok=True)
        os.makedirs(os.path.join(self.dir, 'printed_forms'), exist_ok=True)
        self.items = []
        self.notes = []
        self.section = 'Setup'
        self.context = {}

    def set_section(self, name):
        self.section = name
        print('\n== ' + name)

    def add(self, item_id, objective, name, status, detail='', evidence=None):
        it = {'id': item_id, 'objective': objective, 'section': self.section, 'name': name, 'status': status,
              'detail': str(detail or ''), 'evidence': evidence or [], 'time': dt.datetime.now().strftime('%H:%M:%S')}
        self.items.append(it)
        print(f'  [{status:7}] {item_id} {name}' + (f'  - {detail}' if detail else ''))
        return status == PASSED

    def passed(self, item_id, objective, name, detail='', evidence=None):
        return self.add(item_id, objective, name, PASSED, detail, evidence)

    def failed(self, item_id, objective, name, detail='', evidence=None):
        return self.add(item_id, objective, name, FAILED, detail, evidence)

    def skipped(self, item_id, objective, name, reason, evidence=None):
        return self.add(item_id, objective, name, SKIPPED, reason, evidence)

    def check(self, item_id, objective, name, cond, detail_ok='', detail_bad='', evidence=None):
        return self.add(item_id, objective, name, PASSED if cond else FAILED, detail_ok if cond else detail_bad, evidence)

    def note(self, text):
        self.notes.append(text)
        print('  note: ' + text)

    def counts(self):
        c = {PASSED: 0, FAILED: 0, SKIPPED: 0}
        for it in self.items:
            c[it['status']] += 1
        return c

    def write(self):
        c = self.counts()
        data = {'title': self.title, 'script': self.script_name, 'started': self.started.isoformat(timespec='seconds'),
                'finished': dt.datetime.now().isoformat(timespec='seconds'), 'counts': c, 'context': self.context,
                'notes': self.notes, 'items': self.items}
        with open(os.path.join(self.dir, 'report.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        esc = html.escape
        rows = []
        for it in self.items:
            ev = ' '.join(f'<a href="{esc(e)}" target="_blank">{esc(os.path.basename(e))}</a>' for e in it['evidence'])
            rows.append(f'<tr class="{it["status"].lower()}"><td>{esc(it["id"])}</td><td>{esc(it["objective"])}</td><td>{esc(it["section"])}</td>'
                        f'<td>{esc(it["name"])}</td><td><b>{it["status"]}</b></td><td>{esc(it["detail"])}</td><td>{ev}</td><td>{it["time"]}</td></tr>')
        ctx = ''.join(f'<li><b>{esc(k)}:</b> {esc(str(v))}</li>' for k, v in self.context.items())
        notes = ''.join(f'<li>{esc(n)}</li>' for n in self.notes)
        page = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>{esc(self.title)}</title>
<style>body{{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#1f2328}}h1{{font-size:20px;margin:0 0 4px}}
.sum span{{display:inline-block;margin-right:14px;padding:4px 10px;border-radius:4px;font-weight:bold}}
.p{{background:#e7f5ec;color:#1a7f37}}.f{{background:#fdecea;color:#b42318}}.s{{background:#fff4dc;color:#9a6100}}
table{{border-collapse:collapse;width:100%;font-size:13px;margin-top:14px}}th,td{{border:1px solid #d0d7de;padding:5px 7px;vertical-align:top;text-align:left}}
th{{background:#f6f8fa}}tr.failed td{{background:#fff5f5}}tr.skipped td{{background:#fffbf0}}.muted{{color:#57606a;font-size:12px}}</style></head><body>
<h1>{esc(self.title)}</h1><div class="muted">Started {self.started:%Y-%m-%d %H:%M:%S} · report folder {esc(self.dir)}</div>
<p class="sum"><span class="p">PASSED {c[PASSED]}</span><span class="f">FAILED {c[FAILED]}</span><span class="s">SKIPPED {c[SKIPPED]}</span></p>
<p class="muted">PASSED = done in the screens and confirmed again from the server after reloading. FAILED = an error or a wrong result. SKIPPED = not done; the reason is given. Passwords and login codes are never written here.</p>
<ul>{ctx}</ul>{f'<h3>Notes</h3><ul>{notes}</ul>' if notes else ''}
<table><thead><tr><th>ID</th><th>Objective</th><th>Section</th><th>Check</th><th>Result</th><th>Details</th><th>Evidence</th><th>Time</th></tr></thead><tbody>{''.join(rows)}</tbody></table></body></html>"""
        path = os.path.join(self.dir, 'report.html')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(page)
        return path


# ============================================================================ login codes (OTP)
class OtpSource:
    """Where the 6-digit login code comes from.
       manual  (default) - you read the email and type the code in this window.
       mailpit (local testing only) - reads the code from a local Mailpit inbox (http://127.0.0.1:8025)."""
    def __init__(self, mode='manual', mailpit_url='http://127.0.0.1:8025'):
        self.mode, self.mailpit_url = mode, mailpit_url.rstrip('/')
        self._seen = {}

    def before_login(self, email):
        if self.mode == 'mailpit':
            self._seen[email] = self._mailpit_last(email)

    def code(self, email, username, attempt):
        if self.mode == 'mailpit':
            return self._mailpit_code(email)
        print(f'\n  >> A login code was emailed to {mask_email(email)} for "{username}".')
        hint = '' if attempt == 1 else ' (the last code was not accepted)'
        v = input(f'  >> Type the 6-digit code{hint}, or R to send a new code: ').strip()
        return v

    # --- local Mailpit (only for running the scripts on a test computer with Mailpit)
    def _get(self, path):
        import urllib.request
        with urllib.request.urlopen(self.mailpit_url + path, timeout=10) as r:
            return json.loads(r.read().decode('utf-8'))

    def _mailpit_last(self, email):
        import urllib.parse
        r = self._get('/api/v1/search?limit=1&query=' + urllib.parse.quote(f'to:"{email}"'))
        ms = r.get('messages') or []
        return ms[0]['ID'] if ms else None

    def _mailpit_code(self, email):
        before = self._seen.get(email)
        for _ in range(60):
            last = self._mailpit_last(email)
            if last and last != before:
                msg = self._get('/api/v1/message/' + last)
                m = re.search(r'code is:\s*(\d{6})', msg.get('Text', ''))
                if m:
                    self._seen[email] = last
                    return m.group(1)
            time.sleep(0.5)
        raise RuntimeError('No login email arrived in Mailpit for ' + mask_email(email))


# ============================================================================ browser helpers
class Browser:
    """One Playwright browser; one context (= separate login) per user."""
    def __init__(self, base, rec, otp, headed=False, slow=0):
        from playwright.sync_api import sync_playwright
        self.base, self.rec, self.otp = base, rec, otp
        self._pw = sync_playwright().start()
        try:
            self.browser = self._pw.chromium.launch(headless=not headed, slow_mo=slow)
        except Exception as e:
            self._pw.stop()
            sys.exit('Chromium did not start: ' + str(e).splitlines()[0] + '\nRun:  python -m playwright install chromium')
        self.pages = {}
        self.js_errors = []
        self.native_dialogs = []
        self.tile_status = {}
        os.makedirs(SESSION_DIR, exist_ok=True)

    def close(self):
        for name, p in list(self.pages.items()):
            try:
                self.save_session(name)
                p.context.close()
            except Exception:
                pass
        try:
            self.browser.close()
        finally:
            self._pw.stop()

    def url(self, hash_=''):
        return self.base + '/index.php' + ('#' + hash_ if hash_ else '')

    def _session_file(self, username):
        safe = re.sub(r'[^A-Za-z0-9_.-]', '_', username)
        host = re.sub(r'[^A-Za-z0-9]', '_', self.base)[-60:]
        return os.path.join(SESSION_DIR, f'{host}__{safe}.json')

    def save_session(self, username):
        p = self.pages.get(username)
        if p:
            st = p.context.storage_state()
            save_private_json(self._session_file(username), st)

    def _watch(self, page, username):
        page.on('pageerror', lambda e: self.js_errors.append(f'{username}: {e}'))
        def on_dialog(d):
            self.native_dialogs.append(f'{username}: {d.type}: {d.message}')
            d.dismiss()
        page.on('dialog', on_dialog)
        def on_response(r):
            u = r.url
            if 'api.maptiler.com/maps/' in u or 'tile.openstreetmap.org' in u:
                self.tile_status[r.status] = self.tile_status.get(r.status, 0) + 1
        page.on('response', on_response)

    def login(self, username, password, email, label=''):
        """Opens (or reuses) the signed-in screen of a user. Returns the page.
           Uses the saved session when it is still valid; otherwise password + emailed code."""
        if username in self.pages:
            return self.pages[username]
        sf = self._session_file(username)
        ctx = self.browser.new_context(viewport={'width': 1440, 'height': 900}, storage_state=sf if os.path.exists(sf) else None,
                                       accept_downloads=True)
        page = ctx.new_page()
        page.set_default_timeout(20000)
        self._watch(page, username)
        page.goto(self.url())
        page.wait_for_selector('#loginForm, #otpForm, #pageContent', timeout=30000)
        if page.locator('#pageContent').count():
            who = page.evaluate('() => App.me && App.me.user && App.me.user.username')
            if who == username:
                self.pages[username] = page
                print(f'  {username}: still signed in from the last run (no code needed).')
                return page
            page.evaluate('async () => { try { await App.logout(); } catch (e) {} }')
            page.wait_for_selector('#loginForm', timeout=15000)
        if page.locator('#otpForm').count():
            page.click('#otpBack')
            page.wait_for_selector('#loginForm')
        self.otp.before_login(email)
        page.fill('#lgU', username)
        page.fill('#lgP', password)
        page.click('#loginForm button[type=submit]')
        page.wait_for_selector('#otpForm, .auth-alert.alert-danger', timeout=30000)
        if not page.locator('#otpForm').count():
            msg = page.locator('.auth-alert').first.inner_text() if page.locator('.auth-alert').count() else 'login refused'
            ctx.close()
            raise RuntimeError(f'Login of {username} refused: {msg}')
        for attempt in range(1, 6):
            code = self.otp.code(email, username, attempt)
            if code.lower() == 'r':
                page.wait_for_function("() => !document.getElementById('otpResend').disabled", timeout=70000)
                self.otp.before_login(email)
                page.click('#otpResend')
                page.wait_for_timeout(1500)
                continue
            page.fill('#otpCode', code)
            page.click('#otpForm button[type=submit]')
            try:
                page.wait_for_selector('#pageContent', timeout=12000)
                break
            except Exception:
                if page.locator('#loginForm').count():
                    ctx.close()
                    raise RuntimeError(f'Login of {username}: the code expired or the account is locked. Run again.')
        else:
            ctx.close()
            raise RuntimeError(f'Login of {username}: no valid code after 5 tries.')
        self.pages[username] = page
        self.save_session(username)
        return page

    # ---- screen helpers
    @staticmethod
    def modal(page):
        return page.locator('.modal.show').last

    def submit_modal(self, page, wait=1500):
        m = self.modal(page)
        m.locator('button[type=submit]').click()
        page.wait_for_timeout(wait)
        err = self.modal_error(page)
        return err

    def modal_error(self, page):
        e = page.locator('.modal.show .form-error')
        try:
            if e.count() and e.last.is_visible():
                return e.last.inner_text().strip()
        except Exception:
            pass
        return ''

    @staticmethod
    def toast_text(page):
        try:
            return ' | '.join(page.locator('.app-toast').all_inner_texts())
        except Exception:
            return ''

    @staticmethod
    def close_drawer(page):
        if page.locator('.app-drawer.show').count():
            page.locator('.app-drawer.show .btn-close').click()
            page.wait_for_timeout(500)

    def go(self, page, hash_, wait=1200):
        """Opens a screen with a full reload, so it always shows fresh data from the server
           (and no drawer or dialog of the previous step is left open)."""
        page.goto('about:blank')
        page.goto(self.url(hash_))
        page.wait_for_selector('#pageBody')
        page.wait_for_function("() => !document.querySelector('#pageBody .loading-block')", timeout=20000)
        page.wait_for_timeout(wait)

    @staticmethod
    def data(page, name, **query):
        """Reads a page's data again FROM THE SERVER with this user's session (persistence check)."""
        return page.evaluate('async ([n, q]) => await App.data(n, q)', [name, query])

    @staticmethod
    def api(page, action, payload=None):
        """Read-only detail calls (e.g. Trips.details) to confirm what the screens saved."""
        return page.evaluate('async ([a, p]) => await App.api(a, p)', [action, payload or {}])

    def shot(self, page, name, full=False):
        path = os.path.join(self.rec.dir, 'screenshots', re.sub(r'[^A-Za-z0-9_.-]', '_', name) + '.png')
        try:
            page.screenshot(path=path, full_page=full)
        except Exception:
            return None
        return os.path.relpath(path, self.rec.dir)

    def print_pdf(self, page, name, trigger):
        """Runs a 'Print' button, captures the printable form exactly as the print CSS shows it, saves a PDF."""
        page.evaluate('() => { window.__printed = false; window.print = () => { window.__printed = true; }; }')
        trigger()
        page.wait_for_function('() => window.__printed === true', timeout=15000)
        page.emulate_media(media='print')
        path = os.path.join(self.rec.dir, 'printed_forms', name + '.pdf')
        page.pdf(path=path, format='A4', print_background=True)
        page.emulate_media(media='screen')
        return os.path.relpath(path, self.rec.dir)


def run_guarded(rec, item_id, objective, name, fn):
    """Runs one demonstration step; an unexpected error becomes FAILED (never hidden)."""
    try:
        return fn()
    except Exception as e:
        rec.failed(item_id, objective, name, 'error: ' + str(e).splitlines()[0][:300])
        if os.environ.get('FMS_DEBUG'):
            traceback.print_exc()
        return None
