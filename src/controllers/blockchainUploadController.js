const {
  uploadQualifications,
  uploadLicenses,
  uploadAllMockData,
  uploadSingleQualification,
  uploadSingleLicense
} = require('../services/blockchainUploadService');

/**
 * Upload all mock data (qualifications + licenses)
 * POST /api/blockchain/upload/all
 */
const uploadAllData = async (req, res) => {
  try {
    console.log('\n[Controller] Uploading all mock data...');
    const result = await uploadAllMockData();
    
    res.json({
      success: true,
      message: 'Mock data uploaded successfully to blockchain',
      data: result
    });
  } catch (err) {
    console.error('[Controller] Upload error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to upload mock data',
      error: err.message || err
    });
  }
};

/**
 * Upload qualifications only (GTEC)
 * POST /api/blockchain/upload/qualifications
 */
const uploadQualificationsOnly = async (req, res) => {
  try {
    console.log('\n[Controller] Uploading qualifications...');
    const result = await uploadQualifications();
    
    res.json({
      success: true,
      message: 'Qualifications uploaded successfully to GTEC',
      data: result
    });
  } catch (err) {
    console.error('[Controller] Qualifications upload error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to upload qualifications',
      error: err.message
    });
  }
};

/**
 * Upload licenses only (NTC)
 * POST /api/blockchain/upload/licenses
 */
const uploadLicensesOnly = async (req, res) => {
  try {
    console.log('\n[Controller] Uploading licenses...');
    const result = await uploadLicenses();
    
    res.json({
      success: true,
      message: 'Licenses uploaded successfully to NTC',
      data: result
    });
  } catch (err) {
    console.error('[Controller] Licenses upload error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to upload licenses',
      error: err.message
    });
  }
};

/**
 * Upload a single qualification record
 * POST /api/blockchain/upload/qualification
 * Body: { certId, staffName, institution, degree, fieldOfStudy, dateConferred }
 */
const uploadQualification = async (req, res) => {
  try {
    const { certId, staffName, institution, degree, fieldOfStudy, dateConferred } = req.body;

    if (!certId || !staffName || !institution || !degree || !fieldOfStudy || !dateConferred) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: certId, staffName, institution, degree, fieldOfStudy, dateConferred'
      });
    }

    console.log(`\n[Controller] Uploading single qualification: ${certId}`);
    const result = await uploadSingleQualification(certId, staffName, institution, degree, fieldOfStudy, dateConferred);
    
    res.json({
      success: true,
      message: 'Qualification uploaded successfully',
      data: result
    });
  } catch (err) {
    console.error('[Controller] Single qualification upload error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to upload qualification',
      error: err.message
    });
  }
};

/**
 * Upload a single license record
 * POST /api/blockchain/upload/license
 * Body: { certId, staffName, professionalStatus, subjectSpecialism, teachingLevel, issueDate, expiryDate }
 */
const uploadLicense = async (req, res) => {
  try {
    const { certId, staffName, professionalStatus, subjectSpecialism, teachingLevel, issueDate, expiryDate } = req.body;

    if (!certId || !staffName || !professionalStatus || !subjectSpecialism || !teachingLevel || !issueDate || !expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: certId, staffName, professionalStatus, subjectSpecialism, teachingLevel, issueDate, expiryDate'
      });
    }

    console.log(`\n[Controller] Uploading single license: ${certId}`);
    const result = await uploadSingleLicense(certId, staffName, professionalStatus, subjectSpecialism, teachingLevel, issueDate, expiryDate);
    
    res.json({
      success: true,
      message: 'License uploaded successfully',
      data: result
    });
  } catch (err) {
    console.error('[Controller] Single license upload error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to upload license',
      error: err.message
    });
  }
};

/**
 * Health check for blockchain upload service
 * GET /api/blockchain/upload/health
 */
const healthCheck = (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Blockchain Upload Service',
    endpoints: [
      'POST /api/blockchain/upload/all — Upload all mock data',
      'POST /api/blockchain/upload/qualifications — Upload qualifications only',
      'POST /api/blockchain/upload/licenses — Upload licenses only',
      'POST /api/blockchain/upload/qualification — Upload single qualification',
      'POST /api/blockchain/upload/license — Upload single license',
      'GET /api/blockchain/upload/health — Health check'
    ]
  });
};

module.exports = {
  uploadAllData,
  uploadQualificationsOnly,
  uploadLicensesOnly,
  uploadQualification,
  uploadLicense,
  healthCheck
};
