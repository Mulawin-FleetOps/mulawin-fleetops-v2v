# Pending company confirmation

Rule: the FMS PDF is followed first. When the PDF gives no exact rule, the system uses a **working default**
(from the repo or the company Excel files), marks it in the code with `TODO PENDING COMPANY CONFIRMATION`,
and, where possible, makes it editable in **Formula Settings** so no code change is needed later.

| ID | Question for the company | Source | What the system does now | Where to change |
|---|---|---|---|---|
| C01 | Priority rule of the automatic truck / driver / helper assignment | PDF pp.16-17 (system assigns, no rule given) | Same truck type, no open repair, not booked that day; prefers trucks that will not hit the PM limit, then fewest trips in the last 30 days; truck's regular driver/helper first; drivers need a valid license; car carrier gets a 2nd driver if free; container/wing van need a helper. Ops Head can override with a reason. | `Trips::autoAssign`, setting `auto_assign_lookback_days` |
| C02 | ~~Exact trip allowance formula and rates~~ **ANSWERED** by FMS PDF v2 | PDF v2 Scenario B step 4 | Dispatcher picks preset categories: Forklift Operator ₱100, Checker ₱100, Passway ₱200, Driver Meal Allowance ₱300, Helper Meal Allowance ₱200, and may add other categories. Fuel and toll were removed from the fund (company instruction). | Formula Settings > Fund request categories |
| C03 | ~~Order of Finance release and Ops Head clearance~~ **ANSWERED** by FMS PDF v2 | PDF v2 Scenario A steps 5-8, B steps 6-9 | No more Ops Head departure clearance. Finance may release before the checklist. Confirm Dispatch is enabled only when fund = Released and trip = Ready for Dispatch. | `Trips::dispatch` |
| C04 | ~~Is the ₱15,000 limit for trip funds only?~~ **ANSWERED** | Company instruction; PDF v2 | The ₱15,000 fund limit was removed. The Operations Head approves every fund request. The ₱10,000 purchase limit stays. | — |
| C05 | Budget periods and how budgets are increased | PDF p.17 | Finance sets one active budget per category; a new one closes the old. Purchases are checked against the active Purchasing budget. | Finance > Budgets |
| C06 | Allowed NOT OK items, signatures, 15-minute minimum | PDF p.6, checklist scans | All 57 items required; any NOT OK on departure blocks "Ready for Dispatch"; arrival NOT OK creates a repair job. Minimum 15 min (0 = off). Typed names are not legal signatures. | Setting `inspection_min_minutes` |
| C07 | 2nd attempt: new allowance? new approval? | PDF v2 Scenario C.2 ("fund requirements, kung applicable") | Dispatcher reschedules (new schedule), does the pre-dispatch checklist again, then Confirm Redispatch records the Second Attempt on the same trip. A new fund request is optional; if one is submitted it must be Released before redispatch. | `Trips::reschedule`, `Trips::dispatch` |
| C08 | PM interval and reset per maintenance type | PDF p.18 ("for example 10,000 km") | 10,000 km (editable). Completing a Preventive Maintenance job resets the km counter. Auto-hold of the truck can be turned off. | Settings `pm_interval_km`, `pm_auto_hold` |
| C09 | Car carrier units rule | Monitoring workbooks | Default 5 units per trip (TRIPS & DAMAGES `=O*5`), editable per trip. | Setting `units_per_trip` |
| C10 | Billing: tax treatment, official invoice layout, payment-term start | PDF p.6, repo Q15 | Rate card suggests the amount; Billing enters/edits the final rate. Due date = invoice date + client terms (default 30 days). No VAT computation. | Billing; setting `default_payment_terms_days` |
| C11 | Partial deliveries and returns of parts | PDF p.17 | Receipt must match the ordered quantity. | `Purchasing::receive` |
| C12 | Document retention and reminder schedule | PDF pp.8-9 | Reminders 30 days before expiry (documents, OR/CR registration, insurance, licenses). | Settings `document_alert_days`, `license_alert_days` |
| C13 | Full access matrix | PDF pp.1-3 | Role pages in `backend/Core/Access.php`; Audit is read-only on financial records. | `Access.php` |
| C14 | Payroll rules: trip pay per destination, which deductions are fixed, VL/SIL pay | DRIVERS PAYROLL.xlsx | Formulas copied from the 2026 sheets (SSS = 775/24 × days, PhilHealth 75, Pag-IBIG 50, cash bond 500 if with attendance; gross = wage + trip pay + earnings). Only "Present" days are paid, like the sheet. Every value is editable per line while Draft. | Formula Settings > payroll lists; Payroll > Trip pay rates |
| C15 | The PDF section "FINANCE MODULE: Billing and Account Receivable" on page 18 is empty | PDF p.18 | Section II.H (Billing and AR) is used instead. | — |
| C16 | Hosting (Hostinger) plan, PHP version, upload limits, cron | User instruction | Tested on Apache + PHP 8.3 + MariaDB locally only. See HOSTINGER_PREPARATION.md. | — |

Follow-up format: `ID → approved rule → approving person → effective date`. Change the setting (Formula Settings) or the
function named above; old records keep the values they were made with.

## Mga bagong tanong mula sa FMS PDF v2

| ID | Question for the company | Source | What the system does now | Where to change |
|---|---|---|---|---|
| C17 | Scenario B: pwede bang i-reject ng Ops Head ang delivery request? | PDF v2 Scenario B step 3 (review and confirm only) | Kept from the previous system: Ops Head may confirm or reject (with reason). | `Trips::review` |
| C18 | Container / Wing Van client steps: kailan dapat tapos? | Dating PDF II.E; PDF v2 dispatch validation has 2 conditions only | Client steps (booking/pre-advice or client confirmation/truck details) are required before the pre-dispatch checklist, so dispatch validation stays at 2 conditions. | `Trips::mustHaveClientSteps` |
| C19 | Liquidation of the released fund | PDF v2 does not mention it | Kept from the previous system: Finance records actual spent and returned cash. | `Funds::liquidate` |

| C20 | Ano ang gagawin kapag walang bakanteng truck o crew sa auto-assign? | PDF v2 says the system assigns automatically | Kept from the previous system: trip becomes "Awaiting Resources"; Ops Head or dispatcher can "Try auto-assign again", or Ops Head assigns manually. | `Trips::approveAndAssign` |
| C13 | Payroll ng drivers at helpers: per biyahe lang ba, o may attendance (daily rate) at deductions pa? | Interview sa Operations Head (per biyahe) vs FMS PDF v6 II.J (attendance, deductions) | Sinusunod ang PDF v6: regular wage (daily rate × Present days) + trip pay + deductions. Para sa drivers at helpers lang ang payroll. | Kung per biyahe lang: Daily rate = 0 sa Pay info. Kung walang deductions: Formula Settings > Computation lists > Payroll deductions, i-uncheck ang Active. Iba pang patakaran: `Payroll::computeLine` |
| C14 | Ano ang "required documents" bago ma-finalize ang billing? | FMS PDF v7, Billing and Collection step | Waybill ang required (Billing role: "Attach supporting documents, including waybills"). Billing ang nagve-verify (Verify documents), tapos Finalize kapag Completed na ang trip. | `Billing::draftVerify` |
