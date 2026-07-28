const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const { invokeChaincode } = require('./fabricClient');

/**
 * Read and parse CSV file into JSON records
 */
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

/**
 * Seed qualifications (GTEC) from CSV
 * Expects: cert_id, staff_name, institution, degree, field_of_study, date_conferred
 */
const seedQualifications = async () => {
  console.log('\n[Blockchain Seed] Starting qualifications seed (GTEC)...');

  const csvPath = path.resolve(__dirname, '../../ges_final_year_fabric/data/qualifications.csv');

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Qualifications CSV not found: ${csvPath}`);
  }

  try {
    const records = readCSV(csvPath);
    console.log(`  Read ${records.length} qualification records from CSV`);

    // Transform to match QualificationInput structure
    const qualInputs = records.map(r => ({
      certId: r.cert_id.trim(),
      staffName: r.staff_name.trim().toUpperCase(),
      institution: r.institution.trim(),
      degree: r.degree.trim(),
      fieldOfStudy: r.field_of_study.trim(),
      dateConferred: r.date_conferred.trim()
    }));

    const payload = JSON.stringify(qualInputs);
    console.log(`  Payload size: ${payload.length} bytes`);
    console.log(`  Invoking BulkSeedGTEC...`);

    // Call chaincode with GTEC endorsement
    const result = await invokeChaincode('BulkSeedGTEC', [payload], {
      endorsingOrganizations: ['GTECMSP']
    });

    console.log(`  ✓ BulkSeedGTEC committed successfully`);
    console.log(`  Result:`, result);
    return { success: true, count: records.length, result };

  } catch (err) {
    console.error(`  ✗ Qualifications seed failed: ${err.message}`);
    throw err;
  }
};

/**
 * Seed licenses (NTC) from CSV
 * Expects: cert_id, staff_name, professional_status, subject_specialism, teaching_level, issue_date, expiry_date
 */
const seedLicenses = async () => {
  console.log('\n[Blockchain Seed] Starting licenses seed (NTC)...');

  const csvPath = path.resolve(__dirname, '../../ges_final_year_fabric/data/licenses.csv');

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Licenses CSV not found: ${csvPath}`);
  }

  try {
    const records = readCSV(csvPath);
    console.log(`  Read ${records.length} license records from CSV`);

    // Transform to match LicenseInput structure
    const licenseInputs = records.map(r => ({
      certId: r.cert_id.trim(),
      staffName: r.staff_name.trim().toUpperCase(),
      professionalStatus: r.professional_status.trim(),
      subjectSpecialism: r.subject_specialism.trim(),
      teachingLevel: r.teaching_level.trim(),
      issueDate: r.issue_date.trim(),
      expiryDate: r.expiry_date.trim()
    }));

    const payload = JSON.stringify(licenseInputs);
    console.log(`  Payload size: ${payload.length} bytes`);
    console.log(`  Invoking BulkSeedNTC...`);

    // Call chaincode with NTC endorsement
    const result = await invokeChaincode('BulkSeedNTC', [payload], {
      endorsingOrganizations: ['NTCMSP']
    });

    console.log(`  ✓ BulkSeedNTC committed successfully`);
    console.log(`  Result:`, result);
    return { success: true, count: records.length, result };

  } catch (err) {
    console.error(`  ✗ Licenses seed failed: ${err.message}`);
    throw err;
  }
};

/**
 * Seed both qualifications and licenses
 */
const seedAll = async () => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         BLOCKCHAIN MOCK DATA SEEDING                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  try {
    const qualResult = await seedQualifications();
    const licenseResult = await seedLicenses();

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    SEEDING COMPLETE ✓                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n  📊 Summary:`);
    console.log(`     • Qualifications (GTEC): ${qualResult.count} records`);
    console.log(`     • Licenses (NTC): ${licenseResult.count} records`);
    console.log(`\n  Ready to test! Use blockchain verification endpoints.\n`);

    return {
      success: true,
      qualifications: qualResult,
      licenses: licenseResult
    };

  } catch (err) {
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║                  SEEDING FAILED ✗                            ║');
    console.error('╚════════════════════════════════════════════════════════════════╝');
    console.error(`\nError: ${err.message}\n`);
    throw err;
  }
};

module.exports = {
  seedQualifications,
  seedLicenses,
  seedAll,
  readCSV
};
