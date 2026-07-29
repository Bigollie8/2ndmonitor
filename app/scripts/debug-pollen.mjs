/**
 * Debug helper for the Pollen tile bug — dumps the raw Google Pollen API
 * response so we can confirm whether WEED is missing entirely or just
 * missing its `indexInfo` (out of season).
 *
 *   $env:GOOGLE_POLLEN_KEY="AIza..."
 *   node app/scripts/debug-pollen.mjs           # defaults to Knoxville TN
 *   node app/scripts/debug-pollen.mjs 35.96 -83.92
 */

const lat = parseFloat(process.argv[2] ?? '35.9606');
const lon = parseFloat(process.argv[3] ?? '-83.9207');
const key = process.env.GOOGLE_POLLEN_KEY;

if (!key) {
  console.error('Set GOOGLE_POLLEN_KEY in your environment first.');
  console.error('  PowerShell:  $env:GOOGLE_POLLEN_KEY="AIza..."');
  process.exit(1);
}

const url = 'https://pollen.googleapis.com/v1/forecast:lookup'
  + `?key=${encodeURIComponent(key)}`
  + `&location.longitude=${lon.toFixed(4)}&location.latitude=${lat.toFixed(4)}`
  + '&days=1&plantsDescription=false';

const res = await fetch(url);
console.log('HTTP', res.status, res.statusText);
const data = await res.json();

const today = data.dailyInfo?.[0];
if (!today) {
  console.log('No dailyInfo[0]. Full response:');
  console.dir(data, { depth: null });
  process.exit(0);
}

console.log('\n=== pollenTypeInfo (the three top-level categories) ===');
for (const t of today.pollenTypeInfo ?? []) {
  console.log({
    code: t.code,
    displayName: t.displayName,
    inSeason: t.inSeason,
    hasIndexInfo: !!t.indexInfo,
    value: t.indexInfo?.value,
    category: t.indexInfo?.category,
  });
}

console.log('\n=== plantInfo (species-level) ===');
for (const p of today.plantInfo ?? []) {
  console.log({
    code: p.code,
    displayName: p.displayName,
    inSeason: p.inSeason,
    hasIndexInfo: !!p.indexInfo,
    value: p.indexInfo?.value,
  });
}
