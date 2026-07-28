/**
 * seedBlockchain.js — uploads mock GTEC qualification records and NTC license
 * records onto the Fabric blockchain for demo / development use.
 *
 * Run from the ges/ directory (Fabric network must be up):
 *
 *   node src/scripts/seedBlockchain.js
 *
 * CertID conventions (must match blockchainVerifyService.js):
 *   Qualifications  → QUAL_<staffId>
 *   Licenses        → LICENSE_<staffId>
 *
 * Columns match the fields OCR extracts from uploaded documents:
 *   GTEC: certId, staffName, institution, degree, fieldOfStudy, dateConferred
 *   NTC:  certId, staffName, professionalStatus, subjectSpecialism,
 *         teachingLevel, issueDate, expiryDate
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const { invokeChaincode } = require('../services/fabricClient');

// ─── Load mock data from CSV files ─────────────────────────────────────────────

const readCSV = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const records = csv.parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    return records;
  } catch (err) {
    throw new Error(`Failed to read CSV ${filePath}: ${err.message}`);
  }
};

// Load qualifications from CSV
const loadGTECRecords = () => {
  const csvPath = path.resolve(__dirname, '../../..', 'ges_final_year_fabric/data/qualifications.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Qualifications CSV not found: ${csvPath}`);
  }

  const csvRecords = readCSV(csvPath);
  return csvRecords.map(r => ({
    certId:        r.cert_id.trim(),
    staffName:     r.staff_name.trim().toUpperCase(),
    institution:   r.institution.trim(),
    degree:        r.degree.trim(),
    fieldOfStudy:  r.field_of_study.trim(),
    dateConferred: r.date_conferred.trim()
  }));
};

// Load licenses from CSV
const loadNTCRecords = () => {
  const csvPath = path.resolve(__dirname, '../../..', 'ges_final_year_fabric/data/licenses.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Licenses CSV not found: ${csvPath}`);
  }

  const csvRecords = readCSV(csvPath);
  return csvRecords.map(r => ({
    certId:             r.cert_id.trim(),
    staffName:          r.staff_name.trim().toUpperCase(),
    professionalStatus: r.professional_status.trim(),
    subjectSpecialism:  r.subject_specialism.trim(),
    teachingLevel:      r.teaching_level.trim(),
    issueDate:          r.issue_date.trim(),
    expiryDate:         r.expiry_date.trim()
  }));
};

let GTEC_RECORDS, NTC_RECORDS;

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedGTEC() {
  console.log(`\nLoading and seeding GTEC qualification records...`);
  GTEC_RECORDS = loadGTECRecords();
  console.log(`  📄 Loaded ${GTEC_RECORDS.length} records from CSV`);

  // BulkSeedGTEC must be endorsed by GTEC's peer (implicit private collection
  // _implicit_org_GTECMSP is only accessible through GTEC's peer).
  // GES is also included to satisfy the channel's majority endorsement policy.
  console.log(`  🔗 Uploading to blockchain...`);
  await invokeChaincode(
    'BulkSeedGTEC',
    [JSON.stringify(GTEC_RECORDS)],
    { evaluate: false, endorsingOrganizations: ['GESMSP', 'GTECMSP'] },
  );

  console.log('✓ GTEC records seeded. Verifying...');
  const records = await invokeChaincode(
    'ListQualifications',
    [],
    { evaluate: true, endorsingOrganizations: ['GTECMSP'] },
  );
  console.log(`  ✓ Found ${(records || []).length} qualification records on GTEC ledger:`);
  for (const r of records || []) {
    console.log(`    [${r.certId}] ${r.staffName} — ${r.degree} in ${r.fieldOfStudy} (${r.dateConferred})`);
  }
}

async function seedNTC() {
  console.log(`\nLoading and seeding NTC license records...`);
  NTC_RECORDS = loadNTCRecords();
  console.log(`  📄 Loaded ${NTC_RECORDS.length} records from CSV`);

  console.log(`  🔗 Uploading to blockchain...`);
  await invokeChaincode(
    'BulkSeedNTC',
    [JSON.stringify(NTC_RECORDS)],
    { evaluate: false, endorsingOrganizations: ['GESMSP', 'NTCMSP'] },
  );

  console.log('✓ NTC records seeded. Verifying...');
  const records = await invokeChaincode(
    'ListLicenses',
    [],
    { evaluate: true, endorsingOrganizations: ['NTCMSP'] },
  );
  console.log(`  ✓ Found ${(records || []).length} license records on NTC ledger:`);
  for (const r of records || []) {
    console.log(`    [${r.certId}] ${r.staffName} — ${r.professionalStatus} | ${r.subjectSpecialism} | ${r.teachingLevel} | expires ${r.expiryDate}`);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          GES BLOCKCHAIN MOCK DATA SEEDER                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log('Configuration:');
  console.log('  Channel  :', process.env.FABRIC_CHANNEL  || 'geschannel');
  console.log('  Chaincode:', process.env.FABRIC_CHAINCODE || 'ges-verify');
  console.log('  Peer     :', process.env.FABRIC_GES_PEER || 'localhost:7051\n');

  try {
    await seedGTEC();
    await seedNTC();
    
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    SEEDING COMPLETE ✓                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    console.log('✓ The blockchain now contains mock qualification and license records.');
    console.log('✓ Verification calls from the backend will match these records when');
    console.log('  teachers upload certificates with matching staff names.\n');
  } catch (err) {
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║                   SEEDING FAILED ✗                            ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
