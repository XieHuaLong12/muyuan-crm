/**
 * One time zone per country (the capital's), to show when customers write in their own day. Countries spanning
 * several zones (US, Canada, Brazil, Russia, Australia, Mexico, Indonesia) use the most populous one; a country
 * missing here is left out of the local-time view and counted as such.
 */
const ZONES: Record<string, string> = {
  // Europe
  FR: 'Europe/Paris', BE: 'Europe/Brussels', CH: 'Europe/Zurich', LU: 'Europe/Luxembourg', MC: 'Europe/Monaco', DE: 'Europe/Berlin',
  NL: 'Europe/Amsterdam', ES: 'Europe/Madrid', PT: 'Europe/Lisbon', IT: 'Europe/Rome', GB: 'Europe/London', IE: 'Europe/Dublin',
  AT: 'Europe/Vienna', PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki', GR: 'Europe/Athens', RO: 'Europe/Bucharest', BG: 'Europe/Sofia', HU: 'Europe/Budapest', UA: 'Europe/Kyiv',
  RU: 'Europe/Moscow', TR: 'Europe/Istanbul', RS: 'Europe/Belgrade', HR: 'Europe/Zagreb', SK: 'Europe/Bratislava', SI: 'Europe/Ljubljana',
  // North and West Africa
  MA: 'Africa/Casablanca', DZ: 'Africa/Algiers', TN: 'Africa/Tunis', LY: 'Africa/Tripoli', EG: 'Africa/Cairo', MR: 'Africa/Nouakchott',
  SN: 'Africa/Dakar', CI: 'Africa/Abidjan', ML: 'Africa/Bamako', BF: 'Africa/Ouagadougou', NE: 'Africa/Niamey', GN: 'Africa/Conakry',
  BJ: 'Africa/Porto-Novo', TG: 'Africa/Lome', GH: 'Africa/Accra', NG: 'Africa/Lagos', GM: 'Africa/Banjul', SL: 'Africa/Freetown', LR: 'Africa/Monrovia',
  // Central, East and Southern Africa
  CM: 'Africa/Douala', GA: 'Africa/Libreville', CG: 'Africa/Brazzaville', CD: 'Africa/Kinshasa', CF: 'Africa/Bangui', TD: 'Africa/Ndjamena',
  GQ: 'Africa/Malabo', BI: 'Africa/Bujumbura', RW: 'Africa/Kigali', DJ: 'Africa/Djibouti', KM: 'Indian/Comoro', MG: 'Indian/Antananarivo',
  MU: 'Indian/Mauritius', SC: 'Indian/Mahe', RE: 'Indian/Reunion', KE: 'Africa/Nairobi', TZ: 'Africa/Dar_es_Salaam', UG: 'Africa/Kampala',
  ET: 'Africa/Addis_Ababa', ZA: 'Africa/Johannesburg', AO: 'Africa/Luanda', MZ: 'Africa/Maputo', ZM: 'Africa/Lusaka', ZW: 'Africa/Harare',
  // Middle East
  SA: 'Asia/Riyadh', AE: 'Asia/Dubai', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', JO: 'Asia/Amman',
  LB: 'Asia/Beirut', IQ: 'Asia/Baghdad', IL: 'Asia/Jerusalem', PS: 'Asia/Hebron', IR: 'Asia/Tehran', YE: 'Asia/Aden', SY: 'Asia/Damascus',
  // Asia and Oceania
  CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau', TW: 'Asia/Taipei', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila', ID: 'Asia/Jakarta', IN: 'Asia/Kolkata',
  PK: 'Asia/Karachi', BD: 'Asia/Dhaka', LK: 'Asia/Colombo', KZ: 'Asia/Almaty', UZ: 'Asia/Tashkent', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  // Americas
  US: 'America/New_York', CA: 'America/Toronto', MX: 'America/Mexico_City', BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima', HT: 'America/Port-au-Prince', DO: 'America/Santo_Domingo',
  GP: 'America/Guadeloupe', MQ: 'America/Martinique', GF: 'America/Cayenne', PA: 'America/Panama', CR: 'America/Costa_Rica',
};

export const countryTimezone = (code: string) => ZONES[code.toUpperCase()] ?? null;
