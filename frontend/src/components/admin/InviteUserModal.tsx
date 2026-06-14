'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Copy, X } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Spinner } from '@/components/ui/Spinner'
import { ADMIN_COLORS as COLOR } from './colors'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface RoleOption {
  id: string
  name: string
  description: string | null
}

interface InviteUserResponse {
  message: string
  user_id: string
  magic_link: string
  expires_at: string
}

export interface InviteUserResult {
  email: string
  magicLink: string
}

export interface InviteUserModalProps {
  onClose: () => void
  /** Called after the invite is sent — the magic link is always returned so it can be shared even when SMTP isn't configured. */
  onSuccess: (result: InviteUserResult) => void
}

const inputClassName = 'w-full rounded-[7px] px-3 py-2 text-[13px] outline-none'
const inputStyle = { backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}`, color: COLOR.title }

async function fetchRoles(): Promise<RoleOption[]> {
  const { data } = await api.get<{ data: RoleOption[] }>('/admin/roles')
  return data.data
}

export function InviteUserModal({ onClose, onSuccess }: InviteUserModalProps) {
  const currentUser = useAuthStore((state) => state.user)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [roleName, setRoleName] = useState('')
  const [designation, setDesignation] = useState('')
  const [grade, setGrade] = useState('')
  const [personalNote, setPersonalNote] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<(InviteUserResult & { copied: boolean }) | null>(null)

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: fetchRoles,
  })

  useEffect(() => {
    function handleEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const emailLooksValid = EMAIL_RE.test(email.trim())
  const emailDomain = email.includes('@') ? email.split('@')[1] : ''
  const selectedRole = roles?.find((role) => role.name === roleName)
  const canSubmit = !!firstName.trim() && !!lastName.trim() && emailLooksValid && !!roleName && !submitting

  async function handleSubmit() {
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      const { data } = await api.post<InviteUserResponse>('/users/invite', {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase(),
        role_name: roleName,
        designation: designation.trim() || undefined,
        grade: grade.trim() || undefined,
        personal_note: personalNote.trim() || undefined,
      })
      setResult({ email: email.trim().toLowerCase(), magicLink: data.magic_link, copied: false })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopyLink() {
    if (!result) return
    await navigator.clipboard.writeText(result.magicLink)
    setResult({ ...result, copied: true })
  }

  function handleDone() {
    if (result) onSuccess({ email: result.email, magicLink: result.magicLink })
  }

  const invitedByName = `${currentUser?.firstName ?? ''} ${currentUser?.lastName ?? ''}`.trim() || 'Your administrator'
  const previewBody = [
    `Hi ${firstName.trim() || 'there'},`,
    '',
    `${invitedByName} has invited you to join SG LXP.`,
    ...(personalNote.trim() ? ['', personalNote.trim()] : []),
    '',
    'Set up your account by clicking the link below:',
    '[link generated after the invite is sent]',
    '',
    'This link expires in 72 hours.',
  ].join('\n')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ backgroundColor: COLOR.overlay }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-screen w-screen flex-col overflow-y-auto p-6 sm:h-auto sm:max-h-[90vh] sm:w-[560px] sm:max-w-[calc(100vw-2rem)] sm:rounded-xl"
        style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}
      >
        {result ? (
          <SuccessState result={result} onCopy={handleCopyLink} onDone={handleDone} />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-[16px] font-medium" style={{ color: COLOR.title }}>
                  Invite user
                </h2>
                <p className="mt-0.5 text-[13px]" style={{ color: COLOR.muted35 }}>
                  Send a magic link to set up their account
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted08}`, color: COLOR.muted40 }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name">
                  <input
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className={inputClassName}
                    style={inputStyle}
                    placeholder="Jane"
                  />
                </Field>
                <Field label="Last name">
                  <input
                    type="text"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className={inputClassName}
                    style={inputStyle}
                    placeholder="Doe"
                  />
                </Field>
              </div>

              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClassName}
                  style={inputStyle}
                  placeholder="jane.doe@sg.com"
                />
                {email.length > 0 && !emailLooksValid && (
                  <p className="mt-1.5 text-[12px]" style={{ color: COLOR.red }}>
                    Enter a valid email address
                  </p>
                )}
                {emailLooksValid && emailDomain && (
                  <p className="mt-1.5 text-[12px]" style={{ color: COLOR.muted30 }}>
                    We&apos;ll check that <span style={{ color: COLOR.muted50 }}>{emailDomain}</span> is an approved domain for this tenant
                  </p>
                )}
              </Field>

              <Field label="Role">
                <select
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                  className={inputClassName}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                  disabled={rolesLoading}
                >
                  <option value="">{rolesLoading ? 'Loading roles…' : 'Select a role'}</option>
                  {roles?.map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </select>
                {selectedRole?.description && (
                  <p className="mt-1.5 text-[12px]" style={{ color: COLOR.muted30 }}>
                    {selectedRole.description}
                  </p>
                )}
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Designation (optional)">
                  <input
                    type="text"
                    value={designation}
                    onChange={(event) => setDesignation(event.target.value)}
                    className={inputClassName}
                    style={inputStyle}
                    placeholder="Software Engineer II"
                  />
                </Field>
                <Field label="Grade (optional)">
                  <input
                    type="text"
                    value={grade}
                    onChange={(event) => setGrade(event.target.value)}
                    className={inputClassName}
                    style={inputStyle}
                    placeholder="L3"
                  />
                </Field>
              </div>

              <Field label="Personal note (optional)">
                <textarea
                  value={personalNote}
                  onChange={(event) => setPersonalNote(event.target.value)}
                  rows={3}
                  placeholder="Add a short welcome message — it will be included in the invitation email"
                  className={`${inputClassName} resize-none`}
                  style={inputStyle}
                />
              </Field>

              <div>
                <button
                  type="button"
                  onClick={() => setShowPreview((current) => !current)}
                  className="flex items-center gap-1.5 text-[12px] transition-colors"
                  style={{ color: COLOR.muted40 }}
                >
                  {showPreview ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  Preview invitation email
                </button>
                {showPreview && (
                  <pre
                    className="mt-2 whitespace-pre-wrap rounded-[7px] px-3 py-2.5 text-[12px]"
                    style={{ backgroundColor: COLOR.rowBg, border: `0.5px solid ${COLOR.hairline}`, color: COLOR.muted60 }}
                  >
                    {previewBody}
                  </pre>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 pt-4" style={{ borderTop: `0.5px solid ${COLOR.cardBorder}` }}>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3.5 py-2 text-[13px] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
                style={{ color: COLOR.muted50 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: COLOR.accent }}
              >
                {submitting && <Spinner className="h-3.5 w-3.5 text-white" />}
                Send invitation
              </button>
            </div>

            {error && (
              <p className="mt-2 text-right text-[13px]" style={{ color: COLOR.red }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px]" style={{ color: COLOR.muted50 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function SuccessState({
  result,
  onCopy,
  onDone,
}: {
  result: InviteUserResult & { copied: boolean }
  onCopy: () => void
  onDone: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: COLOR.greenBg, color: COLOR.green }}>
        <Check className="h-5 w-5" />
      </div>
      <div className="text-[16px] font-medium" style={{ color: COLOR.title }}>
        Invitation sent
      </div>
      <div className="text-[13px]" style={{ color: COLOR.muted40 }}>
        {result.email} will receive an email with a link to set up their account
      </div>

      <div
        className="mt-2 flex w-full max-w-[440px] items-center gap-2 rounded-[7px] px-3 py-2.5 text-left"
        style={{ backgroundColor: COLOR.rowBg, border: `0.5px solid ${COLOR.hairline}` }}
      >
        <span className="flex-1 truncate text-[12px]" style={{ color: COLOR.muted50 }}>
          {result.magicLink}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors"
          style={{ backgroundColor: COLOR.accentBg10, color: COLOR.accentText }}
        >
          {result.copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {result.copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <p className="text-[12px]" style={{ color: COLOR.muted30 }}>
        If email delivery isn&apos;t configured for this tenant, share this link with them directly.
      </p>

      <button
        type="button"
        onClick={onDone}
        className="mt-3 rounded-md px-4 py-2 text-[13px] font-medium text-white transition-opacity"
        style={{ backgroundColor: COLOR.accent }}
      >
        Done
      </button>
    </div>
  )
}
