# Maintenance Department User Guide

Nov 1, 2026 · @kenneth

Para sa Motorpool (maintenance) at Purchasing ang gabay na ito. Ayon sa FMS PDF, magkasama sila sa Maintenance Module: ang Motorpool ang nag-aayos ng trucks, at ang Purchasing ang nagbibigay at bumibili ng truck parts.

## 1. Pag-login at mga bahagi ng screen

1. Buksan ang address ng system na binigay ng Admin.
2. Ilagay ang **Username** at **Password**, tapos **Login**.
3. Sa unang login (o kung na-reset), papalitan mo muna ang password. Minimum 8 characters.

&#91;image: Login screen\]

| Bahagi | Gamit |
| --- | --- |
| Sidebar (kaliwa) | Mga page na pwede sa role mo. Pindutin ang grupo para makita ang laman |
| Bell (kanang itaas) | Mga abiso, gaya ng bagong incident, parts request o purchase na kailangang aksyunan |
| Pangalan mo (kanang itaas) | Wika ng screen (English o Tagalog, naka-save sa account mo), Change password at Log out |
| Summary cards | Bilang ng mahahalagang bagay. Ang card na may maliit na arrow ay pwedeng i-click: bubukas ang mismong tab sa likod ng numero |
| Tables | May Search, CSV download, at Prev / Next; nasa dulo ng row ang mga button |

Kapag 5 beses kang nagkamali ng password sa loob ng 15 minuto, maghihintay ka ng 15 minuto. Kapag 60 minuto kang walang ginawa, mala-log out ka.

### Paano mag-navigate

- Isang sidebar group lang ang bukas bawat oras. Kusang bubukas ang group ng page na binuksan mo.
- Nakadikit sa itaas ang pangalan ng page at ang mga button habang nag-i-scroll.
- Sa mahabang page, pindutin ang bilog na arrow sa kanang ibaba para bumalik sa itaas.
- Ang malalaking page ay nahahati sa tabs, at ang ilang tab ay may maliliit na pills sa loob. Naaalala ang huling tab na binuksan mo.
- Bawat table ay 25 rows bawat page. Gamitin ang **Prev** at **Next** sa ibaba. Ang Search at CSV ay sakop ang lahat ng rows, hindi lang ang nakikita.
- Sa Dashboard: 2 charts muna (pindutin ang **Show more chart(s)** para sa iba), at ang mga table ay nasa iisang card. Ituro ang mouse sa chart para makita ang eksaktong halaga at porsyento. Sa Reports & Analytics, ang Print ay may Print this section at Print all sections, kasama ang period at filters. Pindutin ang pangalan ng table para makita ito; ang walang laman ay nakalista sa isang linya sa ibaba.

## 2. Motorpool: ano ang makikita pagkapasok

Pagka-login, ang **Maintenance Dashboard** ang lalabas.

&#91;image: Motorpool dashboard\]

| Bahagi ng dashboard | Ibig sabihin |
| --- | --- |
| Trucks under maintenance | Trucks na inaayos ngayon |
| Pending repair requests | Jobs na hindi pa nasisimulan |
| Roadside repairs open | Minor incident na inaayos sa daan |
| Scheduled preventive maintenance | PM na naka-iskedyul |
| Parts used / Maintenance expenses this month | Gastos ngayong buwan |
| Expected vehicle availability | Kailan babalik ang bawat truck |
| Trucks near the PM limit | Trucks na malapit na sa 10,000 km mula sa huling PM, at ilang km pa ang natitira |
| Recent maintenance history | Mga huling natapos na job |

**Sidebar ng Motorpool (Dashboard sa itaas, at 6 pa):**

| Grupo sa sidebar | Pages |
| --- | --- |
| Fleet Management | Fleet Status & Trucks (pwedeng palitan ang status: Available o Under Maintenance) |
| Trip & Dispatch | Incidents (tingin lang) |
| Maintenance & Inspection | Maintenance, Parts Inventory |
| Records | Documents |
| Reports & Administration | Reports & Analytics |

Sa **Maintenance** page, ang unang card na **Incidents to assess** ang pinakamahalaga: dito makikita kung may nasiraang truck na naghihintay ng assessment mo.

&#91;image: Maintenance page\]

## 3. Motorpool: step-by-step

### A. I-assess ang incident (nasiraang truck habang nasa biyahe)

1. Kapag may abiso sa bell na may incident, pumunta sa **Maintenance & Inspection > Maintenance**.
2. Sa tab na **Repair and maintenance jobs**, hanapin ang job na pula ang **For assessment** sa Severity.
3. Pindutin ang **Details** para makita ang lokasyon, oras, problema at trip.
4. Pindutin ang **Assess damage**.
5. Sa **Assessment**, piliin ang:
   1. **Minor Damage** kapag kayang ayusin sa lokasyon (magpapadala ng mekaniko, tuloy ang trip); o
   2. **Major Damage** kapag kailangang iuwi ang truck (magiging Under Maintenance ang truck at For Reschedule ang trip).
6. Ilagay ang **Mechanic / service provider**, **Expected completion** at **Assessment notes**, tapos **Save**.

&#91;image: Assess damage form\]

### B. Tapusin ang repair ng incident

- **Minor:** kapag ligtas at gumagana na ang truck, pindutin ang **Confirm repair (cleared to continue)**. Magiging "Repaired - Cleared to Continue" ang incident at aabisuhan ang dispatcher na ituloy ang biyahe.
- **Major:** kapag tapos at verified na ang repair, pindutin ang **Complete repair (truck Available)**. Babalik sa Available ang truck at aabisuhan ang dispatcher na i-reschedule ang trip. Habang hindi pa tapos, hindi maa-assign ang truck sa ibang trip.

### C. Mag-record ng repair o maintenance na hindi galing sa incident

1. **Maintenance > Record repair / maintenance**.
2. Piliin ang **Truck** at **Type** (Repair o Preventive Maintenance), ilagay ang **Reported issue / work needed**, mekaniko at expected completion.
3. **Save**. Magiging **Under Maintenance** ang truck. Hindi ito pwede kung ang truck ay nasa trip o naka-reserve sa trip.

### D. Habang inaayos ang job

| Button sa job | Gamit |
| --- | --- |
| Update | Palitan ang status (Reported, Scheduled, In Progress, Waiting for Parts), mekaniko at expected completion |
| Parts | Humingi ng parts sa Purchasing para sa job na ito |
| Parts used | Itala kung ilang piraso ang nagamit mula sa na-release na parts |
| Cost | Itala ang Labor, Outside Service, Materials o Other na gastos (napupunta sa expenses ng Finance) |
| Complete | Tapusin ang job; babalik sa Available ang truck kung wala nang ibang bukas na job |

### E. Humingi ng truck parts (stock-out)

1. **Maintenance > Request parts** (o **Parts** sa mismong job, o **Parts Inventory > Request parts**).
2. Piliin ang **Truck**, ang **job** kung meron, ang **Part** at **Quantity**, tapos **Save**.
3. Magiging **Waiting for Parts** ang job. Hintayin ang Purchasing na mag-release. Pagka-release, babalik sa **In Progress** ang job.
4. Kapag naubos sa stock, bibili ang Purchasing at kusang babalik sa listahan ang request mo pagdating ng parts.

### F. Preventive maintenance (PM)

1. Kusang dinadagdagan ng system ang km ng truck mula sa odometer ng arrival checklist.
2. Kapag umabot sa **10,000 km** mula sa huling PM, gagawa ang system ng **Preventive Maintenance** job at magiging Under Maintenance ang truck pagkatapos ng trip nito.
3. Gawin ang PM, itala ang parts at gastos, tapos **Complete**. Babalik sa **0** ang km since PM.
4. Pwede ring mag-iskedyul: **Schedule service**, piliin ang truck, ilagay ang due date o due km. Sa tab na **Preventive maintenance schedule**, pindutin ang **Start service** kapag sisimulan na.

### G. Palitan ang status ng truck

1. **Fleet Management > Fleet Status & Trucks**.
2. Pindutin ang **Status** at piliin ang **Available** o **Under Maintenance**, ilagay ang dahilan.
3. Hindi ito pwede kung may trip ang truck o may bukas pang job (tapusin muna ang job).

## 4. Purchasing: ano ang makikita pagkapasok

Pagka-login, ang **Purchasing and Inventory Dashboard** ang lalabas.

&#91;image: Purchasing dashboard\]

| Bahagi ng dashboard | Ibig sabihin |
| --- | --- |
| Parts requests to act on | Hiling ng Motorpool na hindi pa nare-release |
| Purchase requests pending | Hinihintay ang approval ng Finance o Admin |
| Approved, not yet ordered | Pwede nang gawan ng PO |
| Open purchase orders | Naka-order pero hindi pa dumarating |
| Inventory value | Kabuuang halaga ng stock |
| Low-stock items | Parts na kapantay o mas mababa sa reorder level |
| Parts purchased / issued this month | Galaw ng stock ngayong buwan |
| Suppliers | Bilang ng suppliers |

**Sidebar ng Purchasing (Dashboard sa itaas, at 4 pa):** Maintenance & Inspection > **Parts Inventory** at **Purchasing**, Records > **Documents**, at Reports & Administration > **Reports & Analytics**.

| Page | Mga tab |
| --- | --- |
| Parts Inventory | Parts and stock, Parts requests (stock-out), Inventory transactions |
| Purchasing | Purchase requests, Purchase orders and receipts, Suppliers, Not in stock (from Motorpool) |

&#91;image: Parts Inventory page\]

## 5. Purchasing: step-by-step

### A. Unang setup: parts at suppliers

1. **Purchasing > Add supplier**: Supplier name, contact person, number, email, address. **Save**.
2. **Parts Inventory > Add part**: Part ID / part number, Description, Category, Unit, Unit cost, Reorder level, Usual supplier, Warranty information. **Save**.
3. Para sa unang bilang ng stock: sa part, pindutin ang **Adjust stock**, ilagay ang dami (+), at piliin ang reason na **Opening balance (verified count)**.

### B. Mag-release ng parts sa Motorpool (stock-out)

1. **Parts Inventory > Parts requests (stock-out)**. Makikita ang hiling ng Motorpool: truck, part, dami at stock.
2. Kung sapat ang stock, pindutin ang **Release parts**. Mababawasan ang stock at itatala sa Inventory transactions. Babalik sa In Progress ang job ng Motorpool.
3. Kung kulang, pindutin ang **Not available**. Lalabas ito sa **Purchasing > Not in stock (from Motorpool)** para bilhin.

### C. Bumili ng parts (stock-in)

1. **Purchasing > Purchase request**. Piliin ang **Part**, **Quantity**, **Unit cost**, **Supplier**, at **For Motorpool request** kung para sa hiling na wala sa stock. **Save**.
2. Kusang itatakda ng system kung sino ang mag-a-approve: **Finance** kung ₱10,000 pababa, **Admin** kung lagpas.
3. Pag-approve, sinusuri ng system ang **Purchasing budget** na sinet ng Finance. Kung kulang, kusang **Rejected - Insufficient Budget**.
4. Kapag **Approved**, pindutin ang **Create PO**. Ilagay ang **Order date**, **Expected delivery** at supplier. **Save**. Magiging **Ordered**.
5. Pagdating ng items, sa tab na **Purchase orders and receipts**, pindutin ang **Receive (stock-in)**. Ilagay ang **Quantity received** (dapat kapareho ng PO), **Date received**, **Receipt / DR no.** at warranty kung meron. **Save**.
6. Madadagdagan ang stock, gagawa ang system ng **accounts payable** para sa Finance at **parts expense**, at babalik sa listahan ng Parts requests ang hiling ng Motorpool para ma-release mo.

&#91;image: Purchasing page\]

### D. Iba pang gawain

| Gawain | Saan | Paano |
| --- | --- | --- |
| Itama ang bilang ng stock | Parts Inventory > Adjust stock | Ilagay ang + o − na dami at reason (physical count, damaged, returned) |
| Tingnan ang low-stock | Dashboard o Parts Inventory | Naka-highlight ang parts na kapantay o mas mababa sa reorder level |
| Tingnan ang lahat ng galaw ng stock | Parts Inventory > Inventory transactions | Stock in, stock out at adjustments, sino at kailan |
| Mag-upload ng resibo o DR | Records > Documents | Upload, piliin ang record type na purchase o parts |
| Report ng parts | Reports & Analytics | Parts received, issued at stock value sa napiling petsa |

## 6. Mga karaniwang mensahe at tanong

| Mensahe | Ano ang gagawin |
| --- | --- |
| Assess the incident first (Minor or Major damage). | Pindutin muna ang Assess damage |
| This incident was already assessed as ... | Na-assess na; tuloy na sa repair |
| Truck is on trip ... The dispatcher reports road problems as an incident. | Hintayin ang incident report ng dispatcher |
| Truck is reserved for trip ... | Hilingin sa Operations Head na mag-assign ng ibang truck |
| This truck still has an open maintenance job. | Tapusin muna ang job bago gawing Available |
| Choose an issued parts request for the same truck. | Mag-request muna ng parts at hintayin ang release |
| Not enough stock ... | Purchasing: Not available, tapos Purchase request |
| Finance has not set an active Purchasing budget yet. | Sabihan ang Finance na mag-set ng budget |
| This amount must be approved by ... | Ang nakasaad na role ang mag-a-approve |
| Received quantity must match the ordered quantity | Ilagay ang eksaktong dami sa PO |
| Stock cannot go below zero. | Itama ang dami ng adjustment |

**Bakit wala ang button?** Lumalabas lang ang button kapag tama ang role mo at ang status ng record. Halimbawa, ang Assess damage ay para lang sa job na galing sa incident at hindi pa na-assess.
