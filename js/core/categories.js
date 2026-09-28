// categories.js — Schweizer Kategorienbaum (Deutsch) und Startregeln
// Die IDs sind stabil, damit Regeln und Budgets sie referenzieren können.

export const DEFAULT_CATEGORY_GROUPS = [
  { id: 'g_einkommen', name: 'Einkommen', color: 'var(--series-6)', icon: '💰', kind: 'einnahme' },
  { id: 'g_wohnen', name: 'Wohnen & Nebenkosten', color: 'var(--series-1)', icon: '🏠', kind: 'ausgabe' },
  { id: 'g_versicherung', name: 'Versicherungen & Gesundheit', color: 'var(--series-7)', icon: '🩺', kind: 'ausgabe' },
  { id: 'g_mobilitaet', name: 'Mobilität', color: 'var(--series-3)', icon: '🚗', kind: 'ausgabe' },
  { id: 'g_haushalt', name: 'Lebensmittel & Haushalt', color: 'var(--series-2)', icon: '🛒', kind: 'ausgabe' },
  { id: 'g_persoenlich', name: 'Persönliches', color: 'var(--series-4)', icon: '👤', kind: 'ausgabe' },
  { id: 'g_freizeit', name: 'Freizeit & Reisen', color: 'var(--series-5)', icon: '🌍', kind: 'ausgabe' },
  { id: 'g_familie', name: 'Familie & Bildung', color: 'var(--series-8)', icon: '🎓', kind: 'ausgabe' },
  { id: 'g_abgaben', name: 'Steuern, Gebühren & Abgaben', color: 'var(--ink-muted)', icon: '🏛️', kind: 'ausgabe' },
  { id: 'g_sparen', name: 'Sparen & Vorsorge', color: 'var(--series-1)', icon: '📈', kind: 'ausgabe' },
  { id: 'g_transfer', name: 'Überträge', color: 'var(--ink-muted)', icon: '🔁', kind: 'transfer' },
  { id: 'g_sonstiges', name: 'Sonstiges', color: 'var(--ink-muted)', icon: '❓', kind: 'ausgabe' },
];

const C = (id, name, groupId, budgetType, icon, extra = {}) => ({
  id, name, groupId, budgetType, icon,
  kind: budgetType === 'einkommen' ? 'einnahme' : budgetType === 'transfer' ? 'transfer' : 'ausgabe',
  rollover: false, annualAmount: null, archived: false, ...extra,
});

export const DEFAULT_CATEGORIES = [
  // Einkommen
  C('c_lohn', 'Lohn', 'g_einkommen', 'einkommen', '💼'),
  C('c_lohn_partner', 'Lohn Partner/in', 'g_einkommen', 'einkommen', '💼'),
  C('c_bonus', 'Bonus & 13. Monatslohn', 'g_einkommen', 'einkommen', '🎁'),
  C('c_nebenerwerb', 'Nebenerwerb', 'g_einkommen', 'einkommen', '🛠️'),
  C('c_kapitalertrag', 'Zinsen & Dividenden', 'g_einkommen', 'einkommen', '📊'),
  C('c_rueckerstattung', 'Rückerstattungen', 'g_einkommen', 'einkommen', '↩️'),
  C('c_zulagen', 'Familienzulagen & Beiträge', 'g_einkommen', 'einkommen', '👶'),
  C('c_einkommen_sonstige', 'Übrige Einnahmen', 'g_einkommen', 'einkommen', '➕'),

  // Wohnen
  C('c_miete', 'Miete / Hypothekarzins', 'g_wohnen', 'fix', '🔑'),
  C('c_nebenkosten', 'Nebenkosten & Heizung', 'g_wohnen', 'fix', '🔥'),
  C('c_strom', 'Strom', 'g_wohnen', 'fix', '💡'),
  C('c_wasser', 'Wasser & Abwasser', 'g_wohnen', 'unregelmaessig', '🚿'),
  C('c_serafe', 'Serafe (Radio/TV)', 'g_wohnen', 'unregelmaessig', '📻', { annualAmount: 335 }),
  C('c_internet', 'Internet & TV', 'g_wohnen', 'fix', '🌐'),
  C('c_mobile', 'Mobiltelefon', 'g_wohnen', 'fix', '📱'),
  C('c_einrichtung', 'Möbel & Einrichtung', 'g_wohnen', 'flex', '🛋️'),
  C('c_hausrat_unterhalt', 'Unterhalt & Reparaturen', 'g_wohnen', 'unregelmaessig', '🔧'),
  C('c_reinigung', 'Reinigung & Garten', 'g_wohnen', 'flex', '🧹'),

  // Versicherungen & Gesundheit
  C('c_krankenkasse', 'Krankenkasse Grundversicherung', 'g_versicherung', 'fix', '🏥'),
  C('c_zusatzversicherung', 'Zusatzversicherung', 'g_versicherung', 'fix', '➕'),
  C('c_selbstbehalt', 'Franchise & Selbstbehalt', 'g_versicherung', 'unregelmaessig', '🧾'),
  C('c_arzt', 'Arzt & Zahnarzt', 'g_versicherung', 'unregelmaessig', '🦷'),
  C('c_apotheke', 'Apotheke & Drogerie', 'g_versicherung', 'flex', '💊'),
  C('c_haftpflicht', 'Haftpflicht & Hausrat', 'g_versicherung', 'unregelmaessig', '🛡️'),
  C('c_lebensversicherung', 'Lebensversicherung', 'g_versicherung', 'fix', '📄'),
  C('c_therapie', 'Therapie & Prävention', 'g_versicherung', 'flex', '🧘'),

  // Mobilität
  C('c_oev', 'ÖV & SBB', 'g_mobilitaet', 'fix', '🚆'),
  C('c_benzin', 'Treibstoff & Laden', 'g_mobilitaet', 'flex', '⛽'),
  C('c_autoversicherung', 'Auto-Versicherung', 'g_mobilitaet', 'unregelmaessig', '🚙'),
  C('c_autosteuer', 'Motorfahrzeugsteuer', 'g_mobilitaet', 'unregelmaessig', '🏷️'),
  C('c_autoservice', 'Service, Reifen & Reparatur', 'g_mobilitaet', 'unregelmaessig', '🔩'),
  C('c_parking', 'Parking & Vignette', 'g_mobilitaet', 'flex', '🅿️'),
  C('c_taxi', 'Taxi, Uber & Sharing', 'g_mobilitaet', 'flex', '🚕'),
  C('c_autokauf', 'Fahrzeugkauf & Leasing', 'g_mobilitaet', 'fix', '🚗'),
  C('c_velo', 'Velo & E-Bike', 'g_mobilitaet', 'flex', '🚲'),

  // Lebensmittel & Haushalt
  C('c_lebensmittel', 'Lebensmittel', 'g_haushalt', 'flex', '🛒'),
  C('c_restaurant', 'Restaurants & Take-away', 'g_haushalt', 'flex', '🍽️'),
  C('c_kaffee', 'Kaffee & Snacks', 'g_haushalt', 'flex', '☕'),
  C('c_haushaltsartikel', 'Haushaltsartikel', 'g_haushalt', 'flex', '🧴'),
  C('c_alkohol', 'Getränke & Alkohol', 'g_haushalt', 'flex', '🍷'),

  // Persönliches
  C('c_kleidung', 'Kleidung & Schuhe', 'g_persoenlich', 'flex', '👕'),
  C('c_koerperpflege', 'Coiffeur & Körperpflege', 'g_persoenlich', 'flex', '💇'),
  C('c_sport', 'Sport & Fitness', 'g_persoenlich', 'fix', '🏃'),
  C('c_hobby', 'Hobbys', 'g_persoenlich', 'flex', '🎨'),
  C('c_abos', 'Abos & Digitales', 'g_persoenlich', 'fix', '📺'),
  C('c_geschenke', 'Geschenke', 'g_persoenlich', 'unregelmaessig', '🎁'),
  C('c_spenden', 'Spenden', 'g_persoenlich', 'fix', '❤️'),
  C('c_technik', 'Elektronik & Technik', 'g_persoenlich', 'unregelmaessig', '💻'),

  // Freizeit & Reisen
  C('c_ferien', 'Ferien & Reisen', 'g_freizeit', 'unregelmaessig', '✈️'),
  C('c_ausflug', 'Ausflüge & Wochenende', 'g_freizeit', 'flex', '🥾'),
  C('c_kultur', 'Kultur & Events', 'g_freizeit', 'flex', '🎭'),
  C('c_ausgang', 'Ausgang & Bar', 'g_freizeit', 'flex', '🍸'),
  C('c_haustier', 'Haustiere', 'g_freizeit', 'flex', '🐾'),

  // Familie & Bildung
  C('c_kinderbetreuung', 'Kinderbetreuung', 'g_familie', 'fix', '🧸'),
  C('c_schule', 'Schule & Material', 'g_familie', 'unregelmaessig', '🎒'),
  C('c_weiterbildung', 'Weiterbildung', 'g_familie', 'unregelmaessig', '📚'),
  C('c_unterhaltszahlung', 'Unterhaltsbeiträge', 'g_familie', 'fix', '👨‍👩‍👧'),

  // Steuern, Gebühren & Abgaben
  C('c_steuern_kanton', 'Staats- & Gemeindesteuern', 'g_abgaben', 'unregelmaessig', '🏛️'),
  C('c_steuern_bund', 'Direkte Bundessteuer', 'g_abgaben', 'unregelmaessig', '🇨🇭'),
  C('c_bankgebuehren', 'Bank- & Kartengebühren', 'g_abgaben', 'fix', '🏦'),
  C('c_zinsen', 'Schuldzinsen', 'g_abgaben', 'fix', '📉'),
  C('c_ahv', 'AHV / Sozialabgaben', 'g_abgaben', 'fix', '📋'),
  C('c_gebuehren', 'Amtliche Gebühren', 'g_abgaben', 'unregelmaessig', '📑'),

  // Sparen & Vorsorge
  C('c_saeule3a', 'Säule 3a', 'g_sparen', 'sparen', '🏦'),
  C('c_saeule2', 'Pensionskasse-Einkauf', 'g_sparen', 'sparen', '🏛️'),
  C('c_sparen', 'Sparen allgemein', 'g_sparen', 'sparen', '🐖'),
  C('c_investition', 'Wertschriften-Käufe', 'g_sparen', 'sparen', '📈'),
  C('c_sparziel', 'Einzahlung Sparziel', 'g_sparen', 'sparen', '🎯'),

  // Überträge
  C('c_umbuchung', 'Interne Umbuchung', 'g_transfer', 'transfer', '🔁'),
  C('c_kk_zahlung', 'Kreditkarten-Zahlung', 'g_transfer', 'transfer', '💳'),
  C('c_bargeldbezug', 'Bargeldbezug', 'g_transfer', 'transfer', '🏧'),

  // Sonstiges
  C('c_unkategorisiert', 'Nicht zugeordnet', 'g_sonstiges', 'flex', '❓'),
  C('c_sonstige_ausgaben', 'Übrige Ausgaben', 'g_sonstiges', 'flex', '➖'),
];

export const UNCATEGORIZED_ID = 'c_unkategorisiert';

/* ------------------------------------------------------------------
 * Startregeln
 * Reihenfolge = Priorität (kleiner sort gewinnt).
 * field: payee | description | merchantCategory | rawText | amount | account
 * ------------------------------------------------------------------ */

const R = (name, field, op, value, categoryId, extra = {}) => ({
  id: `sys_${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
  name, match: 'all',
  conditions: [{ field, op, value }],
  actions: { categoryId, ...(extra.actions || {}) },
  sort: extra.sort ?? 500,
});

// 1) Präzise Zahlungsempfänger (höchste Priorität)
const payeeRules = [
  // Überträge / Karten
  ['TopCard / Viseca', 'topcard', 'c_kk_zahlung', 10],
  ['Viseca', 'viseca', 'c_kk_zahlung', 10],
  ['Cornèrcard', 'cornercard', 'c_kk_zahlung', 10],
  ['Swisscard', 'swisscard', 'c_kk_zahlung', 10],
  ['American Express', 'american express', 'c_kk_zahlung', 10],
  ['Cembra / Certo', 'cembra', 'c_kk_zahlung', 10],
  ['Certo Card', 'certo', 'c_kk_zahlung', 10],
  ['Bonus Card', 'bonuscard', 'c_kk_zahlung', 10],

  // Vorsorge & Anlage
  ['finpension', 'finpension', 'c_saeule3a', 20],
  ['VIAC', 'viac', 'c_saeule3a', 20],
  ['frankly', 'frankly', 'c_saeule3a', 20],
  ['Säule 3a', 'saeule 3a', 'c_saeule3a', 20],
  ['3a Retirement', '3a retirement', 'c_saeule3a', 20],
  ['Interactive Brokers', 'interactive brokers', 'c_investition', 20],
  ['Swissquote', 'swissquote', 'c_investition', 20],
  ['Saxo', 'saxo bank', 'c_investition', 20],
  ['True Wealth', 'true wealth', 'c_investition', 20],
  ['Selma', 'selma finance', 'c_investition', 20],

  // Krankenkassen
  ['CSS', 'css versicherung', 'c_krankenkasse', 30],
  ['Helsana', 'helsana', 'c_krankenkasse', 30],
  ['Swica', 'swica', 'c_krankenkasse', 30],
  ['Sanitas', 'sanitas', 'c_krankenkasse', 30],
  ['Assura', 'assura', 'c_krankenkasse', 30],
  ['Concordia', 'concordia', 'c_krankenkasse', 30],
  ['Visana', 'visana', 'c_krankenkasse', 30],
  ['Atupri', 'atupri', 'c_krankenkasse', 30],
  ['KPT', 'kpt', 'c_krankenkasse', 30],
  ['Sympany', 'sympany', 'c_krankenkasse', 30],
  ['Groupe Mutuel', 'groupe mutuel', 'c_krankenkasse', 30],
  ['ÖKK', 'oekk', 'c_krankenkasse', 30],
  ['Agrisano', 'agrisano', 'c_krankenkasse', 30],

  // Übrige Versicherungen
  ['AXA', 'axa', 'c_haftpflicht', 35],
  ['Zurich Versicherung', 'zurich versicherung', 'c_haftpflicht', 35],
  ['Mobiliar', 'mobiliar', 'c_haftpflicht', 35],
  ['Allianz', 'allianz', 'c_haftpflicht', 35],
  ['Baloise', 'baloise', 'c_haftpflicht', 35],
  ['Generali', 'generali', 'c_haftpflicht', 35],
  ['Smile', 'smile direct', 'c_autoversicherung', 35],
  ['TCS', 'tcs', 'c_autoversicherung', 35],

  // Telekom & Medien
  ['Swisscom', 'swisscom', 'c_internet', 40],
  ['Sunrise', 'sunrise', 'c_internet', 40],
  ['Salt', 'salt mobile', 'c_mobile', 40],
  ['Wingo', 'wingo', 'c_mobile', 40],
  ['Yallo', 'yallo', 'c_mobile', 40],
  ['CHmobile', 'chmobile', 'c_mobile', 40],
  ['mobilezone', 'mobilezone', 'c_technik', 40],
  ['Serafe', 'serafe', 'c_serafe', 40],
  ['Netflix', 'netflix', 'c_abos', 40],
  ['Spotify', 'spotify', 'c_abos', 40],
  ['Disney+', 'disney', 'c_abos', 40],
  ['Apple', 'apple.com', 'c_abos', 40],
  ['Google', 'google *', 'c_abos', 40],
  ['Microsoft', 'microsoft', 'c_abos', 40],
  ['Amazon Prime', 'amazon prime', 'c_abos', 40],
  ['Blue / Sky', 'blue entertainment', 'c_abos', 40],

  // Energie & Wohnen
  ['EWZ', 'ewz', 'c_strom', 45],
  ['Elektrizitätswerk', 'elektrizit', 'c_strom', 45],
  ['Energie', 'energie ', 'c_strom', 45],
  ['IKEA', 'ikea', 'c_einrichtung', 45],
  ['Pfister', 'pfister', 'c_einrichtung', 45],
  ['Micasa', 'micasa', 'c_einrichtung', 45],
  ['Jumbo', 'jumbo', 'c_hausrat_unterhalt', 45],
  ['Hornbach', 'hornbach', 'c_hausrat_unterhalt', 45],
  ['Bauhaus', 'bauhaus', 'c_hausrat_unterhalt', 45],
  ['Obi', 'obi ', 'c_hausrat_unterhalt', 45],

  // Lebensmittel
  ['Coop', 'coop', 'c_lebensmittel', 50],
  ['Migros', 'migros', 'c_lebensmittel', 50],
  ['Denner', 'denner', 'c_lebensmittel', 50],
  ['Aldi', 'aldi', 'c_lebensmittel', 50],
  ['Lidl', 'lidl', 'c_lebensmittel', 50],
  ['Volg', 'volg', 'c_lebensmittel', 50],
  ['Spar', 'spar ', 'c_lebensmittel', 50],
  ['Alnatura', 'alnatura', 'c_lebensmittel', 50],
  ['Bäckerei', 'baeckerei', 'c_kaffee', 50],
  ['Coop Pronto', 'coop pronto', 'c_benzin', 48],
  ['Coop Vitality', 'coop vitality', 'c_apotheke', 48],
  ['Coop Restaurant', 'coop restaurant', 'c_restaurant', 48],

  // Gastro
  ['McDonalds', 'mcdonald', 'c_restaurant', 55],
  ['Starbucks', 'starbucks', 'c_kaffee', 55],
  ['Burger King', 'burger king', 'c_restaurant', 55],
  ['Restaurant', 'restaurant', 'c_restaurant', 60],
  ['Pizzeria', 'pizzeria', 'c_restaurant', 60],
  ['Café', 'cafe ', 'c_kaffee', 60],
  ['Kaffee', 'coffee', 'c_kaffee', 60],
  ['Bar', 'bar ', 'c_ausgang', 62],
  ['Lindt Shop', 'lindt', 'c_kaffee', 55],

  // Mobilität
  ['SBB', 'sbb', 'c_oev', 55],
  ['ZVV', 'zvv', 'c_oev', 55],
  ['Postauto', 'postauto', 'c_oev', 55],
  ['VBZ', 'vbz', 'c_oev', 55],
  ['Socar', 'socar', 'c_benzin', 55],
  ['Shell', 'shell', 'c_benzin', 55],
  ['BP Tankstelle', 'bp ', 'c_benzin', 55],
  ['Avia', 'avia', 'c_benzin', 55],
  ['Agrola', 'agrola', 'c_benzin', 55],
  ['Migrol', 'migrol', 'c_benzin', 55],
  ['Tamoil', 'tamoil', 'c_benzin', 55],
  ['Parkhaus', 'parkhaus', 'c_parking', 55],
  ['Parking', 'parking', 'c_parking', 55],
  ['Mobility', 'mobility', 'c_taxi', 55],
  ['Uber', 'uber', 'c_taxi', 55],
  ['Autohändler', 'auto zueri', 'c_autoservice', 55],
  ['Strassenverkehrsamt', 'strassenverkehrsamt', 'c_autosteuer', 55],

  // Detailhandel / Persönliches
  ['Galaxus', 'galaxus', 'c_technik', 60],
  ['Digitec', 'digitec', 'c_technik', 60],
  ['Interdiscount', 'interdiscount', 'c_technik', 60],
  ['Melectronics', 'melectronics', 'c_technik', 60],
  ['Zalando', 'zalando', 'c_kleidung', 60],
  ['H&M', 'h & m', 'c_kleidung', 60],
  ['C&A', 'c & a', 'c_kleidung', 60],
  ['Zara', 'zara', 'c_kleidung', 60],
  ['Globus', 'globus', 'c_kleidung', 62],
  ['Manor', 'manor', 'c_kleidung', 62],
  ['Ochsner', 'ochsner', 'c_kleidung', 60],
  ['Dosenbach', 'dosenbach', 'c_kleidung', 60],
  ['Müller Drogerie', 'mueller ', 'c_apotheke', 60],
  ['Apotheke', 'apotheke', 'c_apotheke', 60],
  ['Coiffeur', 'coiffeur', 'c_koerperpflege', 60],
  ['Fitness', 'fitness', 'c_sport', 60],
  ['Migros Fitness', 'activ fitness', 'c_sport', 58],
  ['Decathlon', 'decathlon', 'c_sport', 60],
  ['Ticketino', 'ticketino', 'c_kultur', 60],
  ['Ticketcorner', 'ticketcorner', 'c_kultur', 60],
  ['Kino', 'kino', 'c_kultur', 60],
  ['Booking.com', 'booking.com', 'c_ferien', 60],
  ['Airbnb', 'airbnb', 'c_ferien', 60],
  ['SWISS Flug', 'swiss int', 'c_ferien', 60],
  ['Hotelplan', 'hotelplan', 'c_ferien', 60],

  // Steuern & Gebühren
  ['Steueramt', 'steueramt', 'c_steuern_kanton', 30],
  ['Steuerverwaltung', 'steuerverwaltung', 'c_steuern_kanton', 30],
  ['Bundessteuer', 'bundessteuer', 'c_steuern_bund', 30],
  ['Ausgleichskasse', 'ausgleichskasse', 'c_ahv', 30],
  ['Bankpaket', 'bankpaket', 'c_bankgebuehren', 30],
  ['Dienstleistungspreis', 'dienstleistungspreis', 'c_bankgebuehren', 30],
  ['Kontoführung', 'kontofuehrung', 'c_bankgebuehren', 30],
  ['Jahresgebühr Karte', 'jahresgebuehr', 'c_bankgebuehren', 30],
];

// 2) Branche (Merchant-Category aus Kartenexporten)
const branchRules = [
  ['Lebensmittelgeschäft', 'lebensmittelgeschaft', 'c_lebensmittel'],
  ['Restaurants, Bars', 'restaurants bars', 'c_restaurant'],
  ['Tankstelle', 'tankstelle', 'c_benzin'],
  ['Parking', 'parking', 'c_parking'],
  ['Drogerie / Apotheke', 'drogerie apotheke', 'c_apotheke'],
  ['Warenhaus', 'warenhaus', 'c_kleidung'],
  ['Bekleidungsgeschäft', 'bekleidungsgeschaft', 'c_kleidung'],
  ['Möbelgeschäft', 'mobel und einrichtungsgeschaft', 'c_einrichtung'],
  ['Autohändler', 'autohandler', 'c_autoservice'],
  ['Theater', 'theater', 'c_kultur'],
  ['Kino/Unterhaltung', 'kino', 'c_kultur'],
  ['Hotel', 'hotel', 'c_ferien'],
  ['Fluggesellschaft', 'fluggesellschaft', 'c_ferien'],
  ['Bahn / ÖV', 'offentlicher verkehr', 'c_oev'],
  ['Elektronikgeschäft', 'elektro', 'c_technik'],
  ['Sportgeschäft', 'sport', 'c_sport'],
  ['Buchhandlung', 'buchhandlung', 'c_hobby'],
  ['Baumarkt', 'baumarkt', 'c_hausrat_unterhalt'],
  ['Arzt / Spital', 'arzt', 'c_arzt'],
  ['Zahnarzt', 'zahnarzt', 'c_arzt'],
  ['Coiffeur & Kosmetik', 'coiffeur', 'c_koerperpflege'],
  ['Versicherungen (Branche)', 'versicherungen', 'c_haftpflicht'],
  ['Gebühren (Branche)', 'gebuhren', 'c_bankgebuehren'],
  ['Kommunikation (Branche)', 'kommunikation', 'c_internet'],
  ['Öffentlicher Verkehr (Branche)', 'offentlicher', 'c_oev'],
  ['Sonstige Einnahmen (Branche)', 'sonstige einnahmen', 'c_einkommen_sonstige'],
  ['Sonstige Ausgaben (Branche)', 'sonstige ausgaben', 'c_sonstige_ausgaben'],
  ['Andere Direktvertreiber', 'andere direktvertreiber', 'c_sonstige_ausgaben'],
  ['Steuern (Branche)', 'steuern', 'c_steuern_kanton'],
];

/* Kartenzahlungen und Bargeldbezüge stehen je nach Bank im Empfänger- ODER im
 * Detailfeld. Diese Regeln prüfen deshalb den gesamten Buchungstext. */
const transferRules = [
  {
    id: 'sys_zahlung_an_karte', name: 'Zahlung an eigene Karte', match: 'any', sort: 5,
    conditions: [
      { field: 'rawText', op: 'contains', value: 'zahlung an karte' },
      { field: 'rawText', op: 'contains', value: 'kartenzahlung' },
      { field: 'rawText', op: 'contains', value: 'zahlung kreditkarte' },
      { field: 'rawText', op: 'contains', value: 'kreditkartenabrechnung' },
      // Maskierte Kartennummer als Empfänger, z. B. „XXXX XXXX XXXX 2518“
      { field: 'payee', op: 'regex', value: '^[x\\s]{8,}\\d{4}$' },
    ],
    actions: { categoryId: 'c_kk_zahlung', isTransfer: true },
  },
  {
    id: 'sys_bargeldbezug', name: 'Bargeldbezug', match: 'any', sort: 6,
    conditions: [
      { field: 'rawText', op: 'contains', value: 'bargeldbezug' },
      { field: 'rawText', op: 'contains', value: 'geldbezug' },
      { field: 'rawText', op: 'contains', value: 'bancomat' },
      { field: 'rawText', op: 'contains', value: 'geldautomat' },
    ],
    actions: { categoryId: 'c_bargeldbezug', isTransfer: true },
  },
];

export const DEFAULT_RULES = [
  ...transferRules,
  ...payeeRules.map(([name, value, categoryId, sort]) =>
    R(`Zahlungsempfänger: ${name}`, 'payee', 'contains', value, categoryId, {
      sort,
      actions: categoryId === 'c_kk_zahlung' || categoryId === 'c_bargeldbezug' ? { isTransfer: true } : {},
    })),
  ...branchRules.map(([name, value, categoryId]) =>
    R(`Branche: ${name}`, 'merchantCategory', 'contains', value, categoryId, { sort: 200 })),
  // Einkommens-Heuristik zum Schluss
  {
    id: 'sys_lohneingang', name: 'Lohneingang erkennen', match: 'all', sort: 300,
    conditions: [
      { field: 'description', op: 'contains', value: 'lohn' },
      { field: 'amount', op: 'gt', value: 0 },
    ],
    actions: { categoryId: 'c_lohn' },
  },
  {
    id: 'sys_gutschrift_gross', name: 'Grosse Gutschrift als Lohn', match: 'all', sort: 310,
    conditions: [
      { field: 'description', op: 'contains', value: 'gutschrift' },
      { field: 'amount', op: 'gt', value: 3000 },
    ],
    actions: { categoryId: 'c_lohn' },
  },
  {
    id: 'sys_uebertrag', name: 'Interne Überträge', match: 'any', sort: 15,
    conditions: [
      { field: 'description', op: 'contains', value: 'uebertrag' },
      { field: 'description', op: 'contains', value: 'übertrag' },
      { field: 'payee', op: 'contains', value: 'menzi u/o' },
    ],
    actions: { categoryId: 'c_umbuchung', isTransfer: true },
  },
  {
    id: 'sys_dauerauftrag_sparen', name: 'Dauerauftrag Sparen', match: 'all', sort: 320,
    conditions: [{ field: 'description', op: 'contains', value: 'dauerauftrag' }],
    actions: { categoryId: 'c_sparen' },
  },
];
