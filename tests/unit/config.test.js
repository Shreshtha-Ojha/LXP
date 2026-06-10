// tests/unit/config.test.js
//
// Unit tests for src/modules/config/configService.js and the RBAC wiring in
// src/modules/config/configRoutes.js.
//
// Pattern (matches tests/unit/roles.test.js): mock db and auditLog so we can
// assert exactly what gets queried/written, including the in-memory cache
// (CACHE_TTL_MS) avoiding a re-query within its TTL. authenticate is mocked
// at the top level so every required module shares the same mocked db
// singleton.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
jest.mock('../../src/middleware/authenticate', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'test@example.com',
      userType: 'internal',
      roles: [req.headers['x-test-role']],
      orgUnitId: 'ou-1'
    }
    next()
  }
}))

const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const configService = require('../../src/modules/config/configService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

beforeEach(() => {
  jest.clearAllMocks()
  configService.clearCache()
})

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('get', () => {
  it('queries configurations on a cache miss and returns the unwrapped value', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: { value: 8 } }] })

    const result = await configService.get('tenant-1', 'auth', 'password_min_length')

    expect(result).toBe(8)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('WHERE tenant_id = $1 AND module = $2 AND key = $3')
    expect(params).toEqual(['tenant-1', 'auth', 'password_min_length'])
  })

  it('serves subsequent reads from cache without hitting the database', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: { value: 8 } }] })

    await configService.get('tenant-1', 'auth', 'password_min_length')
    const second = await configService.get('tenant-1', 'auth', 'password_min_length')

    expect(second).toBe(8)
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('re-queries once the cache entry passes its 5-minute TTL', async () => {
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000_000)

    db.query.mockResolvedValueOnce({ rows: [{ value: { value: 8 } }] })
    await configService.get('tenant-1', 'auth', 'password_min_length')

    nowSpy.mockReturnValue(1_000_000 + configService.CACHE_TTL_MS + 1)
    db.query.mockResolvedValueOnce({ rows: [{ value: { value: 10 } }] })
    const result = await configService.get('tenant-1', 'auth', 'password_min_length')

    expect(result).toBe(10)
    expect(db.query).toHaveBeenCalledTimes(2)

    nowSpy.mockRestore()
  })

  it('returns null and caches the miss when no row exists for the key', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await configService.get('tenant-1', 'auth', 'unknown_key')
    expect(result).toBeNull()

    const second = await configService.get('tenant-1', 'auth', 'unknown_key')
    expect(second).toBeNull()
    expect(db.query).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

describe('set', () => {
  const ROW = {
    id: 'cfg-1', tenant_id: 'tenant-1', module: 'auth', key: 'password_min_length',
    value: { value: 10 }, description: 'Minimum password length', updated_by: 'admin-1', updated_at: '2026-06-10'
  }
  const SUPER_ADMIN = { id: 'admin-1', roles: ['super_admin'] }

  it('upserts the value and writes CONFIG_CHANGED with old/new snapshots in the same transaction', async () => {
    const client = txClient([
      {},                                          // BEGIN
      { rows: [{ ...ROW, value: { value: 8 } }] }, // SELECT current
      { rows: [ROW] },                             // UPSERT ... RETURNING
      {},                                          // audit insert
      {}                                           // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await configService.set(
      'tenant-1', 'auth', 'password_min_length', 10, SUPER_ADMIN, { ipAddress: '127.0.0.1', userAgent: 'jest' }
    )

    expect(result).toEqual(expect.objectContaining({ id: 'cfg-1', module: 'auth', key: 'password_min_length', value: 10 }))

    const [upsertSql, upsertParams] = client.query.mock.calls[2]
    expect(upsertSql).toContain('ON CONFLICT (tenant_id, module, key)')
    expect(upsertParams).toEqual(['tenant-1', 'auth', 'password_min_length', JSON.stringify({ value: 10 }), 'admin-1'])

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'admin-1',
        actorRoleAtTime: 'super_admin',
        actionType: auditLog.AuditActions.CONFIG_CHANGED,
        entityType: 'Configuration',
        entityId: 'cfg-1',
        oldValue: { module: 'auth', key: 'password_min_length', value: 8 },
        newValue: { module: 'auth', key: 'password_min_length', value: 10 },
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        result: 'success'
      }),
      client
    )
  })

  it('records oldValue as null when the configuration key did not exist before', async () => {
    const NEW_ROW = {
      id: 'cfg-2', tenant_id: 'tenant-1', module: 'org', key: 'new_setting',
      value: { value: 'x' }, description: null, updated_by: 'admin-1', updated_at: '2026-06-10'
    }
    const client = txClient([
      {},           // BEGIN
      { rows: [] }, // SELECT current -> none
      { rows: [NEW_ROW] }, // UPSERT (insert path) ... RETURNING
      {},           // audit insert
      {}            // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await configService.set('tenant-1', 'org', 'new_setting', 'x', SUPER_ADMIN)

    expect(result.value).toBe('x')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: { module: 'org', key: 'new_setting', value: null },
        newValue: { module: 'org', key: 'new_setting', value: 'x' }
      }),
      client
    )
  })

  it('refreshes the cache so a subsequent get reflects the new value immediately', async () => {
    const client = txClient([
      {},
      { rows: [{ ...ROW, value: { value: 8 } }] },
      { rows: [ROW] },
      {},
      {}
    ])
    db.getClient.mockResolvedValueOnce(client)

    await configService.set('tenant-1', 'auth', 'password_min_length', 10, SUPER_ADMIN)

    const value = await configService.get('tenant-1', 'auth', 'password_min_length')

    expect(value).toBe(10)
    expect(db.query).not.toHaveBeenCalled() // served from cache, not a fresh query
  })

  it('rolls back and rethrows on database error, without writing an audit event', async () => {
    const client = txClient([
      {},                              // BEGIN
      Promise.reject(new Error('boom')) // SELECT current -> error
    ])
    db.getClient.mockResolvedValueOnce(client)

    await expect(
      configService.set('tenant-1', 'auth', 'password_min_length', 10, SUPER_ADMIN)
    ).rejects.toThrow('boom')

    expect(client.release).toHaveBeenCalled()
    expect(auditLog.write).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// isFeatureEnabled
// ---------------------------------------------------------------------------

describe('isFeatureEnabled', () => {
  it('queries feature_flags on a cache miss', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ is_enabled: true }] })

    const result = await configService.isFeatureEnabled('tenant-1', 'sso')

    expect(result).toBe(true)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('FROM feature_flags')
    expect(params).toEqual(['tenant-1', 'sso'])
  })

  it('serves subsequent reads from cache without hitting the database', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ is_enabled: true }] })

    await configService.isFeatureEnabled('tenant-1', 'sso')
    const second = await configService.isFeatureEnabled('tenant-1', 'sso')

    expect(second).toBe(true)
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('returns false when no flag row exists for the tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await configService.isFeatureEnabled('tenant-1', 'unknown_feature')

    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// setFeatureFlag
// ---------------------------------------------------------------------------

describe('setFeatureFlag', () => {
  const FLAG_ROW = {
    id: 'flag-1', tenant_id: 'tenant-1', feature: 'sso', is_enabled: true,
    description: 'Single Sign-On login', updated_by: 'admin-1', updated_at: '2026-06-10'
  }
  const SUPER_ADMIN = { id: 'admin-1', roles: ['super_admin'] }

  it('upserts is_enabled and writes FEATURE_FLAG_CHANGED with old/new snapshots', async () => {
    const client = txClient([
      {},                                              // BEGIN
      { rows: [{ ...FLAG_ROW, is_enabled: false }] },  // SELECT current
      { rows: [FLAG_ROW] },                            // UPSERT ... RETURNING
      {},                                              // audit insert
      {}                                               // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await configService.setFeatureFlag(
      'tenant-1', 'sso', true, SUPER_ADMIN, { ipAddress: '127.0.0.1', userAgent: 'jest' }
    )

    expect(result).toEqual(expect.objectContaining({ id: 'flag-1', feature: 'sso', isEnabled: true }))

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        actorRoleAtTime: 'super_admin',
        actionType: auditLog.AuditActions.FEATURE_FLAG_CHANGED,
        entityType: 'FeatureFlag',
        entityId: 'flag-1',
        oldValue: { feature: 'sso', isEnabled: false },
        newValue: { feature: 'sso', isEnabled: true },
        result: 'success'
      }),
      client
    )
  })

  it('refreshes the cache so a subsequent isFeatureEnabled reflects the new value immediately', async () => {
    const client = txClient([
      {},
      { rows: [{ ...FLAG_ROW, is_enabled: false }] },
      { rows: [FLAG_ROW] },
      {},
      {}
    ])
    db.getClient.mockResolvedValueOnce(client)

    await configService.setFeatureFlag('tenant-1', 'sso', true, SUPER_ADMIN)

    const enabled = await configService.isFeatureEnabled('tenant-1', 'sso')

    expect(enabled).toBe(true)
    expect(db.query).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Route-level RBAC
// (Rule 10 — at least one allowed role succeeds, one denied role gets a 403)
// ---------------------------------------------------------------------------

describe('config admin routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const configRoutes = require('../../src/modules/config/configRoutes')

  const app = express()
  app.use(express.json())
  app.use(configRoutes)

  describe('GET /admin/config', () => {
    it('allows super_admin (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }) // listConfig

      const res = await request(app).get('/admin/config').set('x-test-role', 'super_admin')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })

    it('denies ld_admin (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app).get('/admin/config').set('x-test-role', 'ld_admin')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })

      const [violationSql, violationParams] = db.query.mock.calls[1]
      expect(violationSql).toContain('ACCESS_VIOLATION')
      expect(violationParams).toEqual(
        expect.arrayContaining(['tenant-1', 'user-1', 'ld_admin', 'config.settings'])
      )
    })
  })

  describe('PUT /admin/config/:module/:key', () => {
    const CURRENT_ROW = {
      id: 'cfg-1', tenant_id: 'tenant-1', module: 'auth', key: 'password_min_length',
      value: { value: 8 }, description: 'Minimum password length', updated_by: null, updated_at: '2026-06-10'
    }
    const UPDATED_ROW = { ...CURRENT_ROW, value: { value: 10 }, updated_by: 'user-1' }

    it('allows super_admin (200) and writes CONFIG_CHANGED', async () => {
      const client = txClient([
        {},                       // BEGIN
        { rows: [CURRENT_ROW] },  // SELECT current
        { rows: [UPDATED_ROW] },  // UPSERT ... RETURNING
        {},                       // audit insert
        {}                        // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .put('/admin/config/auth/password_min_length')
        .set('x-test-role', 'super_admin')
        .send({ value: 10 })

      expect(res.status).toBe(200)
      expect(res.body).toEqual(expect.objectContaining({ module: 'auth', key: 'password_min_length', value: 10 }))

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: auditLog.AuditActions.CONFIG_CHANGED,
          newValue: { module: 'auth', key: 'password_min_length', value: 10 }
        }),
        client
      )
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .put('/admin/config/auth/password_min_length')
        .set('x-test-role', 'associate')
        .send({ value: 10 })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })

    it('returns 400 when value is missing, without touching the database', async () => {
      const res = await request(app)
        .put('/admin/config/auth/password_min_length')
        .set('x-test-role', 'super_admin')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'value is required' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('GET /admin/features', () => {
    it('allows super_admin (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }) // listFeatureFlags

      const res = await request(app).get('/admin/features').set('x-test-role', 'super_admin')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })

    it('denies ld_admin (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app).get('/admin/features').set('x-test-role', 'ld_admin')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('PUT /admin/features/:feature', () => {
    const CURRENT_FLAG = {
      id: 'flag-1', tenant_id: 'tenant-1', feature: 'sso', is_enabled: false,
      description: 'Single Sign-On login', updated_by: null, updated_at: '2026-06-10'
    }
    const UPDATED_FLAG = { ...CURRENT_FLAG, is_enabled: true, updated_by: 'user-1' }

    it('allows super_admin (200) and writes FEATURE_FLAG_CHANGED', async () => {
      const client = txClient([
        {},                      // BEGIN
        { rows: [CURRENT_FLAG] }, // SELECT current
        { rows: [UPDATED_FLAG] }, // UPSERT ... RETURNING
        {},                      // audit insert
        {}                       // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .put('/admin/features/sso')
        .set('x-test-role', 'super_admin')
        .send({ enabled: true })

      expect(res.status).toBe(200)
      expect(res.body).toEqual(expect.objectContaining({ feature: 'sso', isEnabled: true }))

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: auditLog.AuditActions.FEATURE_FLAG_CHANGED,
          newValue: { feature: 'sso', isEnabled: true }
        }),
        client
      )
    })

    it('returns 400 when enabled is not a boolean, without touching the database', async () => {
      const res = await request(app)
        .put('/admin/features/sso')
        .set('x-test-role', 'super_admin')
        .send({ enabled: 'yes' })

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'enabled (boolean) is required' })
      expect(db.getClient).not.toHaveBeenCalled()
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .put('/admin/features/sso')
        .set('x-test-role', 'associate')
        .send({ enabled: true })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })
})
