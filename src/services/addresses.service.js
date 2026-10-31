const { prisma } = require('../config/db');
const ApiError = require('../utils/ApiError');

const notFound = () => new ApiError(404, 'Address not found', { code: 'ADDRESS_NOT_FOUND' });

// Serialize per-user default changes: lock the user row so concurrent requests can't leave two defaults.
async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
}

async function list(userId) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

async function getOne(userId, addressId) {
  const a = await prisma.address.findFirst({ where: { id: addressId, userId } });
  if (!a) throw notFound();
  return a;
}

async function create(userId, data) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const count = await tx.address.count({ where: { userId } });
    const makeDefault = count === 0 || data.isDefault === true; // first address is always default
    if (makeDefault) await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    return tx.address.create({ data: { ...data, userId, isDefault: makeDefault } });
  });
}

async function update(userId, addressId, data) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.address.findFirst({ where: { id: addressId, userId } });
    if (!existing) throw notFound();
    const patch = { ...data };
    if (data.isDefault === true) {
      await tx.address.updateMany({
        where: { userId, isDefault: true, NOT: { id: addressId } },
        data: { isDefault: false },
      });
    } else if (data.isDefault === false && existing.isDefault) {
      // Must always keep a default: unset only by promoting another address.
      throw new ApiError(400, 'Set another address as default instead', { code: 'DEFAULT_REQUIRED' });
    }
    return tx.address.update({ where: { id: addressId }, data: patch });
  });
}

async function remove(userId, addressId) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.address.findFirst({ where: { id: addressId, userId } });
    if (!existing) throw notFound();
    await tx.address.delete({ where: { id: addressId } });
    if (existing.isDefault) {
      const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

module.exports = { list, getOne, create, update, remove };