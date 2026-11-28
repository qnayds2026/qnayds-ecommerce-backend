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

// The reseller places the order for an end customer. Prices, shipping and
// stock come from the database and server config. The client only sends the
// variants, quantities, its own margin per unit and the customer's address.
async function createResellerOrder(user, body, idempotencyKey) {
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw ApiError.badRequest("Idempotency-Key header is required");
  }
  const key = idempotencyKey.trim();
  if (key.length > 100) {
    throw ApiError.badRequest("Idempotency-Key must not exceed 100 characters");
  }

  const reseller = await getApprovedReseller(user);

  const existing = await prisma.order.findFirst({
    where: { userId: user.id, idempotencyKey: key },
    include: orderInclude,
  });
  if (existing) return existing;

  // A share code can only be used by the reseller who owns it.
  let shareId = null;
  if (body.shareCode) {
    const share = await prisma.resellerProductShare.findFirst({
      where: { code: body.shareCode, resellerId: reseller.id, isActive: true },
      select: { id: true },
    });
    if (!share) {
      throw ApiError.badRequest("Invalid share code");
    }
    shareId = share.id;
  }

  const shippingCharge = getShippingCharge();
  const maxPercent = getMaxMarginPercent();

  try {
    const createdOrder = await prisma.$transaction(
      async (tx) => {
        const variants = await tx.productVariant.findMany({
          where: {
            id: { in: body.items.map((i) => i.variantId) },
            isActive: true,
            product: { status: "ACTIVE", isResellable: true },
          },
          include: { product: true, inventory: true },
        });
        const byId = new Map(variants.map((v) => [v.id, v]));

        const sellerGroups = new Map();
        const reservations = [];
        let itemsTotal = new D(0);
        let marginTotal = new D(0);

        for (const item of body.items) {
          const variant = byId.get(item.variantId);
          if (!variant || !variant.inventory) {
            throw ApiError.notFound("Product not found or not available for reselling");
          }
          const product = variant.product;

          const available =
            variant.inventory.quantityAvailable -
            variant.inventory.quantityReserved;
          if (available < item.quantity) {
            throw ApiError.conflict(`Insufficient stock for ${product.name}`);
          }

          const unitPrice = new D(variant.price.toString());
          const marginPerUnit = new D(item.margin);
          const maxMargin = unitPrice
            .mul(maxPercent)
            .div(100)
            .toDecimalPlaces(2, D.ROUND_DOWN);
          if (marginPerUnit.gt(maxMargin)) {
            throw ApiError.badRequest(
              `Margin for ${product.name} cannot be more than ${maxMargin.toFixed(2)} per unit`
            );
          }

          const subtotal = unitPrice.mul(item.quantity);
          itemsTotal = itemsTotal.plus(subtotal);
          marginTotal = marginTotal.plus(marginPerUnit.mul(item.quantity));

          if (!sellerGroups.has(product.sellerId)) {
            sellerGroups.set(product.sellerId, {
              totalAmount: new D(0),
              items: [],
            });
          }
          const group = sellerGroups.get(product.sellerId);
          // The seller is paid the product price only. The margin is not part
          // of the seller's total.
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
            resellerMargin: marginPerUnit, // per unit, snapshot
          });
          reservations.push({
            variantId: variant.id,
            quantity: item.quantity,
            name: product.name,
          });
        }

        const customerTotal = itemsTotal.plus(shippingCharge).plus(marginTotal);
        const c = body.customer;

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

            deliveryName: c.name,
            deliveryPhone: c.phone,
            deliveryAddressLine1: c.addressLine1,
            deliveryAddressLine2: c.addressLine2 ?? null,
            deliveryCity: c.city,
            deliveryState: c.state,
            deliveryPostalCode: c.postalCode,
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
            await tx.orderItem.create({
              data: {
                orderId: order.id,
                sellerOrderId: sellerOrder.id,
                ...item,
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

        for (const r of reservations) {
          const reserved = await tx.$executeRaw`
            UPDATE "inventory"
            SET "quantityReserved" = "quantityReserved" + ${r.quantity},
                "updatedAt" = NOW()
            WHERE "variantId" = ${r.variantId}
              AND ("quantityAvailable" - "quantityReserved") >= ${r.quantity}
          `;
          if (reserved !== 1) {
            throw ApiError.conflict(
              `Stock changed while placing order for ${r.name}`
            );
          }
        }

        return tx.order.findUnique({
          where: { id: order.id },
          include: {
            ...orderInclude,
            orderStatusHistories: { orderBy: { createdAt: "desc" } },
          },
        });
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // Notifications must never fail an order that is already saved.
    if (typeof ordersService.notifyOrderPlaced === "function") {
      try {
        await ordersService.notifyOrderPlaced(createdOrder);
      } catch (err) {
        console.error("Reseller order notification failed:", err.message);
      }
    }

    return createdOrder;
  } catch (error) {
    if (error.code === "P2002") {
      const duplicate = await prisma.order.findFirst({
        where: { userId: user.id, idempotencyKey: key },
        include: orderInclude,
      });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

// Same flow as checkout(): create the order, then start the payment.
async function placeOrder(user, body, idempotencyKey) {
  const paymentMethod = body.paymentMethod || "ONLINE";

  // Fail before any stock is reserved if Razorpay is not configured.
  if (paymentMethod === "ONLINE") {
    razorpay.assertConfigured();
  }

  const order = await createResellerOrder(user, body, idempotencyKey);

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
    return { order: summary, payment: null };
  }

  if (paymentMethod === "COD") {
    const payment = await paymentsService.startCodPaymentForOrder(order);
    return { order: summary, payment: paymentsService.toCodDetails(payment) };
  }

  const payment = await paymentsService.startPaymentForOrder(order);
  return { order: summary, payment: paymentsService.toClientDetails(payment) };
}

// Only the logged-in reseller's own orders. No seller or payment details.
async function listOrders(user, query) {
  const profile = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!profile) {
    throw ApiError.notFound("Reseller profile not found");
  }

  const { page, limit } = query;
  const where = { resellerId: profile.id };

  const [total, items] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
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

  return { items, page, limit, total };
}

module.exports = { createResellerOrder, placeOrder, listOrders };