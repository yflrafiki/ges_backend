#!/usr/bin/env node

/**
 * Blockchain Data Verification & Upload Script
 * Verifies chaincode has data, then uploads mock data
 * Run on Ubuntu: node verify-and-upload.js [--check|--upload|--all]
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

const log = (msg, color = 'reset') => console.log(`${colors[color]}${msg}${colors.reset}`);
const success = (msg) => log(`✅ ${msg}`, 'green');
const error = (msg) => log(`❌ ${msg}`, 'red');
const warning = (msg) => log(`⚠️  ${msg}`, 'yellow');
const info = (msg) => log(`ℹ️  ${msg}`, 'blue');
const header = (msg) => log(`\n╔════════════════════════════════════════════════════════════════╗\n║  ${msg.padEnd(62)}  ║\n╚════════════════════════════════════════════════════════════════╝\n`, 'bold');

const args = process.argv.slice(2);
const action = args[0] || '--all';

if (['-h', '--help'].includes(action)) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║   Blockchain Verification & Upload Tool                       ║
╚════════════════════════════════════════════════════════════════╝

Usage:
  node verify-and-upload.js [OPTIONS]

Options:
  --all              Check chaincode, then upload data (default)
  --check            Check if chaincode has data (GTEC/NTC)
  --upload           Upload mock data to blockchain
  --list-gtec        List all GTEC qualifications
  --list-ntc         List all NTC licenses
  --help, -h         Show this help message

Examples:
  node verify-and-upload.js --all
  node verify-and-upload.js --check
  node verify-and-upload.js --upload
  node verify-and-upload.js --list-gtec

Requirements:
  • Fabric network running: docker-compose ps
  • Chaincode deployed
  • Environment set: source setenv.sh ges
  `);
  process.exit(0);
}

// ============================================================================

/**
 * Execute peer chaincode command
 */
function executeChaincode(peer, functionName, args = []) {
  try {
    const argsJson = JSON.stringify({ function: functionName, Args: args });
    const cmd = `peer chaincode query -C geschannel -n ges-verify -c '${argsJson}'`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    return { success: true, output };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Check GTEC qualifications
 */
function checkGTECQualifications() {
  info('Checking GTEC qualifications...');
  
  try {
    execSync('source setenv.sh gtec && peer chaincode query -C geschannel -n ges-verify -c \'{"function":"ListQualifications","Args":[]}\'', 
      { encoding: 'utf-8', shell: '/bin/bash', cwd: process.cwd() });
    success('✓ GTEC qualifications found');
    return true;
  } catch (err) {
    if (err.message.includes('not_found')) {
      warning('No qualifications in GTEC yet');
      return false;
    }
    error('Error checking GTEC: ' + err.message.split('\n')[0]);
    return false;
  }
}

/**
 * Check NTC licenses
 */
function checkNTCLicenses() {
  info('Checking NTC licenses...');
  
  try {
    execSync('source setenv.sh ntc && peer chaincode query -C geschannel -n ges-verify -c \'{"function":"ListLicenses","Args":[]}\'', 
      { encoding: 'utf-8', shell: '/bin/bash', cwd: process.cwd() });
    success('✓ NTC licenses found');
    return true;
  } catch (err) {
    if (err.message.includes('not_found')) {
      warning('No licenses in NTC yet');
      return false;
    }
    error('Error checking NTC: ' + err.message.split('\n')[0]);
    return false;
  }
}

/**
 * List GTEC qualifications
 */
function listGTECQualifications() {
  header('LISTING GTEC QUALIFICATIONS');
  
  try {
    const result = execSync(
      'source setenv.sh gtec && peer chaincode query -C geschannel -n ges-verify -c \'{"function":"ListQualifications","Args":[]}\'',
      { encoding: 'utf-8', shell: '/bin/bash', cwd: process.cwd() }
    );
    
    try {
      const records = JSON.parse(result);
      info(`Found ${records.length} qualifications:`);
      records.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec.certId} - ${rec.staffName} (${rec.institution})`);
      });
      success(`Total: ${records.length} qualifications`);
    } catch {
      console.log(result);
    }
  } catch (err) {
    error('Failed to list qualifications: ' + err.message.split('\n')[0]);
    process.exit(1);
  }
}

/**
 * List NTC licenses
 */
function listNTCLicenses() {
  header('LISTING NTC LICENSES');
  
  try {
    const result = execSync(
      'source setenv.sh ntc && peer chaincode query -C geschannel -n ges-verify -c \'{"function":"ListLicenses","Args":[]}\'',
      { encoding: 'utf-8', shell: '/bin/bash', cwd: process.cwd() }
    );
    
    try {
      const records = JSON.parse(result);
      info(`Found ${records.length} licenses:`);
      records.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec.certId} - ${rec.staffName} (${rec.professionalStatus})`);
      });
      success(`Total: ${records.length} licenses`);
    } catch {
      console.log(result);
    }
  } catch (err) {
    error('Failed to list licenses: ' + err.message.split('\n')[0]);
    process.exit(1);
  }
}

/**
 * Upload mock data to blockchain
 */
function uploadMockData() {
  header('UPLOADING MOCK DATA');
  
  try {
    // Check if upload script exists
    const uploadScript = path.resolve(__dirname, 'upload-mock-data.js');
    if (!fs.existsSync(uploadScript)) {
      error('upload-mock-data.js not found');
      process.exit(1);
    }

    info('Executing upload-mock-data.js --all');
    execSync('node upload-mock-data.js --all', { 
      encoding: 'utf-8', 
      stdio: 'inherit',
      cwd: __dirname 
    });
    
    success('Upload completed');
  } catch (err) {
    error('Upload failed: ' + err.message);
    process.exit(1);
  }
}

/**
 * Check if data is already on blockchain
 */
function checkBlockchainData() {
  header('CHECKING BLOCKCHAIN DATA');
  
  info('Checking GTEC qualifications...');
  const gtecOk = checkGTECQualifications();
  
  console.log('');
  info('Checking NTC licenses...');
  const ntcOk = checkNTCLicenses();
  
  console.log('');
  if (gtecOk && ntcOk) {
    success('✓ All data present on blockchain!');
    process.exit(0);
  } else {
    warning('Some data is missing from blockchain');
    process.exit(1);
  }
}

/**
 * Main flow
 */
function main() {
  try {
    if (['--check', '-c'].includes(action)) {
      checkBlockchainData();

    } else if (['--upload', '-u'].includes(action)) {
      uploadMockData();

    } else if (['--all', '-a'].includes(action)) {
      log('\n╔════════════════════════════════════════════════════════════════╗');
      log('║   VERIFY & UPLOAD BLOCKCHAIN DATA                             ║');
      log('╚════════════════════════════════════════════════════════════════╝\n');
      
      info('Step 1: Checking if data already exists on blockchain...');
      const gtecOk = checkGTECQualifications();
      console.log('');
      const ntcOk = checkNTCLicenses();
      
      console.log('');
      if (gtecOk && ntcOk) {
        success('✓ All data already on blockchain! No upload needed.');
        process.exit(0);
      } else {
        warning('Data missing from blockchain - uploading mock data...');
        console.log('');
        uploadMockData();
      }

    } else if (['--list-gtec'].includes(action)) {
      listGTECQualifications();

    } else if (['--list-ntc'].includes(action)) {
      listNTCLicenses();

    } else {
      error(`Unknown action: ${action}`);
      log('Run "node verify-and-upload.js --help" for usage');
      process.exit(1);
    }

  } catch (err) {
    error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Run
main();
