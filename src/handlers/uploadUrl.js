exports.handler = async (_event) => {
  // Placeholder: return a stubbed URL; wire S3 presign later
  return { statusCode: 200, body: JSON.stringify({ uploadUrl: 's3-presigned-url-placeholder' }) };
};
