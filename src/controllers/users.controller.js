const usersService = require("../services/users.service");

// The user id comes from the verified token (req.user), never from the request body.
const updateMe = async (req, res, next) => {
  try {
    const user = await usersService.updateProfile(req.user.id, req.body);
    return res.status(200).json({ user });
  } catch (err) {
    return next(err);
  }
};

module.exports = { updateMe };