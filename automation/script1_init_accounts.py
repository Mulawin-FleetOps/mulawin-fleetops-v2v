#!/usr/bin/env python3
"""
automation/script1_init_accounts.py  -  SCRIPT 1: account initialization through the Admin screens

What it does (guide H):
  1. Logs in as the Admin with username + password (no emailed code).
  2. Opens User Management and, for every role in automation/config.json:
       - account missing   -> creates it with "New account" (the system generates a one-time temporary password; it is saved in .credentials.json)
       - account exists    -> checks role, email and active status; does NOT create a duplicate
  3. Reloads the user list from the server and confirms every account is really saved.
  4. Optional: logs in once as each new account to prove the login works; this performs the forced first-login password change.
  5. Writes the report in automation/reports/script1_<date>/report.html

Safe to run again and again (idempotent): existing accounts are reused, never duplicated.
Passwords are saved ONLY in automation/.credentials.json (never printed, never in the report).

Run:  python automation/script1_init_accounts.py            (asks for what it needs)
      python automation/script1_init_accounts.py --help
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fmsauto as F  # noqa: E402


def find_user(users, username):
    for u in users:
        if (u.get('username') or '').lower() == username.lower():
            return u
    return None


def user_row(page, username):
    page.locator('.table-search input').first.fill(username)
    page.wait_for_timeout(300)
    return page.locator('tbody tr').filter(has=page.locator('td:nth-child(2)', has_text=re.compile('^' + re.escape(username) + '$', re.I))).first


def main():
    ap = argparse.ArgumentParser(description='Script 1: create / check user accounts through the Admin screens (login is username + password; new accounts get a one-time temporary password).')
    ap.add_argument('--headed', action='store_true', help='Show the browser window while it works')
    ap.add_argument('--slow', type=int, default=0, help='Slow down each browser action (milliseconds), useful with --headed')
    ap.add_argument('--verify-logins', choices=['ask', 'yes', 'no'], default='ask', help='Log in once as each NEW account (this also performs the forced first-login password change)')
    ap.add_argument('--set-missing-passwords', action='store_true',
                    help='For accounts that exist but whose password is not in .credentials.json: set a new password through the Admin screen')
    args = ap.parse_args()

    cfg = F.load_config()
    base = cfg['base_url']
    creds = F.Credentials()
    rec = F.Recorder('Script 1 - Account initialization', 'script1')
    rec.context.update({'System link': base, 'Login': 'username + password; temporary passwords are replaced at first login'})

    admin_user = cfg.get('admin_username') or 'admin'
    admin_email = cfg.get('admin_email') or ''
    admin_pw = creds.ask(base, admin_user, 'the Admin')
    br = F.Browser(base, rec, creds, headed=args.headed, slow=args.slow)
    created = []
    try:
        rec.set_section('Admin login (username + password)')
        try:
            page = br.login(admin_user, admin_pw, admin_email, 'Admin')
        except Exception as e:
            rec.failed('S1-01', '4.1', 'Admin logs in with username and password', str(e))
            return finish(rec, br)
        role = page.evaluate('() => App.me.user.role')
        rec.check('S1-01', '4.1', 'Admin logs in with username and password', role == 'admin',
                  'signed in as ' + admin_user,
                  'signed in but the role is ' + str(role), [br.shot(page, 's1_01_admin_dashboard')])

        rec.set_section('Accounts in User Management')
        br.go(page, 'admin')
        data = br.data(page, 'admin')
        users = data.get('users', [])
        n = 1
        for role_key, acc in cfg['accounts'].items():
            n += 1
            item = f'S1-{n:02d}'
            label = F.ROLE_LABEL.get(role_key, role_key)
            username, email, full = acc.get('username', '').strip(), acc.get('email', '').strip(), acc.get('full_name', '').strip()
            if not username or not email or not full:
                rec.skipped(item, '4.1', f'{label} account', 'username, full_name or email missing in config.json')
                continue
            if role_key not in F.ROLE_LABEL or role_key == 'admin':
                rec.skipped(item, '4.1', f'{label} account', f'unknown role "{role_key}" in config.json')
                continue
            u = find_user(users, username)
            if u:
                problems = []
                if u.get('role') != role_key:
                    problems.append(f"role is {u.get('role')} (config says {role_key})")
                if (u.get('email') or '').lower() != email.lower():
                    problems.append('email differs from config.json')
                if not int(u.get('active') or 0):
                    br.go(page, 'admin')
                    row = user_row(page, username)
                    row.locator('button[data-act=toggle]').click()
                    page.wait_for_timeout(500)
                    br.submit_modal(page)
                    problems.append('was inactive - activated now')
                if not creds.get(base, username):
                    if args.set_missing_passwords:
                        br.go(page, 'admin')
                        row = user_row(page, username)
                        row.locator('button[data-act=pw]').click()
                        page.wait_for_timeout(500)
                        err = br.submit_modal(page)
                        if err:
                            rec.failed(item, '4.1', f'{label} account "{username}"', 'password reset refused: ' + err)
                            continue
                        pw = br.read_temp_password(page)     # shown once by the system; the user must change it at first login
                        creds.set(base, username, pw)
                        problems.append('temporary password saved in .credentials.json (replaced at first login)')
                    else:
                        problems.append('password not in .credentials.json (run with --set-missing-passwords to set one)')
                fatal = [p for p in problems if p.startswith('role is')]
                detail = 'already existed - not created again' + ('; ' + '; '.join(problems) if problems else '')
                if fatal:
                    rec.failed(item, '4.1', f'{label} account "{username}"', detail + '. Fix the role in User Management or change config.json.')
                else:
                    rec.passed(item, '4.1', f'{label} account "{username}" ready', detail)
                continue
            # --- create through the "New account" form
            br.go(page, 'admin')
            page.locator('[data-adduser]').click()
            page.wait_for_timeout(500)
            m = br.modal(page)
            m.locator('[name=full_name]').fill(full)
            m.locator('[name=username]').fill(username)
            m.locator('[name=email]').fill(email)
            m.locator('[name=role]').select_option(role_key)
            if 'dispatcher' in role_key:
                m.locator('[name=shift]').select_option(acc.get('shift', 'Day'))
            ev = br.shot(page, f's1_{n:02d}_new_{role_key}_form')
            err = br.submit_modal(page)
            if err:
                rec.failed(item, '4.1', f'Create {label} account "{username}"', 'form refused: ' + err, [ev])
                br.modal(page).locator('[data-bs-dismiss=modal]').first.click()
                continue
            pw = br.read_temp_password(page)       # shown once by the system (the screenshot above was taken before saving)
            creds.set(base, username, pw)          # temporary until the account's first login
            # persistence: read the list again from the server
            users = br.data(page, 'admin').get('users', [])
            u = find_user(users, username)
            ok = bool(u) and u.get('role') == role_key and (u.get('email') or '').lower() == email.lower() and int(u.get('active') or 0) == 1
            rec.check(item, '4.1', f'Create {label} account "{username}"', ok, f'saved; email {F.mask_email(email)}; temporary password in .credentials.json',
                      'not found with the right role/email after reloading', [ev, br.shot(page, f's1_{n:02d}_saved_{role_key}')])
            if ok:
                created.append((role_key, username, email))

        users = br.data(page, 'admin').get('users', [])
        missing = [a['username'] for a in cfg['accounts'].values() if a.get('username') and not find_user(users, a['username'])]
        rec.check('S1-90', '4.1', 'Every account in config.json exists in the system (reloaded from the server)', not missing,
                  f'{len(cfg["accounts"])} accounts present', 'missing: ' + ', '.join(missing))
        dup = {}
        for u in users:
            dup[u['username'].lower()] = dup.get(u['username'].lower(), 0) + 1
        rec.check('S1-91', '4.1', 'No duplicate accounts', all(v == 1 for v in dup.values()), 'every username appears once', 'duplicates found')
        br.go(page, 'admin')
        rec.add('S1-92', '4.1', 'User Management screenshot', F.PASSED, 'list after initialization', [br.shot(page, 's1_92_user_management', full=True)])

        # --- optional: log in as each new account
        verify = args.verify_logins
        if verify == 'ask' and created:
            verify = 'yes' if input(f'\nLog in once as each of the {len(created)} new account(s) to prove it works? This also does the forced first-login password change. (y/N): ').strip().lower() == 'y' else 'no'
        rec.set_section('Login check of new accounts')
        for i, (role_key, username, email) in enumerate(created, start=1):
            item = f'S1-L{i:02d}'
            if verify != 'yes':
                rec.skipped(item, '4.1', f'Login as new {F.ROLE_LABEL[role_key]} "{username}"', 'not requested (use --verify-logins yes)')
                continue
            try:
                p = br.login(username, creds.get(base, username), email)
                r = p.evaluate('() => App.me.user.role')
                rec.check(item, '4.1', f'Login as new {F.ROLE_LABEL[role_key]} "{username}" (first login: temporary password replaced)', r == role_key,
                          'signed in; screens follow the role', 'wrong role ' + str(r), [br.shot(p, f's1_login_{role_key}')])
            except Exception as e:
                rec.failed(item, '4.1', f'Login as new {F.ROLE_LABEL[role_key]} "{username}"', str(e))
        if not created:
            rec.note('No new accounts were needed this run.')
    finally:
        pass
    return finish(rec, br)


def finish(rec, br):
    if br.native_dialogs:
        rec.failed('S1-99', '-', 'No browser alert/confirm/prompt dialogs', '; '.join(br.native_dialogs)[:300])
    if br.js_errors:
        rec.failed('S1-98', '-', 'No JavaScript errors on the screens', '; '.join(br.js_errors)[:300])
    br.close()
    path = rec.write()
    c = rec.counts()
    print(f'\nPASSED {c[F.PASSED]}  FAILED {c[F.FAILED]}  SKIPPED {c[F.SKIPPED]}')
    print('Report: ' + path)
    print('Passwords of the accounts: automation/.credentials.json (keep it private; give each person only their own).')
    return 0 if c[F.FAILED] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
