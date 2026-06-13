// src/modules/skills/skillRoutes.js
//
// /skills — a learner's skill inventory, self-declaration, manager
// validation, and gap-driven recommendations.
// Every route: authenticate -> requirePermission -> handler.
// requirePermission() handles the 403 + ACCESS_VIOLATION audit write for
// permission denials (Rule 2); skillService additionally enforces Rule 7
// resource-level visibility (e.g. ?userId= on /skills/inventory, and the
// reporting-manager-only check on PUT /skills/:skillId/validate), each with
// its own ACCESS_VIOLATION audit write.
//
// Declares full paths and is mounted at the application root (same
// convention as pathRoutes/assignmentRoutes/progressRoutes/dashboardRoutes).

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const skillService = require('./skillService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// GET /skills/inventory — the caller's skill inventory, or (for a reporting
// manager) a direct report's via ?userId=
router.get('/skills/inventory', requirePermission('view', 'skills', 'inventory'), async (req, res, next) => {
  try {
    const result = await skillService.getInventory({
      actor: actorFrom(req),
      userId: req.query.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ skills: result.skills, summary: result.summary })
  } catch (err) {
    next(err)
  }
})

// POST /skills/declare — self-declare a skill and proficiency level
router.post('/skills/declare', requirePermission('create', 'skills', 'inventory'), async (req, res, next) => {
  try {
    const result = await skillService.declareSkill({
      actor: actorFrom(req),
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.record)
  } catch (err) {
    next(err)
  }
})

// PUT /skills/:skillId/validate — reporting_manager/competency_leader approves
// or rejects a self-declared skill (skillId = user_skill_records.id)
router.put('/skills/:skillId/validate', requirePermission('approve', 'skills', 'validation'), async (req, res, next) => {
  try {
    const result = await skillService.validateSkill({
      actor: actorFrom(req),
      recordId: req.params.skillId,
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.record)
  } catch (err) {
    next(err)
  }
})

// GET /skills/gap-analysis — the caller's skill gaps against their designation's requirements
router.get('/skills/gap-analysis', requirePermission('view', 'skills', 'gap_analysis'), async (req, res, next) => {
  try {
    const result = await skillService.getGapAnalysis({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /skills/recommendations — top content recommendations based on the caller's skill gaps
router.get('/skills/recommendations', requirePermission('view', 'skills', 'recommendations'), async (req, res, next) => {
  try {
    const result = await skillService.getRecommendations({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /skills/all — every active skill grouped by competency category (the declare-skill picker)
router.get('/skills/all', requirePermission('view', 'skills', 'catalog'), async (req, res, next) => {
  try {
    const result = await skillService.getAllSkillsGrouped({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

module.exports = router
