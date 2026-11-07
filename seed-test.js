require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PASSWORD = 'Test@1234';

async function main() {
  // pazhaya + puthiya TEST rows mathram delete cheyyum
  const vPrefixes = [{ startsWith: 'test-variant-' }, { startsWith: 'ctestvariant' }];
  const pPrefixes = [{ startsWith: 'test-product-' }, { startsWith: 'ctestproduct' }];
  await prisma.cartItem.deleteMany({ where: { OR: vPrefixes.map((p) => ({ variantId: p })) } });
  await prisma.wishlistItem.deleteMany({ where: { OR: pPrefixes.map((p) => ({ productId: p })) } });
  await prisma.inventory.deleteMany({ where: { OR: vPrefixes.map((p) => ({ variantId: p })) } });
  await prisma.productVariant.deleteMany({ where: { OR: vPrefixes.map((p) => ({ id: p })) } });
  await prisma.product.deleteMany({ where: { OR: pPrefixes.map((p) => ({ id: p })) } });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ---- Users (all password: Test@1234) ----
  const users = [
    { id: 'test-admin-user', name: 'TEST Admin', email: 'test.admin@example.com', role: 'ADMIN' },
    { id: 'test-seller-user', name: 'TEST Seller', email: 'test.seller@example.com', role: 'SELLER' },
    { id: 'test-seller2-user', name: 'TEST Seller 2', email: 'test.seller2@example.com', role: 'SELLER' },
    { id: 'test-pending-user', name: 'TEST Pending Seller', email: 'test.pending@example.com', role: 'SELLER' },
    { id: 'test-customer-user', name: 'TEST Customer', email: 'test.customer@example.com', role: 'CUSTOMER' },
    { id: 'test-customer2-user', name: 'TEST Customer 2', email: 'test.customer2@example.com', role: 'CUSTOMER' },
  ];
  for (const u of users) {
    // update-il passwordHash/role koodi: pazhaya 'not-a-real-hash' row fix aakum
    await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash, role: u.role, name: u.name },
      create: { ...u, passwordHash },
    });
  }

  // ---- Seller profiles ----
  const sellerProfiles = [
    { id: 'test-seller-profile', userId: 'test-seller-user', shopName: 'TEST Shop', status: 'APPROVED' },
    { id: 'test-seller2-profile', userId: 'test-seller2-user', shopName: 'TEST Shop 2', status: 'APPROVED' },
    { id: 'test-pending-profile', userId: 'test-pending-user', shopName: 'TEST Pending Shop', status: 'PENDING' },
  ];
  for (const sp of sellerProfiles) {
    await prisma.sellerProfile.upsert({
      where: { userId: sp.userId },
      update: { status: sp.status },
      create: sp,
    });
  }
  const profile = { id: 'test-seller-profile' };

  const category = await prisma.category.upsert({
    where: { slug: 'test-category' },
    update: {},
    create: { id: 'test-category', name: 'TEST Category', slug: 'test-category' },
  });

  const products = [
    { id: 'ctestproduct0000000001', name: 'TEST Active Product', slug: 'test-active-product', status: 'ACTIVE' },
    { id: 'ctestproduct0000000002', name: 'TEST Draft Product', slug: 'test-draft-product', status: 'DRAFT' },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, sellerId: profile.id, categoryId: category.id },
    });
  }

  const variants = [
    { id: 'ctestvariant0000000001', productId: 'ctestproduct0000000001', sku: 'TEST-SKU-1', price: '499.00', isActive: true, available: 10, reserved: 0 },
    { id: 'ctestvariant0000000002', productId: 'ctestproduct0000000001', sku: 'TEST-SKU-2', price: '299.00', isActive: true, available: 2, reserved: 1 },
    { id: 'ctestvariant0000000003', productId: 'ctestproduct0000000001', sku: 'TEST-SKU-3', price: '199.00', isActive: false, available: 5, reserved: 0 },
    { id: 'ctestvariant0000000004', productId: 'ctestproduct0000000002', sku: 'TEST-SKU-4', price: '399.00', isActive: true, available: 5, reserved: 0 },
  ];
  for (const v of variants) {
    await prisma.productVariant.upsert({
      where: { id: v.id },
      update: {},
      create: { id: v.id, productId: v.productId, sku: v.sku, price: v.price, isActive: v.isActive },
    });
    await prisma.inventory.upsert({
      where: { variantId: v.id },
      update: {},
      create: { variantId: v.id, quantityAvailable: v.available, quantityReserved: v.reserved },
    });
  }

  console.log('TEST data ready. All test users password:', PASSWORD);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());