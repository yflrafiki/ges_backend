const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const { invokeChaincode, invokeChaincodeWithTxId } = require('./fabricClient');

/**
 * Read and parse CSV file into JSON records
 */
const readCSVFile = (filePath) => {
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
 * Upload qualifications to GTEC blockchain
 * Reads from CSV file and calls BulkSeedGTEC
 */
const uploadQualifications = async () => {
  console.log('\n[Upload] Starting qualifications upload to GTEC...');

  const csvPath = path.resolve(__dirname, '../../ges_final_year_fabric/data/qualifications.csv');

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Qualifications CSV not found: ${csvPath}`);
  }

  try {
    const records = readCSVFile(csvPath);
    console.log(`  📄 Read ${records.length} qualification records from CSV`);

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
    console.log(`  📤 Payload size: ${(payload.length / 1024).toFixed(2)} KB`);
    console.log(`  🔗 Invoking BulkSeedGTEC on GTEC peer...`);

    // Call chaincode with GTEC endorsement
    const result = await invokeChaincode('BulkSeedGTEC', [payload], {
      endorsingOrganizations: ['GTECMSP']
    });

    console.log(`  ✅ BulkSeedGTEC committed successfully`);
    
    return {
      success: true,
      type: 'qualifications',
      count: records.length,
      organization: 'GTEC',
      chaincode: 'BulkSeedGTEC',
      timestamp: new Date().toISOString(),
      result
    };

  } catch (err) {
    console.error(`  ❌ Qualifications upload failed: ${err.message}`);
    throw err;
  }
};

/**
 * Upload licenses to NTC blockchain
 * Reads from CSV file and calls BulkSeedNTC
 */
const uploadLicenses = async () => {
  console.log('\n[Upload] Starting licenses upload to NTC...');

  const csvPath = path.resolve(__dirname, '../../ges_final_year_fabric/data/licenses.csv');

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Licenses CSV not found: ${csvPath}`);
  }

  try {
    const records = readCSVFile(csvPath);
    console.log(`  📄 Read ${records.length} license records from CSV`);

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
    console.log(`  📤 Payload size: ${(payload.length / 1024).toFixed(2)} KB`);
    console.log(`  🔗 Invoking BulkSeedNTC on NTC peer...`);

    // Call chaincode with NTC endorsement
    const result = await invokeChaincode('BulkSeedNTC', [payload], {
      endorsingOrganizations: ['NTCMSP']
    });

    console.log(`  ✅ BulkSeedNTC committed successfully`);

    return {
      success: true,
      type: 'licenses',
      count: records.length,
      organization: 'NTC',
      chaincode: 'BulkSeedNTC',
      timestamp: new Date().toISOString(),
      result
    };

  } catch (err) {
    console.error(`  ❌ Licenses upload failed: ${err.message}`);
    throw err;
  }
};

/**
 * Upload both qualifications and licenses to blockchain
 */
const uploadAllMockData = async () => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         BLOCKCHAIN MOCK DATA UPLOAD                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  try {
    const qualResult = await uploadQualifications();
    const licenseResult = await uploadLicenses();

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    UPLOAD COMPLETE ✅                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n  📊 Summary:`);
    console.log(`     • Qualifications (GTEC): ${qualResult.count} records uploaded`);
    console.log(`     • Licenses (NTC): ${licenseResult.count} records uploaded`);
    console.log(`     • Total: ${qualResult.count + licenseResult.count} records`);
    console.log(`\n  ✅ All mock data successfully seeded to blockchain!\n`);

    return {
      success: true,
      message: 'All mock data uploaded successfully',
      summary: {
        qualifications: {
          count: qualResult.count,
          organization: qualResult.organization,
          status: 'completed'
        },
        licenses: {
          count: licenseResult.count,
          organization: licenseResult.organization,
          status: 'completed'
        }
      },
      total: qualResult.count + licenseResult.count,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║                  UPLOAD FAILED ❌                            ║');
    console.error('╚════════════════════════════════════════════════════════════════╝');
    console.error(`Error: ${err.message}\n`);
    
    throw {
      success: false,
      message: 'Mock data upload failed',
      error: err.message,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Upload a single qualification record
 */
const uploadSingleQualification = async (certId, staffName, institution, degree, fieldOfStudy, dateConferred) => {
  console.log(`\n[Upload] Uploading single qualification: ${certId}`);

  try {
    const record = {
      certId,
      staffName: staffName.toUpperCase(),
      institution,
      degree,
      fieldOfStudy,
      dateConferred
    };

    const payload = JSON.stringify([record]);
    const result = await invokeChaincode('BulkSeedGTEC', [payload], {
      endorsingOrganizations: ['GTECMSP']
    });

    console.log(`  ✅ Qualification ${certId} uploaded successfully`);

    return {
      success: true,
      type: 'qualification',
      certId,
      organization: 'GTEC',
      timestamp: new Date().toISOString(),
      result
    };

  } catch (err) {
    console.error(`  ❌ Failed to upload qualification: ${err.message}`);
    throw err;
  }
};

/**
 * Upload a single license record
 */
const uploadSingleLicense = async (certId, staffName, professionalStatus, subjectSpecialism, teachingLevel, issueDate, expiryDate) => {
  console.log(`\n[Upload] Uploading single license: ${certId}`);

  try {
    const record = {
      certId,
      staffName: staffName.toUpperCase(),
      professionalStatus,
      subjectSpecialism,
      teachingLevel,
      issueDate,
      expiryDate
    };

    const payload = JSON.stringify([record]);
    const result = await invokeChaincode('BulkSeedNTC', [payload], {
      endorsingOrganizations: ['NTCMSP']
    });

    console.log(`  ✅ License ${certId} uploaded successfully`);

    return {
      success: true,
      type: 'license',
      certId,
      organization: 'NTC',
      timestamp: new Date().toISOString(),
      result
    };

  } catch (err) {
    console.error(`  ❌ Failed to upload license: ${err.message}`);
    throw err;
  }
};

module.exports = {
  uploadQualifications,
  uploadLicenses,
  uploadAllMockData,
  uploadSingleQualification,
  uploadSingleLicense,
  readCSVFile
};
