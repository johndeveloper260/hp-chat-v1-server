/**
 * Shared S3 Key Generator
 *
 * Unified pattern: uploads/${business_unit}/${relation_type}/${relation_id}/${filename}
 *
 * Examples:
 *   uploads/gen/inquiries/TKT-001/report.pdf
 *   uploads/gen/announcements/42/photo.png
 *   uploads/gen/profile/abc-uuid/avatar.jpg
 */
export const getS3Key = (businessUnit, relationType, relationId, filename) => {
  if (!businessUnit || !relationType || !relationId || !filename) {
    throw new Error(
      "getS3Key requires businessUnit, relationType, relationId, and filename",
    );
  }

  const sanitized = filename.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  const timestamped = `${Date.now()}-${sanitized}`;

  return `uploads/${businessUnit}/${relationType}/${relationId}/${timestamped}`.toLowerCase();
};
