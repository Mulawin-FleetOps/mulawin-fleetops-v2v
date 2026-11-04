# User Guide: Admin at Audit

Nov 1, 2026 · @kenneth

Para sa **Administration** group (Users, Formula Settings, Activity Log, Backup) at sa Audit role na tumitingin lang.

## 1. Pag-login at ano ang makikita

### Pag-login

1. Buksan ang link ng system sa browser.
2. Ilagay ang **Username** at **Password**, tapos **Sign in**.
3. Kung bago ang account o na-reset ang password, papalitan muna ito bago makapasok. Kailangan may letra at numero.
4. Para mag-logout, i-click ang pangalan sa kanang itaas, tapos **Logout**.

&#91;image: Login page\]

### Paano mag-navigate

- Isang sidebar group lang ang bukas bawat oras. Kusang bubukas ang group ng page na binuksan mo.
- Nakadikit sa itaas ang pangalan ng page at ang mga button habang nag-i-scroll.
- Sa mahabang page, pindutin ang bilog na arrow sa kanang ibaba para bumalik sa itaas.
- Ang malalaking page ay nahahati sa tabs, at ang ilang tab ay may maliliit na pills sa loob. Naaalala ang huling tab na binuksan mo.
- Bawat table ay 25 rows bawat page. Gamitin ang **Prev** at **Next** sa ibaba. Ang Search at CSV ay sakop ang lahat ng rows, hindi lang ang nakikita.
- Sa Dashboard: 2 charts muna (pindutin ang **Show more chart(s)** para sa iba), at ang mga table ay nasa iisang card. Pindutin ang pangalan ng table para makita ito; ang walang laman ay nakalista sa isang linya sa ibaba.
- Sa **Reports & Analytics**, may tab bawat section (Trips, Fleet, Money, Payroll, Stock ayon sa role). Ang Period at Group by lang ang laging kita; ang ibang filters ay nasa **More filters**.

### Admin (Head Management)

Ang **Management Dashboard** ang unang lalabas. Ito ang buod ng buong kumpanya ngayong buwan.

&#91;image: Management dashboard ng Admin\]

| Bahagi | Ibig sabihin |
| --- | --- |
| Alerts sa itaas | Delivery requests na Pending Review, trips na On Hold dahil sa incident, at purchase requests na lampas ₱10,000 na **ikaw** ang mag-a-approve. May **Open** para pumunta agad. |
| Trips this month, Completed, Ongoing, Pending / scheduled | Bilang ng trips |
| Available trucks, Under maintenance | Lagay ng fleet ngayon |
| Billed, Collected, Outstanding receivables, Expenses | Pera ngayong buwan |
| Charts | Completed trips bawat buwan, billed vs collected vs expenses, trips ayon sa truck type at client, fleet availability, expenses ayon sa category. Ituro ang mouse sa chart para makita ang eksaktong halaga (may ₱ ang pera) at ang porsyento sa bilog na chart. Iisa ang kulay ng bawat kahulugan sa lahat ng chart (halimbawa berde ang Collected at Available, pula ang Expenses at Under Maintenance). |
| Tables | Trucks under maintenance, mga dokumentong mag-e-expire, cash flow ng huling 6 na buwan |

Nakikita ng Admin ang **lahat ng pahina** sa sidebar. Pero may mga gawain na para lang sa ibang role (halimbawa, dispatch ng dispatcher, release ng Finance, invoice ng Billing). Sa mga pahinang iyon, tingin lang ang Admin.

### Audit

Ang **Audit Dashboard** ang unang lalabas. Tingin lang (read-only) ang lahat.

| Card o table | Ibig sabihin |
| --- | --- |
| Fund requests, Released allowances | Bilang ng fund requests at kabuuang na-release |
| Invoices, Collections | Mga invoice at nakolektang bayad |
| Expenses, Disbursements | Lahat ng gastos at perang lumabas |
| Latest financial activity and approvals | Huling 25 na galaw sa Finance, Billing, Purchasing at Payroll |

**Sidebar ng Audit:** Trip & Dispatch > Trip Records & Waybills; Maintenance & Inspection > Purchasing; Financial & Billing > Trip Funds & Allowances, Finance & Payables, Billing & Collections; Payroll & Timekeeping > Payroll, Cash Advance & Balances; Records > Documents; Reports & Administration > Reports & Analytics, Formula Settings, Activity Log.

## 2. Admin: User Accounts

Punta sa **Reports & Administration > User Accounts**. Admin lang ang may pahinang ito.

&#91;image: User Accounts\]

Makikita ang listahan ng accounts: Username, Full name, Role, Shift, Active, Must change password, Last login at Created.

**Wika ng screen:** bawat user ang pumipili ng **English** o **Tagalog** sa dropdown ng pangalan niya (kanang itaas, kung nasaan ang Log Out). English ang default at naka-save ito sa account. Sa Tagalog, nananatiling English ang mga pangalan ng page, mga status at termino ng PDF at Excel, at ang mga printout.

### Mga role

| Role | Department |
| --- | --- |
| Operations Head, Car Carrier Dispatcher, Container / Wing Van Dispatcher | Operations |
| Motorpool Custodian, Purchasing Officer | Maintenance |
| Finance, Billing and Collection, Payroll | Accounting |
| Admin (Head Management), Audit | Administration |

### A. Gumawa ng account

1. Pindutin ang **Create account**.
2. Ilagay ang **Username** (3 hanggang 70 na letra, numero, tuldok, dash o underscore).
3. Ilagay ang **Temporary password** (may letra at numero, at sapat ang haba).
4. Ilagay ang **Full name** at piliin ang **Role**.
5. Kung dispatcher, piliin ang **Shift** (Day o Night).
6. **Save**. Ibigay ang username at temporary password sa tao. Papalitan niya ito sa unang login.

### B. I-edit ang account

1. Pindutin ang **Edit** sa linya ng tao.
2. Baguhin ang Full name, Role o Shift. Hindi na mababago ang username.
3. **Save**.

### C. Reset password

1. Pindutin ang **Reset password**.
2. Ilagay ang **New temporary password**, tapos **Save**.
3. Sa susunod na login, papalitan ito ng tao.

### D. Deactivate o Activate

1. Pindutin ang **Deactivate** para hindi na makapag-login ang tao (halimbawa, umalis na sa trabaho).
2. Pindutin ang **Activate** para ibalik.
3. Hindi mo pwedeng i-deactivate ang sarili mong account, at kailangan may kahit isang active na Admin.

Lahat ng ito ay nakatala sa Activity Log (area na **Access**).

## 3. Admin: Approvals, master data at Formula Settings

### A. Approve ng purchase request na lampas ₱10,000

Kapag lampas sa approval limit ang purchase request, ikaw ang mag-a-approve. Lalabas ito bilang alert sa Dashboard at sa notification bell.

1. Pindutin ang **Open** sa alert, o punta sa **Maintenance & Inspection > Purchasing**.
2. Hanapin ang request na ang Approver ay Admin, tapos **Approve / reject**.
3. Basahin ang halaga at ang **Budget remaining**.
4. Piliin ang **Decision**:
   1. **Approve**: titingnan ng system ang Purchasing budget. Kung kulang, kusang mare-reject ito (Rejected - Insufficient Budget).
   2. **Reject**: kailangan may **Notes / reason**.
5. **Save**. Makakatanggap ng notification ang Purchasing Officer.

Ang ₱10,000 pababa ay Finance ang nag-a-approve.

### B. Mga trucks at tao (Admin lang)

1. **Fleet Management > Fleet Status & Trucks**, tapos **Add truck**. Ilagay ang Plate number, Truck / unit no., Truck type, Make / brand, Model, Engine at Chassis no., OR/CR at MV file no., registration at insurance, at Current odometer. **Save**.
2. **Fleet Management > Drivers & Helpers**, tapos **Add driver / helper**. Ilagay ang Full name, ID no., Position (Driver o Helper), Contact number, Date hired at License expiry (required sa driver). Drivers at helpers lang ang nasa system (PDF v6). Kapag hindi na pwedeng gamitin ang tao, gawing Unavailable. **Save**.
3. **Edit** para baguhin ang detalye. Sa mga tao, may **Pay info** din (daily rate, pay frequency, payroll group).

Pwede ring mag-dagdag ang Admin ng clients, routes at rates sa **Financial & Billing > Clients, Routes & Rates**.

### C. Formula Settings

Punta sa **Reports & Administration > Formula Settings**. Dito binabago ang mga numero ng computation nang hindi ginagalaw ang code. Ang bagong value ay gagamitin sa mga bagong record; ang lumang record ay mananatili sa lumang value.

&#91;image: Formula Settings\]

**Para sa isang numero:**

1. Buksan ang tab na Values at piliin ang group (pills sa ilalim ng tabs). Mauuna ang groups na kaya mong baguhin; ang hindi ay nasa pill na View only.
2. Palitan ang numero, tapos **Save**.
3. Para ibalik sa default, pindutin ang **Reset**.

| Group | Setting | Default |
| --- | --- | --- |
| Approvals | Purchase request approval limit | ₱10,000 |
| Fuel (projected P&L) | Km per liter; diesel price per liter | 4 km/L; ₱100 |
| Car Carrier | Default units per trip | 5 |
| Maintenance | Preventive maintenance every (km); auto Under Maintenance kapag due | 10,000 km; 1 (oo) |
| Inspection | Minimum checklist duration | 15 minuto |
| Reminders | Paalala bago mag-expire ang documents at licenses | 30 araw |
| Billing | Default payment terms | 30 araw |
| Payroll | Bilangin lang ang trips na may waybill | 1 (oo) |
| Auto-assignment | Fair rotation look-back | 30 araw |

**Para sa mga listahan (Computation lists):** Fund request categories, Projected P&L expenses per trip, Payroll additional earnings at Payroll deductions.

1. Buksan ang tab na Computation lists at piliin ang listahan. Baguhin ang Name, Computation, Amount, Divisor, Only if with attendance, Balance type, Active o Source.
2. **Add line** para magdagdag, **✕** para tanggalin.
3. **Save list**. Para ibalik sa orihinal, pindutin ang reset ng listahan.
4. Buksan ang tab na Example, ang **Example with the current values,** para makita agad ang epekto.

Admin ang pwedeng magbago ng lahat. Ang Finance ay sa Fuel, Billing, fund categories at P&L expenses. Ang Payroll ay sa Payroll group, earnings at deductions. Lahat ng pagbabago ay nakatala sa Activity Log.

## 4. Admin: Backup, Documents at Reports

### A. Gumawa ng backup

1. Punta sa **Reports & Administration > Backup**.
2. Pindutin ang **Create backup**. Gagawa ang system ng kopya ng buong database (.sql file) at kusang ida-download ito.
3. Itago ang file sa labas ng server (USB o cloud).
4. Kopyahin din ang folder na `storage/private`, dahil nandoon ang mga na-upload na documents.
5. Sa table na **Backups on the server**, pwedeng i-**Download** ulit ang mga lumang backup.

### B. Mag-restore

1. Sa phpMyAdmin, gumawa ng **bagong walang lamang database**.
2. Piliin ito, tapos **Import** ang .sql file.
3. Ilagay ang pangalan ng database na iyon sa `.env` file ng system.
4. Ibalik ang laman ng `storage/private`.

### C. Documents

**Records > Documents**. Dito naka-upload ang mga dokumento ng trucks, tao at trips (OR/CR, insurance, license, waybill at iba pa). Makikita rin dito kung alin ang malapit nang mag-expire, na lumalabas din sa Dashboard.

### D. Reports & Analytics

**Reports & Administration > Reports & Analytics**. Dito ang mga report at chart ng trips, fleet, maintenance, pera at payroll. Lahat ng table ay may **Search** at **CSV** para ma-download. Sa itaas ng tabs nakasulat ang period at filters na ginagamit. Ang Print ay may dalawang pagpipilian: Print this section o Print all sections. Kasama sa print ang pangalan ng kumpanya, period, filters, kung sino ang nag-print, cards, charts at buong tables.

## 5. Audit: ano ang gagawin

Ang Audit ay **tumitingin lang**. Walang button na magbabago ng record. Ang trabaho ay i-check kung tama at kumpleto ang mga transaksyon at approval.

&#91;image: Audit dashboard\]

### A. Silipin ang dashboard

1. Pagka-login, tingnan ang mga card: Fund requests, Released allowances, Invoices, Collections, Expenses at Disbursements.
2. I-click ang card na may maliit na arrow sa kanang itaas para buksan ang mismong listahan o tab sa likod ng numero.
3. Sa **Latest financial activity and approvals**, makikita ang huling 25 na galaw. Pindutin ang **open** para sa buong Activity Log.

### B. Activity Log

1. Punta sa **Reports & Administration > Activity Log**.
2. Piliin ang **From** at **To** (default: huling 30 araw).
3. Piliin ang **Area** (Finance, Billing, Purchasing, Payroll, Documents o Operations), o iwanang All.
4. Mag-type sa **Search** (halimbawa, trip number o PR number), tapos **Show**.
5. Makikita ang When, By, Role, Area, Record, Action at Details ng bawat galaw.
6. Pindutin ang **CSV** para ma-download.

&#91;image: Activity Log\]

Ang Admin ay nakikita ang lahat ng area, kasama ang Access (login, accounts). Ang Audit ay ang mga area na nakalista sa itaas lang.

### C. Mga pahinang pwedeng suriin

| Pahina | Ano ang i-check |
| --- | --- |
| Trip Funds & Allowances | Sino ang nag-request, nag-approve at nag-release, at ang liquidation |
| Finance & Payables | Payables, disbursements, expenses at budgets |
| Billing & Collections | Invoices at mga bayad ng clients |
| Purchasing | Purchase requests, sino ang nag-approve, at purchase orders |
| Payroll at Cash Advance & Balances | Payroll periods, payslips at balances ng empleyado |
| Trip Records & Waybills | Completed trips at waybills |
| Formula Settings | Mga numerong ginagamit sa computation (tingin lang) |
| Reports & Analytics at Documents | Reports at mga naka-upload na dokumento |

## 6. Mga karaniwang mensahe at tanong

| Mensahe | Ibig sabihin at gagawin |
| --- | --- |
| Too many wrong tries. Please wait 15 minutes. | 5 beses nang mali ang password. Maghintay ng 15 minuto, o i-reset ng Admin ang password. |
| Username already exists. | Gumamit ng ibang username. |
| Password must have at least 8 characters. / Password must have letters and numbers. | Gawing 8 o higit pa ang haba at lagyan ng letra at numero. |
| You cannot remove your own Admin role. | Hindi mo pwedeng tanggalin ang sarili mong Admin role. |
| You cannot deactivate your own account. | Ibang Admin ang dapat mag-deactivate. |
| Keep at least one active Admin. | Kailangan may isa pang active na Admin bago i-deactivate ito. |
| This amount must be approved by Finance. | ₱10,000 pababa ang halaga kaya Finance ang mag-a-approve. |
| Finance has not set an active Purchasing budget yet. | Kailangan munang mag-set ng Finance ng Purchasing budget sa Finance > Budgets. |
| Please give a reason. | Kapag Reject, lagyan ng dahilan. |
| Your role is not allowed to do this. | Ang gawain ay para sa ibang role. |

### Mga tanong

**Nakalimutan ng user ang password.** Sa User Accounts, pindutin ang **Reset password**, maglagay ng temporary password, at ibigay sa user.

**Umalis na ang empleyado.** **Deactivate** ang account. Hindi nabubura ang mga record niya, kaya buo pa rin ang Activity Log.

**Bakit hindi ko ma-edit ang isang setting?** Kung naka-gray at may "View only for your role", ibang role ang may hawak nito. Ang Admin ang pwedeng magbago ng lahat.

**Bakit hindi makapag-Release o makapag-Dispatch ang Admin?** Ang mga iyon ay para sa Finance at dispatcher ayon sa workflow. Ang Admin ay tumitingin at nag-a-approve ng purchase na lampas sa limit.

**Saan ko makikita kung sino ang nagbago ng record?** Sa **Activity Log**, i-search ang record number.
