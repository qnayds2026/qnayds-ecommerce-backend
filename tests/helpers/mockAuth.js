const jwt = require("jsonwebtoken");

// cuid-shaped ids that pass the route validators: "c" + 24 lowercase alphanumerics.
const cid = (label) => "c" + String(label).toLowerCase().padEnd(24, "0");

const USER_A = cid("usera");
const USER_B = cid("userb");

const bearerFor = (userId) =>
  `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "15m" })}`;

// authenticate() loads the user from the DB; return whichever user the token names.
const mockAuthenticatedUsers = (prisma) => {
  prisma.user.findUnique.mockImplementation(async ({ where }) => ({
    id: where.id,
    name: "Test",
    email: "test@example.com",
    role: "CUSTOMER",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
};

module.exports = { cid, USER_A, USER_B, bearerFor, mockAuthenticatedUsers };