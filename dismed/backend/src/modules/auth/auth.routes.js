const router = require('express').Router();
const { login, me } = require('./auth.controller');
const auth = require('../../middleware/auth');

router.post('/login', login);
router.get('/me', auth, me);

module.exports = router;
