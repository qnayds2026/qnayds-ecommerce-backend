const authService = require("../services/auth.service");
const authConfig = require("../config/auth");

const COOKIE_NAME = authConfig.refreshToken.cookieName;

const setRefreshCookie = (res, token, expiresAt) => {
  res.cookie(COOKIE_NAME, token, { ...authConfig.cookie, expires: expiresAt });
};

// Options must match the ones used to set it (path, domain), otherwise
// the browser keeps the cookie.
const clearRefreshCookie = (res) => {
  res.clearCookie(COOKIE_NAME, authConfig.cookie);
};

// Known errors (with statusCode) become JSON responses. Anything else goes to
// the Express error handler, so no stack trace or internal message is exposed here.
const handleError = (err, res, next) => {
  if (err.statusCode) {
    return res.status(err.statusCode).json({ message: err.message });
  }
  return next(err);
};

const register = async (req, res, next) => {
  try {
    const user = await authService.register(req.body);
    return res.status(201).json({ user });
  } catch (err) {
    return handleError(err, res, next);
  }
};

const login = async (req, res, next) => {
  try {
    const { user, accessToken, refreshToken, refreshExpiresAt } =
      await authService.login(req.body);

    setRefreshCookie(res, refreshToken, refreshExpiresAt);
    // The refresh token is only in the HttpOnly cookie, never in the JSON body.
    return res.status(200).json({ user, accessToken });
  } catch (err) {
    return handleError(err, res, next);
  }
};

const refresh = async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[COOKIE_NAME];
    const { accessToken, refreshToken, refreshExpiresAt } =
      await authService.refresh(rawToken);

    setRefreshCookie(res, refreshToken, refreshExpiresAt);
    return res.status(200).json({ accessToken });
  } catch (err) {
    // A bad, expired or reused token: remove the cookie so the client stops sending it.
    if (err.statusCode === 401) clearRefreshCookie(res);
    return handleError(err, res, next);
  }
};

const logout = async (req, res, next) => {
  try {
    await authService.logout(req.cookies?.[COOKIE_NAME]);
    clearRefreshCookie(res);
    return res.status(200).json({ message: "Logged out" });
  } catch (err) {
    return handleError(err, res, next);
  }
};

// authenticate middleware already loaded a safe user into req.user.
const me = (req, res) => res.status(200).json({ user: req.user });

module.exports = { register, login, refresh, logout, me };