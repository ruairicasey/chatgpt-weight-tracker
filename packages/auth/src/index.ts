import type { TrackerScope, UserId } from '@weight-tracker/contracts';

declare const verifiedIdentityBrand: unique symbol;
declare const verifiedPrincipalBrand: unique symbol;

/** Produced only by a future server-side cryptographic verifier, not Zod parsing. */
export type VerifiedExternalIdentity = Readonly<{
  issuer: string;
  subject: string;
  clientId: string;
  scopes: readonly TrackerScope[];
  [verifiedIdentityBrand]: true;
}>;

/** A verified identity explicitly mapped to an enabled internal owner. */
export type VerifiedPrincipal = Readonly<{
  userId: UserId;
  identity: VerifiedExternalIdentity;
  [verifiedPrincipalBrand]: true;
}>;

export interface McpTokenVerifier {
  verify(accessToken: string): Promise<VerifiedExternalIdentity>;
}

export interface PrincipalResolver {
  resolve(identity: VerifiedExternalIdentity): Promise<VerifiedPrincipal>;
}

// Interfaces only: no verifier, anonymous fallback, JWT decoder, account linking,
// Supabase session handling or constructor that turns tool input into a principal.
