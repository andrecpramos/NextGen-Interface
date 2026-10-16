// Shapes found rehearsing on real apps (Next.js, React Router), 2026-10-16: a submit button named by its
// idle state, and controls that only leave, view or page through. Read by `controls.test.ts` alone.
'use client'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { next, previous, signOut, submit, viewProvenance } from '../api'

export function SignInForm({ pending, isSubmitting, saving }: { pending: boolean; isSubmitting: boolean; saving: boolean }) {
  const t = useTranslations()
  return (
    <form action={submit}>
      {/* Named by what it does when it is not busy. */}
      <Button type="submit" disabled={pending}>{pending ? t('common.loading') : t('auth.login.submit')}</Button>
      <Button onClick={() => submit()}>{!isSubmitting ? 'Send request' : 'Sending…'}</Button>
      <Button onClick={() => submit()}>{saving ? 'Saving' : 'Save draft'}</Button>
      {/* A condition about anything else is still computed: never guessed. */}
      <Button onClick={() => submit()}>{pending && 'x' ? 'One' : 'Other'}</Button>

      {/* An icon beside the words, swapped while busy, is decoration — the words are the name. */}
      <Button onClick={() => submit()}>{pending ? <Spinner /> : <Plus />} New post</Button>

      {/* Leaves, views or pages through: chrome, whatever the handler calls. */}
      <Button onClick={() => signOut()}>Or click here to logout.</Button>
      <Button onClick={() => signOut()}>Sign Out</Button>
      <Button onClick={() => signOut()}>Terminar sessão</Button>
      <Button onClick={() => viewProvenance()}>View Provenance</Button>
      <Button onClick={() => viewProvenance()}>Ver modalidades</Button>
      <Button onClick={() => previous()}>Fotografia anterior</Button>
      <Button onClick={() => next()}>Next photo</Button>
    </form>
  )
}

/** Only for whoever wrote the post: a condition about who, read as one. */
export function PostActions({ post, session }: { post: { authorId: string }; session: { user: { id: string } } }) {
  return <>{post.authorId === session.user.id && <Button onClick={() => submit()}>Delete post</Button>}</>
}

/**
 * Conditions about the item's state, whose words merely start like a permission flag: `CANCELLED`, a
 * `candidate`. Not about who — one real app's attendance and "Reopen" were dropped on `isCancelled`.
 */
export function SessionState({ session, candidate }: { session: { status: string }; candidate: boolean }) {
  const isCancelled = session.status === 'CANCELLED'
  const canEditRoster = !isCancelled
  return (
    <>
      {session.status === 'CANCELLED' && <Button onClick={() => submit()}>Reopen session</Button>}
      {canEditRoster && <Button onClick={() => submit()}>Mark all present</Button>}
      {candidate && <Button onClick={() => submit()}>Shortlist candidate</Button>}
    </>
  )
}

/** A button with no type inside a form submits it, by HTML's default; `type="button"` does not. */
export function ReportForm() {
  return (
    <form onSubmit={submit}>
      <Button>Create report</Button>
      <button type="button">Preview</button>
    </form>
  )
}
