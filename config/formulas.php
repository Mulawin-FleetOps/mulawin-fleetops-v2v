<?php
/*
 * =====================================================================
 *  config/formulas.php  —  LAHAT NG NUMERO AT FORMULA NG SYSTEM
 * =====================================================================
 *
 *  PARA SA HINDI MARUNONG MAG-CODE (basahin muna ito):
 *
 *  1. PINAKAMADALING PARAAN: Mag-login bilang Admin, Finance o Payroll,
 *     tapos buksan ang "Formula Settings" sa sidebar. Doon mo papalitan
 *     ang mga numero. Hindi mo na kailangang galawin ang file na ito.
 *
 *  2. Ang file na ito ay ang "DEFAULT" o unang value lang. Kapag binago
 *     mo ang value sa Formula Settings page, iyon na ang gagamitin ng
 *     system (naka-save sa database). Ang nandito ay gagamitin lang kung
 *     wala pang na-save sa database.
 *
 *  3. Kung gusto mo talagang baguhin dito:
 *       - Palitan lang ang numero sa tabi ng  'value' =>
 *       - Huwag tanggalin ang kuwit (,) sa dulo ng bawat linya.
 *       - Huwag galawin ang mga salitang nasa loob ng '...' sa kaliwa
 *         (halimbawa 'km_per_liter'). Iyan ang pangalan na hinahanap
 *         ng system.
 *       - I-save ang file. Wala nang ibang gagawin.
 *
 *  4. Ang mga lumang record (payroll, fund request, billing) ay HINDI
 *     magbabago kapag binago mo ang formula. Naka-save sa bawat lumang
 *     record kung anong value ang ginamit noon. Sa bagong record lang
 *     tatama ang pagbabago.
 *
 *  MGA URI NG COMPUTATION ('calc') na puwedeng gamitin sa 'items':
 *     'fixed'           = parehong halaga palagi.            Hal. 75
 *     'percent_of_rate' = porsyento ng rate ng biyahe.      Hal. 3 (%)
 *     'per_day'         = (amount ÷ divisor) × araw ng pasok. Hal. 775 ÷ 24
 *     'per_km'          = amount × km ng biyahe.
 *     'per_trip'        = amount × bilang ng biyahe sa payroll period.
 *     'fuel'            = (km ÷ km_per_liter) × fuel_price_per_liter
 *     'route_toll'      = RFID/Toll na naka-save sa Route.
 *     'manual'          = ilalagay ng tao (walang auto-compute).
 *     'ledger'          = hulog mula sa balanse (Cash Advance, Uniform,
 *                         Damages). Ang halaga ay ang "installment" na
 *                         naka-set sa balanse ng empleyado.
 *
 *  'only_if_attended' => true  ibig sabihin: ibabawas lang kung may
 *  pasok ang empleyado sa period (katulad ng IF(D<>"") sa Excel).
 * =====================================================================
 */

return [

    // -----------------------------------------------------------------
    //  A. MGA ISANG NUMERO (VALUES)
    //  'source' = kung saan galing ang numero, para madaling i-check.
    // -----------------------------------------------------------------
    'values' => [

        // ---------- APPROVALS ----------
        // Paalala: WALA nang PHP 15,000 limit sa trip fund. Ayon sa bagong PDF,
        // Operations Head ang nag-a-approve ng LAHAT ng fund request.
        'purchase_approval_threshold' => [
            'group' => 'Approvals', 'label' => 'Purchase request approval limit (PHP)',
            'value' => 10000, 'unit' => 'PHP',
            'help'  => 'Kung ang purchase request ay HANGGANG dito, Finance ang mag-a-approve. Kung LAMPAS, Admin ang mag-a-approve.',
            'source' => 'FMS PDF p.17: above 10k Admin approves; 10k and below Finance approves',
        ],

        // ---------- FUEL (para sa projected P&L kada biyahe lang) ----------
        // Hindi na ito kasama sa fund request (inalis ang fuel at toll sa fund).
        'km_per_liter' => [
            'group' => 'Fuel (projected P&L)', 'label' => 'Kilometers per liter of diesel',
            'value' => 4, 'unit' => 'km/L',
            'help'  => 'Ilang km ang natatakbo ng truck sa 1 litro. Ginagamit sa fuel computation: (km ÷ ito) × presyo ng diesel.',
            'source' => 'Dummy Computation for Billing PL.xlsx, cell K26 "1L/ 4KM/ 100.00/ L", G53 =G52/4',
        ],
        'fuel_price_per_liter' => [
            'group' => 'Fuel (projected P&L)', 'label' => 'Diesel price per liter (PHP)',
            'value' => 100, 'unit' => 'PHP/L',
            'help'  => 'Presyo ng diesel kada litro. Palitan kapag nagbago ang presyo.',
            'source' => 'Dummy Computation for Billing PL.xlsx, cell G54 =G53*100',
        ],

        // ---------- CAR CARRIER ----------
        'units_per_trip' => [
            'group' => 'Car Carrier', 'label' => 'Default units per car carrier trip',
            'value' => 5, 'unit' => 'units',
            'help'  => 'Unang laman ng "units" kapag gumawa ng car carrier trip. Puwedeng palitan sa mismong trip.',
            'source' => 'CAR CARRIER MONITORING 2026.xlsx, TRIPS & DAMAGES N7 =O7*5 and CLIENT CAR CARRIER J8 =K8*5',
        ],

        // ---------- MAINTENANCE ----------
        'pm_interval_km' => [
            'group' => 'Maintenance', 'label' => 'Preventive maintenance every (km)',
            'value' => 10000, 'unit' => 'km',
            'help'  => 'Kapag umabot sa ganitong km ang natakbo ng truck mula sa huling preventive maintenance, ise-set ng system ang truck for preventive maintenance.',
            'source' => 'FMS PDF p.18: "pag umabot na for example is 10,000 km"',
        ],
        'pm_auto_hold' => [
            'group' => 'Maintenance', 'label' => 'Automatically put truck Under Maintenance when PM is due (1 = yes, 0 = no)',
            'value' => 1, 'unit' => '1/0',
            'help'  => '1 = pagdating ng truck at umabot na sa km limit, gagawin ng system na "Under Maintenance" at gagawa ng preventive job. 0 = gagawa lang ng job at reminder pero mananatiling Available ang truck.',
            'source' => 'FMS PDF p.18: "isset na sya ng system sa preventive maintenance"',
        ],

        // ---------- INSPECTION ----------
        'inspection_min_minutes' => [
            'group' => 'Inspection', 'label' => 'Minimum checklist duration (minutes, 0 = off)',
            'value' => 15, 'unit' => 'minutes',
            'help'  => 'Pinakamaikling oras mula pagpindot ng "Start checklist" hanggang ma-submit. Ilagay 0 para i-off.',
            'source' => 'FMS PDF p.6: "set a minimum inspection duration, such as 15 minutes, if technically feasible"',
        ],

        // ---------- REMINDERS ----------
        'document_alert_days' => [
            'group' => 'Reminders', 'label' => 'Remind about expiring documents (days before)',
            'value' => 30, 'unit' => 'days',
            'help'  => 'Ilang araw bago mag-expire ang OR/CR, insurance, kontrata at ibang dokumento ay lalabas na ang paalala. Formula: Expiry date − araw ngayon.',
            'source' => 'FMS PDF pp.2-3, 8-9 (reminders); formula "Expiry date - current date" from repo docs/client_data_analytics_mapping.md',
        ],
        'license_alert_days' => [
            'group' => 'Reminders', 'label' => 'Remind about expiring driver licenses (days before)',
            'value' => 30, 'unit' => 'days',
            'help'  => 'Ilang araw bago mag-expire ang lisensya ng driver ay lalabas na ang paalala.',
            'source' => 'FMS PDF p.3: reminders for driver licenses nearing expiration',
        ],

        // ---------- BILLING ----------
        'default_payment_terms_days' => [
            'group' => 'Billing', 'label' => 'Default payment terms (days)',
            'value' => 30, 'unit' => 'days',
            'help'  => 'Ginagamit lang kung walang payment terms ang client. Due date = invoice date + ito.',
            'source' => 'Repo docs (client questionnaire Q15): outstanding 15 or 30 days per client contract',
        ],

        // ---------- PAYROLL ----------
        'payroll_require_waybill' => [
            'group' => 'Payroll', 'label' => 'Count only trips with a waybill in payroll (1 = yes, 0 = no)',
            'value' => 1, 'unit' => '1/0',
            'help'  => '1 = ang biyahe na walang naka-record na waybill ay hindi mabibilang sa trip pay (lalabas sa listahan ng kulang na waybill).',
            'source' => 'FMS PDF p.2 and p.7: payroll uses trip and waybill information as basis of trip-related pay',
        ],

        // ---------- AUTO-ASSIGNMENT ----------
        'auto_assign_lookback_days' => [
            'group' => 'Auto-assignment', 'label' => 'Fair rotation look-back (days)',
            'value' => 30, 'unit' => 'days',
            'help'  => 'Sa auto-assign, uunahin ang truck at driver na may pinakakaunting biyahe sa nakaraang ganitong bilang ng araw.',
            'source' => 'PENDING COMPANY CONFIRMATION (C01). The PDF requires automatic assignment but gives no priority rule.',
        ],
    ],

    // -----------------------------------------------------------------
    //  B. MGA LISTAHAN NG COMPUTATION (ITEMS)
    //  Puwedeng magdagdag, mag-alis o magbago sa Formula Settings page.
    // -----------------------------------------------------------------
    'items' => [

        // FUND REQUEST CATEGORIES (preset na halaga).
        // Source: bagong FMS PDF, Scenario B step 4. Pipiliin ng dispatcher ang
        // applicable; ang system ang kukuha ng halaga at magko-compute ng total.
        // Pwedeng magdagdag ang dispatcher ng ibang category sa mismong request.
        // Para magdagdag o magpalit ng preset: Formula Settings > Fund request categories.
        'trip_allowance' => [
            ['name' => 'Forklift Operator', 'calc' => 'fixed', 'amount' => 100, 'source' => 'FMS PDF v2 Scenario B step 4'],
            ['name' => 'Checker', 'calc' => 'fixed', 'amount' => 100, 'source' => 'FMS PDF v2 Scenario B step 4'],
            ['name' => 'Passway', 'calc' => 'fixed', 'amount' => 200, 'source' => 'FMS PDF v2 Scenario B step 4'],
            ['name' => 'Driver Meal Allowance', 'calc' => 'fixed', 'amount' => 300, 'source' => 'FMS PDF v2 Scenario B step 4'],
            ['name' => 'Helper Meal Allowance', 'calc' => 'fixed', 'amount' => 200, 'source' => 'FMS PDF v2 Scenario B step 4'],
        ],

        // Projected Profit and Loss kada biyahe (Billing P&L workbook, column G).
        // Gross Sales = rate ng client. Net Income = Gross Sales - Total Expense.
        'trip_pnl_expense' => [
            ['name' => 'Fuel & Oil', 'calc' => 'fuel', 'amount' => 0, 'source' => 'P&L G26 =G54'],
            ['name' => 'RFID', 'calc' => 'route_toll', 'amount' => 0, 'source' => 'P&L G27'],
            ['name' => 'Miscellaneous Expense - Logistics', 'calc' => 'percent_of_rate', 'amount' => 3, 'source' => 'P&L G28 =G11*0.03'],
            ['name' => 'Miscellaneous Expense - PDI', 'calc' => 'percent_of_rate', 'amount' => 5, 'source' => 'P&L G29 =G11*0.05'],
            ['name' => 'Salaries Basic - Admin', 'calc' => 'fixed', 'amount' => 769.23, 'source' => 'P&L G31 (dummy value, palitan)'],
            ['name' => 'Salaries Basic - Logistics', 'calc' => 'fixed', 'amount' => 1500, 'source' => 'P&L G32 =750*2 (dummy value, palitan)'],
            ['name' => 'Salaries Basic - PDI', 'calc' => 'fixed', 'amount' => 2307.69, 'source' => 'P&L G33 =576.923*4 (dummy value, palitan)'],
        ],

        // Dagdag na kita sa payroll (bukod sa Regular Wage at Trip Pay na automatic).
        // Source: DRIVERS PAYROLL.xlsx columns TRADE TEST, MANUAL PULLOUT, ADJUSTMENT
        'payroll_earning' => [
            ['name' => 'Trade Test', 'calc' => 'manual', 'amount' => 0, 'source' => 'Payroll col I'],
            ['name' => 'Manual Pullout', 'calc' => 'manual', 'amount' => 0, 'source' => 'Payroll col J'],
            ['name' => 'Adjustment', 'calc' => 'manual', 'amount' => 0, 'source' => 'Payroll col K'],
        ],

        // Mga kaltas sa payroll.
        // Source: DRIVERS PAYROLL.xlsx (2026 weekly sheets), columns N to X.
        'payroll_deduction' => [
            ['name' => 'SSS', 'calc' => 'per_day', 'amount' => 775, 'divisor' => 24, 'only_if_attended' => true,
             'source' => 'Payroll N14 =IF(D14="","",(775/24)*D14)'],
            ['name' => 'PhilHealth', 'calc' => 'fixed', 'amount' => 75, 'only_if_attended' => true,
             'source' => 'Payroll O14 =IF(D14<>"",75,"")'],
            ['name' => 'Pag-IBIG Fund', 'calc' => 'fixed', 'amount' => 50, 'only_if_attended' => true,
             'source' => 'Payroll P14 =IF(D14<>"",50,"")'],
            ['name' => 'Pag-IBIG Loan', 'calc' => 'manual', 'amount' => 0, 'source' => 'Payroll col Q'],
            ['name' => 'SSS Loan', 'calc' => 'manual', 'amount' => 0, 'source' => 'Payroll col R'],
            ['name' => 'Late / Absence / Undertime', 'calc' => 'manual', 'amount' => 0, 'source' => 'Payroll col S'],
            ['name' => 'AR EMP - CA', 'calc' => 'ledger', 'ledger' => 'Cash Advance', 'amount' => 0, 'source' => 'Payroll col T (cash advance hulog)'],
            ['name' => 'AR EMP - Uniform', 'calc' => 'ledger', 'ledger' => 'Uniform', 'amount' => 0, 'source' => 'Payroll col U; UNIFORM sheet "500/ SALARY"'],
            ['name' => 'AR EMP - Charges (Damages)', 'calc' => 'ledger', 'ledger' => 'Damages', 'amount' => 0, 'source' => 'Payroll col V; damages sheet'],
            ['name' => 'AR EMP - Rice / Water', 'calc' => 'manual', 'amount' => 0, 'source' => 'Payroll col W'],
            ['name' => 'Savings / Cash Bond', 'calc' => 'fixed', 'amount' => 500, 'only_if_attended' => true, 'ledger' => 'Cash Bond',
             'source' => 'Payroll col X =IF(D<>"",500,""); CASH BOND sheet 500 per week'],
        ],
    ],
];
