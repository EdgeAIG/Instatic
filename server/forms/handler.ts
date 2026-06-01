import type { DbClient } from '../db/client'
import { DEV_ORIGIN_ALLOWLIST, clientIp, expectedOrigin } from '../auth/security'
import { badRequest, jsonResponse, methodNotAllowed, readValidatedBody } from '../http'
import { createDataRow, getDataTable } from '../repositories/data'
import { getLatestPublishedSiteSnapshot } from '../repositories/publish'
import {
  PublicFormChallengeBodySchema,
  PublicFormSubmitBodySchema,
  derivePageFormSnapshots,
  isFormSubmissionTargetTable,
  validateFormSubmission,
  type PublishedFormSnapshot,
} from '@core/forms'
import {
  issuePublicFormChallenge,
  verifyPublicFormPageToken,
  verifyAndConsumePublicFormChallenge,
} from './challenge'
import {
  publicFormPerFormRateLimit,
  publicFormPerIpRateLimit,
} from './rateLimit'

type PublicFormRoute = 'challenge' | 'submit'

export async function handlePublicFormRequest(
  req: Request,
  db: DbClient,
  url: URL,
): Promise<Response | null> {
  const route = publicFormRoute(url.pathname)
  if (!route) return null
  if (req.method !== 'POST') return methodNotAllowed()
  if (!publicFormOriginAllowed(req)) {
    return jsonResponse({ error: 'Form submissions must come from this site.' }, { status: 403 })
  }
  if (route === 'challenge') return handleChallenge(req, db)
  return handleSubmit(req, db)
}

async function handleChallenge(req: Request, db: DbClient): Promise<Response> {
  const body = await readValidatedBody(req, PublicFormChallengeBodySchema)
  if (!body) return badRequest('Invalid form challenge payload')
  const snapshot = await findPublishedFormSnapshot(db, body.pageId, body.formId)
  if (!snapshot) return jsonResponse({ error: 'Form not found' }, { status: 404 })
  if (!verifyPublicFormPageToken(body)) {
    return jsonResponse({ error: 'Invalid form page token' }, { status: 403 })
  }
  const challenge = issuePublicFormChallenge({ pageId: snapshot.pageId, formId: snapshot.formId })
  return jsonResponse({
    token: challenge.token,
    challenge: challenge.challenge,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  })
}

async function handleSubmit(req: Request, db: DbClient): Promise<Response> {
  const body = await readValidatedBody(req, PublicFormSubmitBodySchema)
  if (!body) return badRequest('Invalid form submission payload')

  const ipKey = clientIp(req) ?? 'unknown'
  const ipDecision = publicFormPerIpRateLimit.consume(ipKey)
  if (!ipDecision.ok) return rateLimited(ipDecision.retryAfterMs)
  const formDecision = publicFormPerFormRateLimit.consume(`${ipKey}|${body.formId}`)
  if (!formDecision.ok) return rateLimited(formDecision.retryAfterMs)

  const challenge = verifyAndConsumePublicFormChallenge({
    pageId: body.pageId,
    formId: body.formId,
    challenge: body.challenge,
    token: body.token,
  })
  if (!challenge) return badRequest('Invalid or expired form challenge')

  const snapshot = await findPublishedFormSnapshot(db, body.pageId, body.formId)
  if (!snapshot) return jsonResponse({ error: 'Form not found' }, { status: 404 })

  const elapsedMs = Date.now() - challenge.issuedAt
  if (snapshot.minSubmitSeconds > 0 && elapsedMs < snapshot.minSubmitSeconds * 1000) {
    return badRequest('Form submitted too quickly')
  }

  const values = { ...body.values }
  const honeypotValue = values[snapshot.honeypotName]
  delete values[snapshot.honeypotName]
  if (honeypotValue !== undefined && String(honeypotValue).trim() !== '') {
    return badRequest('Invalid form submission')
  }

  const table = await getDataTable(db, snapshot.targetTableId)
  if (!table || !isFormSubmissionTargetTable(table)) {
    return jsonResponse({ error: 'Form target not found' }, { status: 404 })
  }

  const validation = validateFormSubmission({
    table,
    controls: snapshot.controls,
    values,
  })
  if (!validation.ok) {
    return jsonResponse({ error: 'Invalid form values', errors: validation.errors }, { status: 400 })
  }

  const row = await createDataRow(db, {
    tableId: table.id,
    cells: validation.cells,
    slug: '',
  })
  return jsonResponse({ ok: true, rowId: row.id })
}

async function findPublishedFormSnapshot(
  db: DbClient,
  pageId: string,
  formId: string,
): Promise<PublishedFormSnapshot | null> {
  const snapshot = await getLatestPublishedSiteSnapshot(db)
  const page = snapshot?.site.pages.find((candidate) => candidate.id === pageId)
  if (!page) return null
  return derivePageFormSnapshots(page).find((candidate) => candidate.formId === formId) ?? null
}

function publicFormRoute(pathname: string): PublicFormRoute | null {
  if (pathname === '/_pb/form/challenge') return 'challenge'
  if (pathname === '/_pb/form/submit') return 'submit'
  if (pathname.startsWith('/_pb/form/')) return 'submit'
  return null
}

function publicFormOriginAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  if (origin !== expectedOrigin(req) && !DEV_ORIGIN_ALLOWLIST.includes(origin)) return false
  const fetchSite = req.headers.get('sec-fetch-site')
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
}

function rateLimited(retryAfterMs: number): Response {
  return jsonResponse(
    { error: 'Too many form submissions. Try again later.' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    },
  )
}
