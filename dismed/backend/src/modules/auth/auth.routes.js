const router = require('express').Router();
const { login, me, cambiarPassword } = require('./auth.controller');
const auth = require('../../middleware/auth');
const { loginLimiter } = require('../../middleware/rateLimit');

router.post('/login', loginLimiter, login);
router.get('/me', auth, me);
router.post('/cambiar-password', auth, cambiarPassword);

module.exports = router;
