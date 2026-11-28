const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");
const ordersService = require("../../services/orders.service");
const paymentsService = require("../payments/payments.service");
const razorpay = require("../payments/razorpay.service");
const {
  getApprovedReseller,
  getShippingCharge,
  getMaxMarginPercent,
} = require("./reseller.service");

const D = Prisma.Decimal;

const orderInclude = {
  sellerOrders: { include: { items: true, shipment: true } },
  orderItems: true,
};

function generateOrderNumber() {
  const time = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `ORD-${time}-${rand}`;
}

// Reseller places an order for an end customer.
// Prices, shipping and stock come from database/server config.
async function createResellerOrder(user, body, idempotencyKey) {
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw ApiError.badRequest("Idempotency-Key header is required");
  }

  const key = idempotencyKey.trim();

  if (key.length > 100) {
    throw ApiError.badRequest(
      "Idempotency-Key must not exceed 100 characters"
    );
  }

  const reseller = await getApprovedReseller(user);

  const existing = await prisma.order.findFirst({
    where: {
      userId: user.id,
      idempotencyKey: key,
    },
    include: orderInclude,
  });

  if (existing) return existing;

  // Validate reseller share code.
  let shareId = null;
  let shareProductId = null;

  if (body.shareCode) {
    const share = await prisma.resellerProductShare.findFirst({
      where: {
        code: body.shareCode,
        resellerId: reseller.id,
        isActive: true,
      },
      select: {
        id: true,
        productId: true,
      },
    });

    if (!share) {
      throw ApiError.badRequest("Invalid share code");
    }

    shareId = share.id;
    shareProductId = share.productId;
  }

  const shippingCharge = getShippingCharge();
  const maxPercent = getMaxMarginPercent();

  try {
    const createdOrder = await prisma.$transaction(
      async (tx) => {
        const variants = await tx.productVariant.findMany({
          where: {
            id: {
              in: body.items.map((item) => item.variantId),
            },
            isActive: true,
            product: {
              status: "ACTIVE",
              isResellable: true,
            },
          },
          include: {
            product: true,
            inventory: true,
          },
        });

        const byId = new Map(variants.map((v) => [v.id, v]));

        const sellerGroups = new Map();
        const reservations = [];

        let itemsTotal = new D(0);
        let marginTotal = new D(0);

        for (const item of body.items) {
          const variant = byId.get(item.variantId);

          if (!variant || !variant.inventory) {
            throw ApiError.notFound(
              "Product not found or not available for reselling"
            );
          }

          const product = variant.product;

          // Share code must match the ordered product.
          if (shareProductId && product.id !== shareProductId) {
            throw ApiError.badRequest(
              "Share code does not match the ordered product"
            );
          }

          const available =
            variant.inventory.quantityAvailable -
            variant.inventory.quantityReserved;

          if (available < item.quantity) {
            throw ApiError.conflict(
              `Insufficient stock for ${product.name}`
            );
          }

          const unitPrice = new D(variant.price.toString());
          const marginPerUnit = new D(item.margin);

          const maxMargin = unitPrice
            .mul(maxPercent)
            .div(100)
            .toDecimalPlaces(2, D.ROUND_DOWN);

          if (marginPerUnit.gt(maxMargin)) {
            throw ApiError.badRequest(
              `Margin for ${product.name} cannot be more than ${maxMargin.toFixed(
                2
              )} per unit`
            );
          }

          const subtotal = unitPrice.mul(item.quantity);

          itemsTotal = itemsTotal.plus(subtotal);
          marginTotal = marginTotal.plus(
            marginPerUnit.mul(item.quantity)
          );

          if (!sellerGroups.has(product.sellerId)) {
            sellerGroups.set(product.sellerId, {
              totalAmount: new D(0),
              items: [],
            });
          }

          const group = sellerGroups.get(product.sellerId);

          // Seller receives product price only, not reseller margin.
          group.totalAmount = group.totalAmount.plus(subtotal);

          group.items.push({
            variantId: variant.id,
            productName: product.name,
            variantName: variant.name,
            variantAttributes: variant.attributes ?? null,
            sku: variant.sku,
            unitPrice,
            quantity: item.quantity,
            subtotal,
            resellerMargin: marginPerUnit,
          });

          reservations.push({
            variantId: variant.id,
            quantity: item.quantity,
            name: product.name,
          });
        }

        const customerTotal = itemsTotal
          .plus(shippingCharge)
          .plus(marginTotal);

        const customer = body.customer;

        const order = await tx.order.create({
          data: {
            orderNumber: generateOrderNumber(),
            userId: user.id,
            idempotencyKey: key,
            status: "PENDING_PAYMENT",
            totalAmount: customerTotal,
            currency: "INR",

            shippingCharge,
            resellerMarginTotal: marginTotal,
            resellerId: reseller.id,
            resellerShareId: shareId,

            deliveryName: customer.name,
            deliveryPhone: customer.phone,
            deliveryAddressLine1: customer.addressLine1,
            deliveryAddressLine2:
              customer.addressLine2 ?? null,
            deliveryCity: customer.city,
            deliveryState: customer.state,
            deliveryPostalCode: customer.postalCode,
            deliveryCountry: "India",
          },
        });

        for (const [sellerId, group] of sellerGroups) {
          const sellerOrder = await tx.sellerOrder.create({
            data: {
              orderId: order.id,
              sellerId,
              status: "PENDING_PAYMENT",
              totalAmount: group.totalAmount,
            },
          });

          for (const item of group.items) {
            const orderItem = await tx.orderItem.create({
              data: {
                orderId: order.id,
                sellerOrderId: sellerOrder.id,
                ...item,
              },
            });

            // Create reseller earning and immutable ledger event.
            // Both are inside the same transaction as the order.
            const earningAmount = item.resellerMargin.mul(
              item.quantity
            );

            await tx.resellerEarning.create({
              data: {
                resellerId: reseller.id,
                orderId: order.id,
                orderItemId: orderItem.id,
                quantity: item.quantity,
                amount: earningAmount,
                status: "PENDING",

                events: {
                  create: {
                    type: "ACCRUED",
                    amountDelta: earningAmount,
                    reason: "Reseller order placed",
                    actorId: user.id,
                  },
                },
              },
            });
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              sellerOrderId: sellerOrder.id,
              oldStatus: null,
              newStatus: "PENDING_PAYMENT",
              changedBy: user.id,
              note: "Order created",
            },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            oldStatus: null,
            newStatus: "PENDING_PAYMENT",
            changedBy: user.id,
            note: "Order created by reseller",
          },
        });

        // Atomically reserve inventory.
        for (const reservation of reservations) {
          const reserved = await tx.$executeRaw`
            UPDATE "inventory"
            SET "quantityReserved" = "quantityReserved" + ${reservation.quantity},
                "updatedAt" = NOW()
            WHERE "variantId" = ${reservation.variantId}
              AND ("quantityAvailable" - "quantityReserved") >= ${reservation.quantity}
          `;

          if (reserved !== 1) {
            throw ApiError.conflict(
              `Stock changed while placing order for ${reservation.name}`
            );
          }
        }

        return tx.order.findUnique({
          where: {
            id: order.id,
          },
          include: {
            ...orderInclude,
            orderStatusHistories: {
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        });
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );

    // Notifications should not fail a saved order.
    if (typeof ordersService.notifyOrderPlaced === "function") {
      try {
        await ordersService.notifyOrderPlaced(createdOrder);
      } catch (err) {
        console.error(
          "Reseller order notification failed:",
          err.message
        );
      }
    }

    return createdOrder;
  } catch (error) {
    if (error.code === "P2002") {
      const duplicate = await prisma.order.findFirst({
        where: {
          userId: user.id,
          idempotencyKey: key,
        },
        include: orderInclude,
      });

      if (duplicate) return duplicate;
    }

    throw error;
  }
}

// Create order, then start payment.
async function placeOrder(user, body, idempotencyKey) {
  const paymentMethod = body.paymentMethod || "ONLINE";

  // Check Razorpay config before reserving stock.
  if (paymentMethod === "ONLINE") {
    razorpay.assertConfigured();
  }

  const order = await createResellerOrder(
    user,
    body,
    idempotencyKey
  );

  const summary = {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.totalAmount,
    shippingCharge: order.shippingCharge,
    resellerMarginTotal: order.resellerMarginTotal,
    currency: order.currency,
  };

  if (order.status !== "PENDING_PAYMENT") {
    return {
      order: summary,
      payment: null,
    };
  }

  if (paymentMethod === "COD") {
    const payment =
      await paymentsService.startCodPaymentForOrder(order);

    return {
      order: summary,
      payment: paymentsService.toCodDetails(payment),
    };
  }

  const payment =
    await paymentsService.startPaymentForOrder(order);

  return {
    order: summary,
    payment: paymentsService.toClientDetails(payment),
  };
}

// Only the logged-in reseller's own orders.
async function listOrders(user, query) {
  const profile = await prisma.resellerProfile.findUnique({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
    },
  });

  if (!profile) {
    throw ApiError.notFound("Reseller profile not found");
  }

  const { page, limit } = query;

  const where = {
    resellerId: profile.id,
  };

  const [total, items] = await Promise.all([
    prisma.order.count({
      where,
    }),

    prisma.order.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,

      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        currency: true,
        shippingCharge: true,
        resellerMarginTotal: true,
        createdAt: true,
        deliveryName: true,
        deliveryCity: true,
        deliveryState: true,
        deliveryPostalCode: true,

        orderItems: {
          select: {
            productName: true,
            variantName: true,
            quantity: true,
            unitPrice: true,
            resellerMargin: true,
          },
        },
      },
    }),
  ]);

  return {
    items,
    page,
    limit,
    total,
  };
}

module.exports = {
  createResellerOrder,
  placeOrder,
  listOrders,
};