/**
 * One-time migration: copy all existing uploaded files from the local
 * uploads volume into MinIO, then update every DB path reference so the
 * new backend code (which expects plain object names) keeps working.
 *
 * Run inside the backend container (image already has minio + pg):
 *   docker run --rm \
 *     --volume ges_uploads_data:/app/src/uploads:ro \
 *     --network ges_ges_network \
 *     -e DB_HOST=postgres -e DB_PORT=5432 -e DB_NAME=ges_db \
 *     -e DB_USER=postgres -e DB_PASSWORD=123nanayaw \
 *     -e MINIO_ENDPOINT=minio -e MINIO_PORT=9000 \
 *     -e MINIO_ACCESS_KEY=gesMinio -e MINIO_SECRET_KEY=gesMinio2026 \
 *     ges-ges_backend node src/scripts/migrateToMinio.js
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Client } = require('minio');
const { Pool }   = require('pg');

const BUCKETS = { PHOTOS: 'ges-photos', DOCUMENTS: 'ges-documents' };

const minio = new Client({
  endPoint:  process.env.MINIO_ENDPOINT  || 'localhost',
  port:      parseInt(process.env.MINIO_PORT || '9000'),
  useSSL:    process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'gesMinio',
  secretKey: process.env.MINIO_SECRET_KEY || 'gesMinio2026',
});

const db = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'ges_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '123nanayaw',
});

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

// Guess MIME type from extension
function mime(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png',  '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

async function ensureBucket(bucket) {
  if (!await minio.bucketExists(bucket)) {
    await minio.makeBucket(bucket, 'us-east-1');
    console.log(`  ✓ Created bucket: ${bucket}`);
  }
}

async function setPhotoPublic() {
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow', Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${BUCKETS.PHOTOS}/*`],
    }],
  });
  await minio.setBucketPolicy(BUCKETS.PHOTOS, policy);
  console.log(`  ✓ ${BUCKETS.PHOTOS} set to public-read`);
}

// Upload a single file to a bucket; skip if already there.
async function upload(bucket, objectName, filePath) {
  try {
    await minio.statObject(bucket, objectName);
    return 'skipped'; // already uploaded
  } catch {
    // not found — upload it
  }
  await minio.fPutObject(bucket, objectName, filePath, { 'Content-Type': mime(filePath) });
  return 'uploaded';
}

// Upload every file in a directory to a bucket.
async function uploadDir(dir, bucket) {
  if (!fs.existsSync(dir)) {
    console.log(`  ⚠  ${dir} does not exist — skipping`);
    return { uploaded: 0, skipped: 0, errors: 0 };
  }
  const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
  let uploaded = 0, skipped = 0, errors = 0;
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const result = await upload(bucket, file, filePath);
      if (result === 'uploaded') { process.stdout.write('.'); uploaded++; }
      else { process.stdout.write('s'); skipped++; }
    } catch (err) {
      process.stdout.write('E');
      console.error(`\n  ✗ ${file}: ${err.message}`);
      errors++;
    }
  }
  process.stdout.write('\n');
  return { uploaded, skipped, errors };
}

async function updateDb() {
  // Normalize every stored path to plain object name by stripping the prefix.
  const updates = [
    // Teacher registration documents
    `UPDATE teachers
       SET nss_certificate_path = REPLACE(nss_certificate_path, 'uploads/documents/', '')
     WHERE nss_certificate_path LIKE 'uploads/documents/%'`,
    `UPDATE teachers
       SET degree_certificate_path = REPLACE(degree_certificate_path, 'uploads/documents/', '')
     WHERE degree_certificate_path LIKE 'uploads/documents/%'`,
    `UPDATE teachers
       SET appointment_letter_path = REPLACE(appointment_letter_path, 'uploads/documents/', '')
     WHERE appointment_letter_path LIKE 'uploads/documents/%'`,
    // Passport photos
    `UPDATE teachers
       SET passport_photo = REPLACE(passport_photo, 'uploads/photos/', '')
     WHERE passport_photo LIKE 'uploads/photos/%'`,
    // Teacher-uploaded documents
    `UPDATE documents
       SET file_path = REPLACE(file_path, 'uploads/documents/', '')
     WHERE file_path LIKE 'uploads/documents/%'`,
    // Change request supporting documents
    `UPDATE change_requests
       SET document_path = REPLACE(document_path, 'uploads/documents/', '')
     WHERE document_path LIKE 'uploads/documents/%'`,
  ];

  for (const sql of updates) {
    const res = await db.query(sql);
    const table = sql.match(/UPDATE (\w+)/i)?.[1] || '?';
    console.log(`  ✓ ${table}: ${res.rowCount} row(s) updated`);
  }
}

(async () => {
  console.log('\n=== GES → MinIO migration ===\n');

  // 1. Prepare buckets
  console.log('▸ Setting up MinIO buckets …');
  await ensureBucket(BUCKETS.PHOTOS);
  await ensureBucket(BUCKETS.DOCUMENTS);
  await setPhotoPublic();

  // 2. Upload photos
  console.log(`\n▸ Uploading photos → ${BUCKETS.PHOTOS} …`);
  const photosDir = path.join(UPLOADS_ROOT, 'photos');
  const photos = await uploadDir(photosDir, BUCKETS.PHOTOS);
  console.log(`  Photos: ${photos.uploaded} uploaded, ${photos.skipped} already existed, ${photos.errors} errors`);

  // 3. Upload documents (subdirectory)
  console.log(`\n▸ Uploading documents → ${BUCKETS.DOCUMENTS} …`);
  const docsDir = path.join(UPLOADS_ROOT, 'documents');
  const docs = await uploadDir(docsDir, BUCKETS.DOCUMENTS);
  console.log(`  Documents: ${docs.uploaded} uploaded, ${docs.skipped} already existed, ${docs.errors} errors`);

  // 4. Upload any stray files in the uploads root (old pre-subdirectory uploads)
  console.log(`\n▸ Uploading root-level legacy files → ${BUCKETS.DOCUMENTS} …`);
  const rootFiles = fs.existsSync(UPLOADS_ROOT)
    ? fs.readdirSync(UPLOADS_ROOT).filter(f => fs.statSync(path.join(UPLOADS_ROOT, f)).isFile())
    : [];
  let legacyUploaded = 0, legacySkipped = 0;
  for (const file of rootFiles) {
    const res = await upload(BUCKETS.DOCUMENTS, file, path.join(UPLOADS_ROOT, file));
    if (res === 'uploaded') { legacyUploaded++; process.stdout.write('.'); }
    else { legacySkipped++; process.stdout.write('s'); }
  }
  if (rootFiles.length) process.stdout.write('\n');
  console.log(`  Legacy: ${legacyUploaded} uploaded, ${legacySkipped} already existed`);

  // 5. Update DB path references
  console.log('\n▸ Updating database path references …');
  await updateDb();

  console.log('\n=== Migration complete ===\n');
  await db.end();
  process.exit(0);
})().catch(err => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
