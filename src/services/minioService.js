// Storage service — backed by Firebase Cloud Storage (Admin SDK).
// Kept as minioService.js so all existing require() calls stay unchanged.
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      // Render/docker store the key with literal \n; convert to real newlines.
      private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const bucket = admin.storage().bucket();

// "Buckets" are path prefixes inside the single Firebase Storage bucket.
const BUCKETS = {
  PHOTOS:    'ges-photos',
  DOCUMENTS: 'ges-documents',
};

function fp(prefix, objectName) {
  return `${prefix}/${objectName}`;
}

// Firebase bucket exists by default — nothing to create.
async function ensureBuckets() {
  console.log('[Firebase Storage] Ready — bucket:', process.env.FIREBASE_STORAGE_BUCKET);
}

// Upload a file from disk path.
async function uploadFromPath(prefix, objectName, filePath, contentType) {
  const dest = fp(prefix, objectName);
  await bucket.upload(filePath, { destination: dest, metadata: { contentType } });
  if (prefix === BUCKETS.PHOTOS) {
    await bucket.file(dest).makePublic();
  }
  return objectName;
}

// Upload a Buffer.
async function uploadBuffer(prefix, objectName, buffer, contentType) {
  const dest = fp(prefix, objectName);
  const file = bucket.file(dest);
  await file.save(buffer, { contentType });
  if (prefix === BUCKETS.PHOTOS) {
    await file.makePublic();
  }
  return objectName;
}

// Returns a Node.js Readable stream — pipe directly into res.
async function getFileStream(prefix, objectName) {
  return bucket.file(fp(prefix, objectName)).createReadStream();
}

// Returns { size, contentType, metaData } — metaData['content-type'] matches
// what documentController.js expects from the old MinIO SDK.
async function statObject(prefix, objectName) {
  const [meta] = await bucket.file(fp(prefix, objectName)).getMetadata();
  return {
    size:        parseInt(meta.size, 10),
    contentType: meta.contentType,
    metaData:    { 'content-type': meta.contentType },
  };
}

// Deletes an object. No-throw if it doesn't exist.
async function deleteObject(prefix, objectName) {
  try {
    await bucket.file(fp(prefix, objectName)).delete();
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}

// Public URL for photos (makePublic() was called on upload).
function getPublicUrl(objectName) {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  return `https://storage.googleapis.com/${bucketName}/${BUCKETS.PHOTOS}/${objectName}`;
}

function toObjectName(multerFilename) {
  return multerFilename;
}

module.exports = {
  client: bucket,
  BUCKETS,
  ensureBuckets,
  uploadFromPath,
  uploadBuffer,
  getFileStream,
  statObject,
  deleteObject,
  getPublicUrl,
  toObjectName,
};
