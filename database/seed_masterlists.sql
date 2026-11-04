-- =====================================================================
-- Mulawin FleetOps | database/seed_masterlists.sql  (OPTIONAL)
-- Masterlist data taken from the company workbooks given as dummy data:
--   CAR CARRIER MONITORING 2026.xlsx  (truck numbers, plates, DRIVER 1 / DRIVER 2,
--                                      COMPANY NAME, OFFICIAL RECEIPT REGISTRATION sheet)
--   CONTAINER MONITORING 2026.xlsx    (container and wing van trucks, drivers, helpers, companies)
-- Only masterlist data is imported (no trips, no money). Import AFTER schema.sql and extension.sql.
-- Mechanics at the end are FICTIONAL sample records (the workbooks have no mechanic list).
-- Clients start as 'Incomplete': the Operations Head completes the client information sheet
-- and uploads the accreditation files, then Billing sets the rate (PDF #12 Scenario A step 2).
-- =====================================================================
SET NAMES utf8mb4;

INSERT INTO personnel (full_name, person_type, notes) VALUES
  ('AMARILLIO, JOHN ERICSON', 'Driver', 'Imported from monitoring workbook'),
  ('ARISGAR, RAY', 'Driver', 'Imported from monitoring workbook'),
  ('ARLAN, JEFFERY', 'Driver', 'Imported from monitoring workbook'),
  ('AUREADA, JIMSON', 'Driver', 'Imported from monitoring workbook'),
  ('BASAY, IRENEO', 'Driver', 'Imported from monitoring workbook'),
  ('BAYLIN, JONARD', 'Driver', 'Imported from monitoring workbook'),
  ('BAYOT, JONATHAN', 'Driver', 'Imported from monitoring workbook'),
  ('BORBON, RONALD', 'Driver', 'Imported from monitoring workbook'),
  ('BULATAO, ROBERT', 'Driver', 'Imported from monitoring workbook'),
  ('BULATAO, ROLANDO', 'Driver', 'Imported from monitoring workbook'),
  ('CABINGAS, MARCELO', 'Driver', 'Imported from monitoring workbook'),
  ('CANARIA, ALEX', 'Driver', 'Imported from monitoring workbook'),
  ('CAPIRAL, EDWIN', 'Driver', 'Imported from monitoring workbook'),
  ('CASTOLOME, CLAUDIO JR.', 'Driver', 'Imported from monitoring workbook'),
  ('CELESTRA, LOLITO', 'Driver', 'Imported from monitoring workbook'),
  ('CULMINAS, JOSEPH', 'Driver', 'Imported from monitoring workbook'),
  ('DAYSO, MARLON', 'Driver', 'Imported from monitoring workbook'),
  ('DAYSON, MARLON', 'Driver', 'Imported from monitoring workbook'),
  ('DELA PEÑA, JAY', 'Driver', 'Imported from monitoring workbook'),
  ('DUETES, PROCESO', 'Driver', 'Imported from monitoring workbook'),
  ('EUGENIO, GERALD', 'Driver', 'Imported from monitoring workbook'),
  ('FABITO, GLEN', 'Driver', 'Imported from monitoring workbook'),
  ('FEDERICO, RONNIE', 'Driver', 'Imported from monitoring workbook'),
  ('FLANG, ROLLY', 'Driver', 'Imported from monitoring workbook'),
  ('GACILO, RICARDO', 'Driver', 'Imported from monitoring workbook'),
  ('GARCIA, RODELIO', 'Driver', 'Imported from monitoring workbook'),
  ('HERNANDEZ, ROTCHIE', 'Driver', 'Imported from monitoring workbook'),
  ('JARAP, MICHEAL', 'Driver', 'Imported from monitoring workbook'),
  ('JUEGOS, HECTOR', 'Driver', 'Imported from monitoring workbook'),
  ('LEGASPI, PONCIANO', 'Driver', 'Imported from monitoring workbook'),
  ('LERON, JOHNSON', 'Driver', 'Imported from monitoring workbook'),
  ('LORA, MARLON', 'Driver', 'Imported from monitoring workbook'),
  ('MARTICIO, ADRIANO', 'Driver', 'Imported from monitoring workbook'),
  ('MASANGKAY, MARTINIANO', 'Driver', 'Imported from monitoring workbook'),
  ('MAYORDO, ARNOLD', 'Driver', 'Imported from monitoring workbook'),
  ('NAVARRO, GEORGE ANTHONY', 'Driver', 'Imported from monitoring workbook'),
  ('OQUE, MARKGEMS', 'Driver', 'Imported from monitoring workbook'),
  ('ORDINARIO, JONATHAN', 'Driver', 'Imported from monitoring workbook'),
  ('PALEN, JOEL', 'Driver', 'Imported from monitoring workbook'),
  ('PAMPLONA, ALEX', 'Driver', 'Imported from monitoring workbook'),
  ('PAMPLONA, EDWARD', 'Driver', 'Imported from monitoring workbook'),
  ('PAMPLONA, RYAN', 'Driver', 'Imported from monitoring workbook'),
  ('PANSOY, GABRIEL', 'Driver', 'Imported from monitoring workbook'),
  ('PONCE, JONATHAN', 'Driver', 'Imported from monitoring workbook'),
  ('RABANO, LESTER', 'Driver', 'Imported from monitoring workbook'),
  ('RELIN, JOSE', 'Driver', 'Imported from monitoring workbook'),
  ('RESTAURO, ALJON', 'Driver', 'Imported from monitoring workbook'),
  ('RONQUILLO, CARMELO', 'Driver', 'Imported from monitoring workbook'),
  ('RUBIA, JOSEPH', 'Driver', 'Imported from monitoring workbook'),
  ('RUBIA, RICKY', 'Driver', 'Imported from monitoring workbook'),
  ('SENDIN, JOEL', 'Driver', 'Imported from monitoring workbook'),
  ('SICAL, ANDRES', 'Driver', 'Imported from monitoring workbook'),
  ('SOGUILON, ARJAY', 'Driver', 'Imported from monitoring workbook'),
  ('SOGUILON, ARNOLD', 'Driver', 'Imported from monitoring workbook'),
  ('SOTOMAYOR, ADONIS', 'Driver', 'Imported from monitoring workbook'),
  ('SUMBILON, ARNEIL', 'Driver', 'Imported from monitoring workbook'),
  ('TANTIADO, JONATHAN', 'Driver', 'Imported from monitoring workbook'),
  ('TOMOCO, ARIEL', 'Driver', 'Imported from monitoring workbook'),
  ('URQUIZA, RAY', 'Driver', 'Imported from monitoring workbook'),
  ('VELASQUEZ, GEORGE', 'Driver', 'Imported from monitoring workbook'),
  ('VIDALLO, VIRON', 'Driver', 'Imported from monitoring workbook'),
  ('VILLEGAS, FLORENCIO', 'Driver', 'Imported from monitoring workbook'),
  ('ALEGADO, ANDRO', 'Helper', 'Imported from monitoring workbook'),
  ('ANARNA, JOSE', 'Helper', 'Imported from monitoring workbook'),
  ('BALATERO, ALGEN', 'Helper', 'Imported from monitoring workbook'),
  ('BLANCO, NELSON', 'Helper', 'Imported from monitoring workbook'),
  ('BONDAD, RUEL', 'Helper', 'Imported from monitoring workbook'),
  ('CARANDANG, LEO', 'Helper', 'Imported from monitoring workbook'),
  ('HIBEK, GIAN', 'Helper', 'Imported from monitoring workbook'),
  ('LARA, WARREN', 'Helper', 'Imported from monitoring workbook'),
  ('LEGASPI, MOISES', 'Helper', 'Imported from monitoring workbook'),
  ('LEOTIMAR, JOHN MICHEAL', 'Helper', 'Imported from monitoring workbook'),
  ('NARVACAN, RONNEL', 'Helper', 'Imported from monitoring workbook'),
  ('ORZO, MARVIN', 'Helper', 'Imported from monitoring workbook'),
  ('ORZO, VON CHRISTIAN', 'Helper', 'Imported from monitoring workbook'),
  ('PLARISAN, JOHN CHRYSTLER', 'Helper', 'Imported from monitoring workbook'),
  ('QUIMIO, ALBERT', 'Helper', 'Imported from monitoring workbook'),
  ('SABA, MAURICIO', 'Helper', 'Imported from monitoring workbook'),
  ('SEVESTER, MARK DIREK', 'Helper', 'Imported from monitoring workbook'),
  ('SILVESTRE, MARK DEREK', 'Helper', 'Imported from monitoring workbook');

INSERT INTO vehicles (truck_number, plate_number, truck_type, make_brand, chassis_number, mv_file_number, registration_expiry, notes) VALUES
  ('15', 'CBR4141', 'Car Carrier', NULL, NULL, '41494', '2026-01-31', 'Imported from monitoring workbook'),
  ('4', 'NBA1770', 'Car Carrier', NULL, 'ED51L3-3000010', '1301-00000962631', '2026-10-31', 'Imported from monitoring workbook'),
  ('25', 'CCB8110', 'Car Carrier', NULL, NULL, '74296', '2026-10-31', 'Imported from monitoring workbook'),
  ('23', 'CBS5262', 'Car Carrier', NULL, NULL, '55306', '2026-02-28', 'Imported from monitoring workbook'),
  ('24', 'CCB7533', 'Car Carrier', NULL, NULL, '73193', '2026-03-31', 'Imported from monitoring workbook'),
  ('28', 'CCE5402', 'Car Carrier', NULL, NULL, NULL, '2026-02-28', 'Imported from monitoring workbook'),
  ('12', 'NGS9642', 'Car Carrier', NULL, NULL, '1625367', '2026-02-28', 'Imported from monitoring workbook'),
  ('10', 'CBN3048', 'Car Carrier', NULL, NULL, '11838', '2026-08-31', 'Imported from monitoring workbook'),
  ('19', 'CBA2403', 'Car Carrier', NULL, NULL, '62725', '2026-03-31', 'Imported from monitoring workbook'),
  ('9', 'CBJ7926', 'Car Carrier', NULL, NULL, '7741', '2026-06-30', 'Imported from monitoring workbook'),
  ('5', 'NBJ8825', 'Car Carrier', NULL, NULL, '560382', '2026-05-31', 'Imported from monitoring workbook'),
  ('6', 'NAJ5941', 'Car Carrier', NULL, NULL, '1098052', '2026-01-31', 'Imported from monitoring workbook'),
  ('22', 'CCE3624', 'Car Carrier', 'ISUZU', '6WG1-404340', '0389-00000071904', '2026-04-30', 'Imported from monitoring workbook'),
  ('17', 'CBR7449', 'Car Carrier', NULL, NULL, '44978', '2026-09-30', 'Imported from monitoring workbook'),
  ('11', 'CBN1490', 'Car Carrier', NULL, NULL, '10138', '2026-10-31', 'Imported from monitoring workbook'),
  ('1', 'NAT3428', 'Container', NULL, 'EX81G2-3000007', '1301-00000923405', '2026-08-31', 'Imported from monitoring workbook'),
  ('3', 'NBB7647', 'Container', NULL, 'SH1KGG-10330', '1301-00000992247', '2026-07-31', 'Imported from monitoring workbook'),
  ('7', 'NDL4494', 'Container', 'HINO', 'E13C-UA13802', '1301-00001404009', '2026-04-30', 'Imported from monitoring workbook'),
  ('8', 'CBJ4550', 'Container', 'HINO', NULL, '3826', '2026-10-31', 'Imported from monitoring workbook'),
  ('20', 'CCE3796', 'Container', 'HINO', NULL, '72342', '2026-06-30', 'Imported from monitoring workbook'),
  ('21', 'CCE3646', 'Container', 'HINO', NULL, '72341', '2026-06-30', 'Imported from monitoring workbook'),
  ('27', 'CCB7424', 'Container', 'HINO', 'SH1EGX-10209', '0389-00000073101', '2026-04-30', 'Imported from monitoring workbook'),
  ('W1', 'CCP6082', 'Wing Van', NULL, 'CYJ77A-7002494', '0389-00000092994', '2026-02-28', 'Imported from monitoring workbook'),
  ('W2', 'CCP9344', 'Wing Van', 'ISUZU', 'CYJ77A-7011756', '0389-00000097302', '2026-04-30', 'Imported from monitoring workbook'),
  ('W3', 'CCP7483', 'Wing Van', NULL, 'CYJ77A-7003804', '0389-00000094851', '2026-03-31', 'Imported from monitoring workbook'),
  ('W4', 'NIE2795', 'Wing Van', NULL, 'CYJ77W8-7003498', '1301-00001894211', '2026-05-31', 'Imported from monitoring workbook'),
  ('W5', 'CCE8929', 'Wing Van', NULL, 'FR1EXY-10308', '0389-00000080803', '2026-09-30', 'Imported from monitoring workbook'),
  ('W6', 'CCP7214', 'Wing Van', 'HINO', 'FR1EXW-033551', '0389-00000094519', '2026-04-30', 'Imported from monitoring workbook'),
  ('W7', 'CBG8433', 'Wing Van', NULL, 'FR1EXE-10118', '0389-00000109360', '2026-03-31', 'Imported from monitoring workbook');

-- Regular driver / helper of each truck (most frequent pairing in the workbooks).
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='LERON, JOHNSON' AND person_type='Driver') WHERE plate_number='CBR4141';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='ORDINARIO, JONATHAN' AND person_type='Driver') WHERE plate_number='NBA1770';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='MASANGKAY, MARTINIANO' AND person_type='Driver') WHERE plate_number='CCB8110';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='BULATAO, ROLANDO' AND person_type='Driver') WHERE plate_number='CBS5262';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='SOTOMAYOR, ADONIS' AND person_type='Driver') WHERE plate_number='CCB7533';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='GARCIA, RODELIO' AND person_type='Driver') WHERE plate_number='CCE5402';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='BAYOT, JONATHAN' AND person_type='Driver') WHERE plate_number='NGS9642';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='FABITO, GLEN' AND person_type='Driver') WHERE plate_number='CBN3048';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='MARTICIO, ADRIANO' AND person_type='Driver') WHERE plate_number='CBA2403';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='BULATAO, ROBERT' AND person_type='Driver') WHERE plate_number='CBJ7926';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='MAYORDO, ARNOLD' AND person_type='Driver') WHERE plate_number='NBJ8825';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='JUEGOS, HECTOR' AND person_type='Driver') WHERE plate_number='NAJ5941';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='EUGENIO, GERALD' AND person_type='Driver') WHERE plate_number='CCE3624';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='RONQUILLO, CARMELO' AND person_type='Driver') WHERE plate_number='CBR7449';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='DUETES, PROCESO' AND person_type='Driver') WHERE plate_number='CBN1490';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='BASAY, IRENEO' AND person_type='Driver') WHERE plate_number='NBB7647';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='BONDAD, RUEL' AND person_type='Helper') WHERE plate_number='NBB7647';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='CULMINAS, JOSEPH' AND person_type='Driver') WHERE plate_number='CBJ4550';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='ANARNA, JOSE' AND person_type='Helper') WHERE plate_number='CBJ4550';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='NAVARRO, GEORGE ANTHONY' AND person_type='Driver') WHERE plate_number='CCE3796';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='LEGASPI, MOISES' AND person_type='Helper') WHERE plate_number='CCE3796';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='ARISGAR, RAY' AND person_type='Driver') WHERE plate_number='CCE3646';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='PLARISAN, JOHN CHRYSTLER' AND person_type='Helper') WHERE plate_number='CCE3646';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='OQUE, MARKGEMS' AND person_type='Driver') WHERE plate_number='CCB7424';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='ORZO, VON CHRISTIAN' AND person_type='Helper') WHERE plate_number='CCB7424';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='CANARIA, ALEX' AND person_type='Driver') WHERE plate_number='CCP6082';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='BLANCO, NELSON' AND person_type='Helper') WHERE plate_number='CCP6082';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='RUBIA, RICKY' AND person_type='Driver') WHERE plate_number='CCP9344';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='ORZO, MARVIN' AND person_type='Helper') WHERE plate_number='CCP9344';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='RUBIA, JOSEPH' AND person_type='Driver') WHERE plate_number='NIE2795';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='ALEGADO, ANDRO' AND person_type='Helper') WHERE plate_number='NIE2795';
UPDATE vehicles SET assigned_driver_id=(SELECT id FROM personnel WHERE full_name='RESTAURO, ALJON' AND person_type='Driver') WHERE plate_number='CCE8929';
UPDATE vehicles SET assigned_helper_id=(SELECT id FROM personnel WHERE full_name='BALATERO, ALGEN' AND person_type='Helper') WHERE plate_number='CCE8929';

INSERT INTO clients (client_code, company_name, status, notes) VALUES
  ('CL-001', 'UAGGI', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-002', 'RVL MOVERS', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-003', 'MDEX', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-004', 'FUJITRANS', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-005', 'BERMAZ', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-006', 'BRITISH', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-007', 'KLINE', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-008', 'LUXURIANT', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-009', 'DYNAMIC TRIO', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-010', 'SF EXPRESS', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-011', 'CJ SMART FREIGHT, INC.', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-012', 'SECURED LOGISTICS & BROKERAGE SPECIALISTS, INC.', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.'),
  ('CL-013', 'JMSJ CUSTOMS BROKERAGE AND LOGISTICS, INC.', 'Incomplete', 'Imported from monitoring workbook. Complete the client information sheet and accreditation files.');

-- Mechanic Masterlist (fictional sample mechanics for corrective maintenance; edit or deactivate as needed)
INSERT INTO mechanics (mechanic_code, full_name, contact_number, specialization, notes) VALUES
  ('MEC-001', 'DELA CRUZ, ROMEO', '0917 555 0101', 'Engine and transmission', 'Sample record'),
  ('MEC-002', 'VILLANUEVA, ARNEL', '0918 555 0102', 'Electrical and lighting', 'Sample record'),
  ('MEC-003', 'MENDOZA, JOEL', '0919 555 0103', 'Brakes and suspension', 'Sample record'),
  ('MEC-004', 'PASCUAL, DANILO', '0920 555 0104', 'Welding and body repair', 'Sample record'),
  ('MEC-005', 'RAMOS, EDGARDO', '0921 555 0105', 'Tires and wheel alignment', 'Sample record'),
  ('MEC-006', 'SALAZAR, BENJIE', '0922 555 0106', 'Air conditioning and cooling', 'Sample record'),
  ('MEC-007', 'TORRES, NOEL', '0923 555 0107', 'Hydraulics (car carrier ramps)', 'Sample record'),
  ('MEC-008', 'AQUINO, RENATO', '0924 555 0108', 'General mechanic', 'Sample record');
