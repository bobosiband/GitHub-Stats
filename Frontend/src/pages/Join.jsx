/**
 * Join page — public self-serve form.
 *
 * Backend body is strict `{ githubUsername, zid }`; we still expose the
 * optional displayName and programRepo inputs so if a user fills them, we
 * pass them through and surface the backend's friendly "unexpected field"
 * 400 message rather than silently dropping input.
 *
 * Data:
 *   GET  /cohorts                       — populate cohort <select>
 *   POST /cohorts/:slug/join            — submit
 *
 * Error handling: each documented status (400/403/404/409/422/network) gets a
 * specific human message. On 201 we show a success flash and redirect to the
 * new profile.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, getCohorts, joinCohort } from '../lib/api.js';
import { useFetch, hasEnded } from '../lib/util.js';
import { EmptyState, ErrorState, Loading } from '../components/ui.jsx';
import { IconAlert, IconCheck, IconPeople } from '../components/Icons.jsx';

const ZID_RE = /^z\d{7}$/;
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;
const USERNAME_RE = /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/;

export default function Join() {
  const cohorts = useFetch(getCohorts, []);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [form, setForm] = useState({
    cohortSlug: '',
    githubUsername: '',
    zid: '',
    displayName: '',
    programRepo: '',
  });
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState(null); // { kind, title, message, code? }

  const activeCohorts = useMemo(() => {
    const list = cohorts.data?.cohorts ?? [];
    const now = new Date();
    return list.filter((c) => c.isActive && !hasEnded(c, now));
  }, [cohorts.data]);

  // Preselect from `?cohort=slug`, then fall back to the first active cohort.
  useEffect(() => {
    if (form.cohortSlug || !activeCohorts.length) return;
    const wanted = params.get('cohort');
    const initial = activeCohorts.find((c) => c.slug === wanted) ?? activeCohorts[0];
    if (initial) setForm((f) => ({ ...f, cohortSlug: initial.slug }));
  }, [activeCohorts, params, form.cohortSlug]);

  const zidRequired = form.cohortSlug && form.cohortSlug !== 'global';
  const errors = validate(form, { zidRequired });
  const canSubmit =
    !submitting &&
    form.cohortSlug &&
    !errors.githubUsername &&
    !errors.zid &&
    !errors.programRepo;

  const onChange = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const onBlur = (k) => setTouched((t) => ({ ...t, [k]: true }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ githubUsername: true, zid: true, programRepo: true });
    if (!canSubmit) return;

    setSubmitting(true);
    setFlash(null);

    const body = {
      githubUsername: form.githubUsername.trim(),
    };
    // For program cohorts we always send zid. For global we only send it if the
    // user actually filled it in (they can join as a non-UNSW member).
    const trimmedZid = form.zid.trim().toLowerCase();
    if (trimmedZid) body.zid = trimmedZid;
    if (form.displayName.trim()) body.displayName = form.displayName.trim();
    if (form.programRepo.trim()) body.programRepo = form.programRepo.trim();

    try {
      const res = await joinCohort(form.cohortSlug, body);
      setFlash({
        kind: 'success',
        title: 'Welcome to the board!',
        message: `Redirecting to @${res.member.githubUsername}'s profile…`,
      });
      setTimeout(() => navigate(`/u/${encodeURIComponent(res.member.githubUsername)}`), 900);
    } catch (err) {
      setFlash(flashFromError(err, form.cohortSlug));
    } finally {
      setSubmitting(false);
    }
  };

  if (cohorts.loading) {
    return <div className="container"><Loading rows={5} height={24} /></div>;
  }
  if (cohorts.error) {
    return <div className="container"><ErrorState error={cohorts.error} onRetry={cohorts.retry} /></div>;
  }
  if (!activeCohorts.length) {
    return (
      <div className="container">
        <EmptyState
          icon={<IconPeople size={28} />}
          title="No cohorts open right now"
          description="Once an organiser opens one, you'll be able to join here."
          action={<Link to="/" className="btn">Back to home</Link>}
        />
      </div>
    );
  }

  return (
    <div className="container stack gap-16">
      <div>
        <h1>Join GitRank</h1>
        <p className="muted">
          Public. Read-only. All we ever look at is your GitHub activity. New members
          are auto-added to the global cohort too.
        </p>
      </div>

      {flash && (
        <div className={`flash ${flash.kind}`} role="alert">
          {flash.kind === 'success' ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <div className="stack gap-4 grow">
            <strong>{flash.title}</strong>
            <span>{flash.message}</span>
            {flash.code && <span className="text-sm mono">code: {flash.code}</span>}
          </div>
        </div>
      )}

      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="cohort">Cohort</label>
          <select
            id="cohort"
            value={form.cohortSlug}
            onChange={(e) => onChange('cohortSlug', e.target.value)}
          >
            {activeCohorts.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name} ({c.slug})
              </option>
            ))}
          </select>
          <span className="hint">
            You'll also land on the always-on <code>global</code> cohort.
          </span>
        </div>

        <div className={`field ${touched.githubUsername && errors.githubUsername ? 'invalid' : ''}`}>
          <label htmlFor="gh">GitHub username</label>
          <input
            id="gh"
            type="text"
            autoComplete="username"
            value={form.githubUsername}
            onChange={(e) => onChange('githubUsername', e.target.value)}
            onBlur={() => onBlur('githubUsername')}
            placeholder="octocat"
            required
          />
          {touched.githubUsername && errors.githubUsername && (
            <span className="field-error">{errors.githubUsername}</span>
          )}
        </div>

        <div className={`field mono ${touched.zid && errors.zid ? 'invalid' : ''}`}>
          <label htmlFor="zid">
            zID{' '}
            {!zidRequired && <span className="muted">(optional for global — UNSW student? add your zID)</span>}
          </label>
          <input
            id="zid"
            type="text"
            value={form.zid}
            onChange={(e) => onChange('zid', e.target.value)}
            onBlur={() => onBlur('zid')}
            placeholder="z1234567"
            required={zidRequired}
          />
          <span className="hint">
            {zidRequired
              ? <>Format: <code>z</code> + seven digits.</>
              : <>Optional on <code>global</code>. If you add it later on a program cohort we'll link the accounts.</>}
          </span>
          {touched.zid && errors.zid && (
            <span className="field-error">{errors.zid}</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="dn">Display name <span className="muted">(optional)</span></label>
          <input
            id="dn"
            type="text"
            value={form.displayName}
            onChange={(e) => onChange('displayName', e.target.value)}
            placeholder="Ada Lovelace"
          />
          <span className="hint">
            Skip this and we'll auto-fill from your GitHub profile.
          </span>
        </div>

        <div className={`field mono ${touched.programRepo && errors.programRepo ? 'invalid' : ''}`}>
          <label htmlFor="pr">Program repo <span className="muted">(optional)</span></label>
          <input
            id="pr"
            type="text"
            value={form.programRepo}
            onChange={(e) => onChange('programRepo', e.target.value)}
            onBlur={() => onBlur('programRepo')}
            placeholder="owner/repo"
          />
          <span className="hint">
            Organiser-managed on the backend — leave blank unless your organiser said otherwise.
          </span>
          {touched.programRepo && errors.programRepo && (
            <span className="field-error">{errors.programRepo}</span>
          )}
        </div>

        <div className="row gap-8">
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {submitting ? 'Joining…' : 'Join cohort'}
          </button>
          <Link to="/" className="btn">Cancel</Link>
        </div>
      </form>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Validation + error mapping
 * -------------------------------------------------------------------------- */

function validate(form, { zidRequired = true } = {}) {
  const out = {};
  if (form.githubUsername && !USERNAME_RE.test(form.githubUsername.trim())) {
    out.githubUsername = "That doesn't look like a valid GitHub username.";
  }
  const trimmedZid = form.zid.trim().toLowerCase();
  if (trimmedZid && !ZID_RE.test(trimmedZid)) {
    out.zid = 'zID must be a "z" followed by exactly 7 digits.';
  } else if (!trimmedZid && zidRequired) {
    out.zid = 'zID is required for program cohorts.';
  }
  if (form.programRepo && !REPO_RE.test(form.programRepo.trim())) {
    out.programRepo = 'Use the "owner/name" format.';
  }
  return out;
}

function flashFromError(err, slug) {
  if (!(err instanceof ApiError)) {
    return { kind: 'danger', title: 'Something went wrong', message: String(err?.message ?? err) };
  }
  const base = { code: err.code };
  switch (err.status) {
    case 400:
      return { kind: 'danger', title: 'Invalid input', message: err.message, ...base };
    case 403:
      return { kind: 'attention', title: 'Cohort is closed', message: `"${slug}" isn't open for joining right now.`, ...base };
    case 404:
      return { kind: 'attention', title: 'Cohort not found', message: `We couldn't find "${slug}". Refresh and pick another one.`, ...base };
    case 409:
      return {
        kind: 'danger',
        title: 'Already registered',
        message: err.message ?? 'That zID or GitHub username is linked to a different identity.',
        ...base,
      };
    case 422:
      return {
        kind: 'danger',
        title: "GitHub can't find that account",
        message: 'Double-check the spelling of your GitHub username.',
        ...base,
      };
    default:
      return { kind: 'danger', title: 'Something went wrong', message: err.message ?? String(err), ...base };
  }
}
