// src/middleware/authenticate.js
//
// Verifies JWT and attaches req.user to every request.
// Must run before requirePermission on all protected routes.

const jwt = require('jsonwebtoken')
const db  = require('../db')

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }

  const token = authHeader.split(' ')[1]

  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Load user with roles from DB (not from token — roles may have changed)
  const userResult = await db.query(
    `SELECT u.id, u.tenant_id, u.email, u.status, u.user_type,
            COALESCE(
              array_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
              ARRAY[]::text[]
            ) AS roles,
            up.org_unit_id
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)
     LEFT JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1 AND u.tenant_id = $2
     GROUP BY u.id, up.org_unit_id`,
    [payload.userId, payload.tenantId]
  )

  if (userResult.rows.length === 0) {
    return res.status(401).json({ error: 'User not found' })
  }

  const user = userResult.rows[0]

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account is not active' })
  }

  req.user = {
    id:         user.id,
    tenantId:   user.tenant_id,
    email:      user.email,
    userType:   user.user_type,
    roles:      user.roles,
    orgUnitId:  user.org_unit_id
  }

  next()
}

module.exports = { authenticate }
