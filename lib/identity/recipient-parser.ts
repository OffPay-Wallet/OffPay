/**
 * Unified recipient input parser.
 *
 * Centralises the "what kind of identity did the user type?" decision
 * so the send flows have one source of truth and adding new
 * resolvers later (e.g. ENS, .bonk) is a single-file change.
 *
 * Inputs we recognise today:
 *   - Base58 Solana addresses
 *   - SNS names (`*.sol` or bare alphanumeric domains)
 *   - X handles (`@user`, `x.com/user`, `twitter.com/user`)
 *
 * The bare-alphanumeric case is genuinely ambiguous: `vitalik`
 * could resolve to `vitalik.sol` or to `@vitalik`. We surface that
 * ambiguity as its own kind so the UI can render a "treat as `.sol`
 * / treat as `@handle`" chip pair instead of silently picking one.
 */
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { isSnsNameInput, normalizeSnsNameInput } from '@/lib/identity/sns';
import { isXHandleInput, normalizeXHandle } from '@/lib/identity/x-handle';

export type RecipientKind = 'address' | 'sns' | 'x' | 'ambiguous' | 'invalid';

export type RecipientCandidate =
  | { kind: 'address'; address: string }
  | { kind: 'sns'; domain: string }
  | { kind: 'x'; handle: string }
  | { kind: 'ambiguous'; sns: string; x: string }
  | { kind: 'invalid' };

/**
 * Anything matching this pattern is plausibly both a bare SNS name
 * (without the `.sol` suffix) and an X handle. We mark these as
 * `ambiguous` so the UI can ask the user instead of guessing.
 *
 * Notes:
 *  - X handles allow underscores; SNS names don't, but the SNS
 *    normaliser rejects underscores by returning `null`. Inputs
 *    containing `_` therefore fall through to the X-only branch.
 *  - Single-character X handles exist (`@x`); we treat any
 *    1–15 char alphanumeric input as ambiguous when both
 *    normalisers accept it.
 */
const BARE_AMBIGUOUS_PATTERN = /^[A-Za-z0-9]{1,15}$/;

export function parseRecipientInput(value: string | null | undefined): RecipientCandidate {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) return { kind: 'invalid' };

  if (isValidSolanaAddress(trimmed)) {
    return { kind: 'address', address: trimmed };
  }

  // X URL form (`x.com/user`, `twitter.com/user`) — unambiguous.
  // Anything containing a `/`, `://`, or a host suffix can't be an
  // SNS name, so route it directly to the X branch.
  if (/[/:]/.test(trimmed)) {
    const handle = normalizeXHandle(trimmed);
    return handle != null ? { kind: 'x', handle } : { kind: 'invalid' };
  }

  // Strip a single leading `@` so we can consult the SNS detector
  // with the raw alphanumeric form.
  const dropAt = trimmed.replace(/^@+/, '');
  const explicitlyXPrefixed = trimmed.startsWith('@');

  // `*.sol` or `*.x` suffixes are unambiguous in their respective
  // namespaces. `.x` is X's account URL-style suffix; we coerce it
  // to the bare handle.
  if (/\.sol$/i.test(trimmed)) {
    const domain = normalizeSnsNameInput(trimmed);
    return domain != null ? { kind: 'sns', domain } : { kind: 'invalid' };
  }
  if (/\.x$/i.test(trimmed) && !explicitlyXPrefixed) {
    const handle = normalizeXHandle(dropAt.replace(/\.x$/i, ''));
    return handle != null ? { kind: 'x', handle } : { kind: 'invalid' };
  }

  if (explicitlyXPrefixed) {
    const handle = normalizeXHandle(trimmed);
    return handle != null ? { kind: 'x', handle } : { kind: 'invalid' };
  }

  if (!BARE_AMBIGUOUS_PATTERN.test(dropAt)) {
    // The bare-alphanumeric branch did not match. Two cases left:
    //  - Input contains an underscore. Underscores are valid X
    //    handle characters but not in SNS roots, so route to X.
    //  - Anything else: defer to the SNS normaliser, which handles
    //    longer hyphenated or multi-segment SNS names.
    if (/_/.test(dropAt)) {
      const handle = normalizeXHandle(dropAt);
      return handle != null ? { kind: 'x', handle } : { kind: 'invalid' };
    }
    const domain = normalizeSnsNameInput(dropAt);
    return domain != null ? { kind: 'sns', domain } : { kind: 'invalid' };
  }

  const snsDomain = isSnsNameInput(dropAt) ? normalizeSnsNameInput(dropAt) : null;
  const xHandle = isXHandleInput(dropAt) ? normalizeXHandle(dropAt) : null;

  if (snsDomain != null && xHandle != null) {
    return { kind: 'ambiguous', sns: snsDomain, x: xHandle };
  }
  if (snsDomain != null) {
    return { kind: 'sns', domain: snsDomain };
  }
  if (xHandle != null) {
    return { kind: 'x', handle: xHandle };
  }

  return { kind: 'invalid' };
}
