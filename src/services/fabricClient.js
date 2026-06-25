const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Resolve crypto-config root from env or default to ges_final_year_fabric sibling folder
const CRYPTO_ROOT = process.env.FABRIC_CRYPTO_PATH ||
  path.resolve(__dirname, '../../../../ges_final_year_fabric/crypto-config');

const CHANNEL   = process.env.FABRIC_CHANNEL    || 'geschannel';
const CHAINCODE = process.env.FABRIC_CHAINCODE  || 'ges-verify';

// GES peer is the submitting peer for all backend calls
const GES_PEER_ENDPOINT = process.env.FABRIC_GES_PEER || 'localhost:7051';
const GES_PEER_HOST     = process.env.FABRIC_GES_PEER_HOST || 'peer0.ges.ges.edu.gh';

const GES_MSP = 'GESMSP';

function getGESPeerTLSCert() {
  const tlsPath = path.join(
    CRYPTO_ROOT,
    'peerOrganizations/ges.ges.edu.gh/peers/peer0.ges.ges.edu.gh/tls/ca.crt'
  );
  return fs.readFileSync(tlsPath);
}

function getGESAdminIdentity() {
  const certDir = path.join(
    CRYPTO_ROOT,
    'peerOrganizations/ges.ges.edu.gh/users/Admin@ges.ges.edu.gh/msp/signcerts'
  );
  const certFile = fs.readdirSync(certDir).find(f => f.endsWith('.pem') || f.endsWith('-cert.pem')) ||
                   fs.readdirSync(certDir)[0];
  return fs.readFileSync(path.join(certDir, certFile)).toString();
}

function getGESAdminKey() {
  const keyDir = path.join(
    CRYPTO_ROOT,
    'peerOrganizations/ges.ges.edu.gh/users/Admin@ges.ges.edu.gh/msp/keystore'
  );
  const keyFile = fs.readdirSync(keyDir)[0];
  return fs.readFileSync(path.join(keyDir, keyFile)).toString();
}

// Build a gRPC connection to the GES peer
function newGrpcConnection() {
  const tlsRootCert = getGESPeerTLSCert();
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(GES_PEER_ENDPOINT, tlsCredentials, {
    'grpc.ssl_target_name_override': GES_PEER_HOST,
  });
}

// Build a Fabric Gateway identity + signer for the GES admin
function newIdentity() {
  return { mspId: GES_MSP, credentials: Buffer.from(getGESAdminIdentity()) };
}

function newSigner() {
  const privateKeyPem = getGESAdminKey();
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

// Execute a chaincode transaction (submit = write, evaluate = read).
//
// endorsingOrganizations matters for AnchorQualification/AnchorLicense (which write
// to an implicit per-org private data collection) and VerifyQualification/VerifyLicense/
// GetQualification/GetLicense (which read from one): implicit collections are stored
// only by peers of the owning org. Submitting/evaluating through GES alone never
// reaches GTEC's or NTC's collection, so callers MUST pin endorsingOrganizations to
// include the relevant org — e.g. ['GESMSP', 'GTECMSP'] for a qualification write
// (GESMSP is also required to satisfy the channel's default 2-of-3 majority
// endorsement policy), or just ['GTECMSP'] for a qualification read.
async function invokeChaincode(fnName, args = [], { evaluate = false, endorsingOrganizations } = {}) {
  const client = newGrpcConnection();
  let gateway;
  try {
    gateway = connect({
      client,
      identity: newIdentity(),
      signer: newSigner(),
      hash: hash.sha256,
    });

    const network  = gateway.getNetwork(CHANNEL);
    const contract = network.getContract(CHAINCODE);
    const options = { arguments: args.map(String), endorsingOrganizations };

    const resultBytes = evaluate
      ? await contract.evaluate(fnName, options)
      : await contract.submit(fnName, options);

    if (!resultBytes || resultBytes.length === 0) return null;
    return JSON.parse(Buffer.from(resultBytes).toString());
  } finally {
    gateway?.close();
    client.close();
  }
}

// Submit a write transaction and also return its transaction ID (for anchoring records
// where callers need a tx ID to display/store, not just the chaincode's return value).
// See invokeChaincode's comment above re: endorsingOrganizations and private data.
async function invokeChaincodeWithTxId(fnName, args = [], { endorsingOrganizations } = {}) {
  const client = newGrpcConnection();
  let gateway;
  try {
    gateway = connect({
      client,
      identity: newIdentity(),
      signer: newSigner(),
      hash: hash.sha256,
    });

    const network  = gateway.getNetwork(CHANNEL);
    const contract = network.getContract(CHAINCODE);

    const commit = await contract.submitAsync(fnName, { arguments: args.map(String), endorsingOrganizations });
    const resultBytes = commit.getResult();
    const status = await commit.getStatus();
    if (!status.successful) {
      throw new Error(`Transaction ${status.transactionId} failed to commit with status ${status.code}`);
    }

    const result = resultBytes && resultBytes.length
      ? JSON.parse(Buffer.from(resultBytes).toString())
      : null;

    return { result, txId: commit.getTransactionId() };
  } finally {
    gateway?.close();
    client.close();
  }
}

module.exports = { invokeChaincode, invokeChaincodeWithTxId, CHANNEL, CHAINCODE };
