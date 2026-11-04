# Automated System Test (tests/system_test.py)

> **TEST COPY LANG.** Huwag patakbuhin sa live na system ng kumpanya. Gumagawa ito ng test accounts,
> clients, trucks, crew, trips, funds, invoices at payroll. Lahat ay may tag na `TEST-<petsa at oras>`.

## 1. Isang beses lang: i-install ang kailangan

1. I-install ang **Python 3.9 o mas bago** (python.org). Sa installer, i-check ang **"Add python.exe to PATH"**.
2. Buksan ang PowerShell at i-run:
   ```
   pip install requests playwright
   python -m playwright install chromium
   ```

## 2. Patakbuhin

- **Pinakamadali:** i-double-click ang `tests\run_system_test.bat`.
- O sa PowerShell, sa loob ng project folder: `python tests\system_test.py`

Mga tanong ng script:

| Tanong | Sagot |
|---|---|
| Saan itetest? | `1` = XAMPP (local), `2` = Hostinger (test copy online) |
| Link ng system | XAMPP default: `http://localhost/RP_Mulawin_FMS_V2/`. Hostinger: ang link ng **test copy** |
| (Hostinger lang) I-type ang TEST | Proteksyon para hindi magamit sa live nang hindi sinasadya |
| (XAMPP lang) I-reset sa bagong EMPTY database? | `y` = buburahin ang laman ng database sa `.env` at gagawa ng bagong Admin (kailangang i-type ang `RESET`). `n` = gamitin ang kasalukuyang data |
| Admin username at password | Ang Admin account na gagamitin |
| May iba ka pang account? | `y` kung gusto mong gamitin ang sarili mong accounts kada role. `n` = gagawa ang script ng test account kada role |
| Isama ang browser click-through? | `Y` = bubuksan ang bawat page, tab at sub-tab ng bawat role, may screenshots (mga 2-3 minuto pa) |

Kapag tapos na, kusang bubukas ang report.

## 3. Ano ang tinetest

| Section | Laman |
|---|---|
| 1 Login at accounts | Admin login, paggawa ng account kada role, palit ng password sa unang login |
| 2 Security | Bawal ang data kapag walang login, maling password, 5 maling tries, CSRF, read-only ang Audit |
| 3 Master data | Clients, routes, client rates, drivers at helpers lang (PDF v6), trucks, trip pay rates |
| 4 Scenario A | Ops Head trip, fund request at approval, release, 57-item checklist, dispatch, billing draft (PDF v7), minor incident (C.1), arrival, complete, PM schedule |
| 5 Scenario B | Container request, Ops review, fund reject at revise, major damage (C.2), reschedule, double booking, Second Attempt |
| 6 Wing van | Trip at cancellation |
| 7 Maintenance | Schedules, jobs, truck status, crew availability |
| 8 Purchasing | Parts, stock adjust, issue, Not Available, approval limit (Finance o Admin), budget, PO, receive, payable |
| 9 Billing | Verify documents, finalize, return to draft, invoice, bawal ang double billing, collections, cancel invoice |
| 10 Finance | Liquidation, expenses, payables, partial payment |
| 11 Payroll | Attendance, cash advance, uniform, gross, deductions, net, finalize, reopen, submit, disburse |
| 12 Formula Settings | Fuel price at projected P&L, fund categories (bagong preset para sa bagong request lang) |
| 13 Documents at backup | Upload, bawal ang .exe, download, access per role, backup |
| 14b-14c Wika at security | English o Tagalog; limit bawat role at shift; recovery code ng Admin (sa pansamantalang test Admin); lock pagkatapos ng 5 maling password |
| 14 Access | Bawat role: lahat ng page sa menu ay bumubukas, at ang ibang pages ay bawal |
| 15 Restore | Ibinabalik ang settings na binago ng test |
| 16 Cleanup | Dine-deactivate ang test trucks at ginagawang Unavailable ang test crew |
| 17 Browser | Bawat page, tab, sub-tab, table picker at chart ng bawat role, may screenshot; bawat dashboard card (tamang page at tab); Print ng Reports; phone view |

## 4. Ang report

Nasa `tests/reports/system_test_<petsa>/report.html`:
- Result (ALL PASSED o ilan ang FAILED), at listahan ng mga FAIL sa itaas
- Accounts na ginamit (kasama ang password ng test accounts na ginawa ng script)
- Bawat section: sino ang gumawa (user at role), ano ang ginawa, inaasahan (allowed, blocked o check) at ang sagot ng system
- Screenshots kada role

Ang test accounts ay naka-save sa `tests/system_test_accounts.json` para magamit ulit sa susunod na run
(huwag i-upload ang file na ito sa Hostinger).

## 5. Paalala

- **Purchasing budget:** binabago ito ng test at ibinabalik ang amount sa dulo, pero ang "used" ay nagre-reset sa 0.
- **Limits per role:** pansamantalang "walang limit" habang tumatakbo ang test (para makagawa ng test accounts), at ibinabalik sa dulo.
  Gumagawa rin ito ng pansamantalang test Admin para sa recovery at lock test, na dine-deactivate pagkatapos.
- **Payroll (C13):** hinihintay pa ang sagot ng kumpanya kung per trip lang ang sahod ng driver. Sinusundan ng test ang
  kasalukuyang Formula Settings, kaya gagana pa rin ito kahit baguhin ang settings.
- Ang test data ay hindi binubura. Gumamit ng test copy, o i-reset ang XAMPP database pagkatapos.
- Options na walang tanong (para sa IT): `python tests\system_test.py --help`
