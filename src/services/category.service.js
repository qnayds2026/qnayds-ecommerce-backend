const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");

async function listActiveCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

async function assertParentValid(parentId, selfId) {
  if (!parentId) return;

  // Parent chain nadannu circular loop illennu urappikkunnu
  let currentId = parentId;
  const seen = new Set();
  while (currentId) {
    if (selfId && currentId === selfId)
      throw ApiError.badRequest("Category cannot be its own ancestor");
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const node = await prisma.category.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!node) throw ApiError.badRequest("Parent category not found");
    currentId = node.parentId;
  }
}

async function createCategory(data) {
  await assertParentValid(data.parentId);
  return prisma.category.create({ data });
}

async function updateCategory(id, data) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Category not found");
  if (data.parentId !== undefined) await assertParentValid(data.parentId, id);
  return prisma.category.update({ where: { id }, data });
}

module.exports = { listActiveCategories, createCategory, updateCategory };