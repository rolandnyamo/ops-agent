// Kept as no-op for now; ingestion is handled via DocsFn POST /docs/ingest
exports.handler = async (_event) => ({ statusCode: 501, body: JSON.stringify({ message: 'Use POST /docs/ingest' }) });
