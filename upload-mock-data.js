#!/usr/bin/env node

/**
 * Standalone CLI tool to upload mock data to Hyperledger Fabric blockchain
 * Run from Ubuntu terminal: node upload-mock-data.js [--all|--qualifications|--licenses]
 * 
 * Usage:
 *   node upload-mock-data.js --all              # Upload both qualifications and licenses
 *   node upload-mock-data.js --qualifications   # Upload qualifications only (GTEC)
 *   node upload-mock-data.js --licenses         # Upload licenses only (NTC)
 *   node upload-mock-data.js --help             # Show help
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');

// Parse command line arguments
const args = process.argv.slice(2);
const action = args[0] || '--all';

if (['-h', '--help'].includes(action)) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║   Blockchain Mock Data Upload Tool                            ║
╚════════════════════════════════════════════════════════════════╝

Usage:
  node upload-mock-data.js [OPTIONS]

Options:
  --all              Upload both qualifications and licenses (default)
  --qualifications   Upload qualifications only (GTEC)
  --licenses         Upload licenses only (NTC)
  --help, -h         Show this help message

Examples:
  node upload-mock-data.js --all
  node upload-mock-data.js --qualifications
  node upload-mock-data.js --licenses

Notes:
  • Ensure Fabric network is running: docker-compose ps
  • Set environment: source setenv.sh ges
  • CSV files should be in: ges_final_year_fabric/data/
  `);
  process.exit(0);
}

// ============================================================================

const { invokeChaincode } = require('./src/services/fabricClient');

/**
 * Read and parse CSV file
 */
function readCSV(filePath) {
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
}

/**
 * Upload qualifications to GTEC
 */
async function uploadQualifications() {
  console.log('\n📤 Uploading qualifications to GTEC...');
  
  const csvPath = path.resolve(__dirname, 'ges_final_year_fabric/data/qualifications.csv');
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  try {
    const records = readCSV(csvPath);
    console.log(`   📄 Read ${records.length} qualification records`);

    const qualInputs = records.map(r => ({
      certId: r.cert_id.trim(),
      staffName: r.staff_name.trim().toUpperCase(),
      institution: r.institution.trim(),
      degree: r.degree.trim(),
      fieldOfStudy: r.field_of_study.trim(),
      dateConferred: r.date_conferred.trim()
    }));

    const payload = JSON.stringify(qualInputs);
    console.log(`   🔗 Invoking BulkSeedGTEC...`);

    const result = await invokeChaincode('BulkSeedGTEC', [payload], {
      endorsingOrganizations: ['GESMSP', 'GTECMSP']
    });

    console.log(`   ✅ GTEC qualifications uploaded successfully!`);
    return { success: true, count: records.length, type: 'qualifications' };

  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    throw err;
  }
}

/**
 * Upload licenses to NTC
 */
async function uploadLicenses() {
  console.log('\n📤 Uploading licenses to NTC...');
  
  const csvPath = path.resolve(__dirname, 'ges_final_year_fabric/data/licenses.csv');
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  try {
    const records = readCSV(csvPath);
    console.log(`   📄 Read ${records.length} license records`);

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
    console.log(`   🔗 Invoking BulkSeedNTC...`);

    const result = await invokeChaincode('BulkSeedNTC', [payload], {
      endorsingOrganizations: ['GESMSP', 'NTCMSP']
    });

    console.log(`   ✅ NTC licenses uploaded successfully!`);
    return { success: true, count: records.length, type: 'licenses' };

  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    throw err;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║   BLOCKCHAIN MOCK DATA UPLOAD                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  try {
    let results = [];

    if (['--all', '-a'].includes(action)) {
      console.log('\n🎯 Action: Upload all mock data (qualifications + licenses)');
      const qualResult = await uploadQualifications();
      const licenseResult = await uploadLicenses();
      results = [qualResult, licenseResult];

    } else if (['--qualifications', '-q'].includes(action)) {
      console.log('\n🎯 Action: Upload qualifications only (GTEC)');
      const qualResult = await uploadQualifications();
      results = [qualResult];

    } else if (['--licenses', '-l'].includes(action)) {
      console.log('\n🎯 Action: Upload licenses only (NTC)');
      const licenseResult = await uploadLicenses();
      results = [licenseResult];

    } else {
      console.log(`❌ Unknown action: ${action}`);
      console.log('Run "node upload-mock-data.js --help" for usage information');
      process.exit(1);
    }

    // Print summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    UPLOAD COMPLETE ✅                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('\n📊 Summary:');
    let totalRecords = 0;
    results.forEach(r => {
      console.log(`   • ${r.type}: ${r.count} records uploaded`);
      totalRecords += r.count;
    });
    console.log(`   • Total: ${totalRecords} records\n`);
    console.log('✅ Mock data successfully seeded to blockchain!\n');

    process.exit(0);

  } catch (err) {
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║                  UPLOAD FAILED ❌                            ║');
    console.error('╚════════════════════════════════════════════════════════════════╝');
    console.error(`\n❌ Error: ${err.message}\n`);
    
    console.log('Troubleshooting:');
    console.log('  1. Ensure Fabric network is running:');
    console.log('     docker-compose ps');
    console.log('  2. Check if chaincode is deployed:');
    console.log('     source setenv.sh ges');
    console.log('     peer lifecycle chaincode queryinstalled');
    console.log('  3. Set correct environment:');
    console.log('     source setenv.sh ges');
    console.log('');
    
    process.exit(1);
  }
}

// Run the tool
main();
