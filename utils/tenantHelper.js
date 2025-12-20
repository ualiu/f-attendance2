/**
 * Tenant Scoping Utilities
 *
 * CRITICAL: These utilities enforce data isolation between organizations.
 * ALWAYS use scopeQuery() for database queries to prevent data leakage.
 */

/**
 * Add organization_id to query filter
 *
 * This ensures all database queries are scoped to the user's organization,
 * preventing cross-tenant data access.
 *
 * @param {ObjectId} organizationId - The organization ID from req.organizationId
 * @param {Object} baseQuery - Optional base query object
 * @returns {Object} Query object with organization_id added
 *
 * @example
 * // Simple query
 * const employees = await Employee.find(scopeQuery(req.organizationId));
 *
 * @example
 * // Query with filters
 * const employees = await Employee.find(scopeQuery(req.organizationId, {
 *   status: 'at_risk'
 * }));
 */
exports.scopeQuery = (organizationId, baseQuery = {}) => {
  if (!organizationId) {
    throw new Error('organizationId is required for scoped queries');
  }

  return {
    ...baseQuery,
    organization_id: organizationId
  };
};

/**
 * Validate that a resource belongs to the user's organization
 *
 * Use this before updating or deleting resources to prevent
 * unauthorized cross-tenant modifications.
 *
 * @param {Model} Model - Mongoose model class
 * @param {ObjectId} resourceId - ID of the resource to validate
 * @param {ObjectId} organizationId - The organization ID from req.organizationId
 * @returns {Promise<Document>} The resource if found and owned by organization
 * @throws {Error} If resource not found or belongs to different organization
 *
 * @example
 * const employee = await validateTenantAccess(
 *   Employee,
 *   req.params.id,
 *   req.organizationId
 * );
 * // Now safe to update employee
 * employee.name = 'New Name';
 * await employee.save();
 */
exports.validateTenantAccess = async (Model, resourceId, organizationId) => {
  if (!organizationId) {
    throw new Error('organizationId is required for access validation');
  }

  if (!resourceId) {
    throw new Error('resourceId is required for access validation');
  }

  const resource = await Model.findOne({
    _id: resourceId,
    organization_id: organizationId
  });

  if (!resource) {
    throw new Error('Resource not found or access denied');
  }

  return resource;
};

/**
 * Validate that multiple resources belong to the user's organization
 *
 * @param {Model} Model - Mongoose model class
 * @param {Array<ObjectId>} resourceIds - Array of resource IDs to validate
 * @param {ObjectId} organizationId - The organization ID from req.organizationId
 * @returns {Promise<Array<Document>>} Array of resources if all are owned by organization
 * @throws {Error} If any resource not found or belongs to different organization
 */
exports.validateTenantAccessBulk = async (Model, resourceIds, organizationId) => {
  if (!organizationId) {
    throw new Error('organizationId is required for access validation');
  }

  if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
    throw new Error('resourceIds must be a non-empty array');
  }

  const resources = await Model.find({
    _id: { $in: resourceIds },
    organization_id: organizationId
  });

  if (resources.length !== resourceIds.length) {
    throw new Error('One or more resources not found or access denied');
  }

  return resources;
};
