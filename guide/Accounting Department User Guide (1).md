# Accounting Department User Guide

Nov 1, 2026 · @kenneth

Para sa Finance, Billing at Payroll ang gabay na ito. Lahat ng pera ng system ay dumadaan dito: trip funds, gastos, bayarin, invoice at sahod.

## 1. Pag-login at mga bahagi ng screen

1. Buksan ang address ng system na binigay ng Admin.
2. Ilagay ang **Username** at **Password**, tapos **Login**.
3. Sa unang login (o kung na-reset), papalitan mo muna ang password. Minimum 8 characters.

&#91;image: Login screen\]

| Bahagi | Gamit |
| --- | --- |
| Sidebar (kaliwa) | Mga page na pwede sa role mo. Pindutin ang grupo para makita ang laman |
| Bell (kanang itaas) | Mga abiso, gaya ng fund na Ready for Release, trip na handa nang i-bill, o payroll na ipinasa sa Finance |
| Pangalan mo (kanang itaas) | Wika ng screen (English o Tagalog, naka-save sa account mo), Change password at Log out |
| Summary cards | Bilang at halaga ng mahahalagang bagay. Ang card na may maliit na arrow ay pwedeng i-click: bubukas ang mismong listahan o tab sa likod ng numero |
| Charts | Ituro ang mouse sa chart para makita ang eksaktong halaga (may ₱ ang pera) at ang porsyento sa bilog na chart. Iisa ang kulay ng bawat kahulugan sa lahat ng chart |
| Tables | May Search, CSV download (pwedeng buksan sa Excel), at Prev / Next (25 rows bawat page) |
| Print | Sa invoice, payment voucher, payslip, deduction form, at Reports & Analytics (Print this section o Print all sections) |

Kapag 5 beses kang nagkamali ng password sa loob ng 15 minuto, maghihintay ka ng 15 minuto. Kapag 60 minuto kang walang ginawa, mala-log out ka.

### Paano mag-navigate

- Isang sidebar group lang ang bukas bawat oras. Kusang bubukas ang group ng page na binuksan mo.
- Nakadikit sa itaas ang pangalan ng page at ang mga button habang nag-i-scroll.
- Sa mahabang page, pindutin ang bilog na arrow sa kanang ibaba para bumalik sa itaas.
- Ang malalaking page ay nahahati sa tabs, at ang ilang tab ay may maliliit na pills sa loob. Naaalala ang huling tab na binuksan mo.
- Bawat table ay 25 rows bawat page. Gamitin ang **Prev** at **Next** sa ibaba. Ang Search at CSV ay sakop ang lahat ng rows, hindi lang ang nakikita.
- Sa Dashboard: 2 charts muna (pindutin ang **Show more chart(s)** para sa iba), at ang mga table ay nasa iisang card. Pindutin ang pangalan ng table para makita ito; ang walang laman ay nakalista sa isang linya sa ibaba.
- Sa **Finance & Payables**, naka-grupo ang tabs: **Gastos at Bayarin** (Expenses, Accounts payable, Disbursements and cheques, Payment vouchers), **Empleyado** (Cash advances, Payroll disbursement) at **Plano** (Budgets, Cash flow).

## 2. Finance

### Ano ang makikita pagkapasok

Pagka-login, ang **Finance Dashboard** ang lalabas. Ang mga alert sa itaas ay nagsasabi kung may fund na Ready for Release, purchase request na kailangan mong aprubahan, o payroll na hinihintay ang disbursement.

&#91;image: Finance dashboard\]

| Card | Ibig sabihin |
| --- | --- |
| Pending fund requests (Ops Head) | Funds na hinihintay pa ang Operations Head |
| Ready for release | Funds na pwede mo nang i-release, at ang kabuuang halaga |
| Allowances released this month | Kabuuang na-release ngayong buwan |
| Accounts payable balance | Hindi pa nababayarang bills, at ilan ang due sa loob ng 7 araw |
| Expenses / Disbursements this month | Gastos at perang lumabas ngayong buwan |
| Cash advances outstanding | Natitirang utang ng mga empleyado |
| Allowances not yet liquidated | Funds na hindi pa na-liquidate |
| Cash flow chart | Cash in (collections) vs cash out (disbursements) sa 6 na buwan |

**Sidebar ng Finance (Dashboard sa itaas, at 10 pa):** Maintenance & Inspection > Parts Inventory (tingin lang) at **Purchasing**; Financial & Billing > **Trip Funds & Allowances**, **Finance & Payables**, Clients, Routes & Rates (tingin lang); Payroll & Timekeeping > **Payroll** at Cash Advance & Balances (tingin lang); Records > **Documents**; Reports & Administration > **Reports & Analytics** at **Formula Settings**.

### A. I-release ang trip fund

1. **Financial & Billing > Trip Funds & Allowances**. Hanapin ang fund na **Ready for Release** (naaprubahan na ng Operations Head).
2. Pindutin ang **Breakdown** para makita ang categories at halaga.
3. Ibigay ang pera, tapos pindutin ang **Confirm release**.
4. Ilagay ang **Payment method**, **Date released**, **Reference no.**, at **Cheque no.** at **Bank** kung cheque. **Confirm release**.
5. Magiging **Released** ang fund. Kusang gagawa ang system ng payment voucher, disbursement at Trip Allowance expense. Pwede itong gawin kahit hindi pa tapos ang checklist ng dispatcher.

&#91;image: Trip Funds page ng Finance\]

&#91;image: Confirm release form\]

### B. Liquidation pagbalik ng crew

1. Sa Trip Funds, hanapin ang fund na **Completed** o **Released** na **Not Liquidated**.
2. Pindutin ang **Liquidate**, ilagay ang **Actual amount spent** at notes, tapos **Save**.
3. Itatala ng system ang ibinalik na pera, at magiging actual na gastos ang expense. Hindi pwedeng lumagpas sa na-release; ang sobra ay itala bilang Expense.

### C. Finance & Payables: ang Record button

Sa **Financial & Billing > Finance & Payables**, pindutin ang **Record** sa itaas:

| Piliin | Mga ilalagay | Resulta |
| --- | --- | --- |
| Expense | Category, Amount, Date, Payee, OR / reference no., Trip o Truck kung para doon, Description, at **Paid now** kung bayad na | Expense; kung Paid now, may disbursement at voucher agad |
| Account payable | Supplier o Other payee, Description, Amount, Invoice / reference no., Due date | Bayarin na lalabas sa tab na Accounts payable |
| Cash advance (employee) | Employee, Amount, Deduct per payroll, Purpose, at payment details | Cash advance na kusang ibabawas sa payroll |
| Budget | Budget for (Purchasing, Operations, Maintenance), Amount, Period start at end | Budget; ang Purchasing budget ang sinusuri bago ma-approve ang pagbili |

&#91;image: Finance & Payables page\]

### D. Magbayad ng payable

1. Tab na Gastos at Bayarin, pill na **Accounts payable**. Pindutin ang **Pay** sa bill.
2. Ilagay ang halaga at payment details, tapos **Save**. Pwedeng partial. Gagawa ng disbursement at voucher.

### E. Disburse ang payroll

1. Tab na Empleyado, pill na **Payroll disbursement**. Makikita ang payroll na **Submitted to Finance** at ang total net pay.
2. Pindutin ang **Disburse**, ilagay ang payment details, tapos **Save**. Magiging **Disbursed** ang payroll at itatala ang payroll expense.

### F. Aprubahan ang purchase request (₱10,000 pababa)

1. **Maintenance & Inspection > Purchasing**, tab na **Purchase requests**.
2. Pindutin ang **Approve / reject**, piliin ang **Decision**, ilagay ang notes, tapos **Save**.
3. Kapag Approve, sinusuri ng system ang Purchasing budget. Kapag kulang, kusang **Rejected - Insufficient Budget**. Ang lagpas ₱10,000 ay sa Admin.

### G. Iba pa

| Gawain | Saan |
| --- | --- |
| Mag-print ng payment voucher | Finance & Payables > Gastos at Bayarin > Payment vouchers > **Print** |
| Tingnan ang cheques at lahat ng perang lumabas | Finance & Payables > Gastos at Bayarin > Disbursements and cheques |
| Cash flow per buwan | Finance & Payables > Plano > Cash flow |
| Baguhin ang fund categories o fuel price para sa P&L | Reports & Administration > Formula Settings (tab na Computation lists para sa fund categories, Values > Fuel para sa diesel) |
| Mag-upload ng resibo | Records > Documents (record type: fund, expense, payable o voucher) |

## 3. Billing

### Ano ang makikita pagkapasok

Pagka-login, ang **Billing and Collection Dashboard** ang lalabas.

&#91;image: Billing dashboard\]

| Card | Ibig sabihin |
| --- | --- |
| Completed trips awaiting billing | Tapos na trips na hindi pa nai-invoice (Draft o Finalized pa ang billing) |
| Total billing / Invoices issued this month | Halaga at bilang ng invoice ngayong buwan |
| Collections this month | Perang natanggap mula sa clients |
| Outstanding balance | Hindi pa nababayarang invoices |
| Overdue balance | Lagpas na sa due date |
| Chart at table | Billed vs collected sa 6 na buwan; history per client |

**Sidebar ng Billing (Dashboard sa itaas, at 5 pa):** Trip & Dispatch > **Trip Records & Waybills** (completed trips lang); Financial & Billing > **Billing & Collections** at **Clients, Routes & Rates**; Records > **Documents**; Reports & Administration > **Reports & Analytics**.

### A. Unang setup: clients, routes at rates

1. **Financial & Billing > Clients, Routes & Rates**.
2. **Add client**: Client (brand o consignee), Company (broker o forwarder), contact person, number, email, address at **Payment terms (days)**. **Save**.
3. **Add route**: Origin, Destination, Total km at RFID / toll ng buong trip. **Save**.
4. **Add client rate**: Client, Route, Truck type, Basis (Per Trip, Per Unit o Per KM), Rate at Effective from. **Save**. Ito ang kusang lalabas sa invoice at sa trip.
5. Sa tab na **Projected P&L per trip**, makikita ang tantiyang kita bawat client at route (rate minus fuel, toll, misc at salaries ayon sa Billing P&L Excel).

&#91;image: Clients, Routes & Rates page\]

### B. Billing draft, finalize at invoice

Bagong flow (PDF 7): kapag na-dispatch ang trip (ongoing), **kusang gagawa ang system ng billing draft** gamit ang client rate ng route. Pwede lang itong i-finalize kapag **Completed** na ang trip at **verified** na ang documents.

1. **Financial & Billing > Billing & Collections**, tab na **Billing drafts**. Makikita ang trip, trip status, waybill, Documents (Verified o Not verified), rate at amount.
2. Kung **no rate** (walang client rate sa route) o kailangang ayusin, pindutin ang **Edit**. Ilagay ang **Basis**, **Quantity** at **Rate**, tapos **Save**. Amount = rate × quantity.
3. Kapag may waybill na ang trip, pindutin ang **Verify documents**, tingnan ang waybill, tapos **Verify**.
4. Kapag **Completed** na ang trip at verified na, pindutin ang **Finalize**. Naka-disable ito habang kulang pa; itapat ang mouse para makita kung ano ang kulang.
5. Tab na **Ready to invoice**: naka-grupo per client ang finalized billings. Pindutin ang **Create invoice**.
6. Ilagay ang **Invoice no.**, **Invoice date**, **Due date** (blangko = invoice date + payment terms ng client), **Discount** at **Notes**. I-check ang mga trip na isasama; galing na sa finalized billing ang halaga.
7. Pindutin ang **Issue invoice**. Magiging Invoiced ang mga billing at hindi na pwedeng i-bill ulit.
8. Kung may mali sa finalized na hindi pa naka-invoice, pindutin ang **Return to draft** (may dahilan), ayusin, tapos i-finalize ulit.

&#91;image: Billing & Collections page\]

### C. Itala ang bayad ng client

1. Tab na **Invoices**. Pindutin ang **Record payment** sa invoice.
2. Ilagay ang **Amount**, **Payment date**, **Method**, **OR / reference no.**, at **Cheque no.** at **Bank** kung cheque.
3. **Save**. Magiging **Partially Paid** o **Paid** ang invoice. Bawal lumagpas sa balance.

### D. Iba pang gawain

| Gawain | Paano |
| --- | --- |
| I-print ang invoice | Invoices > **Print** |
| Tingnan ang trips ng invoice | Invoices > **Breakdown** |
| I-cancel ang maling invoice | Invoices > **Cancel**, ilagay ang dahilan. Hindi pwede kung may naitalang bayad. Babalik sa Not yet billed ang trips |
| Tingnan ang utang per client | Tab na **Receivables by client** (billed, collected, outstanding, overdue) |
| Magdagdag ng waybill | Trip Records & Waybills > **Add waybill** |
| Receivables aging at profit per trip | Reports & Analytics > Billing, collections and expenses |

## 4. Payroll

### Ano ang makikita pagkapasok

Pagka-login, ang **Payroll Dashboard** ang lalabas.

&#91;image: Payroll dashboard\]

| Card o table | Ibig sabihin |
| --- | --- |
| Draft payrolls | Ginagawa pa |
| Finalized (payslips ready) | Tapos na, pwedeng i-print ang payslips |
| With Finance / Disbursed | Naipasa na sa Finance / nabayaran na |
| Latest net pay / trip pay | Kabuuan ng pinakahuling payroll |
| Payroll per period chart | Gross, deductions at net bawat period |
| Completed trips without waybill | Trips na hindi mabibilang sa trip pay hangga't walang waybill |

**Sidebar ng Payroll (Dashboard sa itaas, at 9 pa):** Fleet Management > **Drivers & Helpers**; Trip & Dispatch > Trip Records & Waybills (completed lang); Financial & Billing > Clients, Routes & Rates (tingin lang); Payroll & Timekeeping > **Payroll**, **Attendance**, **Cash Advance & Balances**; Records > **Documents**; Reports & Administration > **Reports & Analytics** at **Formula Settings**.

### A. Unang setup

1. **Fleet Management > Drivers & Helpers**. Sa bawat tao, pindutin ang **Pay info** at ilagay ang **Daily rate**, **Pay frequency** at **Payroll group**.
2. **Payroll**, tab na **Trip pay rates**. Pindutin ang **Rate**, piliin ang **Truck type** at **Route** (o destination), at ilagay ang **Driver rate per trip** at **Helper rate per trip**. **Save**.
3. Sa **Formula Settings** (Payroll group), i-check ang SSS (775 ÷ 24 × araw), PhilHealth 75, Pag-IBIG 50 at Cash Bond 500.

### B. Attendance

1. **Payroll & Timekeeping > Attendance**.
2. Piliin ang **From** at **To**, tapos **Show**.
3. Markahan ang bawat tao bawat araw: **Present**, **Absent**, **VL**, **SIL** o **Rest Day**.
4. Pindutin ang **Save attendance**. Ang Present days ang bibilangin sa regular wage.

### C. Gumawa ng payroll

1. **Payroll > New payroll**. Ilagay ang **Payroll name**, **Payroll group**, **From** at **To**. **Save**.
2. Kusang kukuwentahin ng system ang bawat empleyado sa group:
   1. Regular wage = daily rate × araw na Present.
   2. Trip pay = trip pay rate × completed trips na may waybill.
   3. Deductions = SSS, PhilHealth, Pag-IBIG, cash bond, at hulog ng cash advance, uniform at damages.
   4. Net pay = gross pay − deductions.
3. Pindutin ang **Open** para makita ang mga linya. Makikita ang parehong columns ng Excel payroll sheet.
4. Habang **Draft**: **Edit** para maglagay ng manual earnings (Trade Test, Manual Pullout, Adjustment) o deductions (loans, late, rice/water), **Remove** para tanggalin ang tao, **Add employee**, at **Recompute all** para kuwentahin ulit (hindi mabubura ang in-type mo).
5. Pindutin ang **Trips** sa linya para makita kung aling trips ang binayaran.
6. **Finalize** kapag tama na. Ibabawas na ang hulog sa balances. Kung may mali pa, **Reopen as draft** (may dahilan; ibabalik ang balances).
7. **Print payslips** at **Print deduction form**, o **Payslip** sa bawat tao.
8. **Submit to Finance**. Ang Finance ang magdi-disburse.

&#91;image: Payroll page\]

### D. Cash Advance & Balances

| Button | Gamit |
| --- | --- |
| Add balance | Bagong Cash Advance, Uniform, Damages o Cash Bond, ang halaga, at magkano ang ibabawas bawat payroll |
| Payment | Bayad na hindi galing sa payroll |
| Installment | Baguhin ang hulog bawat payroll |
| Release | Para sa Cash Bond kapag ibabalik na sa empleyado |
| History | Lahat ng galaw ng balance |

Ang cash advance na ibinigay ng Finance ay kusang lalabas dito.

## 5. Paano nagkakabit ang Finance, Billing at Payroll

| Galing sa | Ano ang nangyayari | Saan lalabas sa Accounting |
| --- | --- | --- |
| Operations: fund request sa trip | Finance ang mag-approve at mag-release | Finance > Disbursements at Expenses |
| Operations: trip na-dispatch (ongoing), tapos Completed | System gumagawa ng billing draft sa dispatch; Billing nagve-verify at nagfi-finalize kapag Completed, saka nag-i-invoice | Billing > Billing / SOA, tapos Collections |
| Operations: waybill na-upload sa completed trip | Mabibilang na sa trip pay | Payroll > trip pay ng driver at helper |
| Maintenance: purchase order na received | Gagawa ng payable | Finance > Payables, tapos Pay |
| Payroll: Submit to Finance | Finance ang magdi-disburse | Finance > Disbursements |
| Finance: cash advance sa empleyado | Gagawa ng balance | Payroll > Cash Advance & Balances |

### Ang daloy ng pera

1. **Pera palabas:** trip allowance (Funds release), payables sa supplier (Purchasing), at payroll (Submit to Finance). Lahat ay papasok sa **Disbursements** at **Expenses** ng Finance.
2. **Pera papasok:** Billing ang gagawa ng invoice mula sa completed trips. Kapag nag-record ng **Collection**, papasok ito sa receivables at kita.
3. **Kita at gastos:** ang Reports & Analytics ang nagpapakita ng P&L, gamit ang billing (kita) at expenses (gastos).

### Mga dapat tandaan

- Walang waybill, walang trip pay. Silipin ang "Completed trips without waybill" sa Payroll Dashboard.
- Hindi pwedeng i-finalize ang billing hangga't walang waybill na na-verify ng Billing at hindi pa Completed ang trip.
- Finance lang ang makakapag-release ng pera. Ang Payroll at Billing ay naghahanda lang ng datos.
- Ang approval ng purchase: Finance kung ₱10,000 pababa, Admin kung lampas.

## 6. Mga karaniwang mensahe at tanong

### Finance

| Mensahe | Ibig sabihin at gagawin |
| --- | --- |
| The fund is not Ready for Release yet (Operations Head approval first). | Hindi pa na-approve ng Operations Head. Hintayin muna. |
| The trip is no longer waiting for this fund | Na-cancel o nagbago ang status ng trip. Silipin sa Trip Records. |
| Only released funds can be liquidated. | Mag-liquidate lang kapag Released na ang fund. |
| Actual spent cannot be more than the released amount. | I-record bilang hiwalay na expense ang sobrang gastos. |
| Payable is already paid. | Bayad na ang payable na ito. |
| Payroll is not waiting for disbursement. | Hindi pa na-submit ng Payroll, o na-disburse na. |
| Payment is more than the balance | Bawasan ang halaga hanggang sa natitirang balance. |

### Billing

| Mensahe | Ibig sabihin at gagawin |
| --- | --- |
| Only completed trips can be billed. | Completed trips lang ang pwedeng ilagay sa invoice. |
| Choose at least one completed trip. | Pumili ng kahit isang trip. |
| Invoice number already used. | Gumamit ng ibang invoice number. |
| Due date must be on or after the invoice date. | Ayusin ang due date. |
| Invoice has collections and cannot be cancelled. | May bayad na ang invoice kaya hindi na pwedeng i-cancel. |
| "... trip(s) have no waybill recorded yet. Please follow up." | Babala lang. Nagawa ang invoice, pero i-follow up ang waybill. |

| Mensahe (billing draft) | Ibig sabihin at gagawin |
| --- | --- |
| The trip is not Completed yet | Hindi pa pwedeng i-finalize; hintayin ang Completed. |
| Verify the required documents first. | Pindutin muna ang Verify documents. |
| No waybill recorded for ... yet. | Ipa-record muna ang waybill (dispatcher o Billing sa Trip Records). |
| Enter the rate first (Edit draft). | Walang rate; pindutin ang Edit at ilagay ang rate. |
| Only a Draft can be edited | Finalized na; gamitin ang Return to draft kung kailangang itama. |
| ... is not finalized | Sa invoice, finalized billings lang ang pwedeng isama. |

### Payroll

| Mensahe | Ibig sabihin at gagawin |
| --- | --- |
| Show at most 31 days at a time. | Sa Attendance, hanggang 31 araw lang bawat tingin. |
| Payroll has no employees. | Walang tao sa payroll group. Silipin ang Pay info ng mga tao. |
| Already in this payroll. | Nasa payroll na ang empleyado. |
| Choose a route or type the destination. | Sa trip pay rate, pumili ng route o mag-type ng destination. |
| Amount is more than the balance. | Bawasan ang bayad hanggang sa natitirang balance. |
| Balance is closed. | Bayad na o na-release na ang balance. |

### Mga tanong

**Bakit zero ang trip pay ng driver?** Walang completed trip na may waybill sa period, o walang trip pay rate para sa truck type at route. Ilagay ang rate, tapos **Recompute all**.

**Bakit hindi ko makita ang Confirm Release?** Lalabas lang ito kapag ang fund ay **Ready for Release**.

**Pwede bang baguhin ang finalized payroll?** Oo, gamit ang **Reopen as draft** (may dahilan), basta hindi pa na-submit o na-disburse.

**Saan nakikita ang lahat ng ginawa ko?** Sa Activity Log (Admin at Audit), kasama kung sino at kailan.
