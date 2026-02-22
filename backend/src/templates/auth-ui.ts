import { COLORS } from './styles'
import type { SessionUser } from '../services/session'

function esc(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

export function renderTopbarAuth(session: SessionUser | null, returnUrl?: string): string {
  if (session) {
    return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${COLORS.text}">
      ${session.x_pfp ? `<a href="/profile"><img src="${esc(session.x_pfp)}" alt="" style="width:22px;height:22px;border-radius:50%;border:1px solid ${COLORS.border}" /></a>` : ''}
      <a href="/profile" style="color:${COLORS.text};text-decoration:none">@${esc(session.x_username)}</a>
    </div>`
  }

  const returnParam = returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ''
  return `<a href="/auth/twitter${returnParam}" class="auth-btn" style="display:inline-flex;align-items:center;gap:5px;background:${COLORS.accent};color:${COLORS.bg};border:none;padding:5px 14px;border-radius:4px;font-size:12px;font-weight:600;text-decoration:none">Login with X</a>`
}
