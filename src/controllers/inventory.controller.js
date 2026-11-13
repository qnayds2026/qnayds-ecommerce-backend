const asyncHandler = require("../utils/asyncHandler");
const service = require("../services/inventory.service");

const update = asyncHandler(async (req, res) => {
  const data = await service.updateInventory(
    req.user,
    req.validated.params.id,
    req.validated.body
  );
  res.json({ success: true, data });
});

// Admin only: GET /api/v1/inventory/admin/all
const adminList = asyncHandler(async (req, res) => {
  const data = await service.adminListInventory(req.validated.query);
  res.json({ success: true, data });
});

module.exports = { update, adminList };

