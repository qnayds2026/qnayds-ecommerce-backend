const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");
const { assertCanManageProduct } = require("./ownership.service");

async function addImage(user, productId, data) {
  await assertCanManageProduct(user, productId);

  const last = await prisma.productImage.findFirst({
    where: { productId },
    orderBy: { sortOrder: "desc" },
  });
  const sortOrder = last ? last.sortOrder + 1 : 0;

  return prisma.productImage.create({
    data: { ...data, sortOrder, productId },
  });
}

async function getImageOrThrow(id) {
  const image = await prisma.productImage.findUnique({ where: { id } });
  if (!image) throw ApiError.notFound("Image not found");
  return image;
}

async function updateImage(user, id, data) {
  const image = await getImageOrThrow(id);
  await assertCanManageProduct(user, image.productId);
  return prisma.productImage.update({ where: { id }, data });
}

async function deleteImage(user, id) {
  const image = await getImageOrThrow(id);
  await assertCanManageProduct(user, image.productId);
  await prisma.productImage.delete({ where: { id } });
}

module.exports = { addImage, updateImage, deleteImage };