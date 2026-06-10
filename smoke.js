const request = require('supertest')
const app = require('./src/index')

async function main() {
  let res = await request(app).get('/health')
  console.log('GET /health ->', res.status, res.body)

  res = await request(app).get('/admin/roles')
  console.log('GET /admin/roles (no auth) ->', res.status, res.body)

  res = await request(app).get('/admin/config')
  console.log('GET /admin/config (no auth) ->', res.status, res.body)

  res = await request(app).get('/admin/features')
  console.log('GET /admin/features (no auth) ->', res.status, res.body)

  res = await request(app).get('/workflows/tasks/me')
  console.log('GET /workflows/tasks/me (no auth) ->', res.status, res.body)

  res = await request(app).get('/notifications/me')
  console.log('GET /notifications/me (no auth) ->', res.status, res.body)

  res = await request(app).get('/admin/users')
  console.log('GET /admin/users (no auth) ->', res.status, res.body)

  res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'x' })
  console.log('POST /auth/login (bad creds, db not mocked) ->', res.status, res.body)

  res = await request(app).get('/nonexistent')
  console.log('GET /nonexistent ->', res.status, res.body)
}

main()
