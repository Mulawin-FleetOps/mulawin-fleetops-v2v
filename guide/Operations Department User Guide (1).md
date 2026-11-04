# Operations Department User Guide

Nov 1, 2026 · @kenneth

Para sa Operations Head, Car Carrier Dispatcher at Container / Wing Van Dispatcher ang gabay na ito. Sinusundan nito ang bagong flow ng FMS PDF (Scenario A, B at C).

## 1. Pag-login at mga bahagi ng screen

### Pag-login

1. Buksan ang address ng system na binigay ng Admin.
2. Ilagay ang **Username** at **Password**, tapos pindutin ang **Login**.
3. Sa unang login (o kung na-reset ang password), papalitan mo muna ang password. Minimum 8 characters.

&#91;image: Login screen\]

Kapag 5 beses kang nagkamali sa loob ng 15 minuto, maghihintay ka ng 15 minuto. Kapag 60 minuto kang walang ginawa, kusang mala-log out ka.

### Mga bahagi ng screen

| Bahagi | Saan | Gamit |
| --- | --- | --- |
| Sidebar | Kaliwa | Mga page na pwede sa role mo. Pindutin ang grupo (halimbawa Trip & Dispatch) para makita ang laman |
| Breadcrumb | Itaas | Kung nasaang page ka |
| Bell | Kanang itaas | Mga abiso: bagong request, fund na kailangang aprubahan, incident |
| Pangalan mo | Kanang itaas | Wika ng screen (English o Tagalog, naka-save sa account mo), Change password at Log out |
| Summary cards | Itaas ng page | Bilang ng mahahalagang bagay. Ang card na may maliit na arrow ay pwedeng i-click: bubukas ang mismong listahan o tab sa likod ng numero |
| Tables | Gitna | May Search, CSV download, at Prev / Next (25 rows bawat page). Nasa dulo ng bawat row ang mga button na pwede mong gawin |

Ang kulay ng status: berde = tapos o OK, asul = tuloy-tuloy pa, dilaw = naghihintay ng aksyon, pula = problema.

### Paano mag-navigate

- Isang sidebar group lang ang bukas bawat oras. Kusang bubukas ang group ng page na binuksan mo.
- Nakadikit sa itaas ang pangalan ng page at ang mga button habang nag-i-scroll.
- Sa mahabang page, pindutin ang bilog na arrow sa kanang ibaba para bumalik sa itaas.
- Ang malalaking page ay nahahati sa tabs, at ang ilang tab ay may maliliit na pills sa loob. Naaalala ang huling tab na binuksan mo.
- Bawat table ay 25 rows bawat page. Gamitin ang **Prev** at **Next** sa ibaba. Ang Search at CSV ay sakop ang lahat ng rows, hindi lang ang nakikita.
- Sa Dashboard: 2 charts muna (pindutin ang **Show more chart(s)** para sa iba), at ang mga table ay nasa iisang card. Ituro ang mouse sa chart para makita ang eksaktong bilang at porsyento. Sa Reports & Analytics, ang Print ay may Print this section at Print all sections, kasama ang period at filters. Pindutin ang pangalan ng table para makita ito; ang walang laman ay nakalista sa isang linya sa ibaba.

## 2. Daloy ng isang trip

Sabay pwedeng gawin ang fund request at ang pre-dispatch checklist. Ang system ang magbubukas ng Confirm Dispatch kapag pareho nang tapos.

&#91;embedded content: daloy ng trip sa Operations · Scenario A, B at C\]

| Status ng trip | Sino ang susunod na kikilos |
| --- | --- |
| Pending Review | Operations Head: Review and confirm |
| Awaiting Resources | Operations Head o dispatcher: Try auto-assign again |
| Pre-Assigned | Dispatcher: Fund request at Pre-dispatch checklist; Ops Head: Approve fund; Finance: Confirm release |
| Ready for Dispatch | Dispatcher: Confirm Dispatch (kapag Released na ang fund) |
| Dispatched / In Transit | Dispatcher: Update / delay, Waybill, Report incident, Arrival checklist |
| On Hold - Incident Reported | Motorpool: Assess at repair; tapos dispatcher: Resume trip |
| For Reschedule | Motorpool: repair; tapos dispatcher: Reschedule trip, checklist, Confirm Redispatch |
| Returned | Dispatcher: Submit completed trip |
| Completed | Billing, Payroll at Finance na ang susunod |

## 3. Operations Head: ano ang makikita pagkapasok

Pagka-login, **Operations Dashboard** agad ang lalabas. Ang mga dilaw na kahon sa itaas ay mga gawain na naghihintay sa iyo; pindutin ang **Open** para dumiretso doon.

&#91;image: Operations Head dashboard\]

| Bahagi ng dashboard | Ibig sabihin |
| --- | --- |
| Alerts (dilaw) | Delivery requests na kailangang i-review, fund requests na kailangang aprubahan, trips na On Hold dahil sa incident |
| Pending review | Delivery requests ng dispatcher na hindi pa nare-review |
| Pre-assigned / awaiting | Trips na may truck na (o naghihintay ng bakanteng truck) |
| Ready for dispatch | Tapos na ang checklist; hinihintay na lang ang released fund at dispatch |
| On the road | Dispatched, In Transit at pabalik na trips |
| On hold (incident) / For reschedule | Trips na nasiraan |
| Available trucks, drivers, helpers | Bakanteng resources ngayon |
| Charts at tables sa ibaba | Fleet status, trips per dispatcher, trucks under maintenance, trip performance per driver at per truck |

**Sidebar ng Operations Head (Dashboard sa itaas, at 10 pa):**

| Grupo sa sidebar | Pages |
| --- | --- |
| Fleet Management | Fleet Status & Trucks (tingin lang), Drivers & Helpers |
| Trip & Dispatch | Dispatch Board, Trip Records & Waybills, Incidents |
| Maintenance & Inspection | Maintenance (tingin lang) |
| Financial & Billing | Trip Funds & Allowances, Clients, Routes & Rates |
| Records | Documents |
| Reports & Administration | Reports & Analytics |

## 4. Operations Head: step-by-step

### A. Gumawa ng trip kapag sa iyo tumawag ang client (Scenario A)

1. Sidebar: **Trip & Dispatch > Dispatch Board**.
2. Pindutin ang **Create trip** sa itaas.
3. Punan ang form: **Client**, **Scheduled date and time**, **Truck type**, at **Route** (o i-type ang origin, destination at km kung wala sa listahan). Ilagay ang booking, units, container at seal no. kung meron.
4. Pindutin ang **Save**.
5. Kusang pipili ang system ng truck, driver at helper. Makikita mo ang trip na **Pre-Assigned** at aabisuhan ang dispatcher.
6. Kung walang bakante, magiging **Awaiting Resources** ang trip. Tingnan ang hakbang C.

&#91;image: Dispatch Board ng Operations Head\]

### B. I-review ang delivery request ng dispatcher (Scenario B)

1. Sa Dashboard, pindutin ang **Open** sa alert na "delivery request(s) need your review", o pumunta sa **Dispatch Board > Needs my action**.
2. Hanapin ang trip na **Pending Review** at pindutin ang **Review and confirm**.
3. Sa **Decision**, piliin ang **Confirm**. Itama ang **Truck type** (ito ang magtatakda kung aling dispatcher team), **Schedule** at **Units** kung kailangan.
4. Pindutin ang **Save**. Mag-a-auto-assign ang system at magiging **Pre-Assigned** ang trip.
5. Kung mali o hindi tuloy ang request, piliin ang **Reject** at ilagay ang **Reason**. Aabisuhan ang dispatcher.

&#91;image: Review and confirm form\]

### C. Kapag Awaiting Resources ang trip

1. Sa Dispatch Board, pindutin ang **Try auto-assign again** kapag may bakante na.
2. O pindutin ang **Assign manually**, piliin ang **Truck**, **Driver**, **Driver 2** (car carrier) at **Helper** (kailangan sa container at wing van), ilagay ang **Reason**, tapos **Save**. Sinusuri ng system kung may double booking sa parehong araw.

### D. Aprubahan o i-reject ang fund request

1. Sidebar: **Financial & Billing > Trip Funds & Allowances** (o pindutin ang **Open** sa alert ng fund).
2. Pindutin ang **Breakdown** para makita ang mga category at halaga.
3. Pindutin ang **Approve** kung tama. Magiging **Ready for Release** ang fund at lalabas sa Finance. Walang limit sa halaga.
4. Kung may mali, pindutin ang **Reject** at ilagay ang dahilan. Babalik ito sa dispatcher para i-revise.

&#91;image: Trip Funds page ng Operations Head\]

### E. I-cancel ang trip

1. Sa Dispatch Board, pindutin ang **Cancel** sa trip na hindi pa umaalis.
2. Ilagay ang **Reason**, tapos **Cancel trip**. Kung Released na ang fund, aabisuhan ang Finance para sa liquidation.

### F. Iba pang gawain

| Gawain | Saan | Paano |
| --- | --- | --- |
| Bantayan ang incidents | Trip & Dispatch > Incidents | Makikita ang lahat ng report, ang assessment ng Motorpool at ang status ng trip |
| Palitan ang availability ng driver o helper | Fleet Management > Drivers & Helpers | Pindutin ang **Set unavailable** o **Set available** |
| Magdagdag ng route | Financial & Billing > Clients, Routes & Rates > Routes | Pindutin ang **Add route**, ilagay ang origin, destination, km at toll |
| Hanapin ang lumang trip | Trip & Dispatch > Trip Records & Waybills | Gamitin ang search at filters, tapos **Details** |
| Tingnan ang reports | Reports & Administration > Reports & Analytics | Piliin ang petsa at filters, i-download bilang CSV kung kailangan |

## 5. Dispatchers: ano ang makikita pagkapasok

Pareho ang screens ng **Car Carrier Dispatcher** at **Container / Wing Van Dispatcher**. Ang pagkakaiba: trips lang ng sariling team ang makikita at magagalaw mo. Car carrier para sa una, container at wing van para sa pangalawa.

Pagka-login, ang **Dispatcher Dashboard** ang lalabas. Sa itaas ang mga alert ng susunod mong gagawin, gaya ng trips na kailangan ng fund request at checklist, fund na na-reject, trips na pwede nang i-dispatch, o trips na pwede nang ituloy pagkatapos ng repair.

&#91;image: Dispatcher dashboard\]

| Bahagi ng dashboard | Ibig sabihin |
| --- | --- |
| Pending review | Mga ginawa mong delivery request na hinihintay pa ang Operations Head |
| Pre-assigned | May truck na; kailangan ng fund request at pre-dispatch checklist |
| Ready for dispatch | Tapos na ang checklist |
| On the road | Dispatched, In Transit at pabalik |
| On hold / for reschedule | Nasiraang trips |
| Available trucks | Bakanteng trucks ng team mo |
| Open trips, Trips without waybill | Listahan ng trips na bukas pa at trips na kulang sa waybill |

**Sidebar ng dispatcher (Dashboard sa itaas, at 8 pa):**

| Grupo sa sidebar | Pages |
| --- | --- |
| Fleet Management | Fleet Status & Trucks, Drivers & Helpers (tingin lang) |
| Trip & Dispatch | Dispatch Board, Trip Records & Waybills, Incidents |
| Financial & Billing | Trip Funds & Allowances |
| Records | Documents |
| Reports & Administration | Reports & Analytics |

Sa **Dispatch Board**, may tatlong tab: **Needs my action** (trips na may hinihintay sa iyo), **All open trips** at **Recently closed**. Bawat trip ay may hilera ng hakbang (Pre-assigned, Fund requested, Fund approved, Fund released, Checklist, Dispatched, Arrived, Completed). Berde ang tapos na at dilaw ang susunod.

&#91;image: Dispatch Board ng dispatcher\]

## 6. Dispatchers: step-by-step

### A. Gumawa ng delivery request (Scenario B, kapag sa iyo tumawag ang client)

1. **Dispatch Board > Create delivery request**.
2. Ilagay ang **Client**, **Scheduled date and time**, **Route** (o origin, destination at km), at booking, units, container, seal at shipment no. kung meron. Optional ang truck type.
3. **Save**. Magiging **Pending Review** ito at lalabas sa Operations Head.
4. Hintayin ang abiso sa bell. Pagka-confirm, magiging **Pre-Assigned** ang trip na may truck, driver at helper.

Kapag ang Operations Head ang gumawa ng trip (Scenario A), diretso itong lalabas sa iyo bilang **Pre-Assigned**.

### B. Fund request

1. Sa trip na Pre-Assigned, pindutin ang **Fund request**.
2. Lagyan ng check ang applicable na gastusin: Forklift Operator ₱100, Checker ₱100, Passway ₱200, Driver Meal Allowance ₱300, Helper Meal Allowance ₱200.
3. Kung may iba pang gastos, i-type sa **Other expense categories** ang pangalan at halaga.
4. Tingnan ang **Total requested fund** sa ibaba, tapos **Submit Fund Request**. Mapupunta ito sa Operations Head.
5. Kung na-reject, may abiso sa bell at may button na **Revise fund request**. Ayusin ang categories at i-submit ulit.

&#91;image: Fund request form\]

### C. Booking / client steps (container at wing van lang)

1. Pindutin ang **Booking / client steps**.
2. Container: lagyan ng check ang **Client nomination / booking confirmed** at **Pre-advice sent to client**. Wing Van: **Trip confirmed with the client** at **Truck details and plate given to client**.
3. **Save**. Kailangan ito bago ang checklist.

Para sa car carrier, ang button ay **Trip details** (booking at units lang).

### D. Pre-dispatch checklist (pwedeng gawin habang hinihintay ang fund)

1. Pindutin ang **Pre-dispatch checklist**, tapos **Start checklist**. Magsisimula ang timer (minimum 15 minuto).
2. Pindutin ulit ang **Pre-dispatch checklist** para buksan ang 57 items.
3. Pindutin ang **Mark all OK**, tapos palitan ng **NOT OK** ang may problema at ilagay ang remarks.
4. Ilagay ang **ODOMETER-OUT**, fuel level, at mga pangalan sa ibaba.
5. **Submit checklist (Ready for Dispatch)**. Kung lahat OK, magiging **Ready for Dispatch** ang trip. Kung may NOT OK, ayusin muna at ulitin mula hakbang 1.

&#91;image: Pre-dispatch checklist\]

### E. Confirm Dispatch

1. Naka-disable (malabo) ang **Confirm Dispatch** hangga't hindi pa Ready for Dispatch ang trip at Released ang fund. Itapat ang mouse sa button para makita ang kulang.
2. Kapag pareho nang tapos, magiging aktibo ang button. Pindutin ito kapag aalis na talaga ang truck, tapos **Confirm**.
3. Magiging **Dispatched** ang trip at On Trip ang truck at crew. Kasabay nito, gagawa ang system ng billing draft para sa Billing, batay sa client rate ng route.

### F. Habang nasa daan

| Button | Gamit |
| --- | --- |
| Update / delay | Progress, loading, unloading, delivery o delay. Kung delay, piliin ang **Delay cause** (Client, Pending Documents, Operational, Traffic, Weather, Other) |
| Waybill | RPM waybill no., client waybill no., DR no., units at petsa |
| Report incident | Kapag nasiraan ang truck (tingnan ang G) |
| Arrival checklist | Pagbalik ng truck (tingnan ang H) |

### G. Kapag nasiraan ang truck (Scenario C)

1. Pindutin ang **Report incident**. Ilagay ang **Date and time of incident**, **Location of incident**, **Incident description** (ayon sa driver) at **Reported problem or damage**. **Submit Incident Report**.
2. Magiging **On Hold - Incident Reported** ang trip. Ang Motorpool ang mag-a-assess.
3. **Kung Minor:** magpapadala ang Motorpool ng mekaniko. Kapag may abiso na "Repaired - Cleared to Continue", pindutin ang **Resume trip**. Magiging **In Transit** ang trip; hindi ito second attempt.
4. **Kung Major:** magiging **For Reschedule** ang trip at Under Maintenance ang truck. Hintayin ang abiso na Available na ang truck, tapos:
   1. Pindutin ang **Reschedule trip** at ilagay ang bagong schedule.
   2. Gawin ulit ang **Pre-dispatch checklist**. Mag-**Fund request** lang kung kailangan.
   3. Pindutin ang **Confirm Redispatch**. Itatala ito bilang **Second Attempt** ng parehong trip.

&#91;image: Incident report form\]

### H. Pagbalik at pagtapos ng trip

1. Pindutin ang **Arrival checklist**, tapos **Start checklist**, tapos buksan ulit.
2. Punan ang 57 items, **ODOMETER-IN**, units delivered, at **Delivery and return details**. Makikita mo sa tabi ang resulta ng departure checklist para maikumpara.
3. **Submit checklist**. Magiging **Returned** ang trip. Kung may NOT OK, kusang may maintenance job para sa Motorpool.
4. Siguraduhing may **Waybill** ang trip, tapos pindutin ang **Submit completed trip**. Magiging **Completed** ito at lalabas sa Billing at Payroll.

## 7. Mga karaniwang mensahe at tanong

Kapag may pulang mensahe, walang na-save. Ayusin ang sinasabi at subukan ulit.

| Mensahe | Ano ang gagawin |
| --- | --- |
| Confirm Dispatch is not yet enabled. ... | Tapusin ang checklist at hintayin na Released ang fund |
| This trip belongs to the other dispatcher team. | Ang dispatcher ng tamang team ang gagawa |
| Choose at least one fund category. | Pumili ng category o magdagdag ng sariling linya |
| This trip has a rejected request. Use "Revise and resubmit". | Pindutin ang Revise fund request |
| Confirm the client nomination / booking first | Kumpletuhin ang Booking / client steps bago ang checklist |
| The checklist must take at least 15 minutes | Hintayin ang minimum na oras |
| Press "Start checklist" first. | Pindutin muna ang checklist button para magsimula ang timer |
| Arrival odometer ... is lower than the departure odometer | Tingnan ulit ang odometer |
| Wait for Maintenance to confirm the repair | Hintayin ang Motorpool bago ang Resume trip |
| The truck is still Under Maintenance ... | Hintayin ang repair, o hilingin sa Operations Head na mag-assign ng ibang truck |
| No ... truck is available on ... | Awaiting Resources; Try auto-assign again o Assign manually |

**Bakit wala ang button na hinahanap ko?** Lumalabas lang ang button kapag tama ang role mo at ang status ng trip. Halimbawa, ang Resume trip ay lalabas lang kapag nakumpirma ng Motorpool ang repair.

**Saan makikita ang history ng trip?** Pindutin ang **Details** sa trip. Nandoon ang lahat ng nangyari, sino ang gumawa, kailan, at ang paghahambing ng departure at arrival checklist.
