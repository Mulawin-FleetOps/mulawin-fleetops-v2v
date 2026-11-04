# Gabay: Paano baguhin ang formula at computation (walang coding)

## 1. Sa loob ng system (pinakamadali)
1. Mag-login bilang **Admin**, **Finance** o **Payroll**.
2. Sidebar > **Reports & Administration > Formula Settings**.
3. **Mga numero (values)**: palitan ang numero, pindutin ang **Save**. Ang **Reset** ay babalik sa default.
4. **Computation lists**: puwedeng **magdagdag ng linya**, **mag-alis (✕)**, o **baguhin**, tapos **Save list**.
5. Sa ibaba ng page may **Example** para makita agad ang epekto: ang kabuuan ng lahat ng fund categories, at ang projected P&L (143 km, RFID ₱651, rate ₱15,000).

Sino ang puwedeng magbago:
| Bahagi | Puwedeng magbago |
|---|---|
| Purchase approval limit (₱10,000), PM km, checklist minutes, reminders, units | Admin |
| Fund request categories (preset amounts), fuel para sa projected P&L (km/L, presyo ng diesel), projected P&L list, payment terms | Admin, Finance |
| Payroll values at payroll earnings / deductions lists | Admin, Payroll |

### Fund request categories (bagong FMS PDF)
Ito ang listahan na pinagpipilian ng dispatcher sa **Fund Request**. Default: Forklift Operator ₱100, Checker ₱100,
Passway ₱200, Driver Meal Allowance ₱300, Helper Meal Allowance ₱200. Sa Formula Settings > **Fund request categories**:
- palitan ang halaga sa **amount**, o magdagdag ng bagong category (uri: **fixed** lang), tapos **Save list**;
- ang dispatcher ay pwede pa ring magdagdag ng ibang category sa mismong request kung wala sa listahan.

Paalala: **wala na** ang ₱15,000 limit sa fund at **wala na** ang fuel at toll sa fund request.
Ang Operations Head ang nag-a-approve ng lahat ng fund request. Ang fuel at RFID ay ginagamit na lang sa projected P&L.

## 2. Mga uri ng computation
| Uri (calc) | Ibig sabihin | Halimbawa |
|---|---|---|
| fixed | Parehong halaga palagi | PhilHealth 75, Checker 100 |
| percent_of_rate | Porsyento ng rate ng biyahe | Misc. Logistics 3 (%) |
| per_day | (amount ÷ divisor) × araw ng pasok | SSS: amount 775, divisor 24 |
| per_km | amount × km ng biyahe | — |
| per_trip | amount × bilang ng biyahe | — |
| fuel | (km ÷ km per liter) × presyo ng diesel | Fuel & Oil |
| route_toll | RFID / toll na naka-save sa Route | RFID |
| manual | ita-type ng Payroll sa bawat tao | SSS Loan, Trade Test |
| ledger | hulog mula sa balanse (Cash Advance, Uniform, Damages) | AR EMP - CA |

"Only if with attendance" = katulad ng `IF(D<>"", ...)` sa Excel: ibabawas lang kung may pasok.
"Balance type" sa Savings / Cash Bond = idadagdag sa ipon ng empleyado.

## 3. Sa file (kung gusto talaga)
Buksan ang `config/formulas.php` sa Notepad. Palitan lang ang numero sa tabi ng `'value' =>` o `'amount' =>`.
Huwag tanggalin ang kuwit sa dulo ng linya. I-save. (Ang na-save sa Formula Settings page ang mas masusunod.)

## 4. Mahalaga
- Ang **lumang** fund request, payroll at billing ay **hindi magbabago**. Bagong records lang ang tatamaan.
- Kung kailangan i-recompute ang **Draft** payroll gamit ang bagong formula: Payroll > buksan ang payroll > **Recompute all**.
- Lahat ng pagbabago ay nasa **Activity Log** (sino, kailan, dating value → bagong value).
- Kapag bagong klase ng formula na wala sa listahan sa itaas (hal. overtime o holiday pay na may oras),
  kailangan ng programmer: ang computation code ay nasa `backend/Core/Settings.php` (`computeItems`).
