const { BlobServiceClient } = require("@azure/storage-blob");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

if (!connectionString) {
  throw new Error("Missing AZURE_STORAGE_CONNECTION_STRING in environment variables");
}

if (!containerName) {
  throw new Error("Missing AZURE_STORAGE_CONTAINER_NAME in environment variables");
}

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient(containerName);

async function ensureContainerExists() {
  await containerClient.createIfNotExists();
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
async function uploadBufferToBlob({ buffer, storageKey, mimeType }) {
  await ensureContainerExists();

  const blockBlobClient = containerClient.getBlockBlobClient(storageKey);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: mimeType,
    },
  });

  return {
    storageKey,
    blobUrl: blockBlobClient.url,
  };
}
async function downloadBlobToBuffer(storageKey) {
  await ensureContainerExists();

  const blobClient = containerClient.getBlobClient(storageKey);
  const downloadResponse = await blobClient.download();

  const chunks = [];

  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}
async function deleteBlobByStorageKey(storageKey) {
  await ensureContainerExists();

  if (!storageKey) {
    throw new Error("Missing storageKey for blob deletion");
  }

  const blobClient = containerClient.getBlobClient(storageKey);

  const exists = await blobClient.exists();
  console.log("Blob delete check:", {
    containerName,
    storageKey,
    exists,
    blobUrl: blobClient.url,
  });

  if (!exists) {
    return {
      deleted: false,
      reason: "Blob not found",
      storageKey,
    };
  }

  await blobClient.delete();

  return {
    deleted: true,
    storageKey,
  };
}
module.exports = {
  uploadBufferToBlob,
  sanitizeFileName,
  downloadBlobToBuffer,
  deleteBlobByStorageKey,
};
