const express = require('express');
const { seedQualifications, seedLicenses, seedAll } = require('../services/blockchainSeedService');

const router = express.Router();

/**
 * POST /api/admin/blockchain/seed
 * Seed mock credentials onto the blockchain (qualifications + licenses)
 * Admin only
 */
router.post('/blockchain/seed', async (req, res) => {
  try {
    console.log('\n[Admin API] Starting blockchain seed...');
    const result = await seedAll();
    
    res.json({
      success: true,
      message: 'Mock data seeded successfully',
      summary: {
        qualifications: result.qualifications.count,
        licenses: result.licenses.count
      }
    });
  } catch (err) {
    console.error('[Admin API] Seed error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/admin/blockchain/seed/qualifications
 * Seed only GTEC qualifications
 * Admin only
 */
router.post('/blockchain/seed/qualifications', async (req, res) => {
  try {
    console.log('\n[Admin API] Starting qualifications seed...');
    const result = await seedQualifications();
    
    res.json({
      success: true,
      message: 'Qualifications seeded successfully',
      count: result.count
    });
  } catch (err) {
    console.error('[Admin API] Qualifications seed error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/admin/blockchain/seed/licenses
 * Seed only NTC licenses
 * Admin only
 */
router.post('/blockchain/seed/licenses', async (req, res) => {
  try {
    console.log('\n[Admin API] Starting licenses seed...');
    const result = await seedLicenses();
    
    res.json({
      success: true,
      message: 'Licenses seeded successfully',
      count: result.count
    });
  } catch (err) {
    console.error('[Admin API] Licenses seed error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
